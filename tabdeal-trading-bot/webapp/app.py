import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from flask import Flask, jsonify, render_template, request  # noqa: E402

from src.config import Config, ConfigError  # noqa: E402
from src.exchange_client import ExchangeClient  # noqa: E402
from src.logger_setup import setup_logger  # noqa: E402
from src.trade_journal import TradeJournal  # noqa: E402
from webapp.bot_runner import BotRunner  # noqa: E402
from webapp.env_writer import read_env_file, update_env_file  # noqa: E402

logger = logging.getLogger("tabdeal_bot")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, ".env")
ENV_EXAMPLE_PATH = os.path.join(BASE_DIR, ".env.example")
LOG_PATH = os.path.join(BASE_DIR, "logs", "bot.log")
TRADE_HISTORY_PATH = os.path.join(BASE_DIR, "data", "trade_history.jsonl")

if not os.path.exists(ENV_PATH) and os.path.exists(ENV_EXAMPLE_PATH):
    with open(ENV_EXAMPLE_PATH, "r", encoding="utf-8") as src, open(ENV_PATH, "w", encoding="utf-8") as dst:
        dst.write(src.read())

setup_logger("INFO")

app = Flask(__name__)
runner = BotRunner()

FORM_FIELDS = [
    "QUOTE_ASSET",
    "QUANTITY_PRECISION",
    "TRADING_FEE_PERCENT",
    "STOP_LOSS_PERCENT",
    "TAKE_PROFIT_PERCENT",
    "MAX_DAILY_LOSS_PERCENT",
    "SMA_FAST_PERIOD",
    "SMA_SLOW_PERIOD",
    "NEWS_ENABLED",
    "NEWS_CACHE_MINUTES",
    "POLL_INTERVAL_SECONDS",
    "DRY_RUN",
    "AUTO_START",
]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config", methods=["GET"])
def get_config():
    env = read_env_file(ENV_PATH)
    data = {field: env.get(field, "") for field in FORM_FIELDS}
    data["has_api_key"] = bool(env.get("TABDEAL_API_KEY"))
    data["has_api_secret"] = bool(env.get("TABDEAL_API_SECRET"))
    data["has_news_token"] = bool(env.get("NEWS_API_KEY"))
    return jsonify(data)


@app.route("/api/config", methods=["POST"])
def save_config():
    if runner.is_running:
        return jsonify({"error": "قبل از تغییر تنظیمات، ربات را متوقف کنید."}), 400

    payload = request.get_json(force=True)
    updates = {}

    for field in FORM_FIELDS:
        if field in payload and payload[field] != "":
            value = payload[field]
            if field in ("DRY_RUN", "NEWS_ENABLED", "AUTO_START"):
                value = "true" if str(value).lower() in ("true", "1", "on") else "false"
            updates[field] = value

    if payload.get("TABDEAL_API_KEY"):
        updates["TABDEAL_API_KEY"] = payload["TABDEAL_API_KEY"].strip()
    if payload.get("TABDEAL_API_SECRET"):
        updates["TABDEAL_API_SECRET"] = payload["TABDEAL_API_SECRET"].strip()
    if payload.get("NEWS_API_KEY"):
        updates["NEWS_API_KEY"] = payload["NEWS_API_KEY"].strip()

    update_env_file(ENV_PATH, updates)
    return jsonify({"ok": True})


@app.route("/api/status", methods=["GET"])
def status():
    return jsonify(runner.get_status())


@app.route("/api/start", methods=["POST"])
def start():
    try:
        config = Config.load(ENV_PATH)
        runner.start(config)
        return jsonify({"ok": True})
    except ConfigError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/stop", methods=["POST"])
def stop():
    runner.stop()
    return jsonify({"ok": True})


@app.route("/api/balances", methods=["GET"])
def balances():
    try:
        config = Config.load(ENV_PATH)
    except ConfigError as exc:
        return jsonify({"error": str(exc)}), 400

    if not config.api_key or not config.api_secret:
        return jsonify({"error": "ابتدا API Key و API Secret را در تنظیمات ذخیره کنید."}), 400

    exchange = ExchangeClient(api_key=config.api_key, api_secret=config.api_secret, dry_run=True)
    result = exchange.get_all_balances()

    if result is None:
        return jsonify({"error": "دریافت موجودی از تبدیل ممکن نشد. لاگ‌ها را بررسی کنید."}), 502

    # قیمت هر دارایی (غیر از خود quote_asset) یک درخواست شبکه‌ای جداست؛
    # مثل بقیه‌ی جاهای پروژه هم‌زمان (نه یکی‌یکی) می‌خوانیم تا این endpoint
    # سریع برگردد و داشبورد وقتی خودکار هر ۲۰ ثانیه صداش می‌زند معطل نماند.
    non_quote_assets = [b["asset"] for b in result if b["asset"] != config.quote_asset]
    prices: dict = {}
    if non_quote_assets:
        with ThreadPoolExecutor(max_workers=min(10, len(non_quote_assets))) as executor:
            future_to_asset = {
                executor.submit(exchange.get_current_price, f"{asset}_{config.quote_asset}"): asset
                for asset in non_quote_assets
            }
            for future in as_completed(future_to_asset):
                asset = future_to_asset[future]
                try:
                    prices[asset] = future.result()
                except Exception:
                    prices[asset] = None

    total_value = 0.0
    for balance in result:
        asset = balance["asset"]
        amount = balance["free"] + balance["locked"]

        if asset == config.quote_asset:
            value = amount
        else:
            price = prices.get(asset)
            value = amount * price if price is not None else None

        balance["value"] = value
        if value is not None:
            total_value += value

    return jsonify({"balances": result, "quote_asset": config.quote_asset, "total_value": total_value})


@app.route("/api/performance", methods=["GET"])
def performance():
    journal = TradeJournal(TRADE_HISTORY_PATH)
    return jsonify(journal.summary())


@app.route("/api/logs", methods=["GET"])
def logs():
    if not os.path.exists(LOG_PATH):
        return jsonify({"lines": []})

    with open(LOG_PATH, "r", encoding="utf-8") as f:
        lines = f.readlines()

    return jsonify({"lines": lines[-200:]})


def _maybe_auto_start() -> None:
    """
    اگر AUTO_START=true باشد، همین لحظه که سرور بالا می‌آید (مثلا با
    run.sh موقع بوت گوشی از طریق Termux:Boot) ربات را بدون نیاز به کلیک
    دستی روی دکمه «شروع» در داشبورد راه می‌اندازد. خطاها فقط لاگ می‌شوند
    تا خود سرور وب هیچ‌وقت به‌خاطر این قابلیت بالا نیاید.
    """
    try:
        config = Config.load(ENV_PATH)
    except ConfigError as exc:
        logger.warning("AUTO_START رد شد: تنظیمات نامعتبر (%s)", exc)
        return

    if not config.auto_start:
        return

    try:
        runner.start(config)
        logger.info(
            "AUTO_START فعال بود: ربات بدون نیاز به کلیک دستی خودش شروع به کار کرد (حالت=%s).",
            "DRY-RUN" if config.dry_run else "LIVE",
        )
    except RuntimeError:
        pass


if __name__ == "__main__":
    print("=" * 70)
    print("داشبورد فقط روی 127.0.0.1 (لوکال) در دسترس است.")
    print("هرگز این پورت را روی 0.0.0.0 یا اینترنت باز نکنید مگر احراز هویت اضافه کنید.")
    print("آدرس: http://127.0.0.1:5000")
    print("=" * 70)
    _maybe_auto_start()
    # threaded=True: تا وقتی داشبورد چند درخواست هم‌زمان می‌زند (وضعیت،
    # موجودی، لاگ)، منتظر تمام شدن یکی برای شروع بعدی نماند. ربات معاملاتی
    # خودش از قبل روی یک ترد کاملا جدا اجرا می‌شود، پس این تنظیم فقط روی
    # واکنش‌گویی خود داشبورد اثر دارد، نه سرعت تصمیم‌گیری/معامله‌ی ربات.
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)

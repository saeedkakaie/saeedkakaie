import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from flask import Flask, jsonify, render_template, request  # noqa: E402

from src.config import Config, ConfigError  # noqa: E402
from src.logger_setup import setup_logger  # noqa: E402
from webapp.bot_runner import BotRunner  # noqa: E402
from webapp.env_writer import read_env_file, update_env_file  # noqa: E402

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, ".env")
ENV_EXAMPLE_PATH = os.path.join(BASE_DIR, ".env.example")
LOG_PATH = os.path.join(BASE_DIR, "logs", "bot.log")

if not os.path.exists(ENV_PATH) and os.path.exists(ENV_EXAMPLE_PATH):
    with open(ENV_EXAMPLE_PATH, "r", encoding="utf-8") as src, open(ENV_PATH, "w", encoding="utf-8") as dst:
        dst.write(src.read())

setup_logger("INFO")

app = Flask(__name__)
runner = BotRunner()

FORM_FIELDS = [
    "QUOTE_ASSET",
    "WATCHLIST_SIZE",
    "WATCHLIST_REFRESH_MINUTES",
    "MAX_CONCURRENT_POSITIONS",
    "QUOTE_ORDER_AMOUNT",
    "QUANTITY_PRECISION",
    "STOP_LOSS_PERCENT",
    "TAKE_PROFIT_PERCENT",
    "MAX_DAILY_LOSS_PERCENT",
    "MAX_TRADES_PER_DAY",
    "SMA_FAST_PERIOD",
    "SMA_SLOW_PERIOD",
    "POLL_INTERVAL_SECONDS",
    "DRY_RUN",
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
            if field == "DRY_RUN":
                value = "true" if str(value).lower() in ("true", "1", "on") else "false"
            updates[field] = value

    if payload.get("TABDEAL_API_KEY"):
        updates["TABDEAL_API_KEY"] = payload["TABDEAL_API_KEY"].strip()
    if payload.get("TABDEAL_API_SECRET"):
        updates["TABDEAL_API_SECRET"] = payload["TABDEAL_API_SECRET"].strip()

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


@app.route("/api/logs", methods=["GET"])
def logs():
    if not os.path.exists(LOG_PATH):
        return jsonify({"lines": []})

    with open(LOG_PATH, "r", encoding="utf-8") as f:
        lines = f.readlines()

    return jsonify({"lines": lines[-200:]})


if __name__ == "__main__":
    print("=" * 70)
    print("داشبورد فقط روی 127.0.0.1 (لوکال) در دسترس است.")
    print("هرگز این پورت را روی 0.0.0.0 یا اینترنت باز نکنید مگر احراز هویت اضافه کنید.")
    print("آدرس: http://127.0.0.1:5000")
    print("=" * 70)
    app.run(host="127.0.0.1", port=5000, debug=False)

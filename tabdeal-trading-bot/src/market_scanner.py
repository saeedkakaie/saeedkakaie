import logging
from typing import Dict, List

logger = logging.getLogger("tabdeal_bot")

# اگر دریافت لیست نمادها از API به هر دلیل شکست بخورد، ربات با همین چند
# نماد شناخته‌شده کار می‌کند تا کاملا متوقف نشود.
FALLBACK_SYMBOLS = ["BTC_IRT", "ETH_IRT", "USDT_IRT"]

# تعداد نماد در watchlist دیگر تنظیم دستی کاربر نیست: چون قیمت هر نماد در
# هر چرخه به‌صورت متوالی (نه موازی) از API خوانده می‌شود، لیست خیلی بزرگ
# باعث کند شدن هر چرخه و ریسک برخورد به rate limit تبدیل می‌شود. این عدد
# مصالحه‌ای بین پوشش بازار و پایداری/سرعت است.
DEFAULT_WATCHLIST_SIZE = 40


def _extract_symbol(entry: dict) -> str:
    return entry.get("tabdealSymbol") or entry.get("symbol") or entry.get("name") or ""


def _extract_quote_asset(entry: dict) -> str:
    return str(
        entry.get("quoteAsset") or entry.get("quote_asset") or entry.get("quoteCurrency") or ""
    ).upper()


def _is_active(entry: dict) -> bool:
    status = entry.get("status")
    if status is None:
        return True
    return str(status).upper() in ("TRADING", "ACTIVE", "ENABLED", "1", "TRUE")


def _extract_entries(info) -> list:
    """
    exchange_info ممکن است مستقیما یک لیست از نمادها برگرداند، یا یک
    دیکشنری که لیست نمادها زیر یکی از کلیدهای رایج (symbols/data/result)
    قرار دارد. این تابع هر دو حالت را پشتیبانی می‌کند.
    """
    if isinstance(info, list):
        return info

    if isinstance(info, dict):
        for key in ("symbols", "data", "result", "results"):
            value = info.get(key)
            if isinstance(value, list):
                return value

    return []


def _estimate_activity(exchange, symbol: str) -> float:
    """
    چون در SDK رسمی endpoint مشخصی برای حجم ۲۴ ساعته وجود ندارد، این تابع
    از مجموع ارزش (قیمت × مقدار) آخرین معاملات هر نماد به‌عنوان معیار
    تقریبی فعالیت/نقدشوندگی استفاده می‌کند.
    """
    try:
        trades = exchange.client.trades(symbol=symbol, limit=20)
        total = 0.0
        for trade in trades:
            price = float(trade.get("price", 0) or 0)
            qty = float(trade.get("qty") or trade.get("quantity") or 0)
            total += price * qty
        return total
    except Exception:
        return 0.0


def discover_watchlist(exchange, quote_asset: str, size: int = DEFAULT_WATCHLIST_SIZE) -> List[str]:
    """
    لیست نمادهای فعال بازار را از exchange_info می‌خواند، به نمادهایی که
    با quote_asset (مثلا IRT) معامله می‌شوند فیلتر می‌کند، و پرفعالیت‌ترین‌ها
    را بر اساس ارزش آخرین معاملات برمی‌گرداند.
    """
    try:
        info = exchange.client.exchange_info()
        entries = _extract_entries(info)
    except Exception as exc:
        logger.error(
            "خطا در دریافت لیست نمادها از exchange_info (%s). از لیست پیش‌فرض استفاده می‌شود.", exc
        )
        return list(FALLBACK_SYMBOLS)

    candidates = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue

        symbol = _extract_symbol(entry)
        if not symbol or "_" not in symbol:
            continue

        _, _, quote = symbol.partition("_")
        quote_matches = quote.upper() == quote_asset.upper() or _extract_quote_asset(entry) == quote_asset.upper()

        if quote_matches and _is_active(entry):
            candidates.append(symbol)

    if not candidates:
        logger.warning(
            "هیچ نمادی با quote asset=%s در exchange_info پیدا نشد. از لیست پیش‌فرض استفاده می‌شود.",
            quote_asset,
        )
        return list(FALLBACK_SYMBOLS)

    scored = [(_estimate_activity(exchange, symbol), symbol) for symbol in candidates]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    watchlist = [symbol for _, symbol in scored[:size]]

    logger.info("لیست خودکار %s نماد پرفعالیت انتخاب شد: %s", len(watchlist), ", ".join(watchlist))
    return watchlist


def _precision_from_step_size(step_size: str) -> int:
    step_size = step_size.strip().rstrip("0")
    if "." not in step_size:
        return 0
    return len(step_size.split(".")[1])


def _extract_quantity_precision(entry: dict, default: int) -> int:
    """
    دقت اعشار مجاز مقدار (quantity) هر نماد را تلاش می‌کند از exchange_info
    استخراج کند. چون ساختار دقیق پاسخ تبدیل مستند نیست، چند فیلد رایج در
    APIهای سبک باینانس را امتحان می‌کند (مقدار مستقیم precision، یا
    stepSize داخل فیلتر LOT_SIZE)؛ اگر هیچ‌کدام پیدا نشد، مقدار پیش‌فرض
    را برمی‌گرداند.
    """
    for key in ("baseAssetPrecision", "quantityPrecision", "basePrecision", "amountPrecision"):
        if key in entry:
            try:
                return int(entry[key])
            except (TypeError, ValueError):
                pass

    filters = entry.get("filters")
    if isinstance(filters, list):
        for f in filters:
            if isinstance(f, dict) and f.get("filterType") in ("LOT_SIZE", "MARKET_LOT_SIZE"):
                step = f.get("stepSize")
                if step:
                    try:
                        return _precision_from_step_size(str(step))
                    except (TypeError, ValueError):
                        pass

    return default


def fetch_quantity_precisions(exchange, symbols: List[str], default_precision: int) -> Dict[str, int]:
    """
    برای لیست داده‌شده از نمادها، دقت اعشار مقدار هرکدام را جداگانه از
    exchange_info می‌خواند. اگر برای نمادی پیدا نشود یا کل درخواست شکست
    بخورد، از default_precision استفاده می‌شود (ربات هیچ‌وقت به‌خاطر این
    متوقف نمی‌شود). قبل از اعتماد کامل، با scripts/inspect_api.py مقادیر
    را برای نمادهای خودتان بررسی کنید.
    """
    fallback = {symbol: default_precision for symbol in symbols}

    try:
        info = exchange.client.exchange_info()
        entries = _extract_entries(info)
    except Exception as exc:
        logger.warning(
            "خطا در دریافت دقت اعشار نمادها (%s)، مقدار پیش‌فرض %s برای همه استفاده می‌شود.",
            exc,
            default_precision,
        )
        return fallback

    symbol_set = set(symbols)
    precisions = dict(fallback)

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        symbol = _extract_symbol(entry)
        if symbol in symbol_set:
            precisions[symbol] = _extract_quantity_precision(entry, default_precision)

    return precisions

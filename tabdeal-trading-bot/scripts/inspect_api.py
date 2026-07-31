"""
اسکریپت کمکی برای بررسی خروجی خام API تبدیل قبل از اجرای ربات.

هدف: چون ساختار دقیق پاسخ‌ها در مستندات پشت لاگین (docs.tabdeal.org) است،
این اسکریپت به شما کمک می‌کند مطمئن شوید فرضیات کد (ساختار exchange_info
برای کشف خودکار نمادها، depth، account balances) با پاسخ واقعی API
هم‌خوانی دارد.

اجرا:
    python scripts/inspect_api.py
"""

import json
import sys

sys.path.insert(0, ".")

from src.config import Config, ConfigError  # noqa: E402
from src.exchange_client import ExchangeClient  # noqa: E402
from src.market_scanner import (  # noqa: E402
    DEFAULT_WATCHLIST_SIZE,
    discover_watchlist,
    fetch_quantity_precisions,
    _extract_entries,
)


def pretty(label: str, data) -> None:
    print(f"\n=== {label} ===")
    print(json.dumps(data, indent=2, ensure_ascii=False, default=str))


def main() -> None:
    try:
        config = Config.load()
    except ConfigError as exc:
        print(f"خطا در تنظیمات: {exc}")
        sys.exit(1)

    exchange = ExchangeClient(config.api_key, config.api_secret, dry_run=True)
    client = exchange.client

    pretty("ping", client.ping())
    pretty("time", client.time())

    info = client.exchange_info()
    print(f"\n=== exchange_info: نوع پاسخ خام = {type(info).__name__} ===")
    symbols = _extract_entries(info)
    print(f"{len(symbols)} نماد یافت شد. نمونه‌ی ۳ تای اول:")
    print(json.dumps(symbols[:3], indent=2, ensure_ascii=False, default=str))
    print(
        "\nاگر ساختار بالا با فرض‌های src/market_scanner.py (کلیدهای "
        "tabdealSymbol/symbol و quoteAsset/quote_asset و status) فرق داشت، "
        "لطفا آن فایل را متناسب با پاسخ واقعی اصلاح کنید."
    )

    print(f"\n=== کشف خودکار watchlist (quote_asset={config.quote_asset}, size={DEFAULT_WATCHLIST_SIZE}) ===")
    watchlist = discover_watchlist(exchange, config.quote_asset)
    print(watchlist)

    print(f"\n=== دقت اعشار مقدار (quantity) هر نماد، پیش‌فرض={config.quantity_precision} ===")
    precisions = fetch_quantity_precisions(exchange, watchlist, config.quantity_precision)
    for symbol in watchlist:
        print(f"  {symbol}: {precisions.get(symbol, config.quantity_precision)}")
    print(
        "\nاگر این عددها با فیلترهای واقعی exchange_info (بخش نمونه‌ی ۳ تای بالا) "
        "همخوانی نداشت، src/market_scanner.py::_extract_quantity_precision را متناسب با "
        "فیلد واقعی اصلاح کنید."
    )

    if watchlist:
        sample = watchlist[0]
        pretty(f"depth({sample})", client.depth(symbol=sample, limit=5))
        pretty(f"trades({sample})", client.trades(symbol=sample, limit=3))

    if config.api_key and config.api_secret:
        pretty("account", exchange._get_account())
    else:
        print("\nAPI key/secret تنظیم نشده، بخش account() رد شد.")


if __name__ == "__main__":
    main()

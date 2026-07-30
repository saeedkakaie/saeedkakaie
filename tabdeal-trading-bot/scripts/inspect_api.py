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
from src.market_scanner import discover_watchlist  # noqa: E402


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
    symbols = info.get("symbols") or info.get("data") or []
    print(f"\n=== exchange_info: {len(symbols)} نماد یافت شد. نمونه‌ی ۳ تای اول: ===")
    print(json.dumps(symbols[:3], indent=2, ensure_ascii=False, default=str))
    print(
        "\nاگر ساختار بالا با فرض‌های src/market_scanner.py (کلیدهای "
        "tabdealSymbol/symbol و quoteAsset/quote_asset و status) فرق داشت، "
        "لطفا آن فایل را متناسب با پاسخ واقعی اصلاح کنید."
    )

    print(f"\n=== کشف خودکار watchlist (quote_asset={config.quote_asset}, size={config.watchlist_size}) ===")
    watchlist = discover_watchlist(exchange, config.quote_asset, config.watchlist_size)
    print(watchlist)

    if watchlist:
        sample = watchlist[0]
        pretty(f"depth({sample})", client.depth(symbol=sample, limit=5))
        pretty(f"trades({sample})", client.trades(symbol=sample, limit=3))

    if config.api_key and config.api_secret:
        pretty("account", client.account())
    else:
        print("\nAPI key/secret تنظیم نشده، بخش account() رد شد.")


if __name__ == "__main__":
    main()

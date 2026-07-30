"""
اسکریپت کمکی برای بررسی خروجی خام API تبدیل قبل از اجرای ربات.

هدف: چون ساختار دقیق پاسخ‌ها در مستندات پشت لاگین (docs.tabdeal.org) است،
این اسکریپت به شما کمک می‌کند مطمئن شوید فرضیات کد (مثل ساختار depth،
account balances و دقت اعشار quantity) با پاسخ واقعی API هم‌خوانی دارد.

اجرا:
    python scripts/inspect_api.py
"""

import json
import sys

sys.path.insert(0, ".")

from src.config import Config, ConfigError  # noqa: E402
from tabdeal.spot import Spot  # noqa: E402


def pretty(label: str, data) -> None:
    print(f"\n=== {label} ===")
    print(json.dumps(data, indent=2, ensure_ascii=False, default=str))


def main() -> None:
    try:
        config = Config.load()
    except ConfigError as exc:
        print(f"خطا در تنظیمات: {exc}")
        sys.exit(1)

    client = Spot(config.api_key, config.api_secret)

    pretty("ping", client.ping())
    pretty("time", client.time())
    pretty(f"exchange_info({config.symbol})", client.exchange_info(symbol=config.symbol))
    pretty(f"depth({config.symbol})", client.depth(symbol=config.symbol, limit=5))
    pretty(f"trades({config.symbol})", client.trades(symbol=config.symbol, limit=3))

    if config.api_key and config.api_secret:
        pretty("account", client.account())
    else:
        print("\nAPI key/secret تنظیم نشده، بخش account() رد شد.")


if __name__ == "__main__":
    main()

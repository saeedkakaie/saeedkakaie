"""
بررسی این‌که آیا سرور واقعی تبدیل (نه فقط SDK پایتون) یک endpoint عمومی
برای داده‌ی کندل/تاریخچه‌ی قیمت (kline) دارد یا نه.

چرا لازم است: SDK رسمی tabdeal-python هیچ متدی برای کندل/تاریخچه ندارد
(فقط قیمت لحظه‌ای، سفارش‌ها). ولی چون این صرافی از الگوی باینانس پیروی
می‌کند (همان‌طور که ساختار پاسخ سفارش‌ها هم نشان داد)، ممکن است سرور خودش
یک endpoint عمومی (بدون نیاز به کلید API) برای کندل داشته باشد که فقط
توی SDK پایتون wrap نشده باشد. این اسکریپت چند نام endpoint رایج در
صرافی‌های سبک باینانس را امتحان می‌کند.

⚠️ این کاملا اکتشافی است و مستندات رسمی‌اش را ندیده‌ام (docs.tabdeal.org
پشت لاگین است) — فقط برای این است که ببینیم اصلا امکانش هست یا نه.

اجرا:
    python scripts/check_klines_endpoint.py
"""

import json
import sys

sys.path.insert(0, ".")

from tabdeal.enums import RequestTypes, SecurityTypes  # noqa: E402
from tabdeal.spot import Spot  # noqa: E402

CANDIDATE_URLS = ["klines", "candles", "candlesticks", "kline"]
CANDIDATE_INTERVALS = ["1h", "1d"]


def main() -> None:
    client = Spot()  # بدون کلید API؛ این‌ها باید عمومی/بدون احراز هویت باشند

    symbol = sys.argv[1] if len(sys.argv) > 1 else "BTC_IRT"
    print(f"نماد آزمایشی: {symbol}\n")

    found_any = False
    for url in CANDIDATE_URLS:
        for interval in CANDIDATE_INTERVALS:
            data = {"symbol": symbol.replace("_", ""), "interval": interval, "limit": 5}
            try:
                response = client.request(
                    url=url,
                    method=RequestTypes.GET,
                    security_type=SecurityTypes.NONE,
                    data=data,
                )
                print(f"✅ موفق: url='{url}' interval='{interval}'")
                print(json.dumps(response, indent=2, ensure_ascii=False, default=str)[:1500])
                print()
                found_any = True
            except Exception as exc:
                print(f"❌ ناموفق: url='{url}' interval='{interval}' -> {exc}")

    print()
    if found_any:
        print("حداقل یک endpoint جواب داد! این خروجی رو کپی کن بفرست تا بررسی کنم و بک‌تست رو باهاش بسازم.")
    else:
        print(
            "هیچ‌کدوم از نام‌های رایج جواب نداد. یعنی به‌احتمال زیاد این صرافی endpoint عمومی "
            "کندل نداره، و باید همون مسیر جمع‌آوری تدریجی (data/price_ticks + scripts/backtest.py) رو ادامه بدیم."
        )


if __name__ == "__main__":
    main()

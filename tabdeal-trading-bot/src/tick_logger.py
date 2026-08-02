import json
import os
from datetime import date, datetime


class TickLogger:
    """
    هر قیمتی که ربات در هر چرخه برای هر نماد می‌خواند را روی دیسک ثبت
    می‌کند (JSON Lines)، جدا از تاریخچه‌ی معاملات بسته‌شده. هدف: ساختن یک
    مجموعه‌داده‌ی قیمت واقعی (نه شبیه‌سازی مصنوعی) که بعدا با
    scripts/backtest.py بتوان دقیقا همین استراتژی را رویش بازپخش کرد و
    نرخ برد/انتظار واقعی را قبل از ریسک کردن پول واقعی سنجید.

    فایل‌ها روزانه چرخش می‌کنند (یک فایل به‌ازای هر روز) تا حجم دیسک روی
    گوشی قابل مدیریت بماند؛ اگر جایی کم آوردید، فایل‌های قدیمی‌تر را
    می‌توانید بدون اثر روی کارکرد ربات پاک کنید.
    """

    def __init__(self, directory: str):
        self.directory = directory
        os.makedirs(self.directory, exist_ok=True)

    def _path_for(self, day: date) -> str:
        return os.path.join(self.directory, f"{day.isoformat()}.jsonl")

    def log(self, symbol: str, price: float) -> None:
        now = datetime.now()
        record = {"timestamp": now.isoformat(), "symbol": symbol, "price": price}
        with open(self._path_for(now.date()), "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    def load_all(self) -> dict:
        """
        همه‌ی رکوردهای ثبت‌شده را می‌خواند و بر اساس نماد گروه‌بندی و بر
        اساس زمان مرتب می‌کند: {symbol: [(timestamp_str, price), ...]}.
        فایل‌های خراب/ناقص (مثلا به‌خاطر قطع برق وسط نوشتن) نادیده گرفته
        می‌شوند، نه اینکه کل بارگذاری را متوقف کنند.
        """
        series: dict = {}
        if not os.path.isdir(self.directory):
            return series

        for filename in sorted(os.listdir(self.directory)):
            if not filename.endswith(".jsonl"):
                continue
            path = os.path.join(self.directory, filename)
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                        symbol = record["symbol"]
                        timestamp = record["timestamp"]
                        price = float(record["price"])
                    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                        continue
                    series.setdefault(symbol, []).append((timestamp, price))

        for symbol in series:
            series[symbol].sort(key=lambda item: item[0])

        return series

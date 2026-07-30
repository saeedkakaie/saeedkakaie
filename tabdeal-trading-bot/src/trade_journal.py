import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import List


@dataclass
class ClosedTrade:
    timestamp: str
    symbol: str
    entry_price: float
    exit_price: float
    quantity: float
    gross_pnl_percent: float
    net_pnl_percent: float
    net_pnl_amount: float


class TradeJournal:
    """
    تاریخچه‌ی سبک معاملات بسته‌شده روی دیسک (JSON Lines) برای محاسبه‌ی
    عملکرد روزانه/ماهانه/سالانه.

    توجه: عدد درصد هر دوره، مجموع ساده‌ی درصد سود/زیان تک‌تک معاملات آن
    دوره است (همان روشی که مدار قطع ضرر روزانه هم استفاده می‌کند)، نه
    بازده مرکب یا وزن‌دار سرمایه. برای یک ابزار شخصی سبک کافی است، ولی
    معادل «بازده پرتفوی» دقیق نیست.
    """

    def __init__(self, file_path: str):
        self.file_path = file_path
        directory = os.path.dirname(file_path)
        if directory:
            os.makedirs(directory, exist_ok=True)

    def record(self, trade: ClosedTrade) -> None:
        with open(self.file_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(trade), ensure_ascii=False) + "\n")

    def _load(self) -> List[dict]:
        if not os.path.exists(self.file_path):
            return []

        trades = []
        with open(self.file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    trades.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return trades

    @staticmethod
    def _matches_period(trade: dict, period: str, now: datetime) -> bool:
        try:
            ts = datetime.fromisoformat(trade["timestamp"])
        except (KeyError, ValueError):
            return False

        if period == "day":
            return ts.date() == now.date()
        if period == "month":
            return ts.year == now.year and ts.month == now.month
        if period == "year":
            return ts.year == now.year
        return True

    def summary(self, now: datetime = None) -> dict:
        now = now or datetime.now()
        trades = self._load()

        result = {}
        for period in ("day", "month", "year", "all_time"):
            filtered = [t for t in trades if self._matches_period(t, period, now)]
            result[period] = {
                "trades": len(filtered),
                "net_pnl_percent": sum(t.get("net_pnl_percent", 0) for t in filtered),
                "net_pnl_amount": sum(t.get("net_pnl_amount", 0) for t in filtered),
            }
        return result

import json
import logging
import os
from typing import Dict

from src.position import Position

logger = logging.getLogger("tabdeal_bot")


class PositionStore:
    """
    ذخیره‌ی پوزیشن‌های باز روی دیسک (JSON) تا با ری‌استارت ربات (آپدیت
    کد، قطع شدن گوشی، کشته‌شدن Termux) از دست نروند.

    بدون این: هر بار پردازش دوباره اجرا شود، self.positions خالی
    می‌شود؛ یعنی هم حد ضرر/سود پوزیشن‌های واقعاً باز دیگر چک نمی‌شود، هم
    MAX_CONCURRENT_POSITIONS دیگر تعداد واقعی پوزیشن‌های باز را نمی‌داند
    و اجازه می‌دهد باز هم بیشتر از سقف مجاز خرید انجام شود.
    """

    def __init__(self, file_path: str):
        self.file_path = file_path
        directory = os.path.dirname(file_path)
        if directory:
            os.makedirs(directory, exist_ok=True)

    def load(self) -> Dict[str, Position]:
        if not os.path.exists(self.file_path):
            return {}

        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            positions = {symbol: Position(**fields) for symbol, fields in raw.items()}
            if positions:
                logger.info(
                    "پوزیشن‌های باز قبلی از دیسک بازیابی شد: %s", ", ".join(positions.keys())
                )
            return positions
        except Exception as exc:
            logger.error(
                "خواندن فایل پوزیشن‌های باز (%s) ممکن نشد: %s. خالی در نظر گرفته می‌شود.",
                self.file_path,
                exc,
            )
            return {}

    def save(self, positions: Dict[str, Position]) -> None:
        try:
            raw = {
                symbol: {
                    "entry_price": position.entry_price,
                    "quantity": position.quantity,
                    "stop_loss_percent": position.stop_loss_percent,
                    "take_profit_percent": position.take_profit_percent,
                }
                for symbol, position in positions.items()
            }
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump(raw, f, ensure_ascii=False, indent=2)
        except Exception as exc:
            logger.error("ذخیره فایل پوزیشن‌های باز ممکن نشد: %s", exc)

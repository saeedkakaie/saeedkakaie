import logging
from datetime import date

from src.notifier import notify
from src.position import Position

logger = logging.getLogger("tabdeal_bot")


class RiskManager:
    """
    مسئول جلوگیری از ضررهای بزرگ:
    - حد ضرر خودکار (stop-loss) و حد سود (take-profit) روی هر پوزیشن
    - مدار قطع (circuit breaker) روی حداکثر ضرر مجاز روزانه

    تعداد و مبلغ معاملات دیگر سقف دستی ندارند؛ ربات با اختیار کامل بر
    اساس سیگنال و موجودی آزاد تصمیم می‌گیرد. تنها مرز باقی‌مانده مدار قطع
    ضرر روزانه است: اگر مجموع ضرر تجمعی امروز از max_daily_loss_percent
    عبور کند، ربات تا فردا پوزیشن جدید باز نمی‌کند.
    """

    def __init__(
        self,
        stop_loss_percent: float,
        take_profit_percent: float,
        max_daily_loss_percent: float,
    ):
        self.stop_loss_percent = stop_loss_percent
        self.take_profit_percent = take_profit_percent
        self.max_daily_loss_percent = max_daily_loss_percent

        self._trades_today = 0
        self._daily_pnl_percent = 0.0
        self._current_day = date.today()
        self._halted = False

    def _reset_if_new_day(self) -> None:
        today = date.today()
        if today != self._current_day:
            logger.info("روز جدید شروع شد، شمارنده‌های ریسک روزانه بازنشانی شدند.")
            self._current_day = today
            self._trades_today = 0
            self._daily_pnl_percent = 0.0
            self._halted = False

    def can_open_new_position(self) -> bool:
        self._reset_if_new_day()

        if self._halted:
            logger.warning("ربات متوقف است: حد ضرر روزانه فعال شده.")
            return False

        return True

    def should_close_position(self, position: Position, current_price: float) -> bool:
        """
        حد ضرر/سود مخصوص همین پوزیشن را بررسی می‌کند (که ممکن است در لحظه‌ی
        باز شدن به‌صورت پویا بر اساس نوسان بازار محاسبه شده باشد، نه
        مقادیر ثابت تنظیمات).
        """
        pnl_percent = position.unrealized_pnl_percent(current_price)

        if pnl_percent <= -abs(position.stop_loss_percent):
            logger.info("حد ضرر فعال شد: %.2f%% <= -%.2f%%", pnl_percent, position.stop_loss_percent)
            return True

        if pnl_percent >= abs(position.take_profit_percent):
            logger.info("حد سود فعال شد: %.2f%% >= %.2f%%", pnl_percent, position.take_profit_percent)
            return True

        return False

    def register_closed_trade(self, pnl_percent: float) -> None:
        self._reset_if_new_day()
        self._trades_today += 1
        self._daily_pnl_percent += pnl_percent

        if not self._halted and self._daily_pnl_percent <= -abs(self.max_daily_loss_percent):
            self._halted = True
            logger.error(
                "مدار قطع فعال شد! ضرر تجمعی امروز %.2f%% از حد مجاز %.2f%% عبور کرد. "
                "ربات تا فردا معامله جدید باز نمی‌کند.",
                self._daily_pnl_percent,
                self.max_daily_loss_percent,
            )
            notify(
                "🛑 مدار قطع ضرر روزانه فعال شد",
                f"ضرر تجمعی امروز {self._daily_pnl_percent:.2f}% از حد مجاز {self.max_daily_loss_percent:.2f}% "
                "عبور کرد. ربات تا فردا پوزیشن جدید باز نمی‌کند.",
            )

    def restore_daily_state(self, trades_today: int, daily_pnl_percent: float) -> None:
        """
        بعد از هر ری‌استارت پردازش (آپدیت کد، کشته‌شدن Termux، کرش)، یک
        RiskManager کاملا تازه با شمارنده‌های صفر ساخته می‌شود. بدون این
        متد، اگر مدار قطع ضرر روزانه قبل از ری‌استارت فعال شده باشد، صرف
        همان ری‌استارت بی‌سروصدا خاموشش می‌کند و ربات دوباره اجازه‌ی باز
        کردن پوزیشن جدید پیدا می‌کند — درست همان روزی که نباید. با فراخوانی
        این متد بلافاصله بعد از ساخت (با اعداد واقعی امروز از TradeJournal
        که روی دیسک ذخیره شده، نه یک شمارنده‌ی فقط-حافظه‌ای)، وضعیت درست
        بازسازی می‌شود.
        """
        self._reset_if_new_day()
        self._trades_today = trades_today
        self._daily_pnl_percent = daily_pnl_percent

        if not self._halted and self._daily_pnl_percent <= -abs(self.max_daily_loss_percent):
            self._halted = True
            logger.error(
                "بعد از بازسازی وضعیت روزانه، مدار قطع همچنان فعال است! ضرر تجمعی امروز "
                "%.2f%% از حد مجاز %.2f%% عبور کرده. ربات تا فردا معامله جدید باز نمی‌کند.",
                self._daily_pnl_percent,
                self.max_daily_loss_percent,
            )
            notify(
                "🛑 مدار قطع ضرر روزانه (بعد از ری‌استارت) فعال است",
                f"ضرر تجمعی امروز {self._daily_pnl_percent:.2f}% از حد مجاز "
                f"{self.max_daily_loss_percent:.2f}% عبور کرده. ربات تا فردا پوزیشن جدید باز نمی‌کند.",
            )

    @property
    def is_halted(self) -> bool:
        return self._halted

    @property
    def trades_today(self) -> int:
        return self._trades_today

    @property
    def daily_pnl_percent(self) -> float:
        return self._daily_pnl_percent

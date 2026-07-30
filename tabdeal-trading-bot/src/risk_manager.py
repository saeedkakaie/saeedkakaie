import logging
from datetime import date

from src.position import Position

logger = logging.getLogger("tabdeal_bot")


class RiskManager:
    """
    مسئول جلوگیری از ضررهای بزرگ:
    - حد ضرر خودکار (stop-loss) و حد سود (take-profit) روی هر پوزیشن
    - محدودیت تعداد معامله در روز
    - مدار قطع (circuit breaker) روی حداکثر ضرر مجاز روزانه
    """

    def __init__(
        self,
        stop_loss_percent: float,
        take_profit_percent: float,
        max_daily_loss_percent: float,
        max_trades_per_day: int,
    ):
        self.stop_loss_percent = stop_loss_percent
        self.take_profit_percent = take_profit_percent
        self.max_daily_loss_percent = max_daily_loss_percent
        self.max_trades_per_day = max_trades_per_day

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

        if self._trades_today >= self.max_trades_per_day:
            logger.warning("سقف تعداد معامله در روز (%s) پر شده.", self.max_trades_per_day)
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

        if self._daily_pnl_percent <= -abs(self.max_daily_loss_percent):
            self._halted = True
            logger.error(
                "مدار قطع فعال شد! ضرر تجمعی امروز %.2f%% از حد مجاز %.2f%% عبور کرد. "
                "ربات تا فردا معامله جدید باز نمی‌کند.",
                self._daily_pnl_percent,
                self.max_daily_loss_percent,
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

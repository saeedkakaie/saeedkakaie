import logging
import threading
from dataclasses import asdict, dataclass, field
from typing import Optional

from src.bot import TradingBot
from src.config import Config
from src.exchange_client import ExchangeClient
from src.risk_manager import RiskManager
from src.strategy import SmaCrossoverStrategy

logger = logging.getLogger("tabdeal_bot")


@dataclass
class BotStatus:
    running: bool = False
    dry_run: bool = True
    symbol: str = ""
    last_price: Optional[float] = None
    last_signal: Optional[str] = None
    position_entry_price: Optional[float] = None
    position_quantity: Optional[float] = None
    position_pnl_percent: Optional[float] = None
    trades_today: int = 0
    daily_pnl_percent: float = 0.0
    halted: bool = False
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


class BotRunner:
    """
    اجرای TradingBot در یک ترد پس‌زمینه با قابلیت start/stop از طریق وب،
    و نگهداری آخرین وضعیت به‌صورت thread-safe برای نمایش در داشبورد.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stop_event: Optional[threading.Event] = None
        self._status = BotStatus()

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._thread is not None and self._thread.is_alive()

    def get_status(self) -> dict:
        with self._lock:
            status = self._status
            status.running = self._thread is not None and self._thread.is_alive()
            return status.to_dict()

    def start(self, config: Config) -> None:
        if self.is_running:
            raise RuntimeError("ربات از قبل در حال اجراست.")

        exchange = ExchangeClient(
            api_key=config.api_key,
            api_secret=config.api_secret,
            symbol=config.symbol,
            dry_run=config.dry_run,
        )
        strategy = SmaCrossoverStrategy(
            fast_period=config.sma_fast_period,
            slow_period=config.sma_slow_period,
        )
        risk_manager = RiskManager(
            stop_loss_percent=config.stop_loss_percent,
            take_profit_percent=config.take_profit_percent,
            max_daily_loss_percent=config.max_daily_loss_percent,
            max_trades_per_day=config.max_trades_per_day,
        )
        bot = TradingBot(
            exchange=exchange,
            strategy=strategy,
            risk_manager=risk_manager,
            quote_order_amount=config.quote_order_amount,
            quantity_precision=config.quantity_precision,
            poll_interval_seconds=config.poll_interval_seconds,
        )

        with self._lock:
            self._status = BotStatus(running=True, dry_run=config.dry_run, symbol=config.symbol)
            self._stop_event = threading.Event()
            stop_event = self._stop_event

        def _run():
            try:
                bot.run_forever(stop_event=stop_event, on_tick=self._on_tick)
            except Exception as exc:
                logger.exception("ربات با خطا متوقف شد.")
                with self._lock:
                    self._status.error = str(exc)
                    self._status.running = False

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        with self._lock:
            stop_event = self._stop_event
        if stop_event is not None:
            stop_event.set()

    def _on_tick(self, bot: TradingBot) -> None:
        with self._lock:
            self._status.last_price = bot.last_price
            self._status.last_signal = bot.last_signal.value if bot.last_signal else None
            self._status.trades_today = bot.risk_manager.trades_today
            self._status.daily_pnl_percent = bot.risk_manager.daily_pnl_percent
            self._status.halted = bot.risk_manager.is_halted

            if bot.position is not None:
                self._status.position_entry_price = bot.position.entry_price
                self._status.position_quantity = bot.position.quantity
                self._status.position_pnl_percent = (
                    bot.position.unrealized_pnl_percent(bot.last_price) if bot.last_price else None
                )
            else:
                self._status.position_entry_price = None
                self._status.position_quantity = None
                self._status.position_pnl_percent = None

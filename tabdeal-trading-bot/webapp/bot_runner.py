import logging
import os
import threading
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional

from src.bot import TradingBot
from src.config import Config
from src.exchange_client import ExchangeClient
from src.news_filter import NewsFilter
from src.pnl import net_pnl_percent, pnl_amount
from src.risk_manager import RiskManager
from src.strategy import TechnicalStrategy
from src.trade_journal import TradeJournal

logger = logging.getLogger("tabdeal_bot")


@dataclass
class BotStatus:
    running: bool = False
    dry_run: bool = True
    watchlist: List[str] = field(default_factory=list)
    prices: Dict[str, float] = field(default_factory=dict)
    signals: Dict[str, str] = field(default_factory=dict)
    positions: Dict[str, dict] = field(default_factory=dict)
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
            dry_run=config.dry_run,
        )

        news_filter = NewsFilter(
            api_token=config.cryptopanic_api_token if config.news_enabled else None,
            cache_minutes=config.news_cache_minutes,
        )

        def strategy_factory(symbol: str):
            return TechnicalStrategy(symbol=symbol, news_filter=news_filter)

        risk_manager = RiskManager(
            stop_loss_percent=config.stop_loss_percent,
            take_profit_percent=config.take_profit_percent,
            max_daily_loss_percent=config.max_daily_loss_percent,
            max_trades_per_day=config.max_trades_per_day,
        )
        trade_journal = TradeJournal(os.path.join("data", "trade_history.jsonl"))

        bot = TradingBot(
            exchange=exchange,
            strategy_factory=strategy_factory,
            risk_manager=risk_manager,
            quote_asset=config.quote_asset,
            watchlist_size=config.watchlist_size,
            watchlist_refresh_minutes=config.watchlist_refresh_minutes,
            quote_order_amount=config.quote_order_amount,
            quantity_precision=config.quantity_precision,
            max_concurrent_positions=config.max_concurrent_positions,
            poll_interval_seconds=config.poll_interval_seconds,
            fee_percent=config.trading_fee_percent,
            trade_journal=trade_journal,
        )

        with self._lock:
            self._status = BotStatus(running=True, dry_run=config.dry_run)
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
            self._status.watchlist = list(bot.watchlist)
            self._status.prices = dict(bot.last_price)
            self._status.signals = {
                symbol: signal.value for symbol, signal in bot.last_signal.items()
            }
            self._status.trades_today = bot.risk_manager.trades_today
            self._status.daily_pnl_percent = bot.risk_manager.daily_pnl_percent
            self._status.halted = bot.risk_manager.is_halted

            positions = {}
            for symbol, position in bot.positions.items():
                current_price = bot.last_price.get(symbol)
                net_percent = None
                net_amount = None
                if current_price:
                    gross_percent = position.unrealized_pnl_percent(current_price)
                    net_percent = net_pnl_percent(gross_percent, bot.fee_percent)
                    net_amount = pnl_amount(position.entry_price, position.quantity, net_percent)

                positions[symbol] = {
                    "entry_price": position.entry_price,
                    "quantity": position.quantity,
                    "stop_price": position.stop_price,
                    "target_price": position.target_price,
                    "stop_loss_percent": position.stop_loss_percent,
                    "take_profit_percent": position.take_profit_percent,
                    "pnl_percent": net_percent,
                    "pnl_amount": net_amount,
                }
            self._status.positions = positions

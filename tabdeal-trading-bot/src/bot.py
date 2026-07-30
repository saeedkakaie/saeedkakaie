import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Callable, Dict, Optional

from src.exchange_client import ExchangeClient, ExchangeError
from src.market_scanner import discover_watchlist
from src.position import Position
from src.risk_manager import RiskManager
from src.strategy import Signal, Strategy

logger = logging.getLogger("tabdeal_bot")


class TradingBot:
    """
    ربات چندنمادی: به‌صورت خودکار پرفعالیت‌ترین نمادهای بازار را کشف می‌کند،
    هرکدام را جداگانه با یک نمونه استراتژی دنبال می‌کند، و می‌تواند هم‌زمان
    روی چند نماد پوزیشن باز داشته باشد (تا سقف max_concurrent_positions).
    """

    def __init__(
        self,
        exchange: ExchangeClient,
        strategy_factory: Callable[[], Strategy],
        risk_manager: RiskManager,
        quote_asset: str,
        watchlist_size: int,
        watchlist_refresh_minutes: int,
        quote_order_amount: float,
        quantity_precision: int,
        max_concurrent_positions: int,
        poll_interval_seconds: int,
    ):
        self.exchange = exchange
        self.strategy_factory = strategy_factory
        self.risk_manager = risk_manager
        self.quote_asset = quote_asset
        self.watchlist_size = watchlist_size
        self.watchlist_refresh_minutes = watchlist_refresh_minutes
        self.quote_order_amount = quote_order_amount
        self.quantity_precision = quantity_precision
        self.max_concurrent_positions = max_concurrent_positions
        self.poll_interval_seconds = poll_interval_seconds

        self.watchlist: list = []
        self.strategies: Dict[str, Strategy] = {}
        self.positions: Dict[str, Position] = {}
        self.last_price: Dict[str, float] = {}
        self.last_signal: Dict[str, Signal] = {}
        self._last_watchlist_refresh: Optional[datetime] = None

    def run_forever(
        self,
        stop_event: Optional[threading.Event] = None,
        on_tick: Optional[Callable[["TradingBot"], None]] = None,
    ) -> None:
        mode = "DRY-RUN (شبیه‌سازی)" if self.exchange.dry_run else "LIVE (معاملات واقعی)"
        logger.info(
            "ربات شروع به کار کرد. quote_asset=%s، سقف پوزیشن هم‌زمان=%s، حالت=%s",
            self.quote_asset,
            self.max_concurrent_positions,
            mode,
        )

        while stop_event is None or not stop_event.is_set():
            try:
                self._tick()
            except Exception:
                logger.exception("خطای پیش‌بینی‌نشده در چرخه معاملاتی، ادامه می‌دهیم.")

            if on_tick:
                try:
                    on_tick(self)
                except Exception:
                    logger.exception("خطا در callback وضعیت.")

            self._sleep_interruptible(stop_event)

        logger.info("ربات متوقف شد.")

    def _sleep_interruptible(self, stop_event: Optional[threading.Event]) -> None:
        if stop_event is None:
            time.sleep(self.poll_interval_seconds)
            return

        remaining = self.poll_interval_seconds
        while remaining > 0 and not stop_event.is_set():
            step = min(1, remaining)
            time.sleep(step)
            remaining -= step

    def _refresh_watchlist_if_needed(self) -> None:
        now = datetime.utcnow()
        if self._last_watchlist_refresh is not None:
            elapsed = now - self._last_watchlist_refresh
            if elapsed < timedelta(minutes=self.watchlist_refresh_minutes):
                return

        new_watchlist = discover_watchlist(self.exchange, self.quote_asset, self.watchlist_size)

        for symbol in new_watchlist:
            if symbol not in self.strategies:
                self.strategies[symbol] = self.strategy_factory()

        self.watchlist = new_watchlist
        self._last_watchlist_refresh = now

    def _tick(self) -> None:
        self._refresh_watchlist_if_needed()

        # نمادهایی که پوزیشن باز روی آن‌ها داریم را حتی اگر از لیست خودکار
        # خارج شده باشند همچنان دنبال می‌کنیم تا پوزیشن بدون مدیریت نماند.
        symbols_to_check = set(self.watchlist) | set(self.positions.keys())

        for symbol in symbols_to_check:
            try:
                self._tick_symbol(symbol)
            except ExchangeError as exc:
                logger.error("خطای صرافی برای %s: %s", symbol, exc)
            except Exception:
                logger.exception("خطای پیش‌بینی‌نشده برای %s", symbol)

    def _tick_symbol(self, symbol: str) -> None:
        price = self.exchange.get_current_price(symbol)
        strategy = self.strategies.setdefault(symbol, self.strategy_factory())
        signal = strategy.update(price)

        self.last_price[symbol] = price
        self.last_signal[symbol] = signal

        position = self.positions.get(symbol)
        if position is not None:
            self._manage_open_position(symbol, position, price, signal)
        elif signal == Signal.BUY:
            self._try_open_position(symbol, price)

    def _try_open_position(self, symbol: str, price: float) -> None:
        if len(self.positions) >= self.max_concurrent_positions:
            logger.debug("سقف پوزیشن هم‌زمان (%s) پر است، سیگنال %s نادیده گرفته شد.", self.max_concurrent_positions, symbol)
            return

        if not self.risk_manager.can_open_new_position():
            return

        order = self.exchange.buy_market(symbol, self.quote_order_amount, self.quantity_precision)
        if not order:
            return

        self.positions[symbol] = Position(entry_price=float(order["price"]), quantity=float(order["quantity"]))
        logger.info(
            "پوزیشن باز شد (%s): قیمت ورود=%s، مقدار=%s، تعداد پوزیشن‌های باز=%s",
            symbol,
            self.positions[symbol].entry_price,
            self.positions[symbol].quantity,
            len(self.positions),
        )

    def _manage_open_position(self, symbol: str, position: Position, price: float, signal: Signal) -> None:
        should_close = self.risk_manager.should_close_position(position, price) or signal == Signal.SELL

        if not should_close:
            logger.debug(
                "پوزیشن باز (%s)، قیمت=%s، سود/زیان=%.2f%%",
                symbol,
                price,
                position.unrealized_pnl_percent(price),
            )
            return

        order = self.exchange.sell_market(symbol, position.quantity)
        if not order:
            return

        pnl_percent = position.unrealized_pnl_percent(float(order["price"]))
        logger.info("پوزیشن بسته شد (%s): قیمت خروج=%s، سود/زیان=%.2f%%", symbol, order["price"], pnl_percent)

        self.risk_manager.register_closed_trade(pnl_percent)
        del self.positions[symbol]

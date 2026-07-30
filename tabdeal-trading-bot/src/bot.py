import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Callable, Dict, Optional

from src.exchange_client import ExchangeClient, ExchangeError
from src.market_scanner import discover_watchlist, fetch_quantity_precisions
from src.pnl import net_pnl_percent, pnl_amount
from src.position import Position
from src.risk_manager import RiskManager
from src.strategy import Signal, Strategy
from src.trade_journal import ClosedTrade, TradeJournal

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
        strategy_factory: Callable[[str], Strategy],
        risk_manager: RiskManager,
        quote_asset: str,
        watchlist_size: int,
        watchlist_refresh_minutes: int,
        quote_order_amount: float,
        default_quantity_precision: int,
        max_concurrent_positions: int,
        poll_interval_seconds: int,
        fee_percent: float = 0.0,
        trade_journal: Optional[TradeJournal] = None,
    ):
        self.exchange = exchange
        self.strategy_factory = strategy_factory
        self.risk_manager = risk_manager
        self.quote_asset = quote_asset
        self.watchlist_size = watchlist_size
        self.watchlist_refresh_minutes = watchlist_refresh_minutes
        self.quote_order_amount = quote_order_amount
        self.default_quantity_precision = default_quantity_precision
        self.max_concurrent_positions = max_concurrent_positions
        self.poll_interval_seconds = poll_interval_seconds
        self.fee_percent = fee_percent
        self.trade_journal = trade_journal

        self.watchlist: list = []
        self.strategies: Dict[str, Strategy] = {}
        self.positions: Dict[str, Position] = {}
        self.last_price: Dict[str, float] = {}
        self.last_signal: Dict[str, Signal] = {}
        self.symbol_precisions: Dict[str, int] = {}
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
                self.strategies[symbol] = self.strategy_factory(symbol)

        symbols_needing_precision = list(set(new_watchlist) | set(self.positions.keys()))
        self.symbol_precisions.update(
            fetch_quantity_precisions(self.exchange, symbols_needing_precision, self.default_quantity_precision)
        )

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
        strategy = self.strategies.setdefault(symbol, self.strategy_factory(symbol))
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

        quantity_precision = self.symbol_precisions.get(symbol, self.default_quantity_precision)
        order = self.exchange.buy_market(symbol, self.quote_order_amount, quantity_precision)
        if not order:
            return

        strategy = self.strategies.get(symbol)
        levels = strategy.suggested_risk_levels() if strategy else None
        if levels:
            stop_loss_percent, take_profit_percent = levels
        else:
            stop_loss_percent = self.risk_manager.stop_loss_percent
            take_profit_percent = self.risk_manager.take_profit_percent

        position = Position(
            entry_price=float(order["price"]),
            quantity=float(order["quantity"]),
            stop_loss_percent=stop_loss_percent,
            take_profit_percent=take_profit_percent,
        )
        self.positions[symbol] = position

        logger.info(
            "پوزیشن باز شد (%s): ورود=%s، مقدار=%s، حد ضرر=%.2f%% (قیمت %.4f)، "
            "حد سود=%.2f%% (قیمت %.4f)، تعداد پوزیشن‌های باز=%s",
            symbol,
            position.entry_price,
            position.quantity,
            stop_loss_percent,
            position.stop_price,
            take_profit_percent,
            position.target_price,
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

        exit_price = float(order["price"])
        gross_pnl_percent = position.unrealized_pnl_percent(exit_price)
        net_pnl = net_pnl_percent(gross_pnl_percent, self.fee_percent)
        net_amount = pnl_amount(position.entry_price, position.quantity, net_pnl)

        logger.info(
            "پوزیشن بسته شد (%s): خروج=%s، سود/زیان خام=%.2f%%، پس از کارمزد=%.2f%% (%.2f %s)",
            symbol,
            exit_price,
            gross_pnl_percent,
            net_pnl,
            net_amount,
            self.quote_asset,
        )

        self.risk_manager.register_closed_trade(net_pnl)

        if self.trade_journal:
            self.trade_journal.record(
                ClosedTrade(
                    timestamp=datetime.now().isoformat(),
                    symbol=symbol,
                    entry_price=position.entry_price,
                    exit_price=exit_price,
                    quantity=position.quantity,
                    gross_pnl_percent=gross_pnl_percent,
                    net_pnl_percent=net_pnl,
                    net_pnl_amount=net_amount,
                )
            )

        del self.positions[symbol]

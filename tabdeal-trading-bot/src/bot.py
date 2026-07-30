import logging
import time

from src.exchange_client import ExchangeClient, ExchangeError
from src.position import Position, PositionOrNone
from src.risk_manager import RiskManager
from src.strategy import Signal, Strategy

logger = logging.getLogger("tabdeal_bot")


class TradingBot:
    def __init__(
        self,
        exchange: ExchangeClient,
        strategy: Strategy,
        risk_manager: RiskManager,
        quote_order_amount: float,
        quantity_precision: int,
        poll_interval_seconds: int,
    ):
        self.exchange = exchange
        self.strategy = strategy
        self.risk_manager = risk_manager
        self.quote_order_amount = quote_order_amount
        self.quantity_precision = quantity_precision
        self.poll_interval_seconds = poll_interval_seconds
        self.position: PositionOrNone = None

    def run_forever(self) -> None:
        mode = "DRY-RUN (شبیه‌سازی)" if self.exchange.dry_run else "LIVE (معاملات واقعی)"
        logger.info("ربات شروع به کار کرد. نماد=%s، حالت=%s", self.exchange.symbol, mode)

        while True:
            try:
                self._tick()
            except ExchangeError as exc:
                logger.error("خطای صرافی: %s", exc)
            except Exception:
                logger.exception("خطای پیش‌بینی‌نشده در چرخه معاملاتی، ادامه می‌دهیم.")

            time.sleep(self.poll_interval_seconds)

    def _tick(self) -> None:
        price = self.exchange.get_current_price()
        signal = self.strategy.update(price)

        if self.position is not None:
            self._manage_open_position(price, signal)
        elif signal == Signal.BUY:
            self._try_open_position(price)
        else:
            logger.debug("قیمت=%s، سیگنال=%s، بدون پوزیشن باز.", price, signal.value)

    def _try_open_position(self, price: float) -> None:
        if not self.risk_manager.can_open_new_position():
            return

        order = self.exchange.buy_market(self.quote_order_amount, self.quantity_precision)
        if not order:
            return

        self.position = Position(entry_price=float(order["price"]), quantity=float(order["quantity"]))
        logger.info("پوزیشن باز شد: قیمت ورود=%s، مقدار=%s", self.position.entry_price, self.position.quantity)

    def _manage_open_position(self, price: float, signal: Signal) -> None:
        should_close = self.risk_manager.should_close_position(self.position, price) or signal == Signal.SELL

        if not should_close:
            logger.debug(
                "پوزیشن باز، قیمت=%s، سود/زیان=%.2f%%",
                price,
                self.position.unrealized_pnl_percent(price),
            )
            return

        order = self.exchange.sell_market(self.position.quantity)
        if not order:
            return

        pnl_percent = self.position.unrealized_pnl_percent(float(order["price"]))
        logger.info("پوزیشن بسته شد: قیمت خروج=%s، سود/زیان=%.2f%%", order["price"], pnl_percent)

        self.risk_manager.register_closed_trade(pnl_percent)
        self.position = None

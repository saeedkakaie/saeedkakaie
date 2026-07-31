import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional, Tuple

from src.exchange_client import ExchangeClient, ExchangeError
from src.market_scanner import discover_watchlist, fetch_quantity_precisions
from src.pnl import net_pnl_percent, pnl_amount
from src.position import Position
from src.position_store import PositionStore
from src.risk_manager import RiskManager
from src.strategy import Signal, Strategy
from src.trade_journal import ClosedTrade, TradeJournal

logger = logging.getLogger("tabdeal_bot")


class TradingBot:
    """
    ربات چندنمادی و خودمختار: به‌صورت خودکار پرفعالیت‌ترین نمادهای بازار
    را کشف می‌کند، هرکدام را جداگانه با یک نمونه استراتژی دنبال می‌کند، و
    برای تخصیص سرمایه هیچ سقف دستی (مبلغ ثابت هر معامله یا تعداد پوزیشن)
    ندارد — در هر چرخه، موجودی آزاد دارایی quote را متناسب با قدرت سیگنال
    هرکدام از نمادهایی که هم‌زمان سیگنال خرید داده‌اند تقسیم می‌کند؛ اگر
    فقط یک نماد سیگنال بدهد، ممکن است کل موجودی آزاد را به آن اختصاص دهد.

    تنها مرزهای باقی‌مانده: حد ضرر/سود پویا روی هر پوزیشن، مدار قطع ضرر
    روزانه (RiskManager)، و یک حداقل فنی برای رد کردن سفارش‌های ناچیز که
    کارمزدشان از خودشان بیشتر می‌شود.
    """

    # سفارش‌هایی که ارزششان از این کمتر باشد رد می‌شوند (کارمزد آن‌ها را
    # بی‌ارزش می‌کند)، نه یک سقف ریسک.
    MIN_ORDER_VALUE = 10_000

    # وقتی موجودی بین چند سیگنال هم‌زمان تقسیم می‌شود، کل موجودی آزاد
    # تخصیص داده نمی‌شود تا اسلیپیج/گرد‌شدن قیمت باعث رد شدن سفارش به‌خاطر
    # «موجودی ناکافی» نشود. چون quantity برای سفارش BUY از قیمت لحظه‌ای که
    # خودمان خوانده‌ایم محاسبه می‌شود (نه quoteOrderQty که صرافی خودش
    # مدیریتش کند — SDK این را پشتیبانی نمی‌کند)، اگر قیمت واقعی اجرا کمی
    # بالاتر از تخمین ما باشد، سفارش به مقدار بیشتری از دارایی quote نیاز
    # دارد؛ ۵٪ حاشیه برای همین نوسان/اسلیپیج در نظر گرفته شده.
    ALLOCATION_SAFETY_MARGIN = 0.95

    # چون قیمت هر نماد یک درخواست شبکه‌ای جداست، اگر متوالی خوانده شود هر
    # چرخه با تعداد نماد زیاد کند می‌شود و ممکن است از POLL_INTERVAL_SECONDS
    # بیشتر طول بکشد. به‌جای آن، قیمت همه‌ی نمادهای هر چرخه را هم‌زمان (با
    # چند ترد) می‌خوانیم؛ عدد پایین برای این است که فشار زیادی هم روی
    # rate limit صرافی نیاید.
    PRICE_FETCH_WORKERS = 10

    # هر چند دقیقه یک‌بار لیست نمادهای پرفعالیت دوباره محاسبه شود. این هم
    # دیگر تنظیم دستی نیست: عددی معقول بین «به‌روز ماندن با بازار» و «فشار
    # زیاد نیاوردن روی exchange_info با هر بار محاسبه‌ی فعالیت هر نماد».
    WATCHLIST_REFRESH_MINUTES = 60

    def __init__(
        self,
        exchange: ExchangeClient,
        strategy_factory: Callable[[str], Strategy],
        risk_manager: RiskManager,
        quote_asset: str,
        default_quantity_precision: int,
        poll_interval_seconds: int,
        fee_percent: float = 0.0,
        trade_journal: Optional[TradeJournal] = None,
        position_store: Optional[PositionStore] = None,
        tick_logger=None,
    ):
        self.exchange = exchange
        self.strategy_factory = strategy_factory
        self.risk_manager = risk_manager
        self.quote_asset = quote_asset
        self.default_quantity_precision = default_quantity_precision
        self.poll_interval_seconds = poll_interval_seconds
        self.fee_percent = fee_percent
        self.trade_journal = trade_journal
        self.position_store = position_store
        self.tick_logger = tick_logger

        self.watchlist: list = []
        self.strategies: Dict[str, Strategy] = {}
        self.positions: Dict[str, Position] = (
            self.position_store.load() if self.position_store else {}
        )
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
            "ربات شروع به کار کرد. quote_asset=%s، تخصیص سرمایه کاملا خودکار، حالت=%s",
            self.quote_asset,
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
            if elapsed < timedelta(minutes=self.WATCHLIST_REFRESH_MINUTES):
                return

        new_watchlist = discover_watchlist(self.exchange, self.quote_asset)

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

        prices = self._fetch_prices(symbols_to_check)

        buy_candidates: List[Tuple[str, float, float]] = []  # (symbol, price, weight)

        for symbol, price in prices.items():
            try:
                candidate = self._tick_symbol(symbol, price)
                if candidate:
                    buy_candidates.append(candidate)
            except Exception:
                logger.exception("خطای پیش‌بینی‌نشده برای %s", symbol)

        if buy_candidates:
            self._allocate_and_open_positions(buy_candidates)

    def _fetch_prices(self, symbols) -> Dict[str, float]:
        """
        قیمت همه‌ی نمادهای داده‌شده را هم‌زمان (با چند ترد، نه یکی‌یکی)
        می‌خواند تا هر چرخه با تعداد نماد زیاد کند نشود.
        """
        prices: Dict[str, float] = {}
        symbols = list(symbols)
        if not symbols:
            return prices

        with ThreadPoolExecutor(max_workers=min(self.PRICE_FETCH_WORKERS, len(symbols))) as executor:
            future_to_symbol = {
                executor.submit(self.exchange.get_current_price, symbol): symbol for symbol in symbols
            }
            for future in as_completed(future_to_symbol):
                symbol = future_to_symbol[future]
                try:
                    prices[symbol] = future.result()
                except ExchangeError as exc:
                    logger.error("خطای صرافی برای %s: %s", symbol, exc)
                except Exception:
                    logger.exception("خطای پیش‌بینی‌نشده در دریافت قیمت %s", symbol)

        return prices

    def _tick_symbol(self, symbol: str, price: float) -> Optional[Tuple[str, float, float]]:
        if self.tick_logger:
            self.tick_logger.log(symbol, price)

        strategy = self.strategies.setdefault(symbol, self.strategy_factory(symbol))
        signal = strategy.update(price)

        self.last_price[symbol] = price
        self.last_signal[symbol] = signal

        position = self.positions.get(symbol)
        if position is not None:
            self._manage_open_position(symbol, position, price, signal)
            return None

        if signal == Signal.BUY and self.risk_manager.can_open_new_position():
            confidence = strategy.confidence()
            weight = confidence if confidence is not None else 1.0
            return (symbol, price, max(weight, 0.0001))

        return None

    def _allocate_and_open_positions(self, candidates: List[Tuple[str, float, float]]) -> None:
        free_balance = self.exchange.get_asset_balance(self.quote_asset)
        if not free_balance or free_balance <= 0:
            logger.debug("موجودی آزاد %s برای خرید در دسترس نیست.", self.quote_asset)
            return

        allocatable = free_balance * self.ALLOCATION_SAFETY_MARGIN
        total_weight = sum(weight for _, _, weight in candidates)
        if total_weight <= 0:
            return

        logger.info(
            "تخصیص سرمایه: موجودی آزاد=%.2f %s بین %s سیگنال خرید (%s) بر اساس قدرت سیگنال تقسیم می‌شود.",
            free_balance,
            self.quote_asset,
            len(candidates),
            ", ".join(symbol for symbol, _, _ in candidates),
        )

        for symbol, price, weight in candidates:
            share = allocatable * (weight / total_weight)
            if share < self.MIN_ORDER_VALUE:
                logger.debug(
                    "سهم محاسبه‌شده برای %s (%.2f %s) کمتر از حداقل سفارش (%s) است، رد شد.",
                    symbol,
                    share,
                    self.quote_asset,
                    self.MIN_ORDER_VALUE,
                )
                continue
            try:
                self._open_position(symbol, share)
            except Exception:
                # اگر خرید یک نماد شکست بخورد (مثلا «موجودی کافی نیست» به‌خاطر
                # نوسان قیمت بین محاسبه‌ی سهم و ثبت واقعی سفارش)، نباید باقی
                # نامزدهای همین چرخه هم به‌خاطرش رد شوند.
                logger.exception("خرید %s ناموفق بود؛ به سراغ نماد بعدی می‌رویم.", symbol)

    def _open_position(self, symbol: str, quote_amount: float) -> None:
        quantity_precision = self.symbol_precisions.get(symbol, self.default_quantity_precision)
        order = self.exchange.buy_market(symbol, quote_amount, quantity_precision)
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
        if self.position_store:
            self.position_store.save(self.positions)

        logger.info(
            "پوزیشن باز شد (%s): ورود=%s، مقدار=%s، مبلغ=%.2f %s، حد ضرر ثابت=%.2f%% (قیمت %.4f)، "
            "عرض حد ضرر متحرک=%.2f%%، تعداد پوزیشن‌های باز=%s",
            symbol,
            position.entry_price,
            position.quantity,
            quote_amount,
            self.quote_asset,
            stop_loss_percent,
            position.stop_price,
            take_profit_percent,
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

        quantity_precision = self.symbol_precisions.get(symbol, self.default_quantity_precision)
        order = self.exchange.sell_market(symbol, position.quantity, quantity_precision)
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
        if self.position_store:
            self.position_store.save(self.positions)

import datetime as dt
import os

from src.bot import TradingBot
from src.position_store import PositionStore
from src.risk_manager import RiskManager
from src.strategy import Signal, Strategy
from src.trade_journal import TradeJournal


class ConstantSignalStrategy(Strategy):
    def __init__(self, signal, confidence=None):
        self._signal = signal
        self._confidence = confidence

    def update(self, price):
        return self._signal

    def confidence(self):
        return self._confidence


class FakeExchange:
    dry_run = True

    def __init__(self, prices, balance=1_000_000, fail_buy_for=None):
        self.prices = dict(prices)
        self.balance = balance
        self.fail_buy_for = fail_buy_for or set()

    def get_current_price(self, symbol):
        return self.prices[symbol]

    def get_asset_balance(self, asset):
        return self.balance

    def buy_market(self, symbol, quote_amount, precision):
        if symbol in self.fail_buy_for:
            raise Exception("Not enough balance")
        price = self.prices[symbol]
        qty = round(quote_amount / price, precision)
        self.balance -= quote_amount
        return {"price": price, "quantity": qty}

    def sell_market(self, symbol, quantity, precision):
        return {"price": self.prices[symbol], "quantity": quantity}


class FakeTickLogger:
    def __init__(self):
        self.logged = []

    def log(self, symbol, price):
        self.logged.append((symbol, price))


def make_bot(exchange, watchlist, signal=Signal.BUY, confidence=None, position_store=None,
             fee_percent=0.0, trade_journal=None, tick_logger=None):
    risk_manager = RiskManager(
        stop_loss_percent=2,
        take_profit_percent=3,
        max_daily_loss_percent=5,
    )
    bot = TradingBot(
        exchange=exchange,
        strategy_factory=lambda symbol: ConstantSignalStrategy(signal, confidence),
        risk_manager=risk_manager,
        quote_asset="IRT",
        default_quantity_precision=4,
        poll_interval_seconds=1,
        fee_percent=fee_percent,
        trade_journal=trade_journal,
        position_store=position_store,
        tick_logger=tick_logger,
    )
    bot.watchlist = watchlist
    bot._last_watchlist_refresh = dt.datetime.utcnow()
    return bot


def test_uses_per_symbol_precision_when_available():
    exchange = FakeExchange({"A_IRT": 333}, balance=100_000)
    bot = make_bot(exchange, ["A_IRT"])
    bot.symbol_precisions = {"A_IRT": 0}

    bot._tick()

    allocatable = 100_000 * TradingBot.ALLOCATION_SAFETY_MARGIN
    assert bot.positions["A_IRT"].quantity == round(allocatable / 333, 0)


def test_falls_back_to_default_precision_when_symbol_unknown():
    exchange = FakeExchange({"A_IRT": 333}, balance=100_000)
    bot = make_bot(exchange, ["A_IRT"])  # symbol_precisions stays empty

    bot._tick()

    allocatable = 100_000 * TradingBot.ALLOCATION_SAFETY_MARGIN
    assert bot.positions["A_IRT"].quantity == round(allocatable / 333, 4)


def test_allocates_full_free_balance_to_a_single_signal():
    """
    دیگر مبلغ ثابت هر معامله وجود ندارد: وقتی فقط یک نماد سیگنال خرید
    می‌دهد، ربات کل موجودی آزاد (منهای حاشیه ایمنی) را به همان یک کوین
    اختصاص می‌دهد.
    """
    exchange = FakeExchange({"A_IRT": 100}, balance=50_000)
    bot = make_bot(exchange, ["A_IRT"])

    bot._tick()

    allocatable = 50_000 * TradingBot.ALLOCATION_SAFETY_MARGIN
    assert bot.positions["A_IRT"].quantity == round(allocatable / 100, 4)


def test_splits_balance_proportional_to_signal_confidence():
    weights = {"A_IRT": 1.0, "B_IRT": 0.5}

    def strategy_factory(symbol):
        return ConstantSignalStrategy(Signal.BUY, confidence=weights[symbol])

    exchange = FakeExchange({"A_IRT": 100, "B_IRT": 100}, balance=300_000)
    risk_manager = RiskManager(stop_loss_percent=2, take_profit_percent=3, max_daily_loss_percent=5)
    bot = TradingBot(
        exchange=exchange,
        strategy_factory=strategy_factory,
        risk_manager=risk_manager,
        quote_asset="IRT",
        default_quantity_precision=4,
        poll_interval_seconds=1,
    )
    bot.watchlist = ["A_IRT", "B_IRT"]
    bot._last_watchlist_refresh = dt.datetime.utcnow()

    bot._tick()

    allocatable = 300_000 * TradingBot.ALLOCATION_SAFETY_MARGIN
    total_weight = weights["A_IRT"] + weights["B_IRT"]
    share_a = allocatable * (weights["A_IRT"] / total_weight)
    share_b = allocatable * (weights["B_IRT"] / total_weight)

    assert bot.positions["A_IRT"].quantity == round(share_a / 100, 4)
    assert bot.positions["B_IRT"].quantity == round(share_b / 100, 4)
    assert bot.positions["A_IRT"].quantity > bot.positions["B_IRT"].quantity


def test_no_positions_opened_when_balance_is_zero():
    exchange = FakeExchange({"A_IRT": 100}, balance=0)
    bot = make_bot(exchange, ["A_IRT"])

    bot._tick()

    assert bot.positions == {}


def test_skips_symbols_whose_share_is_below_min_order_value():
    exchange = FakeExchange({"A_IRT": 100}, balance=5_000)  # below MIN_ORDER_VALUE=10_000
    bot = make_bot(exchange, ["A_IRT"])

    bot._tick()

    assert bot.positions == {}


def test_capital_scarcity_naturally_limits_further_buys():
    """
    دیگر سقف دستی تعداد پوزیشن هم‌زمان وجود ندارد؛ به‌جایش، وقتی موجودی
    آزاد صرف یک پوزیشن می‌شود، همان کمبود سرمایه به‌طور طبیعی مانع باز شدن
    پوزیشن بعدی می‌شود (نه یک شمارنده‌ی ثابت).
    """
    exchange = FakeExchange({"A_IRT": 100, "B_IRT": 100}, balance=20_000)
    bot = make_bot(exchange, ["A_IRT"])

    bot._tick()
    assert "A_IRT" in bot.positions
    assert exchange.balance < 10_000  # تقریبا کل موجودی صرف شد

    bot.watchlist = ["A_IRT", "B_IRT"]
    bot._tick()

    assert "B_IRT" not in bot.positions


def test_opens_positions_across_multiple_symbols_independently():
    exchange = FakeExchange({"A_IRT": 100, "B_IRT": 200, "C_IRT": 300}, balance=300_000)
    bot = make_bot(exchange, ["A_IRT", "B_IRT", "C_IRT"])

    bot._tick()

    assert len(bot.positions) == 3
    assert set(bot.positions.keys()) == {"A_IRT", "B_IRT", "C_IRT"}


def test_one_failed_buy_does_not_abort_remaining_candidates_in_the_same_tick():
    """
    رگرسیون برای رفتار واقعی مشاهده‌شده: اگر خرید یک نماد به‌خاطر نوسان
    قیمت با «موجودی کافی نیست» رد شود، بقیه‌ی نامزدهای همان چرخه هم نباید
    به‌خاطرش رد شوند.
    """
    exchange = FakeExchange(
        {"A_IRT": 100, "B_IRT": 100, "C_IRT": 100}, balance=300_000, fail_buy_for={"B_IRT"}
    )
    bot = make_bot(exchange, ["A_IRT", "B_IRT", "C_IRT"])

    bot._tick()

    assert "A_IRT" in bot.positions
    assert "C_IRT" in bot.positions
    assert "B_IRT" not in bot.positions


def test_stop_loss_closes_only_the_affected_symbol():
    exchange = FakeExchange({"A_IRT": 100, "B_IRT": 100}, balance=200_000)
    bot = make_bot(exchange, ["A_IRT", "B_IRT"])

    bot._tick()
    assert len(bot.positions) == 2

    exchange.prices["A_IRT"] = 97  # -3%, below the 2% stop-loss
    bot._tick()

    assert "A_IRT" not in bot.positions
    assert "B_IRT" in bot.positions


def test_dropped_watchlist_symbol_still_managed_until_closed():
    exchange = FakeExchange({"A_IRT": 100}, balance=100_000)
    bot = make_bot(exchange, ["A_IRT"])

    bot._tick()
    assert "A_IRT" in bot.positions

    # نماد از لیست خودکار خارج شده اما پوزیشن هنوز باز است
    bot.watchlist = []
    exchange.prices["A_IRT"] = 97
    bot._tick()

    assert "A_IRT" not in bot.positions


def test_fee_reduces_realized_pnl_and_records_journal(tmp_path):
    exchange = FakeExchange({"A_IRT": 100}, balance=100_000)
    journal = TradeJournal(os.path.join(tmp_path, "trades.jsonl"))
    bot = make_bot(exchange, ["A_IRT"], fee_percent=0.5, trade_journal=journal)

    bot._tick()
    assert "A_IRT" in bot.positions

    exchange.prices["A_IRT"] = 110  # قله جدید؛ حد ضرر متحرک (عرض ۳٪) هنوز نباید ببندد
    bot._tick()
    assert "A_IRT" in bot.positions

    exchange.prices["A_IRT"] = 106  # برگشت بیش از ۳٪ از قله (۱۱۰) -> باید ببندد
    bot._tick()

    assert "A_IRT" not in bot.positions

    summary = journal.summary()
    assert summary["day"]["trades"] == 1
    # gross ~6%, fee 0.5% * 2 legs = 1%, so net should be noticeably below gross
    assert 4.5 < summary["day"]["net_pnl_percent"] < 5.5


def _make_bot_with_store(exchange, watchlist, store):
    risk_manager = RiskManager(stop_loss_percent=2, take_profit_percent=3, max_daily_loss_percent=5)
    bot = TradingBot(
        exchange=exchange,
        strategy_factory=lambda symbol: ConstantSignalStrategy(Signal.BUY),
        risk_manager=risk_manager,
        quote_asset="IRT",
        default_quantity_precision=4,
        poll_interval_seconds=1,
        position_store=store,
    )
    bot.watchlist = watchlist
    bot._last_watchlist_refresh = dt.datetime.utcnow()
    return bot


def test_positions_survive_a_simulated_restart(tmp_path):
    """
    رگرسیون برای باگ واقعی: قبل از این، پوزیشن‌های باز فقط در حافظه بودند
    و با هر ری‌استارت پردازش (که در عمل زیاد اتفاق می‌افتد) کاملا فراموش
    می‌شدند؛ یعنی حد ضرر/سودشان دیگر چک نمی‌شد و بدون هیچ محدودیتی امکان
    باز شدن پوزیشن‌های تکراری روی همان دارایی محدود (که این‌بار به‌طور
    طبیعی کمبود سرمایه محدودش می‌کند) وجود داشت.
    """
    store = PositionStore(os.path.join(tmp_path, "open_positions.json"))
    exchange = FakeExchange({"A_IRT": 100, "B_IRT": 100, "C_IRT": 100}, balance=25_000)

    first_run_bot = _make_bot_with_store(exchange, ["A_IRT", "B_IRT"], store)
    first_run_bot._tick()
    assert len(first_run_bot.positions) == 2

    # شبیه‌سازی ری‌استارت پردازش: یک نمونه‌ی کاملا جدید از TradingBot با همان store
    second_run_bot = _make_bot_with_store(exchange, ["A_IRT", "B_IRT", "C_IRT"], store)

    assert len(second_run_bot.positions) == 2
    assert set(second_run_bot.positions.keys()) == {"A_IRT", "B_IRT"}

    # موجودی آزاد تقریبا تمام شده، پس C_IRT جدید باز نمی‌شود
    second_run_bot._tick()
    assert "C_IRT" not in second_run_bot.positions
    assert len(second_run_bot.positions) == 2


def test_closing_a_position_persists_removal(tmp_path):
    store = PositionStore(os.path.join(tmp_path, "open_positions.json"))
    exchange = FakeExchange({"A_IRT": 100}, balance=100_000)

    bot = _make_bot_with_store(exchange, ["A_IRT"], store)
    bot._tick()
    assert "A_IRT" in bot.positions

    exchange.prices["A_IRT"] = 110  # قله جدید؛ حد ضرر متحرک هنوز نباید ببندد
    bot._tick()
    assert "A_IRT" in bot.positions

    exchange.prices["A_IRT"] = 106  # برگشت بیش از ۳٪ از قله -> باید ببندد
    bot._tick()
    assert "A_IRT" not in bot.positions

    reloaded = store.load()
    assert reloaded == {}


def test_tick_logger_records_every_symbol_price_each_cycle():
    exchange = FakeExchange({"A_IRT": 100, "B_IRT": 200}, balance=1_000_000)
    tick_logger = FakeTickLogger()
    bot = make_bot(exchange, ["A_IRT", "B_IRT"], signal=Signal.HOLD, tick_logger=tick_logger)

    bot._tick()

    assert set(tick_logger.logged) == {("A_IRT", 100), ("B_IRT", 200)}


def test_no_tick_logger_does_not_error():
    exchange = FakeExchange({"A_IRT": 100}, balance=1_000_000)
    bot = make_bot(exchange, ["A_IRT"], signal=Signal.HOLD, tick_logger=None)

    bot._tick()  # نباید خطا بدهد وقتی tick_logger تنظیم نشده

import datetime as dt
import os

from src.bot import TradingBot
from src.position_store import PositionStore
from src.risk_manager import RiskManager
from src.strategy import Signal, Strategy
from src.trade_journal import TradeJournal


class ConstantSignalStrategy(Strategy):
    def __init__(self, signal):
        self._signal = signal

    def update(self, price):
        return self._signal


class FakeExchange:
    dry_run = True

    def __init__(self, prices):
        self.prices = prices

    def get_current_price(self, symbol):
        return self.prices[symbol]

    def buy_market(self, symbol, quote_amount, precision):
        price = self.prices[symbol]
        qty = round(quote_amount / price, precision)
        return {"price": price, "quantity": qty}

    def sell_market(self, symbol, quantity):
        return {"price": self.prices[symbol], "quantity": quantity}


def make_bot(exchange, watchlist, max_concurrent=2, signal=Signal.BUY):
    risk_manager = RiskManager(
        stop_loss_percent=2,
        take_profit_percent=3,
        max_daily_loss_percent=5,
        max_trades_per_day=10,
    )
    bot = TradingBot(
        exchange=exchange,
        strategy_factory=lambda symbol: ConstantSignalStrategy(signal),
        risk_manager=risk_manager,
        quote_asset="IRT",
        watchlist_size=10,
        watchlist_refresh_minutes=999999,
        quote_order_amount=1000,
        default_quantity_precision=4,
        max_concurrent_positions=max_concurrent,
        poll_interval_seconds=1,
    )
    bot.watchlist = watchlist
    bot._last_watchlist_refresh = dt.datetime.utcnow()
    return bot


def test_uses_per_symbol_precision_when_available():
    exchange = FakeExchange({"A_IRT": 333})
    bot = make_bot(exchange, ["A_IRT"], max_concurrent=1)
    bot.symbol_precisions = {"A_IRT": 0}

    bot._tick()

    assert bot.positions["A_IRT"].quantity == round(1000 / 333, 0)


def test_falls_back_to_default_precision_when_symbol_unknown():
    exchange = FakeExchange({"A_IRT": 333})
    bot = make_bot(exchange, ["A_IRT"], max_concurrent=1)  # symbol_precisions stays empty

    bot._tick()

    assert bot.positions["A_IRT"].quantity == round(1000 / 333, 4)


def test_respects_max_concurrent_positions():
    exchange = FakeExchange({"A_IRT": 100, "B_IRT": 100, "C_IRT": 100})
    bot = make_bot(exchange, ["A_IRT", "B_IRT", "C_IRT"], max_concurrent=2)

    bot._tick()

    assert len(bot.positions) == 2


def test_opens_positions_across_multiple_symbols_independently():
    exchange = FakeExchange({"A_IRT": 100, "B_IRT": 200, "C_IRT": 300})
    bot = make_bot(exchange, ["A_IRT", "B_IRT", "C_IRT"], max_concurrent=3)

    bot._tick()

    assert len(bot.positions) == 3
    assert set(bot.positions.keys()) == {"A_IRT", "B_IRT", "C_IRT"}


def test_stop_loss_closes_only_the_affected_symbol():
    exchange = FakeExchange({"A_IRT": 100, "B_IRT": 100})
    bot = make_bot(exchange, ["A_IRT", "B_IRT"], max_concurrent=2)

    bot._tick()
    assert len(bot.positions) == 2

    exchange.prices["A_IRT"] = 97  # -3%, below the 2% stop-loss
    bot._tick()

    assert "A_IRT" not in bot.positions
    assert "B_IRT" in bot.positions


def test_dropped_watchlist_symbol_still_managed_until_closed():
    exchange = FakeExchange({"A_IRT": 100})
    bot = make_bot(exchange, ["A_IRT"], max_concurrent=2)

    bot._tick()
    assert "A_IRT" in bot.positions

    # نماد از لیست خودکار خارج شده اما پوزیشن هنوز باز است
    bot.watchlist = []
    exchange.prices["A_IRT"] = 97
    bot._tick()

    assert "A_IRT" not in bot.positions


def test_fee_reduces_realized_pnl_and_records_journal(tmp_path):
    exchange = FakeExchange({"A_IRT": 100})
    journal = TradeJournal(os.path.join(tmp_path, "trades.jsonl"))
    risk_manager = RiskManager(
        stop_loss_percent=2, take_profit_percent=3, max_daily_loss_percent=5, max_trades_per_day=10
    )
    bot = TradingBot(
        exchange=exchange,
        strategy_factory=lambda symbol: ConstantSignalStrategy(Signal.BUY),
        risk_manager=risk_manager,
        quote_asset="IRT",
        watchlist_size=10,
        watchlist_refresh_minutes=999999,
        quote_order_amount=1000,
        default_quantity_precision=4,
        max_concurrent_positions=1,
        poll_interval_seconds=1,
        fee_percent=0.5,
        trade_journal=journal,
    )
    bot.watchlist = ["A_IRT"]
    bot._last_watchlist_refresh = dt.datetime.utcnow()

    bot._tick()
    assert "A_IRT" in bot.positions

    exchange.prices["A_IRT"] = 110  # +10% gross, well above the 3% take-profit
    bot._tick()

    assert "A_IRT" not in bot.positions

    summary = journal.summary()
    assert summary["day"]["trades"] == 1
    # gross ~10%, fee 0.5% * 2 legs = 1%, so net should be noticeably below gross
    assert 8.5 < summary["day"]["net_pnl_percent"] < 9.5


def _make_bot_with_store(exchange, watchlist, store, max_concurrent=2, signal=Signal.BUY):
    risk_manager = RiskManager(
        stop_loss_percent=2, take_profit_percent=3, max_daily_loss_percent=5, max_trades_per_day=10
    )
    bot = TradingBot(
        exchange=exchange,
        strategy_factory=lambda symbol: ConstantSignalStrategy(signal),
        risk_manager=risk_manager,
        quote_asset="IRT",
        watchlist_size=10,
        watchlist_refresh_minutes=999999,
        quote_order_amount=1000,
        default_quantity_precision=4,
        max_concurrent_positions=max_concurrent,
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
    می‌شدند؛ یعنی هم حد ضرر/سودشان دیگر چک نمی‌شد، هم MAX_CONCURRENT_POSITIONS
    اجازه می‌داد باز هم بیشتر از سقف مجاز پوزیشن باز شود.
    """
    store = PositionStore(os.path.join(tmp_path, "open_positions.json"))
    exchange = FakeExchange({"A_IRT": 100, "B_IRT": 100})

    first_run_bot = _make_bot_with_store(exchange, ["A_IRT", "B_IRT"], store, max_concurrent=2)
    first_run_bot._tick()
    assert len(first_run_bot.positions) == 2

    # شبیه‌سازی ری‌استارت پردازش: یک نمونه‌ی کاملا جدید از TradingBot با همان store
    second_run_bot = _make_bot_with_store(exchange, ["A_IRT", "B_IRT", "C_IRT"], store, max_concurrent=2)

    assert len(second_run_bot.positions) == 2
    assert set(second_run_bot.positions.keys()) == {"A_IRT", "B_IRT"}

    # چون سقف پوزیشن هم‌زمان (۲) با همون ۲ پوزیشن قدیمی پر شده، نباید C_IRT جدید باز کند
    exchange.prices["C_IRT"] = 100
    second_run_bot._tick()
    assert "C_IRT" not in second_run_bot.positions
    assert len(second_run_bot.positions) == 2


def test_closing_a_position_persists_removal(tmp_path):
    store = PositionStore(os.path.join(tmp_path, "open_positions.json"))
    exchange = FakeExchange({"A_IRT": 100})

    bot = _make_bot_with_store(exchange, ["A_IRT"], store, max_concurrent=1)
    bot._tick()
    assert "A_IRT" in bot.positions

    exchange.prices["A_IRT"] = 110  # فراتر از حد سود ۳٪
    bot._tick()
    assert "A_IRT" not in bot.positions

    reloaded = store.load()
    assert reloaded == {}

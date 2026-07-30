import datetime as dt

from src.bot import TradingBot
from src.risk_manager import RiskManager
from src.strategy import Signal, Strategy


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
        strategy_factory=lambda: ConstantSignalStrategy(signal),
        risk_manager=risk_manager,
        quote_asset="IRT",
        watchlist_size=10,
        watchlist_refresh_minutes=999999,
        quote_order_amount=1000,
        quantity_precision=4,
        max_concurrent_positions=max_concurrent,
        poll_interval_seconds=1,
    )
    bot.watchlist = watchlist
    bot._last_watchlist_refresh = dt.datetime.utcnow()
    return bot


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

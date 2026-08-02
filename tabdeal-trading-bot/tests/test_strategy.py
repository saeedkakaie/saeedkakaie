import pytest

from src.strategy import Signal, SmaCrossoverStrategy


def test_holds_until_enough_data():
    strategy = SmaCrossoverStrategy(fast_period=2, slow_period=4)
    for price in [100, 101, 102]:
        assert strategy.update(price) == Signal.HOLD


def test_buy_signal_on_upward_crossover():
    strategy = SmaCrossoverStrategy(fast_period=2, slow_period=4)
    prices = [100, 100, 100, 100, 110, 120]
    signals = [strategy.update(p) for p in prices]
    assert Signal.BUY in signals


def test_sell_signal_on_downward_crossover():
    strategy = SmaCrossoverStrategy(fast_period=2, slow_period=4)
    prices = [100, 110, 120, 130, 100, 90, 80]
    signals = [strategy.update(p) for p in prices]
    assert Signal.SELL in signals


def test_invalid_periods_raise():
    with pytest.raises(ValueError):
        SmaCrossoverStrategy(fast_period=10, slow_period=5)

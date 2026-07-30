from src.indicators import (
    bollinger_bands,
    ema,
    macd,
    rsi,
    stochastic_oscillator,
    volatility_percent,
)


def test_rsi_all_gains_is_100():
    prices = [100 + i for i in range(20)]
    assert rsi(prices, period=14) == 100.0


def test_rsi_all_losses_is_0():
    prices = [100 - i for i in range(20)]
    assert rsi(prices, period=14) == 0.0


def test_rsi_none_when_insufficient_data():
    assert rsi([1, 2, 3], period=14) is None


def test_ema_converges_toward_constant_price():
    prices = [50.0] * 30
    assert ema(prices, period=10) == 50.0


def test_ema_none_when_insufficient_data():
    assert ema([1, 2], period=10) is None


def test_macd_none_when_insufficient_data():
    assert macd([1] * 10) == (None, None, None)


def test_macd_positive_on_uptrend():
    prices = [100 + i * 0.5 for i in range(60)]
    macd_line, signal_line, hist = macd(prices)
    assert macd_line is not None
    assert macd_line > 0


def test_bollinger_bands_flat_prices_zero_width():
    prices = [10.0] * 25
    lower, mid, upper = bollinger_bands(prices, period=20)
    assert lower == mid == upper == 10.0


def test_bollinger_bands_none_when_insufficient_data():
    assert bollinger_bands([1, 2, 3], period=20) == (None, None, None)


def test_stochastic_oscillator_near_top_of_range_on_uptrend():
    prices = list(range(1, 30))
    k, d = stochastic_oscillator(prices, period=14, smooth_k=3, smooth_d=3)
    assert k is not None
    assert k > 90


def test_stochastic_oscillator_none_when_insufficient_data():
    assert stochastic_oscillator([1, 2, 3]) == (None, None)


def test_volatility_percent_zero_for_constant_prices():
    prices = [100.0] * 25
    assert volatility_percent(prices, period=20) == 0.0


def test_volatility_percent_none_when_insufficient_data():
    assert volatility_percent([1, 2], period=20) is None

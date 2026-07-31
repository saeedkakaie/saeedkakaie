from src.indicators import (
    bollinger_bands,
    ema,
    ichimoku,
    macd,
    rate_of_change,
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


def test_ichimoku_none_when_insufficient_data():
    assert ichimoku([1] * 51) == (None, None, None, None)


def test_ichimoku_flat_prices_all_lines_equal():
    prices = [100.0] * 60
    tenkan, kijun, senkou_a, senkou_b = ichimoku(prices)
    assert tenkan == kijun == senkou_a == senkou_b == 100.0


def test_ichimoku_tenkan_above_kijun_on_sustained_uptrend():
    prices = [100 + i for i in range(60)]
    tenkan, kijun, senkou_a, senkou_b = ichimoku(prices)
    assert tenkan is not None
    assert tenkan > kijun


def test_rate_of_change_none_when_insufficient_data():
    assert rate_of_change([1, 2, 3], period=10) is None


def test_rate_of_change_positive_on_uptrend():
    prices = [100 + i for i in range(15)]
    roc = rate_of_change(prices, period=10)
    assert roc is not None
    assert roc > 0


def test_rate_of_change_zero_for_flat_prices():
    prices = [100.0] * 15
    assert rate_of_change(prices, period=10) == 0.0

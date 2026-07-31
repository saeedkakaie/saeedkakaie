import random

from src.strategy import Signal, TechnicalStrategy


class FakeNewsFilter:
    def __init__(self, score, enabled=True):
        self._score = score
        self.enabled = enabled

    def sentiment(self, base_asset):
        return self._score


def test_decide_buy_on_confluence_crossing_up():
    strategy = TechnicalStrategy(symbol="BTC_IRT")
    strategy._prev_confluence = TechnicalStrategy.CONFLUENCE_THRESHOLD - 1
    assert strategy._decide(TechnicalStrategy.CONFLUENCE_THRESHOLD) == Signal.BUY


def test_decide_hold_when_no_new_crossing():
    strategy = TechnicalStrategy(symbol="BTC_IRT")
    strategy._prev_confluence = TechnicalStrategy.CONFLUENCE_THRESHOLD
    assert strategy._decide(TechnicalStrategy.CONFLUENCE_THRESHOLD + 1) == Signal.HOLD


def test_decide_sell_on_confluence_crossing_down():
    strategy = TechnicalStrategy(symbol="BTC_IRT")
    strategy._prev_confluence = -1
    assert strategy._decide(-TechnicalStrategy.CONFLUENCE_THRESHOLD) == Signal.SELL


def test_decide_news_veto_blocks_buy():
    strategy = TechnicalStrategy(symbol="BTC_IRT", news_filter=FakeNewsFilter(score=-0.8))
    strategy._prev_confluence = TechnicalStrategy.CONFLUENCE_THRESHOLD - 1
    assert strategy._decide(TechnicalStrategy.CONFLUENCE_THRESHOLD) == Signal.HOLD


def test_decide_news_boost_lowers_threshold():
    strategy = TechnicalStrategy(symbol="BTC_IRT", news_filter=FakeNewsFilter(score=0.8))
    strategy._prev_confluence = TechnicalStrategy.NEWS_BOOSTED_THRESHOLD - 1
    assert strategy._decide(TechnicalStrategy.NEWS_BOOSTED_THRESHOLD) == Signal.BUY


def test_decide_mild_positive_news_does_not_lower_threshold():
    strategy = TechnicalStrategy(symbol="BTC_IRT", news_filter=FakeNewsFilter(score=0.1))
    strategy._prev_confluence = TechnicalStrategy.NEWS_BOOSTED_THRESHOLD - 1
    assert strategy._decide(TechnicalStrategy.NEWS_BOOSTED_THRESHOLD) == Signal.HOLD


def test_hold_when_insufficient_price_history():
    strategy = TechnicalStrategy(symbol="BTC_IRT")
    for price in [100, 101, 99, 102]:
        assert strategy.update(price) == Signal.HOLD


def test_suggested_risk_levels_none_when_insufficient_data():
    strategy = TechnicalStrategy(symbol="BTC_IRT")
    for price in [100, 101, 102]:
        strategy.update(price)
    assert strategy.suggested_risk_levels() is None


def test_suggested_risk_levels_bounded_and_consistent_ratio():
    strategy = TechnicalStrategy(symbol="BTC_IRT")
    random.seed(42)
    price = 100.0
    for _ in range(40):
        price *= 1 + random.uniform(-0.02, 0.02)
        strategy.update(price)

    levels = strategy.suggested_risk_levels()
    assert levels is not None
    stop_loss, take_profit = levels
    assert TechnicalStrategy.MIN_STOP_LOSS_PERCENT <= stop_loss <= TechnicalStrategy.MAX_STOP_LOSS_PERCENT
    assert take_profit == stop_loss * TechnicalStrategy.RISK_REWARD_RATIO


def test_collect_votes_includes_ichimoku_and_momentum_on_sustained_uptrend():
    strategy = TechnicalStrategy(symbol="BTC_IRT")
    prices = [100 + i * 0.5 for i in range(80)]
    votes = strategy._collect_votes(prices)
    assert votes["ichimoku"] == 1
    assert votes["momentum"] == 1


def test_detects_pump_and_buys_immediately_bypassing_confluence():
    """
    رگرسیون برای رفتار مطلوب: در یک پامپ واقعی، RSI/Bollinger/Stochastic
    (contrarian) وارد اشباع خرید می‌شوند و رأی منفی می‌دهند، پس رأی‌گیری
    معمول ممکن است هیچ‌وقت به آستانه نرسد. مسیر تشخیص پامپ باید بدون توجه
    به آن، بلافاصله سیگنال خرید بدهد.
    """
    strategy = TechnicalStrategy(symbol="BTC_IRT")
    prices = [100, 100, 100, 100, 100, 107]  # جهش ۷٪ طی ۵ تیک اخیر، بالای آستانه ۵٪
    signals = [strategy.update(p) for p in prices]
    assert signals[-1] == Signal.BUY


def test_pump_signal_blocked_by_negative_news():
    strategy = TechnicalStrategy(symbol="BTC_IRT", news_filter=FakeNewsFilter(score=-0.8))
    prices = [100, 100, 100, 100, 100, 107]
    signals = [strategy.update(p) for p in prices]
    assert signals[-1] == Signal.HOLD


def test_confidence_is_maximum_after_pump_detected():
    strategy = TechnicalStrategy(symbol="BTC_IRT")
    for price in [100, 100, 100, 100, 100, 107]:
        strategy.update(price)
    assert strategy.confidence() == 1.0


def test_detect_pump_requires_new_high_not_just_fast_roc():
    strategy = TechnicalStrategy(symbol="BTC_IRT")
    # جهش قوی (۵٪، از آستانه عبور کرده) هست ولی قیمت الان دیگر بالاترین
    # قیمت همان بازه نیست (از ۱۰۸ به ۱۰۵ برگشته)
    prices = [100, 100, 100, 100, 108, 105]
    assert strategy._detect_pump(prices) is False


def test_update_runs_without_error_over_long_series():
    strategy = TechnicalStrategy(symbol="BTC_IRT")
    random.seed(1)
    price = 100.0
    for _ in range(200):
        price *= 1 + random.uniform(-0.01, 0.01)
        signal = strategy.update(price)
        assert isinstance(signal, Signal)

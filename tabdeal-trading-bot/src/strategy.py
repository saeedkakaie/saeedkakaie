import logging
from abc import ABC, abstractmethod
from collections import deque
from enum import Enum
from typing import Optional, Tuple

from src.indicators import bollinger_bands, ema, macd, rsi, stochastic_oscillator, volatility_percent

logger = logging.getLogger("tabdeal_bot")


class Signal(Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class Strategy(ABC):
    """
    اینترفیس پایه استراتژی. برای اضافه کردن استراتژی خودتان، از این کلاس
    ارث‌بری کنید و متد update را با منطق دلخواه پیاده‌سازی کنید، سپس در
    main.py و webapp/bot_runner.py به‌جای TechnicalStrategy از کلاس خودتان
    استفاده کنید.
    """

    @abstractmethod
    def update(self, price: float) -> Signal:
        raise NotImplementedError

    def suggested_risk_levels(self) -> Optional[Tuple[float, float]]:
        """
        در صورت پیاده‌سازی، (stop_loss_percent, take_profit_percent) پویا
        برمی‌گرداند. پیش‌فرض None است یعنی از مقادیر ثابت تنظیمات استفاده شود.
        """
        return None


class SmaCrossoverStrategy(Strategy):
    """
    استراتژی پیش‌فرض و ساده: تقاطع میانگین متحرک ساده (SMA) سریع و کند.
    وقتی SMA سریع از پایین به بالای SMA کند عبور کند -> سیگنال خرید.
    وقتی SMA سریع از بالا به پایین SMA کند عبور کند -> سیگنال فروش.
    این فقط یک نمونه‌ی کارکردی برای شروع است، نه توصیه‌ی مالی.
    """

    def __init__(self, fast_period: int = 5, slow_period: int = 20):
        if fast_period >= slow_period:
            raise ValueError("fast_period باید کوچک‌تر از slow_period باشد")

        self.fast_period = fast_period
        self.slow_period = slow_period
        self._prices = deque(maxlen=slow_period)
        self._prev_fast_above_slow = None

    def update(self, price: float) -> Signal:
        self._prices.append(price)

        if len(self._prices) < self.slow_period:
            return Signal.HOLD

        prices = list(self._prices)
        fast_sma = sum(prices[-self.fast_period:]) / self.fast_period
        slow_sma = sum(prices) / self.slow_period

        fast_above_slow = fast_sma > slow_sma
        signal = Signal.HOLD

        if self._prev_fast_above_slow is not None:
            if fast_above_slow and not self._prev_fast_above_slow:
                signal = Signal.BUY
            elif not fast_above_slow and self._prev_fast_above_slow:
                signal = Signal.SELL

        self._prev_fast_above_slow = fast_above_slow
        return signal


class TechnicalStrategy(Strategy):
    """
    استراتژی ترکیبی: پنج اندیکاتور (RSI، MACD، باند بولینگر، Stochastic
    Oscillator، و روند EMA بلندمدت) هرکدام یک رأی ۱-/۰/۱+ می‌دهند. فقط
    وقتی مجموع رأی‌ها از یک آستانه (پیش‌فرض ۳ از ۵) عبور کند سیگنال صادر
    می‌شود، و فقط روی همان عبور (نه هر تیک) تا از سیگنال تکراری جلوگیری شود.

    اگر فیلتر خبر (NewsFilter) داده شود: خبر بسیار منفی جلوی سیگنال خرید
    را می‌گیرد (safety-first)، و خبر بسیار مثبت آستانه‌ی خرید را کمی
    پایین می‌آورد. فروش هیچ‌وقت به‌خاطر خبر متوقف نمی‌شود چون بستن پوزیشن
    برای مدیریت ریسک همیشه باید ممکن باشد.

    حد ضرر/سود پیشنهادی از نوسان اخیر قیمت محاسبه می‌شود (چون ATR واقعی
    بدون داده کندل در دسترس نیست). این یک نمونه‌ی معقول برای شروع است، نه
    توصیه‌ی مالی و نه تضمین سود؛ حتما قبل از استفاده‌ی واقعی بک‌تست کنید.
    """

    HISTORY_SIZE = 150
    RSI_PERIOD = 14
    BOLLINGER_PERIOD = 20
    TREND_EMA_PERIOD = 50
    CONFLUENCE_THRESHOLD = 3
    NEWS_BOOSTED_THRESHOLD = 2
    NEWS_VETO_SCORE = -0.5
    NEWS_BOOST_SCORE = 0.5
    MIN_STOP_LOSS_PERCENT = 1.0
    MAX_STOP_LOSS_PERCENT = 8.0
    VOLATILITY_MULTIPLIER = 1.5
    RISK_REWARD_RATIO = 1.5

    def __init__(self, symbol: str, news_filter=None):
        self.symbol = symbol
        self.base_asset = symbol.split("_")[0]
        self.news_filter = news_filter
        self._prices = deque(maxlen=self.HISTORY_SIZE)
        self._prev_confluence = 0

    def update(self, price: float) -> Signal:
        self._prices.append(price)
        prices = list(self._prices)

        votes = self._collect_votes(prices)
        confluence = sum(votes.values())

        signal = self._decide(confluence)
        self._prev_confluence = confluence
        return signal

    def _collect_votes(self, prices) -> dict:
        votes = {}

        rsi_value = rsi(prices, self.RSI_PERIOD)
        votes["rsi"] = 0 if rsi_value is None else (1 if rsi_value < 30 else (-1 if rsi_value > 70 else 0))

        _, _, hist = macd(prices)
        votes["macd"] = 0 if hist is None else (1 if hist > 0 else (-1 if hist < 0 else 0))

        lower, _, upper = bollinger_bands(prices, self.BOLLINGER_PERIOD)
        if lower is None:
            votes["bollinger"] = 0
        else:
            current = prices[-1]
            votes["bollinger"] = 1 if current <= lower else (-1 if current >= upper else 0)

        k, _ = stochastic_oscillator(prices)
        votes["stochastic"] = 0 if k is None else (1 if k < 20 else (-1 if k > 80 else 0))

        trend_ema = ema(prices, self.TREND_EMA_PERIOD)
        if trend_ema is None:
            votes["trend"] = 0
        else:
            current = prices[-1]
            votes["trend"] = 1 if current > trend_ema else (-1 if current < trend_ema else 0)

        return votes

    def _decide(self, confluence: int) -> Signal:
        buy_threshold = self.CONFLUENCE_THRESHOLD
        news_score = None

        if confluence >= self.NEWS_BOOSTED_THRESHOLD and self.news_filter and self.news_filter.enabled:
            news_score = self.news_filter.sentiment(self.base_asset)
            if news_score >= self.NEWS_BOOST_SCORE:
                buy_threshold = self.NEWS_BOOSTED_THRESHOLD

        crossed_up = self._prev_confluence < buy_threshold <= confluence
        crossed_down = self._prev_confluence > -self.CONFLUENCE_THRESHOLD >= confluence

        if crossed_up:
            if self.news_filter and self.news_filter.enabled:
                if news_score is None:
                    news_score = self.news_filter.sentiment(self.base_asset)
                if news_score <= self.NEWS_VETO_SCORE:
                    logger.info(
                        "سیگنال خرید %s به‌خاطر خبر منفی (امتیاز=%.2f) نادیده گرفته شد.",
                        self.symbol,
                        news_score,
                    )
                    return Signal.HOLD
            return Signal.BUY

        if crossed_down:
            return Signal.SELL

        return Signal.HOLD

    def suggested_risk_levels(self) -> Optional[Tuple[float, float]]:
        vol = volatility_percent(list(self._prices))
        if vol is None or vol <= 0:
            return None

        stop_loss = max(self.MIN_STOP_LOSS_PERCENT, min(self.MAX_STOP_LOSS_PERCENT, vol * self.VOLATILITY_MULTIPLIER))
        take_profit = stop_loss * self.RISK_REWARD_RATIO
        return stop_loss, take_profit

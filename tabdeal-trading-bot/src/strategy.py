import logging
from abc import ABC, abstractmethod
from collections import deque
from enum import Enum
from typing import Optional, Tuple

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

    def confidence(self) -> Optional[float]:
        """
        قدرت آخرین سیگنال، عددی بین ۰ تا ۱ (یا None اگر پیاده نشده). برای
        تقسیم سرمایه‌ی موجود بین چند سیگنال هم‌زمان بر اساس قدرتشان استفاده
        می‌شود. پیش‌فرض None است یعنی همه‌ی سیگنال‌ها وزن یکسان دارند.
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
    استراتژی ترکیبی: هفت اندیکاتور (RSI، MACD، باند بولینگر، Stochastic
    Oscillator، روند EMA بلندمدت، ابر ایچیموکو شامل تقاطع Tenkan-sen/
    Kijun-sen و موقعیت قیمت نسبت به ابر Kumo، و مومنتوم/Rate of Change
    کوتاه‌مدت) هرکدام یک رأی ۱-/۰/۱+ می‌دهند. فقط وقتی مجموع رأی‌ها از یک
    آستانه (پیش‌فرض ۴ از ۷) عبور کند سیگنال صادر می‌شود، و فقط روی همان
    عبور (نه هر تیک) تا از سیگنال تکراری جلوگیری شود.

    یک مسیر جدا برای تشخیص مستقیم پامپ هم دارد (`_detect_pump`): اگر قیمت
    طی چند تیک اخیر جهش قوی داشته و همین الان بالاترین قیمت همان بازه
    باشد، بدون توجه به رأی‌گیری معمول بلافاصله سیگنال خرید صادر می‌شود —
    چون در یک پامپ واقعی، اندیکاتورهای contrarian (RSI/Bollinger/
    Stochastic) معمولاً دقیقاً همان لحظه وارد اشباع خرید می‌شوند و مانع
    رسیدن رأی‌گیری معمول به آستانه می‌شوند.

    اگر فیلتر خبر (NewsFilter) داده شود: خبر بسیار منفی جلوی سیگنال خرید
    را می‌گیرد (safety-first، حتی برای سیگنال پامپ)، و خبر بسیار مثبت
    آستانه‌ی خرید را کمی پایین می‌آورد. فروش هیچ‌وقت به‌خاطر خبر متوقف
    نمی‌شود چون بستن پوزیشن برای مدیریت ریسک همیشه باید ممکن باشد.

    حد ضرر/سود پیشنهادی از نوسان اخیر قیمت محاسبه می‌شود (چون ATR واقعی
    بدون داده کندل در دسترس نیست). این یک نمونه‌ی معقول برای شروع است، نه
    توصیه‌ی مالی و نه تضمین سود؛ حتما قبل از استفاده‌ی واقعی بک‌تست کنید.
    """

    # دوره‌ی همه‌ی اندیکاتورها عمداً کوتاه‌تر از مقادیر «کتابی» رایج
    # (که برای کندل روزانه طراحی شده‌اند) انتخاب شده تا با سری قیمت
    # poll‌شده‌ی این ربات، به نوسانات کوچیک‌تر و سریع‌تر هم واکنش نشان
    # دهد — چون هدف نوسان‌گیری کوتاه‌مدت است، نه سرمایه‌گذاری بلندمدت.
    HISTORY_SIZE = 150
    RSI_PERIOD = 7
    BOLLINGER_PERIOD = 10
    TREND_EMA_PERIOD = 21
    MACD_FAST_PERIOD = 6
    MACD_SLOW_PERIOD = 13
    MACD_SIGNAL_PERIOD = 5
    STOCHASTIC_PERIOD = 7
    STOCHASTIC_SMOOTH_K = 3
    STOCHASTIC_SMOOTH_D = 3
    ICHIMOKU_TENKAN_PERIOD = 5
    ICHIMOKU_KIJUN_PERIOD = 13
    ICHIMOKU_SENKOU_B_PERIOD = 26

    CONFLUENCE_THRESHOLD = 4
    NEWS_BOOSTED_THRESHOLD = 3
    NEWS_VETO_SCORE = -0.5
    NEWS_BOOST_SCORE = 0.5
    MIN_STOP_LOSS_PERCENT = 1.0
    MAX_STOP_LOSS_PERCENT = 8.0
    VOLATILITY_MULTIPLIER = 1.5
    RISK_REWARD_RATIO = 1.5

    ROC_PERIOD = 5
    # آستانه‌ای که تغییر قیمت طی ROC_PERIOD تیک اخیر باید از آن عبور کند
    # تا «مومنتوم قابل توجه» حساب شود. چون این ربات به‌جای کندل واقعی از
    # سری قیمت poll‌شده استفاده می‌کند، این عدد ممکن است لازم باشد متناسب
    # با نوسان معمول نمادهایی که معامله می‌کنید و POLL_INTERVAL_SECONDS
    # تنظیم شود.
    ROC_THRESHOLD_PERCENT = 0.6

    # تعداد اندیکاتورهای رأی‌دهنده: RSI, MACD, Bollinger, Stochastic,
    # trend, ichimoku, momentum (ROC)
    MAX_CONFLUENCE = 7

    # تشخیص مستقیم پامپ: در یک پامپ قوی، RSI/Bollinger/Stochastic چون
    # contrarian هستند وارد اشباع خرید می‌شوند و رأی منفی می‌دهند (دقیقاً
    # همان لحظه‌ای که باید خرید کرد)، پس ممکن است مجموع رأی‌ها هیچ‌وقت به
    # آستانه‌ی معمولی نرسد. برای همین این مسیر جدا و سریع‌تر: اگر قیمت طی
    # PUMP_LOOKBACK_PERIOD تیک اخیر حداقل PUMP_ROC_THRESHOLD_PERCENT درصد
    # جهش کرده باشد و همین الان بالاترین قیمت همان بازه باشد (یعنی واقعاً
    # در حال شکستن سقف است، نه فقط یک نویز لحظه‌ای)، بدون توجه به رأی‌گیری
    # معمول بلافاصله سیگنال خرید صادر می‌شود. حد ضرر متحرک (trailing stop)
    # مسئول فروش به‌موقع وقتی پامپ برگردد (دامپ) خواهد بود.
    PUMP_LOOKBACK_PERIOD = 5
    # این عدد با شبیه‌سازی مونت‌کارلو کالیبره شده: مقادیر پایین‌تر (مثلا
    # ۱.۵٪) عملا با نوسان معمولی بازار (نه یک پامپ واقعی) هم فعال می‌شوند
    # و تعداد سیگنال خرید را حتی از رأی‌گیری معمول هم بیشتر می‌کنند — چون
    # مسیر پامپ هیچ اندیکاتور دیگری را چک نمی‌کند، هر false positive اینجا
    # مستقیماً یک خرید واقعی و کارمزد الکی است. اگر برای نمادهایی که
    # معامله می‌کنید هنوز پامپ واقعی را دیر تشخیص می‌دهد یا برعکس روی
    # نوسان عادی هم فعال می‌شود، این عدد را متناسب با POLL_INTERVAL_SECONDS
    # و نوسان معمول آن نمادها تنظیم کنید.
    PUMP_ROC_THRESHOLD_PERCENT = 5.0

    def __init__(self, symbol: str, news_filter=None):
        self.symbol = symbol
        self.base_asset = symbol.split("_")[0]
        self.news_filter = news_filter
        self._prices = deque(maxlen=self.HISTORY_SIZE)
        self._prev_confluence = 0
        self.last_confluence: Optional[int] = None

    def update(self, price: float) -> Signal:
        self._prices.append(price)
        prices = list(self._prices)

        if self._detect_pump(prices):
            self.last_confluence = self.MAX_CONFLUENCE
            self._prev_confluence = self.last_confluence
            if self.news_filter and self.news_filter.enabled:
                news_score = self.news_filter.sentiment(self.base_asset)
                if news_score <= self.NEWS_VETO_SCORE:
                    logger.info(
                        "سیگنال پامپ %s به‌خاطر خبر منفی (امتیاز=%.2f) نادیده گرفته شد.",
                        self.symbol,
                        news_score,
                    )
                    return Signal.HOLD
            logger.info("پامپ روی %s تشخیص داده شد؛ سیگنال خرید فوری صادر شد.", self.symbol)
            return Signal.BUY

        votes = self._collect_votes(prices)
        confluence = sum(votes.values())

        signal = self._decide(confluence)
        self._prev_confluence = confluence
        self.last_confluence = confluence
        return signal

    def _detect_pump(self, prices) -> bool:
        roc_value = rate_of_change(prices, self.PUMP_LOOKBACK_PERIOD)
        if roc_value is None or roc_value < self.PUMP_ROC_THRESHOLD_PERCENT:
            return False

        recent_window = prices[-(self.PUMP_LOOKBACK_PERIOD + 1):]
        return prices[-1] >= max(recent_window)

    def confidence(self) -> Optional[float]:
        if self.last_confluence is None:
            return None
        return min(1.0, abs(self.last_confluence) / self.MAX_CONFLUENCE)

    def _collect_votes(self, prices) -> dict:
        votes = {}

        rsi_value = rsi(prices, self.RSI_PERIOD)
        votes["rsi"] = 0 if rsi_value is None else (1 if rsi_value < 30 else (-1 if rsi_value > 70 else 0))

        _, _, hist = macd(prices, self.MACD_FAST_PERIOD, self.MACD_SLOW_PERIOD, self.MACD_SIGNAL_PERIOD)
        votes["macd"] = 0 if hist is None else (1 if hist > 0 else (-1 if hist < 0 else 0))

        lower, _, upper = bollinger_bands(prices, self.BOLLINGER_PERIOD)
        if lower is None:
            votes["bollinger"] = 0
        else:
            current = prices[-1]
            votes["bollinger"] = 1 if current <= lower else (-1 if current >= upper else 0)

        k, _ = stochastic_oscillator(
            prices, self.STOCHASTIC_PERIOD, self.STOCHASTIC_SMOOTH_K, self.STOCHASTIC_SMOOTH_D
        )
        votes["stochastic"] = 0 if k is None else (1 if k < 20 else (-1 if k > 80 else 0))

        trend_ema = ema(prices, self.TREND_EMA_PERIOD)
        if trend_ema is None:
            votes["trend"] = 0
        else:
            current = prices[-1]
            votes["trend"] = 1 if current > trend_ema else (-1 if current < trend_ema else 0)

        tenkan_sen, kijun_sen, senkou_span_a, senkou_span_b = ichimoku(
            prices, self.ICHIMOKU_TENKAN_PERIOD, self.ICHIMOKU_KIJUN_PERIOD, self.ICHIMOKU_SENKOU_B_PERIOD
        )
        if tenkan_sen is None:
            votes["ichimoku"] = 0
        else:
            current = prices[-1]
            cloud_top = max(senkou_span_a, senkou_span_b)
            cloud_bottom = min(senkou_span_a, senkou_span_b)
            tenkan_above_kijun = tenkan_sen > kijun_sen
            # فقط وقتی قیمت نسبت به ابر (Kumo) و تقاطع تنکان‌سن/کیجون‌سن هر
            # دو هم‌جهت باشند رأی می‌دهد؛ تنها یکی از این دو، سیگنال ضعیف و
            # مبهم ایچیموکو محسوب می‌شود و رأی خنثی (۰) می‌گیرد.
            if current > cloud_top and tenkan_above_kijun:
                votes["ichimoku"] = 1
            elif current < cloud_bottom and not tenkan_above_kijun:
                votes["ichimoku"] = -1
            else:
                votes["ichimoku"] = 0

        roc_value = rate_of_change(prices, self.ROC_PERIOD)
        if roc_value is None:
            votes["momentum"] = 0
        else:
            votes["momentum"] = (
                1
                if roc_value > self.ROC_THRESHOLD_PERCENT
                else (-1 if roc_value < -self.ROC_THRESHOLD_PERCENT else 0)
            )

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

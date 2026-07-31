"""
توابع خالص برای محاسبه اندیکاتورهای تکنیکال از یک سری قیمت.

چون API تبدیل کندل/OHLC نمی‌دهد، همه‌ی این توابع روی سری قیمت لحظه‌ای که
خودِ ربات با poll کردن جمع‌آوری می‌کند کار می‌کنند (نه کندل واقعی).
"""

from typing import List, Optional, Tuple


def rsi(prices: List[float], period: int = 14) -> Optional[float]:
    if len(prices) < period + 1:
        return None

    window = prices[-(period + 1):]
    gains = []
    losses = []
    for i in range(1, len(window)):
        change = window[i] - window[i - 1]
        if change > 0:
            gains.append(change)
        else:
            losses.append(-change)

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    if avg_loss == 0:
        return 100.0

    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _ema_series(values: List[float], period: int) -> List[float]:
    if len(values) < period:
        return []

    k = 2 / (period + 1)
    ema = [sum(values[:period]) / period]
    for value in values[period:]:
        ema.append(value * k + ema[-1] * (1 - k))
    return ema


def ema(prices: List[float], period: int) -> Optional[float]:
    series = _ema_series(prices, period)
    return series[-1] if series else None


def macd(
    prices: List[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    if len(prices) < slow + signal:
        return None, None, None

    fast_ema = _ema_series(prices, fast)
    slow_ema = _ema_series(prices, slow)
    offset = len(fast_ema) - len(slow_ema)
    macd_line = [f - s for f, s in zip(fast_ema[offset:], slow_ema)]

    if len(macd_line) < signal:
        return None, None, None

    signal_line = _ema_series(macd_line, signal)
    if not signal_line:
        return None, None, None

    histogram = macd_line[-1] - signal_line[-1]
    return macd_line[-1], signal_line[-1], histogram


def bollinger_bands(
    prices: List[float], period: int = 20, num_std: float = 2.0
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    if len(prices) < period:
        return None, None, None

    window = prices[-period:]
    mean = sum(window) / period
    variance = sum((p - mean) ** 2 for p in window) / period
    std = variance ** 0.5

    return mean - num_std * std, mean, mean + num_std * std


def stochastic_oscillator(
    prices: List[float], period: int = 14, smooth_k: int = 3, smooth_d: int = 3
) -> Tuple[Optional[float], Optional[float]]:
    if len(prices) < period + smooth_k + smooth_d - 1:
        return None, None

    raw_k = []
    for i in range(period, len(prices) + 1):
        window = prices[i - period:i]
        lowest, highest, current = min(window), max(window), window[-1]
        raw_k.append(50.0 if highest == lowest else (current - lowest) / (highest - lowest) * 100)

    if len(raw_k) < smooth_k:
        return None, None

    smoothed_k = [
        sum(raw_k[i - smooth_k:i]) / smooth_k for i in range(smooth_k, len(raw_k) + 1)
    ]

    if len(smoothed_k) < smooth_d:
        return smoothed_k[-1], None

    d = sum(smoothed_k[-smooth_d:]) / smooth_d
    return smoothed_k[-1], d


def ichimoku(
    prices: List[float],
    tenkan_period: int = 9,
    kijun_period: int = 26,
    senkou_b_period: int = 52,
) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:
    """
    خطوط اصلی ایچیموکو: Tenkan-sen، Kijun-sen، و ابر کومو (Senkou Span A/B).
    چون داده High/Low واقعی کندل در دسترس نیست، طبق فرمول استاندارد
    ایچیموکو (میانگین بالاترین و پایین‌ترین قیمت هر بازه) از همان سری
    قیمت لحظه‌ای تقریب زده می‌شود — مشابه رویکرد stochastic_oscillator در
    همین فایل. Senkou Span بدون جابه‌جایی به جلو (displacement) برگردانده
    می‌شود چون فقط برای مقایسه با قیمت لحظه‌ای فعلی استفاده می‌شود، نه
    رسم نمودار آینده.

    خروجی: (tenkan_sen, kijun_sen, senkou_span_a, senkou_span_b)
    """
    if len(prices) < senkou_b_period:
        return None, None, None, None

    def _midpoint(period: int) -> float:
        window = prices[-period:]
        return (max(window) + min(window)) / 2

    tenkan_sen = _midpoint(tenkan_period)
    kijun_sen = _midpoint(kijun_period)
    senkou_span_a = (tenkan_sen + kijun_sen) / 2
    senkou_span_b = _midpoint(senkou_b_period)

    return tenkan_sen, kijun_sen, senkou_span_a, senkou_span_b


def rate_of_change(prices: List[float], period: int = 10) -> Optional[float]:
    """
    درصد تغییر قیمت نسبت به `period` تیک قبل (مومنتوم کوتاه‌مدت). برخلاف
    RSI/MACD که خودشان هموارسازی (EMA/میانگین) دارند و واکنش‌شان به شتاب
    ناگهانی قیمت با تاخیر است، ROC مستقیم سرعت حرکت اخیر را اندازه
    می‌گیرد — برای موتور نوسان‌گیری که باید شتاب لحظه‌ای بازار را زود
    تشخیص دهد مکمل خوبی برای اندیکاتورهای دیگر است.
    """
    if len(prices) < period + 1:
        return None

    past = prices[-(period + 1)]
    if past == 0:
        return None

    current = prices[-1]
    return (current - past) / past * 100


def volatility_percent(prices: List[float], period: int = 20) -> Optional[float]:
    """
    انحراف معیار بازده‌های درصدی اخیر، به‌عنوان جایگزین تقریبی ATR
    (چون داده کندل/high-low در دسترس نیست).
    """
    if len(prices) < period + 1:
        return None

    window = prices[-(period + 1):]
    returns = [
        (window[i] - window[i - 1]) / window[i - 1] * 100
        for i in range(1, len(window))
        if window[i - 1] != 0
    ]
    if not returns:
        return None

    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / len(returns)
    return variance ** 0.5

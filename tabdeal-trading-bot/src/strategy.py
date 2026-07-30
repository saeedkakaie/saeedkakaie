from abc import ABC, abstractmethod
from collections import deque
from enum import Enum


class Signal(Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class Strategy(ABC):
    """
    اینترفیس پایه استراتژی. برای اضافه کردن استراتژی خودتان، از این کلاس
    ارث‌بری کنید و متد update را با منطق دلخواه پیاده‌سازی کنید، سپس در
    main.py به‌جای SmaCrossoverStrategy از کلاس خودتان استفاده کنید.
    """

    @abstractmethod
    def update(self, price: float) -> Signal:
        raise NotImplementedError


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

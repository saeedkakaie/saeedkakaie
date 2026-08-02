from dataclasses import dataclass
from typing import Optional


@dataclass
class Position:
    entry_price: float
    quantity: float
    stop_loss_percent: float
    # این عدد دیگر یک هدف سود ثابت نیست، بلکه عرض حد ضرر متحرک (trailing
    # stop) است: فاصله‌ی مجازی که قیمت می‌تواند از بالاترین مقدار دیده‌شده
    # (highest_price) پایین بیاید قبل از اینکه پوزیشن بسته شود. این باعث
    # می‌شود در یک پامپ قوی، ربات زودهنگام نفروشد و تا جایی که روند صعودی
    # ادامه دارد سود را دنبال کند.
    take_profit_percent: float
    highest_price: Optional[float] = None

    def __post_init__(self) -> None:
        if self.highest_price is None or self.highest_price < self.entry_price:
            self.highest_price = self.entry_price

    def update_highest_price(self, current_price: float) -> None:
        if current_price > self.highest_price:
            self.highest_price = current_price

    def unrealized_pnl_percent(self, current_price: float) -> float:
        if self.entry_price <= 0:
            return 0.0
        return (current_price - self.entry_price) / self.entry_price * 100

    @property
    def stop_price(self) -> float:
        return self.entry_price * (1 - self.stop_loss_percent / 100)

    @property
    def trailing_stop_price(self) -> float:
        return self.highest_price * (1 - self.take_profit_percent / 100)


PositionOrNone = Optional[Position]

from dataclasses import dataclass
from typing import Optional


@dataclass
class Position:
    entry_price: float
    quantity: float
    stop_loss_percent: float
    take_profit_percent: float

    def unrealized_pnl_percent(self, current_price: float) -> float:
        if self.entry_price <= 0:
            return 0.0
        return (current_price - self.entry_price) / self.entry_price * 100

    @property
    def stop_price(self) -> float:
        return self.entry_price * (1 - self.stop_loss_percent / 100)

    @property
    def target_price(self) -> float:
        return self.entry_price * (1 + self.take_profit_percent / 100)


PositionOrNone = Optional[Position]

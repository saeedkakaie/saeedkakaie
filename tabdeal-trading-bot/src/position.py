from dataclasses import dataclass
from typing import Optional


@dataclass
class Position:
    entry_price: float
    quantity: float

    def unrealized_pnl_percent(self, current_price: float) -> float:
        if self.entry_price <= 0:
            return 0.0
        return (current_price - self.entry_price) / self.entry_price * 100


PositionOrNone = Optional[Position]

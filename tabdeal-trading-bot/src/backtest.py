from dataclasses import dataclass
from typing import List, Optional, Tuple

from src.pnl import net_pnl_percent
from src.position import Position
from src.risk_manager import RiskManager
from src.strategy import Signal, TechnicalStrategy


@dataclass
class BacktestTrade:
    symbol: str
    entry_timestamp: str
    exit_timestamp: str
    entry_price: float
    exit_price: float
    gross_pnl_percent: float
    net_pnl_percent: float


def backtest_symbol(
    symbol: str,
    price_series: List[Tuple[str, float]],
    fee_percent: float,
    default_stop_loss_percent: float,
    default_take_profit_percent: float,
    max_daily_loss_percent: float,
) -> Tuple[List[BacktestTrade], Optional[dict]]:
    """
    دقیقا همان کلاس‌های زنده‌ی ربات (TechnicalStrategy، Position،
    RiskManager) را روی یک سری قیمت واقعی و ضبط‌شده (نه شبیه‌سازی مصنوعی)
    بازپخش می‌کند تا هیچ منطقی جدا و بالقوه ناهم‌خوان با کد واقعی نوشته
    نشود. فیلتر خبر عمدا خاموش است چون امتیاز خبر امروز برای یک قیمت
    قدیمی معنی ندارد.

    خروجی: (معاملات بسته‌شده, پوزیشن باز مانده در انتهای سری در صورت وجود
    — این یکی چون هنوز بسته نشده در آمار نرخ برد حساب نمی‌شود).
    """
    strategy = TechnicalStrategy(symbol=symbol, news_filter=None)
    risk_manager = RiskManager(
        stop_loss_percent=default_stop_loss_percent,
        take_profit_percent=default_take_profit_percent,
        max_daily_loss_percent=max_daily_loss_percent,
    )

    position: Optional[Position] = None
    entry_timestamp: Optional[str] = None
    trades: List[BacktestTrade] = []

    for timestamp, price in price_series:
        signal = strategy.update(price)

        if position is None:
            if signal == Signal.BUY and risk_manager.can_open_new_position():
                levels = strategy.suggested_risk_levels()
                if levels:
                    stop_loss_percent, take_profit_percent = levels
                else:
                    stop_loss_percent = default_stop_loss_percent
                    take_profit_percent = default_take_profit_percent
                position = Position(
                    entry_price=price,
                    quantity=1.0,
                    stop_loss_percent=stop_loss_percent,
                    take_profit_percent=take_profit_percent,
                )
                entry_timestamp = timestamp
            continue

        should_close = risk_manager.should_close_position(position, price) or signal == Signal.SELL
        if not should_close:
            continue

        gross_pnl_percent = position.unrealized_pnl_percent(price)
        net_pnl = net_pnl_percent(gross_pnl_percent, fee_percent)
        risk_manager.register_closed_trade(net_pnl)

        trades.append(
            BacktestTrade(
                symbol=symbol,
                entry_timestamp=entry_timestamp,
                exit_timestamp=timestamp,
                entry_price=position.entry_price,
                exit_price=price,
                gross_pnl_percent=gross_pnl_percent,
                net_pnl_percent=net_pnl,
            )
        )
        position = None
        entry_timestamp = None

    open_position = None
    if position is not None:
        open_position = {
            "symbol": symbol,
            "entry_timestamp": entry_timestamp,
            "entry_price": position.entry_price,
        }

    return trades, open_position


def summarize_trades(trades: List[BacktestTrade]) -> dict:
    total = len(trades)
    if total == 0:
        return {
            "total_trades": 0,
            "wins": 0,
            "losses": 0,
            "win_rate_percent": 0.0,
            "avg_win_percent": 0.0,
            "avg_loss_percent": 0.0,
            "expectancy_percent": 0.0,
            "total_net_pnl_percent": 0.0,
        }

    wins = [t for t in trades if t.net_pnl_percent > 0]
    losses = [t for t in trades if t.net_pnl_percent <= 0]
    avg_win = sum(t.net_pnl_percent for t in wins) / len(wins) if wins else 0.0
    avg_loss = sum(t.net_pnl_percent for t in losses) / len(losses) if losses else 0.0
    win_rate = len(wins) / total * 100
    expectancy = (win_rate / 100 * avg_win) + ((1 - win_rate / 100) * avg_loss)

    return {
        "total_trades": total,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_percent": win_rate,
        "avg_win_percent": avg_win,
        "avg_loss_percent": avg_loss,
        "expectancy_percent": expectancy,
        "total_net_pnl_percent": sum(t.net_pnl_percent for t in trades),
    }

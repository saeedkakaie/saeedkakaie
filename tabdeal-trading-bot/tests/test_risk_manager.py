from src.position import Position
from src.risk_manager import RiskManager


def make_risk_manager(**overrides):
    defaults = dict(
        stop_loss_percent=2,
        take_profit_percent=3,
        max_daily_loss_percent=5,
    )
    defaults.update(overrides)
    return RiskManager(**defaults)


def test_stop_loss_triggers_close():
    rm = make_risk_manager()
    position = Position(entry_price=100, quantity=1, stop_loss_percent=2, take_profit_percent=3)
    assert rm.should_close_position(position, current_price=97.9) is True


def test_take_profit_triggers_close():
    rm = make_risk_manager()
    position = Position(entry_price=100, quantity=1, stop_loss_percent=2, take_profit_percent=3)
    assert rm.should_close_position(position, current_price=103.5) is True


def test_no_close_within_thresholds():
    rm = make_risk_manager()
    position = Position(entry_price=100, quantity=1, stop_loss_percent=2, take_profit_percent=3)
    assert rm.should_close_position(position, current_price=100.5) is False


def test_uses_positions_own_thresholds_not_risk_manager_defaults():
    rm = make_risk_manager(stop_loss_percent=2, take_profit_percent=3)
    # پوزیشن با حد ضرر پویا (مثلا از استراتژی) متفاوت از تنظیمات پیش‌فرض
    position = Position(entry_price=100, quantity=1, stop_loss_percent=5, take_profit_percent=8)
    assert rm.should_close_position(position, current_price=97) is False
    assert rm.should_close_position(position, current_price=94.9) is True


def test_daily_loss_circuit_breaker_halts_bot():
    rm = make_risk_manager(max_daily_loss_percent=5)
    rm.register_closed_trade(pnl_percent=-3)
    assert rm.can_open_new_position() is True
    rm.register_closed_trade(pnl_percent=-3)
    assert rm.is_halted is True
    assert rm.can_open_new_position() is False

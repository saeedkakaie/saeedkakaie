from unittest.mock import patch

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


def test_daily_loss_circuit_breaker_notifies_exactly_once():
    rm = make_risk_manager(max_daily_loss_percent=5)
    with patch("src.risk_manager.notify") as mock_notify:
        rm.register_closed_trade(pnl_percent=-3)
        mock_notify.assert_not_called()

        rm.register_closed_trade(pnl_percent=-3)
        mock_notify.assert_called_once()

        # پوزیشن‌های بعدی که در همان روز بسته می‌شوند نباید دوباره اعلان بدهند
        rm.register_closed_trade(pnl_percent=-1)
        mock_notify.assert_called_once()


def test_restore_daily_state_reflects_persisted_trades():
    rm = make_risk_manager()
    rm.restore_daily_state(trades_today=3, daily_pnl_percent=1.5)
    assert rm.trades_today == 3
    assert rm.daily_pnl_percent == 1.5
    assert rm.is_halted is False


def test_restore_daily_state_re_halts_bot_after_a_restart():
    """
    رگرسیون برای یک شکاف امنیتی واقعی: قبل از این متد، هر ری‌استارت پردازش
    (مثلا برای گرفتن آپدیت) یک RiskManager کاملا تازه می‌ساخت و مدار قطع
    ضرر روزانه‌ای که قبل از ری‌استارت فعال شده بود را بی‌سروصدا خاموش
    می‌کرد — یعنی ربات دقیقا همان روزی که نباید، دوباره اجازه‌ی معامله
    پیدا می‌کرد.
    """
    rm = make_risk_manager(max_daily_loss_percent=5)
    with patch("src.risk_manager.notify") as mock_notify:
        rm.restore_daily_state(trades_today=2, daily_pnl_percent=-6.0)

        assert rm.is_halted is True
        assert rm.can_open_new_position() is False
        mock_notify.assert_called_once()

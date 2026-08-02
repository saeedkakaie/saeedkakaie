from src.pnl import net_pnl_percent, pnl_amount


def test_net_pnl_percent_subtracts_round_trip_fee():
    assert net_pnl_percent(10, 0.5) == 9.0


def test_net_pnl_percent_can_go_negative_on_small_gain():
    assert net_pnl_percent(0.2, 0.5) == -0.8


def test_pnl_amount_scales_with_position_value():
    assert pnl_amount(entry_price=100, quantity=10, net_pnl_percent_value=5) == 50.0


def test_pnl_amount_negative_for_loss():
    assert pnl_amount(entry_price=100, quantity=2, net_pnl_percent_value=-10) == -20.0

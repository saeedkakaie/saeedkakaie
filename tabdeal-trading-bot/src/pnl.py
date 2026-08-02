def net_pnl_percent(gross_pnl_percent: float, fee_percent: float) -> float:
    """کارمزد رفت‌وبرگشت (خرید + فروش) را از سود/زیان خام کم می‌کند."""
    return gross_pnl_percent - 2 * fee_percent


def pnl_amount(entry_price: float, quantity: float, net_pnl_percent_value: float) -> float:
    """سود/زیان مطلق بر حسب دارایی quote، بر مبنای ارزش پوزیشن در زمان ورود."""
    position_value = entry_price * quantity
    return position_value * net_pnl_percent_value / 100

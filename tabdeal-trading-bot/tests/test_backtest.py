from src.backtest import BacktestTrade, backtest_symbol, summarize_trades


def test_backtest_symbol_closes_a_losing_trade_on_stop_loss():
    # جهش پامپ (خرید فوری در ۱۰۹) و بلافاصله سقوط شدید که از حد ضرر
    # (حداکثر ۸٪) عبور می‌کند.
    prices = [100, 100, 100, 100, 100, 109, 90]
    timestamps = [f"2026-07-31T10:00:0{i}" for i in range(len(prices))]
    series = list(zip(timestamps, prices))

    trades, open_position = backtest_symbol(
        symbol="TEST_IRT",
        price_series=series,
        fee_percent=0.35,
        default_stop_loss_percent=2.0,
        default_take_profit_percent=3.0,
        max_daily_loss_percent=100.0,
    )

    assert open_position is None
    assert len(trades) == 1
    trade = trades[0]
    assert trade.entry_price == 109
    assert trade.exit_price == 90
    assert trade.net_pnl_percent < 0


def test_backtest_symbol_closes_a_winning_trade_via_trailing_stop():
    # بعد از خرید در پامپ، قیمت چند بار رکورد جدید می‌زند (حد ضرر متحرک
    # بالا می‌رود) و بعد کمی برمی‌گردد ولی هنوز بالای قیمت ورود است.
    prices = [100, 100, 100, 100, 100, 109, 115, 122, 130, 110]
    timestamps = [f"2026-07-31T10:00:{i:02d}" for i in range(len(prices))]
    series = list(zip(timestamps, prices))

    trades, open_position = backtest_symbol(
        symbol="TEST_IRT",
        price_series=series,
        fee_percent=0.0,
        default_stop_loss_percent=2.0,
        default_take_profit_percent=3.0,
        max_daily_loss_percent=100.0,
    )

    assert open_position is None
    assert len(trades) == 1
    trade = trades[0]
    assert trade.entry_price == 109
    assert trade.exit_price == 110
    assert trade.gross_pnl_percent > 0


def test_backtest_symbol_returns_open_position_when_series_ends_mid_trade():
    prices = [100, 100, 100, 100, 100, 109, 111]
    timestamps = [f"2026-07-31T10:00:0{i}" for i in range(len(prices))]
    series = list(zip(timestamps, prices))

    trades, open_position = backtest_symbol(
        symbol="TEST_IRT",
        price_series=series,
        fee_percent=0.35,
        default_stop_loss_percent=2.0,
        default_take_profit_percent=3.0,
        max_daily_loss_percent=100.0,
    )

    assert trades == []
    assert open_position is not None
    assert open_position["symbol"] == "TEST_IRT"
    assert open_position["entry_price"] == 109


def test_summarize_trades_computes_win_rate_and_expectancy():
    trades = [
        BacktestTrade("A", "t0", "t1", 100, 102, 2.0, 1.3),
        BacktestTrade("A", "t2", "t3", 100, 98, -2.0, -2.7),
        BacktestTrade("A", "t4", "t5", 100, 103, 3.0, 2.3),
    ]

    stats = summarize_trades(trades)

    assert stats["total_trades"] == 3
    assert stats["wins"] == 2
    assert stats["losses"] == 1
    assert round(stats["win_rate_percent"], 2) == round(2 / 3 * 100, 2)
    assert round(stats["avg_win_percent"], 4) == round((1.3 + 2.3) / 2, 4)
    assert stats["avg_loss_percent"] == -2.7
    assert round(stats["total_net_pnl_percent"], 2) == round(1.3 - 2.7 + 2.3, 2)


def test_summarize_trades_handles_empty_list():
    stats = summarize_trades([])
    assert stats["total_trades"] == 0
    assert stats["win_rate_percent"] == 0.0

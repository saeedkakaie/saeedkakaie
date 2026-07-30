import os
from datetime import datetime

from src.trade_journal import ClosedTrade, TradeJournal


def make_trade(timestamp, net_pnl_percent=9, net_pnl_amount=90):
    return ClosedTrade(
        timestamp=timestamp,
        symbol="BTC_IRT",
        entry_price=100,
        exit_price=110,
        quantity=1,
        gross_pnl_percent=10,
        net_pnl_percent=net_pnl_percent,
        net_pnl_amount=net_pnl_amount,
    )


def test_record_and_summary(tmp_path):
    journal = TradeJournal(os.path.join(tmp_path, "trades.jsonl"))
    journal.record(make_trade(datetime.now().isoformat()))

    summary = journal.summary()
    assert summary["day"]["trades"] == 1
    assert summary["day"]["net_pnl_percent"] == 9
    assert summary["day"]["net_pnl_amount"] == 90
    assert summary["month"]["trades"] == 1
    assert summary["year"]["trades"] == 1
    assert summary["all_time"]["trades"] == 1


def test_summary_empty_when_no_file(tmp_path):
    journal = TradeJournal(os.path.join(tmp_path, "missing.jsonl"))
    summary = journal.summary()
    assert summary["day"]["trades"] == 0
    assert summary["all_time"]["trades"] == 0


def test_old_trade_excluded_from_day_and_year_summary(tmp_path):
    journal = TradeJournal(os.path.join(tmp_path, "trades.jsonl"))
    journal.record(make_trade(datetime(2020, 1, 1).isoformat(), net_pnl_percent=-11, net_pnl_amount=-110))

    summary = journal.summary(now=datetime.now())
    assert summary["day"]["trades"] == 0
    assert summary["year"]["trades"] == 0
    assert summary["all_time"]["trades"] == 1
    assert summary["all_time"]["net_pnl_percent"] == -11


def test_multiple_trades_sum_within_period(tmp_path):
    journal = TradeJournal(os.path.join(tmp_path, "trades.jsonl"))
    now_iso = datetime.now().isoformat()
    journal.record(make_trade(now_iso, net_pnl_percent=5, net_pnl_amount=50))
    journal.record(make_trade(now_iso, net_pnl_percent=-2, net_pnl_amount=-20))

    summary = journal.summary()
    assert summary["day"]["trades"] == 2
    assert summary["day"]["net_pnl_percent"] == 3
    assert summary["day"]["net_pnl_amount"] == 30

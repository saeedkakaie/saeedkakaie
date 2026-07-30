from src.market_scanner import (
    _extract_quantity_precision,
    _precision_from_step_size,
    discover_watchlist,
    fetch_quantity_precisions,
)


class FakeClient:
    def __init__(self, symbols, trades_by_symbol, raw_shape="dict"):
        self._symbols = symbols
        self._trades_by_symbol = trades_by_symbol
        self._raw_shape = raw_shape

    def exchange_info(self):
        if self._raw_shape == "list":
            return self._symbols
        return {"symbols": self._symbols}

    def trades(self, symbol, limit=20):
        return self._trades_by_symbol.get(symbol, [])


class FakeExchange:
    def __init__(self, client):
        self.client = client


def test_filters_by_quote_asset_and_ranks_by_activity():
    symbols = [
        {"tabdealSymbol": "BTC_IRT", "status": "TRADING"},
        {"tabdealSymbol": "ETH_IRT", "status": "TRADING"},
        {"tabdealSymbol": "BTC_USDT", "status": "TRADING"},
        {"tabdealSymbol": "DOGE_IRT", "status": "DISABLED"},
    ]
    trades_by_symbol = {
        "BTC_IRT": [{"price": "100", "qty": "10"}],
        "ETH_IRT": [{"price": "50", "qty": "1"}],
    }
    exchange = FakeExchange(FakeClient(symbols, trades_by_symbol))

    watchlist = discover_watchlist(exchange, quote_asset="IRT", size=5)

    assert watchlist == ["BTC_IRT", "ETH_IRT"]


def test_size_limit_applied_to_most_active_symbols():
    symbols = [{"tabdealSymbol": f"C{i}_IRT", "status": "TRADING"} for i in range(5)]
    trades_by_symbol = {f"C{i}_IRT": [{"price": "1", "qty": str(i)}] for i in range(5)}
    exchange = FakeExchange(FakeClient(symbols, trades_by_symbol))

    watchlist = discover_watchlist(exchange, quote_asset="IRT", size=2)

    assert watchlist == ["C4_IRT", "C3_IRT"]


def test_handles_exchange_info_returning_a_bare_list():
    # روی صرافی واقعی تبدیل، exchange_info() یک لیست خام برمی‌گرداند نه دیکشنری.
    symbols = [
        {"tabdealSymbol": "BTC_IRT", "status": "TRADING"},
        {"tabdealSymbol": "ETH_IRT", "status": "TRADING"},
    ]
    trades_by_symbol = {
        "BTC_IRT": [{"price": "100", "qty": "10"}],
        "ETH_IRT": [{"price": "50", "qty": "1"}],
    }
    exchange = FakeExchange(FakeClient(symbols, trades_by_symbol, raw_shape="list"))

    watchlist = discover_watchlist(exchange, quote_asset="IRT", size=5)

    assert watchlist == ["BTC_IRT", "ETH_IRT"]


def test_fallback_on_exchange_info_failure():
    class BrokenClient:
        def exchange_info(self):
            raise RuntimeError("network down")

    exchange = FakeExchange(BrokenClient())
    watchlist = discover_watchlist(exchange, quote_asset="IRT", size=5)

    assert watchlist


def test_precision_from_step_size():
    assert _precision_from_step_size("0.00001") == 5
    assert _precision_from_step_size("1.00000000") == 0
    assert _precision_from_step_size("0.1") == 1
    assert _precision_from_step_size("1") == 0


def test_extract_quantity_precision_from_direct_field():
    entry = {"baseAssetPrecision": 3}
    assert _extract_quantity_precision(entry, default=6) == 3


def test_extract_quantity_precision_from_lot_size_filter():
    entry = {
        "filters": [
            {"filterType": "PRICE_FILTER", "tickSize": "0.01"},
            {"filterType": "LOT_SIZE", "stepSize": "0.0001"},
        ]
    }
    assert _extract_quantity_precision(entry, default=6) == 4


def test_extract_quantity_precision_falls_back_to_default():
    entry = {"someOtherField": 123}
    assert _extract_quantity_precision(entry, default=6) == 6


def test_fetch_quantity_precisions_per_symbol():
    symbols = [
        {"tabdealSymbol": "BTC_IRT", "baseAssetPrecision": 6},
        {"tabdealSymbol": "DOGE_IRT", "baseAssetPrecision": 0},
    ]
    exchange = FakeExchange(FakeClient(symbols, trades_by_symbol={}))

    precisions = fetch_quantity_precisions(exchange, ["BTC_IRT", "DOGE_IRT", "MISSING_IRT"], default_precision=2)

    assert precisions == {"BTC_IRT": 6, "DOGE_IRT": 0, "MISSING_IRT": 2}


def test_fetch_quantity_precisions_falls_back_on_error():
    class BrokenClient:
        def exchange_info(self):
            raise RuntimeError("network down")

    exchange = FakeExchange(BrokenClient())
    precisions = fetch_quantity_precisions(exchange, ["BTC_IRT", "ETH_IRT"], default_precision=3)

    assert precisions == {"BTC_IRT": 3, "ETH_IRT": 3}

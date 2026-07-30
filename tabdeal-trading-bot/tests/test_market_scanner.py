from src.market_scanner import discover_watchlist


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

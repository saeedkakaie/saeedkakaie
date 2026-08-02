from unittest.mock import MagicMock, patch

from tabdeal.enums import RequestTypes, SecurityTypes

from src.exchange_client import ExchangeClient, _describe_exception, _normalize_order


class FakeClientException(Exception):
    def __init__(self, message, code, status, detail=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.detail = detail

    def __str__(self):
        return self.message


def test_describe_exception_includes_code_status_and_detail():
    exc = FakeClientException("Invalid Signature.", code=-1022, status=400, detail="check your secret")
    description = _describe_exception(exc)
    assert "Invalid Signature." in description
    assert "code=-1022" in description
    assert "status=400" in description
    assert "detail=check your secret" in description


def test_describe_exception_falls_back_to_plain_str_for_generic_exceptions():
    description = _describe_exception(RuntimeError("network down"))
    assert description == "network down"


def test_describe_exception_omits_missing_detail():
    exc = FakeClientException("Invalid Signature.", code=-1022, status=400, detail=None)
    description = _describe_exception(exc)
    assert "detail=" not in description


def _make_client():
    with patch("src.exchange_client.Spot"):
        return ExchangeClient(api_key="key", api_secret="secret", dry_run=True)


def test_clock_skew_hint_reports_difference_from_server_time():
    client = _make_client()
    local_ms = 1_700_000_000_000
    server_ms = local_ms - 5000  # سرور ۵ ثانیه عقب‌تر
    client.client.time = MagicMock(return_value={"serverTime": server_ms})

    with patch("src.exchange_client.time.time", return_value=local_ms / 1000):
        hint = client._clock_skew_hint()

    assert "5.0" in hint


def test_clock_skew_hint_empty_when_time_call_fails():
    client = _make_client()
    client.client.time = MagicMock(side_effect=Exception("network down"))
    assert client._clock_skew_hint() == ""


def test_clock_skew_hint_empty_when_response_has_no_known_field():
    client = _make_client()
    client.client.time = MagicMock(return_value={"unexpected": 123})
    assert client._clock_skew_hint() == ""


def test_get_account_passes_a_fresh_dict_on_every_call():
    """
    رگرسیون برای باگ mutable-default-argument در Spot.account() رسمی: هر
    فراخوانی _get_account باید یک دیکشنری data تازه (بدون کلید باقیمانده
    از فراخوانی قبلی) به request() پاس بدهد، نه یک آبجکت مشترک.
    """
    client = _make_client()
    client.client.request = MagicMock(return_value={"balances": []})

    client._get_account()
    client._get_account()

    assert client.client.request.call_count == 2
    first_call_data = client.client.request.call_args_list[0].kwargs["data"]
    second_call_data = client.client.request.call_args_list[1].kwargs["data"]

    assert first_call_data == {}
    assert second_call_data == {}
    assert first_call_data is not second_call_data


def test_get_account_uses_trade_security_and_get_method():
    client = _make_client()
    client.client.request = MagicMock(return_value={"balances": []})

    client._get_account()

    _, kwargs = client.client.request.call_args
    assert kwargs["url"] == "account"
    assert kwargs["method"] == RequestTypes.GET
    assert kwargs["security_type"] == SecurityTypes.TRADE


def test_official_sdk_account_shares_a_mutated_dict_across_calls():
    """
    این تست خودِ باگ را در SDK رسمی نصب‌شده اثبات می‌کند (نه کد ما): چون
    Spot.account() آرگومان data را صدا نمی‌زند، پارامتر پیش‌فرض mutable
    تابع request() بین فراخوانی‌ها به اشتراک می‌رود. اگر این تست در
    نسخه‌ی جدیدتر SDK قرمز شد یعنی باگ رفع شده و _get_account/این تست
    می‌توانند حذف شوند.
    """
    from tabdeal.spot import Spot

    client = Spot(api_key="key", api_secret="secret")
    client.session.get = MagicMock(return_value=MagicMock(status_code=200, json=lambda: {}))

    client.account()
    first_params = client.session.get.call_args.kwargs["params"]
    assert "signature" in first_params

    client.account()
    second_params = client.session.get.call_args.kwargs["params"]

    # همان آبجکت دیکشنری بین دو فراخوانی به اشتراک رفته است
    assert first_params is second_params


def test_normalize_order_reads_own_price_quantity_keys():
    order = {"price": "123.45", "quantity": "2.5"}
    result = _normalize_order(order, side="خرید", symbol="BTC_IRT", fallback_price=1, fallback_quantity=1)
    assert result == {"price": 123.45, "quantity": 2.5}


def test_normalize_order_reads_binance_style_executed_qty_and_price():
    order = {"executedQty": "3.0", "price": "0.00000000", "cummulativeQuoteQty": "300.0"}
    result = _normalize_order(order, side="خرید", symbol="BTC_IRT", fallback_price=1, fallback_quantity=1)
    # MARKET orders often report price=0; cummulativeQuoteQty/executedQty gives the real average
    assert result["quantity"] == 3.0
    assert result["price"] == 100.0


def test_normalize_order_reads_average_price_from_fills():
    order = {
        "executedQty": "3.0",
        "fills": [
            {"price": "100.0", "qty": "1.0"},
            {"price": "110.0", "qty": "2.0"},
        ],
    }
    result = _normalize_order(order, side="خرید", symbol="BTC_IRT", fallback_price=1, fallback_quantity=1)
    assert result["quantity"] == 3.0
    assert result["price"] == (100.0 * 1.0 + 110.0 * 2.0) / 3.0


def test_normalize_order_falls_back_to_local_estimate_on_unknown_shape():
    """
    رگرسیون برای باگ واقعی: پاسخ new_order() با ساختار ناشناخته دیگر نباید
    KeyError بیندازد و پوزیشن واقعی را کاملا بدون ردیابی رها کند؛ باید از
    قیمت/مقدار محلی محاسبه‌شده قبل از ثبت سفارش استفاده کند.
    """
    order = {"orderId": 123, "status": "FILLED"}
    result = _normalize_order(order, side="خرید", symbol="TT_IRT", fallback_price=42.0, fallback_quantity=7.0)
    assert result == {"price": 42.0, "quantity": 7.0}


def test_normalize_order_handles_non_dict_response():
    result = _normalize_order(None, side="خرید", symbol="TT_IRT", fallback_price=42.0, fallback_quantity=7.0)
    assert result == {"price": 42.0, "quantity": 7.0}


def test_normalize_order_subtracts_commission_paid_in_base_asset_on_buy():
    """
    رگرسیون برای مورد واقعی KITE_IRT: وقتی کارمزد از همان دارایی خریداری‌شده
    کسر می‌شود، quantity ثبت‌شده در پوزیشن باید مقدار واقعا قابل فروش باشد،
    وگرنه فروش بعدی به همان مقدار خام با «موجودی کافی نیست» رد می‌شود.
    """
    order = {
        "executedQty": "163.057",
        "fills": [{"price": "18238.0", "qty": "163.057", "commission": "0.538088", "commissionAsset": "KITE"}],
    }
    result = _normalize_order(order, side="خرید", symbol="KITE_IRT", fallback_price=1, fallback_quantity=1)
    assert result["quantity"] == 163.057 - 0.538088


def test_normalize_order_ignores_commission_paid_in_a_different_asset():
    order = {
        "executedQty": "3.0",
        "fills": [{"price": "100.0", "qty": "3.0", "commission": "0.01", "commissionAsset": "TBDL"}],
    }
    result = _normalize_order(order, side="خرید", symbol="BTC_IRT", fallback_price=1, fallback_quantity=1)
    assert result["quantity"] == 3.0


def test_normalize_order_does_not_subtract_commission_on_sell():
    order = {
        "executedQty": "3.0",
        "fills": [{"price": "100.0", "qty": "3.0", "commission": "0.01", "commissionAsset": "BTC"}],
    }
    result = _normalize_order(order, side="فروش", symbol="BTC_IRT", fallback_price=1, fallback_quantity=1)
    assert result["quantity"] == 3.0


def test_normalize_order_floors_quantity_to_precision_after_commission_subtraction():
    """
    رگرسیون برای خطای واقعی «دقت اعشار مقدار رعایت نشده»: کسر کارمزد
    می‌تواند رقم اعشار غیرمنتظره (نویز floating-point) تولید کند؛ نتیجه‌ی
    نهایی باید همیشه به دقت مجاز نماد گرد شده باشد.
    """
    order = {
        "executedQty": "163.057",
        "fills": [{"price": "18238.0", "qty": "163.057", "commission": "0.538088", "commissionAsset": "KITE"}],
    }
    result = _normalize_order(
        order, side="خرید", symbol="KITE_IRT", fallback_price=1, fallback_quantity=1, quantity_precision=4
    )
    assert result["quantity"] == 162.5189


def _make_live_client():
    with patch("src.exchange_client.Spot"):
        return ExchangeClient(api_key="key", api_secret="secret", dry_run=False)


def test_buy_market_normalizes_binance_style_live_response():
    client = _make_live_client()
    client.client.depth = MagicMock(return_value={"bids": [["99", "1"]], "asks": [["101", "1"]]})
    client.client.new_order = MagicMock(
        return_value={"executedQty": "1.0", "cummulativeQuoteQty": "100.0", "price": "0"}
    )

    order = client.buy_market("BTC_IRT", quote_amount=100.0, quantity_precision=4)

    assert order == {"price": 100.0, "quantity": 1.0}


def test_buy_market_never_loses_position_data_on_unknown_response_shape():
    client = _make_live_client()
    client.client.depth = MagicMock(return_value={"bids": [["99", "1"]], "asks": [["101", "1"]]})
    client.client.new_order = MagicMock(return_value={"orderId": 1, "status": "FILLED"})

    order = client.buy_market("BTC_IRT", quote_amount=100.0, quantity_precision=4)

    assert order is not None
    assert order["quantity"] == round(100.0 / 100.0, 4)
    assert order["price"] == 100.0


def test_sell_market_clamps_quantity_to_actual_free_balance_when_lower():
    """
    رگرسیون برای مورد واقعی: پوزیشنی که قبل از فیکس کارمزد ثبت شده بود
    (مثلا CHZ_IRT) مقدار ثبت‌شده‌اش کمی از موجودی آزاد واقعی بیشتر بود و هر
    تلاش برای فروش با «موجودی کافی نیست» رد می‌شد. حالا باید همیشه موجودی
    واقعی مرجع باشد، نه عدد ذخیره‌شده در پوزیشن.
    """
    client = _make_live_client()
    client.client.depth = MagicMock(return_value={"bids": [["99", "1"]], "asks": [["101", "1"]]})
    client._get_account = MagicMock(return_value={"balances": [{"asset": "BTC", "free": "1.9", "locked": "0"}]})
    client.client.new_order = MagicMock(return_value={"executedQty": "1.9", "cummulativeQuoteQty": "190.0"})

    client.sell_market("BTC_IRT", quantity=2.0, quantity_precision=8)

    _, kwargs = client.client.new_order.call_args
    assert kwargs["quantity"] == str(1.9)


def test_sell_market_floors_clamped_quantity_to_symbol_precision():
    """
    رگرسیون برای مورد واقعی: بعد از کلمپ به موجودی آزاد واقعی (که ممکن است
    رقم اعشار بیشتری از دقت مجاز نماد داشته باشد)، صرافی سفارش را با خطای
    «دقت اعشار مقدار رعایت نشده» رد می‌کرد. باید همیشه به دقت مجاز نماد
    گرد شود، نه فقط به موجودی خام.
    """
    client = _make_live_client()
    client.client.depth = MagicMock(return_value={"bids": [["99", "1"]], "asks": [["101", "1"]]})
    client._get_account = MagicMock(
        return_value={"balances": [{"asset": "BTC", "free": "1.987654321", "locked": "0"}]}
    )
    client.client.new_order = MagicMock(return_value={"executedQty": "1.98", "cummulativeQuoteQty": "198.0"})

    client.sell_market("BTC_IRT", quantity=2.0, quantity_precision=2)

    _, kwargs = client.client.new_order.call_args
    assert kwargs["quantity"] == str(1.98)


def test_sell_market_does_not_clamp_when_actual_balance_is_sufficient():
    client = _make_live_client()
    client.client.depth = MagicMock(return_value={"bids": [["99", "1"]], "asks": [["101", "1"]]})
    client._get_account = MagicMock(return_value={"balances": [{"asset": "BTC", "free": "5.0", "locked": "0"}]})
    client.client.new_order = MagicMock(return_value={"executedQty": "2.0", "cummulativeQuoteQty": "200.0"})

    client.sell_market("BTC_IRT", quantity=2.0, quantity_precision=8)

    _, kwargs = client.client.new_order.call_args
    assert kwargs["quantity"] == str(2.0)


def test_sell_market_skips_clamp_when_balance_lookup_fails():
    client = _make_live_client()
    client.client.depth = MagicMock(return_value={"bids": [["99", "1"]], "asks": [["101", "1"]]})
    client._get_account = MagicMock(side_effect=Exception("network down"))
    client.client.new_order = MagicMock(return_value={"executedQty": "2.0", "cummulativeQuoteQty": "200.0"})

    client.sell_market("BTC_IRT", quantity=2.0, quantity_precision=8)

    _, kwargs = client.client.new_order.call_args
    assert kwargs["quantity"] == str(2.0)


def test_sell_market_normalizes_binance_style_live_response():
    client = _make_live_client()
    client.client.depth = MagicMock(return_value={"bids": [["99", "1"]], "asks": [["101", "1"]]})
    client.client.new_order = MagicMock(
        return_value={"executedQty": "2.0", "cummulativeQuoteQty": "200.0", "price": "0"}
    )

    order = client.sell_market("BTC_IRT", quantity=2.0, quantity_precision=8)

    assert order == {"price": 100.0, "quantity": 2.0}

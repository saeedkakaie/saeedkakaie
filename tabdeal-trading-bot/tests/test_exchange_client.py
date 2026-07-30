from unittest.mock import MagicMock, patch

from tabdeal.enums import RequestTypes, SecurityTypes

from src.exchange_client import ExchangeClient, _describe_exception


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

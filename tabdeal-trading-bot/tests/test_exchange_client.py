from unittest.mock import MagicMock, patch

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

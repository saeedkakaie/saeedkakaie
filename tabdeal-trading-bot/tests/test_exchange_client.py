from src.exchange_client import _describe_exception


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

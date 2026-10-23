import anthropic
import httpx

from ibp_engine import agent


class _Resp:
    def __init__(self, data):
        self._d = data

    def to_dict(self):
        return self._d


class _Fake:
    """کلاینت ساختگی: درخواست را ثبت می‌کند و پاسخ آماده برمی‌گرداند (بدون تماس واقعی با API)."""

    def __init__(self, data=None, exc=None):
        self.calls = []
        self.data, self.exc = data, exc
        fake = self

        class _M:
            def create(self, **kw):
                fake.calls.append(kw)
                if fake.exc:
                    raise fake.exc
                return _Resp(fake.data)

        class _B:
            messages = _M()

        self.beta = _B()


TOOL = {"name": "company_overview", "description": "KPIs", "input_schema": {"type": "object", "properties": {}, "required": []}}


def test_request_shape_and_passthrough():
    content = [{"type": "thinking", "thinking": "", "signature": "s"}, {"type": "tool_use", "id": "t1", "name": "company_overview", "input": {}}]
    fake = _Fake({"content": content, "stop_reason": "tool_use", "model": agent.MODEL, "usage": {"input_tokens": 10, "output_tokens": 5}})
    out = agent.chat({"messages": [{"role": "user", "content": "فروش؟"}], "tools": [TOOL, {"bad": 1}], "context": {"company": "زرماکارون", "code": "ZMC"}, "effort": "high"}, client=fake)
    kw = fake.calls[0]
    assert kw["model"] == "claude-opus-5-5" and kw["fallbacks"] == "default" and kw["betas"] == [agent.FALLBACK_BETA]
    assert kw["output_config"] == {"effort": "high"} and "thinking" not in kw and "tool_choice" not in kw
    assert len(kw["tools"]) == 1 and kw["tools"][0]["strict"] is True and kw["tools"][0]["input_schema"]["additionalProperties"] is False
    assert "زرماکارون" in kw["system"] and "Persian" in kw["system"]
    assert out["content"] == content and out["stop_reason"] == "tool_use" and out["fallback"] is False
    assert out["usage"]["input_tokens"] == 10


def test_fallback_and_refusal_reported():
    fake = _Fake({"content": [{"type": "fallback"}, {"type": "text", "text": "پاسخ"}], "stop_reason": "end_turn", "model": "x", "usage": {}})
    assert agent.chat({"messages": [{"role": "user", "content": "x"}]}, client=fake)["fallback"] is True
    ref = _Fake({"content": [], "stop_reason": "refusal", "stop_details": {"category": None, "explanation": "no"}, "usage": {}})
    out = agent.chat({"messages": [{"role": "user", "content": "x"}]}, client=ref)
    assert out["stop_reason"] == "refusal" and out["stop_details"]["explanation"] == "no"


def test_errors_mapped_without_raising():
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    rl = anthropic.RateLimitError("slow down", response=httpx.Response(429, request=req), body=None)
    assert agent.chat({"messages": [{"role": "user", "content": "x"}]}, client=_Fake(exc=rl))["error"]["type"] == "rate_limit"
    conn = anthropic.APIConnectionError(request=req)
    assert agent.chat({"messages": [{"role": "user", "content": "x"}]}, client=_Fake(exc=conn))["error"]["type"] == "connection"
    assert agent.chat({"messages": []}, client=_Fake({}))["error"]["type"] == "invalid_request"


def test_unavailable_without_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert agent.available()["claude"] is False
    assert agent.chat({"messages": [{"role": "user", "content": "x"}]})["error"]["type"] == "unavailable"

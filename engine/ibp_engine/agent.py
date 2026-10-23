"""دستیار هوشمند (فاز ۷): پل امن بین برنامه و Claude.

کلید API فقط روی همین سرویس (متغیر محیطی ANTHROPIC_API_KEY) نگه داشته می‌شود و هرگز به مرورگر نمی‌رسد.
ابزارها (پرس‌وجو روی داده‌های شرکت) در خود برنامه اجرا می‌شوند؛ این سرویس در هر نوبت یک درخواست
به Claude می‌فرستد و پاسخ را بی‌تغییر برمی‌گرداند. حلقه ابزار در برنامه است:
    برنامه ← /agent/chat ← Claude ← (tool_use) ← برنامه ابزار را اجرا می‌کند ← /agent/chat ...
تاریخچه گفتگو فقط افزوده می‌شود (محتوای پاسخ‌ها، از جمله بلوک‌های تفکر، بی‌تغییر بازفرستاده می‌شوند).
"""
from __future__ import annotations

import os
from typing import Any

MODEL = "claude-opus-5-5"
MAX_TOKENS = 16000
FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_TOOLS = 32

SYSTEM = """You are the analytics assistant inside an Integrated Business Planning (IBP / S&OP) application used by {holding}.
The user works in the workspace of the company «{company}» (code {code}, business model {model}, planning cycle {cycle}).
Industry: food manufacturing in Iran. Calendar: Jalali (Persian) months. Money is in Iranian rials; amounts in tool results are raw rials
and the app usually shows them in {unit}.

How to work:
- Always answer in Persian (Farsi), concise and professional, for planners and managers.
- Base every number on tool results. Call the tools to get data before answering; never invent figures.
  If the data needed is not available through the tools, say so plainly.
- Prefer one or a few well-chosen tool calls; independent calls can be made in parallel.
- Charts and tables returned by tools are shown to the user automatically next to your answer, so do not repeat whole tables:
  summarise the key numbers, explain what drives them, and finish with 2-4 concrete, actionable recommendations
  (who should do what: demand planning, supply, procurement, finance, sales).
- Format numbers in a readable way (e.g. «۱۲٫۴ میلیارد ریال», «۸٪»). Use short paragraphs and bullet lists; no headings larger than ###.
- For what-if questions use run_scenario; for "why" questions use explain_change; for trends and seasonality use trend_analysis.
"""


def available() -> dict[str, Any]:
    """وضعیت دسترسی به Claude برای /health (بدون افشای کلید)."""
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return {"claude": False, "model": MODEL, "reason": "sdk"}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"claude": False, "model": MODEL, "reason": "key"}
    return {"claude": True, "model": MODEL}


_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic()  # کلید از ANTHROPIC_API_KEY
    return _client


def _clean_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """ابزارهای ارسالی برنامه: فقط فیلدهای مجاز، با strict برای تضمین ساختار ورودی."""
    out = []
    for t in (tools or [])[:MAX_TOOLS]:
        if not isinstance(t, dict) or not t.get("name") or not isinstance(t.get("input_schema"), dict):
            continue
        schema = dict(t["input_schema"])
        schema.setdefault("type", "object")
        schema["additionalProperties"] = False
        out.append({"name": str(t["name"])[:64], "description": str(t.get("description", ""))[:4000], "input_schema": schema, "strict": True})
    return out


def _system(ctx: dict[str, Any]) -> str:
    c = ctx or {}
    text = SYSTEM.format(
        holding=c.get("holding") or "a food holding",
        company=c.get("company") or "-",
        code=c.get("code") or "-",
        model=c.get("businessModel") or "-",
        cycle=c.get("cycle") or "-",
        unit=c.get("unit") or "billion rials",
    )
    extra = c.get("notes")
    if extra:
        text += "\nWorkspace notes:\n" + str(extra)[:4000]
    return text


def _error(kind: str, message: str, status: int | None = None) -> dict[str, Any]:
    return {"error": {"type": kind, "message": message, "status": status}}


def chat(payload: dict[str, Any], client: Any = None) -> dict[str, Any]:
    """یک نوبت گفتگو با Claude. ورودی: messages (قالب Messages API)، tools، context، effort."""
    info = available()
    if client is None and not info["claude"]:
        return _error("unavailable", "کلید ANTHROPIC_API_KEY روی سرور موتور تنظیم نشده است." if info.get("reason") == "key" else "بسته anthropic روی موتور نصب نیست.")
    messages = payload.get("messages") or []
    if not messages or not isinstance(messages, list):
        return _error("invalid_request", "پیامی ارسال نشده است.")
    effort = payload.get("effort") if payload.get("effort") in ("low", "medium", "high") else "medium"

    import anthropic
    cl = client or _get_client()
    try:
        resp = cl.beta.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=_system(payload.get("context") or {}),
            tools=_clean_tools(payload.get("tools") or []),
            messages=messages,
            output_config={"effort": effort},
            cache_control={"type": "ephemeral"},
            betas=[FALLBACK_BETA],
            fallbacks="default",
        )
    except anthropic.BadRequestError as e:
        return _error("invalid_request", str(getattr(e, "message", e)), 400)
    except anthropic.AuthenticationError:
        return _error("authentication", "کلید API نامعتبر است.", 401)
    except anthropic.PermissionDeniedError:
        return _error("permission", "کلید API به این مدل دسترسی ندارد.", 403)
    except anthropic.RateLimitError:
        return _error("rate_limit", "محدودیت تعداد درخواست؛ کمی بعد دوباره امتحان کنید.", 429)
    except anthropic.APIStatusError as e:
        return _error("api", "خطای سرویس Claude (" + str(e.status_code) + ")", e.status_code)
    except anthropic.APIConnectionError:
        return _error("connection", "اتصال موتور به سرویس Claude برقرار نشد (اینترنت یا پراکسی را بررسی کنید).")

    data = resp.to_dict()
    content = data.get("content") or []
    fallback_ran = any(b.get("type") == "fallback" for b in content) or any(
        (it or {}).get("type") == "fallback_message" for it in ((data.get("usage") or {}).get("iterations") or [])
    )
    return {
        "content": content,  # بی‌تغییر؛ برنامه آن را عیناً به تاریخچه اضافه می‌کند
        "stop_reason": data.get("stop_reason"),
        "stop_details": data.get("stop_details"),
        "model": data.get("model"),
        "fallback": bool(fallback_ran),
        "usage": {k: (data.get("usage") or {}).get(k) for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")},
    }

"""سرویس FastAPI موتور تحلیل.

برنامه (HTML) از طریق http://127.0.0.1:8765 با این سرویس کار می‌کند؛ صفحه ممکن است از file://
باز شده باشد، پس CORS برای همه مبداها و درخواست شبکه خصوصی (Private Network Access) باز است.
سرویس فقط روی 127.0.0.1 گوش می‌دهد و داده‌ای ذخیره نمی‌کند.
"""
from __future__ import annotations

import platform
from typing import Any

import numpy
import pandas
import sklearn
import statsmodels
from fastapi import Body, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import __version__, demand, portfolio, reports

app = FastAPI(title="IBP Analysis Engine", version=__version__)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    if request.method == "OPTIONS" and request.headers.get("access-control-request-private-network"):
        resp = Response(status_code=204)
        resp.headers["Access-Control-Allow-Origin"] = request.headers.get("origin", "*")
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = request.headers.get("access-control-request-headers", "*")
        resp.headers["Access-Control-Allow-Private-Network"] = "true"
        return resp
    resp = await call_next(request)
    resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "engine": "IBP Analysis Engine",
        "version": __version__,
        "python": platform.python_version(),
        "libraries": {
            "numpy": numpy.__version__, "pandas": pandas.__version__,
            "statsmodels": statsmodels.__version__, "scikit-learn": sklearn.__version__,
        },
        "capabilities": ["portfolio.analyze", "reports.xlsx", "demand.forecast", "demand.event-effects"],
    }


@app.post("/portfolio/analyze")
def portfolio_analyze(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return portfolio.analyze(payload)


@app.post("/demand/forecast")
def demand_forecast(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return demand.forecast(payload)


@app.post("/demand/event-effects")
def demand_event_effects(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return demand.event_effects(payload)


@app.post("/reports/xlsx")
def report_xlsx(spec: dict[str, Any] = Body(...)) -> Response:
    data = reports.build_report(spec)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="report.xlsx"'},
    )

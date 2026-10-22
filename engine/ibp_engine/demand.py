"""پیش‌بینی آماری تقاضا و برآورد اثر مناسبت‌ها.

ورودی از برنامه می‌آید (forecast.js → enginePayload):
    periods: ماه‌های تاریخچه (yyyymm)، future: ماه‌های افق
    events: {hist: [[ramadan, muharram, campaign], ...], future: [...]} شدت مناسبت‌ها در هر ماه (۰ تا ۱)
    products: [{id, familyId, from, qty, factorHist, factorFuture}]
        qty از اندیس from تاریخچه شروع می‌شود (محصولات جدید سابقه کوتاه‌تری دارند)
        factor*: ضریب اثر مناسبت‌ها بر اساس اثرهای ثبت‌شده در برنامه (برای روش‌های غیررگرسیونی)

روش‌ها با اعتبارسنجی چرخشی (سه مبدأ، افق سه ماه) مقایسه و بهترین روش (یا ترکیب دو روش برتر) انتخاب می‌شود.
"""
from __future__ import annotations

import math
import warnings
from typing import Any

import numpy as np
import statsmodels.api as sm
from statsmodels.tsa.holtwinters import ExponentialSmoothing, Holt, SimpleExpSmoothing

warnings.filterwarnings("ignore")

LABELS = {
    "snaive": "فصلی ساده", "ma3": "میانگین متحرک", "ses": "هموارسازی نمایی + فصل", "holt": "روند میرا + فصل",
    "hw": "هولت-وینترز", "reg": "رگرسیون فصل و مناسبت", "croston": "کراستون (SBA)", "tsb": "TSB", "ensemble": "ترکیب مدل‌ها",
}
Z80 = 1.2816


def _months(periods: list[int]) -> np.ndarray:
    return np.array([p % 100 for p in periods]) - 1


def seasonal_index(y: np.ndarray, mo: np.ndarray) -> np.ndarray:
    """شاخص فصلی با نسبت به میانگین متحرک مرکزی ۱۲ ماهه و کوچک‌سازی به سمت ۱."""
    n = len(y)
    ratios: list[list[float]] = [[] for _ in range(12)]
    if n >= 24:
        w = np.r_[0.5, np.ones(11), 0.5] / 12
        cma = np.convolve(y, w, mode="valid")
        for t in range(6, n - 6):
            if cma[t - 6] > 0:
                ratios[mo[t]].append(y[t] / cma[t - 6])
    m = y.mean() or 1.0
    for t in range(n):
        if n < 24 or not ratios[mo[t]]:
            ratios[mo[t]].append(y[t] / m)
    idx = np.array([1 + (np.mean(r) - 1) * len(r) / (len(r) + 1) if r else 1.0 for r in ratios])
    idx = idx / idx.mean()
    return np.maximum(idx, 0.05)


def _design(t: np.ndarray, mo: np.ndarray, ev: np.ndarray, dummies: bool) -> np.ndarray:
    cols = [np.ones(len(t)), t / 12.0]
    if dummies:
        for d in range(1, 12):
            cols.append((mo == d).astype(float))
    else:
        for k in (1, 2):
            cols.append(np.sin(2 * np.pi * k * mo / 12))
            cols.append(np.cos(2 * np.pi * k * mo / 12))
    x = np.column_stack(cols)
    return np.column_stack([x, ev]) if ev.size else x


def predict(method: str, y: np.ndarray, mo: np.ndarray, mo_f: np.ndarray, f_h: np.ndarray, f_f: np.ndarray,
            x_h: np.ndarray, x_f: np.ndarray, h: int) -> tuple[np.ndarray, np.ndarray | None]:
    """پیش‌بینی h ماه با یک روش. خروجی: (پیش‌بینی، انحراف معیار نسبی تحلیلی یا None)."""
    n = len(y)
    adj = y / np.where(f_h > 0, f_h, 1)
    if method == "reg":
        dummies = n >= 30
        ev_cols = [j for j in range(x_h.shape[1]) if x_h[:, j].sum() > 0.2] if x_h.size else []
        xh = _design(np.arange(n, dtype=float), mo, x_h[:, ev_cols] if ev_cols else np.empty((n, 0)), dummies)
        xf = _design(np.arange(n, n + h, dtype=float), mo_f[:h], x_f[:h][:, ev_cols] if ev_cols else np.empty((h, 0)), dummies)
        if xh.shape[1] >= n - 2:
            return predict("holt", y, mo, mo_f, f_h, f_f, x_h, x_f, h)
        fit = sm.OLS(np.log1p(y), xh).fit()
        pr = fit.get_prediction(xf)
        mean_log = pr.predicted_mean
        se = np.sqrt(pr.var_pred_mean + fit.scale)
        fc = np.maximum(0, np.expm1(mean_log + fit.scale / 2))
        return fc, np.minimum(2.0, se)
    if method == "snaive":
        fc = np.array([adj[n - 12 + (i % 12)] if n - 12 + (i % 12) >= 0 else adj[-1] for i in range(h)])
    elif method == "ma3":
        fc = np.repeat(adj[-3:].mean(), h)
    elif method in ("ses", "holt"):
        idx = seasonal_index(adj, mo)
        x = adj / idx[mo]
        if method == "ses":
            m = SimpleExpSmoothing(x, initialization_method="estimated").fit()
        else:
            m = Holt(x, damped_trend=True, initialization_method="estimated").fit()
        fc = np.maximum(0, m.forecast(h)) * idx[mo_f[:h]]
    elif method == "hw":
        m = ExponentialSmoothing(np.maximum(adj, 1e-3), trend="add", damped_trend=True, seasonal="mul", seasonal_periods=12,
                                 initialization_method="estimated").fit()
        fc = np.maximum(0, m.forecast(h))
    elif method in ("croston", "tsb"):
        a, b = 0.15, 0.1
        z = p = None
        q = 1
        prob = None
        for v in adj:
            if method == "tsb":
                prob = (1.0 if v > 0 else 0.0) if prob is None else prob + b * ((1.0 if v > 0 else 0.0) - prob)
            if v > 0:
                if z is None:
                    z, p = v, q
                else:
                    z = z + a * (v - z)
                    p = p + a * (q - p)
                q = 1
            else:
                q += 1
        if z is None:
            fc = np.zeros(h)
        elif method == "croston":
            fc = np.repeat((1 - a / 2) * z / p, h)
        else:
            fc = np.repeat(z * prob, h)
    else:
        raise ValueError(method)
    return fc * f_f[:h], None


def _wmape(f: np.ndarray, a: np.ndarray) -> float:
    s = a.sum()
    e = np.abs(f - a).sum()
    return float(e / s) if s > 0 else (1.0 if e > 0 else 0.0)


def forecast_one(y: np.ndarray, mo: np.ndarray, mo_f: np.ndarray, f_h: np.ndarray, f_f: np.ndarray,
                 x_h: np.ndarray, x_f: np.ndarray, h: int) -> dict[str, Any]:
    n = len(y)
    zero_share = float((y == 0).mean()) if n else 1.0
    if n < 6:
        fc = np.repeat(y[-3:].mean() if n else 0.0, h) * f_f[:h]
        return {"method": "ma3", "methodLabel": LABELS["ma3"] + " (سابقه کوتاه)", "scores": {}, "zeroShare": zero_share,
                "forecast": fc.tolist(), "lo": [], "hi": []}
    if zero_share > 0.3:
        cands = ["croston", "tsb", "ma3", "snaive"]
    else:
        cands = ["snaive", "ma3", "ses", "holt", "reg"] + (["hw"] if n >= 33 and (y > 0).all() else [])
    origins = [o for o in (n - 9, n - 6, n - 3) if o >= 13]
    scores: dict[str, float | None] = {}
    preds: dict[str, list[np.ndarray]] = {}
    for m in cands:
        if m == "hw" and any(o < 24 for o in origins):
            scores[m] = None
            continue
        fs, acts = [], []
        try:
            for o in origins:
                f, _ = predict(m, y[:o], mo[:o], mo[o:o + 3], f_h[:o], f_h[o:o + 3], x_h[:o], x_h[o:o + 3], 3)
                fs.append(f)
                acts.append(y[o:o + 3])
            scores[m] = _wmape(np.concatenate(fs), np.concatenate(acts)) if origins else None
            preds[m] = fs
        except Exception:  # noqa: BLE001 — روشی که روی این سری همگرا نشود کنار گذاشته می‌شود
            scores[m] = None
    ranked = sorted([m for m in cands if scores.get(m) is not None], key=lambda m: scores[m])
    if not ranked:
        ranked = ["ma3"]
    # ترکیب دو روش برتر اگر خطای اعتبارسنجی آن کمتر باشد
    acts_all = np.concatenate([y[o:o + 3] for o in origins]) if origins else np.array([])
    best = ranked[0]
    if len(ranked) >= 2 and origins:
        ens = (np.concatenate(preds[ranked[0]]) + np.concatenate(preds[ranked[1]])) / 2
        scores["ensemble"] = _wmape(ens, acts_all)
        if scores["ensemble"] < scores[best]:
            best = "ensemble"
    if best == "ensemble":
        f1, s1 = predict(ranked[0], y, mo, mo_f, f_h, f_f, x_h, x_f, h)
        f2, s2 = predict(ranked[1], y, mo, mo_f, f_h, f_f, x_h, x_f, h)
        fc, rel_sd = (f1 + f2) / 2, None
        label = LABELS["ensemble"] + " (" + LABELS[ranked[0]] + " + " + LABELS[ranked[1]] + ")"
    else:
        fc, rel_sd = predict(best, y, mo, mo_f, f_h, f_f, x_h, x_f, h)
        label = LABELS[best]
    if rel_sd is None:
        # بازه از خطای نسبی اعتبارسنجی، با افزایش عدم قطعیت در افق دورتر
        errs = []
        src = [ranked[0], ranked[1]] if best == "ensemble" else [best]
        for m in src:
            for o, f in zip(origins, preds.get(m, [])):
                a = y[o:o + 3]
                errs += [((a[i] - f[i]) / a[i]) for i in range(len(a)) if a[i] > 0]
        rmse = float(np.sqrt(np.mean(np.minimum(4, np.square(errs))))) if errs else 0.25
        rel_sd = rmse * np.sqrt(1 + np.arange(h) / 6)
        lo = np.maximum(0, fc * (1 - Z80 * rel_sd))
        hi = fc * (1 + Z80 * rel_sd)
    else:
        lo = np.maximum(0, fc * np.exp(-Z80 * rel_sd))
        hi = fc * np.exp(Z80 * rel_sd)
    return {"method": best, "methodLabel": label, "scores": {k: (None if v is None else round(v, 4)) for k, v in scores.items()},
            "zeroShare": round(zero_share, 3), "forecast": np.round(fc, 2).tolist(), "lo": np.round(lo, 2).tolist(), "hi": np.round(hi, 2).tolist()}


def forecast(payload: dict[str, Any]) -> dict[str, Any]:
    periods = [int(p) for p in payload["periods"]]
    future = [int(p) for p in payload["future"]]
    ev = payload.get("events") or {}
    x_hist = np.asarray(ev.get("hist") or [[0, 0, 0]] * len(periods), dtype=float)
    x_fut = np.asarray(ev.get("future") or [[0, 0, 0]] * len(future), dtype=float)
    mo_all, mo_f = _months(periods), _months(future)
    h = len(future)
    out: dict[str, Any] = {}
    for p in payload.get("products", []):
        start = int(p.get("from", 0))
        y = np.asarray(p.get("qty", []), dtype=float)
        n = len(y)
        f_h = np.asarray(p.get("factorHist") or [1] * n, dtype=float)
        f_f = np.asarray(p.get("factorFuture") or [1] * h, dtype=float)
        out[p["id"]] = forecast_one(y, mo_all[start:start + n], mo_f, f_h, f_f, x_hist[start:start + n], x_fut, h)
    counts: dict[str, int] = {}
    for r in out.values():
        counts[r["method"]] = counts.get(r["method"], 0) + 1
    return {"products": out, "summary": {"products": len(out), "methods": counts}}


def event_effects(payload: dict[str, Any]) -> dict[str, Any]:
    """برآورد اثر رمضان و محرم برای هر خانواده با رگرسیون log(1+y) ~ روند + اثر ماه + شدت مناسبت."""
    periods = [int(p) for p in payload["periods"]]
    n = len(periods)
    mo = _months(periods)
    ev = np.asarray((payload.get("events") or {}).get("hist") or [[0, 0, 0]] * n, dtype=float)
    fam: dict[str, np.ndarray] = {}
    for p in payload.get("products", []):
        y = np.zeros(n)
        q = np.asarray(p.get("qty", []), dtype=float)
        s = int(p.get("from", 0))
        y[s:s + len(q)] = q
        fam[str(p["familyId"])] = fam.get(str(p["familyId"]), np.zeros(n)) + y
    effects = []
    names = [("ramadan", "رمضان"), ("muharram", "محرم")]
    for fid, y in fam.items():
        nz = np.nonzero(y)[0]
        if not len(nz) or n - nz[0] < 18:
            continue
        s = nz[0]
        x = _design(np.arange(n - s, dtype=float), mo[s:], ev[s:, :2], dummies=(n - s) >= 30)
        fit = sm.OLS(np.log1p(y[s:]), x).fit(cov_type="HC1")
        k = x.shape[1]
        for j, (key, kind) in enumerate(names):
            col = k - 2 + j
            exposure = float(ev[s:, j].sum())
            if exposure < 0.3:
                continue
            b, se, pv = float(fit.params[col]), float(fit.bse[col]), float(fit.pvalues[col])
            effects.append({"familyId": fid, "event": key, "kind": kind, "uplift": math.expm1(b),
                            "lo": math.expm1(b - 1.96 * se), "hi": math.expm1(b + 1.96 * se), "p": pv, "exposure": exposure})
    return {"effects": effects}

"""پیش‌بینی آماری تقاضا و برآورد اثر مناسبت‌ها.

ورودی از برنامه می‌آید (forecast.js → enginePayload):
    periods: ماه‌های تاریخچه (yyyymm)، future: ماه‌های افق
    events: {hist: [[ramadan, muharram, campaign], ...], future: [...]} شدت مناسبت‌ها در هر ماه (۰ تا ۱)
    products: [{id, familyId, from, qty, factorHist, factorFuture}]
        qty از اندیس from تاریخچه شروع می‌شود (محصولات جدید سابقه کوتاه‌تری دارند)
        factor*: ضریب اثر مناسبت‌ها بر اساس اثرهای ثبت‌شده در برنامه (برای روش‌های غیررگرسیونی)
    options: {origins, lead, metric, ensemble}

روش‌ها با بک‌تست چرخشی مقایسه می‌شوند: از هر یک از K ماه آخر (origins) مدل فقط با داده تا همان ماه برازش
و lead ماه بعد پیش‌بینی می‌شود. روش با کمترین معیار خطا (WMAPE، RMSE نسبی یا WMAPE+|سوگیری|) انتخاب می‌شود.
روش gbm یک مدل سراسری (global) گرادیان بوستینگ روی همه محصولات شرکت است.
"""
from __future__ import annotations

import math
import os
import warnings
from concurrent.futures import ProcessPoolExecutor
from typing import Any, Callable

import numpy as np
import statsmodels.api as sm
from statsmodels.tsa.holtwinters import ExponentialSmoothing, Holt, SimpleExpSmoothing
from statsmodels.tsa.statespace.sarimax import SARIMAX

warnings.filterwarnings("ignore")

LABELS = {
    "naive": "ساده (آخرین مقدار)", "snaive": "فصلی ساده", "drift": "رانش (Drift)", "ma3": "میانگین متحرک", "sma": "میانگین متحرک فصلی",
    "ses": "هموارسازی نمایی + فصل", "holt": "روند میرا + فصل", "holtLin": "روند خطی هولت + فصل",
    "hwAdd": "هولت-وینترز جمعی", "hwMul": "هولت-وینترز ضربی", "theta": "تتا (Theta)", "lintrend": "روند خطی + فصل",
    "reg": "رگرسیون فصل و مناسبت", "arima": "ARIMA فصلی", "croston": "کراستون (SBA)", "tsb": "TSB", "adida": "تجمیع زمانی (ADIDA)",
    "gbm": "یادگیری ماشین (گرادیان بوستینگ)", "ensemble": "ترکیب مدل‌ها",
}
SMOOTH = ["naive", "snaive", "drift", "ma3", "sma", "ses", "holt", "holtLin", "hwAdd", "hwMul", "theta", "lintrend", "reg", "arima"]
INTERMITTENT = ["croston", "tsb", "adida", "ma3", "sma", "snaive", "naive"]
MIN_TRAIN = {"hwAdd": 24, "hwMul": 24, "arima": 24}
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


def _ses_level(x: np.ndarray) -> tuple[float, float]:
    best = None
    for a in (0.05, 0.1, 0.2, 0.3, 0.5, 0.7):
        lvl, sse = x[0], 0.0
        for v in x[1:]:
            e = v - lvl
            sse += e * e
            lvl += a * e
        if best is None or sse < best[2]:
            best = (lvl, a, sse)
    return best[0], best[1]


def predict(method: str, y: np.ndarray, mo: np.ndarray, mo_f: np.ndarray, f_h: np.ndarray, f_f: np.ndarray,
            x_h: np.ndarray, x_f: np.ndarray, h: int) -> tuple[np.ndarray, np.ndarray | None]:
    """پیش‌بینی h ماه با یک روش. خروجی: (پیش‌بینی، انحراف معیار نسبی تحلیلی یا None)."""
    n = len(y)
    adj = y / np.where(f_h > 0, f_h, 1)
    mo_f = mo_f[:h]
    if method == "reg":
        dummies = n >= 30
        ev_cols = [j for j in range(x_h.shape[1]) if x_h[:, j].sum() > 0.2] if x_h.size else []
        xh = _design(np.arange(n, dtype=float), mo, x_h[:, ev_cols] if ev_cols else np.empty((n, 0)), dummies)
        xf = _design(np.arange(n, n + h, dtype=float), mo_f, x_f[:h][:, ev_cols] if ev_cols else np.empty((h, 0)), dummies)
        if xh.shape[1] >= n - 2:
            return predict("holt", y, mo, mo_f, f_h, f_f, x_h, x_f, h)
        fit = sm.OLS(np.log1p(y), xh).fit()
        pr = fit.get_prediction(xf)
        se = np.sqrt(pr.var_pred_mean + fit.scale)
        fc = np.maximum(0, np.expm1(pr.predicted_mean + fit.scale / 2))
        return fc, np.minimum(2.0, se)
    if method == "arima":
        # ARIMA(1,1,1) روی لگاریتم سری فصل‌زدایی‌شده با شدت مناسبت‌ها به‌عنوان متغیر برونزا
        idx = seasonal_index(np.maximum(y, 0), mo)
        ly = np.log1p(y / idx[mo])
        ev_cols = [j for j in range(x_h.shape[1]) if x_h[:, j].sum() > 0.2] if x_h.size else []
        ex_h = x_h[:, ev_cols] if ev_cols else None
        ex_f = x_f[:h][:, ev_cols] if ev_cols else None
        res = SARIMAX(ly, exog=ex_h, order=(1, 1, 1), trend="n", simple_differencing=True,
                      enforce_stationarity=False, enforce_invertibility=False).fit(disp=False, maxiter=60)
        fr = res.get_forecast(h, exog=ex_f)
        se = np.sqrt(np.asarray(fr.var_pred_mean))
        fc = np.maximum(0, np.expm1(np.asarray(fr.predicted_mean) + se ** 2 / 2)) * idx[mo_f]
        return fc, np.minimum(2.0, se)
    if method == "naive":
        fc = np.repeat(adj[-1], h)
    elif method == "snaive":
        fc = np.array([adj[n - 12 + (i % 12)] if n - 12 + (i % 12) >= 0 else adj[-1] for i in range(h)])
    elif method == "ma3":
        fc = np.repeat(adj[-3:].mean(), h)
    elif method in ("sma", "drift", "ses", "holt", "holtLin", "theta", "lintrend"):
        idx = seasonal_index(adj, mo)
        x = adj / idx[mo]
        steps = np.arange(1, h + 1)
        if method == "sma":
            base = np.repeat(x[-3:].mean(), h)
        elif method == "drift":
            base = x[-1] + steps * ((x[-1] - x[0]) / max(1, n - 1))
        elif method == "ses":
            base = np.asarray(SimpleExpSmoothing(x, initialization_method="estimated").fit(use_brute=False).forecast(h))
        elif method in ("holt", "holtLin"):
            base = np.asarray(Holt(x, damped_trend=(method == "holt"), initialization_method="estimated").fit(use_brute=False).forecast(h))
        elif method == "theta":
            lvl, a = _ses_level(x)
            b = np.polyfit(np.arange(n), x, 1)[0]
            base = lvl + (b / 2) * (steps - 1 + 1 / a - (1 - a) ** n / a)
        else:
            c = np.polyfit(np.arange(n), x, 1)
            base = c[1] + c[0] * np.arange(n, n + h)
        fc = np.maximum(0, base) * idx[mo_f]
    elif method in ("hwAdd", "hwMul"):
        mul = method == "hwMul"
        m = ExponentialSmoothing(np.maximum(adj, 1e-3) if mul else adj, trend="add", damped_trend=True, seasonal="mul" if mul else "add",
                                 seasonal_periods=12, initialization_method="estimated").fit(use_brute=False)
        fc = np.maximum(0, m.forecast(h))
    elif method in ("croston", "tsb"):
        a, b = 0.15, 0.1
        z = p = None
        q = 1
        prob = None
        for v in adj:
            occ = 1.0 if v > 0 else 0.0
            prob = occ if prob is None else prob + b * (occ - prob)
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
    elif method == "adida":
        nz = max(1, int((adj > 0).sum()))
        bs = int(max(2, min(6, round(n / nz))))
        k = n // bs
        buckets = adj[n - k * bs:].reshape(k, bs).sum(axis=1) if k else np.array([adj.sum()])
        lvl = _ses_level(buckets)[0] if len(buckets) > 1 else float(buckets[0])
        fc = np.repeat(lvl / bs, h)
    else:
        raise ValueError(method)
    return fc * f_f[:h], None


def metrics(f: np.ndarray, a: np.ndarray) -> dict[str, float]:
    s = a.sum()
    d = f - a
    w = float(np.abs(d).sum() / s) if s > 0 else (1.0 if np.abs(d).sum() > 0 else 0.0)
    bias = float(d.sum() / s) if s > 0 else 0.0
    am = a.mean() if len(a) and a.mean() > 0 else 1.0
    rmse = float(np.sqrt(np.mean(d ** 2)) / am) if len(a) else 0.0
    return {"wmape": w, "bias": bias, "rmse": rmse, "wmapeBias": w + abs(bias), "n": int(len(a))}


def _wmape(f: np.ndarray, a: np.ndarray) -> float:
    return metrics(f, a)["wmape"]


class GlobalGBM:
    """مدل سراسری گرادیان بوستینگ روی همه محصولات (نرمال‌شده با میانگین هر محصول).

    ویژگی‌ها: تأخیرهای ۱، ۲، ۳ و ۱۲، میانگین ۳ ماه، ماه سال (سینوس/کسینوس)، شدت مناسبت‌ها و ضریب اثر مناسبت.
    پیش‌بینی چندگامی به‌صورت بازگشتی انجام می‌شود.
    """

    def __init__(self, series: dict[str, dict[str, Any]], mo_all: np.ndarray, x_all: np.ndarray):
        self.series = series
        self.mo_all = mo_all
        self.x_all = x_all

    @staticmethod
    def _feat(hist: list[float], t: int, mo: int, x: np.ndarray, fac: float) -> list[float]:
        def lag(k: int) -> float:
            return hist[t - k] if t - k >= 0 else hist[0]
        return [lag(1), lag(2), lag(3), lag(12), (lag(1) + lag(2) + lag(3)) / 3,
                math.sin(2 * math.pi * mo / 12), math.cos(2 * math.pi * mo / 12), *x.tolist(), fac]

    def fit_predict(self, origin: int, h: int, future: dict[str, Any] | None = None) -> dict[str, np.ndarray]:
        """آموزش با داده تا اندیس سراسری origin و پیش‌بینی h ماه بعد برای همه محصولات."""
        from sklearn.ensemble import HistGradientBoostingRegressor

        X, Y = [], []
        scale: dict[str, float] = {}
        for pid, s in self.series.items():
            st, y = s["from"], s["y"]
            loc = origin - st
            if loc < 13:
                continue
            m = float(np.mean(y[:loc])) or 1.0
            scale[pid] = m
            yn = list(y[:loc] / m)
            for t in range(12, loc):
                X.append(self._feat(yn, t, self.mo_all[st + t], self.x_all[st + t], s["fh"][t]))
                Y.append(yn[t])
        if len(Y) < 30:
            return {}
        model = HistGradientBoostingRegressor(max_iter=150, learning_rate=0.06, max_leaf_nodes=15, min_samples_leaf=8, l2_regularization=1.0, random_state=0)
        model.fit(np.asarray(X), np.asarray(Y))
        out: dict[str, np.ndarray] = {}
        for pid, m in scale.items():
            s = self.series[pid]
            st, y = s["from"], s["y"]
            loc = origin - st
            yn = list(y[:loc] / m)
            preds = []
            for k in range(h):
                g = origin + k
                if future is not None:
                    mo, x, fac = future["mo"][k], future["x"][k], s["ff"][k]
                else:
                    mo, x, fac = self.mo_all[g], self.x_all[g], s["fh"][loc + k]
                v = max(0.0, float(model.predict(np.asarray([self._feat(yn, loc + k, mo, x, fac)]))[0]))
                yn.append(v)
                preds.append(v * m)
            out[pid] = np.asarray(preds)
        return out


def _options(payload: dict[str, Any]) -> dict[str, Any]:
    o = payload.get("options") or {}
    return {"origins": int(o.get("origins") or 12), "lead": int(o.get("lead") or 3), "metric": o.get("metric") or "wmape",
            "ensemble": o.get("ensemble", True) is not False, "methods": o.get("methods")}


def forecast_one(y: np.ndarray, mo: np.ndarray, mo_f: np.ndarray, f_h: np.ndarray, f_f: np.ndarray,
                 x_h: np.ndarray, x_f: np.ndarray, h: int, opts: dict[str, Any] | None = None,
                 extra: dict[str, Callable[[int, int], np.ndarray | None]] | None = None,
                 extra_final: dict[str, np.ndarray] | None = None) -> dict[str, Any]:
    """بک‌تست چرخشی روش‌ها برای یک محصول و پیش‌بینی با روش منتخب.

    extra: روش‌های بیرونی (مثل مدل سراسری) به‌صورت تابع (origin محلی، افق) → پیش‌بینی؛ extra_final: پیش‌بینی نهایی آن‌ها.
    """
    o = opts or {"origins": 12, "lead": 3, "metric": "wmape", "ensemble": True, "methods": None}
    n = len(y)
    zero_share = float((y == 0).mean()) if n else 1.0
    if n < 6:
        fc = np.repeat(y[-3:].mean() if n else 0.0, h) * f_f[:h]
        return {"method": "ma3", "methodLabel": LABELS["ma3"] + " (سابقه کوتاه)", "scores": {}, "metrics": {}, "zeroShare": zero_share,
                "forecast": fc.tolist(), "lo": [], "hi": []}
    cands = [m for m in (o.get("methods") or (INTERMITTENT if zero_share > 0.3 else SMOOTH)) if m in LABELS and m not in ("ensemble", "gbm")]
    if zero_share <= 0.3:
        cands += [m for m in (extra or {}) if m not in cands]
    origins = [n - k for k in range(int(o["origins"]), 0, -1) if n - k >= 13]
    lead = int(o["lead"])
    preds: dict[str, list[np.ndarray]] = {}
    for m in cands:
        if origins and origins[0] < MIN_TRAIN.get(m, 13):
            continue
        if m in ("hwMul",) and (y <= 0).any():
            continue
        try:
            fs = []
            for org in origins:
                hh = min(lead, n - org)
                if extra and m in extra:
                    f = extra[m](org, hh)
                    if f is None:
                        raise ValueError("no global prediction")
                else:
                    f, _ = predict(m, y[:org], mo[:org], mo[org:org + hh], f_h[:org], f_h[org:org + hh], x_h[:org], x_h[org:org + hh], hh)
                if not np.all(np.isfinite(f)):
                    raise ValueError("non-finite")
                fs.append(np.asarray(f, dtype=float))
            preds[m] = fs
        except Exception:  # noqa: BLE001 — روشی که روی این سری همگرا نشود کنار گذاشته می‌شود
            continue
    acts = [y[org:org + len(f)] for org, f in zip(origins, next(iter(preds.values()), []))]
    mets: dict[str, dict[str, Any]] = {}
    for m, fs in preds.items():
        mets[m] = metrics(np.concatenate(fs), np.concatenate(acts)) if origins else None
    key = o["metric"] if o["metric"] in ("wmape", "rmse", "wmapeBias") else "wmape"
    ranked = sorted([m for m in preds if mets.get(m)], key=lambda m: mets[m][key])
    if not ranked:
        ranked = ["ma3"]
    best = ranked[0]
    members: list[str] = []
    if o.get("ensemble", True) and len(ranked) >= 3 and origins:
        members = ranked[:3]
        preds["ensemble"] = [np.mean([preds[m][j] for m in members], axis=0) for j in range(len(origins))]
        mets["ensemble"] = metrics(np.concatenate(preds["ensemble"]), np.concatenate(acts))
        mets["ensemble"]["members"] = members
        if mets["ensemble"][key] < mets[best][key]:
            best = "ensemble"

    def final(m: str) -> tuple[np.ndarray, np.ndarray | None]:
        if extra_final and m in extra_final:
            return extra_final[m], None
        return predict(m, y, mo, mo_f, f_h, f_f, x_h, x_f, h)

    if best == "ensemble":
        fc = np.mean([final(m)[0] for m in members], axis=0)
        label = LABELS["ensemble"] + " (" + " + ".join(LABELS[m] for m in members) + ")"
    else:
        fc = final(best)[0]
        label = LABELS[best]
    # بازه پیش‌بینی: خطای نسبی بک‌تست روش منتخب به تفکیک افق (برای افق دورتر با ریشه زمان بزرگ می‌شود)
    by_lead: list[list[float]] = [[] for _ in range(lead)]
    for org, f in zip(origins, preds.get(best, [])):
        for i, v in enumerate(f):
            a = y[org + i]
            if a > 0:
                by_lead[i].append(min(2.0, (a - v) / a))
    rl = [float(np.sqrt(np.mean(np.square(e)))) for e in by_lead if e]
    if rl:
        emp = np.array([rl[i] if i < len(rl) else rl[-1] * math.sqrt((i + 1) / len(rl)) for i in range(h)])
    else:
        emp = 0.25 * np.sqrt(1 + np.arange(h) / 6)
    lo = np.maximum(0, fc * (1 - Z80 * emp))
    hi = fc * (1 + Z80 * emp)
    r4 = lambda v: None if v is None else round(float(v), 4)  # noqa: E731
    met_out = {m: {**{k: (r4(v) if k not in ("n", "members") else v) for k, v in d.items()}} for m, d in mets.items() if d}
    scores = {m: r4(d[key]) for m, d in mets.items() if d}
    backtest = {"idx": origins, "actual": [float(y[org]) for org in origins],
                "fc": {m: [round(float(f[0]), 1) for f in fs] for m, fs in preds.items()}}
    return {"method": best, "methodLabel": label, "scores": scores, "metrics": met_out, "metric": key, "zeroShare": round(zero_share, 3),
            "origins": len(origins), "lead": lead, "backtest": backtest,
            "forecast": np.round(fc, 2).tolist(), "lo": np.round(lo, 2).tolist(), "hi": np.round(hi, 2).tolist()}


def _job(args: tuple) -> dict[str, Any]:
    y, mo, mo_f, f_h, f_f, x_h, x_f, h, opts, gbm = args
    extra = extra_final = None
    if gbm is not None:
        bt, fin = gbm
        extra = {"gbm": lambda org, hh: bt[org][:hh] if org in bt else None}
        extra_final = {"gbm": fin}
    return forecast_one(y, mo, mo_f, f_h, f_f, x_h, x_f, h, opts, extra, extra_final)


def _run_jobs(jobs: list[tuple]) -> list[dict[str, Any]]:
    """اجرای موازی محصولات روی هسته‌های پردازنده (در صورت امکان)؛ در غیر این صورت ترتیبی."""
    workers = min(len(jobs), os.cpu_count() or 1, 8)
    if workers >= 2 and len(jobs) >= 4 and os.environ.get("IBP_ENGINE_SERIAL") != "1":
        try:
            with ProcessPoolExecutor(max_workers=workers) as ex:
                return list(ex.map(_job, jobs, chunksize=max(1, len(jobs) // (workers * 2))))
        except Exception:  # noqa: BLE001 — محیط بدون پشتیبانی چندپردازشی
            pass
    return [_job(j) for j in jobs]


def forecast(payload: dict[str, Any]) -> dict[str, Any]:
    periods = [int(p) for p in payload["periods"]]
    future = [int(p) for p in payload["future"]]
    ev = payload.get("events") or {}
    x_hist = np.asarray(ev.get("hist") or [[0, 0, 0]] * len(periods), dtype=float)
    x_fut = np.asarray(ev.get("future") or [[0, 0, 0]] * len(future), dtype=float)
    mo_all, mo_f = _months(periods), _months(future)
    h = len(future)
    opts = _options(payload)
    N = len(periods)
    series: dict[str, dict[str, Any]] = {}
    for p in payload.get("products", []):
        y = np.asarray(p.get("qty", []), dtype=float)
        n = len(y)
        series[p["id"]] = {"from": int(p.get("from", 0)), "y": y,
                           "fh": np.asarray(p.get("factorHist") or [1] * n, dtype=float),
                           "ff": np.asarray(p.get("factorFuture") or [1] * h, dtype=float)}
    # مدل سراسری: یک بار برای هر مبدأ بک‌تست و یک بار برای افق نهایی
    use_gbm = not opts.get("methods") or "gbm" in (opts.get("methods") or [])
    gbm_bt: dict[int, dict[str, np.ndarray]] = {}
    gbm_final: dict[str, np.ndarray] = {}
    if use_gbm and len(series) >= 3 and N >= 30:
        g = GlobalGBM(series, mo_all, x_hist)
        lead = opts["lead"]
        for k in range(opts["origins"], 0, -1):
            org = N - k
            gbm_bt[org] = g.fit_predict(org, min(lead, k))
        gbm_final = g.fit_predict(N, h, future={"mo": mo_f, "x": x_fut})
    jobs = []
    for pid, s in series.items():
        st, y = s["from"], s["y"]
        n = len(y)
        gbm = None
        if pid in gbm_final:
            # پیش‌بینی‌های مدل سراسری برای مبدأهای محلی این محصول
            gbm = ({org - st: v[pid] for org, v in gbm_bt.items() if pid in v}, gbm_final[pid])
        jobs.append((pid, (y, mo_all[st:st + n], mo_f, s["fh"], s["ff"], x_hist[st:st + n], x_fut, h, opts, gbm)))
    out: dict[str, Any] = dict(zip([j[0] for j in jobs], _run_jobs([j[1] for j in jobs])))
    counts: dict[str, int] = {}
    for r in out.values():
        counts[r["method"]] = counts.get(r["method"], 0) + 1
    return {"products": out, "summary": {"products": len(out), "methods": counts, "options": {k: v for k, v in opts.items() if k != "methods"}}}


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

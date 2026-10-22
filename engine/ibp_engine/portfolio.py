"""تحلیل پیشرفته پورتفوی محصول.

ورودی همان داده‌ای است که برنامه ارسال می‌کند: سری ماهانه مقدار فروش هر محصول
(۲۴ ماه) به‌همراه شاخص‌های پایه (درآمد، حاشیه سود، رشد و ضریب تغییرات).
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy import stats
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
import statsmodels.api as sm

SIGNIFICANCE = 0.05
MIN_POINTS = 24


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _round(v: float | None, digits: int = 4) -> float | None:
    return None if v is None or not math.isfinite(v) else round(float(v), digits)


def _design(n: int, periods: list[int]) -> np.ndarray:
    """ماتریس طراحی: عرض از مبدأ، روند خطی (سال) و ۱۱ متغیر ماه (ماه اول مبنا)."""
    months = np.array([p % 100 for p in periods[-n:]]) - 1
    x = np.zeros((n, 13))
    x[:, 0] = 1.0
    x[:, 1] = np.arange(n) / 12.0
    for i, m in enumerate(months):
        if m > 0:
            x[i, 1 + m] = 1.0
    return x


def decompose(qty: list[float], periods: list[int]) -> dict[str, Any]:
    """تجزیه روند و فصل با رگرسیون: log(1+y) ~ روند خطی + اثر ماه.

    با ۲۴ ماه داده، روش‌هایی مثل STL هر ماه فصلی را فقط از دو مشاهده برآورد می‌کنند و نوسان
    تصادفی را «فصلی» نشان می‌دهند؛ این‌جا قدرت فصلی برابر R² تعدیل‌شده اثر ماه‌ها روی سری
    بدون روند است و معناداری روند با آزمون t ضریب روند در همان مدل سنجیده می‌شود.
    """
    y = np.asarray([_num(v) or 0.0 for v in qty], dtype=float)
    out: dict[str, Any] = {
        "seasonalStrength": None, "peakMonth": None, "lowMonth": None,
        "trendSlopePct": None, "trendPValue": None, "trendDir": "flat", "zeroShare": None, "resid": None,
    }
    n = len(y)
    if n < MIN_POINTS or y.sum() <= 0:
        return out
    zero_share = float((y == 0).mean())
    out["zeroShare"] = _round(zero_share)
    ly = np.log1p(y)
    x = _design(n, periods)
    fit = sm.OLS(ly, x).fit()
    out["resid"] = fit.resid
    if zero_share > 0.3:
        # سری متناوب: روند و فصل معنادار برآورد نمی‌شود
        return out
    # قدرت فصلی: R² تعدیل‌شده اثر ماه‌ها روی سری روندزدایی‌شده
    detr = ly - fit.params[1] * x[:, 1]
    ss_tot = float(((detr - detr.mean()) ** 2).sum())
    ss_res = float((fit.resid ** 2).sum())
    k = 11
    if ss_tot > 0 and n - k - 1 > 0:
        r2 = 1 - ss_res / ss_tot
        adj = 1 - (1 - r2) * (n - 1) / (n - k - 1)
        out["seasonalStrength"] = _round(max(0.0, adj))
    effects = np.concatenate([[0.0], fit.params[2:]])
    order = sorted(range(12), key=lambda m: effects[m])
    if out["seasonalStrength"] and out["seasonalStrength"] > 0.2:
        out["peakMonth"] = order[-1] + 1
        out["lowMonth"] = order[0] + 1
    slope, pval = float(fit.params[1]), float(fit.pvalues[1])
    out["trendSlopePct"] = _round(math.expm1(slope))
    out["trendPValue"] = _round(pval, 6)
    if pval < SIGNIFICANCE:
        out["trendDir"] = "up" if slope > 0 else "down"
    return out


SEGMENTS = [
    ("core", "ستون‌های اصلی سبد", "بیشترین سهم فروش؛ محور برنامه‌ریزی ظرفیت و سطح خدمت بالا", lambda c: c["logRevenue"]),
    ("growth", "موتورهای رشد", "بیشترین رشد حجمی؛ نیازمند ظرفیت و موجودی پیش‌دستانه", lambda c: c["growth"]),
    ("volatile", "پرنوسان", "بیشترین نوسان تقاضا؛ ذخیره اطمینان بالاتر یا تولید سفارشی", lambda c: c["cv"]),
    ("lowmargin", "کم‌بازده", "کمترین حاشیه سود؛ بازبینی قیمت، هزینه یا حضور در سبد", lambda c: -c["margin"]),
    ("tail", "دنباله سبد", "سهم کم از فروش؛ کاندید ساده‌سازی سبد", lambda c: -c["logRevenue"]),
]


def segment(products: list[dict[str, Any]], k: int = 4) -> tuple[list[int], list[dict[str, Any]]]:
    """خوشه‌بندی محصولات با K-Means روی رشد، حاشیه، نوسان و اندازه فروش."""
    feats = []
    for p in products:
        feats.append([
            min(max(_num(p.get("growth")) or 0.0, -1.0), 2.0),
            _num(p.get("margin")) or 0.0,
            min(_num(p.get("cv")) or 0.0, 2.0),
            math.log1p(max(_num(p.get("revenue")) or 0.0, 0.0)),
        ])
    x = np.asarray(feats, dtype=float)
    n = len(products)
    k = max(1, min(k, n))
    if n < 3:
        return [0] * n, [{"id": 0, "key": "core", "label": SEGMENTS[0][1], "description": SEGMENTS[0][2], "count": n}]
    z = StandardScaler().fit_transform(x)
    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(z)
    labels = km.labels_.tolist()
    centroids = []
    for c in range(k):
        m = x[km.labels_ == c].mean(axis=0)
        centroids.append({"id": c, "growth": m[0], "margin": m[1], "cv": m[2], "logRevenue": m[3]})
    assigned: dict[int, tuple[str, str, str]] = {}
    for key, label, desc, score in SEGMENTS:
        free = [c for c in centroids if c["id"] not in assigned]
        if not free:
            break
        best = max(free, key=score)
        assigned[best["id"]] = (key, label, desc)
    clusters = []
    for c in centroids:
        key, label, desc = assigned.get(c["id"], ("other", "سایر", ""))
        members = [i for i, lab in enumerate(labels) if lab == c["id"]]
        clusters.append({
            "id": c["id"], "key": key, "label": label, "description": desc, "count": len(members),
            "revenue": float(sum(_num(products[i].get("revenue")) or 0.0 for i in members)),
            "growth": _round(c["growth"]), "margin": _round(c["margin"]), "cv": _round(c["cv"]),
        })
    clusters.sort(key=lambda c: -c["revenue"])
    return labels, clusters


def concentration(revenues: list[float]) -> dict[str, float | None]:
    r = np.asarray([max(_num(v) or 0.0, 0.0) for v in revenues], dtype=float)
    total = r.sum()
    if total <= 0:
        return {"hhi": None, "gini": None}
    share = r / total
    hhi = float((share ** 2).sum() * 10000)
    s = np.sort(r)
    n = len(s)
    gini = float((2 * np.arange(1, n + 1) - n - 1).dot(s) / (n * s.sum()))
    return {"hhi": _round(hhi, 1), "gini": _round(gini)}


def substitution_pairs(products: list[dict[str, Any]], resids: dict[str, np.ndarray], limit: int = 12) -> list[dict[str, Any]]:
    """جفت محصولات هم‌خانواده با همبستگی منفی معنادار نوسانات (نشانه جایگزینی/هم‌خواری)."""
    candidates = []
    tests = 0
    by_family: dict[str, list[dict[str, Any]]] = {}
    for p in products:
        if p["id"] in resids:
            by_family.setdefault(str(p.get("familyId")), []).append(p)
    for items in by_family.values():
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a, b = items[i], items[j]
                ra, rb = resids[a["id"]], resids[b["id"]]
                if np.std(ra) == 0 or np.std(rb) == 0:
                    continue
                r, p = stats.pearsonr(ra, rb)
                tests += 1
                candidates.append({"a": a["id"], "b": b["id"], "r": float(r), "p": float(p)})
    # اصلاح بونفرونی برای آزمون‌های چندگانه تا جفت‌های تصادفی گزارش نشوند
    alpha = SIGNIFICANCE / max(tests, 1)
    out = [{"a": c["a"], "b": c["b"], "r": _round(c["r"]), "p": _round(c["p"], 8), "tests": tests}
           for c in candidates if c["r"] < -0.5 and c["p"] < alpha]
    out.sort(key=lambda x: x["r"])
    return out[:limit]


def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    periods = [int(p) for p in payload.get("periods", [])]
    products = payload.get("products", [])
    results = []
    resids: dict[str, np.ndarray] = {}
    for p in products:
        d = decompose(p.get("qty", []), periods)
        resid = d.pop("resid")
        if resid is not None:
            resids[p["id"]] = resid
        results.append({"id": p["id"], **d})
    labels, clusters = segment(products, k=int(payload.get("k", 4)))
    for r, lab in zip(results, labels):
        r["cluster"] = int(lab)
    seasonal = [r["seasonalStrength"] for r in results if r["seasonalStrength"] is not None]
    return {
        "products": results,
        "clusters": clusters,
        "pairs": substitution_pairs(products, resids),
        "concentration": concentration([p.get("revenue") for p in products]),
        "summary": {
            "analyzed": len(results),
            "decomposed": len(seasonal),
            "avgSeasonalStrength": _round(float(np.mean(seasonal))) if seasonal else None,
            "seasonalCount": sum(1 for v in seasonal if v > 0.2),
            "trendUp": sum(1 for r in results if r["trendDir"] == "up"),
            "trendDown": sum(1 for r in results if r["trendDir"] == "down"),
        },
    }

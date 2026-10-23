"""شبیه‌سازی مونت‌کارلو سود و درآمد برنامه (برداری با NumPy).

ورودی (finance.js → mcPayload):
    runs, months, seed, budgetMask (ماه‌های دارای بودجه)، budgetGross, budgetRevenue
    products: [{id, rel, open, demand[], production[], price[], cost[]}]
مدل خطا: تقاضای شبیه‌سازی = تقاضا × (۱ + rel × (۰٫۶ z_محصول + ۰٫۸ z_ماه))؛ rel = خطای نسبی بک‌تست روش منتخب.
فروش هر ماه به موجودی ابتدای ماه + تولید برنامه محدود است (کمبود از دست می‌رود، مازاد به ماه بعد منتقل می‌شود).
"""
from __future__ import annotations

from typing import Any

import numpy as np


def montecarlo(payload: dict[str, Any]) -> dict[str, Any]:
    runs = int(payload.get("runs", 2000))
    months = int(payload.get("months", 12))
    rng = np.random.default_rng(int(payload.get("seed", 7)))
    rev = np.zeros(runs)
    gp = np.zeros(runs)
    dem_tot = np.zeros(runs)
    sold_tot = np.zeros(runs)
    # مقایسه با بودجه فقط در ماه‌های دارای بودجه
    mask = np.asarray(payload.get("budgetMask") or [1] * months, dtype=float)
    rev_b = np.zeros(runs)
    gp_b = np.zeros(runs)
    for p in payload.get("products", []):
        d = np.asarray(p["demand"][:months], dtype=float)
        prod = np.asarray(p["production"][:months], dtype=float)
        price = np.asarray(p["price"][:months], dtype=float)
        cost = np.asarray(p["cost"][:months], dtype=float)
        m = len(d)
        rel = float(p["rel"]) if p.get("rel") is not None else 0.2
        zp = rng.standard_normal((runs, 1))
        zt = rng.standard_normal((runs, m))
        dsim = np.maximum(0.0, d[None, :] * (1 + rel * (0.6 * zp + 0.8 * zt)))
        inv = np.full(runs, float(p.get("open") or 0))
        for t in range(m):
            avail = inv + prod[t]
            s = np.minimum(dsim[:, t], avail)
            inv = avail - s
            rev += s * price[t]
            gp += s * (price[t] - cost[t])
            sold_tot += s
            if t < len(mask) and mask[t]:
                rev_b += s * price[t]
                gp_b += s * (price[t] - cost[t])
        dem_tot += dsim.sum(axis=1)
    fill = np.where(dem_tot > 0, sold_tot / np.maximum(dem_tot, 1e-9), 1.0)
    q = lambda a: {"p10": float(np.quantile(a, 0.1)), "p50": float(np.quantile(a, 0.5)), "p90": float(np.quantile(a, 0.9)), "mean": float(a.mean())}  # noqa: E731
    counts, edges = np.histogram(gp, bins=24)
    bg, br = float(payload.get("budgetGross") or 0), float(payload.get("budgetRevenue") or 0)
    return {
        "runs": runs, "revenue": q(rev), "gross": q(gp),
        "fill": {k: v for k, v in q(fill).items() if k != "mean"},
        "probGrossBudget": float((gp_b >= bg).mean()) if bg else None,
        "probRevenueBudget": float((rev_b >= br).mean()) if br else None,
        "hist": {"lo": float(edges[0]), "width": float(edges[1] - edges[0]), "counts": counts.tolist()},
    }

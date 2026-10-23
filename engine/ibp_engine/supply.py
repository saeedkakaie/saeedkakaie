"""بهینه‌سازی برنامه تولید با محدودیت ظرفیت (برنامه‌ریزی خطی، حل‌کننده HiGHS در SciPy).

ورودی (supply.js → enginePayload):
    periods, overtimePct
    products: [{id, demand[], ss[], open, maxCarry, unitCost, unitPrice, priority, routes: [{resourceId, unitsPerHour, alt}]}]
    resources: [{id, capacity, costPerHour}]

متغیرها برای هر محصول p، مسیر r و ماه t:
    x[p,r,t] تولید در ظرفیت عادی، o[p,r,t] تولید در اضافه‌کاری،
    I[p,t] موجودی پایان ماه، U[p,t] تقاضای تأمین‌نشده (کمبود)، V[p,t] کسری از ذخیره اطمینان
محدودیت‌ها:
    I[t-1] + Σr (x + o) + U[t] − d[t] = I[t]                 (تراز موجودی)
    Σp x / uph ≤ ظرفیت[r]،  Σp o / uph ≤ سقف اضافه‌کاری[r]    (ظرفیت)
    I[t] + V[t] ≥ SS[t]                                        (ذخیره اطمینان نرم)
    I[t] ≤ SS[t] + تقاضای maxCarry ماه بعد                      (ماندگاری و سقف پیش‌ساخت)
هدف: کمینه‌سازی هزینه نگهداری + اضافه‌کاری + خط جایگزین + جریمه کسری ذخیره اطمینان + جریمه کمبود (با اولویت ABC).
"""
from __future__ import annotations

import time
from typing import Any

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix

PRIORITY_WEIGHT = {"A": 1.6, "B": 1.25, "C": 1.0}


def optimize(payload: dict[str, Any]) -> dict[str, Any]:
    t0 = time.time()
    periods = payload["periods"]
    T = len(periods)
    ot = float(payload.get("overtimePct", 0.1))
    res = {r["id"]: r for r in payload.get("resources", [])}
    prods = [p for p in payload.get("products", [])]

    cols: list[tuple] = []          # توصیف هر متغیر
    cost: list[float] = []

    def var(desc: tuple, c: float) -> int:
        cols.append(desc)
        cost.append(c)
        return len(cols) - 1

    idx_x: dict[tuple, int] = {}
    idx_o: dict[tuple, int] = {}
    idx_i: dict[tuple, int] = {}
    idx_u: dict[tuple, int] = {}
    idx_v: dict[tuple, int] = {}
    scale = max([float(p.get("unitCost") or 1) for p in prods] + [1.0])
    for pi, p in enumerate(prods):
        c = max(float(p.get("unitCost") or 0), 1.0) / scale
        price = max(float(p.get("unitPrice") or 0), c * scale) / scale
        w = PRIORITY_WEIGHT.get(p.get("priority") or "C", 1.0)
        for t in range(T):
            for ri, r in enumerate(p.get("routes", [])):
                if r["resourceId"] not in res or not r.get("unitsPerHour"):
                    continue
                idx_x[(pi, ri, t)] = var(("x", pi, ri, t), c * (0.001 + (0.03 if r.get("alt") else 0.0)))
                idx_o[(pi, ri, t)] = var(("o", pi, ri, t), c * (0.09 + (0.03 if r.get("alt") else 0.0)))
            idx_i[(pi, t)] = var(("I", pi, t), c * 0.02)
            idx_u[(pi, t)] = var(("U", pi, t), price * 3.0 * w)
            idx_v[(pi, t)] = var(("V", pi, t), c * 0.35 * w)

    n = len(cols)
    eq_r, eq_c, eq_v, beq = [], [], [], []
    ub_r, ub_c, ub_v, bub = [], [], [], []
    row = 0
    # تراز موجودی
    for pi, p in enumerate(prods):
        d = p["demand"]
        for t in range(T):
            for (ppi, ri, tt), j in idx_x.items():
                if ppi == pi and tt == t:
                    eq_r.append(row); eq_c.append(j); eq_v.append(1.0)
                    eq_r.append(row); eq_c.append(idx_o[(ppi, ri, tt)]); eq_v.append(1.0)
            eq_r.append(row); eq_c.append(idx_u[(pi, t)]); eq_v.append(1.0)
            eq_r.append(row); eq_c.append(idx_i[(pi, t)]); eq_v.append(-1.0)
            if t > 0:
                eq_r.append(row); eq_c.append(idx_i[(pi, t - 1)]); eq_v.append(1.0)
                beq.append(float(d[t]))
            else:
                beq.append(float(d[t]) - float(p.get("open") or 0))
            row += 1
    n_eq = row
    row = 0
    # ظرفیت عادی و اضافه‌کاری
    for rid, r in res.items():
        cap = float(r.get("capacity") or 0)
        for t in range(T):
            for kind, idx, lim in (("x", idx_x, cap), ("o", idx_o, cap * ot)):
                has = False
                for (pi, ri, tt), j in idx.items():
                    route = prods[pi]["routes"][ri]
                    if tt == t and route["resourceId"] == rid:
                        ub_r.append(row); ub_c.append(j); ub_v.append(1.0 / float(route["unitsPerHour"]))
                        has = True
                if has:
                    bub.append(lim)
                    row += 1
    # ذخیره اطمینان نرم و سقف موجودی
    for pi, p in enumerate(prods):
        d, ss = p["demand"], p.get("ss") or [0] * T
        mc = max(1, int(p.get("maxCarry") or 0))
        for t in range(T):
            ub_r += [row, row]; ub_c += [idx_i[(pi, t)], idx_v[(pi, t)]]; ub_v += [-1.0, -1.0]
            bub.append(-float(ss[t]))
            row += 1
            cap_inv = float(ss[t]) + float(sum(d[t + 1:t + 1 + mc])) + (0 if t + 1 < T else float(d[t]) * mc)
            ub_r.append(row); ub_c.append(idx_i[(pi, t)]); ub_v.append(1.0)
            bub.append(max(cap_inv, float(ss[t])))
            row += 1
    n_ub = row
    a_eq = coo_matrix((eq_v, (eq_r, eq_c)), shape=(n_eq, n)).tocsr() if n_eq else None
    a_ub = coo_matrix((ub_v, (ub_r, ub_c)), shape=(n_ub, n)).tocsr() if n_ub else None
    sol = linprog(np.asarray(cost), A_ub=a_ub, b_ub=np.asarray(bub) if n_ub else None, A_eq=a_eq, b_eq=np.asarray(beq) if n_eq else None,
                  bounds=(0, None), method="highs")
    if sol.status != 0 or sol.x is None:
        return {"status": "failed", "message": sol.message, "allocations": [], "objective": None, "seconds": round(time.time() - t0, 3)}
    x = sol.x
    allocs: list[dict[str, Any]] = []
    for pi, p in enumerate(prods):
        ss = p.get("ss") or [0] * T
        for t in range(T):
            parts = []
            for ri, r in enumerate(p.get("routes", [])):
                if (pi, ri, t) in idx_x:
                    qx, qo = float(x[idx_x[(pi, ri, t)]]), float(x[idx_o[(pi, ri, t)]])
                    if qx > 1e-6:
                        parts.append([r["resourceId"], qx, "alt" if r.get("alt") else "primary"])
                    if qo > 1e-6:
                        parts.append([r["resourceId"], qo, "overtime"])
            # بخشی از تولید که فقط برای ماه‌های بعد ساخته شده (موجودی بیش از ذخیره اطمینان) = پیش‌ساخت
            inv_end = float(x[idx_i[(pi, t)]])
            pre = max(0.0, inv_end - float(ss[t]) - 0.5)
            for part in parts:
                if pre <= 1e-6 or part[2] == "overtime":
                    continue
                q = min(pre, part[1])
                part[1] -= q
                pre -= q
                allocs.append({"productId": p["id"], "resourceId": part[0], "t": t, "qty": round(q, 3), "kind": "prebuild"})
            for rid, q, kind in parts:
                if q > 1e-6:
                    allocs.append({"productId": p["id"], "resourceId": rid, "t": t, "qty": round(q, 3), "kind": kind})
    short = float(sum(x[j] for j in idx_u.values()))
    return {"status": "optimal", "objective": round(float(sol.fun), 4), "seconds": round(time.time() - t0, 3), "allocations": allocs,
            "summary": {"variables": n, "constraints": n_eq + n_ub, "shortage": round(short, 2)}}

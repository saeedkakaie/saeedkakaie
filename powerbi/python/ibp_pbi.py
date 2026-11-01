"""محاسبات IBP برای Power BI (همان منطق برنامه IBP گروه زر، به پایتون).

این ماژول مراحلی را اجرا می‌کند که حلقه‌ای/ترتیبی هستند و در DAX پیاده نمی‌شوند:
  ۱) پیش‌بینی آماری با بک‌تست چرخشی (کد موتور تحلیل برنامه: ibp_engine.demand)
  ۲) برنامه تولید با محدودیت ظرفیت (MPS) و پیش‌بینی موجودی و بار خطوط
  ۳) نیاز مواد (MRP)
  ۴) بهای تمام‌شده استاندارد، سود و زیان برنامه، سرمایه در گردش و پل بودجه
خروجی‌ها جدول‌های Fact برای مدل Power BI هستند (CSV یا DataFrame در اسکریپت پایتون Power Query).

ورودی: پوشه‌ای با CSVهای جدول‌های پایه (همان نام‌ها و ستون‌های خروجی برنامه؛ ستون CompanyCode).
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

CONSENSUS, STAT = "اجماعی", "آماری"
STOPPED = "توقف"


# ---------------------------------------------------------------- تقویم (دوره = yyyymm شمسی)
def p_add(p: int, n: int) -> int:
    y, m = divmod(int(p), 100)
    k = y * 12 + (m - 1) + n
    return (k // 12) * 100 + k % 12 + 1


def p_diff(a: int, b: int) -> int:
    """تعداد ماه از a تا b"""
    return (int(b) // 100 * 12 + int(b) % 100) - (int(a) // 100 * 12 + int(a) % 100)


def p_range(start: int, n: int) -> list[int]:
    return [p_add(start, i) for i in range(n)]


def z_of(p: float) -> float:
    """معکوس توزیع نرمال (تقریب Acklam؛ همان برنامه)"""
    p = min(0.9999, max(0.5, p))
    a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239]
    b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
    c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
    d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
    if p > 0.97575:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    q = p - 0.5
    r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)


def _num(v: Any, default: float = 0.0) -> float:
    try:
        if v is None or (isinstance(v, float) and math.isnan(v)) or v == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _true(v: Any, default: bool = True) -> bool:
    if v is None or (isinstance(v, float) and math.isnan(v)) or v == "":
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "بله")


# ---------------------------------------------------------------- داده یک شرکت
@dataclass
class Company:
    code: str
    t: dict[str, pd.DataFrame]
    settings: dict[str, Any] = field(default_factory=dict)

    def rows(self, name: str) -> list[dict[str, Any]]:
        df = self.t.get(name)
        return [] if df is None else df.to_dict("records")

    def s(self, key: str, default: Any) -> Any:
        v = self.settings.get(key)
        if v is None or v == "" or (isinstance(v, float) and math.isnan(v)):
            return default
        return v

    @property
    def cycle(self) -> int:
        return int(float(self.s("cyclePeriod", 0)))


TABLES = ["plants", "warehouses", "resources", "families", "products", "routings", "suppliers", "materials", "bom", "channels",
          "regions", "customers", "salesActuals", "forecasts", "budgets", "inventory", "materialInventory", "events", "eventImpacts",
          "cycleSteps", "actions", "demandAdjustments", "settings", "calendar_lunar"]


def load(data_dir: str | os.PathLike, company: str) -> Company:
    d = Path(data_dir)
    t: dict[str, pd.DataFrame] = {}
    for name in TABLES:
        f = d / f"{name}.csv"
        if not f.exists() or f.stat().st_size < 10:
            continue
        df = pd.read_csv(f, encoding="utf-8-sig", dtype={"id": str, "productId": str, "customerId": str, "materialId": str, "resourceId": str,
                                                          "familyId": str, "supplierId": str, "plantId": str, "channelId": str, "regionId": str,
                                                          "warehouseId": str, "eventId": str, "code": str, "internalCompany": str, "internalProductCode": str})
        if "CompanyCode" in df.columns:
            df = df[df["CompanyCode"].astype(str) == company]
        t[name] = df.reset_index(drop=True)
    settings = {}
    for r in t.get("settings", pd.DataFrame()).to_dict("records"):
        v = r["value"]
        try:
            v = float(v)
        except (TypeError, ValueError):
            pass
        settings[r["key"]] = v
    return Company(company, t, settings)


# ---------------------------------------------------------------- پایه‌ها
def avg_discount(co: Company) -> float:
    """تخفیف میانگین کانال‌ها، وزن‌دار با تعداد مشتری هر کانال"""
    n: dict[str, int] = {}
    for c in co.rows("customers"):
        n[c["channelId"]] = n.get(c["channelId"], 0) + 1
    tw = t = 0.0
    for ch in co.rows("channels"):
        k = n.get(ch["id"], 0)
        tw += k
        t += k * _num(ch.get("discount"))
    return t / tw if tw else 0.0


def price_at(co: Company, p: dict[str, Any], period: int) -> float:
    """قیمت فهرست یک دوره = قیمت پایه × (۱ + تورم ماهانه قیمت)^(فاصله ماه از چرخه)"""
    infl = _num(co.s("priceInflation", 0.025), 0.025)
    return _num(p.get("unitPrice")) * (1 + infl) ** p_diff(co.cycle, period)


def sales_qty(co: Company) -> dict[tuple[int, str], float]:
    out: dict[tuple[int, str], float] = {}
    for s in co.rows("salesActuals"):
        k = (int(s["period"]), s["productId"])
        out[k] = out.get(k, 0.0) + _num(s["qty"])
    return out


def forecast_map(co: Company, version: str, cycle: int) -> dict[tuple[str, int], float]:
    out: dict[tuple[str, int], float] = {}
    for f in co.rows("forecasts"):
        if f["version"] == version and int(f["cycle"]) == cycle:
            k = (f["productId"], int(f["period"]))
            out[k] = out.get(k, 0.0) + _num(f["qty"])
    return out


def resource_capacity(co: Company, r: dict[str, Any]) -> float:
    """ساعت در دسترس ماهانه = شیفت × ساعت شیفت × روز کاری کارخانه × راندمان"""
    plants = {p["id"]: p for p in co.rows("plants")}
    pl = plants.get(r.get("plantId"))
    days = _num(pl.get("workingDays"), 25) if pl else 25
    days = days or 25
    return (_num(r.get("shifts"), 1) or 1) * (_num(r.get("hoursPerShift"), 8) or 8) * days * (_num(r.get("efficiency"), 1) or 1)


def active_products(co: Company) -> list[dict[str, Any]]:
    return [p for p in co.rows("products") if _true(p.get("active")) and p.get("lifecycle") != STOPPED]


# ---------------------------------------------------------------- مناسبت‌ها
def _lunar(co: Company) -> dict[int, dict[str, float]]:
    return {int(r["PeriodKey"]): r for r in co.rows("calendar_lunar")}


def event_intensity(co: Company, period: int, ev: dict[str, Any], cal: dict[int, dict[str, float]]) -> float:
    """شدت مناسبت در ماه: رمضان/محرم = روزهای مناسبت ÷ روزهای ماه؛ سایر = ۱ در بازه از-تا"""
    kind = ev.get("kind")
    if kind == "رمضان":
        return _num(cal.get(period, {}).get("RamadanIntensity"))
    if kind == "محرم":
        return _num(cal.get(period, {}).get("MuharramIntensity"))
    sp, ep = ev.get("startPeriod"), ev.get("endPeriod")
    if sp is not None and not (isinstance(sp, float) and math.isnan(sp)):
        ep = sp if ep is None or (isinstance(ep, float) and math.isnan(ep)) else ep
        return 1.0 if int(sp) <= period <= int(ep) else 0.0
    return 0.0


def event_factor(co: Company, period: int, family_id: str, cal: dict[int, dict[str, float]]) -> float:
    """ضریب تقاضا = Π (۱ + اثر × شدت) برای مناسبت‌های ثبت‌شده آن خانواده"""
    evs = {e["id"]: e for e in co.rows("events")}
    f = 1.0
    for im in co.rows("eventImpacts"):
        if im["familyId"] != family_id or not _num(im.get("uplift")):
            continue
        w = event_intensity(co, period, evs.get(im["eventId"], {}), cal)
        if w:
            f *= max(0.0, 1 + _num(im["uplift"]) * w)
    return f


# ---------------------------------------------------------------- ۱) پیش‌بینی آماری
def forecast_payload(co: Company) -> dict[str, Any]:
    cycle = co.cycle
    H = int(_num(co.s("historyMonths", 36), 36))
    horizon = int(_num(co.s("horizonMonths", 18), 18))
    sq = sales_qty(co)
    with_sales = sorted({p for (p, _) in sq if p < cycle})
    first = with_sales[0] if with_sales else p_add(cycle, -H)
    start = max(first, p_add(cycle, -H))
    hist = p_range(start, p_diff(start, p_add(cycle, -1)) + 1)
    fut = p_range(cycle, horizon)
    cal = _lunar(co)
    evs = co.rows("events")

    def intens(per: int) -> list[float]:
        camp = 0.0
        for ev in evs:
            if ev.get("kind") in ("کمپین", "سایر"):
                camp = max(camp, event_intensity(co, per, ev, cal))
        return [_num(cal.get(per, {}).get("RamadanIntensity")), _num(cal.get(per, {}).get("MuharramIntensity")), camp]

    products = []
    for p in active_products(co):
        y = [sq.get((per, p["id"]), 0.0) for per in hist]
        first_sale = next((i for i, v in enumerate(y) if v > 0), -1)
        frm = max(0, first_sale)
        products.append({"id": p["id"], "familyId": p["familyId"], "from": frm, "qty": y[frm:],
                         "factorHist": [event_factor(co, per, p["familyId"], cal) for per in hist[frm:]],
                         "factorFuture": [event_factor(co, per, p["familyId"], cal) for per in fut]})
    return {"periods": hist, "future": fut, "events": {"hist": [intens(p) for p in hist], "future": [intens(p) for p in fut], "names": ["ramadan", "muharram", "campaign"]},
            "options": {"origins": int(_num(co.s("fcOrigins", 12), 12)), "lead": int(_num(co.s("fcLead", 3), 3)), "metric": co.s("fcMetric", "wmape"),
                        "ensemble": _true(co.s("fcEnsemble", True))},
            "products": products}


def run_forecast(co: Company) -> tuple[pd.DataFrame, pd.DataFrame]:
    """پیش‌بینی آماری همه محصولات با کد موتور تحلیل (ibp_engine.demand). خروجی: FactStatForecast، FactForecastMetrics"""
    here = Path(__file__).resolve()
    for cand in (here.parent, here.parent.parent.parent / "engine"):
        if (cand / "ibp_engine").is_dir() and str(cand) not in sys.path:
            sys.path.insert(0, str(cand))
    from ibp_engine import demand  # noqa: E402

    pay = forecast_payload(co)
    res = demand.forecast(pay)["products"]
    fc_rows, met_rows = [], []
    for pid, r in res.items():
        for i, per in enumerate(pay["future"]):
            fc_rows.append({"CompanyCode": co.code, "version": STAT, "cycle": co.cycle, "period": per, "productId": pid,
                            "qty": round(r["forecast"][i]), "lo": round(r["lo"][i]) if r.get("lo") else None,
                            "hi": round(r["hi"][i]) if r.get("hi") else None, "method": r.get("methodLabel")})
        m = (r.get("metrics") or {}).get(r["method"], {})
        met_rows.append({"CompanyCode": co.code, "productId": pid, "method": r["method"], "methodLabel": r.get("methodLabel"),
                         "wmape": m.get("wmape"), "bias": m.get("bias"), "rmse": m.get("rmse"), "zeroShare": r.get("zeroShare")})
    return pd.DataFrame(fc_rows), pd.DataFrame(met_rows)


# ---------------------------------------------------------------- ۲) برنامه تولید (MPS)
def supply_inputs(co: Company, metrics: pd.DataFrame | None = None, demand_factor: float | dict | None = None,
                  capacity_factor: float = 1.0) -> dict[str, Any]:
    cycle = co.cycle
    months = int(min(_num(co.s("horizonMonths", 18), 18) or 18, 18))
    o = {"months": months, "serviceLevel": _num(co.s("serviceLevelTarget", 0.95), 0.95) or 0.95,
         "ssMethod": co.s("ssMethod", "statistical"), "overtimePct": _num(co.s("overtimePct", 0.1), 0.1),
         "prebuildMonths": _num(co.s("prebuildMonths", 3), 3), "productionLeadDays": _num(co.s("productionLeadDays", 7), 7) or 7,
         "version": co.s("supplyVersion", CONSENSUS)}
    periods = p_range(cycle, months)
    fmap = forecast_map(co, o["version"], cycle)
    if not fmap:
        fmap = forecast_map(co, STAT, cycle)
    inv: dict[str, float] = {}
    for r in co.rows("inventory"):
        inv[r["productId"]] = inv.get(r["productId"], 0.0) + _num(r["qty"])
    z = z_of(o["serviceLevel"])
    L = 1 + o["productionLeadDays"] / 30
    rank = {"A": 0, "B": 1, "C": 2}
    prods = active_products(co)
    # اولویت تخصیص ظرفیت: کلاس ABC، سپس قیمت بالاتر (مرتب‌سازی پایدار)
    prods = sorted(prods, key=lambda p: (rank.get(p.get("abc"), 2), -_num(p.get("unitPrice"))))
    hist = p_range(p_add(cycle, -12), 12)
    sq = sales_qty(co)
    met = {} if metrics is None or metrics.empty else {r["productId"]: r for r in metrics.to_dict("records")}
    routes: dict[str, list[dict[str, Any]]] = {}
    for r in co.rows("routings"):
        if _num(r.get("unitsPerHour")) > 0:
            routes.setdefault(r["productId"], []).append(r)
    for k in routes:
        routes[k].sort(key=lambda r: _num(r.get("priority"), 1) or 1)
    items = []
    for p in prods:
        if demand_factor is None:
            df = 1.0
        elif isinstance(demand_factor, (int, float)):
            df = float(demand_factor)
        else:
            df = demand_factor.get(p["familyId"], demand_factor.get("all", 1.0))
        dem = [fmap.get((p["id"], per), 0.0) * df for per in periods]
        # σ نسبی خطای پیش‌بینی: RMSE نسبی بک‌تست روش منتخب؛ در نبود آن ضریب تغییرات فروش ۱۲ ماه × ۰٫۶
        rel = None
        m = met.get(p["id"])
        if m is not None:
            rel = _num(m.get("rmse"), float("nan"))
            if math.isnan(rel):
                rel = _num(m.get("wmape"), float("nan"))
            if math.isnan(rel):
                rel = None
        if rel is None:
            ys = [sq.get((per, p["id"]), 0.0) for per in hist]
            mu = sum(ys) / len(ys)
            sd = math.sqrt(sum((v - mu) ** 2 for v in ys) / len(ys))
            rel = min(1.0, 0.6 * sd / mu) if mu > 0 else 0.3
        rel = min(1.2, max(0.03, rel))
        shelf_m = _num(p.get("shelfLifeDays")) / 30 if _num(p.get("shelfLifeDays")) else 99
        ss = []
        for t, d in enumerate(dem):
            nxt = (d + dem[t + 1]) / 2 if t + 1 < len(dem) else d
            v = _num(p.get("safetyStockDays")) / 30 * nxt if o["ssMethod"] == "days" else z * rel * nxt * math.sqrt(L)
            ss.append(max(0.0, min(v, nxt * max(0.1, shelf_m * 0.4))))
        items.append({"product": p, "demand": dem, "ss": ss, "rel": rel, "open": inv.get(p["id"], 0.0), "shelfMonths": shelf_m,
                      "batch": _num(p.get("batchSize")) if _num(p.get("batchSize")) > 0 else 0, "routes": routes.get(p["id"], []),
                      "maxCarry": max(0, min(int(o["prebuildMonths"]), math.floor(shelf_m * 0.6)))})
    resources = [{"resource": r, "cap": resource_capacity(co, r) * capacity_factor} for r in co.rows("resources")]
    return {"o": o, "cycle": cycle, "periods": periods, "items": items, "resources": resources, "z": z,
            "frozen": max(0, int(_num(co.s("frozenMonths", 0), 0)))}


def plan_mps(inp: dict[str, Any]) -> list[dict[str, Any]]:
    """تخصیص تولید: ظرفیت عادی خط اصلی ← خط جایگزین ← پیش‌ساخت در ماه‌های قبل ← اضافه‌کاری ← کمبود"""
    T, o = len(inp["periods"]), inp["o"]
    cap_left = {r["resource"]["id"]: [r["cap"]] * T for r in inp["resources"]}
    cap_ot = {r["resource"]["id"]: [r["cap"] * o["overtimePct"]] * T for r in inp["resources"]}
    alloc: list[dict[str, Any]] = []
    frozen = inp["frozen"]
    state = {it["product"]["id"]: {"inv": it["open"]} for it in inp["items"]}

    def take(it: dict[str, Any], t: int, qty: float, kind: str, use_ot: bool) -> float:
        done = 0.0
        for ri, rt in enumerate(it["routes"]):
            if done >= qty - 1e-9:
                break
            if kind == "primary" and ri > 0:
                continue
            if kind == "alt" and ri == 0:
                continue
            pool = (cap_ot if use_ot else cap_left).get(rt["resourceId"])
            if pool is None:
                continue
            hrs = pool[t]
            if hrs <= 0.01:
                continue
            uph = _num(rt["unitsPerHour"])
            q = min(qty - done, hrs * uph)
            if q <= 0:
                continue
            pool[t] -= q / uph
            done += q
            alloc.append({"pid": it["product"]["id"], "rid": rt["resourceId"], "t": t, "qty": q,
                          "kind": "overtime" if use_ot else ("primary" if ri == 0 else "alt")})
        return done

    for t in range(T):
        for it in inp["items"]:
            st = state[it["product"]["id"]]
            avail = st["inv"]
            need = max(0.0, it["demand"][t] + it["ss"][t] - avail)
            if need > 0 and it["batch"]:
                need = math.ceil(need / it["batch"] - 1e-9) * it["batch"]
            if not it["routes"]:
                avail += need
            elif need > 0:
                got = take(it, t, need, "primary", False)
                if got < need:
                    got += take(it, t, need - got, "alt", False)
                k = 1
                while got < need and k <= it["maxCarry"] and t - k >= min(frozen, t):
                    before = len(alloc)
                    got += take(it, t - k, need - got, "any", False)
                    for a in alloc[before:]:
                        a["kind"] = "prebuild"
                        a["prebuildFor"] = t
                    k += 1
                if got < need:
                    got += take(it, t, need - got, "any", True)
                avail += got
            end = avail - it["demand"][t]
            st["inv"] = max(0.0, end)
    return alloc


def project(co: Company, inp: dict[str, Any], alloc: list[dict[str, Any]]) -> dict[str, Any]:
    """موجودی پایان ماه، کمبود، بار خطوط و شاخص‌ها از تخصیص تولید"""
    T, periods = len(inp["periods"]), inp["periods"]
    byP = {it["product"]["id"]: {k: [0.0] * T for k in ("prod", "prebuild", "overtime", "alt")} for it in inp["items"]}
    byR = {r["resource"]["id"]: {"resource": r["resource"], "cap": r["cap"], "hours": [0.0] * T, "overtime": [0.0] * T} for r in inp["resources"]}
    route_of = {(r["productId"], r["resourceId"]): r for r in co.rows("routings")}
    for a in alloc:
        bp = byP.get(a["pid"])
        if bp is None:
            continue
        bp["prod"][a["t"]] += a["qty"]
        if a["kind"] in ("prebuild", "overtime", "alt"):
            bp[a["kind"]][a["t"]] += a["qty"]
        rr, rt = byR.get(a["rid"]), route_of.get((a["pid"], a["rid"]))
        if rr and rt:
            hrs = a["qty"] / _num(rt["unitsPerHour"])
            rr["hours"][a["t"]] += hrs
            if a["kind"] == "overtime":
                rr["overtime"][a["t"]] += hrs
    excess_m = _num(co.s("excessMonths", 3), 3) or 3
    rows = []
    for it in inp["items"]:
        bp = byP[it["product"]["id"]]
        if not it["routes"]:
            # کالای بدون مسیر تولید (بازرگانی): تأمین به اندازه نیاز
            v = it["open"]
            for t in range(T):
                n0 = max(0.0, it["demand"][t] + it["ss"][t] - v)
                bp["prod"][t] = n0
                v = v + n0 - it["demand"][t]
        inv, inv_arr, short = it["open"], [], []
        for t in range(T):
            end = inv + bp["prod"][t] - it["demand"][t]
            short.append(-end if end < 0 else 0.0)
            inv = max(0.0, end)
            inv_arr.append(inv)
        dem, sh = sum(it["demand"]), sum(short)
        rows.append({"product": it["product"], "demand": it["demand"], "ss": it["ss"], "production": bp["prod"], "prebuild": bp["prebuild"],
                     "overtime": bp["overtime"], "alt": bp["alt"], "inventory": inv_arr, "shortage": short, "open": it["open"], "rel": it["rel"],
                     "fillRate": 1 - sh / dem if dem > 0 else 1.0,
                     "belowSS": sum(1 for i, v in enumerate(inv_arr) if v < it["ss"][i] * 0.999 - 0.5),
                     "excess": sum(1 for i, v in enumerate(inv_arr) if i + 1 < T and v > it["demand"][i + 1] * excess_m)})
    res = []
    for r in inp["resources"]:
        x = byR[r["resource"]["id"]]
        x["util"] = [h / x["cap"] if x["cap"] else None for h in x["hours"]]
        x["peak"] = max([u or 0 for u in x["util"]] + [0])
        x["avg"] = sum(u or 0 for u in x["util"]) / T
        res.append(x)
    tot_dem = sum(sum(r["demand"]) for r in rows)
    tot_short = sum(sum(r["shortage"]) for r in rows)
    tot_dem_v = sum(sum(r["demand"]) * _num(r["product"].get("unitPrice")) for r in rows)
    tot_short_v = sum(sum(r["shortage"]) * _num(r["product"].get("unitPrice")) for r in rows)
    inv_value = [sum(r["inventory"][t] * _num(r["product"].get("unitCost")) for r in rows) for t in range(T)]
    w = lambda r: _num(r["product"].get("unitWeightKg")) / 1000  # noqa: E731
    return {"periods": periods, "rows": rows, "resources": res, "invValue": inv_value,
            "kpi": {"fillRate": 1 - tot_short / tot_dem if tot_dem else 1.0, "fillRateValue": 1 - tot_short_v / tot_dem_v if tot_dem_v else 1.0,
                    "shortageValue": tot_short_v, "prebuildTons": sum(sum(r["prebuild"]) * w(r) for r in rows),
                    "overtimeHours": sum(sum(r["overtime"]) for r in res),
                    "bottlenecks": sum(sum(1 for u in r["util"] if u is not None and u > 1.0001) for r in res),
                    "avgUtil": sum(r["avg"] for r in res) / len(res) if res else 0.0,
                    "belowSS": sum(1 for r in rows if r["belowSS"] > 0)}}


# ---------------------------------------------------------------- ۳) MRP
def mrp(co: Company, plan: dict[str, Any]) -> list[dict[str, Any]]:
    """نیاز ناخالص = تولید × مقدار BOM × (۱+ضایعات)؛ نیاز خالص با موجودی، سفارش در راه و ذخیره اطمینان؛ سفارش با MOQ؛ صدور = دریافت − زمان تأمین"""
    T = len(plan["periods"])
    prod_by = {r["product"]["id"]: r["production"] for r in plan["rows"]}
    mats: dict[str, list[float]] = {}
    for b in co.rows("bom"):
        pr = prod_by.get(b["productId"])
        if pr is None:
            continue
        g = mats.setdefault(b["materialId"], [0.0] * T)
        for t in range(T):
            g[t] += pr[t] * _num(b["qtyPer"]) * (1 + _num(b.get("scrap")))
    on_hand: dict[str, float] = {}
    on_order: dict[str, float] = {}
    for r in co.rows("materialInventory"):
        on_hand[r["materialId"]] = on_hand.get(r["materialId"], 0.0) + _num(r.get("qty"))
        on_order[r["materialId"]] = on_order.get(r["materialId"], 0.0) + _num(r.get("onOrder"))
    mat_by = {m["id"]: m for m in co.rows("materials")}
    out = []
    for mid, g in mats.items():
        m = mat_by.get(mid)
        if m is None:
            continue
        avg = sum(g) / T
        lt = max(0, math.ceil((_num(m.get("leadTimeDays")) - 5) / 30))
        ss = _num(m.get("safetyStockDays")) / 30 * avg
        moq = _num(m.get("moq"))
        oh, sched = on_hand.get(mid, 0.0), on_order.get(mid, 0.0)
        rec_t = min(T - 1, max(0, lt - 1))
        inv = oh
        net, receipts, releases, proj, late = [0.0] * T, [0.0] * T, [0.0] * T, [], []
        for t in range(T):
            avail = inv + (sched if t == rec_t else 0.0) - g[t]
            if avail < ss:
                need = ss - avail
                net[t] = need
                qty = max(need, moq) if moq > 0 else need
                if moq > 0:
                    qty = math.ceil(qty / moq - 1e-9) * moq
                receipts[t] = qty
                rel = t - lt
                if rel < 0:
                    late.append(t)
                    rel = 0
                releases[rel] += qty
                avail += qty
            inv = avail
            proj.append(inv)
        out.append({"material": m, "gross": g, "net": net, "receipts": receipts, "releases": releases, "projected": proj, "ss": ss,
                    "onHand": oh, "onOrder": sched, "leadMonths": lt, "late": late, "internal": m.get("internalCompany") or ""})
    return out


# ---------------------------------------------------------------- ۴) بهای تمام‌شده، سود و زیان، سرمایه در گردش
def unit_costs(co: Company) -> dict[str, dict[str, float]]:
    """مواد (داخلی/وارداتی/درون‌گروهی) از BOM، تبدیل = هزینه ساعت خط اصلی ÷ نرخ تولید، سربار = بهای تمام‌شده − مواد − تبدیل"""
    mats = {m["id"]: m for m in co.rows("materials")}
    sup = {s["id"]: s for s in co.rows("suppliers")}
    out = {p["id"]: {"matDom": 0.0, "matImp": 0.0, "matIc": 0.0, "conv": 0.0, "overhead": 0.0} for p in co.rows("products")}
    for b in co.rows("bom"):
        m, u = mats.get(b["materialId"]), out.get(b["productId"])
        if not m or u is None:
            continue
        c = _num(b["qtyPer"]) * (1 + _num(b.get("scrap"))) * _num(m.get("unitCost"))
        ic = m.get("internalCompany")
        if ic and not (isinstance(ic, float) and math.isnan(ic)):
            u["matIc"] += c
        elif _true(sup.get(m.get("supplierId"), {}).get("isImport"), False):
            u["matImp"] += c
        else:
            u["matDom"] += c
    prim = {}
    for r in co.rows("routings"):
        if (_num(r.get("priority"), 1) or 1) == 1 and _num(r.get("unitsPerHour")) > 0:
            prim[r["productId"]] = r
    res = {r["id"]: r for r in co.rows("resources")}
    for p in co.rows("products"):
        u, r = out[p["id"]], prim.get(p["id"])
        rr = res.get(r["resourceId"]) if r else None
        u["conv"] = _num(rr.get("costPerHour")) / _num(r["unitsPerHour"]) if r and rr else 0.0
        mat = u["matDom"] + u["matImp"] + u["matIc"]
        u["overhead"] = max(0.0, _num(p.get("unitCost")) - mat - u["conv"])
        u["std"] = mat + u["conv"] + u["overhead"]
    return out


def dso_days(co: Company) -> float:
    cust = {c["id"]: c for c in co.rows("customers")}
    window = set(p_range(p_add(co.cycle, -12), 12))
    w = t = 0.0
    for s in co.rows("salesActuals"):
        if int(s["period"]) not in window:
            continue
        c = cust.get(s["customerId"])
        if not c:
            continue
        w += _num(s["revenue"])
        t += _num(s["revenue"]) * _num(c.get("paymentDays"))
    return t / w if w else 30.0


def finance(co: Company, plan: dict[str, Any], mrp_rows: list[dict[str, Any]], drivers: dict[str, float] | None = None) -> dict[str, Any]:
    d = drivers or {}
    per, T = plan["periods"], len(plan["periods"])
    ci = _num(co.s("costInflation", 0.02), 0.02)
    hold = _num(co.s("holdingRate", 0.015), 0.015)
    otp = _num(co.s("overtimePremium", 0.5), 0.5)
    dpo = _num(co.s("dpoDays", 45), 45)
    uc, disc = unit_costs(co), avg_discount(co)
    kP, kM, kFx, kC = (1 + d.get(k, 0) / 100 for k in ("price", "material", "fx", "conversion"))
    keys = ("revenue", "material", "conversion", "overhead", "cogs", "gross", "overtime", "holding", "operating", "lost", "salesQty", "tons")
    tot = {k: [0.0] * T for k in keys}
    budget = {(b["productId"], int(b["period"])): b for b in co.rows("budgets")}
    bud = {"revenue": [0.0] * T, "qty": [0.0] * T, "has": [0] * T, "cogs": [0.0] * T}
    bridge = {"budget": 0.0, "volume": 0.0, "plan": 0.0}
    by_product = []
    for r in plan["rows"]:
        p = r["product"]
        u = uc.get(p["id"], {"matDom": 0, "matImp": 0, "matIc": 0, "conv": 0, "overhead": 0})
        bp = {"productId": p["id"], "revenue": 0.0, "cogs": 0.0, "qty": 0.0, "lost": 0.0}
        for t in range(T):
            infl = (1 + ci) ** t
            sold = max(0.0, r["demand"][t] - r["shortage"][t])
            price = price_at(co, p, per[t]) * (1 - disc) * kP
            mat = (u["matDom"] + u["matIc"]) * infl * kM + u["matImp"] * infl * kM * kFx
            conv, oh = u["conv"] * infl * kC, u["overhead"] * infl
            rev = sold * price
            tot["revenue"][t] += rev
            tot["material"][t] += sold * mat
            tot["conversion"][t] += sold * conv
            tot["overhead"][t] += sold * oh
            tot["lost"][t] += r["shortage"][t] * price
            tot["salesQty"][t] += sold
            tot["tons"][t] += sold * _num(p.get("unitWeightKg")) / 1000
            tot["holding"][t] += r["inventory"][t] * _num(p.get("unitCost")) * infl * hold
            bp["revenue"] += rev
            bp["cogs"] += sold * (mat + conv + oh)
            bp["qty"] += sold
            bp["lost"] += r["shortage"][t] * price
            b = budget.get((p["id"], per[t]))
            if b is not None:
                bq, brv = _num(b.get("qty")), _num(b.get("revenue"))
                bud["revenue"][t] += brv
                bud["qty"][t] += bq
                bud["has"][t] = 1
                bud["cogs"][t] += bq * _num(p.get("unitCost")) * infl
                b_price = brv / bq if bq else price
                bridge["budget"] += brv
                bridge["volume"] += (sold - bq) * b_price
                bridge["plan"] += rev
        bp["gross"] = bp["revenue"] - bp["cogs"]
        by_product.append(bp)
    bridge["priceMix"] = bridge["plan"] - bridge["budget"] - bridge["volume"]
    for r in plan["resources"]:
        for t in range(T):
            tot["overtime"][t] += r["overtime"][t] * _num(r["resource"].get("costPerHour")) * otp * (1 + ci) ** t * kC
    for t in range(T):
        tot["cogs"][t] = tot["material"][t] + tot["conversion"][t] + tot["overhead"][t]
        tot["gross"][t] = tot["revenue"][t] - tot["cogs"][t]
        tot["operating"][t] = tot["gross"][t] - tot["overtime"][t] - tot["holding"][t]
    dso = dso_days(co)
    sup = {s["id"]: s for s in co.rows("suppliers")}
    wc = {k: [0.0] * T for k in ("inventory", "materials", "purchases", "receivables", "payables", "net")}
    for t in range(T):
        wc["inventory"][t] = plan["invValue"][t]
        wc["materials"][t] = sum(max(0.0, x["projected"][t]) * _num(x["material"].get("unitCost")) for x in mrp_rows)
        wc["purchases"][t] = sum(x["receipts"][t] * _num(x["material"].get("unitCost")) * kM *
                                 (kFx if _true(sup.get(x["material"].get("supplierId"), {}).get("isImport"), False) else 1) for x in mrp_rows)
        wc["receivables"][t] = tot["revenue"][t] * dso / 30
        wc["payables"][t] = wc["purchases"][t] * dpo / 30
        wc["net"][t] = wc["inventory"][t] + wc["materials"][t] + wc["receivables"][t] - wc["payables"][t]
    n12 = min(12, T)
    s12 = lambda a: sum(a[:n12])  # noqa: E731
    bud_m = [t for t in range(n12) if bud["has"][t]]
    bud_rev = sum(bud["revenue"][t] for t in bud_m)
    plan_rev_b = sum(tot["revenue"][t] for t in bud_m)
    rev12, gp12, op12 = s12(tot["revenue"]), s12(tot["gross"]), s12(tot["operating"])
    return {"periods": per, "totals": tot, "budget": bud, "bridge": bridge, "wc": wc, "dso": dso, "byProduct": by_product, "unitCosts": uc,
            "kpi": {"revenue": rev12, "gross": gp12, "gm": gp12 / rev12 if rev12 else None, "operating": op12, "lost": s12(tot["lost"]),
                    "tons": s12(tot["tons"]), "fillRate": plan["kpi"]["fillRate"], "util": plan["kpi"]["avgUtil"],
                    "nwcEnd": wc["net"][n12 - 1], "budgetRevenue": bud_rev, "budgetGap": plan_rev_b / bud_rev - 1 if bud_rev else None,
                    "budgetMonths": len(bud_m)}}


# ---------------------------------------------------------------- ۵) سناریوها و مونت‌کارلو
PRESETS = [
    {"name": "پایه", "drivers": {}},
    {"name": "خوش‌بینانه", "drivers": {"demand": 10, "price": 3}},
    {"name": "بدبینانه", "drivers": {"demand": -10, "material": 15, "fx": 20, "conversion": 10}},
    {"name": "شوک ارزی", "drivers": {"demand": -3, "price": 8, "material": 5, "fx": 35, "conversion": 5}},
    {"name": "افزایش ظرفیت", "drivers": {"demand": 8, "conversion": 6, "capacity": 15}},
]


def plan_with_drivers(co: Company, metrics: pd.DataFrame | None, drivers: dict[str, float]) -> tuple[dict, list, dict]:
    """سناریو: تقاضا و ظرفیت برنامه تولید را دوباره می‌سازند؛ قیمت، مواد، ارز و تبدیل فقط سود و زیان را تغییر می‌دهند"""
    df = 1 + drivers.get("demand", 0) / 100
    inp = supply_inputs(co, metrics, demand_factor=df if drivers.get("demand") else None, capacity_factor=1 + drivers.get("capacity", 0) / 100)
    plan = project(co, inp, plan_mps(inp))
    m = mrp(co, plan)
    return plan, m, finance(co, plan, m, drivers)


def montecarlo(co: Company, plan: dict, fin: dict, drivers: dict[str, float] | None = None, runs: int = 5000) -> dict[str, Any]:
    """شبیه‌سازی: خطای تقاضا = σنسبی × (۰٫۶ × اثر مشترک محصول + ۰٫۸ × نوفه ماهانه)؛ فروش ≤ موجودی + تولید برنامه"""
    here = Path(__file__).resolve()
    for cand in (here.parent, here.parent.parent.parent / "engine"):
        if (cand / "ibp_engine").is_dir() and str(cand) not in sys.path:
            sys.path.insert(0, str(cand))
    from ibp_engine import scenarios  # noqa: E402

    d = drivers or {}
    kP, kM, kFx, kC = (1 + d.get(k, 0) / 100 for k in ("price", "material", "fx", "conversion"))
    ci = _num(co.s("costInflation", 0.02), 0.02)
    n = min(12, len(plan["periods"]))
    disc = avg_discount(co)
    prods = []
    for r in plan["rows"]:
        u = fin["unitCosts"].get(r["product"]["id"], {"matDom": 0, "matImp": 0, "matIc": 0, "conv": 0, "overhead": 0})
        prods.append({"id": r["product"]["id"], "rel": r["rel"], "open": r["open"], "demand": r["demand"][:n], "production": r["production"][:n],
                      "price": [price_at(co, r["product"], per) * (1 - disc) * kP for per in plan["periods"][:n]],
                      "cost": [((u["matDom"] + u["matIc"]) * kM + u["matImp"] * kM * kFx) * (1 + ci) ** t + u["conv"] * (1 + ci) ** t * kC + u["overhead"] * (1 + ci) ** t
                               for t in range(n)]})
    b = fin["budget"]
    pay = {"runs": runs, "months": n, "seed": 7, "products": prods, "budgetMask": [b["has"][t] for t in range(n)],
           "budgetGross": sum(b["revenue"][t] - b["cogs"][t] for t in range(n) if b["has"][t]), "budgetRevenue": fin["kpi"]["budgetRevenue"]}
    return scenarios.montecarlo(pay)


def run_scenarios(co: Company, metrics: pd.DataFrame | None = None, presets: list[dict] | None = None, mc_runs: int = 0) -> pd.DataFrame:
    rows = []
    for sc in presets or PRESETS:
        plan, _, fin = plan_with_drivers(co, metrics, sc["drivers"])
        k = fin["kpi"]
        row = {"CompanyCode": co.code, "scenario": sc["name"], **{"drv_" + x: sc["drivers"].get(x, 0) for x in ("demand", "price", "material", "fx", "conversion", "capacity")},
               "revenue12": k["revenue"], "gross12": k["gross"], "gm": k["gm"], "operating12": k["operating"], "lost12": k["lost"],
               "fillRate": plan["kpi"]["fillRate"], "avgUtil": plan["kpi"]["avgUtil"], "budgetGap": k["budgetGap"], "nwcEnd": k["nwcEnd"]}
        if mc_runs:
            mc = montecarlo(co, plan, fin, sc["drivers"], mc_runs)
            row.update({"mc_gross_p10": mc["gross"]["p10"], "mc_gross_p50": mc["gross"]["p50"], "mc_gross_p90": mc["gross"]["p90"],
                        "mc_fill_p50": mc["fill"]["p50"], "mc_prob_gross_budget": mc.get("probGrossBudget")})
        rows.append(row)
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- اجرای کامل و جدول‌های خروجی
def run_company(co: Company, metrics: pd.DataFrame | None = None, drivers: dict[str, float] | None = None) -> dict[str, pd.DataFrame]:
    dv = drivers or {}
    df = 1 + dv.get("demand", 0) / 100
    inp = supply_inputs(co, metrics, demand_factor=df if dv.get("demand") else None, capacity_factor=1 + dv.get("capacity", 0) / 100)
    plan = project(co, inp, plan_mps(inp))
    m = mrp(co, plan)
    fin = finance(co, plan, m, dv)
    C = co.code
    plan_rows = [{"CompanyCode": C, "productId": r["product"]["id"], "period": per, "demand": r["demand"][t], "safetyStock": r["ss"][t],
                  "production": r["production"][t], "prebuild": r["prebuild"][t], "overtime": r["overtime"][t], "alt": r["alt"][t],
                  "inventoryEnd": r["inventory"][t], "shortage": r["shortage"][t], "relError": r["rel"], "openingInventory": r["open"]}
                 for r in plan["rows"] for t, per in enumerate(plan["periods"])]
    load_rows = [{"CompanyCode": C, "resourceId": x["resource"]["id"], "period": per, "capacityHours": x["cap"], "hours": x["hours"][t],
                  "overtimeHours": x["overtime"][t], "utilization": x["util"][t]} for x in plan["resources"] for t, per in enumerate(plan["periods"])]
    mrp_rows = [{"CompanyCode": C, "materialId": x["material"]["id"], "period": per, "gross": x["gross"][t], "net": x["net"][t],
                 "plannedReceipt": x["receipts"][t], "plannedRelease": x["releases"][t], "projected": x["projected"][t], "safetyStock": x["ss"],
                 "leadMonths": x["leadMonths"], "onHand": x["onHand"], "onOrder": x["onOrder"], "internalCompany": x["internal"]}
                for x in m for t, per in enumerate(plan["periods"])]
    uc_rows = [{"CompanyCode": C, "productId": pid, **u} for pid, u in fin["unitCosts"].items()]
    pnl = []
    for t, per in enumerate(fin["periods"]):
        o = {"CompanyCode": C, "period": per, **{k: v[t] for k, v in fin["totals"].items()}}
        o.update({"nwc": fin["wc"]["net"][t], "receivables": fin["wc"]["receivables"][t], "payables": fin["wc"]["payables"][t],
                  "invFinished": fin["wc"]["inventory"][t], "invMaterials": fin["wc"]["materials"][t],
                  "budgetRevenue": fin["budget"]["revenue"][t], "hasBudget": fin["budget"]["has"][t]})
        pnl.append(o)
    return {"FactPlan": pd.DataFrame(plan_rows), "FactResourceLoad": pd.DataFrame(load_rows), "FactMRP": pd.DataFrame(mrp_rows),
            "FactUnitCost": pd.DataFrame(uc_rows), "FactPnL": pd.DataFrame(pnl),
            "FactPlanKPI": pd.DataFrame([{"CompanyCode": C, **plan["kpi"], **{"plan" + k[0].upper() + k[1:]: v for k, v in fin["kpi"].items()},
                                          **{"bridge" + k[0].upper() + k[1:]: v for k, v in fin["bridge"].items()}, "dsoDays": fin["dso"]}])}


def main(argv: list[str]) -> None:
    import argparse

    ap = argparse.ArgumentParser(description="IBP calculations for Power BI")
    ap.add_argument("data", help="folder with input CSVs")
    ap.add_argument("out", help="output folder for fact CSVs")
    ap.add_argument("--forecast", action="store_true", help="also run the statistical forecast (needs statsmodels, scikit-learn)")
    ap.add_argument("--metrics", help="FactForecastMetrics CSV to use for safety stock (default: from --forecast run, else sales CV)")
    ap.add_argument("--scenarios", action="store_true", help="also run the preset scenarios (re-plans supply for each)")
    ap.add_argument("--mc", type=int, default=0, help="Monte Carlo runs per scenario (e.g. 5000); 0 = off")
    a = ap.parse_args(argv)
    companies = pd.read_csv(Path(a.data) / "companies.csv", encoding="utf-8-sig")["CompanyCode"].astype(str).tolist()
    outs: dict[str, list[pd.DataFrame]] = {}
    ext_metrics = pd.read_csv(a.metrics, encoding="utf-8-sig", dtype={"productId": str}) if a.metrics else None
    for code in companies:
        co = load(a.data, code)
        met = None
        if a.forecast:
            fc, met = run_forecast(co)
            outs.setdefault("FactStatForecast", []).append(fc)
            outs.setdefault("FactForecastMetrics", []).append(met)
        if ext_metrics is not None:
            met = ext_metrics[ext_metrics["CompanyCode"].astype(str) == code]
        for k, v in run_company(co, met).items():
            outs.setdefault(k, []).append(v)
        if a.scenarios:
            outs.setdefault("FactScenario", []).append(run_scenarios(co, met, mc_runs=a.mc))
        print("done", code, flush=True)
    Path(a.out).mkdir(parents=True, exist_ok=True)
    for k, parts in outs.items():
        pd.concat(parts, ignore_index=True).to_csv(Path(a.out) / f"{k}.csv", index=False, encoding="utf-8-sig")


if __name__ == "__main__":
    main(sys.argv[1:])

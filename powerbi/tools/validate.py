"""مقایسه خروجی محاسبات پایتون (ibp_pbi) با نتایج مرجع برنامه IBP برای همه شرکت‌ها.
اجرا: python powerbi/tools/validate.py <پوشه نمونه: data و reference>
"""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import ibp_pbi as M  # noqa: E402

root = Path(sys.argv[1])
data, ref = root / "data", root / "reference"
met_all = pd.read_csv(ref / "forecast_metrics.csv", encoding="utf-8-sig", dtype={"productId": str})
CHECKS = {
    "FactPlan": ("plan", ["productId", "period"], ["demand", "safetyStock", "production", "prebuild", "overtime", "alt", "inventoryEnd", "shortage"]),
    "FactResourceLoad": ("resource_load", ["resourceId", "period"], ["capacityHours", "hours", "overtimeHours", "utilization"]),
    "FactMRP": ("mrp", ["materialId", "period"], ["gross", "net", "plannedReceipt", "plannedRelease", "projected"]),
    "FactUnitCost": ("unit_costs", ["productId"], ["matDom", "matImp", "matIc", "conv", "overhead", "std"]),
    "FactPnL": ("pnl_monthly", ["period"], ["revenue", "material", "conversion", "overhead", "gross", "overtime", "holding", "operating", "lost", "tons", "nwc", "budgetRevenue"]),
}
worst = 0.0
for code in pd.read_csv(data / "companies.csv", encoding="utf-8-sig")["CompanyCode"].astype(str):
    co = M.load(data, code)
    out = M.run_company(co, met_all[met_all["CompanyCode"] == code])
    for fact, (rname, keys, cols) in CHECKS.items():
        r = pd.read_csv(ref / f"{rname}.csv", encoding="utf-8-sig", dtype={k: str for k in ("productId", "resourceId", "materialId")})
        r = r[r["CompanyCode"].astype(str) == code]
        m = out[fact].merge(r, on=keys, suffixes=("_py", "_app"), how="outer", indicator=True)
        missing = (m["_merge"] != "both").sum()
        errs = []
        for c in cols:
            a, b = m[c + "_py"].astype(float).fillna(0), m[c + "_app"].astype(float).fillna(0)
            rel = ((a - b).abs() / b.abs().clip(lower=1.0)).max()
            errs.append(rel)
        e = max(errs) if errs else 0
        worst = max(worst, e)
        print(f"{code} {fact:17s} rows={len(m):5d} unmatched={missing} max_rel_diff={e:.2e}")
    k = out["FactPlanKPI"].iloc[0]
    ks = pd.read_csv(ref / "kpi_summary.csv", encoding="utf-8-sig")
    ks = ks[ks["CompanyCode"] == code].set_index("kpi")["value"].astype(float)
    for a, b in (("planRevenue", "planRevenue12"), ("planGross", "planGross12"), ("fillRate", "fillRate"), ("avgUtil", "avgUtil"), ("planBudgetGap", "budgetGap")):
        va, vb = float(k[a]), float(ks[b])
        d = abs(va - vb) / max(1e-9, abs(vb))
        worst = max(worst, d)
        print(f"{code} KPI {b:15s} python={va:.6g} app={vb:.6g} rel_diff={d:.1e}")
print("WORST", worst)
sys.exit(0 if worst < 1e-6 else 1)

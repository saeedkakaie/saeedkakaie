"""ساخت سند مشخصات (docs/IBP-PowerBI-Spec.html) از قالب docs/spec.src.html.

جدول ستون‌های ورودی، اعداد مرجع (kpi_summary) و فهرست اندازه‌های DAX خودکار پر می‌شوند.
اجرا: python powerbi/tools/build_spec.py <پوشه نمونه: data و reference>
"""
from __future__ import annotations

import csv
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DESC = {
    "companies": "فهرست شرکت‌ها", "settings": "تنظیمات هر شرکت (کلید-مقدار)", "calendar_lunar": "تقویم ماهانه شمسی با روزهای رمضان و دهه محرم (مشترک)",
    "plants": "کارخانه‌ها (روز کاری ماه)", "warehouses": "انبارها", "resources": "خطوط تولید (شیفت، ساعت، راندمان، هزینه ساعت)",
    "families": "خانواده محصول", "products": "محصولات (وزن، قیمت، بهای واحد، چرخه عمر، ذخیره اطمینان، بچ، ماندگاری، کلاس)",
    "routings": "مسیر تولید: محصول × خط با نرخ تولید و اولویت", "suppliers": "تأمین‌کنندگان (وارداتی یا داخلی)",
    "materials": "مواد اولیه و بسته‌بندی (بها، زمان تأمین، MOQ، شرکت تأمین‌کننده درون‌گروهی)", "bom": "فهرست مواد: مقدار در هر واحد و ضایعات",
    "channels": "کانال فروش و تخفیف", "regions": "مناطق فروش", "customers": "مشتریان (کانال، منطقه، مهلت پرداخت)",
    "salesActuals": "فروش واقعی ماهانه: محصول × مشتری", "forecasts": "پیش‌بینی‌ها: نسخه × چرخه × ماه × محصول (با بازه آماری)",
    "budgets": "بودجه ماهانه محصول (مقدار و مبلغ)", "inventory": "موجودی فعلی کالا در انبارها", "materialInventory": "موجودی و سفارش در راه مواد",
    "events": "مناسبت‌ها (رمضان، محرم، کمپین و …)", "eventImpacts": "اثر هر مناسبت بر هر خانواده (درصد)", "cycleSteps": "گام‌های چرخه IBP و وضعیت",
    "actions": "اقدام‌های جلسات", "demandAdjustments": "سابقه تعدیل‌های اجماع",
}
ORDER = ["companies", "settings", "calendar_lunar", "plants", "warehouses", "resources", "families", "products", "routings", "suppliers", "materials",
         "bom", "channels", "regions", "customers", "salesActuals", "forecasts", "budgets", "inventory", "materialInventory", "events",
         "eventImpacts", "demandAdjustments", "cycleSteps", "actions"]

KPI = [
    ("revenueLTM", "درآمد ۱۲ ماه اخیر", "Revenue LTM", "money"), ("revenueExternalLTM", "درآمد خارج از گروه ۱۲ ماه", "Revenue External LTM", "money"),
    ("revenuePrevLTM", "درآمد ۱۲ ماه قبل از آن", "Revenue Prev LTM", "money"), ("tonsLTM", "تناژ ۱۲ ماه اخیر", "Tons LTM", "num1"),
    ("accuracy3m", "دقت ۳ ماه (اجماعی)", "Accuracy 3M", "pct"), ("bias3m", "سوگیری ۳ ماه", "Bias 3M", "pct"),
    ("planRevenue12", "درآمد برنامه ۱۲ ماه", "Plan Revenue 12M", "money"), ("planGross12", "سود ناخالص برنامه ۱۲ ماه", "Plan Gross 12M", "money"),
    ("planGM", "حاشیه ناخالص برنامه", "Plan GM % 12M", "pct"), ("planOperating12", "سود عملیاتی برنامه ۱۲ ماه", "Plan Operating 12M", "money"),
    ("planTons12", "تناژ فروش برنامه ۱۲ ماه", "—", "num1"), ("lostSales12", "فروش ازدست‌رفته ۱۲ ماه", "Lost Sales 12M", "money"),
    ("fillRate", "نرخ پاسخ‌گویی (مقداری، کل افق)", "Fill Rate", "pct2"), ("fillRateValue", "نرخ پاسخ‌گویی (ارزشی)", "Fill Rate (Value)", "pct2"),
    ("avgUtil", "میانگین بهره‌برداری خطوط", "Avg Utilization (KPI)", "pct"), ("bottleneckResourceMonths", "خط×ماه گلوگاه", "Bottleneck Resource-Months", "int"),
    ("overtimeHours", "ساعت اضافه‌کاری", "Overtime Hours", "num1"), ("prebuildTons", "تن پیش‌ساخت", "Prebuild Tons", "num1"),
    ("productsBelowSS", "محصولات زیر ذخیره اطمینان", "Products Below SS", "int"),
    ("inventoryValueFinished", "ارزش موجودی کالای فعلی", "Inventory Value (Current)", "money"),
    ("inventoryValueMaterials", "ارزش موجودی مواد فعلی", "—", "money"),
    ("budgetRevenueComparable", "بودجه درآمد ماه‌های قابل مقایسه", "Budget Revenue (12M)", "money"), ("budgetGap", "شکاف با بودجه", "Budget Gap %", "pct"),
    ("budgetMonths", "ماه‌های دارای بودجه", "—", "int"), ("nwcEnd", "سرمایه در گردش پایان ماه ۱۲", "Net Working Capital (ماه ۱۲)", "money"),
    ("abcA", "تعداد محصولات A", "ABC Class", "int"), ("abcB", "تعداد محصولات B", "ABC Class", "int"), ("abcC", "تعداد محصولات C", "ABC Class", "int"),
    ("top20Share", "سهم ۲۰٪ محصولات برتر", "Top 20% Share", "pct"), ("alertsCritical", "هشدارهای بحرانی", "Critical Alerts", "int"),
    ("alertsTotal", "کل هشدارها", "—", "int"),
]

FA = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def fmt(v: str, kind: str) -> str:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return "—"
    if kind == "money":
        s = f"{x / 1e9:,.1f}"
    elif kind == "pct":
        s = f"{x * 100:.1f}٪"
    elif kind == "pct2":
        s = f"{x * 100:.2f}٪"
    elif kind == "int":
        s = f"{x:,.0f}"
    else:
        s = f"{x:,.1f}"
    return s.replace(",", "٬").replace(".", "٫").translate(FA)


def read(p: Path) -> list[dict[str, str]]:
    with open(p, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def inputs_table(data: Path) -> str:
    rows = ["<table><tr><th style='width:16%'>فایل</th><th style='width:26%'>محتوا</th><th>ستون‌ها</th></tr>"]
    for name in ORDER:
        f = data / f"{name}.csv"
        if not f.exists():
            continue
        with open(f, encoding="utf-8-sig", newline="") as fh:
            head = next(csv.reader(fh), [])
        cols = "، ".join(f"<code>{html.escape(c)}</code>" for c in head)
        rows.append(f"<tr><td><code>{name}.csv</code></td><td>{DESC.get(name, '')}</td><td>{cols}</td></tr>")
    rows.append("</table>")
    return "\n".join(rows)


def reference_table(ref: Path) -> str:
    kv: dict[str, dict[str, str]] = {}
    codes: list[str] = []
    for r in read(ref / "kpi_summary.csv"):
        if r["CompanyCode"] not in codes:
            codes.append(r["CompanyCode"])
        kv.setdefault(r["kpi"], {})[r["CompanyCode"]] = r["value"]
    cyc = kv.get("cycle", {}).get(codes[0], "") if codes else ""
    out = [f"<p>ماه چرخه همه شرکت‌ها در نمونه: <b>{cyc.translate(FA)}</b>. مبالغ به میلیارد ریال.</p>",
           "<table><tr><th>شاخص</th><th>اندازه DAX</th>" + "".join(f"<th>{c}</th>" for c in codes) + "</tr>"]
    for key, label, measure, kind in KPI:
        if key not in kv:
            continue
        out.append(f"<tr><td>{label}</td><td><code>{html.escape(measure)}</code></td>" + "".join(f"<td>{fmt(kv[key].get(c), kind)}</td>" for c in codes) + "</tr>")
    out.append("</table>")
    raw = ["<details><summary>مقادیر کامل (بدون گرد کردن)</summary><table><tr><th>kpi</th>" + "".join(f"<th>{c}</th>" for c in codes) + "</tr>"]
    for k, vals in kv.items():
        raw.append(f"<tr><td><code>{k}</code></td>" + "".join(f"<td dir='ltr'>{html.escape(vals.get(c, ''))}</td>" for c in codes) + "</tr>")
    raw.append("</table></details>")
    return "\n".join(out + raw)


def measures_table(dax: Path) -> str:
    text = dax.read_text(encoding="utf-8").splitlines()
    out, section, last_comment = [], "", ""
    for line in text:
        m = re.match(r"^// =+ (\d\d .+?) =+\s*$", line)
        if m:
            section = m.group(1)
            out.append(f"<tr><th colspan='3'>{html.escape(section)}</th></tr>")
            last_comment = ""
            continue
        if line.startswith("//") and not line.startswith("// ="):
            last_comment = line[2:].strip()
            continue
        m = re.match(r"^(MEASURE|COLUMN) ([^\[]+)\[([^\]]+)\]", line)
        if m:
            kind = "اندازه" if m.group(1) == "MEASURE" else "ستون"
            out.append(f"<tr><td><code>{html.escape(m.group(2))}[{html.escape(m.group(3))}]</code></td><td>{kind}</td><td>{html.escape(last_comment)}</td></tr>")
            last_comment = ""
        elif line.strip() == "":
            last_comment = ""
    n = sum(1 for r in out if r.startswith("<tr><td>"))
    return f"<p>{str(n).translate(FA)} مورد؛ متن کامل در <code>dax/measures.dax</code>.</p><table><tr><th>نام</th><th>نوع</th><th>توضیح</th></tr>" + "\n".join(out) + "</table>"


def main(argv: list[str]) -> None:
    sample = Path(argv[0]) if argv else ROOT / "sample"
    src = (ROOT / "docs" / "spec.src.html").read_text(encoding="utf-8")
    doc = (src.replace("{{INPUTS}}", inputs_table(sample / "data"))
              .replace("{{REFERENCE}}", reference_table(sample / "reference"))
              .replace("{{MEASURES}}", measures_table(ROOT / "dax" / "measures.dax")))
    out = ROOT / "docs" / "IBP-PowerBI-Spec.html"
    out.write_text(doc, encoding="utf-8")
    print("→", out)


if __name__ == "__main__":
    main(sys.argv[1:])

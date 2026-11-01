"""ساخت مدل اکسل فرمول‌نویسی‌شده IBP (یک فایل برای هر شرکت).

همه محاسبات با فرمول اکسل است؛ ورودی‌ها در شیت‌های «ورودی_…» و خروجی‌ها برای Power BI در شیت‌های «خروجی_…».
اجرا: python build_excel_model.py <پوشه داده نمونه (CSV)> <کد شرکت> <فایل خروجی .xlsx>
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import pandas as pd
from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as CL
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import ibp_pbi as M  # noqa: E402

# ------------------------------------------------------------------ اندازه‌ها
NP, NL, NMAT, NBOM, NFAM = 60, 15, 40, 400, 15      # ظرفیت ردیف: محصول، خط، ماده، BOM، خانواده
H, T, NACC = 24, 12, 6                               # ماه‌های گذشته، ماه‌های برنامه، ماه‌های سنجش دقت
FONT = "Tahoma"

# ------------------------------------------------------------------ نام شیت‌ها
S_GUIDE = "راهنما"
S_SET, S_PROD, S_LINE, S_FAM, S_CAL = "ورودی_تنظیمات", "ورودی_محصولات", "ورودی_خطوط", "ورودی_خانواده", "ورودی_تقویم_مناسبت"
S_SQ, S_SR, S_ADJ, S_BUD, S_PF = "ورودی_فروش_مقدار", "ورودی_فروش_مبلغ", "ورودی_تعدیل_اجماع", "ورودی_بودجه", "ورودی_پیش_بینی_قبلی"
S_MAT, S_BOM = "ورودی_مواد", "ورودی_BOM"
C1, C2, C3, C4, C5, C6 = "م۱_پورتفوی", "م۲_پیش_بینی_آماری", "م۳_برنامه_تقاضا", "م۴_دقت_پیش_بینی", "م۵_برنامه_تولید", "م۶_ظرفیت"
C7, C8, C9, C10 = "م۷_محاسبه_BOM", "م۸_مواد_MRP", "م۹_مالی", "م۱۰_داشبورد"
O_PM, O_HIST, O_ACC, O_LINE, O_MAT, O_FIN, O_PF, O_KPI = ("خروجی_محصول_ماه", "خروجی_فروش_گذشته", "خروجی_دقت", "خروجی_خط_ماه",
                                                         "خروجی_ماده_ماه", "خروجی_مالی_ماه", "خروجی_پورتفوی", "خروجی_KPI")

# ------------------------------------------------------------------ سبک‌ها
F_BASE = Font(name=FONT, size=10)
F_BOLD = Font(name=FONT, size=10, bold=True)
F_HEAD = Font(name=FONT, size=10, bold=True, color="FFFFFF")
F_TITLE = Font(name=FONT, size=14, bold=True, color="1F3864")
F_BLOCK = Font(name=FONT, size=11, bold=True, color="1F3864")
F_NOTE = Font(name=FONT, size=9, italic=True, color="595959")
F_INPUT = Font(name=FONT, size=10, color="0000FF")
FILL_HEAD = PatternFill("solid", fgColor="2F5597")
FILL_INPUT = PatternFill("solid", fgColor="FFF2CC")
FILL_BLOCK = PatternFill("solid", fgColor="DEEBF7")
FILL_KEY = PatternFill("solid", fgColor="E2EFDA")
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
RIGHT = Alignment(horizontal="right", vertical="center", wrap_text=True)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
FMT_Q, FMT_D, FMT_P, FMT_M = "#,##0", "#,##0.00", "0.0%", "#,##0"


def q(sheet: str) -> str:
    return "'" + sheet + "'!"


def rng(sheet: str, c1: str, r1: int, c2: str, r2: int, absolute: bool = True) -> str:
    d = "$" if absolute else ""
    return f"{q(sheet)}{d}{c1}{d}{r1}:{d}{c2}{d}{r2}"


# ------------------------------------------------------------------ ابزار نوشتن
class Book:
    def __init__(self) -> None:
        self.wb = Workbook()
        self.wb.remove(self.wb.active)
        self.blocks: dict[tuple[str, str], tuple[int, int]] = {}   # (شیت، کلید) ← (ردیف اول داده، ستون اول)

    def sheet(self, name: str, title: str, note: str, color: str) -> object:
        ws = self.wb.create_sheet(name)
        ws.sheet_view.rightToLeft = True
        ws.sheet_properties.tabColor = color
        ws["A1"] = title
        ws["A1"].font = F_TITLE
        ws["A2"] = note
        ws["A2"].font = F_NOTE
        ws["A2"].alignment = Alignment(horizontal="right", vertical="top", wrap_text=True)
        ws.merge_cells("A2:P2")
        ws.row_dimensions[2].height = 48
        return ws

    def name(self, nm: str, ref: str) -> None:
        self.wb.defined_names[nm] = DefinedName(nm, attr_text=ref)


def head(ws, row: int, col: int, labels: list, widths: list | None = None) -> None:
    for i, lab in enumerate(labels):
        c = ws.cell(row=row, column=col + i, value=lab)
        c.font, c.fill, c.alignment, c.border = F_HEAD, FILL_HEAD, CENTER, BORDER
        if widths and i < len(widths) and widths[i]:
            ws.column_dimensions[CL(col + i)].width = widths[i]
    ws.row_dimensions[row].height = 30


def put(ws, row: int, col: int, value, fmt: str | None = None, inp: bool = False, bold: bool = False) -> None:
    c = ws.cell(row=row, column=col, value=value)
    c.font = F_INPUT if inp else (F_BOLD if bold else F_BASE)
    if inp:
        c.fill = FILL_INPUT
    c.border = BORDER
    c.alignment = RIGHT
    if fmt:
        c.number_format = fmt


def block_title(ws, row: int, title: str, formula: str, ncols: int) -> None:
    ws.cell(row=row, column=1, value=title).font = F_BLOCK
    for cc in range(1, ncols + 3):
        ws.cell(row=row, column=cc).fill = FILL_BLOCK
    text = formula.strip()
    if text.startswith("="):
        text = "محاسبه" + " " + text
    ws.cell(row=row + 1, column=1, value=text or None).font = F_NOTE
    ws.merge_cells(start_row=row + 1, start_column=1, end_row=row + 1, end_column=min(ncols + 2, 16))
    ws.row_dimensions[row + 1].height = 30
    ws.cell(row=row + 1, column=1).alignment = Alignment(horizontal="right", vertical="top", wrap_text=True)


def cal_label(k: int) -> str:
    """برچسب ماه k (۱..۳۶) از شیت تقویم"""
    return f"={q(S_CAL)}$D${4 + k}"


def cal_period(k: int) -> str:
    return f"{q(S_CAL)}$C${4 + k}"


# ------------------------------------------------------------------ داده نمونه
def sample(data_dir: str, code: str) -> dict:
    co = M.load(data_dir, code)
    cyc = co.cycle
    hist = M.p_range(M.p_add(cyc, -H), H)
    fut = M.p_range(cyc, T)
    prods = [p for p in co.rows("products")]
    fam = {f["id"]: f for f in co.rows("families")}
    res = {r["id"]: r for r in co.rows("resources")}
    plants = {p["id"]: p for p in co.rows("plants")}
    prim = {}
    for r in co.rows("routings"):
        if (M._num(r.get("priority"), 1) or 1) == 1 and M._num(r.get("unitsPerHour")) > 0:
            if r["productId"] not in prim or M._num(r["unitsPerHour"]) > M._num(prim[r["productId"]]["unitsPerHour"]):
                prim[r["productId"]] = r
    inv = {}
    for r in co.rows("inventory"):
        inv[r["productId"]] = inv.get(r["productId"], 0) + M._num(r["qty"])
    sq, sr = {}, {}
    for s in co.rows("salesActuals"):
        k = (s["productId"], int(s["period"]))
        sq[k] = sq.get(k, 0) + M._num(s["qty"])
        sr[k] = sr.get(k, 0) + M._num(s["revenue"])
    bud = {(b["productId"], int(b["period"])): b for b in co.rows("budgets")}
    prevfc = {}
    for f in co.rows("forecasts"):
        if f["version"] == M.CONSENSUS and int(f["cycle"]) == M.p_add(int(f["period"]), -1):
            k = (f["productId"], int(f["period"]))
            prevfc[k] = prevfc.get(k, 0) + M._num(f["qty"])
    cal = {int(r["PeriodKey"]): r for r in co.rows("calendar_lunar")}
    evs = co.rows("events")
    camp = {}
    for per in hist + fut:
        v = 0.0
        for ev in evs:
            if ev.get("kind") in ("کمپین", "سایر"):
                v = max(v, M.event_intensity(co, per, ev, cal))
        camp[per] = v
    kind_of = {e["id"]: e.get("kind") for e in evs}
    upl = {}
    for im in co.rows("eventImpacts"):
        kd = kind_of.get(im["eventId"])
        key = {"رمضان": "R", "محرم": "M"}.get(kd, "C")
        upl[(im["familyId"], key)] = M._num(im["uplift"])
    mats = co.rows("materials")
    sup = {s["id"]: s for s in co.rows("suppliers")}
    minv, mord = {}, {}
    for r in co.rows("materialInventory"):
        minv[r["materialId"]] = minv.get(r["materialId"], 0) + M._num(r.get("qty"))
        mord[r["materialId"]] = mord.get(r["materialId"], 0) + M._num(r.get("onOrder"))
    pid_code = {p["id"]: p["code"] for p in prods}
    mid_code = {m["id"]: m["code"] for m in mats}
    return {"co": co, "cycle": cyc, "hist": hist, "fut": fut, "prods": prods, "fam": fam, "res": res, "plants": plants, "prim": prim,
            "inv": inv, "sq": sq, "sr": sr, "bud": bud, "prevfc": prevfc, "cal": cal, "camp": camp, "upl": upl, "mats": mats, "sup": sup,
            "minv": minv, "mord": mord, "pid_code": pid_code, "mid_code": mid_code, "disc": M.avg_discount(co), "dso": M.dso_days(co)}


# ------------------------------------------------------------------ ساخت
def build(data_dir: str, code: str, out: str) -> None:
    d = sample(data_dir, code)
    co = d["co"]
    B = Book()
    wb = B.wb
    P0 = 5                    # ردیف اول داده در جدول‌های ورودی
    PR = lambda i: P0 + i     # noqa: E731  ردیف محصول i (از 0)
    LAST_P = P0 + NP - 1

    # ============================================================ راهنما (پر کردن در پایان)
    g = B.sheet(S_GUIDE, "مدل اکسل IBP — راهنمای مرحله به مرحله", "", "808080")

    # ============================================================ ورودی_تنظیمات
    ws = B.sheet(S_SET, "تنظیمات شرکت", "خانه‌های زرد ورودی هستند. هر عدد این‌جا یک نام (Name) دارد که در فرمول‌های همه شیت‌ها با همان نام استفاده شده است؛ مثلاً PriceInfl.", "FFC000")
    head(ws, 4, 1, ["عنوان", "مقدار", "نام در فرمول‌ها", "توضیح"], [34, 16, 18, 70])
    st = co.settings
    S = [
        ("کد شرکت", code, "CompanyCode", "در همه خروجی‌ها می‌آید تا Power BI فایل‌های چند شرکت را کنار هم بگذارد", None),
        ("نام شرکت", st.get("companyName", code), "CompanyName", "", None),
        ("ماه چرخه (اولین ماه برنامه)", int(d["cycle"]), "CycleP", "سال و ماه شمسی به‌صورت yyyymm؛ مثلاً 140508 = آبان ۱۴۰۵. ۲۴ ماه قبل از آن «گذشته» و ۱۲ ماه از آن «برنامه» است", "0"),
        ("شماره پیوسته ماه چرخه", "=INT(CycleP/100)*12+MOD(CycleP,100)", "CycleIdx", "محاسبه‌ای: سال×۱۲ + ماه؛ برای ساختن ماه‌های قبل و بعد", "0"),
        ("سطح خدمت هدف", M._num(st.get("serviceLevelTarget"), 0.95), "ServiceLevel", "احتمال نداشتن کمبود؛ ضریب z ذخیره اطمینان از آن به دست می‌آید", FMT_P),
        ("ضریب z ذخیره اطمینان", "=NORMSINV(ServiceLevel)", "Zval", "محاسبه‌ای: معکوس توزیع نرمال (۹۵٪ ← ۱٫۶۴۵)", "0.000"),
        ("روش ذخیره اطمینان", st.get("ssMethod", "statistical"), "SSMethod", "statistical = آماری با خطای پیش‌بینی ؛ days = روز پوشش ثابت محصول", None),
        ("زمان تولید (روز)", M._num(st.get("productionLeadDays"), 7), "LeadDays", "در ذخیره اطمینان آماری", "0"),
        ("سقف اضافه‌کاری (درصد ظرفیت)", M._num(st.get("overtimePct"), 0.1), "OvertimePct", "ساعت اضافه‌کاری هر خط = ظرفیت عادی × این درصد", FMT_P),
        ("تورم ماهانه قیمت فروش", M._num(st.get("priceInflation"), 0.025), "PriceInfl", "قیمت ماه t = قیمت پایه × (۱+این عدد)^t", "0.00%"),
        ("تورم ماهانه هزینه", M._num(st.get("costInflation"), 0.02), "CostInfl", "بهای ماه t = بهای پایه × (۱+این عدد)^t", "0.00%"),
        ("نرخ نگهداری موجودی (ماهانه)", M._num(st.get("holdingRate"), 0.015), "HoldingRate", "هزینه نگهداری = ارزش موجودی پایان ماه × این نرخ", "0.00%"),
        ("صرف اضافه‌کاری", M._num(st.get("overtimePremium"), 0.5), "OTPremium", "هزینه اضافه‌کاری = ساعت × هزینه ساعت خط × این ضریب", FMT_P),
        ("تخفیف میانگین فروش", round(d["disc"], 6), "AvgDiscount", "میانگین تخفیف کانال‌ها (وزن = تعداد مشتری هر کانال)؛ قیمت خالص = قیمت فهرست × (۱ − تخفیف)", FMT_P),
        ("دوره وصول مطالبات (روز)", round(d["dso"], 2), "DSO", "میانگین مهلت پرداخت مشتریان (وزن = فروش ۱۲ ماه)", "0.0"),
        ("دوره پرداخت به تأمین‌کننده (روز)", M._num(st.get("dpoDays"), 45), "DPO", "", "0"),
        ("سقف ماه پوشش (مازاد)", M._num(st.get("excessMonths"), 3), "ExcessMonths", "پوشش بیشتر = موجودی مازاد", "0.0"),
        ("مرز کلاس A (سهم تجمعی فروش)", M._num(st.get("abcA"), 0.8), "AbcA", "", FMT_P),
        ("مرز کلاس B", M._num(st.get("abcB"), 0.95), "AbcB", "", FMT_P),
        ("مرز X (ضریب تغییرات)", M._num(st.get("xyzX"), 0.2), "XyzX", "", "0.00"),
        ("مرز Y", M._num(st.get("xyzY"), 0.5), "XyzY", "", "0.00"),
        ("هدف دقت پیش‌بینی", M._num(st.get("forecastAccuracyTarget"), 0.8), "AccTarget", "", FMT_P),
        ("آستانه هشدار بهره‌برداری خط", M._num(st.get("utilizationWarn"), 0.85), "UtilWarn", "", FMT_P),
        ("سقف بهره‌برداری خط", M._num(st.get("utilizationMax"), 1), "UtilMax", "", FMT_P),
        ("سناریو: تغییر قیمت فروش", 0, "PriceChg", "What-if؛ مثلاً 5% یعنی همه قیمت‌ها ۵٪ بیشتر", FMT_P),
        ("سناریو: تغییر بهای مواد", 0, "MatChg", "What-if روی همه مواد", FMT_P),
        ("سناریو: تغییر نرخ ارز", 0, "FxChg", "What-if فقط روی مواد وارداتی", FMT_P),
        ("سناریو: تغییر هزینه تبدیل", 0, "ConvChg", "What-if روی هزینه خط و اضافه‌کاری", FMT_P),
        ("مقیاس نمایش مبالغ", M._num(st.get("displayScale"), 1e9), "DisplayScale", "مبالغ داشبورد بر این عدد تقسیم می‌شوند (میلیارد ریال)", "#,##0"),
    ]
    for i, (lab, val, nm, desc, fmt) in enumerate(S):
        r = 5 + i
        formula = isinstance(val, str) and val.startswith("=")
        put(ws, r, 1, lab, bold=True)
        put(ws, r, 2, val, fmt, inp=not formula)
        put(ws, r, 3, nm)
        put(ws, r, 4, desc)
        B.name(nm, f"{q(S_SET)}$B${r}")
    ws.cell(row=5 + len(S) + 1, column=1, value="منبع مقادیر نمونه: تنظیمات و داده شرکت در برنامه IBP (داده نمونه). مقادیر واقعی را جایگزین کنید.").font = F_NOTE
    dv = DataValidation(type="list", formula1='"statistical,days"', allow_blank=False)
    ws.add_data_validation(dv)
    dv.add(f"B{5 + [s[2] for s in S].index('SSMethod')}")

    # ============================================================ ورودی_تقویم_مناسبت
    ws = B.sheet(S_CAL, "تقویم ماه‌ها و شدت مناسبت‌ها",
                 "ماه‌ها خودکار از «ماه چرخه» ساخته می‌شوند (۲۴ ماه گذشته + ۱۲ ماه برنامه). ستون‌های زرد: شدت رمضان و محرم = روزهای مناسبت در آن ماه ÷ روزهای ماه (از تقویم قمری)، کمپین = ۱ در ماه‌های کمپین.", "FFC000")
    head(ws, 4, 1, ["شماره", "شماره پیوسته ماه", "دوره (yyyymm)", "نام ماه", "ماه سال (۱ تا ۱۲)", "نوع", "شدت رمضان", "شدت محرم", "شدت کمپین"],
         [8, 14, 13, 16, 12, 10, 12, 12, 12])
    names = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"]
    head(ws, 4, 12, ["ماه", "نام"], [6, 12])
    for i, n in enumerate(names):
        put(ws, 5 + i, 12, i + 1)
        put(ws, 5 + i, 13, n)
    for k in range(1, H + T + 1):
        r = 4 + k
        per = (d["hist"] + d["fut"])[k - 1]
        put(ws, r, 1, k)
        put(ws, r, 2, f"=CycleIdx-{H + 1}+A{r}", "0")
        put(ws, r, 3, f"=INT((B{r}-1)/12)*100+MOD(B{r}-1,12)+1", "0")
        put(ws, r, 5, f"=MOD(B{r}-1,12)+1", "0")
        put(ws, r, 4, f'=INDEX($M$5:$M$16,E{r})&" "&INT((B{r}-1)/12)')
        put(ws, r, 6, f'=IF(A{r}<={H},"گذشته","برنامه")')
        cr = d["cal"].get(per, {})
        put(ws, r, 7, round(M._num(cr.get("RamadanIntensity")), 6), "0.00", inp=True)
        put(ws, r, 8, round(M._num(cr.get("MuharramIntensity")), 6), "0.00", inp=True)
        put(ws, r, 9, d["camp"].get(per, 0), "0.00", inp=True)
    ws.freeze_panes = "A5"

    # ============================================================ ورودی_خانواده
    ws = B.sheet(S_FAM, "خانواده محصول و اثر مناسبت‌ها",
                 "اثر هر مناسبت بر فروش هر خانواده به‌صورت درصد (مثلاً 0.30 = ۳۰٪ افزایش فروش در ماهی که کل آن رمضان باشد). ضریب مناسبت ماه = (۱+اثر رمضان×شدت رمضان)×(۱+اثر محرم×شدت محرم)×(۱+اثر کمپین×شدت کمپین).", "FFC000")
    head(ws, 4, 1, ["کد خانواده", "نام خانواده", "اثر رمضان", "اثر محرم", "اثر کمپین"], [14, 30, 12, 12, 12])
    fams = list(d["fam"].values())
    for i in range(NFAM):
        r = 5 + i
        f = fams[i] if i < len(fams) else None
        put(ws, r, 1, f["code"] if f else None, inp=True)
        put(ws, r, 2, f["name"] if f else None, inp=True)
        for j, key in enumerate("RMC"):
            put(ws, r, 3 + j, d["upl"].get((f["id"], key), 0) if f else None, FMT_P, inp=True)
    fam_code = {f["id"]: f["code"] for f in fams}

    # ============================================================ ورودی_خطوط
    ws = B.sheet(S_LINE, "خطوط تولید", "ظرفیت ماهانه هر خط = شیفت × ساعت هر شیفت × روز کاری ماه × راندمان (در شیت م۶_ظرفیت محاسبه می‌شود).", "FFC000")
    head(ws, 4, 1, ["کد خط", "نام خط", "تعداد شیفت", "ساعت هر شیفت", "روز کاری ماه", "راندمان", "هزینه هر ساعت (ریال)"], [12, 30, 11, 12, 12, 10, 18])
    lines = list(d["res"].values())
    for i in range(NL):
        r = 5 + i
        x = lines[i] if i < len(lines) else None
        vals = [x["code"], x["name"], M._num(x.get("shifts"), 1), M._num(x.get("hoursPerShift"), 8),
                M._num(d["plants"].get(x.get("plantId"), {}).get("workingDays"), 25), M._num(x.get("efficiency"), 1), M._num(x.get("costPerHour"))] if x else [None] * 7
        fm = [None, None, "0", "0.0", "0", "0.00", FMT_M]
        for j, v in enumerate(vals):
            put(ws, r, 1 + j, v, fm[j], inp=True)
    line_code = {x["id"]: x["code"] for x in lines}

    # ============================================================ ورودی_محصولات
    ws = B.sheet(S_PROD, "محصولات", "هر ردیف یک محصول. ترتیب ردیف‌ها در همه شیت‌های ورودی ماهانه (فروش، تعدیل، بودجه، پیش‌بینی قبلی) همین است. «خط اصلی» و «نرخ تولید» از مسیر تولید اولویت ۱ محصول است.", "FFC000")
    cols = ["کد محصول", "نام محصول", "کد خانواده", "وزن واحد (کیلوگرم)", "قیمت فروش پایه (ریال)", "بهای تمام‌شده واحد (ریال)", "چرخه عمر",
            "ذخیره اطمینان (روز)", "اندازه بچ تولید", "ماندگاری (روز)", "خط اصلی", "نرخ تولید (واحد در ساعت)", "موجودی فعلی (واحد)"]
    head(ws, 4, 1, cols, [12, 32, 11, 11, 15, 15, 10, 11, 11, 10, 10, 13, 13])
    prods = d["prods"]
    for i in range(NP):
        r = PR(i)
        p = prods[i] if i < len(prods) else None
        rt = d["prim"].get(p["id"]) if p else None
        vals = [p["code"], p["name"], fam_code.get(p["familyId"]), M._num(p.get("unitWeightKg")), M._num(p.get("unitPrice")), M._num(p.get("unitCost")),
                p.get("lifecycle"), M._num(p.get("safetyStockDays")), M._num(p.get("batchSize")), M._num(p.get("shelfLifeDays")),
                line_code.get(rt["resourceId"]) if rt else None, M._num(rt["unitsPerHour"]) if rt else None, d["inv"].get(p["id"], 0)] if p else [None] * 13
        fm = [None, None, None, "0.00", FMT_M, FMT_M, None, "0", FMT_Q, "0", None, "0.0", FMT_Q]
        for j, v in enumerate(vals):
            put(ws, r, 1 + j, v, fm[j], inp=True)
    dvl = DataValidation(type="list", formula1='"معرفی,رشد,بلوغ,افول,توقف"', allow_blank=True)
    ws.add_data_validation(dvl)
    dvl.add(f"G{P0}:G{LAST_P}")
    ws.freeze_panes = "C5"
    pref = lambda col, i: f"{q(S_PROD)}${col}${PR(i)}"   # noqa: E731

    # ------------------------------------------------------------ جدول‌های ماهانه ورودی (محصول × ماه)
    def wide_input(name: str, title: str, note: str, blocks: list) -> None:
        """blocks: [(کلید، عنوان، شماره ماه اول در تقویم، تعداد ماه، تابع مقدار نمونه(i,k)، قالب)]"""
        ws = B.sheet(name, title, note, "FFC000")
        row = 4
        for key, btitle, k0, n, fn, fmt in blocks:
            block_title(ws, row, btitle, "", n)
            hr = row + 2
            head(ws, hr, 1, ["کد محصول", "نام محصول"] + [None] * n, [12, 30] + [11] * n)
            for j in range(n):
                ws.cell(row=hr, column=3 + j, value=cal_label(k0 + j))
            for i in range(NP):
                r = hr + 1 + i
                put(ws, r, 1, f'=IF({pref("A", i)}="","",{pref("A", i)})')
                put(ws, r, 2, f'=IF({pref("A", i)}="","",{pref("B", i)})')
                for j in range(n):
                    v = fn(i, k0 + j) if i < len(prods) else None
                    put(ws, r, 3 + j, v, fmt, inp=True)
            B.blocks[(name, key)] = (hr + 1, 3)
            row = hr + NP + 3
        ws.freeze_panes = "C7"

    per_of = lambda k: (d["hist"] + d["fut"])[k - 1]  # noqa: E731
    wide_input(S_SQ, "فروش واقعی ماهانه (مقدار)", "تعداد فروش هر محصول در ۲۴ ماه گذشته. ماه بدون فروش را خالی بگذارید یا صفر بزنید.",
               [("q", "فروش (واحد)", 1, H, lambda i, k: d["sq"].get((prods[i]["id"], per_of(k))) or None, FMT_Q)])
    wide_input(S_SR, "فروش واقعی ماهانه (مبلغ)", "مبلغ فروش خالص (ریال) هر محصول در ۲۴ ماه گذشته.",
               [("r", "فروش (ریال)", 1, H, lambda i, k: d["sr"].get((prods[i]["id"], per_of(k))) or None, FMT_M)])
    adj_ex = {}
    if len(prods) > 1:
        adj_ex[(0, H + 1)] = 0.05
        adj_ex[(0, H + 2)] = 0.05
    wide_input(S_ADJ, "تعدیل اجماع (نظر فروش و بازاریابی)",
               "جلسه تقاضا پیش‌بینی آماری را اصلاح می‌کند: یا درصد تعدیل (بلوک اول) یا عدد نهایی (بلوک دوم). اگر عدد نهایی وارد شود، همان ملاک است. نمونه: ۵٪ افزایش برای محصول اول در دو ماه اول.",
               [("pct", "درصد تعدیل روی پیش‌بینی آماری", H + 1, T, lambda i, k: adj_ex.get((i, k)), FMT_P),
                ("ov", "عدد نهایی اجماع (اختیاری؛ جایگزین آماری)", H + 1, T, lambda i, k: None, FMT_Q)])
    wide_input(S_BUD, "بودجه ماهانه", "بودجه مصوب سال برای ماه‌های برنامه؛ ماه بدون بودجه را خالی بگذارید.",
               [("q", "بودجه مقدار (واحد)", H + 1, T, lambda i, k: M._num(d["bud"][(prods[i]["id"], per_of(k))]["qty"]) if (prods[i]["id"], per_of(k)) in d["bud"] else None, FMT_Q),
                ("r", "بودجه مبلغ (ریال)", H + 1, T, lambda i, k: M._num(d["bud"][(prods[i]["id"], per_of(k))]["revenue"]) if (prods[i]["id"], per_of(k)) in d["bud"] else None, FMT_M)])
    wide_input(S_PF, "پیش‌بینی اجماعی ثبت‌شده در ماه قبل (برای سنجش دقت)",
               "برای هر یک از ۶ ماه گذشته، عددی که در چرخه ماه قبل از آن برای همان ماه پیش‌بینی شده بود (پیش‌بینی یک ماه جلوتر).",
               [("f", "پیش‌بینی یک ماه جلوتر (واحد)", H - NACC + 1, NACC, lambda i, k: d["prevfc"].get((prods[i]["id"], per_of(k))), FMT_Q)])

    # ============================================================ ورودی_مواد و BOM
    ws = B.sheet(S_MAT, "مواد اولیه و بسته‌بندی", "«شرکت تأمین‌کننده درون‌گروهی» برای موادی که از شرکت دیگر هلدینگ خریده می‌شوند. «وارداتی» = 1 اگر تأمین‌کننده خارجی است (اثر نرخ ارز).", "FFC000")
    mcols = ["کد ماده", "نام ماده", "واحد", "بهای واحد (ریال)", "زمان تأمین (روز)", "حداقل سفارش (MOQ)", "ذخیره اطمینان (روز)", "موجودی فعلی", "سفارش در راه", "وارداتی (0/1)", "شرکت تأمین‌کننده درون‌گروهی"]
    head(ws, 4, 1, mcols, [11, 28, 10, 14, 12, 13, 13, 13, 13, 11, 16])
    mats = d["mats"]
    for i in range(NMAT):
        r = 5 + i
        m = mats[i] if i < len(mats) else None
        vals = [m["code"], m["name"], m.get("uom"), M._num(m.get("unitCost")), M._num(m.get("leadTimeDays")), M._num(m.get("moq")), M._num(m.get("safetyStockDays")),
                d["minv"].get(m["id"], 0), d["mord"].get(m["id"], 0), 1 if M._true(d["sup"].get(m.get("supplierId"), {}).get("isImport"), False) else 0,
                (m.get("internalCompany") if isinstance(m.get("internalCompany"), str) else None)] if m else [None] * 11
        fm = [None, None, None, FMT_M, "0", FMT_Q, "0", FMT_Q, FMT_Q, "0", None]
        for j, v in enumerate(vals):
            put(ws, r, 1 + j, v, fm[j], inp=True)
    ws.freeze_panes = "C5"

    ws = B.sheet(S_BOM, "فهرست مواد (BOM)", "برای هر محصول: چه ماده‌ای و چه مقدار برای یک واحد محصول لازم است. ضایعات به‌صورت درصد (0.02 = ۲٪).", "FFC000")
    head(ws, 4, 1, ["کد محصول", "کد ماده", "مقدار برای یک واحد", "ضایعات"], [12, 12, 16, 10])
    bom = [b for b in co.rows("bom") if b["productId"] in d["pid_code"] and b["materialId"] in d["mid_code"]]
    for i in range(NBOM):
        r = 5 + i
        b = bom[i] if i < len(bom) else None
        vals = [d["pid_code"][b["productId"]], d["mid_code"][b["materialId"]], M._num(b["qtyPer"]), M._num(b.get("scrap"))] if b else [None] * 4
        for j, (v, fm) in enumerate(zip(vals, [None, None, "0.0000", FMT_P])):
            put(ws, r, 1 + j, v, fm, inp=True)
    ws.freeze_panes = "A5"

    # ------------------------------------------------------------ ابزار بلوک‌های محاسباتی
    sq_cell = lambda i, k: f"{q(S_SQ)}{CL(2 + k)}{B.blocks[(S_SQ, 'q')][0] + i}"   # noqa: E731  فروش مقدار ماه k
    sr_cell = lambda i, k: f"{q(S_SR)}{CL(2 + k)}{B.blocks[(S_SR, 'r')][0] + i}"   # noqa: E731
    sq_row = lambda i, k1, k2: f"{q(S_SQ)}{CL(2 + k1)}{B.blocks[(S_SQ, 'q')][0] + i}:{CL(2 + k2)}{B.blocks[(S_SQ, 'q')][0] + i}"  # noqa: E731
    sr_row = lambda i, k1, k2: f"{q(S_SR)}{CL(2 + k1)}{B.blocks[(S_SR, 'r')][0] + i}:{CL(2 + k2)}{B.blocks[(S_SR, 'r')][0] + i}"  # noqa: E731

    def in_cell(sheet: str, key: str, i: int, j: int) -> str:
        r0, c0 = B.blocks[(sheet, key)]
        return f"{q(sheet)}{CL(c0 + j - 1)}{r0 + i}"

    def calc_block(ws, sheet: str, key: str, row: int, title: str, formula: str, n: int, k0: int | None, fn, fmt: str,
                   labels: list | None = None) -> int:
        """بلوک محصول × ماه؛ fn(i, j, r) ← فرمول خانه (j از 1). برمی‌گرداند ردیف بعدی آزاد"""
        block_title(ws, row, title, formula, n)
        hr = row + 2
        head(ws, hr, 1, ["کد محصول", "نام محصول"] + [None] * n)
        for j in range(n):
            ws.cell(row=hr, column=3 + j, value=(labels[j] if labels else cal_label(k0 + j)))
        for i in range(NP):
            r = hr + 1 + i
            put(ws, r, 1, f'=IF({pref("A", i)}="","",{pref("A", i)})')
            put(ws, r, 2, f'=IF({pref("A", i)}="","",{pref("B", i)})')
            for j in range(1, n + 1):
                put(ws, r, 2 + j, fn(i, j, r), fmt)
        B.blocks[(sheet, key)] = (hr + 1, 3)
        return hr + NP + 3

    def bc(sheet: str, key: str, i: int, j: int, absolute_row: bool = False) -> str:
        """خانه بلوک (محصول i، ستون j از 1)"""
        r0, c0 = B.blocks[(sheet, key)]
        return f"{q(sheet)}{CL(c0 + j - 1)}{r0 + i}"

    def bcol(sheet: str, key: str, j: int) -> str:
        """ستون j یک بلوک (همه محصولات)"""
        r0, c0 = B.blocks[(sheet, key)]
        return f"{q(sheet)}${CL(c0 + j - 1)}${r0}:${CL(c0 + j - 1)}${r0 + NP - 1}"

    def brow(sheet: str, key: str, i: int, j1: int, j2: int) -> str:
        r0, c0 = B.blocks[(sheet, key)]
        return f"{q(sheet)}{CL(c0 + j1 - 1)}{r0 + i}:{CL(c0 + j2 - 1)}{r0 + i}"

    def ball(sheet: str, key: str, n: int) -> str:
        r0, c0 = B.blocks[(sheet, key)]
        return f"{q(sheet)}${CL(c0)}${r0}:${CL(c0 + n - 1)}${r0 + NP - 1}"

    def info_table(ws, cols: list, widths: list, fn, fmts: list, row: int = 4) -> None:
        """جدول اطلاعات محصول (ردیف 5 تا 64)؛ fn(i, r) ← فهرست فرمول ستون‌ها"""
        head(ws, row, 1, cols, widths)
        for i in range(NP):
            r = row + 1 + i
            for j, v in enumerate(fn(i, r)):
                put(ws, r, 1 + j, v, fmts[j] if j < len(fmts) else None)

    G_ = lambda i: f'IF({pref("A", i)}="","",'  # noqa: E731   نگهبان ردیف خالی

    # ============================================================ ۱_پورتفوی
    ws = B.sheet(C1, "مرحله ۱ — پورتفوی محصول (ABC، XYZ، الگوی تقاضا، توصیه)",
                 "بر اساس فروش ۱۲ ماه اخیر هر محصول. ABC: سهم تجمعی فروش محصولات پرفروش‌تر از این محصول (بدون خودش) کمتر از مرز A ← A، کمتر از مرز B ← B، وگرنه C. "
                 "XYZ: ضریب تغییرات فروش ماهانه (ماه بی‌فروش = صفر). الگوی تقاضا: ADI = ۱۲ ÷ تعداد ماه‌های دارای فروش و CV² روی ماه‌های دارای فروش.", "4472C4")
    TOT = LAST_P + 2
    DEF = TOT + 4
    pcols = ["کد", "نام", "خانواده", "چرخه عمر", "فروش ریالی ۱۲ ماه", "بهای فروش ۱۲ ماه", "حاشیه سود", "مقدار ۱۲ ماه", "مقدار ۱۲ ماه قبل", "رشد حجم",
             "سهم فروش", "سهم تجمعی قبل از محصول", "ABC", "میانگین ماهانه", "انحراف معیار", "ضریب تغییرات (CV)", "XYZ", "ماه‌های دارای فروش",
             "ADI", "CV²", "الگوی تقاضا", "توصیه", "شماره کلاس", "اولویت ظرفیت"]
    pw = [10, 28, 9, 9, 16, 16, 9, 12, 12, 9, 9, 11, 6, 11, 11, 9, 6, 9, 7, 7, 10, 22, 7, 8]
    pf = [None, None, None, None, FMT_M, FMT_M, FMT_P, FMT_Q, FMT_Q, FMT_P, FMT_P, FMT_P, None, FMT_Q, FMT_Q, "0.00", None, "0", "0.00", "0.00", None, None, "0", "0"]

    def pf_row(i, r):
        g = G_(i)
        qr = sq_row(i, 13, 24)
        return [f'=IF({pref("A", i)}="","",{pref("A", i)})', f'={g}{pref("B", i)})', f'={g}{pref("C", i)})', f'={g}{pref("G", i)})',
                f"={g}SUM({sr_row(i, 13, 24)}))",
                f"={g}{pref('F', i)}*SUMPRODUCT({qr},$E${DEF}:$P${DEF}))",
                f'={g}IF(E{r}>0,1-F{r}/E{r},""))',
                f"={g}SUM({qr}))", f"={g}SUM({sq_row(i, 1, 12)}))",
                f'={g}IF(I{r}>0,H{r}/I{r}-1,""))',
                f"={g}IF($E${TOT}>0,E{r}/$E${TOT},0))",
                f'={g}IF($E${TOT}>0,SUMIF($E${P0}:$E${LAST_P},">"&E{r})/$E${TOT},0))',
                f'={g}IF(E{r}<=0,"C",IF(L{r}<AbcA,"A",IF(L{r}<AbcB,"B","C"))))',
                f"={g}SUM({qr})/12)",
                f"={g}SQRT(SUMPRODUCT(({qr}-N{r})^2)/12))",
                f'={g}IF(N{r}>0,O{r}/N{r},""))',
                f'={g}IF(P{r}="","Z",IF(P{r}<=XyzX,"X",IF(P{r}<=XyzY,"Y","Z"))))',
                f'={g}COUNTIF({qr},">0"))',
                f'={g}IF(R{r}>0,12/R{r},""))',
                f'={g}IF(R{r}>0,(SQRT(SUMPRODUCT(({qr}>0)*({qr}-SUMIF({qr},">0")/R{r})^2)/R{r})/(SUMIF({qr},">0")/R{r}))^2,""))',
                f'={g}IF(R{r}=0,"بدون فروش",IF(S{r}<1.32,IF(T{r}<0.49,"هموار","نامنظم"),IF(T{r}<0.49,"متناوب","کلوخه‌ای"))))',
                f'={g}IF(D{r}="توقف","خروج از سبد",IF(D{r}="معرفی","پایش معرفی",'
                f'IF(AND(M{r}="C",J{r}<>"",N(J{r})<-0.1,OR(G{r}="",N(G{r})<$E${TOT + 1})),"کاندید حذف",'
                f'IF(AND(M{r}<>"C",J{r}<>"",N(J{r})>0.1,G{r}<>"",N(G{r})>=$E${TOT + 1}*0.9),"سرمایه‌گذاری و رشد",'
                f'IF(AND(M{r}<>"C",G{r}<>"",N(G{r})<$E${TOT + 1}*0.75),"بازبینی قیمت/هزینه",'
                f'IF(OR(U{r}="کلوخه‌ای",U{r}="نامنظم",Q{r}="Z"),"افزایش ذخیره یا تولید سفارشی","نگهداری")))))))',
                f'={g}IF(M{r}="A",1,IF(M{r}="B",2,3)))',
                f'={g}COUNTIF($W${P0}:$W${LAST_P},"<"&W{r})+COUNTIFS($W${P0}:$W${LAST_P},W{r},$Y${P0}:$Y${LAST_P},">"&Y{r})'
                f'+COUNTIFS($W${P0}:$W${LAST_P},W{r},$Y${P0}:$Y${LAST_P},Y{r},$Z${P0}:$Z${LAST_P},"<"&Z{r})+1)']
    info_table(ws, pcols, pw, pf_row, pf)
    head(ws, 4, 25, ["قیمت (کمکی)", "ردیف (کمکی)"], [12, 8])
    for i in range(NP):
        r = P0 + i
        put(ws, r, 25, f'={G_(i)}N({pref("E", i)}))', FMT_M)
        put(ws, r, 26, f'={G_(i)}{i + 1})', "0")
    put(ws, TOT, 4, "جمع", bold=True)
    for c in "EFHI":
        put(ws, TOT, ord(c) - 64, f"=SUM({c}{P0}:{c}{LAST_P})", FMT_M, bold=True)
    put(ws, TOT + 1, 4, "حاشیه میانگین شرکت", bold=True)
    put(ws, TOT + 1, 5, f"=IF(E{TOT}>0,1-F{TOT}/E{TOT},0)", FMT_P, bold=True)
    put(ws, TOT + 2, 4, "سهم ۲۰٪ محصولات برتر", bold=True)
    put(ws, TOT + 2, 5, f'=IF(E{TOT}>0,SUMIF(E{P0}:E{LAST_P},">="&LARGE(E{P0}:E{LAST_P},MAX(1,ROUND(0.2*COUNTIF(A{P0}:A{LAST_P},"?*"),0))))/E{TOT},0)', FMT_P, bold=True)
    put(ws, DEF - 1, 4, "ضریب برگشت بهای واحد به ماه فروش (کمکی: (۱+تورم قیمت)^(فاصله ماه از چرخه))", bold=True)
    for j in range(12):
        put(ws, DEF - 1, 5 + j, cal_label(13 + j))
        put(ws, DEF, 5 + j, f"=(1+PriceInfl)^({13 + j}-{H + 1})", "0.0000")
    put(ws, DEF + 2, 4, "تعداد A / B / C", bold=True)
    for j, cl in enumerate("ABC"):
        put(ws, DEF + 2, 5 + j, f'=COUNTIF(M{P0}:M{LAST_P},"{cl}")', "0", bold=True)
    ws.freeze_panes = "C5"
    PF_TOT = TOT

    # ============================================================ ۲_پیش_بینی_آماری
    ws = B.sheet(C2, "مرحله ۲ — پیش‌بینی آماری (۵ روش ساده + انتخاب بهترین با آزمون روی گذشته)",
                 "۱) اثر مناسبت‌ها از فروش گذشته حذف می‌شود. ۲) شاخص فصلی هر ماه سال ساخته می‌شود. ۳) هر روش برای ۱۲ ماه اخیر، ماه‌به‌ماه «یک ماه جلوتر» پیش‌بینی می‌کند و با فروش واقعی مقایسه می‌شود. "
                 "۴) روشی که کمترین خطای WMAPE = Σ|پیش‌بینی−واقعی| ÷ Σواقعی را دارد انتخاب و ۱۲ ماه آینده با آن پیش‌بینی می‌شود؛ سپس اثر مناسبت‌های آینده ضرب می‌شود.", "4472C4")
    fcols = ["کد", "نام", "خانواده", "ردیف خانواده", "میانگین فروش پاک‌شده", "WMAPE ساده", "WMAPE میانگین ۳ ماه", "WMAPE فصلی ساده", "WMAPE ۳ ماه×فصلی",
             "WMAPE روند×فصلی", "شماره روش منتخب", "روش منتخب", "سوگیری روش منتخب", "خطای نسبی (RMSE)", "خطای نسبی برای ذخیره اطمینان",
             "سوگیری ۱", "سوگیری ۲", "سوگیری ۳", "سوگیری ۴", "سوگیری ۵", "RMSE ۱", "RMSE ۲", "RMSE ۳", "RMSE ۴", "RMSE ۵", "فروش ۱۲ ماه اخیر"]
    fw = [10, 26, 9, 8, 12, 10, 10, 10, 10, 10, 8, 22, 10, 10, 11] + [9] * 10 + [12]
    ff = [None, None, None, "0", FMT_D, FMT_P, FMT_P, FMT_P, FMT_P, FMT_P, "0", None, FMT_P, FMT_P, FMT_P] + [FMT_P] * 10 + [FMT_Q]
    METHODS = ["ساده (فروش ماه قبل)", "میانگین متحرک ۳ ماه", "فصلی ساده (همان ماه سال قبل)", "میانگین ۳ ماه × شاخص فصلی", "روند خطی ۱۲ ماه × شاخص فصلی"]
    row = LAST_P + 3
    # ردیف کمکی ماه سال برای ۲۴ ماه گذشته (برای شاخص فصلی)
    MROW = row
    put(ws, MROW, 2, "ماه سال (کمکی)", bold=True)
    for k in range(1, H + 1):
        put(ws, MROW, 2 + k, f"={q(S_CAL)}$E${4 + k}", "0")
    XROW = MROW + 1
    put(ws, XROW, 2, "شماره ماه برای روند (کمکی)", bold=True)
    for k in range(1, 13):
        put(ws, XROW, 2 + k, k, "0")
    XR = f"$C${XROW}:$N${XROW}"
    row = MROW + 3

    def famf(i, k, r):
        """ضریب مناسبت ماه k برای محصول ردیف i"""
        fr = f"$D${P0 + i}"
        return (f'={G_(i)}IF({fr}=0,1,IFERROR(MAX(0,1+INDEX({rng(S_FAM, "C", 5, "C", 4 + NFAM)},{fr})*{q(S_CAL)}$G${4 + k})'
                f'*MAX(0,1+INDEX({rng(S_FAM, "D", 5, "D", 4 + NFAM)},{fr})*{q(S_CAL)}$H${4 + k})'
                f'*MAX(0,1+INDEX({rng(S_FAM, "E", 5, "E", 4 + NFAM)},{fr})*{q(S_CAL)}$I${4 + k}),1)))')

    row = calc_block(ws, C2, "fh", row, "ب۱) ضریب مناسبت ماه‌های گذشته",
                     "= (۱ + اثر رمضان خانواده × شدت رمضان ماه) × (۱ + اثر محرم × شدت محرم) × (۱ + اثر کمپین × شدت کمپین)", H, 1,
                     lambda i, j, r: famf(i, j, r), "0.000")
    row = calc_block(ws, C2, "cl", row, "ب۲) فروش پاک‌شده از اثر مناسبت",
                     "= فروش واقعی ÷ ضریب مناسبت همان ماه", H, 1,
                     lambda i, j, r: f'={G_(i)}IF({bc(C2, "fh", i, j)}>0,N({sq_cell(i, j)})/{bc(C2, "fh", i, j)},N({sq_cell(i, j)})))', FMT_D)
    row = calc_block(ws, C2, "si", row, "ب۳) شاخص فصلی هر ماه سال",
                     "= میانگین فروش پاک‌شده در آن ماه سال (دو سال) ÷ میانگین کل ۲۴ ماه؛ اگر میانگین صفر باشد = ۱", 12, None,
                     lambda i, j, r: f'={G_(i)}IF($E${P0 + i}>0,AVERAGEIF(${CL(3)}${MROW}:${CL(2 + H)}${MROW},{j},{brow(C2, "cl", i, 1, H)})/$E${P0 + i},1))',
                     "0.000", labels=names)
    si_of = lambda i, k: f'INDEX({brow(C2, "si", i, 1, 12)},{q(S_CAL)}$E${4 + k})'  # noqa: E731
    row = calc_block(ws, C2, "ds", row, "ب۴) فروش فصل‌زدایی‌شده",
                     "= فروش پاک‌شده ÷ شاخص فصلی همان ماه سال", H, 1,
                     lambda i, j, r: f'={G_(i)}IF({si_of(i, j)}>0,{bc(C2, "cl", i, j)}/{si_of(i, j)},{bc(C2, "cl", i, j)}))', FMT_D)
    BT0 = 13
    bt_rules = [
        ("bt1", "ب۵) آزمون روش ۱ — ساده", "پیش‌بینی ماه k = فروش پاک‌شده ماه k−1 × ضریب مناسبت ماه k",
         lambda i, k: f'{bc(C2, "cl", i, k - 1)}*{bc(C2, "fh", i, k)}'),
        ("bt2", "ب۶) آزمون روش ۲ — میانگین متحرک ۳ ماه", "پیش‌بینی ماه k = میانگین فروش پاک‌شده ماه‌های k−3 تا k−1 × ضریب مناسبت ماه k",
         lambda i, k: f'AVERAGE({brow(C2, "cl", i, k - 3, k - 1)})*{bc(C2, "fh", i, k)}'),
        ("bt3", "ب۷) آزمون روش ۳ — فصلی ساده", "پیش‌بینی ماه k = فروش پاک‌شده همان ماه در سال قبل (k−12) × ضریب مناسبت ماه k",
         lambda i, k: f'{bc(C2, "cl", i, k - 12)}*{bc(C2, "fh", i, k)}'),
        ("bt4", "ب۸) آزمون روش ۴ — میانگین ۳ ماه × شاخص فصلی", "پیش‌بینی ماه k = میانگین فروش فصل‌زدایی‌شده k−3 تا k−1 × شاخص فصلی ماه k × ضریب مناسبت ماه k",
         lambda i, k: f'AVERAGE({brow(C2, "ds", i, k - 3, k - 1)})*{si_of(i, k)}*{bc(C2, "fh", i, k)}'),
        ("bt5", "ب۸-۲) آزمون روش ۵ — روند خطی × شاخص فصلی",
         "پیش‌بینی ماه k = خط روند (کمترین مربعات) روی فروش فصل‌زدایی‌شده ۱۲ ماه k−12 تا k−1، امتداد یک ماه (تابع FORECAST) × شاخص فصلی ماه k × ضریب مناسبت ماه k، حداقل صفر",
         lambda i, k: f'MAX(0,FORECAST(13,{brow(C2, "ds", i, k - 12, k - 1)},{XR}))*{si_of(i, k)}*{bc(C2, "fh", i, k)}'),
    ]
    for key, ttl, fx, fn in bt_rules:
        row = calc_block(ws, C2, key, row, ttl, fx + "  (۱۲ ماه اخیر؛ با فروش واقعی مقایسه می‌شود)", 12, BT0,
                         (lambda fn_: lambda i, j, r: f"={G_(i)}{fn_(i, BT0 + j - 1)})")(fn), FMT_D)
    row = calc_block(ws, C2, "ff", row, "ب۹) ضریب مناسبت ماه‌های آینده", "همان فرمول ب۱ برای ۱۲ ماه برنامه", T, H + 1,
                     lambda i, j, r: famf(i, H + j, r), "0.000")
    stat_fx = lambda i, j: (f'CHOOSE($K${P0 + i},{bc(C2, "cl", i, H)}*{bc(C2, "ff", i, j)},'   # noqa: E731
                            f'AVERAGE({brow(C2, "cl", i, H - 2, H)})*{bc(C2, "ff", i, j)},'
                            f'{bc(C2, "cl", i, 12 + j)}*{bc(C2, "ff", i, j)},'
                            f'AVERAGE({brow(C2, "ds", i, H - 2, H)})*{si_of(i, H + j)}*{bc(C2, "ff", i, j)},'
                            f'MAX(0,FORECAST({12 + j},{brow(C2, "ds", i, H - 11, H)},{XR}))*{si_of(i, H + j)}*{bc(C2, "ff", i, j)})')
    row = calc_block(ws, C2, "st", row, "ب۱۰) پیش‌بینی آماری ۱۲ ماه آینده (خروجی این مرحله)",
                     "= با روش منتخب: ۱ ساده = آخرین فروش پاک‌شده ؛ ۲ = میانگین ۳ ماه آخر ؛ ۳ = همان ماه سال قبل ؛ ۴ = میانگین ۳ ماه فصل‌زدایی‌شده × شاخص فصلی ماه ؛ ۵ = امتداد خط روند ۱۲ ماه آخر × شاخص فصلی ؛ همه × ضریب مناسبت ماه؛ گرد به عدد صحیح",
                     T, H + 1, lambda i, j, r: f"={G_(i)}ROUND(MAX(0,{stat_fx(i, j)}),0))", FMT_Q)
    row = calc_block(ws, C2, "lo", row, "ب۱۱) کران پایین بازه ۸۰٪", "= پیش‌بینی × (۱ − ۱٫۲۸۱۶ × خطای نسبی روش منتخب)، حداقل صفر", T, H + 1,
                     lambda i, j, r: f'={G_(i)}MAX(0,ROUND({bc(C2, "st", i, j)}*(1-1.2816*$O${P0 + i}),0)))', FMT_Q)
    row = calc_block(ws, C2, "hi", row, "ب۱۲) کران بالای بازه ۸۰٪", "= پیش‌بینی × (۱ + ۱٫۲۸۱۶ × خطای نسبی روش منتخب)", T, H + 1,
                     lambda i, j, r: f'={G_(i)}ROUND({bc(C2, "st", i, j)}*(1+1.2816*$O${P0 + i}),0))', FMT_Q)

    def fc_row(i, r):
        g = G_(i)
        act = sq_row(i, BT0, H)
        bt = lambda m: brow(C2, f"bt{m}", i, 1, 12)  # noqa: E731
        wm = [f'={g}IF(SUM({act})>0,SUMPRODUCT(ABS({bt(m)}-{act}))/SUM({act}),""))' for m in range(1, 6)]
        bi = [f'={g}IF(SUM({act})>0,SUMPRODUCT({bt(m)}-{act})/SUM({act}),""))' for m in range(1, 6)]
        rm = [f'={g}IF(SUM({act})>0,SQRT(SUMPRODUCT(({bt(m)}-{act})^2)/12)/(SUM({act})/12),""))' for m in range(1, 6)]
        return ([f'=IF({pref("A", i)}="","",{pref("A", i)})', f'={g}{pref("B", i)})', f'={g}{pref("C", i)})',
                 f'={g}IFERROR(MATCH(C{r},{rng(S_FAM, "A", 5, "A", 4 + NFAM)},0),0))',
                 f'={g}AVERAGE({brow(C2, "cl", i, 1, H)}))']
                + wm
                + [f'={g}IF(Z{r}>0,MATCH(MIN(F{r}:J{r}),F{r}:J{r},0),2))',
                   f'={g}CHOOSE(K{r},"{METHODS[0]}","{METHODS[1]}","{METHODS[2]}","{METHODS[3]}","{METHODS[4]}"))',
                   f'={g}IF(Z{r}>0,INDEX(P{r}:T{r},K{r}),""))',
                   f'={g}IF(Z{r}>0,INDEX(U{r}:Y{r},K{r}),""))',
                   f'={g}IF(N{r}="",0.3,MIN(1.2,MAX(0.03,N{r}))))']
                + bi + rm + [f"={g}SUM({act}))"])
    info_table(ws, fcols, fw, fc_row, ff)
    ws.freeze_panes = "C5"

    # ============================================================ ۳_برنامه_تقاضا
    ws = B.sheet(C3, "مرحله ۳ — برنامه تقاضا و اجماع",
                 "اجماعی = اگر «عدد نهایی» در شیت تعدیل وارد شده همان، وگرنه پیش‌بینی آماری × (۱ + درصد تعدیل). تن = مقدار × وزن واحد ÷ ۱۰۰۰. "
                 "مبلغ = مقدار × قیمت پایه × (۱+تورم قیمت)^(شماره ماه−۱) × (۱ − تخفیف میانگین). مقایسه با بودجه فقط در ماه‌هایی که بودجه دارند.", "4472C4")
    dcols = ["کد", "نام", "وزن (کیلوگرم)", "قیمت پایه", "آماری ۱۲ ماه", "اجماعی ۱۲ ماه", "سال قبل همان ماه‌ها", "بودجه ۱۲ ماه", "اجماعی ۱۲ ماه (تن)",
             "اجماعی نسبت به سال قبل", "اجماعی نسبت به بودجه", "اجماعی ۶ ماه", "کران پایین آماری ۶ ماه", "کران بالای آماری ۶ ماه", "ریسک برنامه"]
    dwid = [10, 26, 9, 13, 12, 12, 12, 12, 11, 11, 11, 11, 11, 11, 20]
    dfm = [None, None, "0.00", FMT_M, FMT_Q, FMT_Q, FMT_Q, FMT_Q, "#,##0.0", FMT_P, FMT_P, FMT_Q, FMT_Q, FMT_Q, None]
    row = LAST_P + 3
    row = calc_block(ws, C3, "st", row, "پ۱) پیش‌بینی آماری (از مرحله ۲)", "", T, H + 1, lambda i, j, r: f'={bc(C2, "st", i, j)}', FMT_Q)
    row = calc_block(ws, C3, "cons", row, "پ۲) پیش‌بینی اجماعی (خروجی این مرحله)",
                     "= اگر عدد نهایی وارد شده: همان ؛ وگرنه ROUND(آماری × (۱ + درصد تعدیل))", T, H + 1,
                     lambda i, j, r: f'={G_(i)}IF(ISNUMBER({in_cell(S_ADJ, "ov", i, j)}),{in_cell(S_ADJ, "ov", i, j)},ROUND({bc(C3, "st", i, j)}*(1+N({in_cell(S_ADJ, "pct", i, j)})),0)))', FMT_Q)
    row = calc_block(ws, C3, "tons", row, "پ۳) اجماعی به تن", "= مقدار × وزن واحد ÷ ۱۰۰۰", T, H + 1,
                     lambda i, j, r: f'={G_(i)}{bc(C3, "cons", i, j)}*$C${P0 + i}/1000)', "#,##0.0")
    row = calc_block(ws, C3, "val", row, "پ۴) اجماعی به مبلغ (ریال)", "= مقدار × قیمت پایه × (۱+تورم قیمت)^(شماره ماه−۱) × (۱ − تخفیف میانگین)", T, H + 1,
                     lambda i, j, r: f'={G_(i)}{bc(C3, "cons", i, j)}*$D${P0 + i}*(1+PriceInfl)^{j - 1}*(1-AvgDiscount))', FMT_M)
    row = calc_block(ws, C3, "ly", row, "پ۵) فروش همان ماه در سال قبل", "= فروش واقعی ۱۲ ماه قبل", T, H + 1,
                     lambda i, j, r: f'={G_(i)}N({sq_cell(i, 12 + j)}))', FMT_Q)
    row = calc_block(ws, C3, "bud", row, "پ۶) بودجه (مقدار)", "", T, H + 1,
                     lambda i, j, r: f'={G_(i)}N({in_cell(S_BUD, "q", i, j)}))', FMT_Q)
    # جمع ماهانه تن
    put(ws, row, 2, "جمع اجماعی (تن)", bold=True)
    put(ws, row + 1, 2, "جمع سال قبل (تن)", bold=True)
    put(ws, row + 2, 2, "جمع بودجه (تن)", bold=True)
    for j in range(1, T + 1):
        put(ws, row - 1, 2 + j, cal_label(H + j), bold=True)
        put(ws, row, 2 + j, f'=SUM({bcol(C3, "tons", j)})', "#,##0.0", bold=True)
        put(ws, row + 1, 2 + j, f'=SUMPRODUCT({bcol(C3, "ly", j)},$C${P0}:$C${LAST_P})/1000', "#,##0.0", bold=True)
        put(ws, row + 2, 2 + j, f'=SUMPRODUCT({bcol(C3, "bud", j)},$C${P0}:$C${LAST_P})/1000', "#,##0.0", bold=True)
    TONS_ROW = row

    def dm_row(i, r):
        g = G_(i)
        c = lambda k: brow(C3, k, i, 1, T)  # noqa: E731
        return [f'=IF({pref("A", i)}="","",{pref("A", i)})', f'={g}{pref("B", i)})', f'={g}N({pref("D", i)}))', f'={g}N({pref("E", i)}))',
                f"={g}SUM({c('st')}))", f"={g}SUM({c('cons')}))", f"={g}SUM({c('ly')}))", f"={g}SUM({c('bud')}))", f"={g}SUM({c('tons')}))",
                f'={g}IF(G{r}>0,F{r}/G{r}-1,""))',
                f'={g}IF(H{r}>0,SUMPRODUCT(({c("bud")}>0)*{c("cons")})/H{r}-1,""))',
                f"={g}SUM({brow(C3, 'cons', i, 1, 6)}))", f"={g}SUM({brow(C2, 'lo', i, 1, 6)}))", f"={g}SUM({brow(C2, 'hi', i, 1, 6)}))",
                f'={g}IF(N{r}=0,"",IF(L{r}>N{r},"بالاتر از بازه آماری",IF(L{r}<M{r},"پایین‌تر از بازه آماری",""))))']
    info_table(ws, dcols, dwid, dm_row, dfm)
    ws.freeze_panes = "C5"

    # ============================================================ ۴_دقت_پیش_بینی
    ws = B.sheet(C4, "مرحله ۴ — دقت پیش‌بینی، سوگیری، ارزش افزوده (FVA) و سیگنال ردیابی",
                 "دقت = ۱ − Σ|پیش‌بینی − واقعی| ÷ Σ واقعی (حداقل صفر). سوگیری = Σ(پیش‌بینی − واقعی) ÷ Σ واقعی (مثبت = بیش‌برآورد). "
                 "روش «ساده» = فروش ماه قبل؛ FVA = دقت اجماعی − دقت ساده (مثبت یعنی برنامه‌ریزی ارزش افزوده دارد). سیگنال ردیابی = Σ خطا ÷ میانگین قدرمطلق خطا؛ بیش از ۴ یا کمتر از −۴ = سوگیری مداوم.", "4472C4")
    A0 = H - NACC + 1
    acols = ["کد", "نام", "دقت ۳ ماه", "سوگیری ۳ ماه", "دقت ۶ ماه", "سیگنال ردیابی", "وضعیت"]
    row = LAST_P + 3
    row = calc_block(ws, C4, "f", row, "د۱) پیش‌بینی اجماعی یک ماه جلوتر", "از شیت ورودی پیش‌بینی قبلی", NACC, A0,
                     lambda i, j, r: f'={G_(i)}N({in_cell(S_PF, "f", i, j)}))', FMT_Q)
    row = calc_block(ws, C4, "a", row, "د۲) فروش واقعی", "", NACC, A0, lambda i, j, r: f'={G_(i)}N({sq_cell(i, A0 + j - 1)}))', FMT_Q)
    row = calc_block(ws, C4, "e", row, "د۳) خطا", "= پیش‌بینی − واقعی", NACC, A0,
                     lambda i, j, r: f'={G_(i)}{bc(C4, "f", i, j)}-{bc(C4, "a", i, j)})', FMT_Q)
    row = calc_block(ws, C4, "ae", row, "د۴) قدرمطلق خطا", "= |پیش‌بینی − واقعی|", NACC, A0,
                     lambda i, j, r: f'={G_(i)}ABS({bc(C4, "e", i, j)}))', FMT_Q)
    row = calc_block(ws, C4, "nae", row, "د۵) قدرمطلق خطای روش ساده", "= |فروش ماه قبل − فروش این ماه|", NACC, A0,
                     lambda i, j, r: f'={G_(i)}ABS(N({sq_cell(i, A0 + j - 2)})-{bc(C4, "a", i, j)}))', FMT_Q)
    labs = ["Σ پیش‌بینی", "Σ واقعی", "Σ قدرمطلق خطا", "Σ خطا", "دقت اجماعی", "سوگیری", "دقت روش ساده", "ارزش افزوده (FVA)"]
    for n_, lab in enumerate(labs):
        put(ws, row + n_, 2, lab, bold=True)
    for j in range(1, NACC + 1):
        put(ws, row - 1, 2 + j, cal_label(A0 + j - 1), bold=True)
        c = CL(2 + j)
        put(ws, row, 2 + j, f'=SUM({bcol(C4, "f", j)})', FMT_Q)
        put(ws, row + 1, 2 + j, f'=SUM({bcol(C4, "a", j)})', FMT_Q)
        put(ws, row + 2, 2 + j, f'=SUM({bcol(C4, "ae", j)})', FMT_Q)
        put(ws, row + 3, 2 + j, f'=SUM({bcol(C4, "e", j)})', FMT_Q)
        put(ws, row + 4, 2 + j, f'=IF(OR({c}{row}=0,{c}{row + 1}=0),"",MAX(0,1-{c}{row + 2}/{c}{row + 1}))', FMT_P, bold=True)
        put(ws, row + 5, 2 + j, f'=IF(OR({c}{row}=0,{c}{row + 1}=0),"",{c}{row + 3}/{c}{row + 1})', FMT_P)
        put(ws, row + 6, 2 + j, f'=IF({c}{row + 1}=0,"",MAX(0,1-SUM({bcol(C4, "nae", j)})/{c}{row + 1}))', FMT_P)
        put(ws, row + 7, 2 + j, f'=IF(OR({c}{row + 4}="",{c}{row + 6}=""),"",{c}{row + 4}-{c}{row + 6})', FMT_P)
    ACC_SUM = row
    # کل شرکت ۳ ماه
    j1, j2 = CL(2 + NACC - 2), CL(2 + NACC)
    put(ws, row + 9, 2, "دقت ۳ ماه اخیر (شرکت)", bold=True)
    put(ws, row + 9, 3, f'=IF(SUM({j1}{row + 1}:{j2}{row + 1})=0,"",MAX(0,1-SUM({j1}{row + 2}:{j2}{row + 2})/SUM({j1}{row + 1}:{j2}{row + 1})))', FMT_P, bold=True)
    put(ws, row + 10, 2, "سوگیری ۳ ماه اخیر (شرکت)", bold=True)
    put(ws, row + 10, 3, f'=IF(SUM({j1}{row + 1}:{j2}{row + 1})=0,"",SUM({j1}{row + 3}:{j2}{row + 3})/SUM({j1}{row + 1}:{j2}{row + 1}))', FMT_P, bold=True)
    put(ws, row + 11, 2, "دقت روش ساده ۳ ماه", bold=True)
    nae0 = B.blocks[(C4, "nae")][0]
    put(ws, row + 11, 3, f'=IF(SUM({j1}{row + 1}:{j2}{row + 1})=0,"",MAX(0,1-SUM({j1}{nae0}:{j2}{nae0 + NP - 1})/SUM({j1}{row + 1}:{j2}{row + 1})))', FMT_P, bold=True)
    put(ws, row + 12, 2, "ارزش افزوده پیش‌بینی ۳ ماه (FVA)", bold=True)
    put(ws, row + 12, 3, f'=IF(OR(C{row + 9}="",C{row + 11}=""),"",C{row + 9}-C{row + 11})', FMT_P, bold=True)
    ACC_CO = row + 9

    def ac_row(i, r):
        g = G_(i)
        a3, e3, ae3 = brow(C4, "a", i, NACC - 2, NACC), brow(C4, "e", i, NACC - 2, NACC), brow(C4, "ae", i, NACC - 2, NACC)
        return [f'=IF({pref("A", i)}="","",{pref("A", i)})', f'={g}{pref("B", i)})',
                f'={g}IF(SUM({a3})>0,MAX(0,1-SUM({ae3})/SUM({a3})),""))',
                f'={g}IF(SUM({a3})>0,SUM({e3})/SUM({a3}),""))',
                f'={g}IF(SUM({brow(C4, "a", i, 1, NACC)})>0,MAX(0,1-SUM({brow(C4, "ae", i, 1, NACC)})/SUM({brow(C4, "a", i, 1, NACC)})),""))',
                f'={g}IF(AVERAGE({brow(C4, "ae", i, 1, NACC)})>0,SUM({brow(C4, "e", i, 1, NACC)})/AVERAGE({brow(C4, "ae", i, 1, NACC)}),""))',
                f'={g}IF(AND(D{r}<>"",N(D{r})>0.2),"بیش‌برآورد مداوم",IF(AND(D{r}<>"",N(D{r})<-0.2),"کم‌برآورد مداوم",IF(AND(F{r}<>"",ABS(N(F{r}))>4),"سوگیری در ۶ ماه",""))))']
    info_table(ws, acols, [10, 26, 10, 10, 10, 10, 18], ac_row, [None, None, FMT_P, FMT_P, FMT_P, "0.0", None])
    ws.freeze_panes = "C5"

    # ============================================================ ۶_ظرفیت (جدول خطوط؛ بلوک‌ها پس از برنامه تولید)
    w6 = B.sheet(C6, "مرحله ۶ — ظرفیت خطوط (بار برنامه و RCCP)",
                 "ظرفیت عادی ماهانه = شیفت × ساعت شیفت × روز کاری × راندمان (پیش‌فرض‌ها: ۱ شیفت، ۸ ساعت، ۲۵ روز، راندمان ۱). ظرفیت اضافه‌کاری = ظرفیت × سقف اضافه‌کاری. "
                 "بهره‌برداری = ساعت بار برنامه ÷ ظرفیت عادی. RCCP = ساعت لازم برای کل پیش‌بینی اجماعی بدون محدودیت (اجماعی ÷ نرخ تولید) ÷ ظرفیت؛ هشدار ظرفیت از RCCP شش ماه آینده است.", "4472C4")
    L0, LAST_L = 5, 4 + NL
    lref = lambda col, i: f"{q(S_LINE)}${col}${L0 + i}"  # noqa: E731
    # ستون‌ها: A کد، B نام، C ظرفیت، D ظرفیت اضافه‌کاری، E هزینه ساعت، F میانگین بهره‌برداری، G اوج، H ماه‌های گلوگاه، I ساعت اضافه‌کاری، J اوج RCCP شش ماه، K وضعیت
    head(w6, 4, 1, ["کد خط", "نام خط", "ظرفیت عادی (ساعت/ماه)", "ظرفیت اضافه‌کاری", "هزینه هر ساعت", "میانگین بهره‌برداری", "اوج بهره‌برداری",
                    "ماه‌های گلوگاه", "ساعت اضافه‌کاری ۱۲ ماه", "اوج RCCP شش ماه", "وضعیت"], [10, 26, 13, 12, 14, 11, 11, 9, 12, 11, 14])
    for i in range(NL):
        r = L0 + i
        g = f'IF({lref("A", i)}="","",'
        put(w6, r, 1, f'=IF({lref("A", i)}="","",{lref("A", i)})')
        put(w6, r, 2, f'={g}{lref("B", i)})')
        put(w6, r, 3, f'={g}IF(N({lref("C", i)})>0,{lref("C", i)},1)*IF(N({lref("D", i)})>0,{lref("D", i)},8)*IF(N({lref("E", i)})>0,{lref("E", i)},25)*IF(N({lref("F", i)})>0,{lref("F", i)},1))', FMT_Q)
        put(w6, r, 4, f"={g}C{r}*OvertimePct)", FMT_Q)
        put(w6, r, 5, f'={g}N({lref("G", i)}))', FMT_M)
    w6.freeze_panes = "C5"

    # ============================================================ ۵_برنامه_تولید
    ws = B.sheet(C5, "مرحله ۵ — برنامه تولید (MPS)، ذخیره اطمینان و موجودی",
                 "هر ماه به ترتیب: ۱) ذخیره اطمینان ۲) نیاز = تقاضا + ذخیره اطمینان − موجودی اول ماه (گرد به بچ) ۳) ظرفیت عادی خط به ترتیب اولویت محصولات (کلاس A، B، C و در هر کلاس قیمت بالاتر) "
                 "۴) باقی‌مانده از ظرفیت اضافه‌کاری با همان اولویت ۵) موجودی پایان ماه و کمبود. موجودی پایان هر ماه، موجودی اول ماه بعد است.", "4472C4")
    mcols5 = ["کد", "نام", "ABC", "اولویت ظرفیت", "خط اصلی", "نرخ تولید (واحد/ساعت)", "ظرفیت عادی خط", "ظرفیت اضافه‌کاری خط", "بچ", "ماندگاری (ماه)",
              "خطای نسبی پیش‌بینی", "موجودی فعلی", "ذخیره اطمینان (روز)", "تقاضای ۱۲ ماه", "تولید ۱۲ ماه", "کمبود ۱۲ ماه", "نرخ پاسخ‌گویی",
              "ماه‌های زیر ذخیره اطمینان", "میانگین تقاضای ۳ ماه آینده", "ماه پوشش موجودی فعلی", "وضعیت موجودی"]
    w5 = [10, 26, 6, 8, 8, 10, 10, 10, 8, 8, 9, 11, 9, 12, 12, 11, 9, 9, 11, 9, 10]
    f5 = [None, None, None, "0", None, "0.0", FMT_Q, FMT_Q, FMT_Q, "0.0", FMT_P, FMT_Q, "0", FMT_Q, FMT_Q, FMT_Q, "0.0%", "0", FMT_Q, "0.0", None]
    row = LAST_P + 3
    LC = rng(C6, "A", L0, "A", LAST_L)
    row = calc_block(ws, C5, "dem", row, "ت۱) تقاضا (اجماعی از مرحله ۳)", "", T, H + 1, lambda i, j, r: f'={bc(C3, "cons", i, j)}', FMT_Q)
    ss_f = lambda i, j: (f'(IF({j}<{T},({bc(C5, "dem", i, j)}+{bc(C5, "dem", i, min(j + 1, T))})/2,{bc(C5, "dem", i, j)}))')  # noqa: E731
    row = calc_block(ws, C5, "ss", row, "ت۲) ذخیره اطمینان",
                     "میانگین تقاضای این ماه و ماه بعد = m ؛ آماری: z × خطای نسبی پیش‌بینی × m × √(۱ + زمان تولید÷۳۰) ؛ روزی: روز ذخیره ÷ ۳۰ × m ؛ سقف: m × بیشینه(۰٫۱، ۰٫۴ × ماندگاری به ماه)", T, H + 1,
                     lambda i, j, r: (f'={G_(i)}MAX(0,MIN(IF(SSMethod="days",$M${P0 + i}/30*{ss_f(i, j)},Zval*$K${P0 + i}*{ss_f(i, j)}*SQRT(1+LeadDays/30)),'
                                      f'{ss_f(i, j)}*MAX(0.1,0.4*$J${P0 + i}))))'), FMT_Q)
    row = calc_block(ws, C5, "open", row, "ت۳) موجودی اول ماه", "ماه اول = موجودی فعلی ؛ بقیه = موجودی پایان ماه قبل (ت۱۰)", T, H + 1,
                     lambda i, j, r: (f"={G_(i)}$L${P0 + i})" if j == 1 else "=" + "{END_PREV}"), FMT_Q)
    need_raw = lambda i, j: f'MAX(0,{bc(C5, "dem", i, j)}+{bc(C5, "ss", i, j)}-{bc(C5, "open", i, j)})'  # noqa: E731
    row = calc_block(ws, C5, "need", row, "ت۴) نیاز تولید",
                     "= بیشینه(۰، تقاضا + ذخیره اطمینان − موجودی اول ماه) ؛ اگر بچ دارد: گرد به بالا به مضرب بچ", T, H + 1,
                     lambda i, j, r: f'={G_(i)}IF(AND($I${P0 + i}>0,{need_raw(i, j)}>0),ROUNDUP({need_raw(i, j)}/$I${P0 + i}-0.000000001,0)*$I${P0 + i},{need_raw(i, j)}))', FMT_Q)
    row = calc_block(ws, C5, "nh", row, "ت۵) ساعت لازم", "= نیاز ÷ نرخ تولید خط اصلی", T, H + 1,
                     lambda i, j, r: f'={G_(i)}IF($F${P0 + i}>0,{bc(C5, "need", i, j)}/$F${P0 + i},0))', FMT_D)
    row = calc_block(ws, C5, "norm", row, "ت۶) ساعت تخصیص‌یافته از ظرفیت عادی",
                     "= کمینه(ساعت لازم، ظرفیت خط − ساعت لازم محصولات با اولویت بالاتر روی همان خط در همان ماه)، حداقل صفر", T, H + 1,
                     lambda i, j, r: (f'={G_(i)}IF($F${P0 + i}>0,MAX(0,MIN({bc(C5, "nh", i, j)},$G${P0 + i}-SUMIFS({bcol(C5, "nh", j)},$E${P0}:$E${LAST_P},$E${P0 + i},$D${P0}:$D${LAST_P},"<"&$D${P0 + i}))),0))'), FMT_D)
    row = calc_block(ws, C5, "rem", row, "ت۷) ساعت تأمین‌نشده از ظرفیت عادی", "= ساعت لازم − ساعت عادی", T, H + 1,
                     lambda i, j, r: f'={G_(i)}{bc(C5, "nh", i, j)}-{bc(C5, "norm", i, j)})', FMT_D)
    row = calc_block(ws, C5, "ot", row, "ت۸) ساعت اضافه‌کاری",
                     "= کمینه(ساعت تأمین‌نشده، ظرفیت اضافه‌کاری خط − ساعت تأمین‌نشده محصولات با اولویت بالاتر)، حداقل صفر", T, H + 1,
                     lambda i, j, r: (f'={G_(i)}IF($F${P0 + i}>0,MAX(0,MIN({bc(C5, "rem", i, j)},$H${P0 + i}-SUMIFS({bcol(C5, "rem", j)},$E${P0}:$E${LAST_P},$E${P0 + i},$D${P0}:$D${LAST_P},"<"&$D${P0 + i}))),0))'), FMT_D)
    row = calc_block(ws, C5, "prod", row, "ت۹) تولید برنامه (واحد)",
                     "= (ساعت عادی + ساعت اضافه‌کاری) × نرخ تولید ؛ کالای بدون خط تولید (بازرگانی) = به اندازه نیاز", T, H + 1,
                     lambda i, j, r: f'={G_(i)}IF($F${P0 + i}>0,({bc(C5, "norm", i, j)}+{bc(C5, "ot", i, j)})*$F${P0 + i},{bc(C5, "need", i, j)}))', FMT_Q)
    row = calc_block(ws, C5, "end", row, "ت۱۰) موجودی پایان ماه", "= بیشینه(۰، موجودی اول ماه + تولید − تقاضا)", T, H + 1,
                     lambda i, j, r: f'={G_(i)}MAX(0,{bc(C5, "open", i, j)}+{bc(C5, "prod", i, j)}-{bc(C5, "dem", i, j)}))', FMT_Q)
    row = calc_block(ws, C5, "short", row, "ت۱۱) کمبود (فروش ازدست‌رفته)", "= بیشینه(۰، تقاضا − موجودی اول ماه − تولید)", T, H + 1,
                     lambda i, j, r: f'={G_(i)}MAX(0,{bc(C5, "dem", i, j)}-{bc(C5, "open", i, j)}-{bc(C5, "prod", i, j)}))', FMT_Q)
    row = calc_block(ws, C5, "otu", row, "ت۱۲) تولید با اضافه‌کاری (واحد)", "= ساعت اضافه‌کاری × نرخ تولید", T, H + 1,
                     lambda i, j, r: f'={G_(i)}{bc(C5, "ot", i, j)}*$F${P0 + i})', FMT_Q)
    row = calc_block(ws, C5, "rch", row, "ت۱۳) ساعت لازم RCCP (بدون محدودیت)", "= تقاضای اجماعی ÷ نرخ تولید (بدون ذخیره اطمینان و موجودی)؛ برای هشدار ظرفیت", T, H + 1,
                     lambda i, j, r: f'={G_(i)}IF($F${P0 + i}>0,{bc(C5, "dem", i, j)}/$F${P0 + i},0))', FMT_D)
    # جایگذاری ارجاع موجودی پایان ماه قبل در بلوک موجودی اول ماه
    r0o, _ = B.blocks[(C5, "open")]
    for i in range(NP):
        for j in range(2, T + 1):
            ws.cell(row=r0o + i, column=2 + j).value = f'={G_(i)}{bc(C5, "end", i, j - 1)})'

    def pl_row(i, r):
        g = G_(i)
        return [f'=IF({pref("A", i)}="","",{pref("A", i)})', f'={g}{pref("B", i)})', f"={g}{q(C1)}M{P0 + i})", f"={g}{q(C1)}X{P0 + i})",
                f'={g}{pref("K", i)}&"")', f'={g}N({pref("L", i)}))',
                f'={g}IFERROR(INDEX({rng(C6, "C", L0, "C", LAST_L)},MATCH(E{r},{LC},0)),0))',
                f'={g}IFERROR(INDEX({rng(C6, "D", L0, "D", LAST_L)},MATCH(E{r},{LC},0)),0))',
                f'={g}N({pref("I", i)}))', f'={g}IF(N({pref("J", i)})>0,{pref("J", i)}/30,99))',
                f"={g}{q(C2)}O{P0 + i})", f'={g}N({pref("M", i)}))', f'={g}N({pref("H", i)}))',
                f'={g}SUM({brow(C5, "dem", i, 1, T)}))', f'={g}SUM({brow(C5, "prod", i, 1, T)}))', f'={g}SUM({brow(C5, "short", i, 1, T)}))',
                f'={g}IF(N{r}>0,1-P{r}/N{r},1))',
                f'={g}SUMPRODUCT(--({brow(C5, "end", i, 1, T)}<{brow(C5, "ss", i, 1, T)}*0.999-0.5)))',
                f'={g}AVERAGE({brow(C5, "dem", i, 1, 3)}))',
                f'={g}IF(S{r}>0,L{r}/S{r},IF(L{r}>0,999,0)))',
                f'={g}IF(AND(S{r}>0,T{r}<M{r}/30),"بحرانی",IF(AND(S{r}>0,T{r}<M{r}/30+0.5),"هشدار",IF(T{r}>ExcessMonths,"مازاد","مناسب"))))']
    info_table(ws, mcols5, w5, pl_row, f5)
    ws.freeze_panes = "C5"

    # ============================================================ ۶_ظرفیت (بلوک‌ها)
    def line_block(key: str, row: int, title: str, formula: str, fn, fmt: str) -> int:
        block_title(w6, row, title, formula, T)
        hr = row + 2
        head(w6, hr, 1, ["کد خط", "نام خط"] + [None] * T)
        for j in range(T):
            w6.cell(row=hr, column=3 + j, value=cal_label(H + 1 + j))
        for i in range(NL):
            r = hr + 1 + i
            put(w6, r, 1, f"=A{L0 + i}")
            put(w6, r, 2, f"=B{L0 + i}")
            for j in range(1, T + 1):
                put(w6, r, 2 + j, fn(i, j), fmt)
        B.blocks[(C6, key)] = (hr + 1, 3)
        return hr + NL + 3

    lcell = lambda key, i, j: f"{CL(2 + j)}{B.blocks[(C6, key)][0] + i}"  # noqa: E731
    lrow = lambda key, i, j1, j2: f"{CL(2 + j1)}{B.blocks[(C6, key)][0] + i}:{CL(2 + j2)}{B.blocks[(C6, key)][0] + i}"  # noqa: E731
    gl = lambda i: f'IF($A${L0 + i}="","",'  # noqa: E731
    E5 = f"{q(C5)}$E${P0}:$E${LAST_P}"
    row = LAST_L + 3
    row = line_block("load", row, "ظ۱) ساعت بار برنامه", "= Σ ساعت عادی + ساعت اضافه‌کاری محصولاتی که خط اصلی‌شان این خط است (از مرحله ۵)",
                     lambda i, j: f'={gl(i)}SUMIFS({bcol(C5, "norm", j)},{E5},$A${L0 + i})+SUMIFS({bcol(C5, "ot", j)},{E5},$A${L0 + i}))', FMT_D)
    row = line_block("oth", row, "ظ۲) ساعت اضافه‌کاری", "", lambda i, j: f'={gl(i)}SUMIFS({bcol(C5, "ot", j)},{E5},$A${L0 + i}))', FMT_D)
    row = line_block("util", row, "ظ۳) بهره‌برداری برنامه", "= ساعت بار ÷ ظرفیت عادی (بالای ۱۰۰٪ یعنی اضافه‌کاری)",
                     lambda i, j: f'={gl(i)}IF($C${L0 + i}>0,{lcell("load", i, j)}/$C${L0 + i},""))', FMT_P)
    row = line_block("rccp", row, "ظ۴) RCCP: بهره‌برداری لازم بدون محدودیت", "= Σ (اجماعی ÷ نرخ تولید) ÷ ظرفیت عادی",
                     lambda i, j: f'={gl(i)}IF($C${L0 + i}>0,SUMIFS({bcol(C5, "rch", j)},{E5},$A${L0 + i})/$C${L0 + i},""))', FMT_P)
    for i in range(NL):
        r = L0 + i
        g = gl(i)
        put(w6, r, 6, f'={g}AVERAGE({lrow("util", i, 1, T)}))', FMT_P)
        put(w6, r, 7, f'={g}MAX({lrow("util", i, 1, T)}))', FMT_P)
        put(w6, r, 8, f'={g}COUNTIF({lrow("util", i, 1, T)},">1.0001"))', "0")
        put(w6, r, 9, f'={g}SUM({lrow("oth", i, 1, T)}))', FMT_Q)
        put(w6, r, 10, f'={g}MAX({lrow("rccp", i, 1, 6)}))', FMT_P)
        put(w6, r, 11, f'={g}IF(J{r}>UtilMax,"اضافه‌بار",IF(J{r}>UtilWarn,"نزدیک سقف","مناسب")))')
    LINE_UTIL = B.blocks[(C6, "util")]

    # ============================================================ ۷_محاسبه_BOM
    ws = B.sheet(C7, "مرحله ۷ — نیاز مواد هر ردیف BOM",
                 "هر ردیف BOM: مقدار با ضایعات = مقدار برای یک واحد × (۱ + ضایعات). نیاز ماده در هر ماه = مقدار با ضایعات × تولید برنامه همان محصول (مرحله ۵). "
                 "بهای مواد در یک واحد محصول = مقدار با ضایعات × بهای واحد ماده؛ منشأ: درون‌گروهی، وارداتی یا داخلی (برای بهای تمام‌شده در مرحله ۹).", "4472C4")
    b0, LAST_B = 5, 4 + NBOM
    bh = ["کد محصول", "کد ماده", "مقدار با ضایعات", "ردیف محصول", "ردیف ماده", "بهای واحد ماده", "بهای مواد در یک واحد محصول", "منشأ"]
    head(ws, 4, 1, bh + [None] * T, [11, 11, 12, 8, 8, 13, 14, 9] + [11] * T)
    for j in range(T):
        ws.cell(row=4, column=9 + j, value=cal_label(H + 1 + j))
    M0, LAST_M = 5, 4 + NMAT
    MC = rng(S_MAT, "A", M0, "A", LAST_M)
    for i in range(NBOM):
        r = b0 + i
        br = lambda col: f"{q(S_BOM)}{col}{r}"  # noqa: E731
        g = f'IF({br("A")}="","",'
        put(ws, r, 1, f'=IF({br("A")}="","",{br("A")})')
        put(ws, r, 2, f'={g}{br("B")})')
        put(ws, r, 3, f'={g}N({br("C")})*(1+N({br("D")})))', "0.0000")
        put(ws, r, 4, f'={g}IFERROR(MATCH(A{r},{rng(S_PROD, "A", P0, "A", LAST_P)},0),""))', "0")
        put(ws, r, 5, f'={g}IFERROR(MATCH(B{r},{MC},0),""))', "0")
        put(ws, r, 6, f'={g}IF(E{r}="",0,INDEX({rng(S_MAT, "D", M0, "D", LAST_M)},E{r})))', FMT_M)
        put(ws, r, 7, f"={g}C{r}*F{r})", FMT_M)
        put(ws, r, 8, f'={g}IF(E{r}="","",IF(INDEX({rng(S_MAT, "K", M0, "K", LAST_M)},E{r})&""<>"","IC",IF(N(INDEX({rng(S_MAT, "J", M0, "J", LAST_M)},E{r}))=1,"Import","Domestic"))))')
        for j in range(1, T + 1):
            r0p, _ = B.blocks[(C5, "prod")]
            put(ws, r, 8 + j, f'=IF(OR(A{r}="",D{r}=""),0,C{r}*INDEX({q(C5)}${CL(2 + j)}${r0p}:${CL(2 + j)}${r0p + NP - 1},D{r}))', FMT_Q)
    ws.freeze_panes = "C5"

    # ============================================================ ۸_مواد_MRP
    w8 = B.sheet(C8, "مرحله ۸ — برنامه‌ریزی مواد (MRP) و درخواست خرید",
                 "زمان تأمین به ماه = گرد به بالا((روز تأمین − ۵) ÷ ۳۰). ذخیره اطمینان ماده = روز ذخیره ÷ ۳۰ × میانگین نیاز ماهانه. سفارش در راه در ماه «زمان تأمین» (حداقل ماه ۱) می‌رسد. "
                 "هر ماه: موجودی در دسترس = موجودی ماه قبل + رسیدنی − نیاز؛ اگر کمتر از ذخیره اطمینان شد، سفارش = کسری (حداقل MOQ و مضرب آن). تاریخ صدور سفارش = ماه رسیدن − زمان تأمین (اگر قبل از امروز شد = ماه ۱ و «دیرکرد»).", "4472C4")
    mh = ["کد ماده", "نام ماده", "واحد", "بهای واحد", "زمان تأمین (روز)", "زمان تأمین (ماه)", "میانگین نیاز ماهانه", "ذخیره اطمینان", "MOQ", "موجودی فعلی",
          "سفارش در راه", "ماه رسیدن سفارش در راه", "وارداتی", "شرکت درون‌گروهی", "سفارش‌های دیرکرد", "جمع سفارش ۱۲ ماه", "درخواست درون‌گروهی (تن)"]
    head(w8, 4, 1, mh, [10, 24, 8, 12, 9, 8, 12, 11, 9, 11, 11, 9, 7, 10, 9, 12, 12])

    def mat_block(key: str, row: int, title: str, formula: str, fn, fmt: str) -> int:
        block_title(w8, row, title, formula, T)
        hr = row + 2
        head(w8, hr, 1, ["کد ماده", "نام ماده"] + [None] * T)
        for j in range(T):
            w8.cell(row=hr, column=3 + j, value=cal_label(H + 1 + j))
        for i in range(NMAT):
            r = hr + 1 + i
            put(w8, r, 1, f"=A{M0 + i}")
            put(w8, r, 2, f"=B{M0 + i}")
            for j in range(1, T + 1):
                put(w8, r, 2 + j, fn(i, j), fmt)
        B.blocks[(C8, key)] = (hr + 1, 3)
        return hr + NMAT + 3

    mc = lambda key, i, j: f"{CL(2 + j)}{B.blocks[(C8, key)][0] + i}"  # noqa: E731
    mrow = lambda key, i, j1, j2: f"{CL(2 + j1)}{B.blocks[(C8, key)][0] + i}:{CL(2 + j2)}{B.blocks[(C8, key)][0] + i}"  # noqa: E731
    gm = lambda i: f'IF($A${M0 + i}="","",'  # noqa: E731
    row = LAST_M + 3
    row = mat_block("gross", row, "م۱) نیاز ناخالص", "= Σ نیاز ردیف‌های BOM همین ماده (شیت م۷)",
                    lambda i, j: f'={gm(i)}SUMIF({rng(C7, "B", b0, "B", LAST_B)},$A${M0 + i},{rng(C7, CL(8 + j), b0, CL(8 + j), LAST_B)}))', FMT_Q)
    row = mat_block("sched", row, "م۲) رسیدن سفارش در راه", "= سفارش در راه، فقط در ماه رسیدن",
                    lambda i, j: f'={gm(i)}IF($L${M0 + i}={j},$K${M0 + i},0))', FMT_Q)
    row = mat_block("avail", row, "م۳) موجودی در دسترس قبل از سفارش جدید", "= موجودی پایان ماه قبل (ماه اول: موجودی فعلی) + رسیدنی − نیاز ناخالص",
                    lambda i, j: f'={gm(i)}{("$J$" + str(M0 + i)) if j == 1 else "{PROJ_PREV}"}+{mc("sched", i, j)}-{mc("gross", i, j)})', FMT_Q)
    row = mat_block("net", row, "م۴) نیاز خالص", "= اگر موجودی در دسترس < ذخیره اطمینان: ذخیره اطمینان − موجودی در دسترس، وگرنه صفر",
                    lambda i, j: f'={gm(i)}IF({mc("avail", i, j)}<$H${M0 + i},$H${M0 + i}-{mc("avail", i, j)},0))', FMT_Q)
    row = mat_block("rec", row, "م۵) سفارش برنامه‌ای (رسیدن)", "= اگر نیاز خالص > ۰: اگر MOQ دارد گرد به بالا(بیشینه(نیاز، MOQ) ÷ MOQ) × MOQ، وگرنه همان نیاز",
                    lambda i, j: f'={gm(i)}IF({mc("net", i, j)}>0,IF($I${M0 + i}>0,ROUNDUP(MAX({mc("net", i, j)},$I${M0 + i})/$I${M0 + i}-0.000000001,0)*$I${M0 + i},{mc("net", i, j)}),0))', FMT_Q)
    row = mat_block("proj", row, "م۶) موجودی پایان ماه", "= موجودی در دسترس + سفارش برنامه‌ای", lambda i, j: f'={gm(i)}{mc("avail", i, j)}+{mc("rec", i, j)})', FMT_Q)
    row = mat_block("rel", row, "م۷) صدور سفارش (تاریخ ثبت خرید)",
                    "ماه ۱ = جمع سفارش‌هایی که باید تا ماه (۱ + زمان تأمین) برسند ؛ ماه‌های بعد = سفارشی که (زمان تأمین) ماه بعد باید برسد",
                    lambda i, j: (f'={gm(i)}SUM(INDEX({mrow("rec", i, 1, T)},1):INDEX({mrow("rec", i, 1, T)},MIN({T},1+$F${M0 + i}))))' if j == 1
                                  else f'={gm(i)}IF({j}+$F${M0 + i}<={T},INDEX({mrow("rec", i, 1, T)},{j}+$F${M0 + i}),0))'), FMT_Q)
    r0a, _ = B.blocks[(C8, "avail")]
    for i in range(NMAT):
        for j in range(2, T + 1):
            c = w8.cell(row=r0a + i, column=2 + j)
            c.value = c.value.replace("{PROJ_PREV}", mc("proj", i, j - 1))
    for i in range(NMAT):
        r = M0 + i
        mr = lambda col: f"{q(S_MAT)}{col}{r}"  # noqa: E731
        g = gm(i)
        put(w8, r, 1, f'=IF({mr("A")}="","",{mr("A")})')
        vals = [(2, f'={g}{mr("B")})', None), (3, f'={g}{mr("C")}&"")', None), (4, f'={g}N({mr("D")}))', FMT_M), (5, f'={g}N({mr("E")}))', "0"),
                (6, f"={g}MAX(0,ROUNDUP((E{r}-5)/30,0)))", "0"), (7, f'={g}AVERAGE({mrow("gross", i, 1, T)}))', FMT_Q),
                (8, f'={g}N({mr("G")})/30*G{r})', FMT_Q), (9, f'={g}N({mr("F")}))', FMT_Q), (10, f'={g}N({mr("H")}))', FMT_Q),
                (11, f'={g}N({mr("I")}))', FMT_Q), (12, f"={g}MIN({T},MAX(1,F{r})))", "0"), (13, f'={g}N({mr("J")}))', "0"),
                (14, f'={g}{mr("K")}&"")', None),
                (15, f'={g}IF(F{r}=0,0,COUNTIF(INDEX({mrow("rec", i, 1, T)},1):INDEX({mrow("rec", i, 1, T)},MIN({T},F{r})),">0")))', "0"),
                (16, f'={g}SUM({mrow("rec", i, 1, T)}))', FMT_Q),
                (17, f'={g}IF(N{r}="",0,IF(C{r}="کیلوگرم",P{r}/1000,IF(C{r}="تن",P{r},0))))', "#,##0.0")]
        for col, v, fm in vals:
            put(w8, r, col, v, fm)
    w8.freeze_panes = "C5"

    # ============================================================ ۹_مالی
    w9 = B.sheet(C9, "مرحله ۹ — بهای تمام‌شده، سود و زیان برنامه، بودجه و سرمایه در گردش",
                 "بهای واحد: مواد از BOM، تبدیل = هزینه ساعت خط ÷ نرخ تولید، سربار = بهای ثبت‌شده − مواد − تبدیل. فروش = تقاضا − کمبود. قیمت ماه = قیمت پایه × (۱+تورم قیمت)^(ماه−۱) × (۱−تخفیف) × (۱+سناریو قیمت). "
                 "بهای ماه = [(مواد داخلی + درون‌گروهی) + وارداتی × (۱+سناریو ارز)] × (۱+سناریو مواد) × تورم + تبدیل × تورم × (۱+سناریو تبدیل) + سربار × تورم.", "4472C4")
    fh9 = ["کد", "نام", "مواد داخلی", "مواد وارداتی", "مواد درون‌گروهی", "تبدیل", "سربار", "بهای ثبت‌شده", "قیمت پایه", "وزن (کیلوگرم)",
           "درآمد ۱۲ ماه", "بهای فروش ۱۲ ماه", "سود ناخالص ۱۲ ماه", "حاشیه ناخالص"]
    row = LAST_P + 3
    IDX_ROW = row
    put(w9, IDX_ROW, 2, "ضریب تورم قیمت (کمکی)", bold=True)
    put(w9, IDX_ROW + 1, 2, "ضریب تورم هزینه (کمکی)", bold=True)
    for j in range(1, T + 1):
        put(w9, IDX_ROW - 1, 2 + j, cal_label(H + j), bold=True)
        put(w9, IDX_ROW, 2 + j, f"=(1+PriceInfl)^{j - 1}", "0.0000")
        put(w9, IDX_ROW + 1, 2 + j, f"=(1+CostInfl)^{j - 1}", "0.0000")
    PI = lambda j: f"{CL(2 + j)}${IDX_ROW}"  # noqa: E731
    CI = lambda j: f"{CL(2 + j)}${IDX_ROW + 1}"  # noqa: E731
    row = IDX_ROW + 3
    row = calc_block(w9, C9, "sold", row, "ف۱) فروش برنامه (واحد)", "= بیشینه(۰، تقاضا − کمبود)", T, H + 1,
                     lambda i, j, r: f'={G_(i)}MAX(0,{bc(C5, "dem", i, j)}-{bc(C5, "short", i, j)}))', FMT_Q)
    row = calc_block(w9, C9, "price", row, "ف۲) قیمت خالص ماه", "= قیمت پایه × ضریب تورم قیمت × (۱ − تخفیف میانگین) × (۱ + سناریو قیمت)", T, H + 1,
                     lambda i, j, r: f'={G_(i)}$I${P0 + i}*{PI(j)}*(1-AvgDiscount)*(1+PriceChg))', FMT_M)
    row = calc_block(w9, C9, "rev", row, "ف۳) درآمد", "= فروش × قیمت خالص", T, H + 1,
                     lambda i, j, r: f'={G_(i)}{bc(C9, "sold", i, j)}*{bc(C9, "price", i, j)})', FMT_M)
    row = calc_block(w9, C9, "ucogs", row, "ف۴) بهای تمام‌شده واحد در ماه", "طبق فرمول بالای شیت", T, H + 1,
                     lambda i, j, r: (f'={G_(i)}(($C${P0 + i}+$E${P0 + i})+$D${P0 + i}*(1+FxChg))*(1+MatChg)*{CI(j)}+$F${P0 + i}*{CI(j)}*(1+ConvChg)+$G${P0 + i}*{CI(j)})'), FMT_M)
    row = calc_block(w9, C9, "cogs", row, "ف۵) بهای تمام‌شده فروش", "= فروش × بهای واحد ماه", T, H + 1,
                     lambda i, j, r: f'={G_(i)}{bc(C9, "sold", i, j)}*{bc(C9, "ucogs", i, j)})', FMT_M)
    row = calc_block(w9, C9, "hold", row, "ف۶) هزینه نگهداری موجودی", "= موجودی پایان ماه × بهای ثبت‌شده × ضریب تورم هزینه × نرخ نگهداری", T, H + 1,
                     lambda i, j, r: f'={G_(i)}{bc(C5, "end", i, j)}*$H${P0 + i}*{CI(j)}*HoldingRate)', FMT_M)
    row = calc_block(w9, C9, "lost", row, "ف۷) فروش ازدست‌رفته (ریال)", "= کمبود × قیمت خالص", T, H + 1,
                     lambda i, j, r: f'={G_(i)}{bc(C5, "short", i, j)}*{bc(C9, "price", i, j)})', FMT_M)
    row = calc_block(w9, C9, "revb", row, "ف۸) درآمد برنامه در ماه‌های دارای بودجه", "= درآمد اگر بودجه مقدار آن ماه > ۰ ، وگرنه صفر", T, H + 1,
                     lambda i, j, r: f'={G_(i)}IF(N({in_cell(S_BUD, "q", i, j)})>0,{bc(C9, "rev", i, j)},0))', FMT_M)
    row = calc_block(w9, C9, "bvol", row, "ف۹) اثر حجم نسبت به بودجه", "= (فروش برنامه − بودجه مقدار) × (بودجه مبلغ ÷ بودجه مقدار)، فقط ماه‌های دارای بودجه", T, H + 1,
                     lambda i, j, r: f'={G_(i)}IF(N({in_cell(S_BUD, "q", i, j)})>0,({bc(C9, "sold", i, j)}-{in_cell(S_BUD, "q", i, j)})*N({in_cell(S_BUD, "r", i, j)})/{in_cell(S_BUD, "q", i, j)},0))', FMT_M)

    def fi_row(i, r):
        g = G_(i)
        sm = lambda typ: f'={g}SUMIFS({rng(C7, "G", b0, "G", LAST_B)},{rng(C7, "A", b0, "A", LAST_B)},A{r},{rng(C7, "H", b0, "H", LAST_B)},"{typ}"))'  # noqa: E731
        return [f'=IF({pref("A", i)}="","",{pref("A", i)})', f'={g}{pref("B", i)})', sm("Domestic"), sm("Import"), sm("IC"),
                f'={g}IF(N({pref("L", i)})>0,IFERROR(INDEX({rng(C6, "E", L0, "E", LAST_L)},MATCH({pref("K", i)}&"",{LC},0)),0)/{pref("L", i)},0))',
                f"={g}MAX(0,H{r}-C{r}-D{r}-E{r}-F{r}))", f'={g}N({pref("F", i)}))', f'={g}N({pref("E", i)}))', f'={g}N({pref("D", i)}))',
                f'={g}SUM({brow(C9, "rev", i, 1, T)}))', f'={g}SUM({brow(C9, "cogs", i, 1, T)}))', f"={g}K{r}-L{r})", f'={g}IF(K{r}>0,M{r}/K{r},""))']
    info_table(w9, fh9, [10, 26, 12, 12, 12, 11, 11, 12, 12, 9, 15, 15, 15, 9], fi_row,
               [None, None, FMT_M, FMT_M, FMT_M, FMT_M, FMT_M, FMT_M, FMT_M, "0.00", FMT_M, FMT_M, FMT_M, FMT_P])
    # سود و زیان ماهانه
    PL0 = row + 1
    block_title(w9, row - 1, "ف۱۰) سود و زیان و سرمایه در گردش ماهانه (کل شرکت؛ ریال)", "هر سطر جمع همه محصولات/خطوط/مواد همان ماه است", T + 1)
    head(w9, PL0 + 1, 1, ["", "سطر"] + [None] * T + ["جمع ۱۲ ماه"])
    for j in range(T):
        w9.cell(row=PL0 + 1, column=3 + j, value=cal_label(H + 1 + j))
    r8 = lambda key: B.blocks[(C8, key)][0]  # noqa: E731
    l6 = lambda key: B.blocks[(C6, key)][0]  # noqa: E731
    lines_pl = [
        ("rev", "درآمد", lambda j: f'=SUM({bcol(C9, "rev", j)})'),
        ("cogs", "بهای تمام‌شده فروش", lambda j: f'=SUM({bcol(C9, "cogs", j)})'),
        ("gross", "سود ناخالص", lambda j: f"={CL(2 + j)}{{rev}}-{CL(2 + j)}{{cogs}}"),
        ("gm", "حاشیه ناخالص", lambda j: f'=IF({CL(2 + j)}{{rev}}>0,{CL(2 + j)}{{gross}}/{CL(2 + j)}{{rev}},"")'),
        ("otc", "هزینه اضافه‌کاری", lambda j: f'=SUMPRODUCT({q(C6)}${CL(2 + j)}${l6("oth")}:${CL(2 + j)}${l6("oth") + NL - 1},{rng(C6, "E", L0, "E", LAST_L)})*OTPremium*{CI(j)}*(1+ConvChg)'),
        ("hold", "هزینه نگهداری", lambda j: f'=SUM({bcol(C9, "hold", j)})'),
        ("op", "سود عملیاتی برنامه", lambda j: f"={CL(2 + j)}{{gross}}-{CL(2 + j)}{{otc}}-{CL(2 + j)}{{hold}}"),
        ("lost", "فروش ازدست‌رفته", lambda j: f'=SUM({bcol(C9, "lost", j)})'),
        ("tons", "فروش (تن)", lambda j: f'=SUMPRODUCT({bcol(C9, "sold", j)},$J${P0}:$J${LAST_P})/1000'),
        ("bud", "بودجه درآمد", lambda j: f'=SUM({q(S_BUD)}${CL(2 + j)}${B.blocks[(S_BUD, "r")][0]}:${CL(2 + j)}${B.blocks[(S_BUD, "r")][0] + NP - 1})'),
        ("revb", "درآمد برنامه در ماه‌های بودجه‌دار", lambda j: f'=SUM({bcol(C9, "revb", j)})'),
        ("ar", "مطالبات", lambda j: f"={CL(2 + j)}{{rev}}*DSO/30"),
        ("pur", "خرید مواد", lambda j: f'=SUMPRODUCT({q(C8)}${CL(2 + j)}${r8("rec")}:${CL(2 + j)}${r8("rec") + NMAT - 1},{rng(C8, "D", M0, "D", LAST_M)},(1+MatChg)*(1+FxChg*({rng(C8, "M", M0, "M", LAST_M)}=1)))'),
        ("ap", "بدهی به تأمین‌کنندگان", lambda j: f"={CL(2 + j)}{{pur}}*DPO/30"),
        ("invf", "موجودی کالا (ریال)", lambda j: f'=SUMPRODUCT({bcol(C5, "end", j)},$H${P0}:$H${LAST_P})'),
        ("invm", "موجودی مواد (ریال)", lambda j: f'=SUMPRODUCT({q(C8)}${CL(2 + j)}${r8("proj")}:${CL(2 + j)}${r8("proj") + NMAT - 1},{rng(C8, "D", M0, "D", LAST_M)})'),
        ("nwc", "سرمایه در گردش", lambda j: f"={CL(2 + j)}{{invf}}+{CL(2 + j)}{{invm}}+{CL(2 + j)}{{ar}}-{CL(2 + j)}{{ap}}"),
    ]
    PLR = {key: PL0 + 2 + n for n, (key, _, _) in enumerate(lines_pl)}
    for key, lab, fn in lines_pl:
        r = PLR[key]
        put(w9, r, 2, lab, bold=key in ("gross", "op", "nwc"))
        for j in range(1, T + 1):
            v = fn(j)
            for k2, rr in PLR.items():
                v = v.replace("{" + k2 + "}", str(rr))
            put(w9, r, 2 + j, v, FMT_P if key == "gm" else ("#,##0.0" if key == "tons" else FMT_M), bold=key in ("gross", "op", "nwc"))
        tc = CL(3 + T)
        if key == "gm":
            put(w9, r, 3 + T, f'=IF({tc}{PLR["rev"]}>0,{tc}{PLR["gross"]}/{tc}{PLR["rev"]},"")', FMT_P, bold=True)
        elif key in ("ar", "ap", "invf", "invm", "nwc"):
            put(w9, r, 3 + T, f"={CL(2 + T)}{r}", FMT_M, bold=True)   # مانده‌ها: پایان دوره
        else:
            put(w9, r, 3 + T, f"=SUM(C{r}:{CL(2 + T)}{r})", "#,##0.0" if key == "tons" else FMT_M, bold=True)
    BR = PLR["nwc"] + 2
    tc = CL(3 + T)
    put(w9, BR, 2, "شکاف با بودجه (ماه‌های بودجه‌دار)", bold=True)
    bud_q = f'{q(S_BUD)}$C${B.blocks[(S_BUD, "q")][0]}:${CL(2 + T)}${B.blocks[(S_BUD, "q")][0] + NP - 1}'
    bud_r = f'{q(S_BUD)}$C${B.blocks[(S_BUD, "r")][0]}:${CL(2 + T)}${B.blocks[(S_BUD, "r")][0] + NP - 1}'
    put(w9, BR + 1, 2, "پل بودجه — بودجه درآمد (خانه‌های دارای بودجه)", bold=True)
    put(w9, BR + 1, 3, f'=SUMIF({bud_q},">0",{bud_r})', FMT_M, bold=True)
    put(w9, BR, 3, f'=IF(C{BR + 1}>0,{tc}{PLR["revb"]}/C{BR + 1}-1,"")', FMT_P, bold=True)
    put(w9, BR + 2, 2, "پل بودجه — اثر حجم", bold=True)
    put(w9, BR + 2, 3, f'=SUM({ball(C9, "bvol", T)})', FMT_M, bold=True)
    put(w9, BR + 3, 2, "پل بودجه — اثر قیمت و ترکیب", bold=True)
    put(w9, BR + 3, 3, f'={tc}{PLR["revb"]}-C{BR + 1}-C{BR + 2}', FMT_M, bold=True)
    put(w9, BR + 4, 2, "پل بودجه — درآمد برنامه", bold=True)
    put(w9, BR + 4, 3, f'={tc}{PLR["revb"]}', FMT_M, bold=True)
    w9.freeze_panes = "C5"
    FIN = {"PLR": PLR, "BR": BR, "tc": tc}

    # ============================================================ ۱۰_داشبورد
    w10 = B.sheet(C10, "مرحله ۱۰ — داشبورد و کارنامه جلسه مدیریت",
                  "شاخص‌های اصلی هر مرحله با هدف و وضعیت (خوب / هشدار / بحرانی). Power BI همین جدول را از شیت خروجی_KPI می‌خواند.", "4472C4")
    head(w10, 4, 1, ["شاخص", "مقدار", "هدف", "وضعیت", "قاعده وضعیت", "منبع"], [34, 18, 12, 10, 46, 22])
    PLR = FIN["PLR"]
    kp = [
        ("فروش ریالی ۱۲ ماه اخیر", f"={q(C1)}E{PF_TOT}", None, None, "", C1, FMT_M),
        ("رشد حجم فروش ۱۲ ماه", f'=IF({q(C1)}I{PF_TOT}>0,{q(C1)}H{PF_TOT}/{q(C1)}I{PF_TOT}-1,"")', None, None, "", C1, FMT_P),
        ("سهم ۲۰٪ محصولات برتر", f"={q(C1)}E{PF_TOT + 2}", None, None, "", C1, FMT_P),
        ("دقت پیش‌بینی ۳ ماه", f"={q(C4)}C{ACC_CO}", "=AccTarget", "acc", "خوب ≥ هدف ؛ هشدار ≥ هدف − ۱۰٪ ؛ وگرنه بحرانی", C4, FMT_P),
        ("سوگیری پیش‌بینی ۳ ماه", f"={q(C4)}C{ACC_CO + 1}", 0, "bias", "خوب: |سوگیری| ≤ ۵٪ ؛ هشدار ≤ ۱۰٪", C4, FMT_P),
        ("ارزش افزوده پیش‌بینی (FVA)", f"={q(C4)}C{ACC_CO + 3}", 0, "fva", "خوب ≥ ۰", C4, FMT_P),
        ("اجماعی ۱۲ ماه (تن)", f"=SUM({q(C3)}C{TONS_ROW}:{CL(2 + T)}{TONS_ROW})", None, None, "", C3, "#,##0"),
        ("اجماعی نسبت به سال قبل (تن)", f"=IF(SUM({q(C3)}C{TONS_ROW + 1}:{CL(2 + T)}{TONS_ROW + 1})>0,SUM({q(C3)}C{TONS_ROW}:{CL(2 + T)}{TONS_ROW})/SUM({q(C3)}C{TONS_ROW + 1}:{CL(2 + T)}{TONS_ROW + 1})-1,\"\")", None, None, "", C3, FMT_P),
        ("نرخ پاسخ‌گویی به تقاضا", f'=IF(SUM({q(C5)}N{P0}:N{LAST_P})>0,1-SUM({q(C5)}P{P0}:P{LAST_P})/SUM({q(C5)}N{P0}:N{LAST_P}),1)', "=ServiceLevel", "fill", "خوب ≥ سطح خدمت ؛ هشدار ≥ سطح خدمت − ۳٪", C5, "0.0%"),
        ("محصولات زیر ذخیره اطمینان", f'=COUNTIF({q(C5)}R{P0}:R{LAST_P},">0")', 0, None, "", C5, "0"),
        ("میانگین بهره‌برداری خطوط", f"=AVERAGE({q(C6)}C{LINE_UTIL[0]}:{CL(2 + T)}{LINE_UTIL[0] + NL - 1})", "=UtilWarn", None, "", C6, FMT_P),
        ("خط×ماه گلوگاه (بالای ۱۰۰٪)", f"=SUM({q(C6)}H{L0}:H{LAST_L})", 0, "bott", "خوب = ۰ ؛ هشدار ≤ ۶", C6, "0"),
        ("ساعت اضافه‌کاری ۱۲ ماه", f"=SUM({q(C6)}I{L0}:I{LAST_L})", None, None, "", C6, FMT_Q),
        ("درآمد برنامه ۱۲ ماه", f"={q(C9)}{FIN['tc']}{PLR['rev']}", None, None, "", C9, FMT_M),
        ("سود ناخالص برنامه ۱۲ ماه", f"={q(C9)}{FIN['tc']}{PLR['gross']}", None, None, "", C9, FMT_M),
        ("حاشیه ناخالص برنامه", f"={q(C9)}{FIN['tc']}{PLR['gm']}", 0.2, "gm", "خوب ≥ ۲۰٪ ؛ هشدار ≥ ۱۲٪", C9, FMT_P),
        ("سود عملیاتی برنامه ۱۲ ماه", f"={q(C9)}{FIN['tc']}{PLR['op']}", None, None, "", C9, FMT_M),
        ("فروش ازدست‌رفته ۱۲ ماه", f"={q(C9)}{FIN['tc']}{PLR['lost']}", 0, None, "", C9, FMT_M),
        ("شکاف با بودجه", f"={q(C9)}C{FIN['BR']}", 0, "bud", "خوب ≥ −۲٪ ؛ هشدار ≥ −۸٪", C9, FMT_P),
        ("سرمایه در گردش پایان ماه ۱۲", f"={q(C9)}{FIN['tc']}{PLR['nwc']}", None, None, "", C9, FMT_M),
        ("محصولات با خطر کمبود", f'=COUNTIF({q(C5)}U{P0}:U{LAST_P},"بحرانی")', 0, None, "", C5, "0"),
        ("محصولات با موجودی مازاد", f'=COUNTIF({q(C5)}U{P0}:U{LAST_P},"مازاد")', 0, None, "", C5, "0"),
        ("خطوط با اضافه‌بار (RCCP شش ماه)", f'=COUNTIF({q(C6)}K{L0}:K{LAST_L},"اضافه‌بار")', 0, None, "", C6, "0"),
        ("محصولات با سوگیری مداوم", f'=COUNTIF({q(C4)}G{P0}:G{LAST_P},"?*")', 0, None, "", C4, "0"),
        ("سفارش‌های خرید دیرکرد", f"=SUM({q(C8)}O{M0}:O{LAST_M})", 0, None, "", C8, "0"),
        ("هشدارهای بحرانی", "=B25+B27", 0, "crit", "خوب = ۰ ؛ هشدار ≤ ۳", C10, "0"),
    ]
    KR = {}
    for n, (lab, f, tgt, rule, desc, src, fm) in enumerate(kp):
        r = 5 + n
        KR[lab] = r
        put(w10, r, 1, lab, bold=True)
        put(w10, r, 2, f, fm)
        put(w10, r, 3, tgt, fm)
        rules = {
            "acc": f'=IF(B{r}="","",IF(B{r}>=C{r},"خوب",IF(B{r}>=C{r}-0.1,"هشدار","بحرانی")))',
            "bias": f'=IF(B{r}="","",IF(ABS(B{r})<=0.05,"خوب",IF(ABS(B{r})<=0.1,"هشدار","بحرانی")))',
            "fva": f'=IF(B{r}="","",IF(B{r}>=0,"خوب","هشدار"))',
            "fill": f'=IF(B{r}>=C{r},"خوب",IF(B{r}>=C{r}-0.03,"هشدار","بحرانی"))',
            "bott": f'=IF(B{r}=0,"خوب",IF(B{r}<=6,"هشدار","بحرانی"))',
            "gm": f'=IF(B{r}="","",IF(B{r}>=0.2,"خوب",IF(B{r}>=0.12,"هشدار","بحرانی")))',
            "bud": f'=IF(B{r}="","",IF(B{r}>=-0.02,"خوب",IF(B{r}>=-0.08,"هشدار","بحرانی")))',
            "crit": f'=IF(B{r}=0,"خوب",IF(B{r}<=3,"هشدار","بحرانی"))',
        }
        put(w10, r, 4, rules.get(rule))
        put(w10, r, 5, desc)
        put(w10, r, 6, src)
    # «هشدارهای بحرانی» = خطر کمبود + اضافه‌بار خطوط
    rcrit = KR["هشدارهای بحرانی"]
    w10.cell(row=rcrit, column=2).value = f'=B{KR["محصولات با خطر کمبود"]}+B{KR["خطوط با اضافه‌بار (RCCP شش ماه)"]}'
    for txt, color in (("خوب", "C6EFCE"), ("هشدار", "FFEB9C"), ("بحرانی", "FFC7CE")):
        w10.conditional_formatting.add(f"D5:D{4 + len(kp)}", CellIsRule(operator="equal", formula=[f'"{txt}"'], fill=PatternFill("solid", fgColor=color)))
    KPI_N = len(kp)

    # ============================================================ شیت‌های خروجی (جدول تخت برای Power BI)
    def out_sheet(name: str, cols: list, n_rows: int, fn, fmts: list) -> None:
        ws = wb.create_sheet(name)
        ws.sheet_view.rightToLeft = True
        ws.sheet_properties.tabColor = "70AD47"
        for j, c in enumerate(cols):
            cell = ws.cell(row=1, column=1 + j, value=c)
            cell.font, cell.fill = F_HEAD, PatternFill("solid", fgColor="548235")
            ws.column_dimensions[CL(1 + j)].width = max(10, min(22, len(c) + 4))
        for n in range(n_rows):
            r = 2 + n
            for j, v in enumerate(fn(n, r)):
                c = ws.cell(row=r, column=1 + j, value=v)
                c.font = F_BASE
                if j < len(fmts) and fmts[j]:
                    c.number_format = fmts[j]
        ws.freeze_panes = "A2"

    def blk(sheet, key, n_cols):
        r0, c0 = B.blocks[(sheet, key)]
        return f"{q(sheet)}${CL(c0)}${r0}:${CL(c0 + n_cols - 1)}${r0 + NP - 1}"

    pm_cols = ["ProductIdx", "MonthNo", "CompanyCode", "ProductCode", "ProductName", "Family", "ABC", "Period", "MonthLabel",
               "StatForecast", "StatLo80", "StatHi80", "Consensus", "ConsensusTons", "ConsensusValue", "BudgetQty", "BudgetValue", "LastYearQty",
               "SafetyStock", "Production", "OvertimeUnits", "InventoryEnd", "Shortage", "Sold", "Revenue", "COGS", "GrossProfit"]
    src = [blk(C2, "st", T), blk(C2, "lo", T), blk(C2, "hi", T), blk(C3, "cons", T), blk(C3, "tons", T), blk(C3, "val", T),
           blk(C3, "bud", T), f'{q(S_BUD)}$C${B.blocks[(S_BUD, "r")][0]}:${CL(2 + T)}${B.blocks[(S_BUD, "r")][0] + NP - 1}', blk(C3, "ly", T),
           blk(C5, "ss", T), blk(C5, "prod", T), blk(C5, "otu", T), blk(C5, "end", T), blk(C5, "short", T), blk(C9, "sold", T), blk(C9, "rev", T), blk(C9, "cogs", T)]

    def pm_row(n, r):
        i0 = f"$A{r}"
        guard = f'IF($D{r}="","",'
        out = [n // T + 1, n % T + 1, "=CompanyCode",
               f'=INDEX({rng(S_PROD, "A", P0, "A", LAST_P)},$A{r})&""', f'={guard}INDEX({rng(S_PROD, "B", P0, "B", LAST_P)},$A{r}))',
               f'={guard}INDEX({rng(S_PROD, "C", P0, "C", LAST_P)},$A{r}))', f'={guard}INDEX({rng(C1, "M", P0, "M", LAST_P)},$A{r}))',
               f'={guard}INDEX({rng(S_CAL, "C", 5, "C", 4 + H + T)},{H}+$B{r}))', f'={guard}INDEX({rng(S_CAL, "D", 5, "D", 4 + H + T)},{H}+$B{r}))']
        for s in src:
            out.append(f"={guard}N(INDEX({s},{i0},$B{r})))")
        out.append(f'={guard}Y{r}-Z{r})')
        return out
    out_sheet(O_PM, pm_cols, NP * T, pm_row, [None] * 7 + ["0"] + [None] + [FMT_Q] * 18)

    def hist_row(n, r):
        guard = f'IF($D{r}="","",'
        return [n // H + 1, n % H + 1, "=CompanyCode", f'=INDEX({rng(S_PROD, "A", P0, "A", LAST_P)},$A{r})&""',
                f'={guard}INDEX({rng(S_PROD, "B", P0, "B", LAST_P)},$A{r}))', f'={guard}INDEX({rng(S_PROD, "C", P0, "C", LAST_P)},$A{r}))',
                f'={guard}INDEX({rng(S_CAL, "C", 5, "C", 4 + H)},$B{r}))', f'={guard}INDEX({rng(S_CAL, "D", 5, "D", 4 + H)},$B{r}))',
                f'={guard}N(INDEX({q(S_SQ)}$C${B.blocks[(S_SQ, "q")][0]}:${CL(2 + H)}${B.blocks[(S_SQ, "q")][0] + NP - 1},$A{r},$B{r})))',
                f'={guard}N(INDEX({q(S_SR)}$C${B.blocks[(S_SR, "r")][0]}:${CL(2 + H)}${B.blocks[(S_SR, "r")][0] + NP - 1},$A{r},$B{r})))',
                f'={guard}INDEX({blk(C2, "fh", H)},$A{r},$B{r}))', f'={guard}INDEX({blk(C2, "cl", H)},$A{r},$B{r}))']
    out_sheet(O_HIST, ["ProductIdx", "MonthNo", "CompanyCode", "ProductCode", "ProductName", "Family", "Period", "MonthLabel", "SalesQty", "SalesValue",
                       "EventFactor", "SalesCleaned"], NP * H, hist_row, [None] * 6 + ["0", None, FMT_Q, FMT_M, "0.000", FMT_Q])

    def acc_row(n, r):
        guard = f'IF($D{r}="","",'
        return [n // NACC + 1, n % NACC + 1, "=CompanyCode", f'=INDEX({rng(S_PROD, "A", P0, "A", LAST_P)},$A{r})&""',
                f'={guard}INDEX({rng(S_PROD, "B", P0, "B", LAST_P)},$A{r}))',
                f'={guard}INDEX({rng(S_CAL, "C", 5, "C", 4 + H)},{A0 - 1}+$B{r}))', f'={guard}INDEX({rng(S_CAL, "D", 5, "D", 4 + H)},{A0 - 1}+$B{r}))',
                f'={guard}INDEX({blk(C4, "f", NACC)},$A{r},$B{r}))', f'={guard}INDEX({blk(C4, "a", NACC)},$A{r},$B{r}))',
                f'={guard}INDEX({blk(C4, "ae", NACC)},$A{r},$B{r}))', f'={guard}INDEX({blk(C4, "nae", NACC)},$A{r},$B{r}))']
    out_sheet(O_ACC, ["ProductIdx", "MonthNo", "CompanyCode", "ProductCode", "ProductName", "Period", "MonthLabel", "ForecastLag1", "Actual",
                      "AbsError", "NaiveAbsError"], NP * NACC, acc_row, [None] * 5 + ["0", None, FMT_Q, FMT_Q, FMT_Q, FMT_Q])

    def lblk(key):
        r0, c0 = B.blocks[(C6, key)]
        return f"{q(C6)}${CL(c0)}${r0}:${CL(c0 + T - 1)}${r0 + NL - 1}"

    def line_row(n, r):
        guard = f'IF($D{r}="","",'
        return [n // T + 1, n % T + 1, "=CompanyCode", f'=INDEX({rng(C6, "A", L0, "A", LAST_L)},$A{r})&""', f'={guard}INDEX({rng(C6, "B", L0, "B", LAST_L)},$A{r}))',
                f'={guard}INDEX({rng(S_CAL, "C", 5, "C", 4 + H + T)},{H}+$B{r}))', f'={guard}INDEX({rng(S_CAL, "D", 5, "D", 4 + H + T)},{H}+$B{r}))',
                f'={guard}INDEX({rng(C6, "C", L0, "C", LAST_L)},$A{r}))', f'={guard}INDEX({lblk("load")},$A{r},$B{r}))',
                f'={guard}INDEX({lblk("oth")},$A{r},$B{r}))', f'={guard}INDEX({lblk("util")},$A{r},$B{r}))', f'={guard}INDEX({lblk("rccp")},$A{r},$B{r}))']
    out_sheet(O_LINE, ["LineIdx", "MonthNo", "CompanyCode", "LineCode", "LineName", "Period", "MonthLabel", "CapacityHours", "LoadHours", "OvertimeHours",
                       "Utilization", "RCCPUtilization"], NL * T, line_row, [None] * 5 + ["0", None, FMT_Q, FMT_D, FMT_D, FMT_P, FMT_P])

    def mblk(key):
        r0, c0 = B.blocks[(C8, key)]
        return f"{q(C8)}${CL(c0)}${r0}:${CL(c0 + T - 1)}${r0 + NMAT - 1}"

    def mat_row(n, r):
        guard = f'IF($D{r}="","",'
        out = [n // T + 1, n % T + 1, "=CompanyCode", f'=INDEX({rng(C8, "A", M0, "A", LAST_M)},$A{r})&""', f'={guard}INDEX({rng(C8, "B", M0, "B", LAST_M)},$A{r}))',
               f'={guard}INDEX({rng(S_CAL, "C", 5, "C", 4 + H + T)},{H}+$B{r}))', f'={guard}INDEX({rng(S_CAL, "D", 5, "D", 4 + H + T)},{H}+$B{r}))']
        for key in ("gross", "rec", "rel", "proj"):
            out.append(f'={guard}INDEX({mblk(key)},$A{r},$B{r}))')
        out += [f'={guard}INDEX({rng(C8, "H", M0, "H", LAST_M)},$A{r}))', f'={guard}INDEX({rng(C8, "N", M0, "N", LAST_M)},$A{r}))']
        return out
    out_sheet(O_MAT, ["MaterialIdx", "MonthNo", "CompanyCode", "MaterialCode", "MaterialName", "Period", "MonthLabel", "GrossRequirement",
                      "PlannedReceipt", "PlannedRelease", "ProjectedStock", "SafetyStock", "SupplierCompany"], NMAT * T, mat_row,
              [None] * 5 + ["0", None, FMT_Q, FMT_Q, FMT_Q, FMT_Q, FMT_Q, None])

    fin_keys = ["rev", "cogs", "gross", "otc", "hold", "op", "lost", "tons", "bud", "revb", "ar", "pur", "ap", "invf", "invm", "nwc"]
    fin_names = ["Revenue", "COGS", "GrossProfit", "OvertimeCost", "HoldingCost", "OperatingProfit", "LostSales", "SoldTons", "BudgetRevenue",
                 "RevenueInBudgetMonths", "Receivables", "Purchases", "Payables", "InventoryFinished", "InventoryMaterials", "NetWorkingCapital"]
    out_sheet(O_FIN, ["MonthNo", "CompanyCode", "Period", "MonthLabel"] + fin_names, T,
              lambda n, r: [n + 1, "=CompanyCode", f'=INDEX({rng(S_CAL, "C", 5, "C", 4 + H + T)},{H}+$A{r})', f'=INDEX({rng(S_CAL, "D", 5, "D", 4 + H + T)},{H}+$A{r})']
              + [f"={q(C9)}{CL(2 + n + 1)}{FIN['PLR'][k]}" for k in fin_keys], [None, None, "0", None] + [FMT_M] * 16)

    pf_names = ["ProductCode", "ProductName", "Family", "Lifecycle", "Revenue12M", "Cost12M", "Margin", "Qty12M", "QtyPrev12M", "VolumeGrowth", "Share",
                "CumShareBefore", "ABC", "MeanMonthly", "StdDev", "CV", "XYZ", "MonthsWithSales", "ADI", "CV2", "DemandPattern", "Recommendation"]
    out_sheet(O_PF, ["CompanyCode"] + pf_names, NP,
              lambda n, r: ["=CompanyCode"] + [f"={q(C1)}{CL(1 + j)}{P0 + n}" for j in range(len(pf_names))],
              [None] * 5 + [FMT_M, FMT_M, FMT_P, FMT_Q, FMT_Q, FMT_P, FMT_P, FMT_P, None, FMT_Q, FMT_Q, "0.00", None, "0", "0.00", "0.00", None, None])
    out_sheet(O_KPI, ["CompanyCode", "KPI", "Value", "Target", "Status"], KPI_N,
              lambda n, r: ["=CompanyCode", f"={q(C10)}A{5 + n}", f"={q(C10)}B{5 + n}", f'=IF({q(C10)}C{5 + n}="","",{q(C10)}C{5 + n})', f'={q(C10)}D{5 + n}&""'],
              [None, None, "#,##0.0000", "#,##0.0000", None])

    # ============================================================ راهنما
    g = wb[S_GUIDE]
    g.column_dimensions["A"].width = 6
    g.column_dimensions["B"].width = 26
    g.column_dimensions["C"].width = 60
    g.column_dimensions["D"].width = 44
    g.column_dimensions["E"].width = 36
    g.merge_cells("A2:E2")
    g["A2"] = ("این فایل همه مراحل IBP برنامه را با فرمول اکسل نشان می‌دهد. داده خود را در شیت‌های زرد (ورودی_…) بگذارید؛ شیت‌های آبی مرحله به مرحله محاسبه می‌کنند؛ "
               "شیت‌های سبز (خروجی_…) جدول‌های تخت آماده برای Power BI هستند. بالای هر بلوک محاسبه، فرمول آن به زبان ساده نوشته شده است.")
    r = 4
    g.cell(row=r, column=1, value="الف) رنگ‌ها").font = F_BLOCK
    legend = [("زرد", "ورودی؛ فقط این خانه‌ها را تغییر دهید (عدد آبی روی زمینه زرد)", FILL_INPUT), ("آبی تیره", "سرستون", FILL_HEAD),
              ("آبی روشن", "عنوان بلوک محاسبه + فرمول به زبان ساده زیر آن", FILL_BLOCK)]
    for n, (a, b, fill) in enumerate(legend):
        c = g.cell(row=r + 1 + n, column=2, value=a)
        c.fill, c.font = fill, (F_HEAD if fill is FILL_HEAD else F_BOLD)
        g.cell(row=r + 1 + n, column=3, value=b).font = F_BASE
    r += 6
    g.cell(row=r, column=1, value="ب) مراحل به ترتیب اجرا").font = F_BLOCK
    head(g, r + 1, 1, ["#", "شیت", "چه کار می‌کند (ساده)", "ورودی‌ها", "خروجی (برای مرحله بعد)"])
    steps = [
        ("۰", "ورودی_… (زرد)", "تنظیمات، محصولات، خطوط، خانواده و اثر مناسبت، تقویم، فروش ۲۴ ماه (مقدار و مبلغ)، تعدیل اجماع، بودجه، پیش‌بینی ماه قبل، مواد و BOM", "داده شرکت", "—"),
        ("۱", C1, "فروش ۱۲ ماه هر محصول، حاشیه، رشد؛ کلاس ABC (پارتو فروش)، XYZ (نوسان)، الگوی تقاضا و توصیه پورتفوی؛ اولویت ظرفیت محصولات", "فروش، قیمت، بها", "ABC و اولویت (برای مرحله ۵)"),
        ("۲", C2, "حذف اثر مناسبت از فروش، شاخص فصلی، آزمون ۵ روش روی ۱۲ ماه اخیر، انتخاب کم‌خطاترین، پیش‌بینی ۱۲ ماه و بازه ۸۰٪", "فروش، تقویم و مناسبت", "پیش‌بینی آماری + خطای نسبی (برای ذخیره اطمینان)"),
        ("۳", C3, "پیش‌بینی اجماعی = آماری + تعدیل جلسه تقاضا؛ تن و مبلغ؛ مقایسه با سال قبل و بودجه؛ ریسک خارج از بازه آماری", "آماری، تعدیل، بودجه", "تقاضای اجماعی (مبنای تولید و مالی)"),
        ("۴", C4, "دقت و سوگیری پیش‌بینی ماه‌های گذشته، مقایسه با روش ساده (FVA)، سیگنال ردیابی", "پیش‌بینی ماه قبل، فروش", "دقت ۳ ماه، محصولات سوگیر"),
        ("۵", C5, "ذخیره اطمینان، نیاز تولید، تخصیص ظرفیت عادی و اضافه‌کاری به ترتیب اولویت، موجودی پایان ماه و کمبود، پوشش موجودی", "اجماعی، ظرفیت خطوط", "تولید، موجودی، کمبود"),
        ("۶", C6, "ظرفیت هر خط، ساعت بار برنامه، بهره‌برداری، اضافه‌کاری، RCCP و وضعیت خط", "خطوط، برنامه تولید", "بهره‌برداری، هشدار ظرفیت"),
        ("۷", C7, "نیاز ماهانه هر ردیف BOM از روی تولید، و بهای مواد هر محصول به تفکیک منشأ", "BOM، مواد، تولید", "نیاز مواد، بهای مواد"),
        ("۸", C8, "MRP: نیاز ناخالص، ذخیره اطمینان، سفارش با MOQ، تاریخ صدور سفارش با زمان تأمین، درخواست درون‌گروهی", "نیاز مواد، موجودی و سفارش در راه", "سفارش خرید، موجودی مواد"),
        ("۹", C9, "بهای تمام‌شده واحد، درآمد، بهای فروش، سود ناخالص و عملیاتی، فروش ازدست‌رفته، بودجه و پل بودجه، مطالبات، بدهی، سرمایه در گردش، سناریوی What-if", "تولید، کمبود، موجودی، MRP، تنظیمات", "سود و زیان ماهانه"),
        ("۱۰", C10, "شاخص‌های اصلی، هدف و وضعیت (خوب/هشدار/بحرانی) برای جلسه مدیریت", "همه مراحل", "کارنامه"),
        ("—", "خروجی_… (سبز)", "جدول‌های تخت (هر ردیف یک محصول×ماه یا خط×ماه یا ماده×ماه) فقط با ارجاع به مراحل بالا؛ Power BI فقط این‌ها را می‌خواند", "مراحل ۱ تا ۱۰", "Power BI"),
    ]
    for n, s_ in enumerate(steps):
        for j, v in enumerate(s_):
            put(g, r + 2 + n, 1 + j, v, bold=(j == 1))
    r += 3 + len(steps) + 1
    g.cell(row=r, column=1, value="ج) کار برنامه‌نویس، قدم به قدم").font = F_BLOCK
    todo = [
        "۱. هر شیت آبی را از بالا به پایین بخوانید: جدول بالای شیت خلاصه هر محصول است و بلوک‌های زیر آن محاسبه ماه‌به‌ماه. فرمول هر بلوک در سطر زیر عنوانش به فارسی آمده و فرمول اکسل در خانه‌ها قابل دیدن است.",
        "۲. ترتیب محاسبه همان شماره شیت‌هاست (م۱ تا م۱۰؛ م = مرحله). هر مرحله فقط از ورودی‌ها و مراحل قبل استفاده می‌کند.",
        "۳. نکته مهم مرحله ۵: موجودی پایان هر ماه، موجودی اول ماه بعد است؛ پس محاسبه ماه به ماه و به ترتیب انجام می‌شود. در هر ماه، ظرفیت هر خط به ترتیب «اولویت ظرفیت» (ستون D) بین محصولات آن خط تقسیم می‌شود: هر محصول آن‌چه از ظرفیت بعد از محصولات بالاتر مانده را می‌گیرد.",
        "۴. نکته مهم مرحله ۸: موجودی ماده هم ماه به ماه زنجیره‌ای است؛ هر وقت موجودی از ذخیره اطمینان کمتر شد سفارش ثبت می‌شود و تاریخ صدورش به اندازه زمان تأمین جلوتر است.",
        "۵. برای داده واقعی: فقط شیت‌های زرد را پر کنید (همان ستون‌ها و همان ترتیب محصولات در همه شیت‌های ماهانه). ظرفیت فایل: ۶۰ محصول، ۱۵ خط، ۴۰ ماده، ۴۰۰ ردیف BOM، ۱۵ خانواده. برای بیشتر، ردیف‌ها را با کپی فرمول‌ها اضافه کنید.",
        "۶. هر ماه: «ماه چرخه» را در تنظیمات یک ماه جلو ببرید، فروش ماه تمام‌شده و پیش‌بینی ثبت‌شده آن را وارد کنید، تعدیل‌های جلسه تقاضا را وارد کنید؛ همه چیز خودکار محاسبه می‌شود.",
        "۷. برای هر شرکت یک فایل با همین قالب بسازید (کد شرکت در تنظیمات). همه خروجی‌ها ستون CompanyCode دارند.",
    ]
    for n, t in enumerate(todo):
        c = g.cell(row=r + 1 + n, column=1, value=t)
        c.font, c.alignment = F_BASE, Alignment(horizontal="right", vertical="top", wrap_text=True)
        g.merge_cells(start_row=r + 1 + n, start_column=1, end_row=r + 1 + n, end_column=5)
        g.row_dimensions[r + 1 + n].height = 34
    r += len(todo) + 2
    g.cell(row=r, column=1, value="د) Power BI فقط برای نمایش").font = F_BLOCK
    pbi = [
        "۱. Get Data ← Folder: پوشه‌ای که فایل اکسل همه شرکت‌ها در آن است؛ Combine Files و از هر فایل شیت‌های «خروجی_…» را بخوانید (هر شیت یک جدول؛ ردیف اول سرستون است).",
        "۲. در Power Query ردیف‌های خالی را حذف کنید: ProductCode (یا LineCode / MaterialCode) خالی نباشد. نوع ستون‌ها را عدد کنید.",
        "۳. جدول‌ها: خروجی_محصول_ماه (برنامه)، خروجی_فروش_گذشته (روند فروش)، خروجی_دقت، خروجی_خط_ماه (ظرفیت)، خروجی_ماده_ماه (MRP)، خروجی_مالی_ماه (سود و زیان)، خروجی_پورتفوی، خروجی_KPI.",
        "۴. رابطه‌ها: جدول کمکی محصول (CompanyCode + ProductCode از خروجی_پورتفوی) به محصول_ماه، فروش_گذشته و دقت؛ جدول ماه (Period، MonthLabel) به همه جدول‌های ماهانه؛ جدول شرکت (CompanyCode) به همه. ماه‌ها را با Period مرتب کنید (Sort by column).",
        "۵. اندازه‌ها فقط جمع و نسبت ساده‌اند (SUM، DIVIDE)؛ همه منطق در اکسل است. مثال: دقت = 1 − SUM(AbsError) ÷ SUM(Actual) ؛ نرخ پاسخ‌گویی = 1 − SUM(Shortage) ÷ SUM(Consensus) ؛ بهره‌برداری = SUM(LoadHours) ÷ SUM(CapacityHours).",
        "۶. صفحات پیشنهادی: داشبورد (کارت‌های خروجی_KPI با رنگ وضعیت)، پورتفوی (ماتریس ABC×XYZ و جدول توصیه)، پیش‌بینی (روند فروش گذشته + آماری و اجماعی با بازه)، دقت، برنامه تولید (ماتریس محصول×ماه)، ظرفیت (نقشه حرارتی خط×ماه)، مواد، مالی (سود و زیان ماهانه و پل بودجه)، جلسه مدیریت.",
        "۷. بعد از تغییر اکسل: فایل را ذخیره کنید (محاسبه خودکار اکسل روشن باشد) و در Power BI دکمه Refresh را بزنید.",
    ]
    for n, t in enumerate(pbi):
        c = g.cell(row=r + 1 + n, column=1, value=t)
        c.font, c.alignment = F_BASE, Alignment(horizontal="right", vertical="top", wrap_text=True)
        g.merge_cells(start_row=r + 1 + n, start_column=1, end_row=r + 1 + n, end_column=5)
        g.row_dimensions[r + 1 + n].height = 34
    r += len(pbi) + 2
    g.cell(row=r, column=1, value="هـ) ساده‌سازی‌ها نسبت به برنامه IBP").font = F_BLOCK
    simp = [
        "پیش‌بینی آماری: ۵ روش ساده و شفاف به‌جای ۱۹ روش موتور برنامه (هولت-وینترز، ARIMA، یادگیری ماشین و …)؛ منطق انتخاب (آزمون روی ۱۲ ماه اخیر و کمترین WMAPE) همان است.",
        "برنامه تولید: هر محصول یک خط اصلی دارد؛ خط جایگزین و «پیش‌ساخت» (تولید زودتر در ماه‌های قبل برای ماه‌های پرتقاضا) در این فایل نیست. افق ۱۲ ماه است (برنامه ۱۸ ماه).",
        "بازه ۸۰٪ پیش‌بینی با یک خطای نسبی ثابت برای همه افق‌ها محاسبه می‌شود؛ دوره وصول و تخفیف میانگین به‌صورت عدد در تنظیمات وارد می‌شوند.",
        "مقادیر نمونه این فایل داده شرکت " + code + " در برنامه IBP است و فقط برای نشان دادن قالب است.",
    ]
    for n, t in enumerate(simp):
        c = g.cell(row=r + 1 + n, column=1, value="• " + t)
        c.font, c.alignment = F_BASE, Alignment(horizontal="right", vertical="top", wrap_text=True)
        g.merge_cells(start_row=r + 1 + n, start_column=1, end_row=r + 1 + n, end_column=5)
        g.row_dimensions[r + 1 + n].height = 30
    g.sheet_view.rightToLeft = True

    for ws in wb.worksheets:
        ws.sheet_view.zoomScale = 90
    order = [S_GUIDE, S_SET, S_PROD, S_LINE, S_FAM, S_CAL, S_SQ, S_SR, S_ADJ, S_BUD, S_PF, S_MAT, S_BOM, C1, C2, C3, C4, C5, C6, C7, C8, C9, C10,
             O_PM, O_HIST, O_ACC, O_LINE, O_MAT, O_FIN, O_PF, O_KPI]
    wb._sheets = [wb[n] for n in order]
    wb.active = 0
    wb.calculation.fullCalcOnLoad = True
    wb.save(out)
    print("→", out)


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2], sys.argv[3])

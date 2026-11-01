"""خروجی CSV ورودی‌های Power BI از داده واقعی برنامه IBP (همان ستون‌های پوشه نمونه).

دو منبع:
  python export_data.py --db  <پوشه یا فایل ibp.db سرور مرکزی>  <پوشه خروجی>
  python export_data.py --backup <فایل «پشتیبان کامل هلدینگ» .json>  <پوشه خروجی>

خروجی: یک CSV برای هر جدول (همه شرکت‌ها با ستون CompanyCode)، settings.csv، companies.csv
و calendar_lunar.csv (تقویم ثابت ماه‌های شمسی با روزهای رمضان و دهه محرم؛ از کنار همین اسکریپت کپی می‌شود).
برای سرور در حال کار هم امن است (فقط خواندن؛ SQLite در حالت WAL).
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
CALENDAR = HERE.parent / "data" / "calendar_lunar.csv"
# ستون‌های هر جدول از تعریف جدول‌ها در برنامه (app/js/core/schema.js)؛ جدول خالی هم با سرستون نوشته می‌شود
SCHEMA = json.loads((HERE / "schema_columns.json").read_text(encoding="utf-8"))


def from_db(path: Path) -> list[dict[str, Any]]:
    db_file = path / "ibp.db" if path.is_dir() else path
    if not db_file.exists():
        sys.exit(f"پایگاه داده پیدا نشد: {db_file}")
    db = sqlite3.connect(f"file:{db_file}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    out = []
    for c in db.execute("SELECT code, info FROM companies ORDER BY code"):
        info = json.loads(c["info"] or "{}")
        records: dict[str, list[Any]] = {}
        for x in db.execute("SELECT entity, data FROM records WHERE company=? AND deleted=0", (c["code"],)):
            records.setdefault(x["entity"], []).append(json.loads(x["data"]))
        meta = {x["key"]: json.loads(x["value"]) for x in db.execute("SELECT key, value FROM meta WHERE company=?", (c["code"],))}
        out.append({"info": {**info, "code": c["code"]}, "meta": meta, "data": records})
    db.close()
    return out


def from_backup(path: Path) -> list[dict[str, Any]]:
    obj = json.loads(path.read_text(encoding="utf-8"))
    if obj.get("kind") != "holding" or not isinstance(obj.get("companies"), list):
        sys.exit("این فایل «پشتیبان کامل هلدینگ» نیست")
    return obj["companies"]


def cell(v: Any) -> Any:
    if v is None:
        return ""
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return v


def write(out: Path, name: str, rows: list[dict[str, Any]], base: list[str] | None = None) -> None:
    cols: list[str] = list(base or [])
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    with open(out / f"{name}.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, lineterminator="\r\n")
        w.writerow(cols)
        for r in rows:
            w.writerow([cell(r.get(c)) for c in cols])


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(description="Export IBP data to CSV for Power BI")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--db", help="central server data folder (with ibp.db) or the ibp.db file")
    src.add_argument("--backup", help="full holding backup JSON exported from the app")
    ap.add_argument("out", help="output folder (DataFolder parameter in Power BI)")
    a = ap.parse_args(argv)
    companies = from_db(Path(a.db)) if a.db else from_backup(Path(a.backup))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    tables: dict[str, list[dict[str, Any]]] = {}
    settings, cos = [], []
    for c in companies:
        code = str((c.get("info") or {}).get("code") or "").strip().upper()
        if not code:
            continue
        info, meta = c.get("info") or {}, c.get("meta") or {}
        st = meta.get("settings") or {}
        if not st.get("cyclePeriod"):
            print(f"هشدار: ماه چرخه (cyclePeriod) برای {code} تنظیم نشده است", file=sys.stderr)
        cos.append({"CompanyCode": code, "CompanyName": info.get("name") or st.get("companyName") or code,
                    "BusinessModel": info.get("model") or st.get("businessModel") or "", "TemplateId": info.get("templateId") or ""})
        settings += [{"CompanyCode": code, "key": k, "value": v} for k, v in st.items() if not isinstance(v, (dict, list))]
        for ent, rows in (c.get("data") or {}).items():
            tables.setdefault(ent, []).extend({"CompanyCode": code, **r} for r in rows if isinstance(r, dict))
    for ent in list(SCHEMA) + [e for e in tables if e not in SCHEMA]:
        write(out, ent, tables.get(ent, []), ["CompanyCode"] + SCHEMA.get(ent, []))
    write(out, "settings", settings)
    write(out, "companies", cos)
    if CALENDAR.exists():
        shutil.copyfile(CALENDAR, out / "calendar_lunar.csv")
    else:
        print("هشدار: calendar_lunar.csv کنار بسته پیدا نشد", file=sys.stderr)
    print(f"{len(cos)} شرکت، {len(tables)} جدول ← {out}")


if __name__ == "__main__":
    main(sys.argv[1:])

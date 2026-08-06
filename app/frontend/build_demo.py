# -*- coding: utf-8 -*-
"""
ساخت دموی تک‌فایلی (artifact) سمت‌کاربر از روی همان داده‌ی بذرپاشی سرور واقعی.
خروجی یک HTML خودکفا (بدون وابستگی بیرونی) است که کل منطق (شرح خودکار، گیت
تکرار، عارضه‌یابی بانک فعلی، گردش تایید، دیتاشیت، کرالجیک) را در مرورگر
(localStorage) اجرا می‌کند — برای دمو/تست سریع، بدون نیاز به سرور.

اجرا:
    python3 build_demo.py
خروجی: app/frontend/dist/material-coding-demo.html
"""
import json
import os
import sys

FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(os.path.dirname(FRONTEND_DIR), "backend")
sys.path.insert(0, BACKEND_DIR)

import seed  # noqa: E402
import cleanup_engine as ce  # noqa: E402
import sample_data  # noqa: E402


def build():
    seed_data = {
        "groups": [{"prefix": p, "name": n} for p, n in seed.GROUPS],
        "plants": [{"code": c, "name": n} for c, n in seed.PLANTS],
        "units": [{"name": n, "symbol": s} for n, s in seed.UNITS],
        "users": [{"name": n, "role": r} for n, r in seed.USERS],
        "other_value": seed.OTHER_VALUE,
        "templates": seed.TEMPLATES,
        "group_mapping": ce.GROUP_MAPPING,
    }
    seed_json = json.dumps(seed_data, ensure_ascii=False)

    df = sample_data.build_sample_dataframe()
    legacy_json = json.dumps(df.to_dict(orient="records"), ensure_ascii=False)

    with open(os.path.join(FRONTEND_DIR, "artifact_shell.html"), encoding="utf-8") as f:
        shell = f.read()
    with open(os.path.join(FRONTEND_DIR, "artifact_app.js"), encoding="utf-8") as f:
        app_js = f.read()

    out = (
        shell.replace("__SEED_JSON__", seed_json)
        .replace("__LEGACY_JSON__", legacy_json)
        .replace("__APP_JS__", app_js)
    )

    out_dir = os.path.join(FRONTEND_DIR, "dist")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "material-coding-demo.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"نوشته شد: {out_path} ({len(out):,} بایت)")


if __name__ == "__main__":
    build()

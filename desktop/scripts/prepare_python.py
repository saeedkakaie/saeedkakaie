"""آماده‌سازی پایتون مستقل ویندوز برای نسخه نصبی (بدون نیاز به نصب پایتون روی رایانه کاربر).

۱) بسته رسمی پایتون ویندوز (NuGet «python»، x64) دریافت و پوشه tools آن در build/python باز می‌شود
۲) بسته‌های موتور (requirements-win.txt) به‌صورت چرخ‌های آماده win_amd64 در build/python/Lib/site-packages نصب می‌شوند
   — این مرحله روی هر سیستم‌عاملی (حتی لینوکس) قابل اجراست چون فقط فایل‌های آماده ویندوز دانلود می‌شوند
۳) پوشه‌های آزمون و کش حذف می‌شوند تا حجم نصب کم شود

اجرا: python scripts/prepare_python.py  (اگر نسخه و فهرست بسته‌ها تغییر نکرده باشد کاری انجام نمی‌شود)
"""
from __future__ import annotations

import hashlib
import io
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

PY_VERSION = "3.12.10"
PY_TAG = "312"
NUGET = f"https://api.nuget.org/v3-flatcontainer/python/{PY_VERSION}/python.{PY_VERSION}.nupkg"

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build" / "python"
REQ = ROOT / "requirements-win.txt"
STAMP = OUT / ".ibp-stamp"


def stamp_value() -> str:
    return hashlib.sha256((PY_VERSION + "\n" + REQ.read_text(encoding="utf-8")).encode()).hexdigest()


def download_runtime() -> None:
    print("دریافت پایتون", PY_VERSION, "از", NUGET, flush=True)
    with urllib.request.urlopen(NUGET, timeout=300) as r:
        data = r.read()
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            if not name.startswith("tools/") or name.endswith("/"):
                continue
            rel = name[len("tools/"):]
            dest = OUT / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            with z.open(name) as src, open(dest, "wb") as f:
                shutil.copyfileobj(src, f)
    if not (OUT / "python.exe").exists():
        sys.exit("python.exe در بسته پیدا نشد")


def install_packages() -> None:
    site = OUT / "Lib" / "site-packages"
    site.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-compile",
           "--target", str(site), "--platform", "win_amd64", "--python-version", PY_TAG,
           "--implementation", "cp", "--abi", "cp" + PY_TAG, "--only-binary=:all:", "--upgrade",
           "-r", str(REQ)]
    print("نصب بسته‌ها:", " ".join(cmd), flush=True)
    subprocess.check_call(cmd)


def slim() -> None:
    removed = 0
    for pattern in ("tests", "test", "__pycache__"):
        for d in list(OUT.rglob(pattern)):
            if not d.is_dir():
                continue
            parts = d.relative_to(OUT).parts
            # کتابخانه استاندارد test و پوشه‌های آزمون بسته‌ها برای اجرا لازم نیستند
            if pattern == "test" and parts[:2] != ("Lib", "test"):
                continue
            shutil.rmtree(d, ignore_errors=True)
            removed += 1
    # ابزارهای توسعه و نصب بسته (pip، فایل‌های سرآیند) برای اجرا لازم نیستند
    for sub in ("Lib/idlelib", "Lib/tkinter", "Lib/turtledemo", "Lib/ensurepip", "tcl", "include", "libs", "Scripts",
                "Lib/site-packages/pip", "Lib/lib2to3", "Lib/pydoc_data"):
        p = OUT / sub
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
            removed += 1
    print("پوشه‌های غیرضروری حذف شد:", removed)


def main() -> None:
    if STAMP.exists() and STAMP.read_text() == stamp_value() and (OUT / "python.exe").exists():
        slim()
        print("پایتون آماده است (بدون تغییر)")
        return
    download_runtime()
    install_packages()
    slim()
    STAMP.write_text(stamp_value())
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"پایتون مستقل آماده شد: {OUT} ({size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()

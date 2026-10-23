#!/usr/bin/env sh
# سرور مرکزی IBP: برنامه، کاربران و پایگاه داده مشترک روی درگاه 8765 برای همه رایانه‌های شبکه
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
exec .venv/bin/python run.py --server --host 0.0.0.0 --port 8765 "$@"

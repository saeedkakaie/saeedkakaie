@echo off
chcp 65001 > nul
rem سرور مرکزی IBP: برنامه، کاربران و پایگاه داده مشترک روی درگاه 8765 برای همه رایانه‌های شبکه
cd /d "%~dp0"
if not exist .venv (
  python -m venv .venv
)
.venv\Scripts\python -m pip install -q -r requirements.txt
.venv\Scripts\python run.py --server --host 0.0.0.0 --port 8765 %*

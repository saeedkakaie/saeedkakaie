@echo off
chcp 65001 > nul
cd /d "%~dp0"
if not exist .venv (
  echo ساخت محیط پایتون...
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
.venv\Scripts\python run.py

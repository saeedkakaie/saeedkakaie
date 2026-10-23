#!/usr/bin/env sh
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
# نصب بسته‌های تازه نسخه‌های جدید (مثل anthropic برای دستیار هوشمند)
.venv/bin/pip install -q -r requirements.txt
exec .venv/bin/python run.py "$@"

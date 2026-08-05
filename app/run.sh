#!/usr/bin/env bash
# اجرای سامانه کدینگ استاندارد کالا
set -e
cd "$(dirname "$0")/backend"

if [ ! -f "../data/material_coding.db" ]; then
  echo "بذرپاشی داده‌ی اولیه..."
  python3 seed.py
fi

echo "اجرای سرور روی پورت ${PORT:-8000} ..."
exec python3 -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"

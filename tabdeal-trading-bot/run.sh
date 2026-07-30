#!/usr/bin/env bash
# اجرای داشبورد وب ربات. روی Termux، قبلش خودکار termux-wake-lock را هم
# فعال می‌کند تا اندروید وسط کار پردازش را نکشد. روی بقیه‌ی سیستم‌ها این
# بخش را رد می‌کند و فقط سرور را بالا می‌آورد.

set -e

if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock
    echo "termux-wake-lock فعال شد (جلوگیری از خواب رفتن گوشی)."
fi

cd "$(dirname "$0")"
exec python webapp/app.py

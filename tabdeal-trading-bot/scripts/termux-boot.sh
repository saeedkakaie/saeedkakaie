#!/data/data/com.termux/files/usr/bin/bash
# اسکریپت شروع کاملا خودکار ربات موقع روشن شدن گوشی.
#
# نصب:
#   1. اپ Termux:Boot را از F-Droid نصب کنید (همان توسعه‌دهنده‌ی Termux؛
#      از Google Play کار نمی‌کند چون Termux:Boot فقط با Termux از F-Droid
#      هماهنگ است) و یک‌بار بازش کنید تا اجازه‌ی اجرا بعد از بوت را بگیرد.
#   2. این فایل را به مسیر ~/.termux/boot/ کپی کنید و مسیر پروژه را در
#      متغیر PROJECT_DIR زیر اصلاح کنید:
#        mkdir -p ~/.termux/boot
#        cp scripts/termux-boot.sh ~/.termux/boot/start-tabdeal-bot.sh
#        chmod +x ~/.termux/boot/start-tabdeal-bot.sh
#   3. در فایل .env پروژه، AUTO_START=true را تنظیم کنید (وگرنه سرور بالا
#      می‌آید ولی معامله را خودش شروع نمی‌کند و باز هم باید دستی «شروع»
#      را در داشبورد بزنید).
#
# از این به بعد، با هر روشن شدن یا ری‌استارت گوشی، این اسکریپت خودکار
# اجرا می‌شود: قفل بیداری (wake-lock) را می‌گیرد، سرور داشبورد را بالا
# می‌آورد، و چون AUTO_START=true است، ربات هم بدون هیچ کلیکی شروع می‌کند.

PROJECT_DIR="$HOME/tabdeal-trading-bot"

sleep 15  # به اندروید فرصت بده شبکه/فایل‌سیستم را کامل آماده کند

termux-wake-lock

cd "$PROJECT_DIR" || exit 1
mkdir -p logs
nohup python webapp/app.py >> logs/boot.log 2>&1 &

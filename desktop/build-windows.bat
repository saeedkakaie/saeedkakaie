@echo off
chcp 65001 > nul
rem ساخت فایل نصب ویندوز روی همین رایانه (نیاز: Node.js 22 و Python 3.10+ و اینترنت برای بار اول)
cd /d "%~dp0"
call npm ci --no-audit --no-fund || exit /b 1
python scripts\prepare_python.py || exit /b 1
node scripts\build.js || exit /b 1
echo.
echo فایل نصب در پوشه dist ساخته شد.

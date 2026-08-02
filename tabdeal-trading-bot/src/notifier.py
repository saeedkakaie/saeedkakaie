import logging
import shutil
import subprocess

logger = logging.getLogger("tabdeal_bot")

_TERMUX_NOTIFICATION_BIN = "termux-notification"


def notify(title: str, message: str) -> None:
    """
    اعلان آندرویدی از طریق Termux:API (اگر نصب باشد) ارسال می‌کند تا کاربر
    برای رویدادهای مهم (توقف غیرمنتظره، فعال شدن مدار قطع ضرر، پوزیشنی که
    با تخمین محلی ثبت شده) نیازی به باز کردن دستی داشبورد نداشته باشد.

    کاملا best-effort است: اگر termux-notification در دسترس نباشد (مثلا
    Termux:API نصب نشده، یا این کد روی سیستم توسعه به‌جای گوشی اجرا
    می‌شود)، فقط در لاگ ثبت می‌کند و ساکت برمی‌گردد — نبود این قابلیت
    هرگز نباید خود ربات را متوقف کند.
    """
    if shutil.which(_TERMUX_NOTIFICATION_BIN) is None:
        logger.debug("termux-notification در دسترس نیست؛ اعلان رد شد: %s", title)
        return

    try:
        subprocess.run(
            [_TERMUX_NOTIFICATION_BIN, "--title", title, "--content", message],
            check=False,
            timeout=10,
        )
    except Exception:
        logger.exception("ارسال اعلان آندرویدی ممکن نشد.")

"""ساخت assets/css/fonts.css از فایل‌های woff2 (تعبیه فونت به‌صورت base64).

مرورگرها بارگذاری فونت از file:// را مسدود می‌کنند؛ با تعبیه فونت در CSS،
برنامه با باز کردن مستقیم index.html هم فونت فارسی را درست نمایش می‌دهد.
اجرا: python tools/embed_fonts.py
"""
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEIGHTS = [(400, "Regular"), (500, "Medium"), (700, "Bold")]

lines = [
    "/* فونت Vazirmatn (نسخه ارقام فارسی) به‌صورت تعبیه‌شده تا هنگام باز کردن مستقیم فایل HTML هم بارگذاری شود.",
    "   این فایل با tools/embed_fonts.py از روی assets/fonts ساخته می‌شود. مجوز: OFL (assets/fonts/OFL.txt) */",
]
for weight, name in WEIGHTS:
    data = base64.b64encode((ROOT / "assets" / "fonts" / f"Vazirmatn-FD-{name}.woff2").read_bytes()).decode()
    lines.append(
        "@font-face { font-family: 'Vazirmatn FD'; font-weight: %d; font-display: swap; "
        "src: url(data:font/woff2;base64,%s) format('woff2'); }" % (weight, data)
    )
(ROOT / "assets" / "css" / "fonts.css").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("assets/css/fonts.css written")

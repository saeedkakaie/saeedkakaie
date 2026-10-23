"""ساخت نماد برنامه (build/icon.ico و build/icon.png) از لوگوی گروه زر. یک‌بار اجرا و نتیجه در مخزن نگه داشته می‌شود.
اجرا: python scripts/make_icon.py   (نیاز به Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
logo = Image.open(ROOT.parent / "app" / "assets" / "img" / "zar-logo.png").convert("RGBA")

S = 1024
canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
# سایه نرم
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((70, 90, S - 70, S - 50), radius=200, fill=(20, 35, 80, 110))
canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(28)))
# کاشی سفید با حاشیه سرمه‌ای
tile = ImageDraw.Draw(canvas)
tile.rounded_rectangle((56, 56, S - 56, S - 56), radius=200, fill=(255, 255, 255, 255), outline=(27, 47, 107, 255), width=18)
# لوگو در مرکز
w = 820
h = round(logo.height * w / logo.width)
lg = logo.resize((w, h), Image.LANCZOS)
canvas.alpha_composite(lg, ((S - w) // 2, (S - h) // 2 + 6))

out = ROOT / "build"
out.mkdir(exist_ok=True)
canvas.resize((512, 512), Image.LANCZOS).save(out / "icon.png")
canvas.save(out / "icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])
print("icon written", out)

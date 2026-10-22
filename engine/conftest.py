"""افزودن پوشه موتور به مسیر import تا آزمون‌ها از هر پوشه‌ای اجرا شوند."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

"""اجرای موتور تحلیل.

  python run.py                         موتور محلی (فقط همین رایانه)
  python run.py --server --host 0.0.0.0 سرور مرکزی: برنامه، کاربران، پایگاه داده مشترک و موتور تحلیل
      --data پوشه داده (پیش‌فرض: پوشه data کنار engine)   --app پوشه برنامه (پیش‌فرض: ../app)
"""
import argparse
import multiprocessing
import os
from pathlib import Path

import uvicorn

from ibp_engine import __version__
from ibp_engine.app import app

if __name__ == "__main__":
    multiprocessing.freeze_support()  # برای نسخه بسته‌بندی‌شده ویندوز (پردازش موازی پیش‌بینی)
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="IBP analysis engine / central server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--server", action="store_true", help="central server mode (users, shared database)")
    parser.add_argument("--data", default=os.environ.get("IBP_DATA_DIR", str(here.parent / "data")))
    parser.add_argument("--app", default=str(here.parent / "app"))
    args = parser.parse_args()
    if args.server:
        from ibp_engine import server

        store = server.install(app, args.data, args.app, __version__)
        print(f"IBP server: http://{args.host}:{args.port}/  data: {Path(args.data).resolve()}", flush=True)
        if store.user_count() == 0:
            print(f"First run - setup code for the system administrator: {store.setup_token}", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

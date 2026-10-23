"""اجرای موتور تحلیل: python run.py [--host 127.0.0.1] [--port 8765]"""
import argparse
import multiprocessing

import uvicorn

from ibp_engine.app import app

if __name__ == "__main__":
    multiprocessing.freeze_support()  # برای نسخه بسته‌بندی‌شده ویندوز (پردازش موازی پیش‌بینی)
    parser = argparse.ArgumentParser(description="IBP analysis engine")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

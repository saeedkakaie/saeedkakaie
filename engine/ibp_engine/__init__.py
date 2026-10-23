"""موتور تحلیل پایتون Integrated Business Planning."""

__version__ = "0.9.0"

import os as _os

# ماتریس‌های این موتور کوچک‌اند؛ چندرشته‌ای BLAS فقط با پردازش موازی محصولات تداخل می‌کند
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    _os.environ.setdefault(_v, "1")

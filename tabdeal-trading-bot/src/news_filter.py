import logging
import re
import time
from typing import Dict, Optional, Tuple

import requests

logger = logging.getLogger("tabdeal_bot")

# CryptoCompare یک endpoint خبری عمومی دارد که بدون ثبت‌نام و بدون API Key
# کار می‌کند (فقط با محدودیت نرخ پایین‌تر). اگر بعدا کلید گرفتید، از طریق
# NEWS_API_KEY در .env سرعت/محدودیت بهتری می‌گیرید، ولی اجباری نیست.
NEWS_API_URL = "https://min-api.cryptocompare.com/data/v2/news/"

NEGATIVE_KEYWORDS = [
    "hack", "hacked", "exploit", "exploited", "scam", "rug pull", "rugpull",
    "ban", "banned", "lawsuit", "sec charges", "charged", "crash", "delist",
    "delisted", "investigation", "fraud", "outage", "vulnerability", "breach",
]
POSITIVE_KEYWORDS = [
    "partnership", "listing", "listed", "upgrade", "adoption", "surge",
    "rally", "integration", "launch", "approval", "approved", "record high",
    "funding", "acquisition",
]


def _contains_word(text: str, keyword: str) -> bool:
    """تطبیق با مرز کلمه، تا مثلا 'ban' داخل 'bank' اشتباهی مچ نشود."""
    return re.search(r"\b" + re.escape(keyword) + r"\b", text) is not None


class NewsFilter:
    """
    فیلتر سبک احساسات خبری با استفاده از API عمومی و رایگان CryptoCompare
    (بدون نیاز به ثبت‌نام)، به‌علاوه یک لایه‌ی کلیدواژه‌ای ساده روی عنوان
    خبرها (چون این سرویس، برخلاف CryptoPanic، رأی مثبت/منفی کاربران ندارد).

    اگر NEWS_ENABLED خاموش باشد یا درخواست شکست بخورد، همیشه خنثی (۰.۰)
    برمی‌گرداند تا نبود یا خطای این سرویس مانع کار ربات نشود.

    خروجی sentiment() عددی بین -1 (خبر بد) تا +1 (خبر خوب) است.
    """

    def __init__(self, enabled: bool, api_key: Optional[str] = None, cache_minutes: int = 30):
        self._enabled = bool(enabled)
        self.api_key = api_key
        self.cache_seconds = max(1, cache_minutes) * 60
        self._cache: Dict[str, Tuple[float, float]] = {}

    @property
    def enabled(self) -> bool:
        return self._enabled

    def sentiment(self, base_asset: str) -> float:
        if not self.enabled:
            return 0.0

        now = time.time()
        cached = self._cache.get(base_asset)
        if cached and now - cached[0] < self.cache_seconds:
            return cached[1]

        score = self._fetch_sentiment(base_asset)
        self._cache[base_asset] = (now, score)
        return score

    def _fetch_sentiment(self, base_asset: str) -> float:
        try:
            params = {"lang": "EN", "categories": base_asset}
            if self.api_key:
                params["api_key"] = self.api_key

            response = requests.get(NEWS_API_URL, params=params, timeout=10)
            response.raise_for_status()
            posts = response.json().get("Data", [])
        except Exception as exc:
            logger.warning(
                "خطا در دریافت اخبار برای %s (%s)، خبر خنثی در نظر گرفته می‌شود.", base_asset, exc
            )
            return 0.0

        return self._score_posts(posts)

    @staticmethod
    def _score_posts(posts: list) -> float:
        if not posts:
            return 0.0

        positive = 0
        negative = 0

        for post in posts[:20]:
            title = str(post.get("title", "")).lower()
            if any(_contains_word(title, keyword) for keyword in NEGATIVE_KEYWORDS):
                negative += 1
            if any(_contains_word(title, keyword) for keyword in POSITIVE_KEYWORDS):
                positive += 1

        total = positive + negative
        if total == 0:
            return 0.0

        return max(-1.0, min(1.0, (positive - negative) / total))

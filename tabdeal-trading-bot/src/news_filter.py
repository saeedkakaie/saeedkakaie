import logging
import time
from typing import Dict, Optional, Tuple

import requests

logger = logging.getLogger("tabdeal_bot")

CRYPTOPANIC_URL = "https://cryptopanic.com/api/v1/posts/"

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


class NewsFilter:
    """
    فیلتر سبک احساسات خبری با استفاده از API رایگان CryptoPanic، به‌علاوه
    یک لایه‌ی کلیدواژه‌ای ساده روی عنوان خبرها. اگر توکن تنظیم نشده باشد یا
    درخواست شکست بخورد، همیشه خنثی (۰.۰) برمی‌گرداند تا نبود این سرویس
    مانع کار ربات نشود.

    خروجی sentiment() عددی بین -1 (خبر بد) تا +1 (خبر خوب) است.
    """

    def __init__(self, api_token: Optional[str], cache_minutes: int = 30):
        self.api_token = api_token
        self.cache_seconds = max(1, cache_minutes) * 60
        self._cache: Dict[str, Tuple[float, float]] = {}

    @property
    def enabled(self) -> bool:
        return bool(self.api_token)

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
            response = requests.get(
                CRYPTOPANIC_URL,
                params={"auth_token": self.api_token, "currencies": base_asset, "public": "true"},
                timeout=10,
            )
            response.raise_for_status()
            posts = response.json().get("results", [])
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

        for post in posts:
            votes = post.get("votes") or {}
            positive += int(votes.get("positive", 0) or 0) + int(votes.get("liked", 0) or 0)
            negative += int(votes.get("negative", 0) or 0) + int(votes.get("disliked", 0) or 0)

            title = str(post.get("title", "")).lower()
            if any(keyword in title for keyword in NEGATIVE_KEYWORDS):
                negative += 1
            if any(keyword in title for keyword in POSITIVE_KEYWORDS):
                positive += 1

        total = positive + negative
        if total == 0:
            return 0.0

        return max(-1.0, min(1.0, (positive - negative) / total))

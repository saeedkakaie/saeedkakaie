import os
from dataclasses import dataclass

from dotenv import load_dotenv


class ConfigError(Exception):
    pass


@dataclass
class Config:
    api_key: str
    api_secret: str
    quote_asset: str
    watchlist_refresh_minutes: int
    quantity_precision: int
    trading_fee_percent: float
    stop_loss_percent: float
    take_profit_percent: float
    max_daily_loss_percent: float
    sma_fast_period: int
    sma_slow_period: int
    news_enabled: bool
    news_api_key: str
    news_cache_minutes: int
    poll_interval_seconds: int
    dry_run: bool
    log_level: str

    @staticmethod
    def load(env_path: str = None) -> "Config":
        # override=True چون این متد ممکن است چندین بار در طول عمر یک پردازش
        # طولانی (مثلا سرور Flask) صدا زده شود؛ بدون override، مقادیر بار
        # اول در os.environ می‌مانند و تغییرات بعدی .env دیده نمی‌شوند.
        load_dotenv(dotenv_path=env_path, override=True)

        api_key = os.getenv("TABDEAL_API_KEY", "")
        api_secret = os.getenv("TABDEAL_API_SECRET", "")
        dry_run = os.getenv("DRY_RUN", "true").strip().lower() != "false"

        if not dry_run and (not api_key or not api_secret):
            raise ConfigError(
                "TABDEAL_API_KEY و TABDEAL_API_SECRET باید تنظیم شوند وقتی DRY_RUN=false است."
            )

        try:
            return Config(
                api_key=api_key,
                api_secret=api_secret,
                quote_asset=os.getenv("QUOTE_ASSET", "IRT"),
                watchlist_refresh_minutes=int(os.getenv("WATCHLIST_REFRESH_MINUTES", "60")),
                quantity_precision=int(os.getenv("QUANTITY_PRECISION", "6")),
                trading_fee_percent=float(os.getenv("TRADING_FEE_PERCENT", "0.35")),
                stop_loss_percent=float(os.getenv("STOP_LOSS_PERCENT", "2")),
                take_profit_percent=float(os.getenv("TAKE_PROFIT_PERCENT", "3")),
                max_daily_loss_percent=float(os.getenv("MAX_DAILY_LOSS_PERCENT", "5")),
                sma_fast_period=int(os.getenv("SMA_FAST_PERIOD", "5")),
                sma_slow_period=int(os.getenv("SMA_SLOW_PERIOD", "20")),
                news_enabled=os.getenv("NEWS_ENABLED", "false").strip().lower() == "true",
                news_api_key=os.getenv("NEWS_API_KEY", ""),
                news_cache_minutes=int(os.getenv("NEWS_CACHE_MINUTES", "30")),
                poll_interval_seconds=int(os.getenv("POLL_INTERVAL_SECONDS", "30")),
                dry_run=dry_run,
                log_level=os.getenv("LOG_LEVEL", "INFO"),
            )
        except ValueError as exc:
            raise ConfigError(f"مقدار نامعتبر در تنظیمات .env: {exc}") from exc

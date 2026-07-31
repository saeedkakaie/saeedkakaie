import os
import sys

from src.bot import TradingBot
from src.config import Config, ConfigError
from src.exchange_client import ExchangeClient
from src.logger_setup import setup_logger
from src.news_filter import NewsFilter
from src.position_store import PositionStore
from src.risk_manager import RiskManager
from src.strategy import TechnicalStrategy
from src.trade_journal import TradeJournal


def main() -> None:
    try:
        config = Config.load()
    except ConfigError as exc:
        print(f"خطا در تنظیمات: {exc}", file=sys.stderr)
        sys.exit(1)

    logger = setup_logger(config.log_level)

    if not config.dry_run:
        logger.warning(
            "DRY_RUN=false است: ربات سفارش‌های واقعی با پول واقعی ثبت خواهد کرد. "
            "اگر مطمئن نیستید، Ctrl+C بزنید و DRY_RUN=true را در .env تنظیم کنید."
        )
        time_to_cancel = 10
        import time as _time

        for remaining in range(time_to_cancel, 0, -1):
            print(f"شروع معاملات واقعی در {remaining} ثانیه... (Ctrl+C برای لغو)", end="\r")
            _time.sleep(1)
        print()

    exchange = ExchangeClient(
        api_key=config.api_key,
        api_secret=config.api_secret,
        dry_run=config.dry_run,
    )

    news_filter = NewsFilter(
        enabled=config.news_enabled,
        api_key=config.news_api_key or None,
        cache_minutes=config.news_cache_minutes,
    )

    def strategy_factory(symbol: str):
        return TechnicalStrategy(symbol=symbol, news_filter=news_filter)

    risk_manager = RiskManager(
        stop_loss_percent=config.stop_loss_percent,
        take_profit_percent=config.take_profit_percent,
        max_daily_loss_percent=config.max_daily_loss_percent,
    )

    trade_journal = TradeJournal(os.path.join("data", "trade_history.jsonl"))
    position_store = PositionStore(os.path.join("data", "open_positions.json"))

    bot = TradingBot(
        exchange=exchange,
        strategy_factory=strategy_factory,
        risk_manager=risk_manager,
        quote_asset=config.quote_asset,
        watchlist_refresh_minutes=config.watchlist_refresh_minutes,
        default_quantity_precision=config.quantity_precision,
        poll_interval_seconds=config.poll_interval_seconds,
        fee_percent=config.trading_fee_percent,
        trade_journal=trade_journal,
        position_store=position_store,
    )

    try:
        bot.run_forever()
    except KeyboardInterrupt:
        logger.info("ربات با Ctrl+C متوقف شد.")


if __name__ == "__main__":
    main()

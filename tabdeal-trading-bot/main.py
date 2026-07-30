import sys

from src.bot import TradingBot
from src.config import Config, ConfigError
from src.exchange_client import ExchangeClient
from src.logger_setup import setup_logger
from src.risk_manager import RiskManager
from src.strategy import SmaCrossoverStrategy


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

    def strategy_factory():
        return SmaCrossoverStrategy(
            fast_period=config.sma_fast_period,
            slow_period=config.sma_slow_period,
        )

    risk_manager = RiskManager(
        stop_loss_percent=config.stop_loss_percent,
        take_profit_percent=config.take_profit_percent,
        max_daily_loss_percent=config.max_daily_loss_percent,
        max_trades_per_day=config.max_trades_per_day,
    )

    bot = TradingBot(
        exchange=exchange,
        strategy_factory=strategy_factory,
        risk_manager=risk_manager,
        quote_asset=config.quote_asset,
        watchlist_size=config.watchlist_size,
        watchlist_refresh_minutes=config.watchlist_refresh_minutes,
        quote_order_amount=config.quote_order_amount,
        quantity_precision=config.quantity_precision,
        max_concurrent_positions=config.max_concurrent_positions,
        poll_interval_seconds=config.poll_interval_seconds,
    )

    try:
        bot.run_forever()
    except KeyboardInterrupt:
        logger.info("ربات با Ctrl+C متوقف شد.")


if __name__ == "__main__":
    main()

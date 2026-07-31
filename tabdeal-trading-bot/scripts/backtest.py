"""
بک‌تست استراتژی روی داده‌ی واقعی قیمت که خود ربات در حین اجرا (حتی در
DRY_RUN) در data/price_ticks/ ثبت کرده — نه شبیه‌سازی مصنوعی مونت‌کارلو.

هدف: قبل از اعتماد کردن به هر تنظیم جدید استراتژی با پول واقعی، نرخ برد
و انتظار سود واقعی آن روی داده‌ی واقعی گذشته سنجیده شود.

اجرا (بعد از این‌که چند روز ربات با DRY_RUN=true اجرا شده و داده جمع شده):
    python scripts/backtest.py

⚠️ این بک‌تست فیلتر خبر را خاموش می‌کند (امتیاز خبر امروز برای قیمت
قدیمی معنی ندارد) و watchlist/کشف نماد خودکار را شبیه‌سازی نمی‌کند —
فقط دقیقا همان TechnicalStrategy/Position/RiskManager را روی هر نماد
به‌طور جداگانه بازپخش می‌کند. برای همین جمع‌بندی این اسکریپت «آیا سیگنال
خرید این استراتژی به‌طور کلی حاشیه‌ی سود مثبت دارد» را می‌سنجد، نه دقیقا
همان نتیجه‌ی نهایی حساب (که به تخصیص سرمایه‌ی هم‌زمان بین چند نماد هم
بستگی دارد).
"""

import sys

sys.path.insert(0, ".")

from src.backtest import backtest_symbol, summarize_trades  # noqa: E402
from src.config import Config, ConfigError  # noqa: E402
from src.tick_logger import TickLogger  # noqa: E402


def main() -> None:
    try:
        config = Config.load()
    except ConfigError as exc:
        print(f"خطا در تنظیمات: {exc}")
        sys.exit(1)

    tick_logger = TickLogger("data/price_ticks")
    series_by_symbol = tick_logger.load_all()

    if not series_by_symbol:
        print(
            "هیچ داده‌ای در data/price_ticks پیدا نشد. باید حداقل چند روز ربات را با "
            "DRY_RUN=true اجرا کرده باشید تا این فایل‌ها جمع بشوند."
        )
        return

    all_trades = []
    open_positions = []

    print(f"{'نماد':<12}{'تعداد رکورد قیمت':<20}{'تعداد معامله':<15}{'نرخ برد':<12}{'انتظار (%)':<12}")
    print("-" * 75)

    for symbol in sorted(series_by_symbol.keys()):
        series = series_by_symbol[symbol]
        trades, open_position = backtest_symbol(
            symbol=symbol,
            price_series=series,
            fee_percent=config.trading_fee_percent,
            default_stop_loss_percent=config.stop_loss_percent,
            default_take_profit_percent=config.take_profit_percent,
            max_daily_loss_percent=config.max_daily_loss_percent,
        )
        all_trades.extend(trades)
        if open_position:
            open_positions.append(open_position)

        stats = summarize_trades(trades)
        print(
            f"{symbol:<12}{len(series):<20}{stats['total_trades']:<15}"
            f"{stats['win_rate_percent']:<11.1f}%{stats['expectancy_percent']:<12.3f}"
        )

    print("-" * 75)
    overall = summarize_trades(all_trades)
    print(
        f"\nجمع کل: {overall['total_trades']} معامله بسته‌شده روی {len(series_by_symbol)} نماد\n"
        f"  نرخ برد: {overall['win_rate_percent']:.1f}%  "
        f"(برد={overall['wins']}, باخت={overall['losses']})\n"
        f"  میانگین برد: {overall['avg_win_percent']:.3f}%    "
        f"میانگین باخت: {overall['avg_loss_percent']:.3f}%\n"
        f"  انتظار هر معامله (expectancy): {overall['expectancy_percent']:.3f}%\n"
        f"  مجموع سود/زیان خالص (جمع ساده‌ی درصدها): {overall['total_net_pnl_percent']:.2f}%"
    )

    if open_positions:
        print(
            f"\n({len(open_positions)} پوزیشن در انتهای داده هنوز باز مانده بودند و "
            "در آمار بالا حساب نشده‌اند، چون هنوز بسته نشده‌اند.)"
        )

    if overall["total_trades"] < 30:
        print(
            "\n⚠️ تعداد معاملات هنوز خیلی کم است برای یک نتیجه‌گیری آماری معتبر "
            "(معمولا حداقل چند ده معامله لازم است). قبل از تغییر DRY_RUN=false، "
            "بگذارید داده‌ی بیشتری جمع شود و دوباره این اسکریپت را اجرا کنید."
        )


if __name__ == "__main__":
    main()

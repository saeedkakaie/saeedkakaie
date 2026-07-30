import logging
from typing import Optional

from tabdeal.enums import OrderSides, OrderTypes
from tabdeal.spot import Spot

logger = logging.getLogger("tabdeal_bot")


class ExchangeError(Exception):
    pass


class ExchangeClient:
    """
    لایه‌ی نازک روی SDK رسمی tabdeal-python. یک نمونه از این کلاس با یک
    اتصال API برای همه‌ی نمادها (کل بازار) استفاده می‌شود؛ نماد در هر متد
    جداگانه پاس داده می‌شود.

    توجه: مستندات کامل ساختار پاسخ‌های API پشت لاگین است (docs.tabdeal.org).
    این کلاس بر اساس رفتار SDK (که از الگوی باینانس پیروی می‌کند) پاسخ‌ها را
    به‌صورت تدافعی پارس می‌کند. قبل از اجرای واقعی حتما با
    scripts/inspect_api.py خروجی خام API را بررسی کنید.
    """

    def __init__(self, api_key: str, api_secret: str, dry_run: bool = True):
        self.dry_run = dry_run
        self.client = Spot(api_key, api_secret)

    def get_current_price(self, symbol: str) -> float:
        try:
            depth = self.client.depth(symbol=symbol, limit=5)
            best_bid = float(depth["bids"][0][0])
            best_ask = float(depth["asks"][0][0])
            return (best_bid + best_ask) / 2
        except Exception as exc:
            logger.warning("خطا در خواندن order book %s (%s)، تلاش با آخرین معاملات...", symbol, exc)

        try:
            trades = self.client.trades(symbol=symbol, limit=1)
            return float(trades[0]["price"])
        except Exception as exc:
            raise ExchangeError(f"دریافت قیمت لحظه‌ای {symbol} ممکن نشد: {exc}") from exc

    def get_asset_balance(self, asset: str) -> Optional[float]:
        try:
            account = self.client.account()
            for balance in account["balances"]:
                if balance["asset"] == asset:
                    return float(balance["free"])
            return 0.0
        except Exception as exc:
            logger.error(
                "دریافت موجودی برای %s ممکن نشد (ساختار پاسخ API را با inspect_api.py بررسی کنید): %s",
                asset,
                exc,
            )
            return None

    def get_all_balances(self) -> Optional[list]:
        """
        همه‌ی دارایی‌های با موجودی غیرصفر را برمی‌گرداند: [{"asset": ..., "free": ..., "locked": ...}, ...]
        در صورت خطا None برمی‌گرداند (مثلا کلید API نامعتبر یا ساختار پاسخ متفاوت).
        """
        try:
            account = self.client.account()
            balances = []
            for balance in account["balances"]:
                free = float(balance.get("free", 0) or 0)
                locked = float(balance.get("locked", 0) or 0)
                if free > 0 or locked > 0:
                    balances.append({"asset": balance["asset"], "free": free, "locked": locked})
            balances.sort(key=lambda b: b["free"], reverse=True)
            return balances
        except Exception as exc:
            logger.error(
                "دریافت موجودی حساب ممکن نشد (ساختار پاسخ API را با inspect_api.py بررسی کنید): %s", exc
            )
            return None

    def buy_market(self, symbol: str, quote_amount: float, quantity_precision: int) -> Optional[dict]:
        price = self.get_current_price(symbol)
        quantity = round(quote_amount / price, quantity_precision)

        if quantity <= 0:
            raise ExchangeError(f"مقدار محاسبه‌شده برای خرید {symbol} صفر یا منفی است.")

        if self.dry_run:
            logger.info(
                "[DRY-RUN] BUY %s %s با قیمت تقریبی %s (مبلغ %s)",
                quantity,
                symbol,
                price,
                quote_amount,
            )
            return {"dry_run": True, "side": "BUY", "quantity": quantity, "price": price}

        order = self.client.new_order(
            symbol=symbol,
            side=OrderSides.BUY,
            type=OrderTypes.MARKET,
            quantity=str(quantity),
        )
        logger.info("سفارش خرید ثبت شد (%s): %s", symbol, order)
        return order

    def sell_market(self, symbol: str, quantity: float) -> Optional[dict]:
        if quantity <= 0:
            raise ExchangeError(f"مقدار برای فروش {symbol} نامعتبر است.")

        if self.dry_run:
            price = self.get_current_price(symbol)
            logger.info("[DRY-RUN] SELL %s %s با قیمت تقریبی %s", quantity, symbol, price)
            return {"dry_run": True, "side": "SELL", "quantity": quantity, "price": price}

        order = self.client.new_order(
            symbol=symbol,
            side=OrderSides.SELL,
            type=OrderTypes.MARKET,
            quantity=str(quantity),
        )
        logger.info("سفارش فروش ثبت شد (%s): %s", symbol, order)
        return order

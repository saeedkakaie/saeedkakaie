import logging
import time
from typing import Optional

from tabdeal.enums import OrderSides, OrderTypes, RequestTypes, SecurityTypes
from tabdeal.spot import Spot

logger = logging.getLogger("tabdeal_bot")


class ExchangeError(Exception):
    pass


def _describe_exception(exc: Exception) -> str:
    """
    tabdeal.exceptions.ClientException پیام کامل خطای سرور (code/detail) را
    در __str__ نشان نمی‌دهد، فقط message را. این تابع همه‌ی اطلاعات موجود
    را برای لاگ/عیب‌یابی جمع می‌کند.
    """
    parts = [str(exc)]
    code = getattr(exc, "code", None)
    if code is not None:
        parts.append(f"code={code}")
    status = getattr(exc, "status", None)
    if status is not None:
        parts.append(f"status={status}")
    detail = getattr(exc, "detail", None)
    if detail:
        parts.append(f"detail={detail}")
    return " | ".join(parts)


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

    def _clock_skew_hint(self) -> str:
        """
        برای عیب‌یابی خطاهای «Invalid Signature» که اغلب علتشان اختلاف
        ساعت سیستم با سرور است: ساعت سرور تبدیل (بدون نیاز به احراز هویت)
        را می‌گیرد و با ساعت محلی مقایسه می‌کند. best-effort است؛ اگر خودش
        هم شکست بخورد رشته‌ی خالی برمی‌گرداند.
        """
        try:
            local_ms = time.time() * 1000
            response = self.client.time()
            server_ms = None
            if isinstance(response, dict):
                for key in ("serverTime", "server_time", "time"):
                    if key in response:
                        server_ms = float(response[key])
                        break
            if server_ms is None:
                return ""
            skew_seconds = (local_ms - server_ms) / 1000
            return f" | اختلاف ساعت گوشی با سرور تبدیل تقریبا {skew_seconds:.1f} ثانیه است"
        except Exception:
            return ""

    def _get_account(self) -> dict:
        """
        این‌جا عمداً به‌جای self.client.account() از فراخوانی مستقیم
        request() با یک دیکشنری تازه استفاده می‌کنیم.

        دلیل: امضای متد Spot.account() در SDK رسمی تابع request() را
        بدون پاس دادن آرگومان data صدا می‌زند، و پارامتر data در تعریف
        request() یک مقدار پیش‌فرض mutable (dict()) دارد که طبق رفتار
        شناخته‌شده‌ی پایتون فقط یک‌بار ساخته می‌شود و بین همه‌ی
        فراخوانی‌ها به اشتراک گذاشته می‌شود. چون این تابع همان دیکشنری
        مشترک را با timestamp/signature هر بار update می‌کند، از دومین
        فراخوانی به بعد signature قبلی هنوز داخلش هست و امضای جدید روی
        یک payload «آلوده» محاسبه می‌شود که هیچ‌وقت با سرور تبدیل مچ
        نمی‌شود (خطای Invalid Signature، code=1103). با پاس دادن یک
        دیکشنری کاملا تازه در هر فراخوانی این باگ دور زده می‌شود.
        """
        return self.client.request(
            url="account",
            method=RequestTypes.GET,
            security_type=SecurityTypes.TRADE,
            data={},
        )

    def get_current_price(self, symbol: str) -> float:
        try:
            depth = self.client.depth(symbol=symbol, limit=5)
            best_bid = float(depth["bids"][0][0])
            best_ask = float(depth["asks"][0][0])
            return (best_bid + best_ask) / 2
        except Exception as exc:
            logger.warning(
                "خطا در خواندن order book %s (%s)، تلاش با آخرین معاملات...", symbol, _describe_exception(exc)
            )

        try:
            trades = self.client.trades(symbol=symbol, limit=1)
            return float(trades[0]["price"])
        except Exception as exc:
            raise ExchangeError(f"دریافت قیمت لحظه‌ای {symbol} ممکن نشد: {_describe_exception(exc)}") from exc

    def get_asset_balance(self, asset: str) -> Optional[float]:
        try:
            account = self._get_account()
            for balance in account["balances"]:
                if balance["asset"] == asset:
                    return float(balance["free"])
            return 0.0
        except Exception as exc:
            logger.error(
                "دریافت موجودی برای %s ممکن نشد (ساختار پاسخ API را با inspect_api.py بررسی کنید): %s%s",
                asset,
                _describe_exception(exc),
                self._clock_skew_hint(),
            )
            return None

    def get_all_balances(self) -> Optional[list]:
        """
        همه‌ی دارایی‌های با موجودی غیرصفر را برمی‌گرداند: [{"asset": ..., "free": ..., "locked": ...}, ...]
        در صورت خطا None برمی‌گرداند (مثلا کلید API نامعتبر یا ساختار پاسخ متفاوت).
        """
        try:
            account = self._get_account()
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
                "دریافت موجودی حساب ممکن نشد (ساختار پاسخ API را با inspect_api.py بررسی کنید): %s%s",
                _describe_exception(exc),
                self._clock_skew_hint(),
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

import logging
import time
from typing import Optional, Tuple

from tabdeal.enums import OrderSides, OrderTypes, RequestTypes, SecurityTypes
from tabdeal.spot import Spot

from src.notifier import notify

logger = logging.getLogger("tabdeal_bot")


class ExchangeError(Exception):
    pass


def _extract_quantity(order: dict) -> Optional[float]:
    for key in ("quantity", "executedQty", "executed_qty", "origQty", "orig_qty", "filledQty", "filled_qty"):
        if key in order and order[key] not in (None, ""):
            try:
                value = float(order[key])
            except (TypeError, ValueError):
                continue
            if value > 0:
                return value
    return None


def _extract_price_from_fills(order: dict) -> Optional[Tuple[float, float]]:
    """
    اگر پاسخ سفارش شامل ریز معاملات اجراشده (fills) باشد، دقیق‌ترین قیمت
    واقعی میانگین وزنی اجرا را از همان‌جا محاسبه می‌کند. خروجی:
    (میانگین قیمت, مجموع مقدار) یا None.
    """
    fills = order.get("fills")
    if not isinstance(fills, list) or not fills:
        return None

    try:
        total_qty = sum(float(f["qty"]) for f in fills)
        total_quote = sum(float(f["qty"]) * float(f["price"]) for f in fills)
    except (TypeError, ValueError, KeyError):
        return None

    if total_qty <= 0:
        return None

    return total_quote / total_qty, total_qty


def _extract_price(order: dict, quantity: Optional[float]) -> Optional[float]:
    from_fills = _extract_price_from_fills(order)
    if from_fills is not None:
        return from_fills[0]

    if quantity:
        for key in ("cummulativeQuoteQty", "cumulativeQuoteQty", "cummulative_quote_qty"):
            if key in order and order[key] not in (None, ""):
                try:
                    cumulative_quote = float(order[key])
                except (TypeError, ValueError):
                    continue
                if cumulative_quote > 0:
                    return cumulative_quote / quantity

    for key in ("price", "avgPrice", "avg_price"):
        if key in order and order[key] not in (None, ""):
            try:
                value = float(order[key])
            except (TypeError, ValueError):
                continue
            if value > 0:
                return value

    return None


def _extract_commission_in_asset(order: dict, asset: str) -> float:
    """
    اگر کارمزد سفارش مستقیم از همان دارایی خریداری‌شده کسر شده باشد (مثلا
    commissionAsset برابر با دارایی مبنای نماد باشد)، مجموع آن را از fills
    برمی‌گرداند. برای این‌که quantity ثبت‌شده در پوزیشن با موجودی واقعا
    قابل فروش یکی باشد لازم است — وگرنه بعداً یک تلاش برای فروش دقیقاً
    همان مقدار خام سفارش، به‌خاطر همین چند واحد کارمزد، با خطای «موجودی
    کافی نیست» رد می‌شود.
    """
    fills = order.get("fills")
    if not isinstance(fills, list):
        return 0.0

    total = 0.0
    for fill in fills:
        if not isinstance(fill, dict) or fill.get("commissionAsset") != asset:
            continue
        try:
            total += float(fill.get("commission", 0) or 0)
        except (TypeError, ValueError):
            continue

    return total


def _normalize_order(order: dict, side: str, symbol: str, fallback_price: float, fallback_quantity: float) -> dict:
    """
    پاسخ خام new_order() ممکن است کلیدهای متفاوتی از قرارداد داخلی
    {"price", "quantity"} (که فقط در حالت DRY-RUN خودمان می‌سازیم) داشته
    باشد — چون ساختار دقیق پاسخ تبدیل مستند نیست (docs.tabdeal.org پشت
    لاگین است)، این تابع چند نام رایج سبک باینانس (executedQty/origQty/
    fills/cummulativeQuoteQty) را امتحان می‌کند.

    نکته‌ی حیاتی: چون این تابع همیشه *بعد از* ثبت واقعی سفارش فراخوانی
    می‌شود، اگر هیچ‌کدام از فیلدهای شناخته‌شده پیدا نشوند، به‌جای بالا
    بردن خطا (که باعث می‌شد پوزیشن اصلا ثبت نشود و پوزیشن واقعی روی
    صرافی کاملا بدون حد ضرر/سود و ردیابی بماند) از مقادیر تخمینی محلی
    (قیمت لحظه‌ای و مقداری که قبل از ثبت سفارش محاسبه شده) استفاده
    می‌کند و با لاگ هشدار بلند این را اعلام می‌کند تا کاربر دستی با
    موجودی واقعی صرافی مقایسه کند.
    """
    if not isinstance(order, dict):
        order = {}

    quantity = _extract_quantity(order)
    price = _extract_price(order, quantity)

    used_fallback = quantity is None or price is None

    if quantity is None:
        quantity = fallback_quantity
    if price is None:
        price = fallback_price

    if used_fallback:
        logger.warning(
            "ساختار پاسخ سفارش %s برای %s با فیلدهای شناخته‌شده مطابقت نداشت؛ "
            "به‌جای مقدار/قیمت واقعی از تخمین محلی (قیمت=%.6f، مقدار=%.6f) استفاده شد. "
            "پاسخ خام صرافی: %s — حتما موجودی واقعی %s را در اپ تبدیل با پوزیشن ثبت‌شده مقایسه کنید.",
            side,
            symbol,
            price,
            quantity,
            order,
            symbol,
        )
        notify(
            f"⚠️ سفارش {side} {symbol} با ساختار ناشناخته",
            f"پوزیشن با تخمین محلی (قیمت≈{price:.4f}، مقدار≈{quantity:.6f}) ثبت شد؛ "
            "حتما موجودی واقعی را در اپ تبدیل بررسی کن.",
        )

    if side == "خرید" and quantity is not None:
        # اگر کارمزد از همان دارایی خریداری‌شده کسر شده باشد (رایج در سفارش‌های
        # سبک باینانس)، مقدار ثبت‌شده در پوزیشن باید مقدار واقعا قابل فروش
        # باشد، نه مقدار خام اجراشده — وگرنه بعداً تلاش برای فروش دقیقاً
        # همان مقدار خام با «موجودی کافی نیست» رد می‌شود.
        base_asset = symbol.split("_")[0]
        commission = _extract_commission_in_asset(order, base_asset)
        if commission > 0 and quantity - commission > 0:
            logger.info(
                "کارمزد %.8f %s از مقدار خرید %s کسر شد (مقدار واقعی قابل فروش: %.8f).",
                commission,
                base_asset,
                symbol,
                quantity - commission,
            )
            quantity -= commission

    return {"price": price, "quantity": quantity}


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
        return _normalize_order(order, side="خرید", symbol=symbol, fallback_price=price, fallback_quantity=quantity)

    def sell_market(self, symbol: str, quantity: float) -> Optional[dict]:
        if quantity <= 0:
            raise ExchangeError(f"مقدار برای فروش {symbol} نامعتبر است.")

        price = self.get_current_price(symbol)

        if self.dry_run:
            logger.info("[DRY-RUN] SELL %s %s با قیمت تقریبی %s", quantity, symbol, price)
            return {"dry_run": True, "side": "SELL", "quantity": quantity, "price": price}

        order = self.client.new_order(
            symbol=symbol,
            side=OrderSides.SELL,
            type=OrderTypes.MARKET,
            quantity=str(quantity),
        )
        logger.info("سفارش فروش ثبت شد (%s): %s", symbol, order)
        return _normalize_order(order, side="فروش", symbol=symbol, fallback_price=price, fallback_quantity=quantity)

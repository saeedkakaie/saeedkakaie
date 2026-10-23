import numpy as np

from ibp_engine import demand

# ۳۶ ماه: مهر ۱۴۰۲ تا شهریور ۱۴۰۵
PERIODS = [1402 * 100 + m for m in range(7, 13)] + [1403 * 100 + m for m in range(1, 13)] + [1404 * 100 + m for m in range(1, 13)] + [1405 * 100 + m for m in range(1, 7)]
FUTURE = [140507, 140508, 140509, 140510, 140511, 140512]
SEASON = np.array([1.0, 0.9, 0.9, 1.0, 1.1, 1.2, 1.1, 1.0, 0.9, 0.9, 1.0, 1.3])


def _ramadan(periods):
    # شدت رمضان (روزهای رمضان ÷ روزهای ماه) برای سه سال آزمون
    table = {140212: 9 / 29, 140301: 21 / 31, 140312: 20 / 30, 140401: 9 / 31, 140411: 2 / 30, 140412: 28 / 29, 140511: 10 / 30, 140512: 19 / 30}
    return np.array([[table.get(p, 0.0), 0.0, 0.0] for p in periods])


def _payload(uplift=2.0, noise=0.05, seed=1):
    rng = np.random.default_rng(seed)
    xh, xf = _ramadan(PERIODS), _ramadan(FUTURE)
    mo = np.array([p % 100 for p in PERIODS]) - 1
    y = 1000 * SEASON[mo] * (1 + uplift * xh[:, 0]) * (1 + noise * rng.standard_normal(len(PERIODS)))
    return {
        "periods": PERIODS, "future": FUTURE,
        "events": {"hist": xh.tolist(), "future": xf.tolist()},
        "products": [{"id": "p1", "familyId": "f1", "from": 0, "qty": y.tolist()}],
    }


def test_event_effect_recovered():
    eff = demand.event_effects(_payload(uplift=2.0))["effects"]
    ram = [e for e in eff if e["event"] == "ramadan"][0]
    assert 1.4 < ram["uplift"] < 2.8 and ram["p"] < 0.01 and ram["lo"] < ram["uplift"] < ram["hi"]


def test_forecast_uses_event_and_intervals():
    out = demand.forecast(_payload(uplift=2.0))["products"]["p1"]
    fc = np.array(out["forecast"])
    # اسفند ۱۴۰۵ (رمضان ۱۹ روز) باید به‌وضوح بالاتر از آبان باشد
    assert fc[5] > fc[1] * 1.5
    assert all(l <= f <= h for l, f, h in zip(out["lo"], out["forecast"], out["hi"]))
    assert out["method"] in ("reg", "ensemble")


def test_intermittent_uses_croston_family():
    p = _payload(uplift=0)
    y = np.array(p["products"][0]["qty"])
    y[::2] = 0
    p["products"][0]["qty"] = y.tolist()
    out = demand.forecast(p)["products"]["p1"]
    assert out["method"] in demand.INTERMITTENT + ["ensemble"] and out["zeroShare"] >= 0.5


def _multi_payload(n_products=6, seed=3):
    rng = np.random.default_rng(seed)
    xh, xf = _ramadan(PERIODS), _ramadan(FUTURE)
    mo = np.array([p % 100 for p in PERIODS]) - 1
    t = np.arange(len(PERIODS))
    prods = []
    for i in range(n_products):
        y = (500 + 200 * i) * (1.015 ** t) * SEASON[mo] * (1 + 1.5 * xh[:, 0]) * (1 + 0.06 * rng.standard_normal(len(PERIODS)))
        prods.append({"id": f"p{i}", "familyId": "f1", "from": 0, "qty": y.tolist()})
    return {"periods": PERIODS, "future": FUTURE, "events": {"hist": xh.tolist(), "future": xf.tolist()}, "products": prods,
            "options": {"origins": 12, "lead": 3, "metric": "wmape", "ensemble": True}}


def test_backtest_compares_many_methods_including_global_gbm():
    res = demand.forecast(_multi_payload())
    out = res["products"]["p0"]
    assert out["origins"] == 12 and out["lead"] == 3
    tested = set(out["metrics"])
    # روش‌های پایه، هموارسازی، هولت-وینترز، تتا، ARIMA، رگرسیون و مدل سراسری یادگیری ماشین
    for m in ("snaive", "drift", "ses", "holt", "hwMul", "theta", "arima", "reg", "gbm"):
        assert m in tested, m
    assert len(tested) >= 14
    # برنده کمترین خطا را دارد و lag-1 بک‌تست برای هر روش ۱۲ نقطه دارد
    best = out["method"]
    assert out["metrics"][best]["wmape"] == min(v["wmape"] for v in out["metrics"].values())
    assert len(out["backtest"]["idx"]) == 12 and all(len(v) == 12 for v in out["backtest"]["fc"].values())
    # روش منتخب روی داده با روند، فصل و رمضان باید دقیق باشد
    assert out["metrics"][best]["wmape"] < 0.12
    assert all(lo <= f <= hi for lo, f, hi in zip(out["lo"], out["forecast"], out["hi"]))


def test_metric_option_changes_selection_basis():
    p = _multi_payload(n_products=3)
    p["options"]["metric"] = "rmse"
    out = demand.forecast(p)["products"]["p1"]
    assert out["metric"] == "rmse"
    assert out["scores"][out["method"]] == min(out["scores"].values())

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
    assert out["method"] in ("croston", "tsb", "ma3", "snaive", "ensemble") and out["zeroShare"] >= 0.5

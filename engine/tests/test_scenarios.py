from ibp_engine import scenarios


def _payload(rel=0.15, production=None):
    d = [100.0] * 12
    return {"runs": 4000, "months": 12, "seed": 3, "budgetGross": 12 * 100 * 40, "budgetRevenue": 0,
            "products": [{"id": "p", "rel": rel, "open": 0, "demand": d, "production": production or [100.0] * 12,
                          "price": [100.0] * 12, "cost": [60.0] * 12}]}


def test_constrained_supply_caps_upside():
    out = scenarios.montecarlo(_payload())
    # تولید برابر تقاضای میانگین است: فروش از تولید بیشتر نمی‌شود، پس P90 سود به سقف ۴۸٬۰۰۰ محدود است
    assert out["gross"]["p90"] <= 12 * 100 * 40 + 1e-6
    assert out["gross"]["p10"] < out["gross"]["p50"] <= out["gross"]["p90"]
    assert 0.8 < out["fill"]["p50"] < 1.0
    assert sum(out["hist"]["counts"]) == 4000


def test_extra_supply_and_zero_noise():
    exact = scenarios.montecarlo(_payload(rel=0.0))
    assert abs(exact["gross"]["p50"] - 48000) < 1e-6 and exact["probGrossBudget"] == 1.0
    roomy = scenarios.montecarlo(_payload(production=[130.0] * 12))
    tight = scenarios.montecarlo(_payload())
    assert roomy["gross"]["mean"] > tight["gross"]["mean"]


def test_budget_probability_uses_budget_months_only():
    p = _payload(rel=0.0)
    p["budgetMask"] = [1] * 6 + [0] * 6
    p["budgetRevenue"] = 6 * 100 * 100 + 1  # کمی بیش از درآمد قطعی شش ماه
    p["budgetGross"] = 6 * 100 * 40 - 1
    out = scenarios.montecarlo(p)
    assert out["probRevenueBudget"] == 0.0 and out["probGrossBudget"] == 1.0

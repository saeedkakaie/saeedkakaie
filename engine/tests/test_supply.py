from ibp_engine import supply

T = 6


def _payload(cap=100.0, demand=(80, 80, 80, 150, 150, 80), shelf_carry=3):
    return {
        "periods": [140508 + i for i in range(T)], "overtimePct": 0.1,
        "products": [{"id": "p", "demand": list(demand), "ss": [10] * T, "open": 10, "maxCarry": shelf_carry,
                      "unitCost": 100, "unitPrice": 150, "priority": "A",
                      "routes": [{"resourceId": "r1", "unitsPerHour": 1.0, "alt": False}]}],
        "resources": [{"id": "r1", "capacity": cap, "costPerHour": 0}],
    }


def _prod(out, kind=None):
    q = [0.0] * T
    for a in out["allocations"]:
        if kind is None or a["kind"] == kind:
            q[a["t"]] += a["qty"]
    return q


def test_prebuild_covers_peak_without_shortage():
    out = supply.optimize(_payload())
    assert out["status"] == "optimal"
    prod = _prod(out)
    # ظرفیت هر ماه رعایت می‌شود (ظرفیت عادی + ۱۰٪ اضافه‌کاری)
    assert all(q <= 110 + 1e-6 for q in prod)
    assert out["summary"]["shortage"] < 1e-6
    # اوج ماه‌های ۴ و ۵ با پیش‌ساخت در ماه‌های قبل پوشش داده شده است
    assert sum(_prod(out, "prebuild")) > 50


def test_shelf_life_limits_prebuild_and_creates_shortage():
    out = supply.optimize(_payload(cap=90, demand=(10, 10, 10, 300, 10, 10), shelf_carry=1))
    assert out["status"] == "optimal"
    assert out["summary"]["shortage"] > 50  # بدون امکان نگهداری طولانی، اوج ناگهانی قابل پوشش نیست

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from ibp_engine import server


@pytest.fixture()
def env(tmp_path):
    app = FastAPI()

    @app.post("/demand/forecast")
    def fc():  # نماینده تحلیل‌های موتور
        return {"ok": True}

    store = server.install(app, str(tmp_path), None, "test")
    c = TestClient(app)
    # راه‌اندازی نخستین مدیر
    assert c.post("/api/setup", json={"setupToken": "WRONG", "username": "admin", "password": "admin-pass-1"}).status_code == 403
    r = c.post("/api/setup", json={"setupToken": store.setup_token.lower(), "username": "admin", "name": "مدیر", "password": "admin-pass-1"})
    assert r.status_code == 200
    admin = {"Authorization": "Bearer " + r.json()["token"]}
    assert c.post("/api/setup", json={"setupToken": store.setup_token, "username": "x", "password": "12345678"}).status_code == 409
    for code in ("ZMC", "ZKM"):
        assert c.post("/api/companies", json={"code": code, "name": code}, headers=admin).status_code == 200
    c.post("/api/users", json={"username": "planner", "password": "planner-pass", "role": "editor", "companies": ["ZMC"], "areas": ["demand"]}, headers=admin)
    c.post("/api/users", json={"username": "boss", "password": "viewer-pass", "role": "viewer", "companies": ["*"]}, headers=admin)

    def login(u, p, client="c1"):
        t = c.post("/api/auth/login", json={"username": u, "password": p}).json()["token"]
        return {"Authorization": "Bearer " + t, "X-Client-Id": client}
    return c, store, admin, login


def test_login_and_rate_limit(env):
    c, store, admin, login = env
    assert c.get("/api/auth/me").status_code == 401
    for _ in range(5):
        assert c.post("/api/auth/login", json={"username": "planner", "password": "bad"}).status_code == 401
    assert c.post("/api/auth/login", json={"username": "planner", "password": "planner-pass"}).status_code == 429
    me = c.get("/api/auth/me", headers=admin).json()
    assert me["role"] == "admin" and me["companies"] == ["*"]
    assert store.q("SELECT pw FROM users WHERE username='admin'")[0]["pw"].startswith("pbkdf2$")


def test_permissions_by_company_and_area(env):
    c, store, admin, login = env
    p, v = login("planner", "planner-pass"), login("boss", "viewer-pass", "c2")
    # برنامه‌ریز فقط ZMC را می‌بیند
    assert [x["code"] for x in c.get("/api/holding", headers=p).json()["companies"]] == ["ZMC"]
    assert c.get("/api/companies/ZKM/data", headers=p).status_code == 403
    assert c.post("/api/companies/ZMC/put", json={"entity": "forecasts", "records": [{"id": "f1", "qty": 10}]}, headers=p).status_code == 200
    r = c.post("/api/companies/ZMC/put", json={"entity": "products", "records": [{"id": "p1"}]}, headers=p)
    assert r.status_code == 403 and "داده‌های پایه" in r.json()["detail"]
    # مشاهده‌گر همه شرکت‌ها را می‌بیند ولی ویرایش نمی‌کند؛ نتیجه محاسبه (statRun) را می‌تواند ذخیره کند
    assert len(c.get("/api/holding", headers=v).json()["companies"]) == 2
    assert c.post("/api/companies/ZMC/put", json={"entity": "forecasts", "records": [{"id": "f2"}]}, headers=v).status_code == 403
    assert c.put("/api/companies/ZMC/meta/statRun", json={"value": {"x": 1}}, headers=v).status_code == 200
    assert c.put("/api/companies/ZMC/meta/scenarios", json={"value": []}, headers=v).status_code == 403
    assert c.post("/api/companies/ZMC/clear-all", headers=p).status_code == 403
    assert c.post("/api/users", json={"username": "z", "password": "12345678"}, headers=p).status_code == 403


def test_sync_changes_and_audit(env):
    c, store, admin, login = env
    p, v = login("planner", "planner-pass", "A"), login("boss", "viewer-pass", "B")
    base = c.get("/api/companies/ZMC/data", headers=v).json()["seq"]
    c.post("/api/companies/ZMC/put", json={"entity": "forecasts", "records": [{"id": "f1", "qty": 10}]}, headers=p)
    c.post("/api/companies/ZMC/put", json={"entity": "forecasts", "records": [{"id": "f1", "qty": 12}]}, headers=p)
    c.post("/api/companies/ZMC/remove", json={"entity": "forecasts", "ids": ["f1"]}, headers=p)
    ch = c.get(f"/api/companies/ZMC/changes?since={base}", headers=v).json()
    assert ch["by"] == ["planner"] and ch["records"][-1]["deleted"] is True
    # تغییرات خود کاربر به خودش برنمی‌گردد
    assert c.get(f"/api/companies/ZMC/changes?since={base}", headers=p).json()["records"] == []
    big = [{"id": f"s{i}", "qty": i} for i in range(50)]
    c.post("/api/companies/ZMC/put", json={"entity": "forecasts", "records": big}, headers=p)
    data = c.get("/api/companies/ZMC/data", headers=v).json()
    assert len(data["records"]["forecasts"]) == 50 and data["meta"] == {}
    items = c.get("/api/audit?company=ZMC", headers=admin).json()["items"]
    acts = [i["action"] for i in items]
    assert "bulk_upsert" in acts and "delete" in acts
    upd = [i for i in items if i["action"] == "update"][0]
    assert upd["detail"]["changed"]["qty"] == [10, 12] and upd["username"] == "planner"
    # برنامه‌ریز فقط سوابق شرکت‌های مجاز خودش را می‌بیند
    assert all(i["company"] in ("ZMC", None) for i in c.get("/api/audit", headers=p).json()["items"])


def test_admin_safety_and_analysis_requires_login(env):
    c, store, admin, login = env
    me = c.get("/api/auth/me", headers=admin).json()
    assert c.put(f"/api/users/{me['id']}", json={"role": "viewer"}, headers=admin).status_code == 400
    assert c.post("/demand/forecast", json={}).status_code == 401
    assert c.post("/demand/forecast", json={}, headers=admin).status_code == 200
    # غیرفعال کردن کاربر نشست‌هایش را باطل می‌کند
    p = login("planner", "planner-pass")
    uid = [u for u in c.get("/api/users", headers=admin).json() if u["username"] == "planner"][0]["id"]
    c.put(f"/api/users/{uid}", json={"active": False}, headers=admin)
    assert c.get("/api/auth/me", headers=p).status_code == 401

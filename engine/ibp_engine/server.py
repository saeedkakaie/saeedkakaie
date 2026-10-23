"""سرور مرکزی (فاز ۹): پایگاه داده مشترک، کاربران، نقش‌ها و مجوزها، سوابق تغییرات.

اجرا: python run.py --server --host 0.0.0.0 --data <پوشه داده>
  - برنامه (پوشه app) از همین نشانی سرو می‌شود و کاربران با مرورگر وارد می‌شوند
  - داده همه شرکت‌ها در یک فایل SQLite (ibp.db) در پوشه داده نگه داشته می‌شود
  - نخستین مدیر سیستم فقط با «کد راه‌اندازی» ساخته می‌شود که هنگام اجرا در خروجی و فایل setup-token.txt نوشته می‌شود

نقش‌ها:
  admin   همه شرکت‌ها و حوزه‌ها، مدیریت کاربران و شرکت‌ها، مشاهده همه سوابق
  editor  مشاهده شرکت‌های مجاز و ویرایش «حوزه‌های مجاز» در آن‌ها
  viewer  فقط مشاهده شرکت‌های مجاز
همگام‌سازی: هر تغییر شماره ترتیب (seq) می‌گیرد؛ کاربران دیگر با /changes تغییرات تازه را دریافت می‌کنند.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException, Request

ROLES = {"admin": "مدیر سیستم", "editor": "برنامه‌ریز (ویرایش)", "viewer": "مشاهده‌گر"}
AREAS = {
    "masterdata": "داده‌های پایه",
    "data": "داده‌های عملکرد (فروش و موجودی)",
    "demand": "تقاضا و پیش‌بینی",
    "supply": "تأمین، تولید و موجودی",
    "finance": "بودجه، مالی و سناریو",
    "review": "بازنگری، اقدامات و گزارش‌ها",
    "settings": "تنظیمات شرکت",
}
ENTITY_AREA = {
    **{e: "masterdata" for e in ("plants", "warehouses", "resources", "families", "products", "routings", "suppliers", "materials", "bom", "channels", "regions", "customers")},
    **{e: "data" for e in ("salesActuals", "inventory", "materialInventory")},
    **{e: "demand" for e in ("forecasts", "events", "eventImpacts", "demandAdjustments")},
    "budgets": "finance",
    "actions": "review",
    "cycleSteps": "review",
}
META_AREA = {
    "settings": "settings", "seeded": "data", "lastImport": "data",
    "statRun": "demand", "supplyRun": "supply", "mpsOverrides": "supply", "icRequests": "supply",
    "scenarios": "finance", "reports": "review",
}
# نتایج محاسباتی که هر کاربرِ دارای دسترسی مشاهده می‌تواند تازه کند (داده مبنا را تغییر نمی‌دهند)
CACHE_META = {"statRun", "supplyRun"}

SESSION_HOURS = 12
PBKDF2_ROUNDS = 240_000
MAX_FAILS, LOCK_SECONDS = 5, 60
SMALL_WRITE = 20  # تغییرهای کوچک‌تر از این تعداد با جزئیات فیلدها ثبت می‌شوند


def _now() -> float:
    return time.time()


def hash_password(pw: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return f"pbkdf2${PBKDF2_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, rounds, salt, dk = stored.split("$")
        test = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(test.hex(), dk)
    except Exception:
        return False


def _tok_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Store:
    def __init__(self, data_dir: str | os.PathLike):
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.dir / "ibp.db", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, name TEXT, pw TEXT,
              role TEXT, companies TEXT, areas TEXT, active INTEGER DEFAULT 1, created_at REAL, last_login REAL);
            CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at REAL, expires_at REAL, client TEXT);
            CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS companies (code TEXT PRIMARY KEY, info TEXT, summary TEXT, created_at REAL);
            CREATE TABLE IF NOT EXISTS records (company TEXT, entity TEXT, id TEXT, data TEXT, deleted INTEGER DEFAULT 0,
              seq INTEGER, origin TEXT, updated_at REAL, updated_by TEXT, PRIMARY KEY (company, entity, id));
            CREATE INDEX IF NOT EXISTS records_seq ON records(company, seq);
            CREATE TABLE IF NOT EXISTS meta (company TEXT, key TEXT, value TEXT, seq INTEGER, origin TEXT, updated_at REAL, updated_by TEXT,
              PRIMARY KEY (company, key));
            CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, user_id INTEGER, username TEXT, company TEXT,
              entity TEXT, record_id TEXT, action TEXT, detail TEXT);
            CREATE INDEX IF NOT EXISTS audit_company ON audit(company, id);
            """
        )
        self.db.commit()
        self.fails: dict[str, list[float]] = {}
        tok = self.kv("setup_token")
        if not tok:
            tok = secrets.token_hex(4).upper()
            self.set_kv("setup_token", tok)
        self.setup_token = tok
        if self.user_count() == 0:
            (self.dir / "setup-token.txt").write_text(tok, encoding="utf-8")

    # ---------- ابزار ----------
    def q(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    def kv(self, key: str) -> Any:
        r = self.q("SELECT value FROM kv WHERE key=?", (key,))
        return json.loads(r[0]["value"]) if r else None

    def set_kv(self, key: str, value: Any) -> None:
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO kv(key,value) VALUES(?,?)", (key, json.dumps(value, ensure_ascii=False)))
            self.db.commit()

    def next_seq(self) -> int:
        n = (self.kv("seq") or 0) + 1
        self.db.execute("INSERT OR REPLACE INTO kv(key,value) VALUES('seq',?)", (json.dumps(n),))
        return n

    def user_count(self) -> int:
        return self.q("SELECT COUNT(*) AS n FROM users")[0]["n"]

    # ---------- کاربران ----------
    @staticmethod
    def public_user(r: sqlite3.Row) -> dict[str, Any]:
        return {"id": r["id"], "username": r["username"], "name": r["name"], "role": r["role"],
                "companies": json.loads(r["companies"] or "[]"), "areas": json.loads(r["areas"] or "[]"),
                "active": bool(r["active"]), "createdAt": r["created_at"], "lastLogin": r["last_login"]}

    def get_user(self, uid: int) -> sqlite3.Row | None:
        r = self.q("SELECT * FROM users WHERE id=?", (uid,))
        return r[0] if r else None

    def create_user(self, d: dict[str, Any]) -> dict[str, Any]:
        username = str(d.get("username") or "").strip()
        if not username or len(username) > 40 or any(c.isspace() for c in username):
            raise HTTPException(400, "نام کاربری معتبر نیست")
        pw = str(d.get("password") or "")
        if len(pw) < 8:
            raise HTTPException(400, "رمز عبور باید دست‌کم ۸ نویسه باشد")
        role, companies, areas = self._clean_access(d)
        with self.lock:
            if self.q("SELECT 1 FROM users WHERE username=?", (username,)):
                raise HTTPException(409, "این نام کاربری وجود دارد")
            cur = self.db.execute(
                "INSERT INTO users(username,name,pw,role,companies,areas,active,created_at) VALUES(?,?,?,?,?,?,1,?)",
                (username, str(d.get("name") or username)[:80], hash_password(pw), role, json.dumps(companies), json.dumps(areas), _now()))
            self.db.commit()
            return self.public_user(self.get_user(cur.lastrowid))

    @staticmethod
    def _clean_access(d: dict[str, Any]) -> tuple[str, list[str], list[str]]:
        role = d.get("role") if d.get("role") in ROLES else "viewer"
        companies = [str(c).upper() for c in (d.get("companies") or []) if str(c).strip()][:200]
        areas = [a for a in (d.get("areas") or []) if a in AREAS]
        if role == "admin":
            companies, areas = ["*"], list(AREAS)
        return role, companies, areas

    def update_user(self, uid: int, d: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
        r = self.get_user(uid)
        if not r:
            raise HTTPException(404, "کاربر یافت نشد")
        role, companies, areas = self._clean_access({**self.public_user(r), **d})
        active = 1 if d.get("active", bool(r["active"])) else 0
        if r["role"] == "admin" and (role != "admin" or not active) and self._admins(exclude=uid) == 0:
            raise HTTPException(400, "دست‌کم یک مدیر سیستم فعال باید باقی بماند")
        with self.lock:
            self.db.execute("UPDATE users SET name=?, role=?, companies=?, areas=?, active=? WHERE id=?",
                            (str(d.get("name") or r["name"])[:80], role, json.dumps(companies), json.dumps(areas), active, uid))
            if not active:
                self.db.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
            self.db.commit()
        self.audit(actor, None, "user", r["username"], "user_update", {"role": role, "companies": companies, "areas": areas, "active": bool(active)})
        return self.public_user(self.get_user(uid))

    def _admins(self, exclude: int | None = None) -> int:
        return self.q("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1 AND id<>?", (exclude or -1,))[0]["n"]

    def set_password(self, uid: int, pw: str) -> None:
        if len(pw) < 8:
            raise HTTPException(400, "رمز عبور باید دست‌کم ۸ نویسه باشد")
        with self.lock:
            self.db.execute("UPDATE users SET pw=? WHERE id=?", (hash_password(pw), uid))
            self.db.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
            self.db.commit()

    # ---------- نشست ----------
    def login(self, username: str, password: str, client: str = "") -> dict[str, Any]:
        key = username.lower()
        recent = [t for t in self.fails.get(key, []) if t > _now() - LOCK_SECONDS]
        self.fails[key] = recent
        if len(recent) >= MAX_FAILS:
            raise HTTPException(429, "تلاش‌های ناموفق زیاد بود؛ یک دقیقه بعد دوباره امتحان کنید")
        r = self.q("SELECT * FROM users WHERE username=?", (username,))
        if not r or not r[0]["active"] or not verify_password(password, r[0]["pw"]):
            self.fails[key].append(_now())
            raise HTTPException(401, "نام کاربری یا رمز عبور نادرست است")
        self.fails.pop(key, None)
        u = r[0]
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.db.execute("INSERT INTO sessions(token,user_id,created_at,expires_at,client) VALUES(?,?,?,?,?)",
                            (_tok_hash(token), u["id"], _now(), _now() + SESSION_HOURS * 3600, client[:120]))
            self.db.execute("UPDATE users SET last_login=? WHERE id=?", (_now(), u["id"]))
            self.db.execute("DELETE FROM sessions WHERE expires_at<?", (_now(),))
            self.db.commit()
        self.audit(self.public_user(u), None, "session", None, "login", {"client": client[:120]})
        return {"token": token, "user": self.public_user(self.get_user(u["id"]))}

    def session_user(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        r = self.q("SELECT s.expires_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?", (_tok_hash(token),))
        if not r or r[0]["expires_at"] < _now() or not r[0]["active"]:
            return None
        with self.lock:  # تمدید خودکار نشست فعال
            self.db.execute("UPDATE sessions SET expires_at=? WHERE token=?", (_now() + SESSION_HOURS * 3600, _tok_hash(token)))
            self.db.commit()
        return self.public_user(r[0])

    def logout(self, token: str) -> None:
        with self.lock:
            self.db.execute("DELETE FROM sessions WHERE token=?", (_tok_hash(token),))
            self.db.commit()

    # ---------- سوابق ----------
    def audit(self, user: dict[str, Any] | None, company: str | None, entity: str | None, record_id: str | None, action: str, detail: Any = None) -> None:
        with self.lock:
            self.db.execute("INSERT INTO audit(ts,user_id,username,company,entity,record_id,action,detail) VALUES(?,?,?,?,?,?,?,?)",
                            (_now(), user and user["id"], user and user["username"], company, entity, record_id, action,
                             json.dumps(detail, ensure_ascii=False) if detail is not None else None))
            self.db.commit()


def can_view(user: dict[str, Any], company: str) -> bool:
    return user["role"] == "admin" or "*" in user["companies"] or company.upper() in user["companies"]


def can_edit(user: dict[str, Any], company: str, area: str | None) -> bool:
    if user["role"] == "admin":
        return True
    return user["role"] == "editor" and can_view(user, company) and area in user["areas"]


def _diff(old: dict[str, Any] | None, new: dict[str, Any]) -> dict[str, Any]:
    if old is None:
        return {"new": {k: v for k, v in list(new.items())[:30]}}
    ch = {k: [old.get(k), new.get(k)] for k in set(old) | set(new) if old.get(k) != new.get(k)}
    return {"changed": dict(list(ch.items())[:30])}


def build_router(store: Store, info: dict[str, Any]) -> APIRouter:
    r = APIRouter(prefix="/api")

    def user_of(authorization: str | None) -> dict[str, Any]:
        tok = authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None
        u = store.session_user(tok)
        if not u:
            raise HTTPException(401, "ورود لازم است")
        return u

    def admin_of(authorization: str | None) -> dict[str, Any]:
        u = user_of(authorization)
        if u["role"] != "admin":
            raise HTTPException(403, "فقط مدیر سیستم")
        return u

    def company_row(code: str) -> sqlite3.Row:
        rr = store.q("SELECT * FROM companies WHERE code=?", (code.upper(),))
        if not rr:
            raise HTTPException(404, "شرکت یافت نشد")
        return rr[0]

    def need_view(u: dict[str, Any], code: str) -> str:
        code = code.upper()
        company_row(code)
        if not can_view(u, code):
            raise HTTPException(403, "به این شرکت دسترسی ندارید")
        return code

    def need_edit(u: dict[str, Any], code: str, area: str | None) -> str:
        code = need_view(u, code)
        if not can_edit(u, code, area):
            raise HTTPException(403, "اجازه ویرایش «" + AREAS.get(area or "", area or "این بخش") + "» را ندارید")
        return code

    # ---------- اطلاعات و راه‌اندازی ----------
    @r.get("/server/info")
    def server_info() -> dict[str, Any]:
        return {"server": True, "name": store.kv("holding_name") or "هلدینگ", "version": info.get("version"), "setupRequired": store.user_count() == 0,
                "roles": ROLES, "areas": AREAS, "entityAreas": ENTITY_AREA, "metaAreas": META_AREA, "cacheMeta": sorted(CACHE_META)}

    @r.post("/setup")
    def setup(d: dict[str, Any] = Body(...), user_agent: str = Header("")) -> dict[str, Any]:
        if store.user_count() > 0:
            raise HTTPException(409, "سیستم قبلاً راه‌اندازی شده است")
        if not hmac.compare_digest(str(d.get("setupToken") or "").strip().upper(), store.setup_token):
            raise HTTPException(403, "کد راه‌اندازی نادرست است")
        store.create_user({**d, "role": "admin"})
        try:
            (store.dir / "setup-token.txt").unlink()
        except OSError:
            pass
        return store.login(str(d.get("username")), str(d.get("password")), user_agent)

    # ---------- نشست ----------
    @r.post("/auth/login")
    def login(d: dict[str, Any] = Body(...), user_agent: str = Header("")) -> dict[str, Any]:
        return store.login(str(d.get("username") or "").strip(), str(d.get("password") or ""), user_agent)

    @r.post("/auth/logout")
    def logout(authorization: str | None = Header(None)) -> dict[str, Any]:
        if authorization and authorization.lower().startswith("bearer "):
            store.logout(authorization[7:])
        return {"ok": True}

    @r.get("/auth/me")
    def me(authorization: str | None = Header(None)) -> dict[str, Any]:
        return user_of(authorization)

    @r.post("/auth/password")
    def change_password(d: dict[str, Any] = Body(...), authorization: str | None = Header(None)) -> dict[str, Any]:
        u = user_of(authorization)
        row = store.get_user(u["id"])
        if not verify_password(str(d.get("old") or ""), row["pw"]):
            raise HTTPException(400, "رمز فعلی نادرست است")
        store.set_password(u["id"], str(d.get("new") or ""))
        store.audit(u, None, "user", u["username"], "password_change")
        return store.login(u["username"], str(d.get("new")), "")

    # ---------- کاربران ----------
    @r.get("/users")
    def users(authorization: str | None = Header(None)) -> list[dict[str, Any]]:
        admin_of(authorization)
        return [store.public_user(x) for x in store.q("SELECT * FROM users ORDER BY id")]

    @r.post("/users")
    def add_user(d: dict[str, Any] = Body(...), authorization: str | None = Header(None)) -> dict[str, Any]:
        a = admin_of(authorization)
        u = store.create_user(d)
        store.audit(a, None, "user", u["username"], "user_create", {"role": u["role"], "companies": u["companies"], "areas": u["areas"]})
        return u

    @r.put("/users/{uid}")
    def edit_user(uid: int, d: dict[str, Any] = Body(...), authorization: str | None = Header(None)) -> dict[str, Any]:
        return store.update_user(uid, d, admin_of(authorization))

    @r.post("/users/{uid}/password")
    def reset_password(uid: int, d: dict[str, Any] = Body(...), authorization: str | None = Header(None)) -> dict[str, Any]:
        a = admin_of(authorization)
        row = store.get_user(uid)
        if not row:
            raise HTTPException(404, "کاربر یافت نشد")
        store.set_password(uid, str(d.get("password") or ""))
        store.audit(a, None, "user", row["username"], "password_reset")
        return {"ok": True}

    # ---------- هلدینگ و شرکت‌ها ----------
    def company_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {**json.loads(row["info"] or "{}"), "code": row["code"], "summary": json.loads(row["summary"]) if row["summary"] else None}

    @r.get("/holding")
    def holding(authorization: str | None = Header(None)) -> dict[str, Any]:
        u = user_of(authorization)
        rows = store.q("SELECT * FROM companies ORDER BY created_at")
        return {"name": store.kv("holding_name"), "version": store.kv("holding_version"), "companies": [company_dict(x) for x in rows if can_view(u, x["code"])]}

    @r.put("/holding")
    def set_holding(d: dict[str, Any] = Body(...), authorization: str | None = Header(None)) -> dict[str, Any]:
        a = admin_of(authorization)
        if "name" in d:
            store.set_kv("holding_name", str(d["name"])[:120])
        if "version" in d:
            store.set_kv("holding_version", d["version"])
        store.audit(a, None, "holding", None, "holding_update", d)
        return {"ok": True}

    @r.post("/companies")
    def add_company(d: dict[str, Any] = Body(...), authorization: str | None = Header(None)) -> dict[str, Any]:
        a = admin_of(authorization)
        code = str(d.get("code") or "").strip().upper()
        if not code or len(code) > 20:
            raise HTTPException(400, "کد شرکت معتبر نیست")
        if store.q("SELECT 1 FROM companies WHERE code=?", (code,)):
            raise HTTPException(409, "کد شرکت تکراری است")
        info_d = {k: d.get(k) for k in ("name", "templateId", "activity", "model", "id", "createdAt") if d.get(k) is not None}
        with store.lock:
            store.db.execute("INSERT INTO companies(code,info,created_at) VALUES(?,?,?)", (code, json.dumps(info_d, ensure_ascii=False), _now()))
            store.db.commit()
        store.audit(a, code, "company", code, "company_create", info_d)
        return company_dict(company_row(code))

    @r.put("/companies/{code}")
    def edit_company(code: str, d: dict[str, Any] = Body(...), authorization: str | None = Header(None)) -> dict[str, Any]:
        a = admin_of(authorization)
        row = company_row(code)
        inf = {**json.loads(row["info"] or "{}"), **{k: d[k] for k in ("name", "templateId", "activity", "model") if k in d}}
        with store.lock:
            store.db.execute("UPDATE companies SET info=? WHERE code=?", (json.dumps(inf, ensure_ascii=False), row["code"]))
            store.db.commit()
        store.audit(a, row["code"], "company", row["code"], "company_update", d)
        return company_dict(company_row(code))

    @r.delete("/companies/{code}")
    def delete_company(code: str, authorization: str | None = Header(None)) -> dict[str, Any]:
        a = admin_of(authorization)
        row = company_row(code)
        with store.lock:
            for t in ("records", "meta"):
                store.db.execute(f"DELETE FROM {t} WHERE company=?", (row["code"],))
            store.db.execute("DELETE FROM companies WHERE code=?", (row["code"],))
            store.db.commit()
        store.audit(a, row["code"], "company", row["code"], "company_delete")
        return {"ok": True}

    @r.put("/companies/{code}/summary")
    def set_summary(code: str, d: dict[str, Any] = Body(...), authorization: str | None = Header(None)) -> dict[str, Any]:
        code = need_view(user_of(authorization), code)
        with store.lock:
            store.db.execute("UPDATE companies SET summary=? WHERE code=?", (json.dumps(d, ensure_ascii=False), code))
            store.db.commit()
        return {"ok": True}

    # ---------- داده هر شرکت ----------
    @r.get("/companies/{code}/data")
    def company_data(code: str, authorization: str | None = Header(None)) -> dict[str, Any]:
        code = need_view(user_of(authorization), code)
        records: dict[str, list[Any]] = {}
        meta: dict[str, Any] = {}
        with store.lock:
            seq = store.kv("seq") or 0
            for x in store.db.execute("SELECT entity, data FROM records WHERE company=? AND deleted=0", (code,)):
                records.setdefault(x["entity"], []).append(json.loads(x["data"]))
            for x in store.db.execute("SELECT key, value FROM meta WHERE company=?", (code,)):
                meta[x["key"]] = json.loads(x["value"])
        return {"records": records, "meta": meta, "seq": seq}

    def write_records(u: dict[str, Any], code: str, entity: str, recs: list[dict[str, Any]], origin: str) -> int:
        n = len(recs)
        with store.lock:
            seq = store.next_seq()
            olds = {}
            if n <= SMALL_WRITE:
                for rec in recs:
                    o = store.db.execute("SELECT data, deleted FROM records WHERE company=? AND entity=? AND id=?", (code, entity, str(rec.get("id")))).fetchone()
                    olds[str(rec.get("id"))] = json.loads(o["data"]) if o and not o["deleted"] else None
            store.db.executemany(
                "INSERT OR REPLACE INTO records(company,entity,id,data,deleted,seq,origin,updated_at,updated_by) VALUES(?,?,?,?,0,?,?,?,?)",
                [(code, entity, str(rec["id"]), json.dumps(rec, ensure_ascii=False), seq, origin, _now(), u["username"]) for rec in recs])
            store.db.commit()
        if n <= SMALL_WRITE:
            for rec in recs:
                old = olds.get(str(rec["id"]))
                if old != rec:
                    store.audit(u, code, entity, str(rec["id"]), "insert" if old is None else "update", _diff(old, rec))
        else:
            store.audit(u, code, entity, None, "bulk_upsert", {"count": n})
        return seq

    @r.post("/companies/{code}/put")
    def put(code: str, d: dict[str, Any] = Body(...), authorization: str | None = Header(None), x_client_id: str = Header("")) -> dict[str, Any]:
        u = user_of(authorization)
        entity = str(d.get("entity") or "")
        recs = [x for x in (d.get("records") or []) if isinstance(x, dict) and x.get("id") is not None]
        code = need_edit(u, code, ENTITY_AREA.get(entity))
        return {"seq": write_records(u, code, entity, recs, x_client_id)}

    @r.post("/companies/{code}/remove")
    def remove(code: str, d: dict[str, Any] = Body(...), authorization: str | None = Header(None), x_client_id: str = Header("")) -> dict[str, Any]:
        u = user_of(authorization)
        entity = str(d.get("entity") or "")
        ids = [str(i) for i in (d.get("ids") or [])]
        code = need_edit(u, code, ENTITY_AREA.get(entity))
        with store.lock:
            seq = store.next_seq()
            store.db.executemany("UPDATE records SET deleted=1, data=NULL, seq=?, origin=?, updated_at=?, updated_by=? WHERE company=? AND entity=? AND id=?",
                                 [(seq, x_client_id, _now(), u["username"], code, entity, i) for i in ids])
            store.db.commit()
        store.audit(u, code, entity, ids[0] if len(ids) == 1 else None, "delete", {"ids": ids[:SMALL_WRITE], "count": len(ids)})
        return {"seq": seq}

    @r.post("/companies/{code}/clear-entity")
    def clear_entity(code: str, d: dict[str, Any] = Body(...), authorization: str | None = Header(None), x_client_id: str = Header("")) -> dict[str, Any]:
        u = user_of(authorization)
        entity = str(d.get("entity") or "")
        code = need_edit(u, code, ENTITY_AREA.get(entity))
        with store.lock:
            seq = store.next_seq()
            cur = store.db.execute("UPDATE records SET deleted=1, data=NULL, seq=?, origin=?, updated_at=?, updated_by=? WHERE company=? AND entity=? AND deleted=0",
                                   (seq, x_client_id, _now(), u["username"], code, entity))
            store.db.commit()
        if cur.rowcount:
            store.audit(u, code, entity, None, "clear", {"count": cur.rowcount})
        return {"seq": seq}

    @r.put("/companies/{code}/meta/{key}")
    def set_meta(code: str, key: str, d: dict[str, Any] = Body(...), authorization: str | None = Header(None), x_client_id: str = Header("")) -> dict[str, Any]:
        u = user_of(authorization)
        if key in CACHE_META:
            code = need_view(u, code)
        else:
            code = need_edit(u, code, META_AREA.get(key, "settings"))
        value = json.dumps(d.get("value"), ensure_ascii=False)
        with store.lock:
            old = store.db.execute("SELECT value FROM meta WHERE company=? AND key=?", (code, key)).fetchone()
            seq = store.next_seq()
            store.db.execute("INSERT OR REPLACE INTO meta(company,key,value,seq,origin,updated_at,updated_by) VALUES(?,?,?,?,?,?,?)",
                             (code, key, value, seq, x_client_id, _now(), u["username"]))
            store.db.commit()
        if key not in CACHE_META and (not old or old["value"] != value):
            ov = json.loads(old["value"]) if old else None
            detail = _diff(ov, d.get("value")) if isinstance(ov, dict) and isinstance(d.get("value"), dict) and len(value) < 20000 else {"size": len(value)}
            store.audit(u, code, "meta", key, "meta_update", detail)
        return {"seq": seq}

    @r.post("/companies/{code}/clear-all")
    def clear_all(code: str, authorization: str | None = Header(None), x_client_id: str = Header("")) -> dict[str, Any]:
        u = user_of(authorization)
        code = need_view(u, code)
        if not all(can_edit(u, code, a) for a in AREAS):
            raise HTTPException(403, "پاک کردن همه داده‌ها فقط با اجازه ویرایش همه حوزه‌ها ممکن است")
        with store.lock:
            seq = store.next_seq()
            store.db.execute("UPDATE records SET deleted=1, data=NULL, seq=?, origin=?, updated_at=?, updated_by=? WHERE company=? AND deleted=0",
                             (seq, x_client_id, _now(), u["username"], code))
            store.db.execute("DELETE FROM meta WHERE company=?", (code,))
            store.db.commit()
        store.audit(u, code, None, None, "clear_all")
        return {"seq": seq}

    @r.get("/companies/{code}/changes")
    def changes(code: str, since: int = 0, authorization: str | None = Header(None), x_client_id: str = Header("")) -> dict[str, Any]:
        code = need_view(user_of(authorization), code)
        out: list[dict[str, Any]] = []
        meta: dict[str, Any] = {}
        by: set[str] = set()
        with store.lock:
            seq = store.kv("seq") or 0
            rows = store.db.execute("SELECT entity,id,data,deleted,origin,updated_by FROM records WHERE company=? AND seq>? AND seq<=? ORDER BY seq LIMIT 50001",
                                    (code, since, seq)).fetchall()
            mrows = store.db.execute("SELECT key,value,origin,updated_by FROM meta WHERE company=? AND seq>? AND seq<=?", (code, since, seq)).fetchall()
        if len(rows) > 50000:
            return {"seq": seq, "reload": True}
        for x in rows:
            if x["origin"] and x["origin"] == x_client_id:
                continue
            out.append({"entity": x["entity"], "id": x["id"], "deleted": bool(x["deleted"]), "data": json.loads(x["data"]) if x["data"] else None})
            by.add(x["updated_by"])
        for x in mrows:
            if x["origin"] and x["origin"] == x_client_id:
                continue
            meta[x["key"]] = json.loads(x["value"])
            by.add(x["updated_by"])
        return {"seq": seq, "records": out, "meta": meta, "by": sorted(b for b in by if b)}

    # ---------- سوابق تغییرات ----------
    @r.get("/audit")
    def audit(company: str = "", username: str = "", entity: str = "", action: str = "", before: int = 0, limit: int = 200,
              authorization: str | None = Header(None)) -> dict[str, Any]:
        u = user_of(authorization)
        where, args = ["1=1"], []
        if company:
            where.append("company=?")
            args.append(need_view(u, company))
        elif u["role"] != "admin":
            allowed = [x["code"] for x in store.q("SELECT code FROM companies") if can_view(u, x["code"])]
            where.append("company IN (%s)" % ",".join("?" * len(allowed)) if allowed else "0")
            args += allowed
        for col, val in (("username", username), ("entity", entity), ("action", action)):
            if val:
                where.append(f"{col}=?")
                args.append(val)
        if before:
            where.append("id<?")
            args.append(before)
        limit = max(1, min(int(limit), 1000))
        rows = store.q(f"SELECT * FROM audit WHERE {' AND '.join(where)} ORDER BY id DESC LIMIT ?", tuple(args) + (limit,))
        return {"items": [{"id": x["id"], "ts": x["ts"], "username": x["username"], "company": x["company"], "entity": x["entity"],
                           "recordId": x["record_id"], "action": x["action"], "detail": json.loads(x["detail"]) if x["detail"] else None} for x in rows]}

    return r


PUBLIC_PREFIXES = ("/api/", "/health")
ANALYSIS_PREFIXES = ("/portfolio/", "/demand/", "/supply/", "/scenarios/", "/reports/", "/agent/")


def install(app: Any, data_dir: str, app_dir: str | None, version: str) -> Store:
    """فعال‌سازی حالت سرور روی برنامه FastAPI موتور."""
    from fastapi.middleware.gzip import GZipMiddleware
    from fastapi.responses import JSONResponse
    from fastapi.staticfiles import StaticFiles

    store = Store(data_dir)
    app.state.ibp_store = store
    app.include_router(build_router(store, {"version": version}))
    app.add_middleware(GZipMiddleware, minimum_size=2048)

    @app.middleware("http")
    async def require_login_for_analysis(request: Request, call_next):
        # تحلیل‌ها و دستیار هوشمند (با کلید Claude سرور) فقط برای کاربران واردشده
        if request.method != "OPTIONS" and request.url.path.startswith(ANALYSIS_PREFIXES):
            auth = request.headers.get("authorization") or ""
            if not store.session_user(auth[7:] if auth.lower().startswith("bearer ") else None):
                return JSONResponse({"detail": "ورود لازم است"}, status_code=401)
        return await call_next(request)

    if app_dir and Path(app_dir).is_dir():
        app.mount("/", StaticFiles(directory=app_dir, html=True), name="app")
    return store

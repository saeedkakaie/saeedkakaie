# -*- coding: utf-8 -*-
"""منطق کسب‌وکار هسته‌ی سامانه: تولید خودکار شرح، گیت جستجوی تکرار، صدور کد، کرالجیک."""
from sqlalchemy.orm import Session
from rapidfuzz import fuzz, process

import models as m
from cleanup_engine import loose_key, map_group

DUP_BLOCK_THRESHOLD = 90
DUP_WARN_THRESHOLD = 72
OTHER_VALUE = "سایر - نیازمند تعریف توسط حاکمیت داده"


def build_description(item_type: m.ItemType, ordered_values: list[str]):
    """شرح کامل = نوع کالا + ویژگی‌ها به ترتیب قالب (قاعده ۷ سند فنی)."""
    tokens = [item_type.name] + [v for v in ordered_values if v]
    full = " ".join(tokens)
    max_len = item_type.description_max_len or 40
    short = full if len(full) <= max_len else (full[: max_len - 1].rstrip() + "…")
    return full, short


def duplicate_gate(db: Session, item_type: m.ItemType, full_description: str, exclude_material_id=None):
    """جستجوی فازی شرح تولیدشده در بین کالاهای فعال/در جریان و بانک Legacy هم‌گروه.
    آستانه‌ی سند فنی: هشدار ۷۲٪ / مسدودسازی ۹۰٪."""
    key = loose_key(full_description)
    candidates = []  # (label, code_or_draft, score, source)

    q = (
        db.query(m.Material)
        .join(m.ItemType, m.Material.item_type_id == m.ItemType.id)
        .filter(m.ItemType.group_id == item_type.group_id)
        .filter(m.Material.status != "rejected")
    )
    if exclude_material_id:
        q = q.filter(m.Material.id != exclude_material_id)
    active_materials = q.all()
    pool = {mat.id: mat.description_loose_key for mat in active_materials if mat.description_loose_key}
    if pool:
        for _label, score, mid in process.extract(key, pool, scorer=fuzz.token_sort_ratio, limit=5):
            mat = next(x for x in active_materials if x.id == mid)
            if score >= DUP_WARN_THRESHOLD:
                candidates.append({
                    "label": mat.description,
                    "code": mat.code or mat.draft_no,
                    "status": mat.status,
                    "score": round(score, 1),
                    "source": "کالاهای فعال/در جریان تایید",
                })

    group_name = item_type.group.name
    legacy_pool_records = (
        db.query(m.LegacyRecord)
        .filter(m.LegacyRecord.material_group_mapped == group_name)
        .limit(20000)
        .all()
    )
    if legacy_pool_records:
        legacy_pool = {r.id: loose_key(r.description_normalized) for r in legacy_pool_records}
        for _label, score, rid in process.extract(key, legacy_pool, scorer=fuzz.token_sort_ratio, limit=5):
            rec = next(x for x in legacy_pool_records if x.id == rid)
            if score >= DUP_WARN_THRESHOLD:
                candidates.append({
                    "label": rec.description_normalized,
                    "code": rec.code,
                    "status": "بانک فعلی (legacy)",
                    "score": round(score, 1),
                    "source": "بانک کالای فعلی",
                })

    candidates.sort(key=lambda c: -c["score"])
    top_score = candidates[0]["score"] if candidates else 0
    if top_score >= DUP_BLOCK_THRESHOLD:
        verdict = "block"
    elif top_score >= DUP_WARN_THRESHOLD:
        verdict = "warn"
    else:
        verdict = "pass"
    return {"verdict": verdict, "candidates": candidates[:8], "loose_key": key}


def next_draft_no(db: Session):
    count = db.query(m.Material).count()
    return f"DRAFT-{count + 1:06d}"


def issue_code(db: Session, material: m.Material):
    group = material.item_type.group
    serial = group.next_serial
    group.next_serial = serial + 1
    material.code = f"{group.number_range_prefix}{serial:05d}"


def compute_kraljic(score_supply_risk: int, score_profit_impact: int):
    risk_band = "high" if score_supply_risk >= 4 else "low"
    impact_band = "high" if score_profit_impact >= 4 else "low"
    quadrant, strategy = m.KRALJIC_QUADRANTS[(risk_band, impact_band)]
    return quadrant, strategy

# -*- coding: utf-8 -*-
"""
سامانه‌ی کدینگ استاندارد کالا و حاکمیت داده‌ی زنجیره‌ی تامین
================================================================
دو بخش اصلی:
  ۱) عارضه‌یابی/پاکسازی بانک کالای فعلی (Legacy)
  ۲) منطق تعریف کد جدید — بدون تایپ آزاد، شرح خودکار، گیت تکرار، گردش تایید،
     دیتاشیت خرید، و ماتریس کرالجیک.
"""
import io
import os
from urllib.parse import quote

import pandas as pd
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import StreamingResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

import models as m
import schemas as sch
import business as biz
from database import Base, engine, get_db
from cleanup_engine import analyze_legacy, read_input_dataframe, STANDARD_GROUPS
from legacy_export import build_report_xlsx

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(BASE_DIR)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="سامانه کدینگ استاندارد کالا")
app.mount("/static", StaticFiles(directory=os.path.join(APP_DIR, "frontend", "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(APP_DIR, "frontend", "templates"))

WORKFLOW_STEPS = m.WORKFLOW_STEPS
STEP_ORDER = [k for k, _ in WORKFLOW_STEPS]
STATUS_AFTER_STEP = {
    "duplicate_gate": "pending_technical",
    "technical": "pending_commercial",
    "commercial": "pending_mrp",
    "mrp": "pending_governance",
    "governance": "active",
}
STATUS_LABELS = {
    "draft": "پیش‌نویس", "duplicate_hold": "متوقف - تکرار احتمالی",
    "pending_technical": "در انتظار تایید فنی", "pending_commercial": "در انتظار تایید بازرگانی",
    "pending_mrp": "در انتظار تایید MRP", "pending_governance": "در انتظار تایید حاکمیت داده",
    "active": "فعال / صادرشده", "rejected": "رد شده", "merged": "ادغام‌شده با کد موجود",
}


def base_ctx(db: Session, request: Request, **extra):
    ctx = {
        "request": request,
        "groups": db.query(m.MaterialGroup).order_by(m.MaterialGroup.sort_order).all(),
        "users": db.query(m.AppUser).all(),
        "status_labels": STATUS_LABELS,
    }
    ctx.update(extra)
    return ctx


# ---------------------------------------------------------------------------
# صفحات
# ---------------------------------------------------------------------------

@app.get("/")
def dashboard(request: Request, db: Session = Depends(get_db)):
    total_materials = db.query(m.Material).count()
    active_materials = db.query(m.Material).filter(m.Material.status == "active").count()
    in_progress = db.query(m.Material).filter(
        ~m.Material.status.in_(["active", "rejected", "merged"])
    ).count()
    by_group = (
        db.query(m.MaterialGroup.name, m.ItemType.id)
        .join(m.ItemType, m.ItemType.group_id == m.MaterialGroup.id)
        .all()
    )
    group_counts = {}
    materials = db.query(m.Material).all()
    for mat in materials:
        gname = mat.item_type.group.name
        group_counts[gname] = group_counts.get(gname, 0) + 1

    kraljic_rows = db.query(m.KraljicAssessment).all()
    kraljic_dist = {"استراتژیک (Strategic)": 0, "اهرمی (Leverage)": 0, "گلوگاهی (Bottleneck)": 0, "عمومی / غیربحرانی": 0}
    for k in kraljic_rows:
        kraljic_dist[k.quadrant] = kraljic_dist.get(k.quadrant, 0) + 1

    latest_batch = db.query(m.LegacyImportBatch).order_by(m.LegacyImportBatch.id.desc()).first()
    missing_requests_open = db.query(m.MissingValueRequest).filter(m.MissingValueRequest.status == "باز").count()

    recent_materials = db.query(m.Material).order_by(m.Material.id.desc()).limit(8).all()

    return templates.TemplateResponse(request, "dashboard.html", base_ctx(
        db, request,
        total_materials=total_materials, active_materials=active_materials,
        in_progress=in_progress, group_counts=group_counts,
        kraljic_dist=kraljic_dist, latest_batch=latest_batch,
        missing_requests_open=missing_requests_open, recent_materials=recent_materials,
    ))


@app.get("/materials")
def materials_list(request: Request, db: Session = Depends(get_db), q: str = "", status: str = "", group_id: int = 0):
    query = db.query(m.Material)
    if status:
        query = query.filter(m.Material.status == status)
    if group_id:
        query = query.join(m.ItemType).filter(m.ItemType.group_id == group_id)
    if q:
        like = f"%{q}%"
        query = query.filter((m.Material.description.like(like)) | (m.Material.code.like(like)) | (m.Material.draft_no.like(like)))
    materials = query.order_by(m.Material.id.desc()).limit(300).all()
    return templates.TemplateResponse(request, "materials_list.html", base_ctx(
        db, request, materials=materials, q=q, status=status, group_id=group_id,
    ))


@app.get("/materials/new")
def materials_new(request: Request, db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "wizard.html", base_ctx(
        db, request, units=db.query(m.UnitOfMeasure).all(), plants=db.query(m.Plant).all(),
        submitters=db.query(m.AppUser).filter(m.AppUser.role == "submitter").all(),
    ))


@app.get("/materials/{material_id}")
def material_detail(material_id: int, request: Request, db: Session = Depends(get_db)):
    mat = db.query(m.Material).get(material_id)
    if not mat:
        raise HTTPException(404, "کالا یافت نشد")
    suppliers = db.query(m.Supplier).all()
    return templates.TemplateResponse(request, "material_detail.html", base_ctx(
        db, request, mat=mat, workflow_steps=WORKFLOW_STEPS, suppliers=suppliers,
        LEAD_TIME_BANDS=m.LEAD_TIME_BANDS, PRICE_BANDS=m.PRICE_BANDS, INCOTERMS=m.INCOTERMS,
        ORIGIN_OPTIONS=m.ORIGIN_OPTIONS,
    ))


@app.get("/kraljic")
def kraljic_page(request: Request, db: Session = Depends(get_db)):
    rows = db.query(m.KraljicAssessment).all()
    points = [{
        "code": k.material.code or k.material.draft_no,
        "desc": k.material.description,
        "group": k.material.item_type.group.name,
        "x": k.supply_risk_score, "y": k.profit_impact_score,
        "quadrant": k.quadrant,
    } for k in rows]
    return templates.TemplateResponse(request, "kraljic.html", base_ctx(db, request, points=points))


@app.get("/legacy")
def legacy_home(request: Request, db: Session = Depends(get_db)):
    batches = db.query(m.LegacyImportBatch).order_by(m.LegacyImportBatch.id.desc()).all()
    return templates.TemplateResponse(request, "legacy_home.html", base_ctx(db, request, batches=batches))


@app.post("/legacy/upload")
async def legacy_upload(request: Request, db: Session = Depends(get_db), file: UploadFile = File(...)):
    content = await file.read()
    try:
        df = read_input_dataframe(io.BytesIO(content))
    except Exception as e:
        batches = db.query(m.LegacyImportBatch).order_by(m.LegacyImportBatch.id.desc()).all()
        return templates.TemplateResponse(request, "legacy_home.html", base_ctx(
            db, request, batches=batches, error=str(e),
        ))
    result = analyze_legacy(df)

    batch = m.LegacyImportBatch(filename=file.filename, row_count=len(df), kpi_json=result["kpi"])
    db.add(batch)
    db.flush()

    cluster_objs = []
    for c in result["clusters"]:
        obj = m.LegacyDuplicateCluster(
            batch_id=batch.id, kind=c["kind"], normalized_desc=c["normalized_desc"],
            codes_json=c["codes"], golden_code=str(c["golden_code"]),
            group_conflict=c["group_conflict"], unit_conflict=c["unit_conflict"],
        )
        db.add(obj)
        cluster_objs.append(obj)
    db.flush()

    for r in result["records"]:
        cluster_id = cluster_objs[r["cluster_idx"]].id if r["cluster_idx"] is not None else None
        db.add(m.LegacyRecord(
            batch_id=batch.id, plant=str(r["plant"]), material_group_raw=str(r["material_group_raw"]),
            material_group_mapped=r["material_group_mapped"], code=r["code"],
            description_raw=str(r["description_raw"]), description_normalized=r["description_normalized"],
            unit=str(r["unit"]), quote_issue=r["quote_issue"], needs_text_normalization=r["needs_text_normalization"],
            group_missing=r["group_missing"], unit_conflict=r["unit_conflict"], duplicate_exact=r["duplicate_exact"],
            duplicate_loose=r["duplicate_loose"], non_compliant_new_rule=r["non_compliant_new_rule"],
            non_compliance_reasons=r["non_compliance_reasons"], cluster_id=cluster_id,
            suggested_final_code=r["suggested_final_code"],
        ))
    db.commit()
    return RedirectResponse(url=f"/legacy/{batch.id}", status_code=303)


@app.get("/legacy/{batch_id}")
def legacy_report(batch_id: int, request: Request, db: Session = Depends(get_db), filter: str = "all", q: str = ""):
    batch = db.query(m.LegacyImportBatch).get(batch_id)
    if not batch:
        raise HTTPException(404, "دسته وارداتی یافت نشد")
    query = db.query(m.LegacyRecord).filter(m.LegacyRecord.batch_id == batch_id)
    if filter == "duplicate":
        query = query.filter((m.LegacyRecord.duplicate_exact == True) | (m.LegacyRecord.duplicate_loose == True))  # noqa: E712
    elif filter == "unit_conflict":
        query = query.filter(m.LegacyRecord.unit_conflict == True)  # noqa: E712
    elif filter == "non_compliant":
        query = query.filter(m.LegacyRecord.non_compliant_new_rule == True)  # noqa: E712
    elif filter == "group_missing":
        query = query.filter(m.LegacyRecord.group_missing == True)  # noqa: E712
    if q:
        like = f"%{q}%"
        query = query.filter((m.LegacyRecord.description_raw.like(like)) | (m.LegacyRecord.code.like(like)))
    records = query.limit(500).all()
    clusters = db.query(m.LegacyDuplicateCluster).filter(m.LegacyDuplicateCluster.batch_id == batch_id).order_by(
        m.LegacyDuplicateCluster.group_conflict.desc()
    ).limit(300).all()
    return templates.TemplateResponse(request, "legacy_report.html", base_ctx(
        db, request, batch=batch, records=records, clusters=clusters, filter=filter, q=q,
    ))


@app.get("/legacy/{batch_id}/export")
def legacy_export(batch_id: int, db: Session = Depends(get_db)):
    batch = db.query(m.LegacyImportBatch).get(batch_id)
    if not batch:
        raise HTTPException(404, "یافت نشد")
    clusters = db.query(m.LegacyDuplicateCluster).filter(m.LegacyDuplicateCluster.batch_id == batch_id).all()
    records = db.query(m.LegacyRecord).filter(m.LegacyRecord.batch_id == batch_id).all()
    clusters_d = [{
        "kind": c.kind, "normalized_desc": c.normalized_desc, "codes": c.codes_json,
        "golden_code": c.golden_code, "group_conflict": c.group_conflict, "unit_conflict": c.unit_conflict,
    } for c in clusters]
    records_d = [{
        "plant": r.plant, "code": r.code, "material_group_raw": r.material_group_raw,
        "material_group_mapped": r.material_group_mapped, "description_raw": r.description_raw,
        "description_normalized": r.description_normalized, "unit": r.unit,
        "suggested_final_code": r.suggested_final_code, "quote_issue": r.quote_issue,
        "needs_text_normalization": r.needs_text_normalization, "group_missing": r.group_missing,
        "unit_conflict": r.unit_conflict, "duplicate_exact": r.duplicate_exact,
        "duplicate_loose": r.duplicate_loose, "non_compliant_new_rule": r.non_compliant_new_rule,
        "non_compliance_reasons": r.non_compliance_reasons or [],
    } for r in records]
    xlsx_bytes = build_report_xlsx(batch.kpi_json, clusters_d, records_d)
    fa_filename = f"گزارش_پاکسازی_{batch_id}.xlsx"
    disposition = f"attachment; filename=\"cleanup_report_{batch_id}.xlsx\"; filename*=UTF-8''{quote(fa_filename)}"
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": disposition},
    )


@app.get("/classification")
def classification_page(request: Request, db: Session = Depends(get_db)):
    groups = db.query(m.MaterialGroup).order_by(m.MaterialGroup.sort_order).all()
    open_requests = db.query(m.MissingValueRequest).filter(m.MissingValueRequest.status == "باز").all()
    units = db.query(m.UnitOfMeasure).all()
    return templates.TemplateResponse(request, "classification.html", base_ctx(
        db, request, groups_full=groups, open_requests=open_requests, units=units,
    ))


# ---------------------------------------------------------------------------
# API — طبقه‌بندی آبشاری (کاسکید) برای ویزارد بدون‌تایپ
# ---------------------------------------------------------------------------

@app.get("/api/groups/{group_id}/item-types")
def api_item_types(group_id: int, db: Session = Depends(get_db)):
    its = db.query(m.ItemType).filter(m.ItemType.group_id == group_id, m.ItemType.is_active == True).all()  # noqa: E712
    return [{"id": it.id, "name": it.name, "default_unit_id": it.default_unit_id} for it in its]


@app.get("/api/item-types/{item_type_id}/attributes")
def api_attributes(item_type_id: int, db: Session = Depends(get_db)):
    it = db.query(m.ItemType).get(item_type_id)
    if not it:
        raise HTTPException(404, "نوع کالا یافت نشد")
    out = []
    for a in it.attributes:
        out.append({
            "id": a.id, "name": a.name, "order_index": a.order_index, "is_required": a.is_required,
            "values": [{"id": v.id, "value": v.value, "is_other": v.value == biz.OTHER_VALUE}
                       for v in a.values if v.is_active],
        })
    return {"item_type": {"id": it.id, "name": it.name, "default_unit_id": it.default_unit_id,
                           "description_max_len": it.description_max_len}, "attributes": out}


def _resolve_selection(db: Session, item_type_id: int, selections: list):
    it = db.query(m.ItemType).get(item_type_id)
    if not it:
        raise HTTPException(404, "نوع کالا یافت نشد")
    sel_by_attr = {s.attribute_id: s.attribute_value_id for s in selections}
    ordered_values = []
    ordered_pairs = []
    other_selected = []
    for attr in it.attributes:
        vid = sel_by_attr.get(attr.id)
        if vid is None:
            if attr.is_required:
                raise HTTPException(400, f"ویژگی «{attr.name}» انتخاب نشده است")
            continue
        val = db.query(m.AttributeValue).get(vid)
        if not val or val.attribute_id != attr.id:
            raise HTTPException(400, "مقدار انتخابی نامعتبر است")
        if val.value == biz.OTHER_VALUE:
            other_selected.append(attr)
            continue
        ordered_values.append(val.value)
        ordered_pairs.append((attr, val))
    return it, ordered_values, ordered_pairs, other_selected


@app.post("/api/materials/preview")
def api_materials_preview(body: sch.MaterialPreviewIn, db: Session = Depends(get_db)):
    it, ordered_values, ordered_pairs, other_selected = _resolve_selection(db, body.item_type_id, body.selections)
    if other_selected:
        return {
            "blocked_reason": "missing_value",
            "missing_attributes": [{"id": a.id, "name": a.name} for a in other_selected],
        }
    full, short = biz.build_description(it, ordered_values)
    gate = biz.duplicate_gate(db, it, full, exclude_material_id=body.exclude_material_id)
    return {"description": full, "description_short": short, "gate": gate}


@app.post("/api/materials")
def api_materials_create(body: sch.MaterialCreateIn, db: Session = Depends(get_db)):
    it, ordered_values, ordered_pairs, other_selected = _resolve_selection(db, body.item_type_id, body.selections)
    if other_selected:
        raise HTTPException(400, "برخی ویژگی‌ها فاقد مقدار مناسب هستند؛ ابتدا درخواست افزودن مقدار ثبت کنید")
    unit = db.query(m.UnitOfMeasure).get(body.unit_id)
    if not unit:
        raise HTTPException(400, "واحد نامعتبر")
    if not body.plant_codes:
        raise HTTPException(400, "حداقل یک پلنت باید انتخاب شود")
    user = db.query(m.AppUser).get(body.requested_by_id)
    if not user:
        raise HTTPException(400, "کاربر نامعتبر")

    full, short = biz.build_description(it, ordered_values)
    gate = biz.duplicate_gate(db, it, full)
    if gate["verdict"] == "block":
        raise HTTPException(409, {"message": "این کالا با احتمال بسیار بالا در بانک کالا موجود است؛ ثبت مسدود شد.", "gate": gate})
    if gate["verdict"] == "warn" and not body.acknowledge_warning:
        raise HTTPException(409, {"message": "موارد مشابه یافت شد؛ لطفاً بررسی و تایید کنید.", "gate": gate})

    mat = m.Material(
        draft_no=biz.next_draft_no(db), item_type_id=it.id, unit_id=unit.id,
        plants=body.plant_codes, description=full, description_short=short,
        description_loose_key=gate["loose_key"], status="pending_technical",
        duplicate_candidates_json=gate["candidates"], requested_by=user.full_name,
    )
    db.add(mat)
    db.flush()

    for attr, val in ordered_pairs:
        db.add(m.MaterialAttributeValue(material_id=mat.id, attribute_id=attr.id, attribute_value_id=val.id))

    db.add(m.ApprovalStep(
        material_id=mat.id, step_key="duplicate_gate", step_label=dict(WORKFLOW_STEPS)["duplicate_gate"],
        status="approved", actor="سیستم (گیت خودکار)", acted_at=m.now(),
        comment=f"نتیجه: {gate['verdict']} — {len(gate['candidates'])} مورد مشابه یافت شد." if gate["candidates"] else "موردی مشابه یافت نشد.",
    ))
    for key, label in WORKFLOW_STEPS[1:]:
        db.add(m.ApprovalStep(material_id=mat.id, step_key=key, step_label=label, status="pending"))

    db.commit()
    return {"id": mat.id, "draft_no": mat.draft_no}


@app.post("/api/materials/{material_id}/approve")
def api_material_approve(material_id: int, body: sch.ApprovalActionIn, db: Session = Depends(get_db)):
    mat = db.query(m.Material).get(material_id)
    if not mat:
        raise HTTPException(404, "کالا یافت نشد")
    step = db.query(m.ApprovalStep).filter(
        m.ApprovalStep.material_id == material_id, m.ApprovalStep.step_key == body.step_key
    ).first()
    if not step or step.status != "pending":
        raise HTTPException(400, "این مرحله در وضعیت قابل‌اقدام نیست")
    user = db.query(m.AppUser).get(body.actor_id)
    if not user:
        raise HTTPException(400, "کاربر نامعتبر")

    step.status = "approved" if body.decision == "approve" else "rejected"
    step.actor = user.full_name
    step.acted_at = m.now()
    step.comment = body.comment

    if body.decision == "approve":
        mat.status = STATUS_AFTER_STEP[body.step_key]
        if body.step_key == "governance":
            biz.issue_code(db, mat)
    else:
        mat.status = "rejected"

    db.commit()
    return {"status": mat.status, "code": mat.code}


@app.post("/api/materials/{material_id}/datasheet")
def api_datasheet_upsert(material_id: int, body: sch.DatasheetIn, db: Session = Depends(get_db)):
    mat = db.query(m.Material).get(material_id)
    if not mat:
        raise HTTPException(404, "کالا یافت نشد")
    ds = mat.datasheet
    if not ds:
        ds = m.Datasheet(material_id=material_id)
        db.add(ds)
    for field, value in body.dict().items():
        setattr(ds, field, value)
    db.commit()
    return {"ok": True}


@app.post("/api/materials/{material_id}/kraljic")
def api_kraljic_upsert(material_id: int, body: sch.KraljicIn, db: Session = Depends(get_db)):
    mat = db.query(m.Material).get(material_id)
    if not mat:
        raise HTTPException(404, "کالا یافت نشد")
    if not (1 <= body.supply_risk_score <= 5 and 1 <= body.profit_impact_score <= 5):
        raise HTTPException(400, "امتیاز باید بین ۱ تا ۵ باشد")
    quadrant, strategy = biz.compute_kraljic(body.supply_risk_score, body.profit_impact_score)
    kr = mat.kraljic
    if not kr:
        kr = m.KraljicAssessment(material_id=material_id)
        db.add(kr)
    kr.supply_risk_score = body.supply_risk_score
    kr.profit_impact_score = body.profit_impact_score
    kr.quadrant = quadrant
    kr.strategy_note = strategy
    db.commit()
    return {"quadrant": quadrant, "strategy_note": strategy}


@app.post("/api/missing-value-request")
def api_missing_value_request(body: sch.MissingValueRequestIn, db: Session = Depends(get_db)):
    user = db.query(m.AppUser).get(body.requested_by_id)
    db.add(m.MissingValueRequest(
        item_type_id=body.item_type_id, attribute_id=body.attribute_id,
        note=body.note, requested_by=user.full_name if user else "",
    ))
    db.commit()
    return {"ok": True}


@app.post("/api/classification/attribute-values")
def api_add_attribute_value(body: sch.ClassificationValueIn, db: Session = Depends(get_db)):
    attr = db.query(m.Attribute).get(body.attribute_id)
    if not attr:
        raise HTTPException(404, "ویژگی یافت نشد")
    exists = db.query(m.AttributeValue).filter(
        m.AttributeValue.attribute_id == attr.id, m.AttributeValue.value == body.value
    ).first()
    if exists:
        raise HTTPException(400, "این مقدار از قبل موجود است")
    max_order = db.query(m.AttributeValue).filter(m.AttributeValue.attribute_id == attr.id).count()
    db.add(m.AttributeValue(attribute_id=attr.id, value=body.value, sort_order=max_order))
    db.commit()
    return {"ok": True}


@app.post("/api/classification/item-types")
def api_add_item_type(body: sch.ClassificationItemTypeIn, db: Session = Depends(get_db)):
    db.add(m.ItemType(group_id=body.group_id, name=body.name, default_unit_id=body.default_unit_id))
    db.commit()
    return {"ok": True}


@app.post("/api/classification/attributes")
def api_add_attribute(body: sch.ClassificationAttributeIn, db: Session = Depends(get_db)):
    db.add(m.Attribute(item_type_id=body.item_type_id, name=body.name, order_index=body.order_index, is_required=body.is_required))
    db.commit()
    return {"ok": True}


@app.post("/api/missing-value-requests/{request_id}/resolve")
def api_resolve_missing_value_request(request_id: int, db: Session = Depends(get_db)):
    req = db.query(m.MissingValueRequest).get(request_id)
    if not req:
        raise HTTPException(404, "درخواست یافت نشد")
    req.status = "برطرف‌شد"
    db.commit()
    return {"ok": True}


@app.post("/legacy/sample-data")
def load_sample_legacy(db: Session = Depends(get_db)):
    """بارگذاری یک بانک نمونه (مصنوعی) برای دمو — جایگزین داده‌ی واقعی هلدینگ نیست."""
    from sample_data import build_sample_dataframe
    df = build_sample_dataframe()
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)
    result = analyze_legacy(df)
    batch = m.LegacyImportBatch(filename="sample_legacy_demo.xlsx", row_count=len(df), kpi_json=result["kpi"])
    db.add(batch)
    db.flush()
    cluster_objs = []
    for c in result["clusters"]:
        obj = m.LegacyDuplicateCluster(
            batch_id=batch.id, kind=c["kind"], normalized_desc=c["normalized_desc"],
            codes_json=c["codes"], golden_code=str(c["golden_code"]),
            group_conflict=c["group_conflict"], unit_conflict=c["unit_conflict"],
        )
        db.add(obj)
        cluster_objs.append(obj)
    db.flush()
    for r in result["records"]:
        cluster_id = cluster_objs[r["cluster_idx"]].id if r["cluster_idx"] is not None else None
        db.add(m.LegacyRecord(
            batch_id=batch.id, plant=str(r["plant"]), material_group_raw=str(r["material_group_raw"]),
            material_group_mapped=r["material_group_mapped"], code=r["code"],
            description_raw=str(r["description_raw"]), description_normalized=r["description_normalized"],
            unit=str(r["unit"]), quote_issue=r["quote_issue"], needs_text_normalization=r["needs_text_normalization"],
            group_missing=r["group_missing"], unit_conflict=r["unit_conflict"], duplicate_exact=r["duplicate_exact"],
            duplicate_loose=r["duplicate_loose"], non_compliant_new_rule=r["non_compliant_new_rule"],
            non_compliance_reasons=r["non_compliance_reasons"], cluster_id=cluster_id,
            suggested_final_code=r["suggested_final_code"],
        ))
    db.commit()
    return RedirectResponse(url=f"/legacy/{batch.id}", status_code=303)

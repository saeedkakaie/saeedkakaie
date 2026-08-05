# -*- coding: utf-8 -*-
"""
مدل‌های داده‌ی سامانه کدینگ استاندارد کالا.

فلسفه‌ی طراحی (طبق سند فنی پروژه):
  - کد کالا: سریالی و بدون معنا، فقط بعد از عبور کامل از گردش‌کار تایید صادر می‌شود.
  - شرح کالا: هرگز تایپ آزاد نیست؛ همیشه از ترکیب ویژگی‌های انتخابی (Picklist) ساخته می‌شود.
  - هر «نوع کالا» یک قالب ثابت ویژگی دارد (Attribute Template).
  - بانک کالای فعلی (legacy) جدا از فرآیند صدور کد جدید نگهداری و عارضه‌یابی می‌شود.
"""
import datetime as dt
import enum

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, JSON,
    String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


def now():
    return dt.datetime.utcnow()


# ---------------------------------------------------------------------------
# ۱) طبقه‌بندی (Classification) — همه Picklist، بدون متن آزاد برای کاربر عادی
# ---------------------------------------------------------------------------

class MaterialGroup(Base):
    """۱۸ گروه اصلی متریال (ساده‌شده از ۶۸ گروه خام SAP)."""
    __tablename__ = "material_groups"

    id = Column(Integer, primary_key=True)
    name = Column(String(120), unique=True, nullable=False)
    number_range_prefix = Column(String(2), unique=True, nullable=False)  # مثلا "09"
    description = Column(Text, default="")
    legacy_aliases = Column(JSON, default=list)  # نام‌های خام قدیمی که به این گروه نگاشت می‌شوند
    next_serial = Column(Integer, default=1)  # شمارنده‌ی سریال صدور کد در این بازه
    is_locked = Column(Boolean, default=True)  # کاربر عادی اجازه‌ی افزودن گروه جدید ندارد
    sort_order = Column(Integer, default=0)

    item_types = relationship("ItemType", back_populates="group", cascade="all,delete-orphan")


class ItemType(Base):
    """نوع کالا داخل یک گروه (خودش هم اولین جزء شرح خودکار است)."""
    __tablename__ = "item_types"

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("material_groups.id"), nullable=False)
    name = Column(String(150), nullable=False)
    default_unit_id = Column(Integer, ForeignKey("units_of_measure.id"), nullable=True)
    description_max_len = Column(Integer, default=40)  # قاعده ۶: حداکثر ۴۰ کاراکتر شرح کوتاه SAP
    is_active = Column(Boolean, default=True)

    group = relationship("MaterialGroup", back_populates="item_types")
    attributes = relationship(
        "Attribute", back_populates="item_type",
        cascade="all,delete-orphan", order_by="Attribute.order_index",
    )

    __table_args__ = (UniqueConstraint("group_id", "name", name="uq_itemtype_per_group"),)


class Attribute(Base):
    """یک ویژگی در قالب ثابت یک نوع کالا (مثلا «جنس»، «سایز»، «ولتاژ»)."""
    __tablename__ = "attributes"

    id = Column(Integer, primary_key=True)
    item_type_id = Column(Integer, ForeignKey("item_types.id"), nullable=False)
    name = Column(String(120), nullable=False)
    order_index = Column(Integer, default=0)  # ترتیب در شرح خودکار طبق قاعده ۷
    is_required = Column(Boolean, default=True)
    role = Column(String(20), default="secondary")  # primary | secondary
    include_label_in_description = Column(Boolean, default=False)
    allow_governance_extend = Column(Boolean, default=True)  # فقط نقش حاکمیت داده می‌تواند مقدار جدید اضافه کند

    item_type = relationship("ItemType", back_populates="attributes")
    values = relationship(
        "AttributeValue", back_populates="attribute",
        cascade="all,delete-orphan", order_by="AttributeValue.sort_order",
    )


class AttributeValue(Base):
    """مقدار مجاز یک ویژگی — تنها منبع «انتخاب» برای کاربر (هرگز تایپ آزاد)."""
    __tablename__ = "attribute_values"

    id = Column(Integer, primary_key=True)
    attribute_id = Column(Integer, ForeignKey("attributes.id"), nullable=False)
    value = Column(String(200), nullable=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)

    attribute = relationship("Attribute", back_populates="values")

    __table_args__ = (UniqueConstraint("attribute_id", "value", name="uq_value_per_attr"),)


class UnitOfMeasure(Base):
    __tablename__ = "units_of_measure"

    id = Column(Integer, primary_key=True)
    name_fa = Column(String(60), unique=True, nullable=False)
    symbol = Column(String(20), default="")


class Plant(Base):
    """پلنت‌های هلدینگ (شرکت‌های زیرمجموعه)."""
    __tablename__ = "plants"

    id = Column(Integer, primary_key=True)
    code = Column(String(10), unique=True, nullable=False)
    name = Column(String(120), nullable=False)


APP_ROLES = [
    ("submitter", "درخواست‌دهنده"),
    ("technical", "تایید فنی"),
    ("commercial", "تایید بازرگانی"),
    ("mrp", "برنامه‌ریزی (MRP)"),
    ("governance", "حاکمیت داده"),
]


class AppUser(Base):
    """کاربران سامانه — حتی انتخاب «کاربر جاری» به‌جای تایپ نام، از یک فهرست انتخاب می‌شود."""
    __tablename__ = "app_users"

    id = Column(Integer, primary_key=True)
    full_name = Column(String(120), nullable=False)
    role = Column(String(20), nullable=False)


class MissingValueRequest(Base):
    """وقتی هیچ مقدار مناسبی در فهرست یک ویژگی نبود، کاربر به‌جای تایپ، این درخواست
    را برای «حاکمیت داده» ثبت می‌کند تا مقدار جدید به کاتالوگ اضافه شود."""
    __tablename__ = "missing_value_requests"

    id = Column(Integer, primary_key=True)
    item_type_id = Column(Integer, ForeignKey("item_types.id"), nullable=False)
    attribute_id = Column(Integer, ForeignKey("attributes.id"), nullable=False)
    requested_by = Column(String(120), default="")
    note = Column(Text, default="")
    status = Column(String(20), default="باز")  # باز | برطرف‌شد
    created_at = Column(DateTime, default=now)

    item_type = relationship("ItemType")
    attribute = relationship("Attribute")


# ---------------------------------------------------------------------------
# ۲) صدور کد جدید — چرخه‌ی درخواست + گردش تایید ۴ مرحله‌ای
# ---------------------------------------------------------------------------

WORKFLOW_STEPS = [
    ("duplicate_gate", "گیت جستجوی تکرار"),
    ("technical", "تایید فنی"),
    ("commercial", "تایید بازرگانی"),
    ("mrp", "تایید برنامه‌ریزی (MRP)"),
    ("governance", "تایید نهایی حاکمیت داده"),
]

MATERIAL_STATUSES = (
    "draft", "duplicate_hold", "pending_technical", "pending_commercial",
    "pending_mrp", "pending_governance", "active", "rejected", "merged",
)


class Material(Base):
    """یک کالا — چه در حال گردش تایید (draft) چه صادرشده (active)."""
    __tablename__ = "materials"

    id = Column(Integer, primary_key=True)
    draft_no = Column(String(20), unique=True, nullable=False)  # مثلا DRAFT-000123
    code = Column(String(20), unique=True, nullable=True)  # فقط بعد از تایید نهایی پر می‌شود

    item_type_id = Column(Integer, ForeignKey("item_types.id"), nullable=False)
    unit_id = Column(Integer, ForeignKey("units_of_measure.id"), nullable=False)
    plants = Column(JSON, default=list)  # لیست کد پلنت‌ها

    description = Column(String(250), nullable=False)  # شرح کامل، خودکار
    description_short = Column(String(60), nullable=False)  # شرح کوتاه (<=40) برای فیلد SAP
    description_loose_key = Column(String(300), index=True, default="")

    status = Column(String(30), default="draft")
    duplicate_of_material_id = Column(Integer, ForeignKey("materials.id"), nullable=True)
    duplicate_candidates_json = Column(JSON, default=list)  # نتایج گیت تکرار در لحظه‌ی ثبت

    requested_by = Column(String(120), default="")
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)

    item_type = relationship("ItemType")
    unit = relationship("UnitOfMeasure")
    attribute_values = relationship(
        "MaterialAttributeValue", cascade="all,delete-orphan", back_populates="material"
    )
    approval_steps = relationship(
        "ApprovalStep", cascade="all,delete-orphan", back_populates="material",
        order_by="ApprovalStep.id",
    )
    datasheet = relationship(
        "Datasheet", uselist=False, cascade="all,delete-orphan", back_populates="material"
    )
    kraljic = relationship(
        "KraljicAssessment", uselist=False, cascade="all,delete-orphan", back_populates="material"
    )


class MaterialAttributeValue(Base):
    __tablename__ = "material_attribute_values"

    id = Column(Integer, primary_key=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=False)
    attribute_id = Column(Integer, ForeignKey("attributes.id"), nullable=False)
    attribute_value_id = Column(Integer, ForeignKey("attribute_values.id"), nullable=False)

    material = relationship("Material", back_populates="attribute_values")
    attribute = relationship("Attribute")
    attribute_value = relationship("AttributeValue")


class ApprovalStep(Base):
    __tablename__ = "approval_steps"

    id = Column(Integer, primary_key=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=False)
    step_key = Column(String(30), nullable=False)
    step_label = Column(String(80), nullable=False)
    status = Column(String(20), default="pending")  # pending | approved | rejected
    actor = Column(String(120), default="")
    acted_at = Column(DateTime, nullable=True)
    comment = Column(Text, default="")

    material = relationship("Material", back_populates="approval_steps")


# ---------------------------------------------------------------------------
# ۳) دیتاشیت خرید و ماتریس کرالجیک
# ---------------------------------------------------------------------------

LEAD_TIME_BANDS = ["کمتر از ۱ هفته", "۱ تا ۲ هفته", "۲ تا ۴ هفته", "۱ تا ۳ ماه", "بیش از ۳ ماه"]
PRICE_BANDS = ["زیر ۱۰ میلیون ریال", "۱۰ تا ۱۰۰ میلیون ریال", "۱۰۰ میلیون تا ۱ میلیارد ریال", "بالای ۱ میلیارد ریال"]
CRITICALITY_LEVELS = ["بحرانی", "مهم", "عادی"]
SUPPLY_MARKET_LEVELS = ["انحصاری (تک‌منبع)", "محدود (۲ تا ۳ منبع)", "رقابتی (منبع فراوان)"]
INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP"]
ORIGIN_OPTIONS = ["داخلی", "وارداتی - آسیا", "وارداتی - اروپا", "وارداتی - سایر"]


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True)
    name = Column(String(150), unique=True, nullable=False)
    origin = Column(String(60), default="داخلی")
    rating = Column(Float, default=3.0)  # ۱ تا ۵


class Datasheet(Base):
    """دیتاشیت فنی-خرید کالا؛ کمک به فرآیند تصمیم خرید."""
    __tablename__ = "datasheets"

    id = Column(Integer, primary_key=True)
    material_id = Column(Integer, ForeignKey("materials.id"), unique=True, nullable=False)

    manufacturer = Column(String(150), default="")
    brand = Column(String(150), default="")
    catalog_model_no = Column(String(150), default="")  # عیناً طبق کاتالوگ سازنده (قاعده ۹)
    technical_specs = Column(JSON, default=dict)  # {ویژگی: مقدار} - همان ویژگی‌های Attribute
    origin = Column(String(60), default="داخلی")
    lead_time_band = Column(String(60), default="")
    price_band = Column(String(60), default="")
    incoterm = Column(String(10), default="")
    moq = Column(String(60), default="")
    storage_condition = Column(String(150), default="")
    shelf_life_months = Column(Integer, nullable=True)
    hs_code = Column(String(30), default="")
    datasheet_file_url = Column(String(300), default="")
    notes = Column(Text, default="")

    preferred_supplier_ids = Column(JSON, default=list)

    material = relationship("Material", back_populates="datasheet")


KRALJIC_QUADRANTS = {
    ("low", "low"): ("عمومی / غیربحرانی", "ساده‌سازی خرید، سفارش‌گذاری خودکار/تنکارتی، کاهش هزینه‌ی اداری خرید."),
    ("low", "high"): ("اهرمی (Leverage)", "استفاده از قدرت چانه‌زنی، مناقصه/استعلام رقابتی، تجمیع حجم خرید."),
    ("high", "low"): ("گلوگاهی (Bottleneck)", "اطمینان از تداوم تامین، موجودی اطمینان، شناسایی منبع جایگزین."),
    ("high", "high"): ("استراتژیک (Strategic)", "شراکت بلندمدت با تامین‌کننده، قرارداد چارچوب، مدیریت ریسک مشترک."),
}


class KraljicAssessment(Base):
    """ارزیابی ماتریس کرالجیک برای هر کالا (ریسک تامین × تاثیر بر هزینه/سود)."""
    __tablename__ = "kraljic_assessments"

    id = Column(Integer, primary_key=True)
    material_id = Column(Integer, ForeignKey("materials.id"), unique=True, nullable=False)

    supply_risk_score = Column(Integer, default=3)  # ۱ (کم) تا ۵ (زیاد)
    profit_impact_score = Column(Integer, default=3)  # ۱ (کم) تا ۵ (زیاد)
    quadrant = Column(String(60), default="")
    strategy_note = Column(Text, default="")
    assessed_at = Column(DateTime, default=now, onupdate=now)

    material = relationship("Material", back_populates="kraljic")


# ---------------------------------------------------------------------------
# ۴) بانک کالای فعلی (Legacy) — عارضه‌یابی و پاکسازی
# ---------------------------------------------------------------------------

class LegacyImportBatch(Base):
    __tablename__ = "legacy_import_batches"

    id = Column(Integer, primary_key=True)
    filename = Column(String(250), default="")
    imported_at = Column(DateTime, default=now)
    row_count = Column(Integer, default=0)
    kpi_json = Column(JSON, default=dict)


class LegacyRecord(Base):
    """یک ردیف از بانک کالای فعلی، پس از عارضه‌یابی."""
    __tablename__ = "legacy_records"

    id = Column(Integer, primary_key=True)
    batch_id = Column(Integer, ForeignKey("legacy_import_batches.id"), nullable=False)

    plant = Column(String(80), default="")
    material_group_raw = Column(String(150), default="")
    material_group_mapped = Column(String(150), default="")
    code = Column(String(40), default="")
    description_raw = Column(Text, default="")
    description_normalized = Column(Text, default="")
    unit = Column(String(40), default="")

    quote_issue = Column(Boolean, default=False)
    needs_text_normalization = Column(Boolean, default=False)
    group_missing = Column(Boolean, default=False)
    unit_conflict = Column(Boolean, default=False)
    duplicate_exact = Column(Boolean, default=False)
    duplicate_loose = Column(Boolean, default=False)
    non_compliant_new_rule = Column(Boolean, default=False)
    non_compliance_reasons = Column(JSON, default=list)

    cluster_id = Column(Integer, ForeignKey("legacy_duplicate_clusters.id"), nullable=True)
    suggested_final_code = Column(String(40), default="")
    review_status = Column(String(30), default="نیازمند بررسی")  # نیازمند بررسی | تایید شد | رد شد


class LegacyDuplicateCluster(Base):
    __tablename__ = "legacy_duplicate_clusters"

    id = Column(Integer, primary_key=True)
    batch_id = Column(Integer, ForeignKey("legacy_import_batches.id"), nullable=False)
    kind = Column(String(20), default="exact")  # exact | loose
    normalized_desc = Column(Text, default="")
    codes_json = Column(JSON, default=list)
    golden_code = Column(String(40), default="")
    group_conflict = Column(Boolean, default=False)
    unit_conflict = Column(Boolean, default=False)

    records = relationship("LegacyRecord", backref="cluster")

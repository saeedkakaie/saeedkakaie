# -*- coding: utf-8 -*-
"""مدل‌های ورودی/خروجی API (Pydantic)."""
from typing import Optional
from pydantic import BaseModel


class AttrSelection(BaseModel):
    attribute_id: int
    attribute_value_id: int


class MaterialPreviewIn(BaseModel):
    item_type_id: int
    selections: list[AttrSelection]
    exclude_material_id: Optional[int] = None


class MaterialCreateIn(BaseModel):
    item_type_id: int
    unit_id: int
    plant_codes: list[str]
    selections: list[AttrSelection]
    requested_by_id: int
    acknowledge_warning: bool = False


class ApprovalActionIn(BaseModel):
    step_key: str
    actor_id: int
    decision: str  # approve | reject
    comment: str = ""


class DatasheetIn(BaseModel):
    manufacturer: str = ""
    brand: str = ""
    catalog_model_no: str = ""
    origin: str = ""
    lead_time_band: str = ""
    price_band: str = ""
    incoterm: str = ""
    moq: str = ""
    storage_condition: str = ""
    shelf_life_months: Optional[int] = None
    hs_code: str = ""
    notes: str = ""
    preferred_supplier_ids: list[int] = []


class KraljicIn(BaseModel):
    supply_risk_score: int
    profit_impact_score: int


class MissingValueRequestIn(BaseModel):
    item_type_id: int
    attribute_id: int
    requested_by_id: int
    note: str = ""


class ClassificationItemTypeIn(BaseModel):
    group_id: int
    name: str
    default_unit_id: Optional[int] = None


class ClassificationAttributeIn(BaseModel):
    item_type_id: int
    name: str
    order_index: int = 0
    is_required: bool = True


class ClassificationValueIn(BaseModel):
    attribute_id: int
    value: str

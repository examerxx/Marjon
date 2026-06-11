"""Warehouse document schemas."""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID
from app.shared.base_schema import BaseSchema, BaseResponseSchema


# ── Warehouse ──────────────────────────────────────────────
class WarehouseCreate(BaseSchema):
    name: str
    address: str | None = None
    is_main: bool = False
    branch_id: UUID | None = None


class WarehouseResponse(BaseResponseSchema):
    company_id: UUID
    name: str
    address: str | None
    is_main: bool
    branch_id: UUID | None


# ── Purchase Document (Приход) ─────────────────────────────
class PurchaseItemCreate(BaseSchema):
    name: str
    ingredient_id: UUID | None = None
    quantity: Decimal = Decimal("0")
    unit: str = "кг"
    cost_price: Decimal = Decimal("0")


class PurchaseDocumentCreate(BaseSchema):
    supplier: str | None = None
    warehouse_id: UUID | None = None
    warehouse_name: str | None = None
    date: str | None = None
    note: str | None = None
    items: list[PurchaseItemCreate] = []


class PurchaseDocumentUpdate(BaseSchema):
    supplier: str | None = None
    warehouse_id: UUID | None = None
    warehouse_name: str | None = None
    date: str | None = None
    note: str | None = None
    status: str | None = None


class PurchaseItemResponse(BaseResponseSchema):
    document_id: UUID
    ingredient_id: UUID | None
    name: str
    quantity: Decimal
    unit: str
    cost_price: Decimal
    total: Decimal


class PurchaseDocumentResponse(BaseResponseSchema):
    company_id: UUID
    number: int
    supplier: str | None
    warehouse_id: UUID | None
    warehouse_name: str | None
    date: str | None
    registered_at: str | None
    accepted_at: str | None
    items_count: int
    total_amount: Decimal
    status: str
    created_by_name: str | None
    note: str | None


# ── Transfer Document ──────────────────────────────────────
class TransferCreate(BaseSchema):
    from_warehouse_id: UUID | None = None
    from_warehouse_name: str | None = None
    to_warehouse_id: UUID | None = None
    to_warehouse_name: str | None = None
    date: str | None = None
    items_count: int = 0
    note: str | None = None


class TransferResponse(BaseResponseSchema):
    company_id: UUID
    from_warehouse_id: UUID | None
    from_warehouse_name: str | None
    to_warehouse_id: UUID | None
    to_warehouse_name: str | None
    date: str | None
    items_count: int
    status: str
    created_by_name: str | None
    note: str | None


# ── Inventory Check ────────────────────────────────────────
class InventoryCheckCreate(BaseSchema):
    warehouse_id: UUID | None = None
    warehouse_name: str | None = None
    comment: str | None = None
    check_type: str = "Приход и расход учтены"


class InventoryCheckResponse(BaseResponseSchema):
    company_id: UUID
    warehouse_id: UUID | None
    warehouse_name: str | None
    comment: str | None
    check_type: str
    status: str
    created_by_name: str | None


# ── Write-Off ──────────────────────────────────────────────
class WriteOffCreate(BaseSchema):
    category: str | None = None
    items_count: int = 0
    note: str | None = None


class WriteOffResponse(BaseResponseSchema):
    company_id: UUID
    category: str | None
    items_count: int
    status: str
    created_by_name: str | None
    note: str | None

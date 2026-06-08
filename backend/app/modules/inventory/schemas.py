from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class CategoryCreate(BaseSchema):
    name: str
    slug: str
    parent_id: UUID | None = None
    sort_order: int = 0


class CategoryResponse(BaseResponseSchema):
    company_id: UUID
    parent_id: UUID | None
    name: str
    slug: str
    sort_order: int
    is_active: bool


class ProductCreate(BaseSchema):
    name: str
    category_id: UUID | None = None
    description: str | None = None
    price: Decimal
    cost_price: Decimal | None = None
    unit: str = "ÑˆÑ‚"
    barcode: str | None = None
    sku: str | None = None
    sort_order: int = 0


class ProductUpdate(BaseSchema):
    name: str | None = None
    price: Decimal | None = None
    cost_price: Decimal | None = None
    is_active: bool | None = None
    is_available: bool | None = None
    sort_order: int | None = None


class ProductResponse(BaseResponseSchema):
    company_id: UUID
    category_id: UUID | None
    name: str
    description: str | None
    price: Decimal
    cost_price: Decimal | None
    tax_rate: Decimal
    unit: str
    barcode: str | None
    sku: str | None
    is_active: bool
    is_available: bool
    sort_order: int


class ProductBranchUpdate(BaseSchema):
    price: Decimal | None = None
    is_available: bool | None = None
    stop_list: bool | None = None


class StopListToggle(BaseSchema):
    branch_id: UUID
    stop_list: bool


class IngredientCreate(BaseSchema):
    name: str
    unit: str = "ÐºÐ³"
    category: str | None = None


class IngredientResponse(BaseResponseSchema):
    company_id: UUID
    name: str
    unit: str
    category: str | None
    is_active: bool


class StockItemResponse(BaseResponseSchema):
    company_id: UUID
    warehouse_id: UUID
    ingredient_id: UUID
    quantity: Decimal
    unit: str
    min_quantity: Decimal
    cost_price: Decimal


class StockMovementCreate(BaseSchema):
    warehouse_id: UUID
    ingredient_id: UUID
    movement_type: str
    quantity: Decimal
    unit: str
    cost_price: Decimal = Decimal("0")
    note: str | None = None


class StockMovementResponse(BaseResponseSchema):
    company_id: UUID
    warehouse_id: UUID
    ingredient_id: UUID
    movement_type: str
    quantity: Decimal
    unit: str
    cost_price: Decimal
    total_cost: Decimal
    note: str | None

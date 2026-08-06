from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from pydantic import Field
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


class ProductIngredientIn(BaseSchema):
    ingredient_id: UUID
    quantity: Decimal = Field(..., gt=0)


class ProductIngredientResponse(BaseSchema):
    ingredient_id: UUID
    ingredient_name: str
    quantity: Decimal
    unit: str


class ProductCreate(BaseSchema):
    name: str
    category_id: UUID | None = None
    subcategory_id: UUID | None = None
    product_type: str = "dish"          # dish | sale
    printer_id: UUID | None = None
    description: str | None = None
    price: Decimal
    cost_price: Decimal | None = None
    image_url: str | None = None
    is_active: bool = True
    unit: str = "шт"
    barcode: str | None = None
    sku: str | None = None
    sort_order: int = 0
    ingredients: list[ProductIngredientIn] = Field(default_factory=list)


class ProductUpdate(BaseSchema):
    name: str | None = None
    description: str | None = None
    category_id: UUID | None = None
    subcategory_id: UUID | None = None
    product_type: str | None = None
    printer_id: UUID | None = None
    price: Decimal | None = None
    cost_price: Decimal | None = None
    image_url: str | None = None
    is_active: bool | None = None
    is_available: bool | None = None
    sort_order: int | None = None
    # None = leave composition untouched; [] = clear it; a list = replace it.
    ingredients: list[ProductIngredientIn] | None = None


class ProductResponse(BaseResponseSchema):
    company_id: UUID
    category_id: UUID | None
    subcategory_id: UUID | None = None
    product_type: str = "dish"
    printer_id: UUID | None = None
    name: str
    description: str | None
    image_url: str | None = None
    price: Decimal
    cost_price: Decimal | None
    tax_rate: Decimal
    unit: str
    barcode: str | None
    sku: str | None
    is_active: bool
    is_available: bool
    sort_order: int
    # BE-16 aggregates — real, computed from actual data (see
    # ProductService._attach_aggregates), never fabricated:
    category_name: str | None = None
    subcategory_name: str | None = None
    printer_name: str | None = None
    ingredients_count: int = 0
    # Theoretical max servable count from current ingredient stock
    # (min over composition lines of stock/quantity-per-serving). null
    # when the product has no recorded composition — not a fake 0.
    stock: int | None = None
    ingredients: list[ProductIngredientResponse] = Field(default_factory=list)


class ProductBranchUpdate(BaseSchema):
    price: Decimal | None = None
    is_available: bool | None = None
    stop_list: bool | None = None


class StopListToggle(BaseSchema):
    branch_id: UUID
    stop_list: bool


class IngredientCreate(BaseSchema):
    name: str
    unit: str = "кг"
    category: str | None = None
    supplier_name: str | None = None


class IngredientUpdate(BaseSchema):
    name: str | None = None
    unit: str | None = None
    category: str | None = None
    supplier_name: str | None = None
    is_active: bool | None = None


class IngredientResponse(BaseResponseSchema):
    company_id: UUID
    name: str
    unit: str
    category: str | None
    supplier_name: str | None = None
    is_active: bool
    # BE-17 aggregates — summed/averaged across this ingredient's
    # StockItem rows (all warehouses) at read time, never a fabricated
    # placeholder. 0 here is a genuine "no stock recorded yet", not a
    # stand-in for "unknown".
    stock: Decimal = Decimal("0")
    min_stock: Decimal = Decimal("0")
    purchase_price: Decimal | None = None


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

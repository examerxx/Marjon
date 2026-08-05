from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from pydantic import Field
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class SemiProductIngredientIn(BaseSchema):
    ingredient_id: UUID
    quantity: Decimal = Field(..., gt=0)


class SemiProductIngredientResponse(BaseSchema):
    ingredient_id: UUID
    ingredient_name: str
    quantity: Decimal
    unit: str


class SemiProductCreate(BaseSchema):
    name: str
    category_id: UUID | None = None
    subcategory_id: UUID | None = None
    unit: str = "кг"
    is_active: bool = True
    ingredients: list[SemiProductIngredientIn] = Field(default_factory=list)


class SemiProductUpdate(BaseSchema):
    name: str | None = None
    category_id: UUID | None = None
    subcategory_id: UUID | None = None
    unit: str | None = None
    is_active: bool | None = None
    # None = leave composition untouched; [] = clear it; a list = replace it.
    ingredients: list[SemiProductIngredientIn] | None = None


class SemiProductResponse(BaseResponseSchema):
    company_id: UUID
    category_id: UUID | None
    subcategory_id: UUID | None
    name: str
    unit: str
    cost_price: Decimal
    ingredients_count: int
    is_active: bool
    ingredients: list[SemiProductIngredientResponse] = Field(default_factory=list)


class SemiProductProduceRequest(BaseSchema):
    warehouse_id: UUID
    quantity: Decimal = Field(..., gt=0)

from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, Field, model_validator
from app.shared.base_schema import BaseResponseSchema


def _normalize_sort_status(values: dict) -> dict:
    """BE-19: Unit uses the HQ-module naming convention (sort/status), but
    SettingsUnitsPage.jsx (an OWNER-app screen, GET/POST/PATCH /units)
    was built against the owner-app convention (sort_order/is_active) —
    same mismatch, same fix as PaymentType (finance/schemas.py)."""
    if not isinstance(values, dict):
        return values
    values = dict(values)
    if "sort" not in values and "sort_order" in values:
        values["sort"] = values.pop("sort_order")
    if "status" not in values and "is_active" in values:
        values["status"] = values.pop("is_active")
    return values


class NomCategoryCreate(BaseModel):
    name: str
    sort: int = 0
    status: bool = True


class NomCategoryUpdate(BaseModel):
    name: str | None = None
    sort: int | None = None
    status: bool | None = None


class NomCategoryResponse(BaseResponseSchema):
    name: str
    sort: int
    status: bool


class UnitCreate(BaseModel):
    name: str
    short_name: str | None = None
    sort: int = 0
    status: bool = True

    @model_validator(mode="before")
    @classmethod
    def normalize(cls, values):
        return _normalize_sort_status(values)


class UnitUpdate(BaseModel):
    name: str | None = None
    short_name: str | None = None
    sort: int | None = None
    status: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize(cls, values):
        return _normalize_sort_status(values)


class UnitResponse(BaseResponseSchema):
    name: str
    short_name: str | None
    sort: int
    status: bool
    sort_order: int = 0
    is_active: bool = True

    @model_validator(mode="after")
    def mirror_owner_app_fields(self):
        self.sort_order = self.sort
        self.is_active = self.status
        return self


class NomProductCreate(BaseModel):
    photo: str | None = None
    name: str
    category_id: UUID | None = None
    price: Decimal = Decimal(0)
    unit_id: UUID | None = None
    status: bool = True
    is_used: bool = False


class NomProductUpdate(BaseModel):
    photo: str | None = None
    name: str | None = None
    category_id: UUID | None = None
    price: Decimal | None = None
    unit_id: UUID | None = None
    status: bool | None = None
    is_used: bool | None = None
    is_archived: bool | None = None


class NomProductResponse(BaseResponseSchema):
    photo: str | None
    name: str
    category_id: UUID | None
    price: Decimal
    unit_id: UUID | None
    status: bool
    is_used: bool
    is_archived: bool


class NomOrderItem(BaseModel):
    product_id: UUID
    qty: float = 1
    price: Decimal = Decimal(0)


class NomOrderCreate(BaseModel):
    name: str
    payment_id: str | None = None
    items: list[NomOrderItem] = Field(default_factory=list)
    price: Decimal = Decimal(0)
    comment: str | None = None
    status: str = "new"
    organization_id: UUID | None = None


class NomOrderUpdate(BaseModel):
    name: str | None = None
    payment_id: str | None = None
    items: list[NomOrderItem] | None = None
    price: Decimal | None = None
    comment: str | None = None
    status: str | None = None
    organization_id: UUID | None = None


class NomOrderResponse(BaseResponseSchema):
    name: str
    payment_id: str | None
    items: list[NomOrderItem] | None
    price: Decimal
    comment: str | None
    status: str
    organization_id: UUID | None

from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, Field
from app.shared.base_schema import BaseResponseSchema


class StorageCreate(BaseModel):
    name: str
    organization_id: UUID | None = None


class StorageUpdate(BaseModel):
    name: str | None = None
    organization_id: UUID | None = None


class StorageResponse(BaseResponseSchema):
    name: str
    organization_id: UUID | None


class ProviderCreate(BaseModel):
    name: str
    phone: str | None = None
    comment: str | None = None


class ProviderUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    comment: str | None = None


class ProviderResponse(BaseResponseSchema):
    name: str
    phone: str | None
    comment: str | None


class ComingItemIn(BaseModel):
    category_id: UUID | None = None
    product_id: UUID
    type: str | None = None
    price: Decimal = Decimal(0)
    qty: Decimal = Decimal(0)


class ComingItemResponse(BaseResponseSchema):
    coming_id: UUID
    category_id: UUID | None
    product_id: UUID
    type: str | None
    price: Decimal
    qty: Decimal
    total: Decimal


class ComingCreate(BaseModel):
    number: str
    provider_id: UUID | None = None
    storage_id: UUID
    receipt_date: date | None = None
    registration_date: date | None = None
    comment: str | None = None
    items: list[ComingItemIn] = Field(default_factory=list)


class ComingUpdate(BaseModel):
    number: str | None = None
    provider_id: UUID | None = None
    storage_id: UUID | None = None
    receipt_date: date | None = None
    registration_date: date | None = None
    comment: str | None = None
    items: list[ComingItemIn] | None = None


class ComingResponse(BaseResponseSchema):
    number: str
    provider_id: UUID | None
    storage_id: UUID
    receipt_date: date | None
    registration_date: date | None
    acceptance_date: date | None
    comment: str | None
    status: str
    total_sum: Decimal
    items: list[ComingItemResponse] = Field(default_factory=list)


class MovementCreate(BaseModel):
    storage_id: UUID
    product_id: UUID
    direction: str = Field(..., pattern="^(income|expense)$")
    qty: Decimal
    price: Decimal = Decimal(0)
    date: datetime | None = None
    comment: str | None = None


class MovementResponse(BaseResponseSchema):
    storage_id: UUID
    product_id: UUID
    direction: str
    qty: Decimal
    price: Decimal
    date: datetime
    coming_id: UUID | None
    comment: str | None


class StorageBalanceRow(BaseModel):
    storage_id: UUID
    storage_name: str
    product_id: UUID
    product_name: str
    opening_qty: Decimal
    income_qty: Decimal
    expense_qty: Decimal
    closing_qty: Decimal


class FlowReportRow(BaseModel):
    storage_id: UUID
    storage_name: str
    product_id: UUID
    product_name: str
    qty: Decimal
    total: Decimal

from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, Field
from app.shared.base_schema import BaseResponseSchema


class CounterpartyCreate(BaseModel):
    full_name: str
    phone: str | None = None
    balance: Decimal = Decimal(0)
    type: str = "client"


class CounterpartyUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    type: str | None = None


class CounterpartyResponse(BaseResponseSchema):
    full_name: str
    phone: str | None
    balance: Decimal
    type: str


class PaymentTypeCreate(BaseModel):
    name: str
    type: str | None = None
    sort: int = 0
    status: bool = True


class PaymentTypeUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    sort: int | None = None
    status: bool | None = None


class PaymentTypeResponse(BaseResponseSchema):
    name: str
    type: str | None
    sort: int
    status: bool


class TransactionCategoryCreate(BaseModel):
    name: str
    kind: str = Field(..., pattern="^(income|expense)$")
    parent_id: UUID | None = None
    status: bool = True


class TransactionCategoryUpdate(BaseModel):
    name: str | None = None
    kind: str | None = None
    parent_id: UUID | None = None
    status: bool | None = None


class TransactionCategoryResponse(BaseResponseSchema):
    name: str
    kind: str
    parent_id: UUID | None
    status: bool


class TransactionCreate(BaseModel):
    date: datetime | None = None
    amount: Decimal = Field(..., gt=0)
    direction: str = Field(..., pattern="^(income|expense)$")
    payment_type_id: UUID | None = None
    counterparty_id: UUID | None = None
    category_id: UUID | None = None
    organization_id: UUID | None = None
    comment: str | None = None


class TransactionUpdate(BaseModel):
    date: datetime | None = None
    amount: Decimal | None = Field(None, gt=0)
    payment_type_id: UUID | None = None
    counterparty_id: UUID | None = None
    category_id: UUID | None = None
    comment: str | None = None


class TransactionResponse(BaseResponseSchema):
    date: datetime
    amount: Decimal
    direction: str
    payment_type_id: UUID | None
    counterparty_id: UUID | None
    category_id: UUID | None
    organization_id: UUID | None
    comment: str | None
    user_id: UUID | None


class PayItem(BaseModel):
    amount: Decimal = Field(..., gt=0)
    category_id: UUID | None = None
    counterparty_id: UUID | None = None
    payment_type_id: UUID | None = None
    comment: str | None = None


class PayRequest(BaseModel):
    """Разбивка оплаты долга (ТЗ §6, debt-payment-split)."""

    direction: str = Field("expense", pattern="^(income|expense)$")
    organization_id: UUID | None = None
    items: list[PayItem] = Field(..., min_length=1)
    save_as_template: str | None = None  # имя шаблона, если нужно сохранить


class FinanceTemplateCreate(BaseModel):
    name: str
    payload: dict | None = None


class FinanceTemplateResponse(BaseResponseSchema):
    name: str
    payload: dict | None


class FinanceHistoryResponse(BaseResponseSchema):
    status: str | None
    ref_id: UUID | None
    date: datetime
    organization_id: UUID | None
    new_amount: Decimal | None
    old_amount: Decimal | None
    type: str | None
    user_id: UUID | None
    comment: str | None

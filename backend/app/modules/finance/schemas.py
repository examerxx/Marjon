from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, Field, model_validator
from app.shared.base_schema import BaseResponseSchema


def _normalize_sort_status(values: dict) -> dict:
    """BE-19: PaymentType uses the HQ-module naming convention (sort/
    status), but SettingsPaymentMethodsPage.jsx (an OWNER-app screen) was
    built against the owner-app convention (sort_order/is_active) used
    everywhere else it calls — sending sort_order (silently dropped, so
    reordering never saved) and reading item.is_active (which never
    existed in the response, so `undefined !== false` made the status
    column always show "Active" regardless of the real value)."""
    if not isinstance(values, dict):
        return values
    values = dict(values)
    if "sort" not in values and "sort_order" in values:
        values["sort"] = values.pop("sort_order")
    if "status" not in values and "is_active" in values:
        values["status"] = values.pop("is_active")
    return values


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

    @model_validator(mode="before")
    @classmethod
    def normalize(cls, values):
        return _normalize_sort_status(values)


class PaymentTypeUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    sort: int | None = None
    status: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize(cls, values):
        return _normalize_sort_status(values)


class PaymentTypeResponse(BaseResponseSchema):
    name: str
    type: str | None
    sort: int
    status: bool
    # Mirrors of sort/status under the owner-app's naming convention — see
    # _normalize_sort_status. Keeping both names live (not renaming sort/
    # status outright) avoids a breaking change for any HQ-side caller
    # still using the original fields.
    sort_order: int = 0
    is_active: bool = True

    @model_validator(mode="after")
    def mirror_owner_app_fields(self):
        self.sort_order = self.sort
        self.is_active = self.status
        return self


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

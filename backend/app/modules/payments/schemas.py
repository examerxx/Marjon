from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class PaymentCreate(BaseSchema):
    order_id: UUID
    amount: Decimal
    method: str
    cash_received: Decimal | None = None


class PaymentResponse(BaseResponseSchema):
    company_id: UUID
    order_id: UUID
    amount: Decimal
    method: str
    status: str
    provider_tx_id: str | None
    cash_received: Decimal | None
    change_given: Decimal | None
    fiscal_code: str | None

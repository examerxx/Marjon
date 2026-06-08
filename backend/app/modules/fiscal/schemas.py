from __future__ import annotations
from uuid import UUID
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class FiscalReceiptCreate(BaseSchema):
    order_id: UUID
    payment_id: UUID
    provider: str = "ofd_uz"


class FiscalReceiptResponse(BaseResponseSchema):
    company_id: UUID
    order_id: UUID
    payment_id: UUID
    status: str
    fiscal_code: str | None
    receipt_url: str | None
    provider: str
    error_message: str | None

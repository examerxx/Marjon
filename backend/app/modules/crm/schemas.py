from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class CustomerCreate(BaseSchema):
    phone: str
    name: str | None = None
    email: str | None = None
    birth_date: date | None = None
    gender: str | None = None
    source: str = "pos"


class CustomerUpdate(BaseSchema):
    name: str | None = None
    email: str | None = None
    birth_date: date | None = None


class CustomerResponse(BaseResponseSchema):
    company_id: UUID
    phone: str
    name: str | None
    email: str | None
    birth_date: date | None
    gender: str | None
    source: str
    total_orders: int
    total_spent: Decimal
    last_visit_at: datetime | None


class NoteCreate(BaseSchema):
    body: str


class NoteResponse(BaseResponseSchema):
    customer_id: UUID
    author_id: UUID
    body: str

from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from typing import Literal
from pydantic import Field
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class OrderItemCreate(BaseSchema):
    product_id: UUID
    quantity: Decimal = Field(..., gt=0)
    discount: Decimal | None = None
    note: str | None = None
    modifiers: list[dict] = Field(default_factory=list)
    course: int = 1


class OrderCreate(BaseSchema):
    branch_id: UUID
    terminal_id: UUID | None = None
    customer_id: UUID | None = None
    order_type: Literal["dine_in", "takeaway", "delivery", "qr"] = "dine_in"
    table_number: str | None = None
    persons_count: int = 1
    note: str | None = None
    discount_amount: Decimal | None = None
    service_fee_rate: float | None = None
    items: list[OrderItemCreate] = Field(default_factory=list)


class OrderUpdate(BaseSchema):
    """Partial update for order-level fields."""
    note: str | None = None
    table_number: str | None = None
    persons_count: int | None = None
    discount_amount: Decimal | None = None
    service_fee_rate: float | None = None


class OrderStatusUpdate(BaseSchema):
    status: Literal["new", "accepted", "cooking", "ready", "completed", "cancelled"]


class OrderItemResponse(BaseResponseSchema):
    order_id: UUID
    product_id: UUID
    name: str
    price: Decimal
    quantity: Decimal
    discount: Decimal
    total: Decimal
    status: str
    note: str | None
    modifiers: list
    course: int


class OrderResponse(BaseResponseSchema):
    company_id: UUID
    branch_id: UUID
    order_number: str
    order_type: str
    status: str
    table_number: str | None
    persons_count: int
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    service_fee: Decimal
    total_amount: Decimal
    note: str | None
    source: str
    items: list[OrderItemResponse] = Field(default_factory=list)


class TerminalCreate(BaseSchema):
    branch_id: UUID
    name: str


class TerminalResponse(BaseResponseSchema):
    company_id: UUID
    branch_id: UUID
    name: str
    is_active: bool

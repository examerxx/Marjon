from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field

from app.shared.base_schema import BaseSchema, BaseResponseSchema


class PlanCreate(BaseSchema):
    name: str
    slug: str
    description: str | None = None
    price_monthly: Decimal
    price_yearly: Decimal
    features: dict = Field(default_factory=dict)


class PlanResponse(BaseResponseSchema):
    name: str
    slug: str
    description: str | None
    price_monthly: Decimal
    price_yearly: Decimal
    features: dict
    is_active: bool


class SubscriptionCreate(BaseSchema):
    plan_id: UUID
    billing_cycle: str = "monthly"


class SubscriptionResponse(BaseResponseSchema):
    company_id: UUID
    plan_id: UUID
    status: str
    billing_cycle: str
    trial_ends_at: datetime | None
    current_period_start: datetime | None
    current_period_end: datetime | None


class InvoiceResponse(BaseResponseSchema):
    company_id: UUID
    subscription_id: UUID
    amount: Decimal
    currency: str
    status: str
    due_date: datetime | None
    paid_at: datetime | None

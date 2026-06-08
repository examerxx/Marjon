from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class LoyaltyAccountResponse(BaseResponseSchema):
    company_id: UUID
    customer_id: UUID
    balance: Decimal
    lifetime_points: Decimal
    tier: str


class EarnPointsRequest(BaseSchema):
    customer_id: UUID
    order_id: UUID
    points: Decimal


class RedeemPointsRequest(BaseSchema):
    customer_id: UUID
    order_id: UUID
    points: Decimal


class LoyaltyTransactionResponse(BaseResponseSchema):
    account_id: UUID
    order_id: UUID | None
    transaction_type: str
    points: Decimal
    balance_after: Decimal
    description: str | None

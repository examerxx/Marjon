from __future__ import annotations
from uuid import UUID

from pydantic import Field

from app.shared.base_schema import BaseSchema, BaseResponseSchema


class StationCreate(BaseSchema):
    branch_id: UUID
    name: str
    category_ids: list[UUID] = Field(default_factory=list)


class StationResponse(BaseResponseSchema):
    company_id: UUID
    branch_id: UUID
    name: str
    category_ids: list
    is_active: bool


class KitchenItemStatusUpdate(BaseSchema):
    order_item_id: UUID
    status: str

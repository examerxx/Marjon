from __future__ import annotations
from datetime import datetime
from typing import Literal
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
    status: Literal["pending", "cooking", "ready", "served", "cancelled"]


class DisplayOrder(BaseSchema):
    """Строка ТВ-экрана посетителей: номер и «готов / в очереди».

    Никаких блюд, сумм и столов — экран видит зал, а не внутренности заказа.
    """

    number: str
    status: Literal["queued", "ready"]
    created_at: datetime


class DisplayBoard(BaseSchema):
    # Название заведения, а не «MARJON»: гость узнаёт свою точку на экране.
    company_name: str = ""
    branch_name: str
    # DISPLAY-OFF-01: выключенный экран отдаёт пустую доску, чтобы ТВ не
    # показывал очередь, пока касса его не включила обратно.
    enabled: bool = True
    orders: list[DisplayOrder] = Field(default_factory=list)


class DisplaySettingsResponse(BaseSchema):
    branch_id: UUID
    branch_name: str
    enabled: bool


class DisplaySettingsUpdate(BaseSchema):
    branch_id: UUID | None = None
    enabled: bool

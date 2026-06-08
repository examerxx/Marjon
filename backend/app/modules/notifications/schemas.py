from __future__ import annotations
from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.shared.base_schema import BaseSchema, BaseResponseSchema


class NotificationCreate(BaseSchema):
    user_id: UUID
    title: str
    body: str
    notification_type: str
    channel: str = "in_app"
    data: dict = Field(default_factory=dict)


class NotificationResponse(BaseResponseSchema):
    company_id: UUID
    user_id: UUID
    title: str
    body: str
    notification_type: str
    channel: str
    status: str
    read_at: datetime | None

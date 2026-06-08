from __future__ import annotations
from uuid import UUID
from app.shared.base_schema import BaseResponseSchema


class AuditLogResponse(BaseResponseSchema):
    company_id: UUID
    user_id: UUID | None
    action: str
    entity_type: str
    entity_id: UUID | None
    old_data: dict | None
    new_data: dict | None
    ip_address: str | None

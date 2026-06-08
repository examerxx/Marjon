from __future__ import annotations
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


class BaseSchema(BaseModel):
    model_config = {"from_attributes": True}


class BaseResponseSchema(BaseSchema):
    id: UUID
    created_at: datetime
    updated_at: datetime

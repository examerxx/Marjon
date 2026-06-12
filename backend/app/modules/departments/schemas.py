from __future__ import annotations
from pydantic import BaseModel
from app.shared.base_schema import BaseResponseSchema


class DepartmentCreate(BaseModel):
    name: str
    type: str | None = None


class DepartmentUpdate(BaseModel):
    name: str | None = None
    type: str | None = None


class DepartmentResponse(BaseResponseSchema):
    name: str
    type: str | None

from __future__ import annotations
from uuid import UUID
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class CompanyCreate(BaseSchema):
    name: str
    slug: str
    country_code: str | None = None
    timezone: str = "UTC"
    currency: str = "UZS"


class CompanyUpdate(BaseSchema):
    name: str | None = None
    country_code: str | None = None
    timezone: str | None = None
    currency: str | None = None


class CompanyResponse(BaseResponseSchema):
    slug: str
    name: str
    country_code: str | None
    timezone: str
    currency: str
    is_active: bool


class BranchCreate(BaseSchema):
    name: str
    address: str | None = None
    city: str | None = None


class BranchUpdate(BaseSchema):
    name: str | None = None
    address: str | None = None
    city: str | None = None
    is_active: bool | None = None


class BranchResponse(BaseResponseSchema):
    company_id: UUID
    name: str
    address: str | None
    city: str | None
    is_active: bool

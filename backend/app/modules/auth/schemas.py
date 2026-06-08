from __future__ import annotations
from uuid import UUID
from pydantic import Field
from pydantic import EmailStr
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class RegisterRequest(BaseSchema):
    company_name: str
    company_slug: str
    email: EmailStr
    password: str


class CompanyUserCreate(BaseSchema):
    email: EmailStr
    password: str
    phone: str | None = None
    role_slug: str
    role_name: str | None = None


class LoginRequest(BaseSchema):
    email: EmailStr
    password: str


class RefreshRequest(BaseSchema):
    refresh_token: str


class TokenResponse(BaseSchema):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseResponseSchema):
    email: str
    phone: str | None
    is_active: bool
    is_superadmin: bool
    company_id: UUID | None
    role_slugs: list[str] = Field(default_factory=list)


class CompanyUserResponse(UserResponse):
    role_slug: str | None = None

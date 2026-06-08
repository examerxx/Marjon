from __future__ import annotations
import re
from uuid import UUID
from pydantic import EmailStr, Field, field_validator
from app.shared.base_schema import BaseSchema, BaseResponseSchema


def _validate_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Пароль должен быть не менее 8 символов")
    if not re.search(r"[A-Za-z]", v):
        raise ValueError("Пароль должен содержать хотя бы одну букву")
    if not re.search(r"\d", v):
        raise ValueError("Пароль должен содержать хотя бы одну цифру")
    return v


class RegisterRequest(BaseSchema):
    company_name: str = Field(..., min_length=1, max_length=255)
    company_slug: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9_-]+$")
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return _validate_password(v)


class CompanyUserCreate(BaseSchema):
    email: EmailStr
    password: str
    phone: str | None = None
    role_slug: str
    role_name: str | None = None

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return _validate_password(v)


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

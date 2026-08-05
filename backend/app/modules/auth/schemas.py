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
    email: str | None = Field(None, min_length=1, max_length=255)
    phone: str | None = Field(None, min_length=1, max_length=30)
    password: str


class RefreshRequest(BaseSchema):
    refresh_token: str


class PinSetRequest(BaseSchema):
    pin: str = Field(..., min_length=4, max_length=8)

    @field_validator("pin")
    @classmethod
    def check_pin(cls, v: str) -> str:
        if not re.fullmatch(r"\d{4,8}", v):
            raise ValueError("PIN должен состоять из 4-8 цифр")
        return v


class PinLoginRequest(BaseSchema):
    employee_id: UUID
    pin: str = Field(..., min_length=4, max_length=8)


class LogoutRequest(BaseSchema):
    # BE-06: when given, only THIS session's refresh token is revoked.
    # Omitted (or a client that sends no body at all) falls back to
    # revoking every session for the user — kept for backward
    # compatibility with any caller that predates scoped logout.
    refresh_token: str | None = None


class TokenResponse(BaseSchema):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseResponseSchema):
    email: str
    name: str | None = None
    phone: str | None = None
    is_active: bool
    is_superadmin: bool
    company_id: UUID | None
    role_slugs: list[str] = Field(default_factory=list)
    avatar_url: str | None = None
    auth_scope: str = "app"  # "app" | "hq_admin" — BE-01, set per-session, not persisted


class CompanyUserUpdate(BaseSchema):
    name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    password: str | None = None
    role_slug: str | None = None
    # BE-07: was missing entirely — a deactivated employee (DELETE
    # /auth/users/{id} soft-deactivates, doesn't hard-delete) had no way to
    # be reactivated through the API.
    is_active: bool | None = None

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str | None) -> str | None:
        if v is not None:
            return _validate_password(v)
        return v


class CompanyUserResponse(UserResponse):
    role_slug: str | None = None

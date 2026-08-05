from __future__ import annotations
import re
from uuid import UUID
from pydantic import Field, field_validator
from app.shared.base_schema import BaseSchema, BaseResponseSchema

# BE-09: Uzbekistan INN is 9 digits; kept slightly loose (9-14) to not
# hard-block other country codes this platform might one day serve.
_TIN_RE = re.compile(r"^\d{9,14}$")
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


def _validate_phone(v: str) -> str | None:
    # The existing frontend form always sends phone/inn, even blank ones,
    # for a company that hasn't set them yet — treat "" as "not provided"
    # rather than a format error, so the existing save flow doesn't 422.
    if not v.strip():
        return None
    stripped = re.sub(r"[\s\-().]", "", v)
    if not re.fullmatch(r"\+?\d{9,15}", stripped):
        raise ValueError("Некорректный формат телефона")
    return stripped


def _validate_inn(v: str) -> str | None:
    if not v.strip():
        return None
    if not _TIN_RE.fullmatch(v):
        raise ValueError("ИНН должен состоять из 9-14 цифр")
    return v


def _validate_currency(v: str) -> str:
    v = v.upper()
    if not _CURRENCY_RE.fullmatch(v):
        raise ValueError("Валюта должна быть 3-буквенным кодом ISO 4217, например UZS")
    return v


class CompanyCreate(BaseSchema):
    name: str
    slug: str
    country_code: str | None = None
    timezone: str = "UTC"
    currency: str = "UZS"

    @field_validator("currency")
    @classmethod
    def check_currency(cls, v: str) -> str:
        return _validate_currency(v)


class CompanyUpdate(BaseSchema):
    # BE-09/BE-22: unknown fields are rejected (422) instead of silently
    # dropped — a PATCH that "succeeds" but doesn't save what the caller
    # sent is worse than one that fails loudly.
    model_config = {"from_attributes": True, "extra": "forbid"}

    name: str | None = None
    country_code: str | None = None
    timezone: str | None = None
    currency: str | None = None
    address: str | None = None
    phone: str | None = None
    inn: str | None = None
    vat_rate: float | None = Field(None, ge=0, le=100)
    service_fee: float | None = Field(None, ge=0, le=100)

    @field_validator("currency")
    @classmethod
    def check_currency(cls, v: str | None) -> str | None:
        return _validate_currency(v) if v is not None else v

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v: str | None) -> str | None:
        return _validate_phone(v) if v is not None else v

    @field_validator("inn")
    @classmethod
    def check_inn(cls, v: str | None) -> str | None:
        return _validate_inn(v) if v is not None else v


class CompanyResponse(BaseResponseSchema):
    slug: str
    name: str
    country_code: str | None
    timezone: str
    currency: str
    is_active: bool
    address: str | None = None
    phone: str | None = None
    inn: str | None = None
    logo: str | None = None
    vat_rate: float | None = None
    service_fee: float | None = None


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

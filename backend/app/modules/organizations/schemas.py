from __future__ import annotations
from datetime import date
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, Field, field_validator
from app.shared.base_schema import BaseResponseSchema
from app.modules.auth.schemas import _validate_password


class OrganizationStatusCreate(BaseModel):
    name: str
    sort: int = 0
    status: bool = True


class OrganizationStatusUpdate(BaseModel):
    name: str | None = None
    sort: int | None = None
    status: bool | None = None


class OrganizationStatusResponse(BaseResponseSchema):
    name: str
    sort: int
    status: bool


class OrganizationBase(BaseModel):
    name: str
    tariff_price: Decimal = Decimal(0)
    working_days: int = 0
    is_main: bool = False
    virtual_cash_register_number: str | None = None
    virtual_cash_register_ip_address: str | None = None
    country_id: UUID | None = None
    region_id: UUID | None = None
    district_id: UUID | None = None
    installation_date: date | None = None
    tin: str | None = None
    is_solvent: bool = True
    enabled_storage_integration: bool = False
    online_menu: bool = False
    status: str = "active"
    taplink: str | None = None
    is_billing_autoblock: bool = False
    is_face_detection_required: bool = False
    organization_status_id: UUID | None = None


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationUpdate(BaseModel):
    name: str | None = None
    tariff_price: Decimal | None = None
    working_days: int | None = None
    is_main: bool | None = None
    virtual_cash_register_number: str | None = None
    virtual_cash_register_ip_address: str | None = None
    country_id: UUID | None = None
    region_id: UUID | None = None
    district_id: UUID | None = None
    installation_date: date | None = None
    tin: str | None = None
    is_solvent: bool | None = None
    enabled_storage_integration: bool | None = None
    online_menu: bool | None = None
    status: str | None = None
    taplink: str | None = None
    is_billing_autoblock: bool | None = None
    is_face_detection_required: bool | None = None
    organization_status_id: UUID | None = None


class OrganizationResponse(OrganizationBase, BaseResponseSchema):
    cash_balance: Decimal


class AccountCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=150, pattern=r"^[a-zA-Z0-9_.@-]+$")
    password: str
    name: str
    email: str | None = None  # если не задан — генерируется из username
    role_slug: str = "admin"
    is_active: bool = True
    organization_ids: list[UUID] = Field(default_factory=list)

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return _validate_password(v)


class AccountUpdate(BaseModel):
    password: str | None = None
    name: str | None = None
    role_slug: str | None = None
    is_active: bool | None = None
    organization_ids: list[UUID] | None = None

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str | None) -> str | None:
        return _validate_password(v) if v else v


class AccountResponse(BaseResponseSchema):
    username: str | None
    name: str | None
    email: str
    is_active: bool
    role_slug: str | None = None
    organization_ids: list[UUID] = Field(default_factory=list)


class OfflineJobCreate(BaseModel):
    type: str
    organization_id: UUID
    payload: dict | None = None
    idempotency_key: str | None = None


class OfflineJobResponse(BaseResponseSchema):
    type: str
    organization_id: UUID
    status: str
    error: str | None
    payload: dict | None
    idempotency_key: str | None

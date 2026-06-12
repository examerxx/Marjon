from __future__ import annotations
from datetime import date as date_type, datetime
from uuid import UUID
from pydantic import BaseModel, Field
from app.shared.base_schema import BaseResponseSchema


class LanguageCreate(BaseModel):
    name: str
    code: str = Field(..., min_length=2, max_length=8)
    status: bool = True
    state: str | None = None


class LanguageUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    status: bool | None = None
    state: str | None = None


class LanguageResponse(BaseResponseSchema):
    name: str
    code: str
    status: bool
    state: str | None


class TranslationCreate(BaseModel):
    key: str
    type: str | None = None
    values: dict[str, str] = Field(default_factory=dict)


class TranslationUpdate(BaseModel):
    key: str | None = None
    type: str | None = None
    values: dict[str, str] | None = None


class TranslationResponse(BaseResponseSchema):
    key: str
    type: str | None
    values: dict[str, str] | None


class TranslationImportResult(BaseModel):
    created: int
    updated: int


class ImageBackgroundCreate(BaseModel):
    name: str
    photo: str | None = None


class ImageBackgroundUpdate(BaseModel):
    name: str | None = None
    photo: str | None = None


class ImageBackgroundResponse(BaseResponseSchema):
    name: str
    photo: str | None


class StoreVersionCreate(BaseModel):
    date: date_type | None = None
    title: str | None = None
    version: str
    description: str | None = None
    platform: str = "android"


class StoreVersionUpdate(BaseModel):
    date: date_type | None = None
    title: str | None = None
    version: str | None = None
    description: str | None = None
    platform: str | None = None


class StoreVersionResponse(BaseResponseSchema):
    date: date_type | None
    title: str | None
    version: str
    description: str | None
    platform: str


class UserLogCreate(BaseModel):
    name: str
    device_name: str | None = None
    device_id: str | None = None
    organization_id: UUID | None = None
    properties: dict | None = None


class UserLogResponse(BaseResponseSchema):
    name: str
    device_name: str | None
    device_id: str | None
    organization_id: UUID | None
    properties: dict | None
    ip_address: str | None
    date: datetime

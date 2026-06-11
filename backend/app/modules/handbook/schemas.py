from __future__ import annotations
from uuid import UUID
from pydantic import BaseModel
from app.shared.base_schema import BaseResponseSchema


class CountryCreate(BaseModel):
    name: str
    status: bool = True


class CountryUpdate(BaseModel):
    name: str | None = None
    status: bool | None = None


class CountryResponse(BaseResponseSchema):
    name: str
    status: bool


class RegionCreate(BaseModel):
    name: str
    country_id: UUID
    status: bool = True


class RegionUpdate(BaseModel):
    name: str | None = None
    country_id: UUID | None = None
    status: bool | None = None


class RegionResponse(BaseResponseSchema):
    name: str
    country_id: UUID
    status: bool


class DistrictCreate(BaseModel):
    name: str
    region_id: UUID
    status: bool = True


class DistrictUpdate(BaseModel):
    name: str | None = None
    region_id: UUID | None = None
    status: bool | None = None


class DistrictResponse(BaseResponseSchema):
    name: str
    region_id: UUID
    status: bool

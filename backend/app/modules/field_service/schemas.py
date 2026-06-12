from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel
from app.shared.base_schema import BaseResponseSchema


class EmployeeCreate(BaseModel):
    fio: str
    phone: str | None = None
    role: str | None = None
    balance: Decimal = Decimal(0)
    participates_in_rating: bool = True
    external_id: str | None = None
    organization_id: UUID | None = None


class EmployeeUpdate(BaseModel):
    fio: str | None = None
    phone: str | None = None
    role: str | None = None
    balance: Decimal | None = None
    participates_in_rating: bool | None = None
    external_id: str | None = None
    organization_id: UUID | None = None
    last_lat: Decimal | None = None
    last_lng: Decimal | None = None


class EmployeeResponse(BaseResponseSchema):
    fio: str
    phone: str | None
    role: str | None
    balance: Decimal
    participates_in_rating: bool
    external_id: str | None
    organization_id: UUID | None
    last_lat: Decimal | None
    last_lng: Decimal | None


class ServiceCreate(BaseModel):
    name: str
    penalty_percent: Decimal = Decimal(0)
    points_on_time: int = 0
    points_late: int = 0
    points_not_done: int = 0
    deadline_hours: int | None = None
    external_id: str | None = None


class ServiceUpdate(BaseModel):
    name: str | None = None
    penalty_percent: Decimal | None = None
    points_on_time: int | None = None
    points_late: int | None = None
    points_not_done: int | None = None
    deadline_hours: int | None = None
    external_id: str | None = None


class ServiceResponse(BaseResponseSchema):
    name: str
    penalty_percent: Decimal
    points_on_time: int
    points_late: int
    points_not_done: int
    deadline_hours: int | None
    external_id: str | None


class TechHelpCreate(BaseModel):
    requester: str | None = None
    text: str
    provider: str | None = None
    status: str = "new"
    rating: int | None = None
    organization_id: UUID | None = None


class TechHelpUpdate(BaseModel):
    requester: str | None = None
    text: str | None = None
    provider: str | None = None
    status: str | None = None
    rating: int | None = None


class TechHelpResponse(BaseResponseSchema):
    requester: str | None
    text: str
    provider: str | None
    status: str
    rating: int | None
    organization_id: UUID | None


class EmployeeOnMap(BaseModel):
    id: UUID
    fio: str
    lat: Decimal
    lng: Decimal


class ServiceStatisticsRow(BaseModel):
    service_id: UUID
    service_name: str
    total: int
    completed: int
    overdue: int


class SyncResult(BaseModel):
    created: int
    updated: int

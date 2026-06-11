from __future__ import annotations
from uuid import UUID
from pydantic import BaseModel, Field
from app.shared.base_schema import BaseResponseSchema


class LeadStatusCreate(BaseModel):
    name: str
    sort: int = 0
    color: str | None = None
    status: bool = True


class LeadStatusUpdate(BaseModel):
    name: str | None = None
    sort: int | None = None
    color: str | None = None
    status: bool | None = None


class LeadStatusResponse(BaseResponseSchema):
    name: str
    sort: int
    color: str | None
    status: bool


class LeadTagCreate(BaseModel):
    name: str
    sort: int = 0
    color: str | None = None


class LeadTagUpdate(BaseModel):
    name: str | None = None
    sort: int | None = None
    color: str | None = None


class LeadTagResponse(BaseResponseSchema):
    name: str
    sort: int
    color: str | None


class NamedDictCreate(BaseModel):
    name: str
    status: bool = True


class NamedDictUpdate(BaseModel):
    name: str | None = None
    status: bool | None = None


class NamedDictResponse(BaseResponseSchema):
    name: str
    status: bool


class LeadBase(BaseModel):
    customer_name: str
    phones: list[str] = Field(default_factory=list)
    type_of_activity_id: UUID | None = None
    region_id: UUID | None = None
    district_id: UUID | None = None
    source_id: UUID | None = None
    status_id: UUID | None = None
    cancellation_reason_id: UUID | None = None
    type: str = "online"
    quality: str | None = None
    quantity: int | None = None
    comment: str | None = None
    user_id: UUID | None = None
    organization_id: UUID | None = None


class LeadCreate(LeadBase):
    tag_ids: list[UUID] = Field(default_factory=list)


class LeadUpdate(BaseModel):
    customer_name: str | None = None
    phones: list[str] | None = None
    type_of_activity_id: UUID | None = None
    region_id: UUID | None = None
    district_id: UUID | None = None
    source_id: UUID | None = None
    status_id: UUID | None = None
    cancellation_reason_id: UUID | None = None
    type: str | None = None
    quality: str | None = None
    quantity: int | None = None
    comment: str | None = None
    user_id: UUID | None = None
    organization_id: UUID | None = None
    tag_ids: list[UUID] | None = None


class LeadResponse(LeadBase, BaseResponseSchema):
    tags: list[LeadTagResponse] = Field(default_factory=list)


class LeadTagsAssign(BaseModel):
    tag_ids: list[UUID]


class LeadStatisticsRow(BaseModel):
    source_id: UUID | None
    source_name: str
    counts: dict[str, int]  # status_id (str) -> количество
    total: int


class LeadStatisticsResponse(BaseModel):
    statuses: list[LeadStatusResponse]
    rows: list[LeadStatisticsRow]
    totals: dict[str, int]
    grand_total: int


class LeadImportResult(BaseModel):
    created: int
    errors: list[str]

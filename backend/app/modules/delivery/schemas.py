from __future__ import annotations
from decimal import Decimal
from uuid import UUID

from pydantic import Field

from app.shared.base_schema import BaseSchema, BaseResponseSchema


class ZoneCreate(BaseSchema):
    branch_id: UUID
    name: str
    polygon: list = Field(default_factory=list)
    delivery_fee: Decimal = Decimal("0")
    min_order: Decimal = Decimal("0")
    estimated_minutes: int = 30


class ZoneResponse(BaseResponseSchema):
    company_id: UUID
    branch_id: UUID
    name: str
    polygon: list
    delivery_fee: Decimal
    min_order: Decimal
    estimated_minutes: int
    is_active: bool


class CourierCreate(BaseSchema):
    name: str
    phone: str
    vehicle_type: str = "bike"


class CourierResponse(BaseResponseSchema):
    company_id: UUID
    user_id: UUID
    name: str
    phone: str
    vehicle_type: str
    is_active: bool
    is_available: bool


class DeliveryOrderCreate(BaseSchema):
    order_id: UUID
    address_text: str
    zone_id: UUID | None = None
    address_lat: Decimal | None = None
    address_lng: Decimal | None = None


class CourierAssign(BaseSchema):
    courier_id: UUID


class DeliveryStatusUpdate(BaseSchema):
    status: str


class LocationUpdate(BaseSchema):
    lat: Decimal
    lng: Decimal


class DeliveryOrderResponse(BaseResponseSchema):
    company_id: UUID
    order_id: UUID
    courier_id: UUID | None
    zone_id: UUID | None
    status: str
    address_text: str
    delivery_fee: Decimal
    estimated_time: int | None

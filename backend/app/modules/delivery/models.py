from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class DeliveryZone(TimeStampedModel):
    __tablename__ = "delivery_zones"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    polygon: Mapped[list] = mapped_column(JSON, default=list)
    delivery_fee: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    min_order: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    estimated_minutes: Mapped[int] = mapped_column(Integer, default=30)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Courier(TimeStampedModel):
    __tablename__ = "couriers"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    # bike | car | foot
    vehicle_type: Mapped[str] = mapped_column(String(20), default="bike")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_available: Mapped[bool] = mapped_column(Boolean, default=False)
    current_lat: Mapped[Decimal | None] = mapped_column(Numeric(10, 8))
    current_lng: Mapped[Decimal | None] = mapped_column(Numeric(11, 8))
    last_location_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DeliveryOrder(TimeStampedModel):
    __tablename__ = "delivery_orders"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    order_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id"), index=True)
    courier_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("couriers.id"), nullable=True)
    zone_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("delivery_zones.id"), nullable=True)
    # new | assigned | picked_up | on_way | delivered | failed
    status: Mapped[str] = mapped_column(String(20), default="new")
    address_text: Mapped[str] = mapped_column(Text, nullable=False)
    address_lat: Mapped[Decimal | None] = mapped_column(Numeric(10, 8))
    address_lng: Mapped[Decimal | None] = mapped_column(Numeric(11, 8))
    delivery_fee: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    estimated_time: Mapped[int | None] = mapped_column(Integer)
    actual_time: Mapped[int | None] = mapped_column(Integer)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    picked_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

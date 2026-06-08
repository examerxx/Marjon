from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class Customer(TimeStampedModel):
    __tablename__ = "customers"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255))
    birth_date: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(1))
    # pos | qr | delivery
    source: Mapped[str] = mapped_column(String(50), default="pos")
    total_orders: Mapped[int] = mapped_column(Integer, default=0)
    total_spent: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    last_visit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    notes: Mapped[list[CustomerNote]] = relationship(back_populates="customer", cascade="all, delete-orphan")


class CustomerNote(TimeStampedModel):
    __tablename__ = "customer_notes"

    customer_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text, nullable=False)

    customer: Mapped[Customer] = relationship(back_populates="notes")

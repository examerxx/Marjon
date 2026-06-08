from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class Plan(TimeStampedModel):
    __tablename__ = "plans"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    price_monthly: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    price_yearly: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    features: Mapped[dict] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    subscriptions: Mapped[list[Subscription]] = relationship(back_populates="plan")


class Subscription(TimeStampedModel):
    __tablename__ = "subscriptions"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    plan_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("plans.id"), index=True)
    # trial | active | past_due | cancelled | expired
    status: Mapped[str] = mapped_column(String(20), default="trial")
    # monthly | yearly
    billing_cycle: Mapped[str] = mapped_column(String(10), default="monthly")
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    plan: Mapped[Plan] = relationship(back_populates="subscriptions")
    invoices: Mapped[list[Invoice]] = relationship(back_populates="subscription", cascade="all, delete-orphan")


class Invoice(TimeStampedModel):
    __tablename__ = "invoices"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    subscription_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("subscriptions.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="UZS")
    # draft | open | paid | void
    status: Mapped[str] = mapped_column(String(20), default="draft")
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("payments.id"), nullable=True)

    subscription: Mapped[Subscription] = relationship(back_populates="invoices")

from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from sqlalchemy import Numeric, String, Boolean, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class Hall(TimeStampedModel):
    """BE-14: doubles as the "places" screen's backing model
    (SettingsPlacesPage.jsx posts to this exact /halls endpoint) — the
    pricing fields below were added for that; a hall/place with no
    pricing configured just leaves them null."""
    __tablename__ = "halls"

    company_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Free-text price description (e.g. "Цена за час: 100 000 UZS") — the
    # settings form has a single plain-text field for this, not structured
    # sub-fields, so it's stored as-is rather than parsed.
    condition: Mapped[str | None] = mapped_column(Text)
    percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    # percent | hourly | fixed | time_based — how this place's fee is
    # calculated. Distinct from payment_type_id (an actual PaymentType —
    # cash/card/transfer); the frontend's "Тип оплаты места" dropdown is
    # really this, not a link to a payment method.
    pricing_type: Mapped[str | None] = mapped_column(String(20))
    payment_type_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fin_payment_types.id", ondelete="SET NULL"), nullable=True
    )

    tables: Mapped[list[Table]] = relationship(back_populates="hall", cascade="all, delete-orphan")


class Table(TimeStampedModel):
    __tablename__ = "tables"

    hall_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("halls.id", ondelete="CASCADE"), nullable=False, index=True
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=4)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    hall: Mapped[Hall] = relationship(back_populates="tables")

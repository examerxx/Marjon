from __future__ import annotations
from datetime import date, datetime
from uuid import UUID
from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import SoftDeleteMixin, TimeStampedModel


class Storage(TimeStampedModel):
    """Склад/филиал (ТЗ §5.5)."""

    __tablename__ = "adm_storages"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), index=True
    )


class Provider(TimeStampedModel):
    __tablename__ = "adm_providers"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32))
    comment: Mapped[str | None] = mapped_column(Text)


class Coming(TimeStampedModel, SoftDeleteMixin):
    """Поступление на склад: draft редактируется, accepted увеличивает остатки."""

    __tablename__ = "adm_comings"

    number: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    provider_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("adm_providers.id", ondelete="SET NULL")
    )
    storage_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("adm_storages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    receipt_date: Mapped[date | None] = mapped_column(Date)
    registration_date: Mapped[date | None] = mapped_column(Date)
    acceptance_date: Mapped[date | None] = mapped_column(Date)
    comment: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|accepted
    total_sum: Mapped[float] = mapped_column(Numeric(16, 2), default=0)

    items: Mapped[list[ComingItem]] = relationship(
        back_populates="coming", cascade="all, delete-orphan", lazy="selectin"
    )


class ComingItem(TimeStampedModel):
    __tablename__ = "adm_coming_items"

    coming_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("adm_comings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("nm_categories.id", ondelete="SET NULL")
    )
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("nm_products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[str | None] = mapped_column(String(32))
    price: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    qty: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    total: Mapped[float] = mapped_column(Numeric(16, 2), default=0)

    coming: Mapped[Coming] = relationship(back_populates="items")


class StorageMovement(TimeStampedModel):
    """Движение по складу — основа остатков и отчётов приход/расход (ТЗ §6)."""

    __tablename__ = "adm_storage_movements"

    storage_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("adm_storages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("nm_products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    direction: Mapped[str] = mapped_column(String(16), nullable=False)  # income|expense
    qty: Mapped[float] = mapped_column(Numeric(14, 3), nullable=False)
    price: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    coming_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("adm_comings.id", ondelete="SET NULL")
    )
    comment: Mapped[str | None] = mapped_column(Text)

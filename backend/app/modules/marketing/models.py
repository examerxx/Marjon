from __future__ import annotations
from uuid import UUID
from sqlalchemy import Boolean, Column, ForeignKey, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import Base, SoftDeleteMixin, TimeStampedModel
from app.modules.organizations.models import JsonType


lead_tag_links = Table(
    "lead_tag_links",
    Base.metadata,
    Column("lead_id", Uuid(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Uuid(as_uuid=True), ForeignKey("lead_tags.id", ondelete="CASCADE"), primary_key=True),
)


class LeadStatus(TimeStampedModel):
    __tablename__ = "lead_statuses"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sort: Mapped[int] = mapped_column(default=0)
    color: Mapped[str | None] = mapped_column(String(16))
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class LeadTag(TimeStampedModel):
    __tablename__ = "lead_tags"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sort: Mapped[int] = mapped_column(default=0)
    color: Mapped[str | None] = mapped_column(String(16))


class LeadCancellationReason(TimeStampedModel):
    __tablename__ = "lead_cancellation_reasons"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class Source(TimeStampedModel):
    """Общий справочник источников (лиды и задачи, ТЗ §5.3/§5.8)."""

    __tablename__ = "lead_sources"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class ActivityType(TimeStampedModel):
    __tablename__ = "activity_types"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class Lead(TimeStampedModel, SoftDeleteMixin):
    __tablename__ = "leads"

    customer_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    phones: Mapped[list | None] = mapped_column(JsonType)  # 1..N номеров
    type_of_activity_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("activity_types.id", ondelete="SET NULL")
    )
    region_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("hb_regions.id", ondelete="SET NULL")
    )
    district_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("hb_districts.id", ondelete="SET NULL")
    )
    source_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("lead_sources.id", ondelete="SET NULL"), index=True
    )
    status_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("lead_statuses.id", ondelete="SET NULL"), index=True
    )
    cancellation_reason_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("lead_cancellation_reasons.id", ondelete="SET NULL")
    )
    type: Mapped[str] = mapped_column(String(16), default="online")  # online|offline
    quality: Mapped[str | None] = mapped_column(String(32))
    quantity: Mapped[int | None] = mapped_column()  # для offline-лидов
    comment: Mapped[str | None] = mapped_column(Text)
    user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )  # менеджер
    organization_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), index=True
    )

    tags: Mapped[list[LeadTag]] = relationship(secondary=lead_tag_links, lazy="selectin")

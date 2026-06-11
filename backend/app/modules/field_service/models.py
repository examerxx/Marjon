from __future__ import annotations
from uuid import UUID
from sqlalchemy import Boolean, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid
from app.shared.base_model import SoftDeleteMixin, TimeStampedModel

# Сервисные сотрудники/услуги главной админки (ТЗ §5.7).
# Таблица employees занята POS-модулем hr — используем префикс srv_.


class ServiceEmployee(TimeStampedModel, SoftDeleteMixin):
    __tablename__ = "srv_employees"

    fio: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    phone: Mapped[str | None] = mapped_column(String(32))
    role: Mapped[str | None] = mapped_column(String(64))
    balance: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    participates_in_rating: Mapped[bool] = mapped_column(Boolean, default=True)
    external_id: Mapped[str | None] = mapped_column(String(128), index=True)  # devent
    organization_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), index=True
    )
    # координаты для «сотрудники на карте»
    last_lat: Mapped[float | None] = mapped_column(Numeric(9, 6))
    last_lng: Mapped[float | None] = mapped_column(Numeric(9, 6))


class Service(TimeStampedModel, SoftDeleteMixin):
    __tablename__ = "srv_services"

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    penalty_percent: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    points_on_time: Mapped[int] = mapped_column(default=0)
    points_late: Mapped[int] = mapped_column(default=0)
    points_not_done: Mapped[int] = mapped_column(default=0)
    deadline_hours: Mapped[int | None] = mapped_column()  # срок выполнения
    external_id: Mapped[str | None] = mapped_column(String(128), index=True)  # devent


class TechHelp(TimeStampedModel):
    """Обращения в техподдержку (ТЗ §5.7)."""

    __tablename__ = "srv_tech_help"

    requester: Mapped[str | None] = mapped_column(String(255))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default="new")
    rating: Mapped[int | None] = mapped_column()
    organization_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), index=True
    )

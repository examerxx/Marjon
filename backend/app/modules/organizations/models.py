from __future__ import annotations
from datetime import date, datetime
from uuid import UUID
from sqlalchemy import Boolean, Column, Date, ForeignKey, Numeric, String, Table, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON, Uuid
from app.shared.base_model import Base, SoftDeleteMixin, TimeStampedModel

# Кросс-СУБД JSON: JSONB на Postgres, обычный JSON на SQLite (тесты)
JsonType = JSON().with_variant(JSONB(), "postgresql")


# Привязка аккаунтов (users) к организациям главной админки (M2M, ТЗ §4.1)
user_organizations = Table(
    "user_organizations",
    Base.metadata,
    Column("user_id", Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("organization_id", Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True),
)


class OrganizationStatus(TimeStampedModel):
    __tablename__ = "organization_statuses"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sort: Mapped[int] = mapped_column(default=0)
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class Organization(TimeStampedModel, SoftDeleteMixin):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    tariff_price: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    working_days: Mapped[int] = mapped_column(default=0)
    is_main: Mapped[bool] = mapped_column(Boolean, default=False)
    virtual_cash_register_number: Mapped[str | None] = mapped_column(String(64))
    virtual_cash_register_ip_address: Mapped[str | None] = mapped_column(String(45))
    country_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("hb_countries.id", ondelete="SET NULL")
    )
    region_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("hb_regions.id", ondelete="SET NULL")
    )
    district_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("hb_districts.id", ondelete="SET NULL")
    )
    installation_date: Mapped[date | None] = mapped_column(Date)
    tin: Mapped[str | None] = mapped_column(String(20))  # ИНН
    is_solvent: Mapped[bool] = mapped_column(Boolean, default=True)
    enabled_storage_integration: Mapped[bool] = mapped_column(Boolean, default=False)
    online_menu: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(32), default="active")  # active|blocked
    taplink: Mapped[str | None] = mapped_column(String(512))
    is_billing_autoblock: Mapped[bool] = mapped_column(Boolean, default=False)
    is_face_detection_required: Mapped[bool] = mapped_column(Boolean, default=False)
    organization_status_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organization_statuses.id", ondelete="SET NULL")
    )
    # Касса организации — баланс для финансовых операций (ТЗ §6)
    cash_balance: Mapped[float] = mapped_column(Numeric(16, 2), default=0)

    organization_status: Mapped[OrganizationStatus | None] = relationship()


class OfflineJob(TimeStampedModel):
    __tablename__ = "offline_jobs"

    type: Mapped[str] = mapped_column(String(64), nullable=False)
    organization_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending|processing|done|error
    error: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict | None] = mapped_column(JsonType)
    # Ключ идемпотентности офлайн-синхронизации мобильных клиентов (ТЗ §8)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True)

from __future__ import annotations
from datetime import date, datetime
from uuid import UUID
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel
from app.modules.organizations.models import JsonType


class Language(TimeStampedModel):
    __tablename__ = "adm_languages"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    code: Mapped[str] = mapped_column(String(8), nullable=False, unique=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    state: Mapped[str | None] = mapped_column(String(32))


class Translation(TimeStampedModel):
    __tablename__ = "adm_translations"

    key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    type: Mapped[str | None] = mapped_column(String(64))
    values: Mapped[dict | None] = mapped_column(JsonType)  # {"ru": "...", "uz": "..."}


class ImageBackground(TimeStampedModel):
    __tablename__ = "adm_image_backgrounds"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    photo: Mapped[str | None] = mapped_column(String(512))  # URL/ключ в хранилище


class StoreVersion(TimeStampedModel):
    __tablename__ = "adm_store_versions"

    date: Mapped[date | None] = mapped_column(Date)
    title: Mapped[str | None] = mapped_column(String(255))
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    platform: Mapped[str] = mapped_column(String(16), default="android")  # android|ios


class UserLog(TimeStampedModel):
    """Действия из приложений (ТЗ §5.12)."""

    __tablename__ = "adm_user_logs"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    device_name: Mapped[str | None] = mapped_column(String(255))
    device_id: Mapped[str | None] = mapped_column(String(255), index=True)
    organization_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), index=True
    )
    properties: Mapped[dict | None] = mapped_column(JsonType)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

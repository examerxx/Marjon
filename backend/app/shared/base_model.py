from __future__ import annotations
from uuid import UUID, uuid4
from datetime import datetime
from sqlalchemy import Boolean, DateTime, Integer, func
from sqlalchemy.orm import DeclarativeBase, mapped_column, Mapped
from sqlalchemy.types import Uuid


class Base(DeclarativeBase):
    pass


class TimeStampedModel(Base):
    __abstract__ = True

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid4
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SoftDeleteMixin:
    """Сущности с историей не удаляются физически (см. ТЗ §4.3)."""

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class DictionaryMixin:
    """Справочники: порядок и признак активности вместо удаления."""

    sort: Mapped[int] = mapped_column(default=0)
    status: Mapped[bool] = mapped_column(default=True)

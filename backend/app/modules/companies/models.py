from __future__ import annotations
from uuid import UUID
from typing import TYPE_CHECKING
from sqlalchemy import String, Boolean, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel

if TYPE_CHECKING:
    from app.modules.auth.models import User


class Company(TimeStampedModel):
    __tablename__ = "companies"

    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(2))
    timezone: Mapped[str] = mapped_column(String(50), default="UTC")
    currency: Mapped[str] = mapped_column(String(3), default="UZS")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    branches: Mapped[list[Branch]] = relationship(back_populates="company", cascade="all, delete-orphan")
    users: Mapped[list[User]] = relationship(back_populates="company")


class Branch(TimeStampedModel):
    __tablename__ = "branches"

    company_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    company: Mapped[Company] = relationship(back_populates="branches")

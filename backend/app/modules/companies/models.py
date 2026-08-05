from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from typing import TYPE_CHECKING
from sqlalchemy import String, Boolean, Numeric, Text, ForeignKey
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
    # Реквизиты для профиля/чека (SettingsProfilePage, ReceiptSettingsPage)
    address: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(32))
    inn: Mapped[str | None] = mapped_column(String(32))
    # Лого компании — печатается на чеке (растром через ESC/POS) и в UI.
    # logo_key — ключ в MinIO/S3 для серверной загрузки байт при печати;
    # logo_url — публичная ссылка для фронтенда (тот же путь, что и avatar_url).
    logo_url: Mapped[str | None] = mapped_column(String(512))
    logo_key: Mapped[str | None] = mapped_column(String(255))
    # BE-09: frontend's company-profile screen expects these; PATCH
    # /companies/me previously silently dropped them (no such column, and
    # CompanyUpdate had no such field — pydantic's default extra="ignore"
    # means an unknown field is just dropped, not rejected).
    vat_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    service_fee: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))

    @property
    def logo(self) -> str | None:
        """Алиас для CompanyResponse — фронтенд (OrgContext) ожидает поле 'logo'."""
        return self.logo_url

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

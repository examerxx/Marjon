from __future__ import annotations
from uuid import UUID
from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class Country(TimeStampedModel):
    __tablename__ = "hb_countries"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

    regions: Mapped[list[Region]] = relationship(back_populates="country")


class Region(TimeStampedModel):
    __tablename__ = "hb_regions"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    country_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("hb_countries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[bool] = mapped_column(Boolean, default=True)

    country: Mapped[Country] = relationship(back_populates="regions")
    districts: Mapped[list[District]] = relationship(back_populates="region")


class District(TimeStampedModel):
    __tablename__ = "hb_districts"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    region_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("hb_regions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[bool] = mapped_column(Boolean, default=True)

    region: Mapped[Region] = relationship(back_populates="districts")

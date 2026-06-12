from __future__ import annotations
from uuid import UUID
from sqlalchemy import Boolean, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import SoftDeleteMixin, TimeStampedModel
from app.modules.organizations.models import JsonType

# Таблицы с префиксом nm_: products/categories/orders заняты POS-частью


class NomCategory(TimeStampedModel):
    __tablename__ = "nm_categories"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sort: Mapped[int] = mapped_column(default=0)
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class Unit(TimeStampedModel):
    __tablename__ = "nm_units"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    short_name: Mapped[str | None] = mapped_column(String(32))
    sort: Mapped[int] = mapped_column(default=0)
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class NomProduct(TimeStampedModel, SoftDeleteMixin):
    __tablename__ = "nm_products"

    photo: Mapped[str | None] = mapped_column(String(512))  # URL/ключ в хранилище
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    category_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("nm_categories.id", ondelete="SET NULL"), index=True
    )
    price: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    unit_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("nm_units.id", ondelete="SET NULL")
    )
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    # is_used разделяет «Список продуктов» и «Б/У» (ТЗ §5.4)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)

    category: Mapped[NomCategory | None] = relationship()
    unit: Mapped[Unit | None] = relationship()


class NomOrder(TimeStampedModel, SoftDeleteMixin):
    __tablename__ = "nm_orders"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    payment_id: Mapped[str | None] = mapped_column(String(128))
    items: Mapped[list | None] = mapped_column(JsonType)  # [{product_id, qty, price}]
    price: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    comment: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="new")
    organization_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), index=True
    )

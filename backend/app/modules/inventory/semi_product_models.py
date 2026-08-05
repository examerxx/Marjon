"""BE-10: semi-finished products (полуфабрикаты) — a company-scoped recipe
made of raw ingredients, with a computed cost price and a stock write-off
on production. Kept in its own file, mirroring warehouse_models.py."""
from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from typing import TYPE_CHECKING
from sqlalchemy import Boolean, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel

if TYPE_CHECKING:
    from app.modules.inventory.models import Ingredient


class SemiProduct(TimeStampedModel):
    __tablename__ = "semi_products"

    company_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    category_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    subcategory_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), default="кг")
    # Recalculated from composition whenever it's written (create/update
    # with an `ingredients` payload) — see SemiProductService._recalc_cost.
    # Not directly client-writable; a manually-supplied cost_price would be
    # exactly the "fictional zero instead of unknown data" problem BE-17
    # warns about.
    cost_price: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    ingredients: Mapped[list["SemiProductIngredient"]] = relationship(
        back_populates="semi_product", cascade="all, delete-orphan"
    )


class SemiProductIngredient(TimeStampedModel):
    __tablename__ = "semi_product_ingredients"

    semi_product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("semi_products.id", ondelete="CASCADE"), index=True
    )
    ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("ingredients.id", ondelete="CASCADE"), index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), nullable=False)

    semi_product: Mapped[SemiProduct] = relationship(back_populates="ingredients")
    ingredient: Mapped["Ingredient"] = relationship()

from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from sqlalchemy import Boolean, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class Category(TimeStampedModel):
    __tablename__ = "categories"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    products: Mapped[list[Product]] = relationship(back_populates="category")
    children: Mapped[list[Category]] = relationship()


class Product(TimeStampedModel):
    __tablename__ = "products"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    barcode: Mapped[str | None] = mapped_column(String(100))
    sku: Mapped[str | None] = mapped_column(String(100))
    price: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    cost_price: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("12.0"))
    unit: Mapped[str] = mapped_column(String(20), default="шт")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)

    category: Mapped[Category | None] = relationship(back_populates="products")
    modifier_groups: Mapped[list[ModifierGroup]] = relationship(back_populates="product", cascade="all, delete-orphan")
    branch_availability: Mapped[list[ProductBranch]] = relationship(back_populates="product", cascade="all, delete-orphan")


class ModifierGroup(TimeStampedModel):
    __tablename__ = "modifier_groups"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    product_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    min_select: Mapped[int] = mapped_column(Integer, default=0)
    max_select: Mapped[int] = mapped_column(Integer, default=1)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    product: Mapped[Product] = relationship(back_populates="modifier_groups")
    modifiers: Mapped[list[Modifier]] = relationship(back_populates="group", cascade="all, delete-orphan")


class Modifier(TimeStampedModel):
    __tablename__ = "modifiers"

    group_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("modifier_groups.id", ondelete="CASCADE"))
    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    price_delta: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    group: Mapped[ModifierGroup] = relationship(back_populates="modifiers")


class ProductBranch(TimeStampedModel):
    __tablename__ = "product_branch"

    product_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    price: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
    stop_list: Mapped[bool] = mapped_column(Boolean, default=False)

    product: Mapped[Product] = relationship(back_populates="branch_availability")


class Ingredient(TimeStampedModel):
    __tablename__ = "ingredients"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), default="кг")
    category: Mapped[str | None] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Warehouse(TimeStampedModel):
    __tablename__ = "warehouses"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    is_main: Mapped[bool] = mapped_column(Boolean, default=False)


class StockItem(TimeStampedModel):
    __tablename__ = "stock_items"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    warehouse_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("warehouses.id", ondelete="CASCADE"), index=True)
    ingredient_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("ingredients.id"), index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    unit: Mapped[str] = mapped_column(String(20), default="кг")
    min_quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    cost_price: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))


class StockMovement(TimeStampedModel):
    __tablename__ = "stock_movements"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    warehouse_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("warehouses.id"), index=True)
    ingredient_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("ingredients.id"))
    # purchase | sale | writeoff | transfer | adjustment | inventory
    movement_type: Mapped[str] = mapped_column(String(30), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), nullable=False)
    unit: Mapped[str] = mapped_column(String(20))
    cost_price: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    total_cost: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    ref_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text)

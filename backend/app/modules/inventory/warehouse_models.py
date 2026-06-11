"""Warehouse document models — purchase receipts, transfers, inventory checks, write-offs."""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.shared.base_model import TimeStampedModel


class PurchaseDocument(TimeStampedModel):
    """Приход товаров — документ поступления."""
    __tablename__ = "purchase_documents"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    supplier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    warehouse_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("warehouses.id"), nullable=True)
    warehouse_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    registered_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    accepted_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    items_count: Mapped[int] = mapped_column(Integer, default=0)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft, accepted
    created_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list[PurchaseDocumentItem]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class PurchaseDocumentItem(TimeStampedModel):
    """Позиция в документе прихода."""
    __tablename__ = "purchase_document_items"

    document_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("purchase_documents.id", ondelete="CASCADE"), index=True)
    ingredient_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("ingredients.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    unit: Mapped[str] = mapped_column(String(20), default="кг")
    cost_price: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))

    document: Mapped[PurchaseDocument] = relationship(back_populates="items")


class TransferDocument(TimeStampedModel):
    """Перемещение товаров между складами."""
    __tablename__ = "transfer_documents"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    from_warehouse_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("warehouses.id"), nullable=True)
    from_warehouse_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    to_warehouse_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("warehouses.id"), nullable=True)
    to_warehouse_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    items_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class InventoryCheck(TimeStampedModel):
    """Инвентаризация — проверка складских остатков."""
    __tablename__ = "inventory_checks"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    warehouse_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("warehouses.id"), nullable=True)
    warehouse_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    check_type: Mapped[str] = mapped_column(String(100), default="Приход и расход учтены")
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)


class WriteOffDocument(TimeStampedModel):
    """Списание — документ списания товаров."""
    __tablename__ = "write_off_documents"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    category: Mapped[str | None] = mapped_column(String(255), nullable=True)
    items_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

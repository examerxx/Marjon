"""Warehouse document models — purchase receipts, transfers, inventory checks, write-offs."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text, DateTime, func
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
    # Как оплачен приход: 'paid' — сразу (создан денежный расход), 'credit' — на потом
    # (кредиторка перед поставщиком). NULL — старые приходы: финансы не затрагиваются.
    payment_mode: Mapped[str | None] = mapped_column(String(10), nullable=True)
    payment_type_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fin_payment_types.id", ondelete="SET NULL"), nullable=True
    )
    finance_transaction_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fin_transactions.id", ondelete="SET NULL"), nullable=True
    )

    items: Mapped[list[PurchaseDocumentItem]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class PurchaseDocumentItem(TimeStampedModel):
    """Позиция в документе прихода.

    ingredient_id — обязательная ссылка на шаблон из «Продуктов» (туда же
    считается остаток/себестоимость). product_id — опциональная ссылка на
    Товар (реализация, product_type=sale), из которого шаблон был
    автопривязан при создании документа; по ней UI показывает Тип.
    """
    __tablename__ = "purchase_document_items"

    document_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("purchase_documents.id", ondelete="CASCADE"), index=True)
    ingredient_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("ingredients.id"), nullable=True)
    product_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"),
        nullable=True,
    )
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
    # Связанные документы корректировки (V42): излишки → приход, недостачи →
    # расход. NULL — корректировка не создавалась (совпало или выключено).
    purchase_doc_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    expense_doc_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)

    items: Mapped[list[InventoryCheckItem]] = relationship(
        back_populates="check", cascade="all, delete-orphan"
    )


class InventoryCheckItem(TimeStampedModel):
    """Строка инвентаризации — факт по позиции против учётного остатка.

    stock_qty — остаток на момент проверки (снапшот StockItem),
    actual_qty — посчитанный факт, diff_qty = actual - stock
    (> 0 — излишек в приход, < 0 — недостача в расход, 0 — совпало).
    cost_price — себестоимость из остатка (для сумм корректировки).
    """
    __tablename__ = "inventory_check_items"

    check_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("inventory_checks.id", ondelete="CASCADE"), index=True)
    ingredient_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("ingredients.id"), nullable=True)
    product_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), default="кг")
    stock_qty: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    actual_qty: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    diff_qty: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    cost_price: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))

    check: Mapped[InventoryCheck] = relationship(back_populates="items")


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


class ExpenseDocument(TimeStampedModel):
    """Расход товаров — документ выдачи/списания со склада (WH-01).

    Зеркалит PurchaseDocument, но проведение (accepted) не увеличивает, а
    УМЕНЬШАЕТ остатки (StockMovement type="expense"). «Получатель» (receiver) —
    аналог «поставщика» в приходе: кому/на что ушёл товар.
    """
    __tablename__ = "expense_documents"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    receiver: Mapped[str | None] = mapped_column(String(255), nullable=True)
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

    items: Mapped[list[ExpenseDocumentItem]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class ExpenseDocumentItem(TimeStampedModel):
    """Позиция в документе расхода."""
    __tablename__ = "expense_document_items"

    document_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("expense_documents.id", ondelete="CASCADE"), index=True)
    ingredient_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("ingredients.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    unit: Mapped[str] = mapped_column(String(20), default="кг")
    cost_price: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))

    document: Mapped[ExpenseDocument] = relationship(back_populates="items")


class WasteDocument(TimeStampedModel):
    """Отход товаров — построчный документ (WH-01).

    В отличие от прихода/расхода отход фиксируется по одной позиции (товар +
    количество + причина). Проведение (accepted) уменьшает остаток
    (StockMovement type="waste"). Черновик остаток не двигает.
    """
    __tablename__ = "waste_documents"

    # Some deployed schemas have NOT NULL timestamps without database defaults.
    # Include timestamps in INSERT for every creation path (manual, sale, expense)
    # instead of relying solely on inherited server_default. No schema change.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), server_default=func.now(), onupdate=func.now()
    )

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str | None] = mapped_column(String(255), nullable=True)
    warehouse_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("warehouses.id"), nullable=True)
    warehouse_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ingredient_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("ingredients.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    unit: Mapped[str] = mapped_column(String(20), default="кг")
    cost_price: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    registered_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    accepted_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft, accepted
    is_automatic: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class PosTerminal(TimeStampedModel):
    __tablename__ = "pos_terminals"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Order(TimeStampedModel):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("id", "company_id", name="uq_orders_id_company"),
    )

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id"), index=True)
    terminal_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("pos_terminals.id"), nullable=True)
    customer_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("customers.id"), nullable=True)
    # Indexed (bi06zrd06): the waiter dimension of /analytics/z-report/detail
    # filters and groups on this column.
    waiter_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    order_number: Mapped[str] = mapped_column(String(20), nullable=False)
    # dine_in | takeaway | delivery | qr
    order_type: Mapped[str] = mapped_column(String(20), default="dine_in")
    # new | accepted | cooking | ready | completed | cancelled
    status: Mapped[str] = mapped_column(String(20), default="new")
    table_number: Mapped[str | None] = mapped_column(String(20))
    # Canonical relation to the seating chart (Table → Hall → company).
    # Nullable: takeaway/delivery/QR orders and legacy rows carry no table.
    # ON DELETE SET NULL so archiving a table never destroys order history;
    # table_number above is retained as the display/history snapshot.
    table_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tables.id", ondelete="SET NULL"), nullable=True, index=True
    )
    persons_count: Mapped[int] = mapped_column(Integer, default=1)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    service_fee: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    note: Mapped[str | None] = mapped_column(Text)
    # pos | qr | delivery_app
    source: Mapped[str] = mapped_column(String(50), default="pos")

    items: Mapped[list[OrderItem]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderItem(TimeStampedModel):
    __tablename__ = "order_items"

    order_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("products.id"), index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    discount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    # pending | cooking | ready | served | cancelled
    status: Mapped[str] = mapped_column(String(20), default="pending")
    note: Mapped[str | None] = mapped_column(Text)
    modifiers: Mapped[dict] = mapped_column(JSON, default=list)
    course: Mapped[int] = mapped_column(Integer, default=1)

    order: Mapped[Order] = relationship(back_populates="items")


class CashierShift(TimeStampedModel):
    __tablename__ = "cashier_shifts"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id"), index=True)
    cashier_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), index=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    opening_cash: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    closing_cash: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    # open | closed
    status: Mapped[str] = mapped_column(String(20), default="open")

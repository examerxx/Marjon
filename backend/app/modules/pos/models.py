from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, JSON,
    Numeric, String, Text, UniqueConstraint, text,
)
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
        # ORDERS-TRUTH-01: public_id is a PER-COMPANY human/report identifier
        # (each tenant starts at 10000000 independently), so uniqueness is scoped
        # to the company — never global (a global sequence would leak platform-
        # wide order volume and share one 8-digit space across all tenants). The
        # UUID `id` remains the global technical key.
        UniqueConstraint("company_id", "public_id", name="uq_orders_company_public_id"),
        # ORDERS-TRUTH-01: DB uniqueness backstop for the NEW plain-integer
        # order_number scheme (per company + branch + company-local calendar
        # day). Partial: only NEW-format rows carry order_local_date, so legacy
        # YYYYMMDD-NNNN orders (order_local_date IS NULL) are exempt and never
        # collide with the new numbering. The counter table + advisory lock are
        # the primary generator; this index is the hard backstop against dupes.
        Index(
            "uq_orders_company_branch_localdate_number",
            "company_id", "branch_id", "order_local_date", "order_number",
            unique=True,
            postgresql_where=text("order_local_date IS NOT NULL"),
            sqlite_where=text("order_local_date IS NOT NULL"),
        ),
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
    # ORDERS-TRUTH-01 public identity. `id` (UUID) stays the canonical
    # internal/API/FK key, UNCHANGED. `public_id` is a separate, stable,
    # PER-COMPANY numeric business identifier for human/report display: each
    # company starts at 10000000 independently (target 8 digits; may grow to
    # 9+ rather than ever reuse a value). NOT NULL — the canonical
    # OrderService.create path (the only production creator) always assigns it
    # from the per-company OrderPublicIdCounter; the migration backfills every
    # existing row. Uniqueness is composite (company_id, public_id), never
    # global. Never derived from the UUID.
    public_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # NEW human order_number: plain "1","2","3"… resetting every company-local
    # calendar day, scoped per company + branch. Kept as String(20) for
    # backward/API compatibility — legacy rows retain their historical
    # "YYYYMMDD-NNNN" values untouched.
    order_number: Mapped[str] = mapped_column(String(20), nullable=False)
    # The company-local calendar date this order's NEW-format number belongs to.
    # NULL for legacy orders (predating this scheme) so they stay outside the
    # per-day uniqueness backstop. Set at creation from the company timezone.
    order_local_date: Mapped[date | None] = mapped_column(Date, nullable=True)
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
    # ORDERS-TRUTH-01 historical place snapshot: the Hall.name captured at order
    # creation time (the report must NOT resolve the CURRENT hall name via a live
    # join). Frozen — a later hall rename or table/hall archival never alters it.
    # NULL for tableless orders (takeaway/delivery/QR) and for legacy rows whose
    # table_id no longer resolves. Pairs with the existing table_number snapshot;
    # the frontend composes "<hall_name_snapshot>, стол <table_number>".
    hall_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    persons_count: Mapped[int] = mapped_column(Integer, default=1)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    service_fee: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    note: Mapped[str | None] = mapped_column(Text)
    # pos | qr | delivery_app
    source: Mapped[str] = mapped_column(String(50), default="pos")
    # Phase 1A cancellation truth: when/who cancelled the whole order.
    # Nullable, never backfilled — NULL means unknown/legacy or not cancelled.
    # cancelled_by_id is NULL for system/webhook cancellations with no
    # authenticated actor. ON DELETE SET NULL preserves order history.
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

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
    # Phase 1A cancellation truth: when/who cancelled this item.
    # Nullable, never backfilled — NULL means unknown/legacy or not cancelled.
    # cancelled_by_id is NULL for system cancellations with no authenticated
    # actor. ON DELETE SET NULL preserves item history.
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    order: Mapped[Order] = relationship(back_populates="items")


class OrderNumberCounter(TimeStampedModel):
    """ORDERS-TRUTH-01 durable per-scope order-number counter.

    Replaces the old COUNT(*)+1 scheme. One row per
    (company_id, branch_id, local_date); `last_value` holds the highest number
    handed out for that company/branch/company-local calendar day. Generation
    is an atomic read-modify-write serialized by a pg_advisory_xact_lock keyed
    on the same scope, so concurrent order creation never yields duplicates;
    the composite unique on (company_id, branch_id, local_date) is the durable
    backstop for the first-of-day INSERT race. Daily reset is implicit — a new
    local_date simply has no row yet and starts at 1.
    """
    __tablename__ = "order_number_counters"
    __table_args__ = (
        UniqueConstraint(
            "company_id", "branch_id", "local_date",
            name="uq_order_number_counters_scope",
        ),
    )

    company_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("branches.id"), nullable=False, index=True
    )
    local_date: Mapped[date] = mapped_column(Date, nullable=False)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class OrderPublicIdCounter(TimeStampedModel):
    """ORDERS-TRUTH-01 durable per-company public_id counter.

    One row per company; `last_value` holds the highest public_id handed out for
    that tenant (initialized to 9999999 so the first generated value is
    10000000). Generation is an atomic read-modify-write serialized by a
    pg_advisory_xact_lock keyed on the company, and the composite
    UNIQUE(company_id, public_id) on orders is the durable hard backstop. This
    replaces the global sequence: public_id is a tenant-facing identifier, so it
    must not leak platform-wide volume nor share one 8-digit space across
    tenants.
    """
    __tablename__ = "order_public_id_counters"
    __table_args__ = (
        UniqueConstraint("company_id", name="uq_order_public_id_counters_company"),
    )

    company_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True
    )
    last_value: Mapped[int] = mapped_column(BigInteger, nullable=False, default=9_999_999)


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

from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from sqlalchemy import Numeric, String, Boolean, Integer, ForeignKey, Text, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import SoftDeleteMixin, TimeStampedModel


class Hall(TimeStampedModel, SoftDeleteMixin):
    """BE-14: doubles as the "places" screen's backing model
    (SettingsPlacesPage.jsx posts to this exact /halls endpoint) — the
    pricing fields below were added for that; a hall/place with no
    pricing configured just leaves them null.

    Phase 5C-6D: `deleted_at` (from SoftDeleteMixin) is the canonical
    user-facing DELETE state — distinct from `is_active`. `is_active=false`
    is administratively "Неактивен" and stays visible in Settings; a non-null
    `deleted_at` archives the hall out of the Settings directory and all
    operational selection while preserving its Tables/Orders history. Every
    hall query that backs Settings/POS — and the report FILTER metadata —
    filters `deleted_at IS NULL`. Historical report DATA is deliberately
    exempt: Marjon is accounting software, so a tenant may still query a
    deleted hall's past rows by explicit hall_id (see
    AdminReportService.tables_report). That never resurrects the hall."""
    __tablename__ = "halls"
    # Phase 5C-6A: composite index backing branch-scoped ordered reads
    # (ORDER BY sort_order within a branch). Position uniqueness inside a
    # branch is guaranteed by construction — the reorder endpoint writes a
    # validated COMPLETE 0..n-1 permutation atomically and create() appends
    # under a per-branch row lock — so no unique/deferrable constraint is
    # needed here (and none is added: a strict constraint would only add
    # transient-collision handling to an already-safe write path).
    __table_args__ = (
        Index("ix_halls_branch_sort_order", "branch_id", "sort_order"),
    )

    company_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Free-text price description (e.g. "Цена за час: 100 000 UZS") — the
    # settings form has a single plain-text field for this, not structured
    # sub-fields, so it's stored as-is rather than parsed.
    condition: Mapped[str | None] = mapped_column(Text)
    percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    # BI-06 / Phase 5C-2: structured monetary amount for the "Доп. цена"
    # models (pricing_type fixed | hourly). Canonical Marjon money convention
    # (Numeric(15, 2) + Decimal). Nullable: historical rows and legacy clients
    # carry the amount only inside the free-text `condition`, and are never
    # backfilled from it.
    price_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    # percent | hourly | fixed | time_based — how this place's fee is
    # calculated. Distinct from payment_type_id (an actual PaymentType —
    # cash/card/transfer); the frontend's "Тип оплаты места" dropdown is
    # really this, not a link to a payment method.
    pricing_type: Mapped[str | None] = mapped_column(String(20))
    payment_type_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fin_payment_types.id", ondelete="SET NULL"), nullable=True
    )
    # Phase 5C-6A: branch-scoped display position. 0-based, contiguous within a
    # branch (0..n-1). NOT NULL — the migration backfills every existing row
    # deterministically (per branch, ordered by created_at then id) and new
    # halls are appended at max+1 by the service. server_default=0 is only a
    # safety net for any non-service insert; it is never the operational value.
    # Ordering is branch-scoped, NOT company-global: reorder never changes
    # company_id/branch_id/is_active/pricing — only this column.
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    tables: Mapped[list[Table]] = relationship(back_populates="hall", cascade="all, delete-orphan")


class Table(TimeStampedModel):
    __tablename__ = "tables"
    # Phase 5C-3: a table number is human-facing and unique only among the
    # ACTIVE tables of its hall. Partial (active-only) so soft-deleted seating
    # never blocks reusing its number, and so #5 may exist in several halls.
    # Mirrors the finance partial-unique convention (Index + *_where).
    __table_args__ = (
        Index(
            "uq_tables_hall_number_active",
            "hall_id", "number",
            unique=True,
            postgresql_where=text("is_active"),
            sqlite_where=text("is_active"),
        ),
    )

    hall_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("halls.id", ondelete="CASCADE"), nullable=False, index=True
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=4)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    hall: Mapped[Hall] = relationship(back_populates="tables")

from __future__ import annotations
from decimal import Decimal
from datetime import date
from typing import Literal
from uuid import UUID
from app.shared.base_schema import BaseSchema


class UserActivityRank(BaseSchema):
    rank: int
    user_id: UUID
    user_name: str
    sessions: int
    avg_session_seconds: int
    total_session_seconds: int


class SalesReport(BaseSchema):
    date: date
    orders_count: int
    revenue: Decimal
    avg_check: Decimal


class TopProduct(BaseSchema):
    product_id: UUID
    name: str
    quantity_sold: Decimal
    revenue: Decimal


class DashboardResponse(BaseSchema):
    today_revenue: Decimal
    today_orders: int
    avg_check: Decimal
    active_orders: int


class PaymentMethodSummary(BaseSchema):
    method: str
    amount: Decimal
    count: int


class ZReportFigures(BaseSchema):
    """The count/money fact block, used verbatim by every per-entity detail
    section and by the union totals. One definition of each figure, so there is
    never a second formula family: `net_sales` is always Σ Order.total_amount
    over completed orders in the window, and `avg_check` is always
    net_sales / orders_count recomputed from those union facts.

    Deliberately excludes shift_opened_at / shift_closed_at / is_closed: those
    are whole-company stubs (no fact row carries a shift_id), and echoing them
    on a per-cashier section would imply a shift settlement that does not exist.
    """
    orders_count: int
    # None (not 0) when the dimension structurally cannot attribute the figure —
    # see ZReportDetailResponse.unsupported_fields. A real "unknown", never a
    # zero that would read as an authoritative zero.
    cancelled_orders_count: int | None
    payments_count: int
    fiscal_receipts_count: int
    gross_sales: Decimal
    discounts_total: Decimal
    service_fee_total: Decimal
    tax_total: Decimal
    refunds_total: Decimal | None
    net_sales: Decimal
    cash_total: Decimal
    cash_received_total: Decimal
    change_given_total: Decimal
    non_cash_total: Decimal
    avg_check: Decimal
    payment_methods: list[PaymentMethodSummary]


class ZReportResponse(BaseSchema):
    # WIRE-FROZEN (ZR-PERIOD-01 / ZR-PRINT-01B): field names, order and
    # semantics below are byte-identical to the committed contract. The fields
    # are declared explicitly rather than inherited from ZReportFigures so the
    # serialized key ORDER cannot shift; the *computation* is what the detail
    # endpoint shares (AnalyticsService._figures_from_window).
    date: date
    # Period mode: present (and equal to the requested bounds) only for a
    # multi-day aggregation request; null for a single-date report. Lets the
    # client prove exactly which period the figures cover.
    date_from: date | None = None
    date_to: date | None = None
    shift_opened_at: str | None = None
    shift_closed_at: str | None = None
    is_closed: bool = False
    orders_count: int
    cancelled_orders_count: int
    payments_count: int
    fiscal_receipts_count: int
    gross_sales: Decimal
    discounts_total: Decimal
    service_fee_total: Decimal
    tax_total: Decimal
    refunds_total: Decimal
    net_sales: Decimal
    cash_total: Decimal
    cash_received_total: Decimal
    change_given_total: Decimal
    non_cash_total: Decimal
    avg_check: Decimal
    payment_methods: list[PaymentMethodSummary]

# --- ZR-PRINT-01B: per-entity Z-report detail -------------------------------

ZReportDimension = Literal["cashier", "waiter", "hall"]


class ZReportCoverageNote(BaseSchema):
    """A machine-readable statement of what a dimension structurally CANNOT
    cover, so the client renders an honest note instead of guessing why the
    per-entity sections do not foot to the whole-company Z-report."""
    code: str
    message: str


class ZReportDetailEntity(BaseSchema):
    entity_id: UUID
    # Live join — no historical name snapshot exists for User or Hall, so a
    # renamed entity retroactively renames its past reports.
    entity_name: str
    entity_is_active: bool
    entity_deleted: bool
    figures: ZReportFigures


class ZReportDetailResponse(BaseSchema):
    dimension: ZReportDimension
    date: date
    date_from: date | None = None
    date_to: date | None = None
    # One block per requested id, deduped, in the order the ids were requested.
    entities: list[ZReportDetailEntity]
    # Aggregated over the UNION of the selected ids — NOT a Python sum of the
    # blocks above, because avg_check and payment_methods are non-additive.
    totals: ZReportFigures
    # Figures this dimension cannot establish. A real "unsupported", never a 0
    # that would read as an authoritative zero.
    unsupported_fields: list[str]
    coverage: list[ZReportCoverageNote]


class ZReportDetailOption(BaseSchema):
    value: UUID
    label: str


class ZReportDetailFiltersResponse(BaseSchema):
    """Current selectable entities for the per-entity Print pickers. Picker
    policy (active / non-deleted only) is deliberately NARROWER than the detail
    endpoint's historical policy: an archived hall or a deactivated employee
    leaves this list but stays queryable by known id."""
    cashiers: list[ZReportDetailOption]
    waiters: list[ZReportDetailOption]
    halls: list[ZReportDetailOption]
    # Menu/category Print is deferred (ZR-PRINT-01A): category-level money
    # cannot be expressed in the Z shape, so no menu options are offered.
    menu_filter_supported: bool = False

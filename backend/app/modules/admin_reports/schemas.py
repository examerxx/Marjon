from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel


class OrderReportRow(BaseModel):
    order_id: UUID
    # ORDERS-TRUTH-01 additive identity. order_id (UUID) is unchanged and remains
    # the canonical internal/API key. public_id is the stable per-company numeric
    # business id — REQUIRED / non-null: the ORM column is nullable=False, the
    # canonical DB is NOT NULL (migration backfilled every existing row), and the
    # sole producer (orders_report) maps it straight from that column. There is
    # no path that yields a null public_id, so the API contract matches truth.
    public_id: int
    order_number: str
    created_at: datetime
    status: str
    table_number: str | None
    # ORDERS-TRUTH-01 historical place snapshot (Order.hall_name_snapshot), NOT a
    # live join — a later hall rename/archival never changes it. Null for tableless
    # orders and legacy rows whose table_id no longer resolved at backfill. The
    # frontend composes "<hall_name>, стол <table_number>".
    hall_name: str | None = None
    waiter_name: str | None
    items_count: int
    total_amount: Decimal
    # REPORTS-EXCEL-02 additive truth (no migration: both derive from existing
    # columns). order_type is the stored canonical enum value, never a label.
    # cashier_names lists EVERY unique authenticated cashier attributed to the
    # order's COMPLETED payments (Variant A product rule) — [] when none.
    order_type: str
    cashier_names: list[str] = []
    # REPORTS-EXCEL-02 final Excel truth (additive, no migration: both derive
    # from existing columns). service_fee is the STORED per-order service
    # charge (Order.service_fee, part of total_amount) — numeric passthrough,
    # never recomputed, never a display string; 0 means no service charge.
    # payment_methods lists EVERY unique Payment.method on the order's
    # COMPLETED payments only (raw values, never labels) — [] when none.
    service_fee: Decimal
    payment_methods: list[str] = []
    # OFFLINE-01: заказ оформлен кассой без сети и досинхронизирован позже.
    # created_at при этом — время приёма на сервере, поэтому отчёт отдаёт
    # момент терминала отдельным полем для честной пометки в UI.
    created_offline_at: datetime | None = None
    # Populated only with a product filter: distinct stored per-unit prices of
    # matching order items. Never the current Product.price or an average.
    position_prices: list[Decimal] | None = None
    position_quantity: Decimal | None = None
    position_amount: Decimal | None = None


class TableOrderSummary(BaseModel):
    # Lightweight per-order line for the main table Date/Sum columns and the
    # "Посмотреть заказы" modal. waiter_name is a live join (same caveat as
    # every report); order_type/status are stored per-order values.
    # Full contents come from the canonical per-order endpoints.
    order_id: UUID
    order_number: str
    created_at: datetime
    total_amount: Decimal
    # Подытог заказа (Order.subtotal) — стоимость позиций ДО скидки/НДС/обслуги.
    # Числовой passthrough из БД, не пересчитывается. Нужен для строки «Подытог»
    # в свёрнутой карточке заказа модалки «Посмотреть заказы».
    subtotal: Decimal
    order_type: str
    status: str
    waiter_name: str | None = None


class TableReportRow(BaseModel):
    table_number: str
    orders_count: int
    revenue: Decimal
    avg_check: Decimal
    # Canonical seating identity (Phase 2). Null for legacy orders that predate
    # the Order.table_id relation; present for orders linked to a real Table so
    # the frontend can key rows stably and distinguish same-number tables across
    # different halls.
    table_id: UUID | None = None
    hall_id: UUID | None = None
    hall_name: str | None = None
    # Matching completed orders for the same filtered population, ordered
    # created_at ascending so Date lines align 1:1 with Sum lines.
    orders: list[TableOrderSummary] = []


class WaiterReportRow(BaseModel):
    waiter_id: UUID
    name: str
    orders_count: int
    orders_total: Decimal
    takeaway_delivery_total: Decimal
    service_total: Decimal
    waiter_service_total: Decimal
    dishes_count: Decimal
    dishes: list["WaiterDishRow"]


class WaiterDishRow(BaseModel):
    product_id: UUID
    name: str
    quantity: Decimal
    amount: Decimal


class WaiterReportTotals(BaseModel):
    orders_count: int
    orders_total: Decimal
    takeaway_delivery_total: Decimal
    service_total: Decimal
    waiter_service_total: Decimal
    dishes_count: Decimal


class WaiterReportResponse(BaseModel):
    rows: list[WaiterReportRow]
    totals: WaiterReportTotals


class DishReportRow(BaseModel):
    product_id: UUID
    name: str
    image_url: str | None = None  # Current catalogue photo, same source as paid top sales.
    # Real master unit (Product.unit); null when the master has none —
    # never a hardcoded fallback. Cost/profit are intentionally absent in
    # Phase 1: no truthful historical cost exists (no sale-time snapshot).
    unit: str | None
    # DISHES-CATEGORY-01: the product's PRIMARY category (Product.category_id →
    # Category.name), consistent with the existing category_id filter which
    # matches category_id OR subcategory_id. LIVE dimension (not a sale-time
    # snapshot) — a later recategorization retroactively regroups history, the
    # same accepted tradeoff as `unit`. Null for uncategorized products (never a
    # fabricated "Без категории" row); the frontend chooses any display label.
    category_id: UUID | None = None
    category_name: str | None = None
    quantity: Decimal
    # Weighted price (amount/quantity), NOT AVG(price): preserves
    # amount == quantity * price per row. Decimal(0) when quantity is 0.
    price: Decimal
    amount: Decimal
    # DISHES-EXCEL cost truth (additive). cost_total = Σ(qty × sale-time cost
    # snapshot) for this product's aggregated items; profit = amount − cost_total.
    # Both are NULL when ANY contributing item lacks a snapshot (legacy/unknown):
    # unknown is never coerced to 0 and a partial sum is never shown as complete.
    # cost_coverage_complete tells the client which case this is, without
    # inferring it from display strings.
    cost_total: Decimal | None = None
    profit: Decimal | None = None
    cost_coverage_complete: bool = False


class DishReportTotals(BaseModel):
    quantity: Decimal
    amount: Decimal
    # Distinct orders contributing to these exact filtered report rows.
    orders_count: int = 0
    # Grand cost/profit only when the ENTIRE selection has full snapshot
    # coverage; otherwise NULL (unknown), never a partial number.
    cost_total: Decimal | None = None
    profit: Decimal | None = None
    cost_coverage_complete: bool = False


class DishReportResponse(BaseModel):
    rows: list[DishReportRow]
    totals: DishReportTotals


class ReportFilterOption(BaseModel):
    value: str
    label: str


class OrderReportFiltersResponse(BaseModel):
    waiters: list[ReportFilterOption]
    cashiers: list[ReportFilterOption]
    products: list[ReportFilterOption]
    order_types: list[ReportFilterOption]
    order_statuses: list[ReportFilterOption]
    payment_methods: list[ReportFilterOption]


class TableReportFiltersResponse(BaseModel):
    waiters: list[ReportFilterOption]
    cashiers: list[ReportFilterOption]
    payment_methods: list[ReportFilterOption]
    places: list[ReportFilterOption]
    place_filter_supported: bool = False


class WaiterReportFiltersResponse(BaseModel):
    waiters: list[ReportFilterOption]


class DishReportFiltersResponse(BaseModel):
    authors: list[ReportFilterOption]
    cooks: list[ReportFilterOption]
    products: list[ReportFilterOption]
    categories: list[ReportFilterOption]
    order_types: list[ReportFilterOption]
    order_statuses: list[ReportFilterOption]
    payment_methods: list[ReportFilterOption]
    cook_filter_supported: bool = False


class CancelledItemRow(BaseModel):
    # Legacy fields (preserved for deployed frontend ce7e84a compatibility).
    date: str
    time: str
    order_number: str
    table_number: str | None
    name: str
    quantity: Decimal
    price: Decimal
    waiter_name: str | None
    unit: str
    # Phase 1A additive truthful fields.
    order_id: UUID | None = None
    order_item_id: UUID | None = None
    order_created_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancellation_scope: str | None = None  # "item" | "order"
    order_type: str | None = None
    amount: Decimal | None = None
    cancelled_by_id: UUID | None = None
    cancelled_by_name: str | None = None
    order_status: str | None = None
    item_status: str | None = None
    # Period semantics transparency: which timestamp powers the period filter.
    # "cancelled_at" for new truthful events, "legacy_order_created_at" when
    # cancelled_at is NULL (historical rows, COALESCE fallback to created_at).
    date_source: str | None = None
    report_event_at: datetime | None = None


class CancelledReportTotals(BaseModel):
    # Same quantity metric as the Cancelled Dishes report/Excel total.
    quantity: Decimal
    orders_count: int = 0


class CancelledAuthorOption(BaseModel):
    id: UUID
    name: str
    role: str  # "waiter" | "cashier"


class CancelledFiltersResponse(BaseModel):
    authors: list[CancelledAuthorOption] = []
    # Distinct OrderItem.name snapshot values among cancelled-eligible rows
    # for this company (historical truth, survives Product renames/deletes).
    dishes: list[str] = []


class LoginHistoryRow(BaseModel):
    date: str
    employee: str
    avatar_url: str = ""
    role: str
    phone: str = "—"
    device: str
    login: str
    logout: str
    status: str


class AttendanceRow(BaseModel):
    date: str
    employee: str
    avatar_url: str = ""
    role: str
    start: str
    end: str
    hours: str
    status: str
    # ATT-IP-01: IP устройства, с которого отметили приход/уход. Пустая строка
    # у исторических смен (до появления колонки) — фронтенд показывает «—».
    ip: str = ""


class ProductReportRow(BaseModel):
    product_id: UUID
    product_name: str
    qty: Decimal
    avg_price: Decimal
    total: Decimal
    cost: Decimal
    profit: Decimal


class ProductCountRow(BaseModel):
    product_id: UUID
    product_name: str
    income_qty: Decimal
    expense_qty: Decimal
    balance_qty: Decimal


class DebtCreditRow(BaseModel):
    counterparty_id: UUID
    counterparty_name: str
    opening_balance: Decimal
    debit: Decimal   # приход (income)
    credit: Decimal  # расход (expense)
    closing_balance: Decimal

from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel


class OrderReportRow(BaseModel):
    order_id: UUID
    order_number: str
    created_at: datetime
    status: str
    table_number: str | None
    waiter_name: str | None
    items_count: int
    total_amount: Decimal


class TableOrderSummary(BaseModel):
    # Lightweight per-order line for the main table Date/Sum columns and the
    # "Посмотреть заказы" modal. waiter_name is a live join (same caveat as
    # every report); order_type/status are stored per-order values.
    # Full contents come from the canonical per-order endpoints.
    order_id: UUID
    order_number: str
    created_at: datetime
    total_amount: Decimal
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
    # Real master unit (Product.unit); null when the master has none —
    # never a hardcoded fallback. Cost/profit are intentionally absent in
    # Phase 1: no truthful historical cost exists (no sale-time snapshot).
    unit: str | None
    quantity: Decimal
    # Weighted price (amount/quantity), NOT AVG(price): preserves
    # amount == quantity * price per row. Decimal(0) when quantity is 0.
    price: Decimal
    amount: Decimal


class DishReportTotals(BaseModel):
    quantity: Decimal
    amount: Decimal


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
    date: str
    time: str
    order_number: str
    table_number: str | None
    name: str
    quantity: Decimal
    price: Decimal
    waiter_name: str | None
    unit: str


class LoginHistoryRow(BaseModel):
    date: str
    employee: str
    role: str
    device: str
    login: str
    logout: str
    status: str


class AttendanceRow(BaseModel):
    date: str
    employee: str
    role: str
    start: str
    end: str
    hours: str
    status: str


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

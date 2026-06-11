from __future__ import annotations
from decimal import Decimal
from datetime import date
from uuid import UUID
from app.shared.base_schema import BaseSchema


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


class ZReportResponse(BaseSchema):
    date: date
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

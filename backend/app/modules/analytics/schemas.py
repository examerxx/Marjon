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

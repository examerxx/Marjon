from __future__ import annotations
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from uuid import UUID
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.analytics.schemas import DashboardResponse, SalesReport, TopProduct
from app.modules.pos.models import Order, OrderItem
from app.modules.payments.models import Payment


class AnalyticsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _date_bounds(selected_date: date) -> tuple[datetime, datetime]:
        return (
            datetime.combine(selected_date, datetime.min.time()),
            datetime.combine(selected_date, datetime.max.time()),
        )

    async def dashboard(self, company_id: UUID, selected_date: date | None = None) -> DashboardResponse:
        if selected_date:
            day_start, day_end = self._date_bounds(selected_date)
        else:
            day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = datetime.now(timezone.utc)

        result = await self.db.execute(
            select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
            .where(
                Order.company_id == company_id,
                Order.status == "completed",
                Order.created_at >= day_start,
                Order.created_at <= day_end,
            )
        )
        count, revenue = result.one()

        active = await self.db.execute(
            select(func.count(Order.id))
            .where(
                Order.company_id == company_id,
                Order.status.in_(["new", "accepted", "cooking"]),
                Order.created_at >= day_start,
                Order.created_at <= day_end,
            )
        )
        active_count = active.scalar_one()

        avg_check = Decimal(str(revenue)) / count if count > 0 else Decimal("0")
        return DashboardResponse(
            today_revenue=Decimal(str(revenue)),
            today_orders=count,
            avg_check=avg_check,
            active_orders=active_count,
        )

    async def sales_report(self, company_id: UUID, date_from: date, date_to: date) -> list[SalesReport]:
        result = await self.db.execute(
            select(
                func.date(Order.created_at).label("day"),
                func.count(Order.id).label("cnt"),
                func.coalesce(func.sum(Order.total_amount), 0).label("rev"),
            )
            .where(
                Order.company_id == company_id,
                Order.status == "completed",
                Order.created_at >= datetime.combine(date_from, datetime.min.time()),
                Order.created_at <= datetime.combine(date_to, datetime.max.time()),
            )
            .group_by(func.date(Order.created_at))
            .order_by(func.date(Order.created_at))
        )
        rows = result.all()
        return [
            SalesReport(
                date=row.day,
                orders_count=row.cnt,
                revenue=Decimal(str(row.rev)),
                avg_check=Decimal(str(row.rev)) / row.cnt if row.cnt > 0 else Decimal("0"),
            )
            for row in rows
        ]

    async def top_products(
        self,
        company_id: UUID,
        limit: int = 20,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> list[TopProduct]:
        query = (
            select(
                OrderItem.product_id,
                OrderItem.name,
                func.sum(OrderItem.quantity).label("qty"),
                func.sum(OrderItem.total).label("rev"),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .where(Order.company_id == company_id, Order.status == "completed")
            .group_by(OrderItem.product_id, OrderItem.name)
            .order_by(func.sum(OrderItem.total).desc())
            .limit(limit)
        )
        if date_from:
            query = query.where(Order.created_at >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            query = query.where(Order.created_at <= datetime.combine(date_to, datetime.max.time()))

        result = await self.db.execute(
            query
        )
        return [
            TopProduct(
                product_id=row.product_id,
                name=row.name,
                quantity_sold=Decimal(str(row.qty)),
                revenue=Decimal(str(row.rev)),
            )
            for row in result.all()
        ]

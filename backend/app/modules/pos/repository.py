from __future__ import annotations
from datetime import date, datetime
from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.shared.base_repository import TenantRepository
from app.modules.pos.models import Order, OrderItem, PosTerminal


def apply_order_date_filter(query, selected_date: date | None):
    if not selected_date:
        return query

    return query.where(
        Order.created_at >= datetime.combine(selected_date, datetime.min.time()),
        Order.created_at <= datetime.combine(selected_date, datetime.max.time()),
    )


class OrderRepository(TenantRepository[Order]):
    def __init__(self, db: AsyncSession):
        super().__init__(Order, db)

    async def get_by_id(self, id: UUID, company_id: UUID) -> Order | None:  # type: ignore[override]
        result = await self.db.execute(
            self._base_query(company_id).options(selectinload(Order.items)).where(Order.id == id)
        )
        return result.scalar_one_or_none()

    async def get_by_status(
        self,
        company_id: UUID,
        status: str,
        branch_id: UUID | None = None,
        selected_date: date | None = None,
    ) -> list[Order]:
        query = self._base_query(company_id).options(selectinload(Order.items)).where(Order.status == status)
        if branch_id:
            query = query.where(Order.branch_id == branch_id)
        query = apply_order_date_filter(query, selected_date)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_all(self, company_id: UUID, params=None, selected_date: date | None = None) -> list[Order]:  # type: ignore[override]
        query = self._base_query(company_id).options(selectinload(Order.items)).order_by(Order.created_at.desc())
        query = apply_order_date_filter(query, selected_date)
        if params:
            query = query.offset(params.offset).limit(params.size)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_next_number(self, company_id: UUID, branch_id: UUID) -> str:
        result = await self.db.execute(
            select(func.count(Order.id)).where(
                Order.company_id == company_id,
                Order.branch_id == branch_id,
            )
        )
        count = result.scalar_one()
        return str(count + 1).zfill(4)


class OrderItemRepository(TenantRepository[OrderItem]):
    def __init__(self, db: AsyncSession):
        super().__init__(OrderItem, db)


class TerminalRepository(TenantRepository[PosTerminal]):
    def __init__(self, db: AsyncSession):
        super().__init__(PosTerminal, db)

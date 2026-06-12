from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.modules.kitchen.models import KitchenStation
from app.modules.kitchen.repository import KitchenStationRepository
from app.modules.kitchen.schemas import KitchenItemStatusUpdate, StationCreate
from app.modules.pos.models import Order, OrderItem
from app.shared.exceptions import NotFoundError, ValidationError

# Valid item status transitions
ITEM_TRANSITIONS: dict[str, set[str]] = {
    "pending":   {"cooking"},
    "cooking":   {"ready", "cancelled"},
    "ready":     {"served"},
    "served":    set(),
    "cancelled": set(),
}


class KitchenService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.station_repo = KitchenStationRepository(db)

    async def create_station(self, company_id: UUID, data: StationCreate) -> KitchenStation:
        return await self.station_repo.save(
            KitchenStation(company_id=company_id, **data.model_dump())
        )

    async def list_stations(self, company_id: UUID) -> list[KitchenStation]:
        return await self.station_repo.get_all(company_id)

    async def get_active_orders(self, company_id: UUID, branch_id: UUID) -> list[Order]:
        result = await self.db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(
                Order.company_id == company_id,
                Order.branch_id == branch_id,
                Order.status.in_(["new", "accepted", "cooking"]),
            )
            .order_by(Order.created_at.asc())
        )
        return list(result.scalars().all())

    async def update_item_status(self, company_id: UUID, data: KitchenItemStatusUpdate) -> OrderItem:
        # Join through Order to validate company_id
        result = await self.db.execute(
            select(OrderItem)
            .join(Order, Order.id == OrderItem.order_id)
            .where(
                OrderItem.id == data.order_item_id,
                Order.company_id == company_id,
            )
        )
        item = result.scalar_one_or_none()
        if not item:
            raise NotFoundError("Order item not found")

        current = item.status
        target = data.status
        if target not in ITEM_TRANSITIONS.get(current, set()):
            raise ValidationError(
                f"Невозможно перевести позицию из '{current}' в '{target}'. "
                f"Допустимые: {ITEM_TRANSITIONS.get(current, set()) or 'нет'}"
            )

        item.status = target
        self.db.add(item)
        await self.db.commit()
        await self.db.refresh(item)
        return item

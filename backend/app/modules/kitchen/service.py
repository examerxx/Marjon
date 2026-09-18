from __future__ import annotations
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.modules.companies.models import Branch
from app.modules.inventory.models import Category
from app.modules.kitchen.models import KitchenStation
from app.modules.kitchen.repository import KitchenStationRepository
from app.modules.kitchen.schemas import KitchenItemStatusUpdate, StationCreate
from app.modules.kitchen.websocket import kitchen_manager
from app.modules.pos.models import Order, OrderItem
from app.shared.exceptions import NotFoundError, ValidationError
from app.shared.tenant_scope import require_company_resource, require_company_resource_ids

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
        await require_company_resource(
            self.db, Branch, data.branch_id, company_id, detail="Branch not found"
        )
        await require_company_resource_ids(
            self.db, Category, data.category_ids, company_id, detail="Category not found"
        )
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

    async def update_item_status(
        self, company_id: UUID, data: KitchenItemStatusUpdate,
        actor_id: UUID | None = None,
    ) -> OrderItem:
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
        if target == "cancelled":
            # Phase 1A: truthful item cancellation via kitchen. Idempotent —
            # never overwrites an existing event.
            if item.cancelled_at is None:
                item.cancelled_at = datetime.now(timezone.utc)
            if item.cancelled_by_id is None and actor_id is not None:
                item.cancelled_by_id = actor_id
        self.db.add(item)
        await self.db.commit()
        await self.db.refresh(item)
        try:
            # Reload branch_id from the parent order for scoped broadcast
            order_result = await self.db.execute(
                select(Order.branch_id).where(Order.id == item.order_id)
            )
            branch_id = order_result.scalar_one()
            await kitchen_manager.broadcast(
                company_id, branch_id, "item_status_changed",
                {"order_item_id": str(item.id), "order_id": str(item.order_id), "status": target},
            )
        except Exception:
            pass
        return item

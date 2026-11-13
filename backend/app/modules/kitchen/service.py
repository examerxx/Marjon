from __future__ import annotations
from datetime import datetime, timedelta, timezone
from uuid import UUID
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.modules.audit.service import AuditService
from app.modules.companies.models import Branch, Company
from app.modules.inventory.models import Category
from app.modules.kitchen.models import KitchenStation
from app.modules.kitchen.repository import KitchenStationRepository
from app.modules.kitchen.schemas import KitchenItemStatusUpdate, StationCreate
from app.modules.kitchen.websocket import kitchen_manager
from app.modules.pos.models import Order, OrderItem
from app.modules.pos.schemas import OrderItemResponse
from app.modules.pos.service import OrderService
from app.shared.exceptions import NotFoundError, ValidationError
from app.shared.tenant_scope import require_company_resource, require_company_resource_ids

# Direct readiness and undo must not depend on first accepting the dish.
ITEM_TRANSITIONS: dict[str, set[str]] = {
    "pending":   {"cooking", "ready"},
    "cooking":   {"ready", "cancelled"},
    "ready":     {"cooking", "served"},
    "served":    set(),
    "cancelled": set(),
}

# Ready dishes remain visible until handoff, with a cutoff for old tickets.
READY_VISIBLE_HOURS = 8


def _active_orders():
    return or_(
        Order.status.in_(("new", "accepted", "cooking", "ready")),
        and_(
            Order.status == "completed",
            Order.items.any(OrderItem.status.in_(("pending", "cooking", "ready"))),
        ),
    )


def _board_orders():
    # После подтверждения раздачи заказ уходит с доски повара на экран
    # посетителей, даже если финансы ещё не закрыты.
    return and_(Order.expo_confirmed_at.is_(None), _active_orders())


def _all_items_ready():
    return and_(
        Order.items.any(OrderItem.status != "cancelled"),
        ~Order.items.any(OrderItem.status.notin_(("ready", "served", "cancelled"))),
    )


def _display_ready():
    # «Готов» на ТВ: все блюда отпущены и либо раздача подтвердила выдачу,
    # либо готовых блюд не осталось вовсе (официант уже унёс всё — served).
    return and_(
        _all_items_ready(),
        or_(
            Order.expo_confirmed_at.is_not(None),
            ~Order.items.any(OrderItem.status == "ready"),
        ),
    )


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
        """Заказы на кухонной доске: в работе + недавно готовые.

        После подтверждения раздачи заказ уходит с доски: его уже выдали, и
        повару незачем держать его перед глазами. До подтверждения готовый
        заказ остаётся на доске — его можно вернуть в работу или дополнить.
        """
        # SQLite хранит naive-UTC (func.now()), Postgres — timestamptz.
        # Сравнение с naive-UTC cutoff корректно в обеих базах.
        ready_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
            hours=READY_VISIBLE_HOURS
        )
        result = await self.db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(
                Order.company_id == company_id,
                Order.branch_id == branch_id,
                _board_orders(),
                or_(~_all_items_ready(), Order.updated_at >= ready_cutoff),
            )
            .order_by(Order.created_at.asc())
        )
        return list(result.scalars().all())

    async def get_display_orders(self, branch_id: UUID) -> dict:
        """Публичная выдача для ТВ-экрана посетителей.

        Наружу отдаём только номер заказа и «готов / в очереди» — ни состава,
        ни сумм, ни столов. Только заказы текущего операционного дня филиала,
        чтобы вчерашние номера не висели на телевизоре. «Готов» ставит только
        раздача: пока она не подтвердила, даже собранный заказ остаётся в
        очереди.
        """
        branch = await self.db.get(Branch, branch_id)
        if not branch or not branch.is_active:
            raise NotFoundError("Branch not found")
        company = await self.db.get(Company, branch.company_id)
        company_name = company.name if company else ""
        if not branch.guest_display_enabled:
            return {
                "company_name": company_name,
                "branch_name": branch.name,
                "enabled": False,
                "orders": [],
            }
        local_today = await OrderService(self.db)._company_local_today(branch.company_id)
        result = await self.db.execute(
            select(Order.order_number, _display_ready().label("ready"), Order.created_at)
            .where(
                Order.company_id == branch.company_id,
                Order.branch_id == branch.id,
                Order.order_local_date == local_today,
                _active_orders(),
            )
            .order_by(Order.created_at.asc())
        )
        orders = [
            {
                "number": str(number),
                "status": "ready" if ready else "queued",
                "created_at": created_at,
            }
            for number, ready, created_at in result.all()
        ]
        # Готовые — первыми: посетитель ищет свой номер в верхней строке.
        orders.sort(key=lambda o: (o["status"] != "ready", o["created_at"]))
        return {
            "company_name": company_name,
            "branch_name": branch.name,
            "enabled": True,
            "orders": orders,
        }

    async def _display_branch(self, company_id: UUID, branch_id: UUID) -> Branch:
        branch = await self.db.get(Branch, branch_id)
        if not branch or branch.company_id != company_id:
            raise NotFoundError("Branch not found")
        return branch

    async def get_display_settings(self, company_id: UUID, branch_id: UUID) -> dict:
        branch = await self._display_branch(company_id, branch_id)
        return {
            "branch_id": branch.id,
            "branch_name": branch.name,
            "enabled": bool(branch.guest_display_enabled),
        }

    async def set_display_enabled(
        self, company_id: UUID, branch_id: UUID, enabled: bool
    ) -> dict:
        branch = await self._display_branch(company_id, branch_id)
        branch.guest_display_enabled = enabled
        await self.db.commit()
        await self.db.refresh(branch)
        return {
            "branch_id": branch.id,
            "branch_name": branch.name,
            "enabled": bool(branch.guest_display_enabled),
        }

    async def get_expo_orders(self, company_id: UUID, branch_id: UUID) -> list[Order]:
        """Очередь раздачи: блюда готовы, но заказ ещё не выдан гостю."""
        result = await self.db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(
                Order.company_id == company_id,
                Order.branch_id == branch_id,
                Order.status != "cancelled",
                Order.expo_confirmed_at.is_(None),
                _all_items_ready(),
                Order.items.any(OrderItem.status == "ready"),
            )
            .order_by(Order.updated_at.asc())
        )
        return list(result.scalars().all())

    async def confirm_expo(
        self, company_id: UUID, order_id: UUID,
        actor_id: UUID | None = None, branch_id: UUID | None = None,
    ) -> Order:
        """Раздача подтверждает выдачу: заказ становится «готов» на ТВ.

        Идемпотентно: повторное подтверждение не меняет время первого. Заказ
        без готовых блюд подтвердить нельзя — иначе на экран уйдёт пустышка.
        """
        query = select(Order).where(
            Order.company_id == company_id, Order.id == order_id,
        )
        if branch_id is not None:
            query = query.where(Order.branch_id == branch_id)
        order = (await self.db.execute(
            query.with_for_update().options(selectinload(Order.items))
            .execution_options(populate_existing=True)
        )).scalar_one_or_none()
        if order is None:
            raise NotFoundError("Order not found")
        if order.status == "cancelled":
            raise ValidationError("Cannot confirm a cancelled order")
        if order.expo_confirmed_at is not None:
            return order

        statuses = [item.status for item in order.items if item.status != "cancelled"]
        if not statuses or any(s not in ("ready", "served") for s in statuses):
            raise ValidationError("Not all dishes are ready yet")
        if all(s == "served" for s in statuses):
            raise ValidationError("Order has no ready dishes")

        order.expo_confirmed_at = datetime.now(timezone.utc)
        order.expo_confirmed_by_id = actor_id
        previous_status = order.status
        if order.status in ("new", "accepted", "cooking"):
            order.status = "ready"
        order.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(order)

        try:
            await kitchen_manager.broadcast(
                company_id, order.branch_id, "order_updated",
                {"order_id": str(order.id), "status": order.status},
            )
        except Exception:
            pass
        if order.status != previous_status:
            try:
                await AuditService(self.db).log(
                    company_id, actor_id, "order.status_change", "order",
                    entity_id=order.id,
                    old_data={"status": previous_status},
                    new_data={"status": order.status, "source": "expo"},
                )
            except Exception:
                await self.db.rollback()
        return order

    async def update_item_status(
        self, company_id: UUID, data: KitchenItemStatusUpdate,
        actor_id: UUID | None = None, branch_id: UUID | None = None,
    ) -> dict:
        # Lock the scoped parent before loading fresh item states for multiple cooks.
        query = select(Order).where(
            Order.company_id == company_id,
            Order.items.any(OrderItem.id == data.order_item_id),
        )
        if branch_id is not None:
            query = query.where(Order.branch_id == branch_id)
        order = (await self.db.execute(
            query.with_for_update().options(selectinload(Order.items))
            .execution_options(populate_existing=True)
        )).scalar_one_or_none()
        if order is None:
            raise NotFoundError("Order item not found")
        if order.status == "cancelled":
            raise ValidationError("Cannot update a cancelled order")
        item = next((item for item in order.items if item.id == data.order_item_id), None)
        if item is None:
            raise NotFoundError("Order item not found")

        current = item.status
        target = data.status
        if order.status == "completed" and target == "cancelled":
            raise ValidationError("Cannot cancel an item of a completed order")
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
        await self.db.flush()

        previous_order_status = order.status
        order_status = await OrderService(self.db).sync_readiness(order)

        await self.db.commit()
        await self.db.refresh(item)
        await self.db.refresh(order)

        try:
            await kitchen_manager.broadcast(
                company_id, order.branch_id, "item_status_changed",
                {"order_item_id": str(item.id), "order_id": str(item.order_id), "status": target},
            )
            await kitchen_manager.broadcast(
                company_id, order.branch_id, "order_updated",
                {"order_id": str(order.id), "status": order.status},
            )
        except Exception:
            pass

        if order_status:
            try:
                await AuditService(self.db).log(
                    company_id, actor_id, "order.status_change", "order",
                    entity_id=order.id,
                    old_data={"status": previous_order_status},
                    new_data={"status": order_status, "source": "kitchen"},
                )
            except Exception:
                await self.db.rollback()

        payload = OrderItemResponse.model_validate(item).model_dump()
        payload["order_status"] = order.status
        return payload

    async def mark_order_ready(
        self, company_id: UUID, order_id: UUID,
        actor_id: UUID | None = None, branch_id: UUID | None = None,
    ) -> Order:
        orders = OrderService(self.db, branch_scope=branch_id)
        order = await orders.get(company_id, order_id, for_update=True)
        if order.status == "cancelled":
            raise ValidationError("Cannot update a cancelled order")

        previous_status = order.status
        for item in order.items:
            if item.status in ("pending", "cooking"):
                item.status = "ready"
        next_status = await orders.sync_readiness(order)
        await self.db.commit()

        try:
            await kitchen_manager.broadcast(
                company_id, order.branch_id, "order_updated",
                {"order_id": str(order.id), "status": order.status},
            )
        except Exception:
            pass
        if next_status:
            try:
                await AuditService(self.db).log(
                    company_id, actor_id, "order.status_change", "order",
                    entity_id=order_id,
                    old_data={"status": previous_status},
                    new_data={"status": next_status, "source": "kitchen"},
                )
            except Exception:
                await self.db.rollback()
        return await orders.get(company_id, order_id)

from __future__ import annotations
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.delivery.models import Courier, DeliveryOrder, DeliveryZone
from app.modules.delivery.repository import CourierRepository, DeliveryOrderRepository, DeliveryZoneRepository
from app.modules.delivery.schemas import (
    CourierAssign, CourierCreate, DeliveryOrderCreate,
    DeliveryStatusUpdate, LocationUpdate, ZoneCreate,
)
from app.shared.exceptions import NotFoundError


class DeliveryService:
    def __init__(self, db: AsyncSession):
        self.zone_repo = DeliveryZoneRepository(db)
        self.courier_repo = CourierRepository(db)
        self.order_repo = DeliveryOrderRepository(db)

    async def create_zone(self, company_id: UUID, data: ZoneCreate) -> DeliveryZone:
        return await self.zone_repo.save(DeliveryZone(company_id=company_id, **data.model_dump()))

    async def list_zones(self, company_id: UUID) -> list[DeliveryZone]:
        return await self.zone_repo.get_all(company_id)

    async def create_courier(self, company_id: UUID, user_id: UUID, data: CourierCreate) -> Courier:
        return await self.courier_repo.save(Courier(company_id=company_id, user_id=user_id, **data.model_dump()))

    async def list_couriers(self, company_id: UUID) -> list[Courier]:
        return await self.courier_repo.get_all(company_id)

    async def create_delivery_order(self, company_id: UUID, data: DeliveryOrderCreate) -> DeliveryOrder:
        return await self.order_repo.save(DeliveryOrder(company_id=company_id, **data.model_dump()))

    async def assign_courier(self, company_id: UUID, delivery_id: UUID, data: CourierAssign) -> DeliveryOrder:
        delivery = await self.order_repo.get_by_id(delivery_id, company_id)
        if not delivery:
            raise NotFoundError("Delivery order not found")
        delivery.courier_id = data.courier_id
        delivery.status = "assigned"
        delivery.assigned_at = datetime.now(timezone.utc)
        return await self.order_repo.save(delivery)

    async def update_status(self, company_id: UUID, delivery_id: UUID, data: DeliveryStatusUpdate) -> DeliveryOrder:
        delivery = await self.order_repo.get_by_id(delivery_id, company_id)
        if not delivery:
            raise NotFoundError("Delivery order not found")
        delivery.status = data.status
        return await self.order_repo.save(delivery)

    async def update_courier_location(self, company_id: UUID, courier_id: UUID, data: LocationUpdate) -> Courier:
        courier = await self.courier_repo.get_by_id(courier_id, company_id)
        if not courier:
            raise NotFoundError("Courier not found")
        courier.current_lat = data.lat
        courier.current_lng = data.lng
        courier.last_location_at = datetime.now(timezone.utc)
        return await self.courier_repo.save(courier)

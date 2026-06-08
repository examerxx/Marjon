from __future__ import annotations
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository
from app.modules.delivery.models import Courier, DeliveryOrder, DeliveryZone


class DeliveryZoneRepository(TenantRepository[DeliveryZone]):
    def __init__(self, db: AsyncSession):
        super().__init__(DeliveryZone, db)


class CourierRepository(TenantRepository[Courier]):
    def __init__(self, db: AsyncSession):
        super().__init__(Courier, db)

    async def get_available(self, company_id: UUID) -> list[Courier]:
        result = await self.db.execute(
            self._base_query(company_id).where(Courier.is_active == True, Courier.is_available == True)
        )
        return list(result.scalars().all())


class DeliveryOrderRepository(TenantRepository[DeliveryOrder]):
    def __init__(self, db: AsyncSession):
        super().__init__(DeliveryOrder, db)

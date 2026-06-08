from __future__ import annotations
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository
from app.modules.kitchen.models import KitchenStation


class KitchenStationRepository(TenantRepository[KitchenStation]):
    def __init__(self, db: AsyncSession):
        super().__init__(KitchenStation, db)

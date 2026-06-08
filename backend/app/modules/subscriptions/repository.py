from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository, BaseRepository
from app.modules.subscriptions.models import Invoice, Plan, Subscription


class PlanRepository(BaseRepository[Plan]):
    def __init__(self, db: AsyncSession):
        super().__init__(Plan, db)

    async def get_active(self) -> list[Plan]:
        result = await self.db.execute(select(Plan).where(Plan.is_active == True))
        return list(result.scalars().all())


class SubscriptionRepository(TenantRepository[Subscription]):
    def __init__(self, db: AsyncSession):
        super().__init__(Subscription, db)

    async def get_active(self, company_id: UUID):
        result = await self.db.execute(
            self._base_query(company_id).where(
                Subscription.status.in_(["trial", "active"])
            )
        )
        return result.scalar_one_or_none()


class InvoiceRepository(TenantRepository[Invoice]):
    def __init__(self, db: AsyncSession):
        super().__init__(Invoice, db)

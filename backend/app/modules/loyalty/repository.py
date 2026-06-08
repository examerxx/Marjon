from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository
from app.modules.loyalty.models import LoyaltyAccount, LoyaltyTransaction


class LoyaltyAccountRepository(TenantRepository[LoyaltyAccount]):
    def __init__(self, db: AsyncSession):
        super().__init__(LoyaltyAccount, db)

    async def get_by_customer(self, company_id: UUID, customer_id: UUID):
        result = await self.db.execute(
            self._base_query(company_id).where(LoyaltyAccount.customer_id == customer_id)
        )
        return result.scalar_one_or_none()


class LoyaltyTransactionRepository(TenantRepository[LoyaltyTransaction]):
    def __init__(self, db: AsyncSession):
        super().__init__(LoyaltyTransaction, db)

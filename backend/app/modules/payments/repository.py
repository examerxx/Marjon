from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository
from app.modules.payments.models import Payment


class PaymentRepository(TenantRepository[Payment]):
    def __init__(self, db: AsyncSession):
        super().__init__(Payment, db)

    async def get_by_order(self, company_id: UUID, order_id: UUID) -> list[Payment]:
        result = await self.db.execute(
            self._base_query(company_id).where(Payment.order_id == order_id)
        )
        return list(result.scalars().all())

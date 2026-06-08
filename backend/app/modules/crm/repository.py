from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository
from app.modules.crm.models import Customer, CustomerNote


class CustomerRepository(TenantRepository[Customer]):
    def __init__(self, db: AsyncSession):
        super().__init__(Customer, db)

    async def get_by_phone(self, company_id: UUID, phone: str):
        result = await self.db.execute(
            self._base_query(company_id).where(Customer.phone == phone)
        )
        return result.scalar_one_or_none()

    async def search(self, company_id: UUID, q: str) -> list[Customer]:
        from sqlalchemy import or_
        result = await self.db.execute(
            self._base_query(company_id).where(
                or_(Customer.phone.contains(q), Customer.name.ilike(f"%{q}%"))
            )
        )
        return list(result.scalars().all())


class CustomerNoteRepository(TenantRepository[CustomerNote]):
    def __init__(self, db: AsyncSession):
        super().__init__(CustomerNote, db)

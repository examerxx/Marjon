from __future__ import annotations
from uuid import UUID
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository, BaseRepository
from app.modules.companies.models import Company, Branch


class CompanyRepository(BaseRepository[Company]):
    def __init__(self, db: AsyncSession):
        super().__init__(Company, db)

    async def get_by_slug(self, slug: str) -> Optional[Company]:
        result = await self.db.execute(
            select(Company).where(Company.slug == slug)
        )
        return result.scalar_one_or_none()


class BranchRepository(TenantRepository[Branch]):
    def __init__(self, db: AsyncSession):
        super().__init__(Branch, db)

    async def get_active(self, company_id: UUID) -> list[Branch]:
        result = await self.db.execute(
            self._base_query(company_id).where(Branch.is_active == True)
        )
        return list(result.scalars().all())

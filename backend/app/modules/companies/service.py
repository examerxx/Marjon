from __future__ import annotations
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.companies.models import Company, Branch
from app.modules.companies.repository import CompanyRepository, BranchRepository
from app.modules.companies.schemas import CompanyCreate, CompanyUpdate, BranchCreate, BranchUpdate
from app.shared.exceptions import NotFoundError, ConflictError


class CompanyService:
    def __init__(self, db: AsyncSession):
        self.repo = CompanyRepository(db)

    async def create(self, data: CompanyCreate) -> Company:
        if await self.repo.get_by_slug(data.slug):
            raise ConflictError(f"Slug '{data.slug}' is already taken")
        return await self.repo.save(Company(**data.model_dump()))

    async def get(self, company_id: UUID) -> Company:
        company = await self.repo.get_by_id(company_id)
        if not company:
            raise NotFoundError("Company not found")
        return company

    async def update(self, company_id: UUID, data: CompanyUpdate) -> Company:
        company = await self.get(company_id)
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(company, field, value)
        return await self.repo.save(company)


class BranchService:
    def __init__(self, db: AsyncSession):
        self.repo = BranchRepository(db)

    async def create(self, company_id: UUID, data: BranchCreate) -> Branch:
        return await self.repo.save(Branch(company_id=company_id, **data.model_dump()))

    async def list(self, company_id: UUID) -> list[Branch]:
        return await self.repo.get_active(company_id)

    async def get(self, branch_id: UUID, company_id: UUID) -> Branch:
        branch = await self.repo.get_by_id(branch_id, company_id)
        if not branch:
            raise NotFoundError("Branch not found")
        return branch

    async def update(self, branch_id: UUID, company_id: UUID, data: BranchUpdate) -> Branch:
        branch = await self.get(branch_id, company_id)
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(branch, field, value)
        return await self.repo.save(branch)

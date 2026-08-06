from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.companies.models import Branch
from app.modules.halls.models import Hall, Table
from app.modules.halls.schemas import HallCreate, HallUpdate, TableCreate, TableUpdate
from app.shared.exceptions import NotFoundError


class HallService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list(self, company_id: UUID, branch_id: UUID | None = None) -> list[Hall]:
        q = select(Hall).options(selectinload(Hall.tables)).where(Hall.company_id == company_id)
        if branch_id:
            q = q.where(Hall.branch_id == branch_id)
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def get(self, company_id: UUID, hall_id: UUID) -> Hall:
        result = await self.db.execute(
            select(Hall).options(selectinload(Hall.tables))
            .where(Hall.id == hall_id, Hall.company_id == company_id)
        )
        hall = result.scalar_one_or_none()
        if not hall:
            raise NotFoundError("Hall not found")
        return hall

    async def _resolve_default_branch(self, company_id: UUID) -> UUID:
        """BE-14: same reasoning as PrinterService — the live places form
        never sends branch_id, so it's optional and resolved here instead
        of 422ing on every place the frontend creates."""
        result = await self.db.execute(
            select(Branch).where(Branch.company_id == company_id)
            .order_by(Branch.created_at.asc()).limit(1)
        )
        branch = result.scalars().first()
        if not branch:
            raise NotFoundError("Company has no branch to attach this place to — create one first")
        return branch.id

    async def create(self, company_id: UUID, data: HallCreate) -> Hall:
        branch_id = data.branch_id or await self._resolve_default_branch(company_id)
        hall = Hall(
            company_id=company_id, branch_id=branch_id,
            name=data.name, description=data.description,
            condition=data.condition, percent=data.percent,
            pricing_type=data.pricing_type, payment_type_id=data.payment_type_id,
        )
        self.db.add(hall)
        await self.db.commit()
        await self.db.refresh(hall)
        result = await self.db.execute(
            select(Hall).options(selectinload(Hall.tables)).where(Hall.id == hall.id)
        )
        return result.scalar_one()

    async def update(self, company_id: UUID, hall_id: UUID, data: HallUpdate) -> Hall:
        hall = await self.get(company_id, hall_id)
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(hall, field, value)
        await self.db.commit()
        await self.db.refresh(hall)
        return await self.get(company_id, hall_id)

    async def delete(self, company_id: UUID, hall_id: UUID) -> None:
        hall = await self.get(company_id, hall_id)
        await self.db.delete(hall)
        await self.db.commit()

    async def list_tables(self, company_id: UUID, hall_id: UUID) -> list[Table]:
        hall = await self.get(company_id, hall_id)
        result = await self.db.execute(
            select(Table).where(Table.hall_id == hall.id).order_by(Table.number)
        )
        return list(result.scalars().all())

    async def create_table(self, company_id: UUID, hall_id: UUID, data: TableCreate) -> Table:
        await self.get(company_id, hall_id)
        table = Table(hall_id=hall_id, number=data.number, capacity=data.capacity)
        self.db.add(table)
        await self.db.commit()
        await self.db.refresh(table)
        return table

    async def update_table(self, company_id: UUID, hall_id: UUID, table_id: UUID, data: TableUpdate) -> Table:
        await self.get(company_id, hall_id)
        result = await self.db.execute(
            select(Table).where(Table.id == table_id, Table.hall_id == hall_id)
        )
        table = result.scalar_one_or_none()
        if not table:
            raise NotFoundError("Table not found")
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(table, field, value)
        await self.db.commit()
        await self.db.refresh(table)
        return table

    async def delete_table(self, company_id: UUID, hall_id: UUID, table_id: UUID) -> None:
        await self.get(company_id, hall_id)
        result = await self.db.execute(
            select(Table).where(Table.id == table_id, Table.hall_id == hall_id)
        )
        table = result.scalar_one_or_none()
        if not table:
            raise NotFoundError("Table not found")
        await self.db.delete(table)
        await self.db.commit()

    async def branch_tables(self, company_id: UUID, branch_id: UUID) -> list[Table]:
        """Get all active tables across all halls in a branch."""
        result = await self.db.execute(
            select(Table)
            .join(Hall, Hall.id == Table.hall_id)
            .where(Hall.company_id == company_id, Hall.branch_id == branch_id,
                   Hall.is_active == True, Table.is_active == True)
            .order_by(Table.number)
        )
        return list(result.scalars().all())

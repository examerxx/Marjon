from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository
from app.modules.printers.models import Printer, PrintJob


class PrinterRepository(TenantRepository[Printer]):
    def __init__(self, db: AsyncSession):
        super().__init__(Printer, db)

    async def get_by_type(self, company_id: UUID, branch_id: UUID, printer_type: str) -> list[Printer]:
        result = await self.db.execute(
            self._base_query(company_id).where(
                Printer.branch_id == branch_id,
                Printer.printer_type == printer_type,
                Printer.is_active == True,
            )
        )
        return list(result.scalars().all())


class PrintJobRepository(TenantRepository[PrintJob]):
    def __init__(self, db: AsyncSession):
        super().__init__(PrintJob, db)

    async def get_pending(self, company_id: UUID, printer_id: UUID) -> list[PrintJob]:
        result = await self.db.execute(
            self._base_query(company_id).where(
                PrintJob.printer_id == printer_id,
                PrintJob.status == "pending",
            ).order_by(PrintJob.created_at)
        )
        return list(result.scalars().all())

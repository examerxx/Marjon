from __future__ import annotations
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.fiscal.models import FiscalReceipt
from app.modules.fiscal.repository import FiscalReceiptRepository
from app.modules.fiscal.schemas import FiscalReceiptCreate
from app.shared.exceptions import NotFoundError


class FiscalService:
    def __init__(self, db: AsyncSession):
        self.repo = FiscalReceiptRepository(db)

    async def create(self, company_id: UUID, data: FiscalReceiptCreate) -> FiscalReceipt:
        receipt = FiscalReceipt(company_id=company_id, **data.model_dump())
        saved = await self.repo.save(receipt)
        # In production: call OFD provider API here
        saved.status = "sent"
        saved.fiscal_code = f"DEMO-{saved.id}"
        return await self.repo.save(saved)

    async def get(self, company_id: UUID, receipt_id: UUID) -> FiscalReceipt:
        r = await self.repo.get_by_id(receipt_id, company_id)
        if not r:
            raise NotFoundError("Fiscal receipt not found")
        return r

    async def list(self, company_id: UUID) -> list[FiscalReceipt]:
        return await self.repo.get_all(company_id)

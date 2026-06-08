from __future__ import annotations
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository
from app.modules.fiscal.models import FiscalReceipt


class FiscalReceiptRepository(TenantRepository[FiscalReceipt]):
    def __init__(self, db: AsyncSession):
        super().__init__(FiscalReceipt, db)

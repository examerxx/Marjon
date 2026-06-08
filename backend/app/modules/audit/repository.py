from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository
from app.modules.audit.models import AuditLog


class AuditLogRepository(TenantRepository[AuditLog]):
    def __init__(self, db: AsyncSession):
        super().__init__(AuditLog, db)

    async def get_by_entity(self, company_id: UUID, entity_type: str, entity_id: UUID) -> list[AuditLog]:
        result = await self.db.execute(
            self._base_query(company_id).where(
                AuditLog.entity_type == entity_type,
                AuditLog.entity_id == entity_id,
            ).order_by(AuditLog.created_at.desc())
        )
        return list(result.scalars().all())

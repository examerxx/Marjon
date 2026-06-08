from __future__ import annotations
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.audit.models import AuditLog
from app.modules.audit.repository import AuditLogRepository


class AuditService:
    def __init__(self, db: AsyncSession):
        self.repo = AuditLogRepository(db)

    async def log(
        self, company_id: UUID, user_id: UUID | None,
        action: str, entity_type: str, entity_id: UUID | None = None,
        old_data: dict | None = None, new_data: dict | None = None,
        ip_address: str | None = None,
    ) -> AuditLog:
        entry = AuditLog(
            company_id=company_id, user_id=user_id,
            action=action, entity_type=entity_type, entity_id=entity_id,
            old_data=old_data, new_data=new_data, ip_address=ip_address,
        )
        return await self.repo.save(entry)

    async def list(self, company_id: UUID) -> list[AuditLog]:
        return await self.repo.get_all(company_id)

    async def get_entity_history(self, company_id: UUID, entity_type: str, entity_id: UUID) -> list[AuditLog]:
        return await self.repo.get_by_entity(company_id, entity_type, entity_id)

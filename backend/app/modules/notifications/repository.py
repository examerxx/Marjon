from __future__ import annotations
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository
from app.modules.notifications.models import Notification


class NotificationRepository(TenantRepository[Notification]):
    def __init__(self, db: AsyncSession):
        super().__init__(Notification, db)

    async def get_unread(self, company_id: UUID, user_id: UUID) -> list[Notification]:
        result = await self.db.execute(
            self._base_query(company_id).where(
                Notification.user_id == user_id, Notification.read_at == None
            )
        )
        return list(result.scalars().all())

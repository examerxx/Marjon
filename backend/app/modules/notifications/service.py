from __future__ import annotations
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.notifications.models import Notification
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.schemas import NotificationCreate
from app.shared.exceptions import NotFoundError


class NotificationService:
    def __init__(self, db: AsyncSession):
        self.repo = NotificationRepository(db)

    async def send(self, company_id: UUID, data: NotificationCreate) -> Notification:
        n = Notification(company_id=company_id, **data.model_dump())
        n.status = "sent"
        return await self.repo.save(n)

    async def get_unread(self, company_id: UUID, user_id: UUID) -> list[Notification]:
        return await self.repo.get_unread(company_id, user_id)

    async def mark_read(self, company_id: UUID, notification_id: UUID) -> Notification:
        n = await self.repo.get_by_id(notification_id, company_id)
        if not n:
            raise NotFoundError("Notification not found")
        n.read_at = datetime.now(timezone.utc)
        return await self.repo.save(n)

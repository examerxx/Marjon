from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.auth.models import User
from app.modules.notifications.models import Notification
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.schemas import NotificationCreate
from app.modules.rbac.models import Role, UserRole
from app.shared.exceptions import NotFoundError
from app.shared.tenant_scope import require_company_resource

# Кому уходит уведомление о досинхронизированном офлайн-заказе: владельцу и
# тем, кто реально принимает заказы (админ/менеджер). Официантов не будим —
# им заказ и так виден на терминале.
ORDER_ADMIN_ROLE_SLUGS = ("owner", "admin", "manager")


class NotificationService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = NotificationRepository(db)

    async def send(self, company_id: UUID, data: NotificationCreate) -> Notification:
        await require_company_resource(
            self.db, User, data.user_id, company_id, detail="User not found"
        )
        n = Notification(company_id=company_id, **data.model_dump())
        n.status = "sent"
        return await self.repo.save(n)

    async def get_unread(self, company_id: UUID, user_id: UUID) -> list[Notification]:
        return await self.repo.get_unread(company_id, user_id)

    async def mark_read(self, company_id: UUID, notification_id: UUID, user_id: UUID) -> Notification:
        n = await self.repo.get_by_id(notification_id, company_id)
        # Чужое уведомление не помечаем прочитанным: company-скоуп пропускал бы
        # любой аккаунт компании, а колокольчик должен гаснуть только у адресата.
        if not n or n.user_id != user_id:
            raise NotFoundError("Notification not found")
        n.read_at = datetime.now(timezone.utc)
        return await self.repo.save(n)

    async def notify_offline_order_synced(self, company_id: UUID, order: Any) -> int:
        """Уведомление владельцу/админам о заказе, оформленном без интернета.

        Заказ уже оплачен и напечатан на терминале, поэтому «новость» — не сам
        заказ, а то, что офлайн-период закончился и деньги попали в систему.
        Создаём in_app-строки: их отдаёт GET /notifications/unread, а колокольчик
        админки опрашивает его вместе с отменами и дефицитом.
        """
        amount = f"{order.total_amount:,.0f}".replace(",", " ")
        return await self._notify_admins(
            company_id,
            title="Офлайн-заказ синхронизирован",
            body=f"Заказ №{order.order_number} · {amount} UZS · оформлен без интернета",
            notification_type="order.offline_synced",
            order=order,
        )

    async def notify_offline_payment_synced(self, company_id: UUID, order: Any, amount: Any) -> int:
        """Оплата, принятая кассой без сети, дошла до сервера.

        Нужна для случая, когда сам заказ был создан ещё при связи, а офлайн
        застал только расчёт: уведомление о заказе уже не сработает, а выручка
        владельцу важна именно в момент, когда деньги попали в систему.
        """
        formatted = f"{amount:,.0f}".replace(",", " ")
        return await self._notify_admins(
            company_id,
            title="Офлайн-оплата синхронизирована",
            body=f"Заказ №{order.order_number} · {formatted} UZS · оплата наличными без интернета",
            notification_type="payment.offline_synced",
            order=order,
        )

    async def _notify_admins(
        self, company_id: UUID, *, title: str, body: str, notification_type: str, order: Any,
    ) -> int:
        recipients = list((await self.db.execute(
            select(User.id)
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                Role.company_id == company_id,
                Role.slug.in_(ORDER_ADMIN_ROLE_SLUGS),
            )
            .distinct()
        )).scalars().all())
        if not recipients:
            return 0
        now = datetime.now(timezone.utc)
        for user_id in recipients:
            self.db.add(Notification(
                company_id=company_id,
                user_id=user_id,
                title=title,
                body=body,
                notification_type=notification_type,
                channel="in_app",
                status="sent",
                sent_at=now,
                data={
                    "order_id": str(order.id),
                    "order_number": order.order_number,
                    "total": str(order.total_amount),
                },
            ))
        await self.db.flush()
        return len(recipients)

from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.notifications.schemas import NotificationCreate, NotificationResponse
from app.modules.notifications.service import NotificationService

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.post("", response_model=NotificationResponse, status_code=status.HTTP_201_CREATED)
async def send_notification(data: NotificationCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await NotificationService(db).send(user.company_id, data)


@router.get("/unread", response_model=list[NotificationResponse])
async def get_unread(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await NotificationService(db).get_unread(user.company_id, user.id)


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def mark_read(notification_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await NotificationService(db).mark_read(user.company_id, notification_id)

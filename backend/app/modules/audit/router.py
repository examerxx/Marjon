from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.audit.schemas import AuditLogResponse
from app.modules.audit.service import AuditService

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditLogResponse])
async def list_logs(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await AuditService(db).list(user.company_id)


@router.get("/entity/{entity_type}/{entity_id}", response_model=list[AuditLogResponse])
async def entity_history(entity_type: str, entity_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await AuditService(db).get_entity_history(user.company_id, entity_type, entity_id)

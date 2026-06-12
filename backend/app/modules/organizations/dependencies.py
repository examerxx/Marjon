from __future__ import annotations
from uuid import UUID
from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.organizations.models import user_organizations
from app.shared.admin_crud import OrgScope


async def get_org_scope(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OrgScope:
    """Видимость данных ограничена организациями аккаунта (ТЗ §4.1).

    None — суперадмин, видит всё; иначе список доступных organization_id.
    """
    if user.is_superadmin:
        return None
    rows = await db.execute(
        select(user_organizations.c.organization_id).where(
            user_organizations.c.user_id == user.id
        )
    )
    return [r[0] for r in rows]

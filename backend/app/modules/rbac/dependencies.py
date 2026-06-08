from __future__ import annotations
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.rbac.service import RBACService
from app.shared.exceptions import ForbiddenError


def require_permission(*permissions: str):
    """Dependency factory: requires all listed permissions."""

    async def checker(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if current_user.is_superadmin:
            return current_user

        rbac = RBACService(db)
        for perm in permissions:
            has = await rbac.check_permission(
                user_id=current_user.id,
                permission=perm,
                company_id=current_user.company_id,
            )
            if not has:
                raise ForbiddenError(f"Missing permission: {perm}")
        return current_user

    return checker

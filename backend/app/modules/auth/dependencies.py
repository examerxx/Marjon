from __future__ import annotations
from uuid import UUID
from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.models import User
from app.modules.auth.repository import UserRepository
from app.modules.auth.security import decode_token
from app.modules.rbac.models import Role, UserRole
from app.shared.exceptions import ForbiddenError
from app.shared.exceptions import UnauthorizedError

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login/form")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_token(token)
    except JWTError:
        raise UnauthorizedError("Could not validate credentials")

    user_id_str = payload.get("sub")
    if not user_id_str:
        raise UnauthorizedError("Could not validate credentials")

    try:
        user_id = UUID(user_id_str)
    except (ValueError, AttributeError):
        raise UnauthorizedError("Could not validate credentials")

    user = await UserRepository(db).get_by_id(user_id)
    if not user or not user.is_active:
        raise UnauthorizedError("User not found or inactive")
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if not current_user.is_active:
        raise UnauthorizedError("Inactive user")
    return current_user


async def require_company_admin(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if current_user.is_superadmin:
        return current_user
    if not current_user.company_id:
        raise ForbiddenError("User is not assigned to a company")

    result = await db.execute(
        select(Role.slug)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(
            UserRole.user_id == current_user.id,
            Role.company_id == current_user.company_id,
            Role.slug.in_(("owner", "admin", "manager")),
        )
    )
    if result.scalars().first():
        return current_user
    raise ForbiddenError("Company admin role required")


async def require_superadmin(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.is_superadmin:
        return current_user
    raise ForbiddenError("Superadmin role required")

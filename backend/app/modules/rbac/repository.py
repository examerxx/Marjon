from __future__ import annotations
from uuid import UUID
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import BaseRepository, TenantRepository
from app.modules.rbac.models import Role, Permission, RolePermission, UserRole


class RoleRepository(TenantRepository[Role]):
    def __init__(self, db: AsyncSession):
        super().__init__(Role, db)

    async def get_system_roles(self) -> list[Role]:
        result = await self.db.execute(
            select(Role).where(Role.is_system == True)
        )
        return list(result.scalars().all())

    async def get_by_slug(self, slug: str, company_id: UUID | None) -> Optional[Role]:
        query = select(Role).where(Role.slug == slug)
        if company_id:
            query = query.where(Role.company_id == company_id)
        else:
            query = query.where(Role.company_id == None)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()


class PermissionRepository(BaseRepository[Permission]):
    def __init__(self, db: AsyncSession):
        super().__init__(Permission, db)

    async def get_all(self) -> list[Permission]:
        result = await self.db.execute(select(Permission))
        return list(result.scalars().all())


class UserRoleRepository(BaseRepository[UserRole]):
    def __init__(self, db: AsyncSession):
        super().__init__(UserRole, db)

    async def get_user_roles(self, user_id: UUID) -> list[UserRole]:
        result = await self.db.execute(
            select(UserRole).where(UserRole.user_id == user_id)
        )
        return list(result.scalars().all())

    async def get_role_permissions(self, role_id: UUID) -> list[Permission]:
        result = await self.db.execute(
            select(Permission)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == role_id)
        )
        return list(result.scalars().all())

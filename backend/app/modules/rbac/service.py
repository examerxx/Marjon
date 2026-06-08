from __future__ import annotations
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.rbac.models import Role, Permission, RolePermission, UserRole
from app.modules.rbac.repository import RoleRepository, PermissionRepository, UserRoleRepository
from app.modules.rbac.schemas import RoleCreate, UserRoleAssign
from app.shared.exceptions import NotFoundError, ConflictError


class RBACService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.role_repo = RoleRepository(db)
        self.perm_repo = PermissionRepository(db)
        self.user_role_repo = UserRoleRepository(db)

    async def create_role(self, company_id: UUID, data: RoleCreate) -> Role:
        if await self.role_repo.get_by_slug(data.slug, company_id):
            raise ConflictError(f"Role slug '{data.slug}' already exists")
        role = Role(company_id=company_id, **data.model_dump())
        return await self.role_repo.save(role)

    async def list_roles(self, company_id: UUID) -> list[Role]:
        company_roles = await self.role_repo.get_all(company_id)
        system_roles = await self.role_repo.get_system_roles()
        return system_roles + company_roles

    async def assign_role(self, data: UserRoleAssign) -> UserRole:
        user_role = UserRole(
            user_id=data.user_id,
            role_id=data.role_id,
            branch_id=data.branch_id,
        )
        return await self.user_role_repo.save(user_role)

    async def check_permission(
        self, user_id: UUID, permission: str, company_id: UUID
    ) -> bool:
        """Check if user has a permission string like 'pos:orders:create'."""
        parts = permission.split(":")
        if len(parts) < 2:
            return False
        module, action = parts[0], ":".join(parts[1:])

        user_roles = await self.user_role_repo.get_user_roles(user_id)
        for user_role in user_roles:
            perms = await self.user_role_repo.get_role_permissions(user_role.role_id)
            for perm in perms:
                if perm.module == module and perm.action == action:
                    return True
        return False

    async def get_user_permissions(self, user_id: UUID) -> list[str]:
        user_roles = await self.user_role_repo.get_user_roles(user_id)
        permissions: set[str] = set()
        for user_role in user_roles:
            perms = await self.user_role_repo.get_role_permissions(user_role.role_id)
            for perm in perms:
                permissions.add(f"{perm.module}:{perm.action}")
        return list(permissions)

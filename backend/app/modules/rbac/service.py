from __future__ import annotations
from uuid import UUID
from sqlalchemy import delete as sql_delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.rbac.constants import COMPANY_ROLE_SLUGS
from app.modules.rbac.models import Role, Permission, RolePermission, UserRole
from app.modules.rbac.permissions import sync_role_permissions
from app.modules.rbac.repository import RoleRepository, PermissionRepository, UserRoleRepository
from app.modules.rbac.schemas import RoleCreate, UserRoleAssign
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError


class RBACService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.role_repo = RoleRepository(db)
        self.perm_repo = PermissionRepository(db)
        self.user_role_repo = UserRoleRepository(db)

    async def create_role(self, company_id: UUID, data: RoleCreate) -> Role:
        if data.slug not in COMPANY_ROLE_SLUGS:
            raise ValidationError(
                f"Unknown role_slug '{data.slug}'. Allowed: {', '.join(sorted(COMPANY_ROLE_SLUGS))}"
            )
        if await self.role_repo.get_by_slug(data.slug, company_id):
            raise ConflictError(f"Role slug '{data.slug}' already exists")
        role = Role(company_id=company_id, **data.model_dump())
        role = await self.role_repo.save(role)
        await sync_role_permissions(self.db, role)
        return role

    async def get_or_create_company_role(
        self, company_id: UUID, slug: str, name: str | None = None
    ) -> Role:
        """BE-05: single source of truth for company-staff role lookup used
        by AuthService.create_company_user/update_company_user. Rejects any
        slug outside the canonical allowlist instead of silently creating a
        fresh, permission-less Role row for it, and attaches that slug's
        default permission set the first time the role is created for this
        company (see permissions.DEFAULT_ROLE_PERMISSIONS)."""
        if slug not in COMPANY_ROLE_SLUGS:
            raise ValidationError(
                f"Unknown role_slug '{slug}'. Allowed: {', '.join(sorted(COMPANY_ROLE_SLUGS))}"
            )
        role = await self.role_repo.get_by_slug(slug, company_id)
        if role is None:
            role = Role(
                company_id=company_id,
                slug=slug,
                name=name or slug.replace("_", " ").title(),
                is_system=False,
            )
            self.db.add(role)
            await self.db.flush()
            await sync_role_permissions(self.db, role)
        return role

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

    async def list_permissions(self) -> list[Permission]:
        return await self.perm_repo.get_all()

    async def _get_scoped_role(self, role_id: UUID, company_id: UUID | None) -> Role:
        role = await self.db.get(Role, role_id)
        if role is None or (not role.is_system and role.company_id != company_id):
            raise NotFoundError("Role not found")
        return role

    async def assign_permission(self, role_id: UUID, permission_id: UUID, company_id: UUID | None) -> None:
        role = await self._get_scoped_role(role_id, company_id)
        permission = await self.db.get(Permission, permission_id)
        if permission is None:
            raise NotFoundError("Permission not found")
        exists = (
            await self.db.execute(
                select(RolePermission).where(
                    RolePermission.role_id == role.id,
                    RolePermission.permission_id == permission.id,
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            self.db.add(RolePermission(role_id=role.id, permission_id=permission.id))
            await self.db.commit()

    async def revoke_permission(self, role_id: UUID, permission_id: UUID, company_id: UUID | None) -> None:
        role = await self._get_scoped_role(role_id, company_id)
        await self.db.execute(
            sql_delete(RolePermission).where(
                RolePermission.role_id == role.id,
                RolePermission.permission_id == permission_id,
            )
        )
        await self.db.commit()

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

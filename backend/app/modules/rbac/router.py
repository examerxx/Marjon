from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user, require_company_admin
from app.modules.auth.models import User
from app.modules.rbac.schemas import (
    PermissionResponse, RoleCreate, RolePermissionAssign, RoleResponse,
    UserRoleAssign, UserRoleResponse,
)
from app.modules.rbac.service import RBACService

router = APIRouter(prefix="/rbac", tags=["rbac"])


@router.post("/roles", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def create_role(
    data: RoleCreate,
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return await RBACService(db).create_role(current_user.company_id, data)


@router.get("/roles", response_model=list[RoleResponse])
async def list_roles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await RBACService(db).list_roles(current_user.company_id)


@router.post("/user-roles", response_model=UserRoleResponse, status_code=status.HTTP_201_CREATED)
async def assign_role(
    data: UserRoleAssign,
    _: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return await RBACService(db).assign_role(data)


@router.get("/me/permissions", response_model=list[str])
async def my_permissions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await RBACService(db).get_user_permissions(current_user.id)


@router.get("/permissions", response_model=list[PermissionResponse])
async def list_permissions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """BE-05: full catalog of permissions the system knows about, for
    building a role-permission editor in the settings UI."""
    return await RBACService(db).list_permissions()


@router.post("/roles/{role_id}/permissions", status_code=status.HTTP_204_NO_CONTENT)
async def assign_role_permission(
    role_id: UUID,
    data: RolePermissionAssign,
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    """BE-05: grant a permission to a role. This is what makes changing a
    role's permissions actually affect access — check_permission()/
    require_permission() read straight from the RolePermission rows this
    creates."""
    await RBACService(db).assign_permission(role_id, data.permission_id, current_user.company_id)


@router.delete("/roles/{role_id}/permissions/{permission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_role_permission(
    role_id: UUID,
    permission_id: UUID,
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    await RBACService(db).revoke_permission(role_id, permission_id, current_user.company_id)

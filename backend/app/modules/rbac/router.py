from __future__ import annotations
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user, require_company_admin
from app.modules.auth.models import User
from app.modules.rbac.schemas import RoleCreate, RoleResponse, UserRoleAssign, UserRoleResponse
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

from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import require_company_admin, require_company_app_user
from app.modules.auth.models import User
from app.modules.halls.schemas import (
    HallCreate, HallReorderRequest, HallResponse, HallUpdate,
    TableCreate, TableResponse, TableUpdate,
)
from app.modules.halls.service import HallService
from app.modules.finance.ownership import FinanceScope
from app.modules.finance.ownership_router import get_company_finance_scope

router = APIRouter(prefix="/halls", tags=["halls"])

# Phase 5C-4: additive, visibility-only flag for the Settings management
# directory. Omitted or false keeps the historical ACTIVE-ONLY contract, so
# existing clients never see archived rows appear. It widens neither tenant
# scoping nor the Phase 5C-3 active-number uniqueness rule.
_INCLUDE_INACTIVE = Query(
    False,
    description=(
        "Include archived (is_active=false) rows. Visibility only — tenant/branch "
        "scoping and table-number uniqueness are unchanged."
    ),
)


@router.get("", response_model=list[HallResponse])
async def list_halls(
    branch_id: UUID | None = Query(None),
    include_inactive: bool = _INCLUDE_INACTIVE,
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Places directory. Default: active halls with active tables only.
    `include_inactive=true`: archived halls AND archived nested tables."""
    return await HallService(db).list(
        user.company_id, branch_id, include_inactive=include_inactive
    )


@router.post("", response_model=HallResponse, status_code=status.HTTP_201_CREATED)
async def create_hall(
    data: HallCreate,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    return await HallService(db).create(scope.tenant_id, data)


# Phase 5C-6A: branch-scoped bulk reorder. Declared BEFORE the "/{hall_id}"
# routes so the literal path is matched first and "reorder" is never parsed as
# a hall UUID. Admin-only, like the other write endpoints.
@router.patch("/reorder", response_model=list[HallResponse])
async def reorder_halls(
    data: HallReorderRequest,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    """Persist a COMPLETE branch-scoped order. `hall_ids` must be every hall of
    `branch_id` (active + inactive) exactly once; returns the branch's halls in
    the new canonical order. Never changes branch/active/pricing state."""
    return await HallService(db).reorder(scope.tenant_id, data.branch_id, data.hall_ids)


@router.get("/{hall_id}", response_model=HallResponse)
async def get_hall(
    hall_id: UUID,
    include_inactive: bool = _INCLUDE_INACTIVE,
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    """An archived hall is addressable by id either way (unchanged); the flag
    widens the nested `tables` collection to include archived seating."""
    return await HallService(db).get(
        user.company_id, hall_id, include_inactive_tables=include_inactive
    )


@router.patch("/{hall_id}", response_model=HallResponse)
async def update_hall(
    hall_id: UUID,
    data: HallUpdate,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    return await HallService(db).update(scope.tenant_id, hall_id, data)


@router.delete("/{hall_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_hall(
    hall_id: UUID,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    await HallService(db).delete(user.company_id, hall_id)


@router.get("/{hall_id}/tables", response_model=list[TableResponse])
async def list_tables(
    hall_id: UUID,
    include_inactive: bool = _INCLUDE_INACTIVE,
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Default: active tables only. `include_inactive=true`: plus archived."""
    return await HallService(db).list_tables(
        user.company_id, hall_id, include_inactive=include_inactive
    )


@router.post("/{hall_id}/tables", response_model=TableResponse, status_code=status.HTTP_201_CREATED)
async def create_table(
    hall_id: UUID,
    data: TableCreate,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return await HallService(db).create_table(user.company_id, hall_id, data)


@router.patch("/{hall_id}/tables/{table_id}", response_model=TableResponse)
async def update_table(
    hall_id: UUID,
    table_id: UUID,
    data: TableUpdate,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return await HallService(db).update_table(user.company_id, hall_id, table_id, data)


@router.delete("/{hall_id}/tables/{table_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_table(
    hall_id: UUID,
    table_id: UUID,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    await HallService(db).delete_table(user.company_id, hall_id, table_id)


@router.get("/branch/{branch_id}/tables", response_model=list[TableResponse])
async def branch_tables(
    branch_id: UUID,
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    """All active tables in a branch (for waiter table picker)."""
    return await HallService(db).branch_tables(user.company_id, branch_id)

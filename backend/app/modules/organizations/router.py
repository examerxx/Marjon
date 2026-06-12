from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user, require_superadmin
from app.modules.auth.models import User
from app.modules.organizations import models, schemas
from app.modules.organizations.dependencies import get_org_scope
from app.modules.organizations.service import AccountService, OfflineJobService
from app.shared.admin_crud import crud_router

router = APIRouter()

router.include_router(crud_router(
    prefix="/organizations", tags=["organizations"],
    model=models.Organization,
    create_schema=schemas.OrganizationCreate,
    update_schema=schemas.OrganizationUpdate,
    response_schema=schemas.OrganizationResponse,
    search_fields=("name", "tin"),
    filter_fields=(
        "status", "organization_status_id", "country_id", "region_id",
        "district_id", "is_main", "is_solvent", "is_billing_autoblock",
    ),
    org_field="id",
    scope_dep=get_org_scope,
))

router.include_router(crud_router(
    prefix="/organization-statuses", tags=["organizations"],
    model=models.OrganizationStatus,
    create_schema=schemas.OrganizationStatusCreate,
    update_schema=schemas.OrganizationStatusUpdate,
    response_schema=schemas.OrganizationStatusResponse,
    search_fields=("name",),
    filter_fields=("status",),
    default_sort="sort",
))


# ── Аккаунты ──────────────────────────────────────────────────────────────────
accounts = APIRouter(prefix="/accounts", tags=["accounts"])


@accounts.get("", response_model=list[schemas.AccountResponse])
async def list_accounts(user: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    return await AccountService(db).list()


@accounts.post("", response_model=schemas.AccountResponse, status_code=status.HTTP_201_CREATED)
async def create_account(data: schemas.AccountCreate, user: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    return await AccountService(db).create(data)


@accounts.get("/{account_id}", response_model=schemas.AccountResponse)
async def get_account(account_id: UUID, user: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    svc = AccountService(db)
    return await svc.to_response(await svc.get(account_id))


@accounts.patch("/{account_id}", response_model=schemas.AccountResponse)
async def update_account(account_id: UUID, data: schemas.AccountUpdate, user: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    return await AccountService(db).update(account_id, data)


@accounts.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_account(account_id: UUID, user: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    await AccountService(db).delete(account_id)


router.include_router(accounts)


# ── Offline jobs ─────────────────────────────────────────────────────────────
offline = crud_router(
    prefix="/offline-jobs", tags=["offline-jobs"],
    model=models.OfflineJob,
    create_schema=schemas.OfflineJobCreate,
    update_schema=schemas.OfflineJobCreate,
    response_schema=schemas.OfflineJobResponse,
    filter_fields=("status", "type", "organization_id"),
    org_field="organization_id",
    scope_dep=get_org_scope,
)


@offline.post("/submit", response_model=schemas.OfflineJobResponse, status_code=status.HTTP_201_CREATED,
              summary="Идемпотентный приём офлайн-операций")
async def submit_offline_job(data: schemas.OfflineJobCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await OfflineJobService(db).submit(data)


@offline.post("/{job_id}/retry", response_model=schemas.OfflineJobResponse)
async def retry_offline_job(job_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await OfflineJobService(db).retry(job_id)


router.include_router(offline)

from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user, require_hq_admin, require_superadmin
from app.modules.auth.models import User
from app.modules.organizations import models, schemas
from app.modules.organizations.dependencies import get_org_scope
from app.modules.organizations.service import AccountService, OfflineJobService, OrganizationService
from app.shared.admin_crud import OrgScope, crud_router
from app.shared.pagination import Page, PageParams

router = APIRouter()

# BE-15: the plain crud_router LIST endpoint returned bare OrganizationResponse
# rows — no owner_name/admin_name/branches_count, which the admin org-directory
# table expects. Registering a custom GET "" on the SAME router object BEFORE
# handing it to crud_router makes this one win for GET /organizations (first-
# registered route wins for an exact path+method match — the same mechanic
# BE-04 had to fix as a bug is used here intentionally, matching the pattern
# already established in nomenclature/storage's routers). create/get/update/
# delete below are still the plain crud_router ones, unaffected.
organizations = APIRouter(prefix="/organizations", tags=["organizations"])


ORG_FILTERS = (
    "status", "organization_status_id", "country_id", "region_id",
    "district_id", "is_main", "is_solvent", "is_billing_autoblock",
)


@organizations.get(
    "", response_model=Page[schemas.OrganizationDirectoryResponse],
    description=f"Фильтры по полям: {', '.join(ORG_FILTERS)}",
)
async def list_organizations_directory(
    request: Request,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    search: str | None = Query(None),
    user: User = Depends(require_hq_admin),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    params = PageParams(page=page, size=size)
    raw_filters = {f: request.query_params[f] for f in ORG_FILTERS if f in request.query_params}
    items, total = await OrganizationService(db).list_directory(
        params, search=search, org_scope=org_scope, raw_filters=raw_filters
    )
    return Page.create(
        [schemas.OrganizationDirectoryResponse.model_validate(i) for i in items], total, params
    )


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
    router=organizations,
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
async def retry_offline_job(job_id: UUID, user: User = Depends(require_hq_admin), db: AsyncSession = Depends(get_db)):
    """BE-03: manual re-trigger of a failed offline job — an HQ admin action,
    not something a syncing client app needs. Was get_current_user with zero
    ownership check in the service layer, so any authenticated user of any
    company could retry any organization's offline job by id."""
    return await OfflineJobService(db).retry(job_id)


router.include_router(offline)

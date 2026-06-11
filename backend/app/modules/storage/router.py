from __future__ import annotations
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.organizations.dependencies import get_org_scope
from app.modules.storage import models, schemas
from app.modules.storage.service import ComingService, StorageReportService
from app.shared.admin_crud import CRUDService, crud_router
from app.shared.pagination import Page, PageParams

router = APIRouter()

router.include_router(crud_router(
    prefix="/storages", tags=["storage"],
    model=models.Storage,
    create_schema=schemas.StorageCreate,
    update_schema=schemas.StorageUpdate,
    response_schema=schemas.StorageResponse,
    search_fields=("name",),
    filter_fields=("organization_id",),
    org_field="organization_id",
    scope_dep=get_org_scope,
    default_sort="name",
))

router.include_router(crud_router(
    prefix="/providers", tags=["storage"],
    model=models.Provider,
    create_schema=schemas.ProviderCreate,
    update_schema=schemas.ProviderUpdate,
    response_schema=schemas.ProviderResponse,
    search_fields=("name", "phone"),
    default_sort="name",
))


comings = APIRouter(prefix="/comings", tags=["storage"])

COMING_FILTERS = ("status", "storage_id", "provider_id")


@comings.get("", response_model=Page[schemas.ComingResponse],
             description=f"Фильтры по полям: {', '.join(COMING_FILTERS)}")
async def list_comings(
    request: Request,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    search: str | None = Query(None),
    sort: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    params = PageParams(page=page, size=size)
    raw_filters = {f: request.query_params[f] for f in COMING_FILTERS if f in request.query_params}
    items, total = await ComingService(db).list(
        params, search=search, search_fields=("number",), sort=sort,
        raw_filters=raw_filters, date_from=date_from, date_to=date_to,
    )
    return Page.create([schemas.ComingResponse.model_validate(i) for i in items], total, params)


@comings.post("", response_model=schemas.ComingResponse, status_code=status.HTTP_201_CREATED)
async def create_coming(data: schemas.ComingCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await ComingService(db).create_coming(data)


@comings.get("/{coming_id}", response_model=schemas.ComingResponse)
async def get_coming(coming_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await ComingService(db).get(coming_id)


@comings.patch("/{coming_id}", response_model=schemas.ComingResponse)
async def update_coming(coming_id: UUID, data: schemas.ComingUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await ComingService(db).update_coming(coming_id, data)


@comings.delete("/{coming_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_coming(coming_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await ComingService(db).delete(coming_id)


@comings.post("/{coming_id}/accept", response_model=schemas.ComingResponse,
              summary="Принять поступление (увеличивает остатки)")
async def accept_coming(coming_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await ComingService(db).accept(coming_id)


router.include_router(comings)


# Ручные движения по складу (расход/корректировки)
movements = crud_router(
    prefix="/storage-movements", tags=["storage"],
    model=models.StorageMovement,
    create_schema=schemas.MovementCreate,
    update_schema=schemas.MovementCreate,
    response_schema=schemas.MovementResponse,
    filter_fields=("storage_id", "product_id", "direction"),
    date_field="date",
)
router.include_router(movements)


storage_reports = APIRouter(prefix="/reports", tags=["storage-reports"])


@storage_reports.get("/storage-balances", response_model=list[schemas.StorageBalanceRow],
                     summary="Остатки по складам за период")
async def storage_balances(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    storage_id: UUID | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await StorageReportService(db).balances(date_from, date_to, storage_id)


@storage_reports.get("/incomes", response_model=list[schemas.FlowReportRow],
                     summary="Приход по складам")
async def storage_incomes(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    storage_id: UUID | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await StorageReportService(db).flow("income", date_from, date_to, storage_id)


@storage_reports.get("/consumption", response_model=list[schemas.FlowReportRow],
                     summary="Расход по складам")
async def storage_consumption(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    storage_id: UUID | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await StorageReportService(db).flow("expense", date_from, date_to, storage_id)


router.include_router(storage_reports)

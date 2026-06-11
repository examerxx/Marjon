from __future__ import annotations
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.marketing import models, schemas
from app.modules.marketing.service import LeadService
from app.modules.organizations.dependencies import get_org_scope
from app.shared.admin_crud import OrgScope, crud_router
from app.shared.pagination import Page, PageParams

router = APIRouter()

for prefix, model, create_s, update_s, response_s, extra in [
    ("/lead-statuses", models.LeadStatus, schemas.LeadStatusCreate, schemas.LeadStatusUpdate, schemas.LeadStatusResponse, {"default_sort": "sort"}),
    ("/lead-tags", models.LeadTag, schemas.LeadTagCreate, schemas.LeadTagUpdate, schemas.LeadTagResponse, {"default_sort": "sort"}),
    ("/lead-cancellation-reasons", models.LeadCancellationReason, schemas.NamedDictCreate, schemas.NamedDictUpdate, schemas.NamedDictResponse, {"filter_fields": ("status",)}),
    ("/sources", models.Source, schemas.NamedDictCreate, schemas.NamedDictUpdate, schemas.NamedDictResponse, {"filter_fields": ("status",)}),
    ("/activity-types", models.ActivityType, schemas.NamedDictCreate, schemas.NamedDictUpdate, schemas.NamedDictResponse, {"filter_fields": ("status",)}),
]:
    router.include_router(crud_router(
        prefix=prefix, tags=["marketing"],
        model=model, create_schema=create_s, update_schema=update_s,
        response_schema=response_s, search_fields=("name",), **extra,
    ))


leads = APIRouter(prefix="/leads", tags=["marketing"])

LEAD_FILTERS = (
    "status_id", "source_id", "type", "type_of_activity_id", "region_id",
    "district_id", "organization_id", "user_id", "quality",
)


@leads.get("", response_model=Page[schemas.LeadResponse],
           description=f"Фильтры по полям: {', '.join(LEAD_FILTERS)}")
async def list_leads(
    request: Request,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    search: str | None = Query(None),
    sort: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(get_current_user),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    params = PageParams(page=page, size=size)
    raw_filters = {f: request.query_params[f] for f in LEAD_FILTERS if f in request.query_params}
    items, total = await LeadService(db).list(
        params,
        search=search,
        search_fields=("customer_name",),
        sort=sort,
        raw_filters=raw_filters,
        date_from=date_from,
        date_to=date_to,
        org_scope=org_scope,
        org_field="organization_id",
    )
    return Page.create([schemas.LeadResponse.model_validate(i) for i in items], total, params)


@leads.get("/statistics", response_model=schemas.LeadStatisticsResponse)
async def lead_statistics(
    user: User = Depends(get_current_user),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    return await LeadService(db).statistics(org_scope)


@leads.post("/import", response_model=schemas.LeadImportResult)
async def import_leads(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    return await LeadService(db).import_leads(file.filename or "leads.csv", content, user.id)


@leads.post("", response_model=schemas.LeadResponse, status_code=status.HTTP_201_CREATED)
async def create_lead(data: schemas.LeadCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await LeadService(db).create_lead(data, user.id)


@leads.get("/{lead_id}", response_model=schemas.LeadResponse)
async def get_lead(lead_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await LeadService(db).get(lead_id)


@leads.patch("/{lead_id}", response_model=schemas.LeadResponse)
async def update_lead(lead_id: UUID, data: schemas.LeadUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await LeadService(db).update_lead(lead_id, data)


@leads.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(lead_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await LeadService(db).delete(lead_id)


@leads.post("/{lead_id}/tags", response_model=schemas.LeadResponse)
async def assign_lead_tags(lead_id: UUID, data: schemas.LeadTagsAssign, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await LeadService(db).assign_tags(lead_id, data.tag_ids)


router.include_router(leads)

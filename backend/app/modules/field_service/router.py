from __future__ import annotations
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.field_service import models, schemas
from app.modules.field_service.service import FieldServiceService
from app.modules.organizations.dependencies import get_org_scope
from app.shared.admin_crud import OrgScope, crud_router

router = APIRouter()


employees = APIRouter(prefix="/employees", tags=["services"])


@employees.post("/sync", response_model=schemas.SyncResult,
                summary="Обновить список сотрудников (devent)")
async def sync_employees(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await FieldServiceService(db).sync_employees()


@employees.get("/on-map", response_model=list[schemas.EmployeeOnMap],
               summary="Сотрудники на карте")
async def employees_on_map(
    user: User = Depends(get_current_user),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    return await FieldServiceService(db).employees_on_map(org_scope)


crud_router(
    prefix="/employees", tags=["services"],
    model=models.ServiceEmployee,
    create_schema=schemas.EmployeeCreate,
    update_schema=schemas.EmployeeUpdate,
    response_schema=schemas.EmployeeResponse,
    search_fields=("fio", "phone"),
    filter_fields=("role", "organization_id", "participates_in_rating"),
    org_field="organization_id",
    scope_dep=get_org_scope,
    default_sort="fio",
    router=employees,
)
router.include_router(employees)


services = APIRouter(prefix="/services", tags=["services"])


@services.post("/sync", response_model=schemas.SyncResult,
               summary="Обновить список услуг (devent)")
async def sync_services(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await FieldServiceService(db).sync_services()


@services.get("/statistics", response_model=list[schemas.ServiceStatisticsRow],
              summary="Статистика по услугам")
async def services_statistics(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await FieldServiceService(db).services_statistics()


crud_router(
    prefix="/services", tags=["services"],
    model=models.Service,
    create_schema=schemas.ServiceCreate,
    update_schema=schemas.ServiceUpdate,
    response_schema=schemas.ServiceResponse,
    search_fields=("name",),
    default_sort="name",
    router=services,
)
router.include_router(services)


router.include_router(crud_router(
    prefix="/tech-help", tags=["services"],
    model=models.TechHelp,
    create_schema=schemas.TechHelpCreate,
    update_schema=schemas.TechHelpUpdate,
    response_schema=schemas.TechHelpResponse,
    search_fields=("requester", "text"),
    filter_fields=("status", "organization_id"),
    org_field="organization_id",
    scope_dep=get_org_scope,
))

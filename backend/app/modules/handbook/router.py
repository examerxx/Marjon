from __future__ import annotations
from fastapi import APIRouter
from app.shared.admin_crud import crud_router
from app.modules.handbook import models, schemas

router = APIRouter()

router.include_router(crud_router(
    prefix="/countries", tags=["handbook"],
    model=models.Country,
    create_schema=schemas.CountryCreate,
    update_schema=schemas.CountryUpdate,
    response_schema=schemas.CountryResponse,
    search_fields=("name",),
    filter_fields=("status",),
    default_sort="name",
))

router.include_router(crud_router(
    prefix="/regions", tags=["handbook"],
    model=models.Region,
    create_schema=schemas.RegionCreate,
    update_schema=schemas.RegionUpdate,
    response_schema=schemas.RegionResponse,
    search_fields=("name",),
    filter_fields=("status", "country_id"),
    default_sort="name",
))

router.include_router(crud_router(
    prefix="/districts", tags=["handbook"],
    model=models.District,
    create_schema=schemas.DistrictCreate,
    update_schema=schemas.DistrictUpdate,
    response_schema=schemas.DistrictResponse,
    search_fields=("name",),
    filter_fields=("status", "region_id"),
    default_sort="name",
))

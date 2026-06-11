from __future__ import annotations
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.nomenclature import models, schemas
from app.modules.organizations.dependencies import get_org_scope
from app.shared.admin_crud import CRUDService, crud_router
from app.shared.pagination import Page, PageParams

router = APIRouter()

router.include_router(crud_router(
    prefix="/categories", tags=["nomenclature"],
    model=models.NomCategory,
    create_schema=schemas.NomCategoryCreate,
    update_schema=schemas.NomCategoryUpdate,
    response_schema=schemas.NomCategoryResponse,
    search_fields=("name",),
    filter_fields=("status",),
    default_sort="sort",
))

router.include_router(crud_router(
    prefix="/units", tags=["nomenclature"],
    model=models.Unit,
    create_schema=schemas.UnitCreate,
    update_schema=schemas.UnitUpdate,
    response_schema=schemas.UnitResponse,
    search_fields=("name", "short_name"),
    filter_fields=("status",),
    default_sort="sort",
))


products = APIRouter(prefix="/products", tags=["nomenclature"])


@products.get("/archive", response_model=Page[schemas.NomProductResponse],
              summary="Архив продуктов")
async def archived_products(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    search: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    params = PageParams(page=page, size=size)
    items, total = await CRUDService(models.NomProduct, db).list(
        params, search=search, search_fields=("name",),
        raw_filters={"is_archived": "true"},
    )
    return Page.create([schemas.NomProductResponse.model_validate(i) for i in items], total, params)


@products.post("/{product_id}/archive", response_model=schemas.NomProductResponse,
               summary="Архивировать продукт")
async def archive_product(
    product_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CRUDService(models.NomProduct, db).update(product_id, {"is_archived": True})


@products.post("/{product_id}/unarchive", response_model=schemas.NomProductResponse,
               summary="Вернуть продукт из архива")
async def unarchive_product(
    product_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CRUDService(models.NomProduct, db).update(product_id, {"is_archived": False})


# Стандартный CRUD добавляется после специальных маршрутов,
# чтобы GET /products/archive не перехватывался GET /products/{item_id}
crud_router(
    prefix="/products", tags=["nomenclature"],
    model=models.NomProduct,
    create_schema=schemas.NomProductCreate,
    update_schema=schemas.NomProductUpdate,
    response_schema=schemas.NomProductResponse,
    search_fields=("name",),
    filter_fields=("status", "category_id", "unit_id", "is_used", "is_archived"),
    default_sort="name",
    router=products,
)
router.include_router(products)

router.include_router(crud_router(
    prefix="/orders", tags=["nomenclature"],
    model=models.NomOrder,
    create_schema=schemas.NomOrderCreate,
    update_schema=schemas.NomOrderUpdate,
    response_schema=schemas.NomOrderResponse,
    search_fields=("name",),
    filter_fields=("status", "organization_id"),
    org_field="organization_id",
    scope_dep=get_org_scope,
))

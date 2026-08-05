from __future__ import annotations
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user, require_company_admin
from app.modules.auth.models import User
from app.modules.inventory.schemas import (
    CategoryCreate, CategoryResponse,
    IngredientCreate, IngredientResponse,
    ProductCreate, ProductResponse, ProductUpdate,
    StockItemResponse, StockMovementCreate, StockMovementResponse,
)
from app.modules.inventory.service import CategoryService, IngredientService, ProductService, StockService
from app.shared.storage import storage

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
_EXT_MAP = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.post("/categories", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(data: CategoryCreate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    return await CategoryService(db).create(user.company_id, data)


@router.get("/categories", response_model=list[CategoryResponse])
async def list_categories(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await CategoryService(db).list(user.company_id)


@router.post("/products", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(data: ProductCreate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    return await ProductService(db).create(user.company_id, data)


@router.get("/products", response_model=list[ProductResponse])
async def list_products(
    include_all: bool = Query(False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = ProductService(db)
    if include_all:
        return await svc.list_all(user.company_id)
    return await svc.list(user.company_id)


@router.get("/products/{product_id}", response_model=ProductResponse)
async def get_product(product_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await ProductService(db).get(user.company_id, product_id)


@router.patch("/products/{product_id}", response_model=ProductResponse)
async def update_product(product_id: UUID, data: ProductUpdate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    return await ProductService(db).update(user.company_id, product_id, data)


@router.post("/upload-image", response_model=dict)
async def upload_image(
    file: UploadFile = File(...),
    user: User = Depends(require_company_admin),
):
    """Generic image upload — returns {url: "..."} for use in PATCH body."""
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Поддерживаются только jpg, png, webp")
    ext = _EXT_MAP[file.content_type]
    key = f"products/{user.company_id}/{uuid4()}.{ext}"
    try:
        url = await storage.upload(await file.read(), key, file.content_type)
    except Exception as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"Ошибка хранилища: {exc}") from exc
    return {"url": url}


@router.post("/products/{product_id}/photo", response_model=ProductResponse)
async def upload_product_photo(
    product_id: UUID,
    file: UploadFile = File(...),
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Поддерживаются только jpg, png, webp")
    ext = _EXT_MAP[file.content_type]
    key = f"products/{user.company_id}/{product_id}.{ext}"
    try:
        image_url = await storage.upload(await file.read(), key, file.content_type)
    except Exception as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"Ошибка хранилища: {exc}") from exc
    return await ProductService(db).update_image(user.company_id, product_id, image_url)


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: UUID, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    await ProductService(db).delete(user.company_id, product_id)


@router.post("/ingredients", response_model=IngredientResponse, status_code=status.HTTP_201_CREATED)
async def create_ingredient(data: IngredientCreate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    """BE-10 dependency: IngredientCreate existed as a schema but was never
    wired to any endpoint — there was no way to create an Ingredient row
    through the API at all, which also blocked semi-product composition
    from being usable end-to-end."""
    return await IngredientService(db).create(user.company_id, data)


@router.get("/ingredients", response_model=list[IngredientResponse])
async def list_ingredients(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await IngredientService(db).list(user.company_id)


@router.get("/stock", response_model=list[StockItemResponse])
async def get_stock(
    warehouse_id: UUID | None = Query(None),
    low_stock: bool = Query(False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = StockService(db)
    if low_stock:
        return await svc.get_low_stock(user.company_id)
    return await svc.get_stock(user.company_id, warehouse_id)


@router.post("/stock/movements", response_model=StockMovementResponse, status_code=status.HTTP_201_CREATED)
async def create_movement(data: StockMovementCreate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    return await StockService(db).create_movement(user.company_id, user.id, data)

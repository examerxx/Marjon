from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query, status
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
async def list_products(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await ProductService(db).list(user.company_id)


@router.get("/products/{product_id}", response_model=ProductResponse)
async def get_product(product_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await ProductService(db).get(user.company_id, product_id)


@router.patch("/products/{product_id}", response_model=ProductResponse)
async def update_product(product_id: UUID, data: ProductUpdate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    return await ProductService(db).update(user.company_id, product_id, data)


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

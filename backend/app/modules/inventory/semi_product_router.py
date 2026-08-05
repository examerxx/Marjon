"""BE-10: /inventory/semi-products — company-scoped semi-finished product
CRUD, matching the ТЗ contract exactly. Kept in its own file, mirroring
warehouse_router.py."""
from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user, require_company_admin
from app.modules.auth.models import User
from app.modules.inventory.semi_product_models import SemiProduct
from app.modules.inventory.semi_product_schemas import (
    SemiProductCreate, SemiProductIngredientResponse, SemiProductProduceRequest,
    SemiProductResponse, SemiProductUpdate,
)
from app.modules.inventory.semi_product_service import SemiProductService
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/inventory/semi-products", tags=["inventory"])


def _to_response(sp: SemiProduct) -> SemiProductResponse:
    return SemiProductResponse(
        id=sp.id, created_at=sp.created_at, updated_at=sp.updated_at,
        company_id=sp.company_id, category_id=sp.category_id, subcategory_id=sp.subcategory_id,
        name=sp.name, unit=sp.unit, cost_price=sp.cost_price,
        ingredients_count=len(sp.ingredients), is_active=sp.is_active,
        ingredients=[
            SemiProductIngredientResponse(
                ingredient_id=line.ingredient_id,
                ingredient_name=line.ingredient.name if line.ingredient else "",
                quantity=line.quantity,
                unit=line.ingredient.unit if line.ingredient else "",
            )
            for line in sp.ingredients
        ],
    )


@router.get("", response_model=list[SemiProductResponse])
async def list_semi_products(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    items = await SemiProductService(db).list(user.company_id)
    return [_to_response(i) for i in items]


@router.post("", response_model=SemiProductResponse, status_code=status.HTTP_201_CREATED)
async def create_semi_product(
    data: SemiProductCreate,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    sp = await SemiProductService(db).create(user.company_id, data)
    return _to_response(sp)


@router.get("/{semi_product_id}", response_model=SemiProductResponse)
async def get_semi_product(
    semi_product_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sp = await SemiProductService(db).get(user.company_id, semi_product_id)
    return _to_response(sp)


@router.patch("/{semi_product_id}", response_model=SemiProductResponse)
async def update_semi_product(
    semi_product_id: UUID,
    data: SemiProductUpdate,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    sp = await SemiProductService(db).update(user.company_id, semi_product_id, data)
    return _to_response(sp)


@router.delete("/{semi_product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_semi_product(
    semi_product_id: UUID,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    await SemiProductService(db).delete(user.company_id, semi_product_id)


@router.post("/{semi_product_id}/produce", response_model=SemiProductResponse,
             summary="Произвести партию (списывает ингредиенты со склада)")
async def produce_semi_product(
    semi_product_id: UUID,
    data: SemiProductProduceRequest,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    sp = await SemiProductService(db).produce(
        user.company_id, user.id, semi_product_id, data.warehouse_id, data.quantity
    )
    return _to_response(sp)

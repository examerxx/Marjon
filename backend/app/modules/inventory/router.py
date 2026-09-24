from __future__ import annotations
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import (
    get_current_user, require_company_app_user, require_company_admin,
)
from app.modules.auth.models import User
from app.modules.inventory.models import Product
from app.modules.inventory.schemas import (
    CategoryCreate, CategoryResponse,
    IngredientCreate, IngredientResponse, IngredientUpdate,
    ModifierGroupCreate, ModifierGroupResponse, ModifierGroupUpdate, ModifierResponse,
    ProductAvailabilityUpdate, ProductCreate, ProductIngredientResponse,
    ProductLimitUpdate, ProductResponse, ProductUpdate,
    StockItemResponse, StockMovementCreate, StockMovementResponse,
)
from app.modules.inventory.service import (
    CategoryService, IngredientService, ModifierGroupService, ProductService, StockService
)
from sqlalchemy import select
from app.modules.inventory.models import Product, Ingredient
from app.modules.rbac.dependencies import require_permission
from app.modules.rbac.models import Role, UserRole
from app.shared.exceptions import ForbiddenError
from app.shared.storage import storage

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
_EXT_MAP = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

router = APIRouter(prefix="/inventory", tags=["inventory"])

# Стоп-лист правят с десктопа кассир и повар (плюс владелец/админ и HQ-суперадмин).
# Официанту и курьеру — запрещено (deny-by-default). Гвард отдельный от
# require_company_admin: тот НЕ пускает кассира/повара, а здесь они — основные редакторы.
_STOP_LIST_EDITOR_ROLES = ("owner", "admin", "cashier", "kitchen")


async def require_stop_list_editor(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if user.is_superadmin:
        return user
    if not user.company_id:
        raise ForbiddenError("User is not assigned to a company")
    result = await db.execute(
        select(Role.slug)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(
            UserRole.user_id == user.id,
            Role.company_id == user.company_id,
            Role.slug.in_(_STOP_LIST_EDITOR_ROLES),
        )
    )
    if result.scalars().first():
        return user
    raise ForbiddenError("Cashier role required to edit stop-list")


def _group_to_response(g) -> ModifierGroupResponse:
    return ModifierGroupResponse(
        id=g.id, created_at=g.created_at, updated_at=g.updated_at,
        company_id=g.company_id, product_id=g.product_id,
        name=g.name, min_select=g.min_select, max_select=g.max_select,
        is_required=g.is_required, show_in_pos=g.show_in_pos, sort_order=g.sort_order,
        modifiers=[
            ModifierResponse(
                id=m.id, created_at=m.created_at, updated_at=m.updated_at,
                group_id=m.group_id, company_id=m.company_id, name=m.name,
                price_delta=m.price_delta, is_default=m.is_default, sort_order=m.sort_order,
            )
            for m in sorted(g.modifiers, key=lambda m: (m.sort_order, m.created_at))
        ],
    )


def _product_to_response(p: Product) -> ProductResponse:
    """BE-16: ProductResponse.ingredients' field names (ingredient_name,
    unit) don't match the raw ProductIngredient ORM relationship
    (ingredient_id, quantity + a nested .ingredient), so this can't be a
    plain response_model=ProductResponse auto-serialization — same
    reasoning as semi_product_router.py's _to_response()."""
    return ProductResponse(
        id=p.id, created_at=p.created_at, updated_at=p.updated_at,
        company_id=p.company_id, category_id=p.category_id, subcategory_id=p.subcategory_id,
        product_type=p.product_type, printer_id=p.printer_id,
        name=p.name, description=p.description, image_url=p.image_url,
        price=p.price, cost_price=p.cost_price, tax_rate=p.tax_rate, unit=p.unit,
        barcode=p.barcode, sku=p.sku, is_active=p.is_active, is_available=p.is_available,
        daily_limit=p.daily_limit, sold_count=p.sold_count,
        sort_order=p.sort_order,
        category_name=getattr(p, "category_name", None),
        subcategory_name=getattr(p, "subcategory_name", None),
        printer_name=getattr(p, "printer_name", None),
        ingredients_count=getattr(p, "ingredients_count", 0),
        stock=getattr(p, "stock", None),
        ingredients=[
            ProductIngredientResponse(
                ingredient_id=line.ingredient_id,
                ingredient_name=line.ingredient.name if line.ingredient else "",
                quantity=line.quantity,
                unit=line.ingredient.unit if line.ingredient else "",
            )
            for line in p.ingredients
        ],
        modifier_groups=[
            _group_to_response(g)
            for g in sorted(p.modifier_groups, key=lambda g: (g.sort_order, g.created_at))
        ],
    )


@router.post("/categories", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(data: CategoryCreate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    return await CategoryService(db).create(user.company_id, data)


@router.get("/categories", response_model=list[CategoryResponse])
async def list_categories(user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await CategoryService(db).list(user.company_id)


@router.post("/products", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(data: ProductCreate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    return _product_to_response(await ProductService(db).create(user.company_id, data))


@router.get("/products", response_model=list[ProductResponse])
async def list_products(
    include_all: bool = Query(False),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    svc = ProductService(db)
    products = await (svc.list_all(user.company_id) if include_all else svc.list(user.company_id))
    return [_product_to_response(p) for p in products]


@router.get("/products/{product_id}", response_model=ProductResponse)
async def get_product(product_id: UUID, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return _product_to_response(await ProductService(db).get(user.company_id, product_id))


@router.patch("/products/{product_id}", response_model=ProductResponse)
async def update_product(product_id: UUID, data: ProductUpdate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    return _product_to_response(await ProductService(db).update(user.company_id, product_id, data))


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
    return _product_to_response(await ProductService(db).update_image(user.company_id, product_id, image_url))


@router.patch("/products/{product_id}/availability", response_model=ProductResponse)
async def set_product_availability(
    product_id: UUID,
    data: ProductAvailabilityUpdate,
    user: User = Depends(require_stop_list_editor),
    db: AsyncSession = Depends(get_db),
):
    """Стоп-лист: снять/вернуть блюдо в продажу. Доступно только кассиру.

    Узкий эндпоинт правит ТОЛЬКО is_available — в отличие от админского
    PATCH /products/{id}, который меняет любые поля блюда. Так кассир управляет
    стоп-листом с десктопа, но не может трогать цены/названия.
    """
    return _product_to_response(await ProductService(db).set_availability(
        user.company_id, product_id, data.is_available
    ))


@router.patch("/products/{product_id}/limit", response_model=ProductResponse)
async def set_product_daily_limit(
    product_id: UUID,
    data: ProductLimitUpdate,
    user: User = Depends(require_stop_list_editor),
    db: AsyncSession = Depends(get_db),
):
    """D3 «максимум блюда»: задать дневной лимит порций (или снять — null).

    Тот же гейт, что у стоп-листа (кассир/повар/владелец/админ): задание числа
    обнуляет счётчик и возвращает блюдо в продажу; при достижении лимита в ходе
    продаж блюдо авто-встаёт в стоп. Так повар/кассир регулируют «максимум»
    с десктопа, не трогая цену/название.
    """
    return _product_to_response(await ProductService(db).set_daily_limit(
        user.company_id, product_id, data.daily_limit
    ))


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: UUID, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    await ProductService(db).delete(user.company_id, product_id)


# --- Добавки (модификаторы) блюда ---------------------------------------------
# Группы добавок настраиваются в веб-админке (владелец/админ). Чтение доступно
# любому сотруднику компании — десктоп-касса тянет их вместе с блюдом.

@router.get("/products/{product_id}/modifier-groups", response_model=list[ModifierGroupResponse])
async def list_modifier_groups(
    product_id: UUID,
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    groups = await ModifierGroupService(db).list_for_product(user.company_id, product_id)
    return [_group_to_response(g) for g in groups]


@router.post("/modifier-groups", response_model=ModifierGroupResponse, status_code=status.HTTP_201_CREATED)
async def create_modifier_group(
    data: ModifierGroupCreate,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return _group_to_response(await ModifierGroupService(db).create(user.company_id, data))


@router.patch("/modifier-groups/{group_id}", response_model=ModifierGroupResponse)
async def update_modifier_group(
    group_id: UUID,
    data: ModifierGroupUpdate,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return _group_to_response(await ModifierGroupService(db).update(user.company_id, group_id, data))


@router.delete("/modifier-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_modifier_group(
    group_id: UUID,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    await ModifierGroupService(db).delete(user.company_id, group_id)


@router.post("/ingredients", response_model=IngredientResponse, status_code=status.HTTP_201_CREATED)
async def create_ingredient(data: IngredientCreate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    """BE-10 dependency: IngredientCreate existed as a schema but was never
    wired to any endpoint — there was no way to create an Ingredient row
    through the API at all, which also blocked semi-product composition
    from being usable end-to-end."""
    return await IngredientService(db).create(user.company_id, data)


@router.get("/ingredients", response_model=list[IngredientResponse])
async def list_ingredients(user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await IngredientService(db).list(user.company_id)


@router.get("/ingredients/{ingredient_id}", response_model=IngredientResponse)
async def get_ingredient(ingredient_id: UUID, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await IngredientService(db).get(user.company_id, ingredient_id)


@router.patch("/ingredients/{ingredient_id}", response_model=IngredientResponse)
async def update_ingredient(ingredient_id: UUID, data: IngredientUpdate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    return await IngredientService(db).update(user.company_id, ingredient_id, data)


@router.get("/stock", response_model=list[StockItemResponse])
async def get_stock(
    warehouse_id: UUID | None = Query(None),
    low_stock: bool = Query(False),
    user: User = Depends(require_permission("inventory:stock:read")),
    db: AsyncSession = Depends(get_db),
):
    svc = StockService(db)
    if low_stock:
        return await svc.get_low_stock(user.company_id)
    return await svc.get_stock(user.company_id, warehouse_id)


@router.post("/stock/movements", response_model=StockMovementResponse, status_code=status.HTTP_201_CREATED)
async def create_movement(
    data: StockMovementCreate,
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    return await StockService(db).create_movement(user.company_id, user.id, data)

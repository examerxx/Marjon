"""Warehouse document endpoints — CRUD for warehouses, purchases, transfers, inventory, write-offs."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select, func, desc, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import require_company_app_user, effective_branch_filter
from app.modules.auth.models import User
from app.modules.companies.models import Branch
from app.modules.rbac.dependencies import require_permission
from app.modules.inventory.models import Category, Ingredient, Product, ProductIngredient, StockItem, StockMovement, Warehouse
from app.modules.inventory.warehouse_models import (
    PurchaseDocument, PurchaseDocumentItem,
    TransferDocument, InventoryCheck, InventoryCheckItem, WriteOffDocument,
    ExpenseDocument, ExpenseDocumentItem, WasteDocument,
)
from app.modules.inventory.loss import calc_waste_quantity, loss_label
from app.modules.inventory.fifo import consume_fifo
from app.modules.inventory.warehouse_schemas import (
    WarehouseCreate, WarehouseResponse, WarehouseUpdate,
    PurchaseDocumentCreate, PurchaseDocumentUpdate, PurchaseDocumentResponse,
    PurchaseDocumentDetailResponse,
    TransferCreate, TransferResponse,
    InventoryCheckCreate, InventoryCheckUpdate, InventoryCheckResponse,
    InventoryCheckDetailResponse,
    WriteOffCreate, WriteOffResponse,
    ExpenseDocumentCreate, ExpenseDocumentUpdate, ExpenseDocumentResponse,
    ExpenseDocumentDetailResponse,
    WasteDocumentCreate, WasteDocumentUpdate, WasteDocumentResponse,
)
from app.modules.finance.models import Counterparty, FinTransaction, PaymentType, TransactionCategory
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError
from app.shared.tenant_scope import require_company_resource, require_company_resource_ids

router = APIRouter(prefix="/warehouse", tags=["warehouse"])


# ── Helpers ──────────────────────────────────────────────────
def _now() -> str:
    return datetime.utcnow().strftime("%d.%m.%Y / %H:%M")


async def _allowed_warehouse_ids(db, user):
    """Набор складов филиала для branch-сессии; None — владелец сети (без скоупа)."""
    branch_scope = effective_branch_filter(user)
    if branch_scope is None:
        return None
    from sqlalchemy import select as _select
    result = await db.execute(_select(Warehouse.id).where(Warehouse.company_id == user.company_id, Warehouse.branch_id == branch_scope))
    return {row[0] for row in result.all()}


async def _ensure_branch_warehouse(db, warehouse_id, user) -> None:
    branch_scope = effective_branch_filter(user)
    if branch_scope is None or warehouse_id is None:
        return
    wh = await db.get(Warehouse, warehouse_id)
    if not wh or wh.company_id != user.company_id or wh.branch_id != branch_scope:
        from app.shared.exceptions import NotFoundError as _NF
        raise _NF("Warehouse not found")


def _user_display(user: User) -> str:
    name = getattr(user, "name", None) or ""
    if name:
        return name
    # CASHIER-EMAIL-OPTIONAL-01: staff accounts may carry email None.
    local = (getattr(user, "email", None) or "").split("@")[0]
    return local.upper() if local else "—"


async def _next_doc_number(db: AsyncSession, company_id: UUID, model) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(model.number), 0))
        .where(model.company_id == company_id)
    )
    return (result.scalar_one() or 0) + 1


async def _provision_ingredient_for_product(
    db: AsyncSession,
    company_id: UUID,
    product: Product,
    category_names: dict,
) -> Ingredient:
    """Найти или создать шаблон (Ingredient) под Товар (реализация).

    Складской учёт keyed by ingredient_id, поэтому у Товара должен быть свой
    шаблон: 1) переиспользуем шаблон из прошлого прихода этого Товара
    (связь — product_id на строках), 2) иначе совпадающий по имени/ед.изм,
    3) иначе создаём из карточки Товара. Без дублей на повторных приходах.
    """
    hist = await db.execute(
        select(PurchaseDocumentItem.ingredient_id)
        .join(PurchaseDocument, PurchaseDocument.id == PurchaseDocumentItem.document_id)
        .where(
            PurchaseDocument.company_id == company_id,
            PurchaseDocumentItem.product_id == product.id,
            PurchaseDocumentItem.ingredient_id.is_not(None),
        )
        .order_by(desc(PurchaseDocumentItem.created_at), desc(PurchaseDocumentItem.id))
        .limit(1)
    )
    known_id = hist.scalar_one_or_none()
    if known_id is not None:
        known = (
            await db.execute(
                select(Ingredient).where(
                    Ingredient.id == known_id,
                    Ingredient.company_id == company_id,
                )
            )
        ).scalar_one_or_none()
        if known is not None:
            return known
    same = (
        await db.execute(
            select(Ingredient).where(
                Ingredient.company_id == company_id,
                Ingredient.name == product.name,
                Ingredient.unit == product.unit,
            ).limit(1)
        )
    ).scalar_one_or_none()
    if same is not None:
        return same
    ingredient = Ingredient(
        company_id=company_id,
        name=product.name,
        unit=product.unit,
        category=category_names.get(product.category_id),
    )
    db.add(ingredient)
    await db.flush()
    return ingredient


async def _apply_purchase_to_stock(
    db: AsyncSession,
    company_id: UUID,
    user_id: UUID | None,
    doc: PurchaseDocument,
) -> None:
    """Оприходовать строки документа: FIFO-партия + StockItem пересчёт
    + StockMovement purchase на каждую строку. Вызывается из создания
    (документ сразу проведён) и из legacy-PATCH accept (идемпотентно через
    accepted_at у вызывателя)."""
    from app.modules.inventory.fifo import add_fifo_batch

    for item in doc.items:
        stock_result = await db.execute(
            select(StockItem).where(
                StockItem.company_id == company_id,
                StockItem.warehouse_id == doc.warehouse_id,
                StockItem.ingredient_id == item.ingredient_id,
            )
        )
        stock = stock_result.scalar_one_or_none()
        if stock is None:
            # Отрицательный остаток (продажи в минус) возможен — партия
            # покрывает его первой: recalc ниже сведёт qty/цену корректно.
            db.add(StockItem(
                company_id=company_id, warehouse_id=doc.warehouse_id,
                ingredient_id=item.ingredient_id, quantity=Decimal("0"),
                unit=item.unit, cost_price=Decimal("0"),
            ))
            await db.flush()
        await add_fifo_batch(
            db,
            company_id=company_id,
            warehouse_id=doc.warehouse_id,
            ingredient_id=item.ingredient_id,
            quantity=item.quantity,
            cost_price=item.cost_price,
            unit=item.unit,
            purchase_doc_id=doc.id,
        )
        db.add(StockMovement(
            company_id=company_id, warehouse_id=doc.warehouse_id,
            ingredient_id=item.ingredient_id, movement_type="purchase",
            quantity=item.quantity, unit=item.unit, cost_price=item.cost_price,
            total_cost=item.total, ref_id=doc.id, created_by=user_id,
            note=f"Приход №{doc.number}" + (f" от {doc.supplier}" if doc.supplier else ""),
        ))


# ── Warehouses ───────────────────────────────────────────────
@router.get("/list", response_model=list[WarehouseResponse])
async def list_warehouses(
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Warehouse).where(Warehouse.company_id == user.company_id)
    )
    warehouses = list(result.scalars().all())
    # Branch-изоляция: филиалу — только склады его филиала.
    branch_scope = effective_branch_filter(user)
    if branch_scope is not None:
        warehouses = [w for w in warehouses if w.branch_id == branch_scope]
    return warehouses


@router.post("/list", response_model=WarehouseResponse, status_code=status.HTTP_201_CREATED)
async def create_warehouse(
    data: WarehouseCreate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely. BI-06 deliberately removes this
    # deferred Inventory/Warehouse capability from the frozen Web OWNER.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    await require_company_resource(
        db, Branch, data.branch_id, user.company_id, detail="Branch not found"
    )
    wh = Warehouse(company_id=user.company_id, **data.model_dump())
    db.add(wh)
    await db.commit()
    await db.refresh(wh)
    return wh


@router.patch("/list/{warehouse_id}", response_model=WarehouseResponse)
async def update_warehouse(
    warehouse_id: UUID,
    data: WarehouseUpdate,
    # BE-05: same stock:write gate as the other warehouse mutations.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Warehouse).where(
            Warehouse.id == warehouse_id,
            Warehouse.company_id == user.company_id,
        )
    )
    wh = result.scalar_one_or_none()
    if wh is None:
        raise NotFoundError("Warehouse not found")
    payload = data.model_dump(exclude_unset=True)
    if payload.get("branch_id") is not None:
        await require_company_resource(
            db, Branch, payload["branch_id"], user.company_id, detail="Branch not found"
        )
    if payload.get("is_main") is True:
        await db.execute(
            update(Warehouse)
            .where(Warehouse.company_id == user.company_id, Warehouse.id != wh.id)
            .values(is_main=False)
        )
    for key, value in payload.items():
        setattr(wh, key, value)
    await db.commit()
    await db.refresh(wh)
    return wh


@router.delete("/list/{warehouse_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_warehouse(
    warehouse_id: UUID,
    # BE-05: same stock:write gate as the other warehouse mutations.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Warehouse).where(
            Warehouse.id == warehouse_id,
            Warehouse.company_id == user.company_id,
        )
    )
    wh = result.scalar_one_or_none()
    if wh is None:
        raise NotFoundError("Warehouse not found")
    for label, stmt in (
        ("остатки", select(StockItem.id).where(
            StockItem.company_id == user.company_id,
            StockItem.warehouse_id == wh.id,
        ).limit(1)),
        ("движения", select(StockMovement.id).where(
            StockMovement.company_id == user.company_id,
            StockMovement.warehouse_id == wh.id,
        ).limit(1)),
        ("рецепты", select(ProductIngredient.id).where(
            ProductIngredient.warehouse_id == wh.id,
        ).limit(1)),
    ):
        used = await db.execute(stmt)
        if used.scalar_one_or_none() is not None:
            raise ConflictError(f"Склад используется: {label}")
    await db.delete(wh)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ConflictError("Склад используется в документах")
    return None


# ── Purchase Documents (Приходы) ─────────────────────────────
@router.get("/purchases", response_model=list[PurchaseDocumentResponse])
async def list_purchases(
    search: str = Query("", alias="q"),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    branch_scope = effective_branch_filter(user)
    allowed_ids = await _allowed_warehouse_ids(db, user) if branch_scope is not None else None
    query = (
        select(PurchaseDocument)
        .where(PurchaseDocument.company_id == user.company_id)
        .order_by(desc(PurchaseDocument.created_at))
    )
    if allowed_ids is not None:
        query = query.where(PurchaseDocument.warehouse_id.in_(allowed_ids))
    if search:
        like = f"%{search}%"
        query = query.where(
            PurchaseDocument.supplier.ilike(like)
            | PurchaseDocument.warehouse_name.ilike(like)
            | PurchaseDocument.created_by_name.ilike(like)
        )
    result = await db.execute(query)
    docs = list(result.scalars().all())
    # Старые документы создавались без warehouse_name (фронт слал только id) —
    # подставляем каноническое имя, чтобы список не показывал "—".
    missing_ids = {d.warehouse_id for d in docs if not d.warehouse_name and d.warehouse_id}
    if missing_ids:
        wh_rows = (
            await db.execute(
                select(Warehouse).where(
                    Warehouse.id.in_(missing_ids),
                    Warehouse.company_id == user.company_id,
                )
            )
        ).scalars().all()
        names = {w.id: w.name for w in wh_rows}
        for d in docs:
            if not d.warehouse_name and d.warehouse_id in names:
                d.warehouse_name = names[d.warehouse_id]
    return docs


# Пакетная выдача состава документов. Экраны склада просят детали сразу для
# всего списка (деление Продукт/Товар, суммы по категориям), и поштучные
# GET /purchases/{id} давали до 60 параллельных запросов на каждое открытие
# раздела — всплеск в очередь backend/БД. Один запрос вместо N.
# Объявлен ДО /purchases/{doc_id}: иначе «details» попал бы в doc_id.
_PURCHASE_DETAILS_MAX = 200


def _parse_doc_ids(ids: str) -> list[UUID]:
    """Список id из query-строки через запятую: без дублей, с проверкой формы."""
    doc_ids: list[UUID] = []
    seen: set[UUID] = set()
    for raw in ids.split(","):
        chunk = raw.strip()
        if not chunk:
            continue
        try:
            parsed = UUID(chunk)
        except ValueError:
            raise ValidationError("Некорректный идентификатор документа")
        if parsed not in seen:
            seen.add(parsed)
            doc_ids.append(parsed)
    if len(doc_ids) > _PURCHASE_DETAILS_MAX:
        raise ValidationError(
            f"За один запрос можно получить не более {_PURCHASE_DETAILS_MAX} документов"
        )
    return doc_ids


@router.get("/purchases/details", response_model=list[PurchaseDocumentDetailResponse])
async def list_purchase_details(
    ids: str = Query("", description="Идентификаторы документов через запятую"),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    doc_ids = _parse_doc_ids(ids)
    if not doc_ids:
        return []

    query = (
        select(PurchaseDocument)
        .options(selectinload(PurchaseDocument.items))
        .where(
            PurchaseDocument.company_id == user.company_id,
            PurchaseDocument.id.in_(doc_ids),
        )
    )
    # Branch-изоляция та же, что у списка: чужой филиал не видит документ
    # даже по прямому id (он просто не попадёт в ответ).
    if effective_branch_filter(user) is not None:
        query = query.where(PurchaseDocument.warehouse_id.in_(await _allowed_warehouse_ids(db, user)))
    docs = list((await db.execute(query)).scalars().all())

    # Старые документы создавались без warehouse_name — подставляем каноническое
    # имя одним запросом, как в списке.
    missing_ids = {d.warehouse_id for d in docs if not d.warehouse_name and d.warehouse_id}
    if missing_ids:
        wh_rows = (
            await db.execute(
                select(Warehouse).where(
                    Warehouse.id.in_(missing_ids),
                    Warehouse.company_id == user.company_id,
                )
            )
        ).scalars().all()
        names = {w.id: w.name for w in wh_rows}
        for d in docs:
            if not d.warehouse_name and d.warehouse_id in names:
                d.warehouse_name = names[d.warehouse_id]
    return docs


@router.get("/purchases/{doc_id}", response_model=PurchaseDocumentDetailResponse)
async def get_purchase(
    doc_id: UUID,
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PurchaseDocument)
        .options(selectinload(PurchaseDocument.items))
        .where(
            PurchaseDocument.id == doc_id,
            PurchaseDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Purchase document not found")
    await _ensure_branch_warehouse(db, doc.warehouse_id, user)
    if not doc.warehouse_name and doc.warehouse_id:
        wh = (
            await db.execute(
                select(Warehouse).where(
                    Warehouse.id == doc.warehouse_id,
                    Warehouse.company_id == user.company_id,
                )
            )
        ).scalar_one_or_none()
        if wh:
            doc.warehouse_name = wh.name
    return doc


@router.post("/purchases", response_model=PurchaseDocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_purchase(
    data: PurchaseDocumentCreate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely. Web OWNER is intentionally absent.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    warehouse = await require_company_resource(
        db, Warehouse, data.warehouse_id, user.company_id, detail="Warehouse not found"
    )
    await _ensure_branch_warehouse(db, data.warehouse_id, user)
    # Приход — это оприходование ШАБЛОНОВ из «Продуктов»: каждая позиция обязана
    # ссылаться на шаблон (ingredient_id) либо на Товар (product_id — шаблон
    # backend автопривяжет ниже) и нести количество и цену. Без них
    # остаток/себестоимость посчитать не из чего — такие документы отклоняем.
    if not data.items:
        raise ValidationError("Добавьте хотя бы одну позицию: приход без продуктов невозможен.")
    for item in data.items:
        if item.ingredient_id is None and item.product_id is None:
            raise ValidationError("Каждая позиция прихода должна ссылаться на шаблон из «Продуктов» или на Товар.")
        if item.quantity <= 0:
            raise ValidationError("Укажите количество для каждой позиции: без количества оприходовать нельзя.")
        if item.cost_price <= 0:
            raise ValidationError("Укажите цену для каждой позиции: без цены оприходовать нельзя.")
    await require_company_resource_ids(
        db,
        Ingredient,
        (item.ingredient_id for item in data.items),
        user.company_id,
        detail="Ingredient not found",
    )
    product_ids = {item.product_id for item in data.items if item.product_id is not None}
    products: dict = {}
    if product_ids:
        await require_company_resource_ids(
            db,
            Product,
            product_ids,
            user.company_id,
            detail="Product not found",
        )
        product_rows = (
            await db.execute(
                select(Product).where(
                    Product.id.in_(product_ids),
                    Product.company_id == user.company_id,
                )
            )
        ).scalars().all()
        products = {p.id: p for p in product_rows}
        for product in products.values():
            if (product.product_type or "dish") != "sale":
                raise ValidationError(
                    f"Оприходовать можно только Товары (реализация): «{product.name}» — не Товар."
                )
    # Товар без шаблона: находим или создаём шаблон под него, чтобы проведение
    # считало остаток/себестоимость из движений как обычно. Повторные приходы
    # того же Товара переиспользуют его шаблон (без дублей).
    category_names: dict = {}
    if products:
        cat_ids = {p.category_id for p in products.values() if p.category_id}
        if cat_ids:
            cat_rows = (
                await db.execute(
                    select(Category.id, Category.name).where(
                        Category.id.in_(cat_ids),
                        Category.company_id == user.company_id,
                    )
                )
            ).all()
            category_names = dict(cat_rows)
    provisioned: dict = {}
    linked_ingredient_ids: list = []
    for item in data.items:
        if item.ingredient_id is not None:
            linked_ingredient_ids.append(item.ingredient_id)
        else:
            product = products[item.product_id]
            if product.id not in provisioned:
                provisioned[product.id] = await _provision_ingredient_for_product(
                    db, user.company_id, product, category_names
                )
            linked_ingredient_ids.append(provisioned[product.id].id)
    # Канонические названия/ед.изм — из шаблонов, клиентский снапшот не доверяем.
    template_rows = (
        await db.execute(
            select(Ingredient).where(
                Ingredient.id.in_(set(linked_ingredient_ids)),
                Ingredient.company_id == user.company_id,
            )
        )
    ).scalars().all()
    templates = {ing.id: ing for ing in template_rows}
    number = await _next_doc_number(db, user.company_id, PurchaseDocument)
    now = _now()
    total = sum(item.quantity * item.cost_price for item in data.items)
    supplier_name = (data.supplier or "").strip()
    if data.payment_mode == "credit":
        # На потом: сумма станет долгом перед поставщиком (кредиторка) — без поставщика
        # непонятно, кому должны.
        if not supplier_name:
            raise ValidationError("Выберите поставщика: оплата «на потом» записывается как долг перед ним.")
        if await _find_supplier(db, user.company_id, supplier_name) is None:
            raise ValidationError("Поставщик не найден в справочнике контрагентов — сначала добавьте его.")
    payment_type = None
    if data.payment_mode == "paid" and data.payment_type_id is not None:
        payment_type = await db.scalar(select(PaymentType).where(
            PaymentType.id == data.payment_type_id,
            (PaymentType.company_id == user.company_id) | (PaymentType.scope_kind == "system"),
        ))
        if payment_type is None:
            raise ValidationError("Тип оплаты не найден.")

    # Черновиков больше нет: «Сохранить» = сразу «Принято». Остатки двигаем
    # тут же, атомарно с созданием (PATCH accept оставлен только для старых
    # черновиков и идемпотентен через accepted_at).
    doc = PurchaseDocument(
        company_id=user.company_id,
        number=number,
        supplier=data.supplier,
        warehouse_id=data.warehouse_id,
        warehouse_name=data.warehouse_name or (warehouse.name if warehouse else None),
        date=data.date,
        registered_at=now,
        accepted_at=now,
        items_count=len(data.items),
        total_amount=total,
        status="accepted",
        created_by=user.id,
        created_by_name=_user_display(user),
        note=data.note,
        payment_mode=data.payment_mode,
        payment_type_id=payment_type.id if payment_type else None,
    )

    for item_data, ingredient_id in zip(data.items, linked_ingredient_ids):
        template = templates[ingredient_id]
        item_total = item_data.quantity * item_data.cost_price
        doc.items.append(PurchaseDocumentItem(
            name=template.name,
            ingredient_id=ingredient_id,
            product_id=item_data.product_id,
            quantity=item_data.quantity,
            unit=template.unit,
            cost_price=item_data.cost_price,
            total=item_total,
        ))

    db.add(doc)
    await db.flush()
    if doc.warehouse_id:
        await _apply_purchase_to_stock(db, user.company_id, user.id, doc)
    if data.payment_mode == "paid" and total > 0:
        # Оплачено сразу — денежный расход (Финансы → Операции). Поставщика в операцию не
        # привязываем: любой расход с контрагентом отчёт «Дебиторы и кредиторы» считает
        # кредиторкой, а тут деньги уже уплачены. Кто и за что — в комментарии.
        tx = FinTransaction(
            company_id=user.company_id,
            amount=total,
            direction="expense",
            payment_type_id=payment_type.id if payment_type else None,
            category_id=await _purchase_expense_category_id(db, user.company_id),
            comment=f"Приход № {number}" + (f" · {supplier_name}" if supplier_name else ""),
            user_id=user.id,
        )
        db.add(tx)
        await db.flush()
        doc.finance_transaction_id = tx.id
    await db.commit()
    await db.refresh(doc)
    return doc


PURCHASE_EXPENSE_CATEGORY = "На продукты"


async def _purchase_expense_category_id(db: AsyncSession, company_id: UUID) -> UUID:
    """Категория денежного расхода для оплаченных приходов: «На продукты» (создаём, если нет)."""
    found = await db.scalar(select(TransactionCategory).where(
        TransactionCategory.company_id == company_id,
        TransactionCategory.scope_kind == "company",
        TransactionCategory.kind == "expense",
        func.lower(func.trim(TransactionCategory.name)) == PURCHASE_EXPENSE_CATEGORY.lower(),
    ))
    if found is not None:
        return found.id
    category = TransactionCategory(
        company_id=company_id, scope_kind="company", name=PURCHASE_EXPENSE_CATEGORY,
        kind="expense", status=True,
    )
    db.add(category)
    await db.flush()
    return category.id


async def _find_supplier(db: AsyncSession, company_id: UUID, name: str):
    """Поставщик из справочника контрагентов по имени (без учёта регистра, в том числе кириллицы)."""
    wanted = name.strip().casefold()
    rows = (await db.execute(select(Counterparty).where(
        Counterparty.company_id == company_id,
        Counterparty.scope_kind == "company",
        Counterparty.organization_id.is_(None),
        Counterparty.deleted_at.is_(None),
        Counterparty.type == "supplier",
    ))).scalars().all()
    return next((row for row in rows if (row.full_name or "").strip().casefold() == wanted), None)


@router.patch("/purchases/{doc_id}", response_model=PurchaseDocumentResponse)
async def update_purchase(
    doc_id: UUID,
    data: PurchaseDocumentUpdate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely. Web OWNER is intentionally absent.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PurchaseDocument)
        .options(selectinload(PurchaseDocument.items))
        .where(
            PurchaseDocument.id == doc_id,
            PurchaseDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Purchase document not found")

    checked_warehouse = await require_company_resource(
        db, Warehouse, data.warehouse_id, user.company_id, detail="Warehouse not found"
    )

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(doc, field, value)

    # Название склада держим синхронным с id: сменили склад, а имя явно
    # не передали — подтягиваем каноническое, иначе список кажет "—".
    if data.warehouse_id is not None and data.warehouse_name is None and checked_warehouse:
        doc.warehouse_name = checked_warehouse.name

    if data.status == "accepted" and not doc.accepted_at:
        await require_company_resource(
            db, Warehouse, doc.warehouse_id, user.company_id, detail="Warehouse not found"
        )
        await require_company_resource_ids(
            db,
            Ingredient,
            (item.ingredient_id for item in doc.items),
            user.company_id,
            detail="Ingredient not found",
        )
        # BE-18: accepting a purchase previously had ZERO effect on stock —
        # this just stamped a timestamp. The entire "purchases" document
        # trail was disconnected from real inventory levels; StockItem
        # never moved no matter how many purchase documents got accepted.
        # Guarded by `not doc.accepted_at` (already true above) so
        # re-accepting an already-accepted document is a no-op instead of
        # double-adding stock — this is the idempotency the spec asks for
        # on operations that affect остатки.
        # Строгая проверка как при создании: провести можно только позиции с
        # шаблоном, количеством и ценой. Старые документы со строками без
        # шаблона (созданы до разделения шаблон/приход) здесь честно
        # отклоняются, а не проводятся молча наполовину.
        for item in doc.items:
            if item.ingredient_id is None:
                raise ValidationError("Документ содержит позицию без шаблона из «Продуктов» — проведение невозможно.")
            if item.quantity <= 0:
                raise ValidationError("Документ содержит позицию без количества — проведение невозможно.")
            if item.cost_price <= 0:
                raise ValidationError("Документ содержит позицию без цены — проведение невозможно.")
        if doc.warehouse_id:
            await _apply_purchase_to_stock(db, user.company_id, user.id, doc)
        doc.accepted_at = _now()

    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/purchases/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_purchase(
    doc_id: UUID,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely. Web OWNER is intentionally absent.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PurchaseDocument).where(
            PurchaseDocument.id == doc_id,
            PurchaseDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Purchase document not found")
    await db.delete(doc)
    await db.commit()


# ── Transfers ────────────────────────────────────────────────
@router.get("/transfers", response_model=list[TransferResponse])
async def list_transfers(
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    branch_scope = effective_branch_filter(user)
    allowed_ids = await _allowed_warehouse_ids(db, user) if branch_scope is not None else None
    query = select(TransferDocument).where(TransferDocument.company_id == user.company_id).order_by(desc(TransferDocument.created_at))
    if allowed_ids is not None:
        query = query.where(TransferDocument.from_warehouse_id.in_(allowed_ids) | TransferDocument.to_warehouse_id.in_(allowed_ids))
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("/transfers", response_model=TransferResponse, status_code=status.HTTP_201_CREATED)
async def create_transfer(
    data: TransferCreate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely. Web OWNER is intentionally absent.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    await require_company_resource_ids(
        db,
        Warehouse,
        (data.from_warehouse_id, data.to_warehouse_id),
        user.company_id,
        detail="Warehouse not found",
    )
    await _ensure_branch_warehouse(db, data.from_warehouse_id, user)
    await _ensure_branch_warehouse(db, data.to_warehouse_id, user)
    doc = TransferDocument(
        company_id=user.company_id,
        created_by=user.id,
        created_by_name=_user_display(user),
        **data.model_dump(),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/transfers/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transfer(
    doc_id: UUID,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely. Web OWNER is intentionally absent.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TransferDocument).where(
            TransferDocument.id == doc_id,
            TransferDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Transfer document not found")
    await db.delete(doc)
    await db.commit()


# ── Inventory Checks ─────────────────────────────────────────
@router.get("/inventory-checks", response_model=list[InventoryCheckResponse])
async def list_inventory_checks(
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    branch_scope = effective_branch_filter(user)
    allowed_ids = await _allowed_warehouse_ids(db, user) if branch_scope is not None else None
    query = select(InventoryCheck).where(InventoryCheck.company_id == user.company_id).order_by(desc(InventoryCheck.created_at))
    if allowed_ids is not None:
        query = query.where(InventoryCheck.warehouse_id.in_(allowed_ids))
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("/inventory-checks", response_model=InventoryCheckDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_inventory_check(
    data: InventoryCheckCreate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely. Web OWNER is intentionally absent.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    """Создать инвентаризацию: снапшот остатков + факт + корректировка.

    V42: позиции items — посчитанный факт (actual_qty) по шаблонам/Товарам.
    diff = actual − stock: > 0 — излишек → документ прихода (проведён сразу,
    остатки += diff, виден в «Приходе товаров»), < 0 — недостача → документ
    расхода (проведён сразу, остатки −= |diff|, виден в «Расходе товаров»),
    = 0 — только запись в проверке. Проведённая проверка всегда «accepted»,
    даже если всё сошлось. apply_to_stock=False — только шапка
    (статус draft), остатки и документы не трогаем. Всё атомарно.
    """
    warehouse = await require_company_resource(
        db, Warehouse, data.warehouse_id, user.company_id, detail="Warehouse not found"
    )
    await _ensure_branch_warehouse(db, data.warehouse_id, user)
    if data.items and data.warehouse_id is None:
        raise ValidationError("Выберите склад: без склада посчитать расхождения нельзя.")
    for item in data.items:
        if item.ingredient_id is None and item.product_id is None:
            raise ValidationError("Каждая позиция должна ссылаться на шаблон из «Продуктов» или на Товар.")
        if item.actual_qty is None:
            raise ValidationError("Укажите фактическое количество для каждой позиции.")
    await require_company_resource_ids(
        db, Ingredient,
        (item.ingredient_id for item in data.items),
        user.company_id, detail="Ingredient not found",
    )
    product_ids = {item.product_id for item in data.items if item.product_id is not None}
    products: dict = {}
    if product_ids:
        await require_company_resource_ids(
            db, Product, product_ids, user.company_id, detail="Product not found",
        )
        product_rows = (
            await db.execute(
                select(Product).where(
                    Product.id.in_(product_ids),
                    Product.company_id == user.company_id,
                )
            )
        ).scalars().all()
        products = {p.id: p for p in product_rows}
    category_names: dict = {}
    if products:
        cat_ids = {p.category_id for p in products.values() if p.category_id}
        if cat_ids:
            cat_rows = (
                await db.execute(
                    select(Category.id, Category.name).where(
                        Category.id.in_(cat_ids),
                        Category.company_id == user.company_id,
                    )
                )
            ).all()
            category_names = dict(cat_rows)
    # Привязка строк к шаблонам (как в приходе) + снапшот остатков/цен.
    linked: list = []
    for item in data.items:
        if item.ingredient_id is not None:
            template = (
                await db.execute(
                    select(Ingredient).where(
                        Ingredient.id == item.ingredient_id,
                        Ingredient.company_id == user.company_id,
                    )
                )
            ).scalar_one_or_none()
            if template is None:
                raise ValidationError("Ingredient not found")
            ingredient_id = template.id
        else:
            product = products[item.product_id]
            template = await _provision_ingredient_for_product(
                db, user.company_id, product, category_names
            )
            ingredient_id = template.id
        stock_row = None
        if data.warehouse_id is not None:
            stock_row = (
                await db.execute(
                    select(StockItem).where(
                        StockItem.company_id == user.company_id,
                        StockItem.warehouse_id == data.warehouse_id,
                        StockItem.ingredient_id == ingredient_id,
                    )
                )
            ).scalar_one_or_none()
        stock_qty = stock_row.quantity if stock_row else Decimal("0")
        cost = stock_row.cost_price if stock_row else Decimal("0")
        actual = Decimal(str(item.actual_qty))
        linked.append({
            "ingredient_id": ingredient_id,
            "product_id": item.product_id,
            "name": template.name,
            "unit": template.unit,
            "stock_qty": stock_qty,
            "actual_qty": actual,
            "diff_qty": actual - stock_qty,
            "cost_price": cost,
        })
    now = _now()
    # Проверка проведена (склад выбран, учёт включён) — статус всегда
    # "accepted", даже если всё сошлось: расхождений нет, двигать нечего.
    # Автодокументы создаём только при ненулевых расхождениях.
    conducted = bool(data.apply_to_stock and data.warehouse_id is not None)
    has_diffs = any(line["diff_qty"] != 0 for line in linked)
    doc = InventoryCheck(
        company_id=user.company_id,
        warehouse_id=data.warehouse_id,
        warehouse_name=data.warehouse_name or (warehouse.name if warehouse else None),
        comment=data.comment,
        check_type=data.check_type,
        status="accepted" if conducted else "draft",
        created_by=user.id,
        created_by_name=_user_display(user),
    )
    db.add(doc)
    # Позиции цепляем ДО flush: доступ к doc.items после flush дёргает
    # ленивую загрузку и в async-контексте даёт MissingGreenlet.
    for line in linked:
        doc.items.append(InventoryCheckItem(
            ingredient_id=line["ingredient_id"],
            product_id=line["product_id"],
            name=line["name"],
            unit=line["unit"],
            stock_qty=line["stock_qty"],
            actual_qty=line["actual_qty"],
            diff_qty=line["diff_qty"],
            cost_price=line["cost_price"],
        ))
    await db.flush()
    purchase_number: int | None = None
    expense_number: int | None = None
    if conducted and has_diffs:
        surplus = [line for line in linked if line["diff_qty"] > 0]
        shortage = [line for line in linked if line["diff_qty"] < 0]
        if surplus:
            purchase_number = await _next_doc_number(db, user.company_id, PurchaseDocument)
            purchase = PurchaseDocument(
                company_id=user.company_id,
                number=purchase_number,
                supplier="Инвентаризация",
                warehouse_id=data.warehouse_id,
                warehouse_name=doc.warehouse_name,
                registered_at=now,
                accepted_at=now,
                items_count=len(surplus),
                total_amount=sum(line["diff_qty"] * line["cost_price"] for line in surplus),
                status="accepted",
                created_by=user.id,
                created_by_name=_user_display(user),
                note=f"Инвентаризация {doc.id}",
            )
            for line in surplus:
                purchase.items.append(PurchaseDocumentItem(
                    name=line["name"],
                    ingredient_id=line["ingredient_id"],
                    product_id=line["product_id"],
                    quantity=line["diff_qty"],
                    unit=line["unit"],
                    cost_price=line["cost_price"],
                    total=line["diff_qty"] * line["cost_price"],
                ))
            db.add(purchase)
            await db.flush()
            await _apply_purchase_to_stock(db, user.company_id, user.id, purchase)
            doc.purchase_doc_id = purchase.id
        if shortage:
            expense_number = await _next_doc_number(db, user.company_id, ExpenseDocument)
            expense = ExpenseDocument(
                company_id=user.company_id,
                number=expense_number,
                receiver="Инвентаризация",
                warehouse_id=data.warehouse_id,
                warehouse_name=doc.warehouse_name,
                registered_at=now,
                accepted_at=now,
                items_count=len(shortage),
                total_amount=sum(-line["diff_qty"] * line["cost_price"] for line in shortage),
                status="accepted",
                created_by=user.id,
                created_by_name=_user_display(user),
                note=f"Инвентаризация {doc.id}",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            for line in shortage:
                qty = -line["diff_qty"]
                expense.items.append(ExpenseDocumentItem(
                    name=line["name"],
                    ingredient_id=line["ingredient_id"],
                    quantity=qty,
                    unit=line["unit"],
                    cost_price=line["cost_price"],
                    total=qty * line["cost_price"],
                ))
            db.add(expense)
            await db.flush()
            # Недостача по инвентаризации может превышать остаток: это
            # пересчёт факта, а не расход «со склада». Раньше здесь стояла
            # жёсткая проверка _assert_sufficient_stock — из-за неё посчитать
            # минус было нельзя в принципе (владелец вводил отрицательный
            # факт и получал отказ). Теперь списываем ровно столько, сколько
            # реально лежит партиями (FIFO), а хвост недостачи уводит
            # StockItem.quantity в минус — то же состояние, что и
            # «исторический минус» от продаж без остатка (add_fifo_batch
            # закрывает его первым же приходом).
            for item in expense.items:
                stock_row = (
                    await db.execute(
                        select(StockItem).where(
                            StockItem.company_id == user.company_id,
                            StockItem.warehouse_id == data.warehouse_id,
                            StockItem.ingredient_id == item.ingredient_id,
                        )
                    )
                ).scalar_one_or_none()
                available = Decimal(str(stock_row.quantity)) if stock_row else Decimal("0")
                covered = min(item.quantity, available) if available > 0 else Decimal("0")
                fifo_unit = Decimal("0")
                fifo_total = Decimal("0")
                if covered > 0:
                    # V46 FIFO: недостача списывает старые партии первыми.
                    fifo_unit, fifo_total = await consume_fifo(
                        db,
                        company_id=user.company_id,
                        warehouse_id=data.warehouse_id,
                        ingredient_id=item.ingredient_id,
                        quantity=covered,
                        name=item.name,
                    )
                excess = item.quantity - covered
                if excess > 0:
                    # Под этот хвост партий нет — минус живёт в остатке.
                    if stock_row is None:
                        stock_row = StockItem(
                            company_id=user.company_id,
                            warehouse_id=data.warehouse_id,
                            ingredient_id=item.ingredient_id,
                            quantity=Decimal("0"),
                            unit=item.unit or "кг",
                        )
                        db.add(stock_row)
                        await db.flush()
                    stock_row.quantity = Decimal(str(stock_row.quantity or 0)) - excess
                item.cost_price = fifo_unit
                item.total = fifo_total
                db.add(StockMovement(
                    company_id=user.company_id, warehouse_id=data.warehouse_id,
                    ingredient_id=item.ingredient_id, movement_type="expense",
                    quantity=item.quantity, unit=item.unit, cost_price=fifo_unit,
                    total_cost=fifo_total, ref_id=expense.id, created_by=user.id,
                    note=f"Инвентаризация {doc.id}",
                ))
            expense.total_amount = sum(
                (i.total for i in expense.items), Decimal("0")
            )
            doc.expense_doc_id = expense.id
    await db.commit()
    # Позиции перечитываем с selectinload: ленивый доступ к doc.items после
    # commit/refresh в async-контексте даёт MissingGreenlet.
    result = await db.execute(
        select(InventoryCheck)
        .options(selectinload(InventoryCheck.items))
        .where(InventoryCheck.id == doc.id)
    )
    doc = result.scalar_one()
    return {
        **{c.name: getattr(doc, c.name) for c in doc.__table__.columns},
        "items": [
            {**{c.name: getattr(it, c.name) for c in it.__table__.columns}, "check_id": doc.id}
            for it in doc.items
        ],
        "purchase_doc_id": doc.purchase_doc_id,
        "purchase_doc_number": purchase_number,
        "expense_doc_id": doc.expense_doc_id,
        "expense_doc_number": expense_number,
    }


@router.get("/inventory-checks/{doc_id}", response_model=InventoryCheckDetailResponse)
async def get_inventory_check(
    doc_id: UUID,
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(InventoryCheck)
        .options(selectinload(InventoryCheck.items))
        .where(
            InventoryCheck.id == doc_id,
            InventoryCheck.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Inventory check not found")
    numbers: dict = {}
    for field, model in (("purchase_doc_id", PurchaseDocument), ("expense_doc_id", ExpenseDocument)):
        ref_id = getattr(doc, field)
        numbers[field] = None
        if ref_id is not None:
            row = (
                await db.execute(
                    select(model.number).where(
                        model.id == ref_id,
                        model.company_id == user.company_id,
                    )
                )
            ).scalar_one_or_none()
            numbers[field] = row
    return {
        **{c.name: getattr(doc, c.name) for c in doc.__table__.columns},
        "items": [
            {**{c.name: getattr(it, c.name) for c in it.__table__.columns}, "check_id": doc.id}
            for it in doc.items
        ],
        "purchase_doc_id": doc.purchase_doc_id,
        "purchase_doc_number": numbers["purchase_doc_id"],
        "expense_doc_id": doc.expense_doc_id,
        "expense_doc_number": numbers["expense_doc_id"],
    }


@router.patch("/inventory-checks/{doc_id}", response_model=InventoryCheckResponse)
async def update_inventory_check(
    doc_id: UUID,
    data: InventoryCheckUpdate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely. Web OWNER is intentionally absent.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(InventoryCheck).where(
            InventoryCheck.id == doc_id,
            InventoryCheck.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Inventory check not found")
    await require_company_resource(
        db, Warehouse, data.warehouse_id, user.company_id, detail="Warehouse not found"
    )
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(doc, field, value)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/inventory-checks/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_inventory_check(
    doc_id: UUID,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely. Web OWNER is intentionally absent.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(InventoryCheck).where(
            InventoryCheck.id == doc_id,
            InventoryCheck.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Inventory check not found")
    await db.delete(doc)
    await db.commit()


# ── Write-Offs ───────────────────────────────────────────────
@router.get("/write-offs", response_model=list[WriteOffResponse])
async def list_write_offs(
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    if effective_branch_filter(user) is not None:
        return []
    result = await db.execute(
        select(WriteOffDocument)
        .where(WriteOffDocument.company_id == user.company_id)
        .order_by(desc(WriteOffDocument.created_at))
    )
    return list(result.scalars().all())


@router.post("/write-offs", response_model=WriteOffResponse, status_code=status.HTTP_201_CREATED)
async def create_write_off(
    data: WriteOffCreate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely. Web OWNER is intentionally absent.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    doc = WriteOffDocument(
        company_id=user.company_id,
        created_by=user.id,
        created_by_name=_user_display(user),
        **data.model_dump(),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/write-offs/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_write_off(
    doc_id: UUID,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely. Web OWNER is intentionally absent.
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WriteOffDocument).where(
            WriteOffDocument.id == doc_id,
            WriteOffDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Write-off document not found")
    await db.delete(doc)
    await db.commit()


# ── Expense Documents (Расход) ───────────────────────────────
# Зеркалит приход, но проведение УМЕНЬШАЕТ остатки. Перед списанием
# проверяем достаточность остатка по каждой позиции (ValidationError 422),
# иначе ушли бы в минус. Идемпотентно через accepted_at.
async def _assert_sufficient_stock(db, company_id, warehouse_id, ingredient_id, name, needed):
    stock_result = await db.execute(
        select(StockItem).where(
            StockItem.company_id == company_id,
            StockItem.warehouse_id == warehouse_id,
            StockItem.ingredient_id == ingredient_id,
        )
    )
    stock = stock_result.scalar_one_or_none()
    available = stock.quantity if stock else 0
    if available < needed:
        raise ValidationError(
            f"Недостаточно остатка «{name}»: есть {available}, требуется {needed}."
        )
    return stock


@router.get("/expenses", response_model=list[ExpenseDocumentResponse])
async def list_expenses(
    search: str = Query("", alias="q"),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    branch_scope = effective_branch_filter(user)
    allowed_ids = await _allowed_warehouse_ids(db, user) if branch_scope is not None else None
    query = (
        select(ExpenseDocument)
        .where(ExpenseDocument.company_id == user.company_id)
        .order_by(desc(ExpenseDocument.created_at))
    )
    if allowed_ids is not None:
        query = query.where(ExpenseDocument.warehouse_id.in_(allowed_ids))
    if search:
        like = f"%{search}%"
        query = query.where(
            ExpenseDocument.receiver.ilike(like)
            | ExpenseDocument.warehouse_name.ilike(like)
            | ExpenseDocument.created_by_name.ilike(like)
        )
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/expenses/details", response_model=list[ExpenseDocumentDetailResponse])
async def list_expense_details(
    ids: str = Query("", description="Идентификаторы документов через запятую"),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Пакетный состав расходов — тот же приём, что у приходов: экран Расхода
    строил сводку по категориям через поштучные GET /expenses/{id}."""
    doc_ids = _parse_doc_ids(ids)
    if not doc_ids:
        return []
    query = (
        select(ExpenseDocument)
        .options(selectinload(ExpenseDocument.items))
        .where(
            ExpenseDocument.company_id == user.company_id,
            ExpenseDocument.id.in_(doc_ids),
        )
    )
    if effective_branch_filter(user) is not None:
        query = query.where(ExpenseDocument.warehouse_id.in_(await _allowed_warehouse_ids(db, user)))
    return list((await db.execute(query)).scalars().all())


@router.get("/expenses/{doc_id}", response_model=ExpenseDocumentDetailResponse)
async def get_expense(
    doc_id: UUID,
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ExpenseDocument)
        .options(selectinload(ExpenseDocument.items))
        .where(
            ExpenseDocument.id == doc_id,
            ExpenseDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Expense document not found")
    await _ensure_branch_warehouse(db, doc.warehouse_id, user)
    return doc


@router.post("/expenses", response_model=ExpenseDocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_expense(
    data: ExpenseDocumentCreate,
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    await require_company_resource(
        db, Warehouse, data.warehouse_id, user.company_id, detail="Warehouse not found"
    )
    await _ensure_branch_warehouse(db, data.warehouse_id, user)
    await require_company_resource_ids(
        db,
        Ingredient,
        (item.ingredient_id for item in data.items),
        user.company_id,
        detail="Ingredient not found",
    )
    number = await _next_doc_number(db, user.company_id, ExpenseDocument)
    now = _now()
    total = sum(item.quantity * item.cost_price for item in data.items)

    doc = ExpenseDocument(
        company_id=user.company_id,
        number=number,
        receiver=data.receiver,
        warehouse_id=data.warehouse_id,
        warehouse_name=data.warehouse_name,
        date=data.date,
        registered_at=now,
        items_count=len(data.items),
        total_amount=total,
        status="draft",
        created_by=user.id,
        created_by_name=_user_display(user),
        note=data.note,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for item_data in data.items:
        doc.items.append(ExpenseDocumentItem(
            name=item_data.name,
            ingredient_id=item_data.ingredient_id,
            quantity=item_data.quantity,
            unit=item_data.unit,
            cost_price=item_data.cost_price,
            total=item_data.quantity * item_data.cost_price,
        ))
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.patch("/expenses/{doc_id}", response_model=ExpenseDocumentResponse)
async def update_expense(
    doc_id: UUID,
    data: ExpenseDocumentUpdate,
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ExpenseDocument)
        .options(selectinload(ExpenseDocument.items))
        .where(
            ExpenseDocument.id == doc_id,
            ExpenseDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Expense document not found")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(doc, field, value)

    if data.status == "accepted" and not doc.accepted_at:
        await require_company_resource(
            db, Warehouse, doc.warehouse_id, user.company_id, detail="Warehouse not found"
        )
        await require_company_resource_ids(
            db,
            Ingredient,
            (item.ingredient_id for item in doc.items),
            user.company_id,
            detail="Ingredient not found",
        )
        if doc.warehouse_id:
            # Сначала проверяем ВСЕ позиции — либо проводим целиком, либо никак.
            stocks = {}
            for item in doc.items:
                if not item.ingredient_id or item.quantity <= 0:
                    continue
                stocks[item.ingredient_id] = await _assert_sufficient_stock(
                    db, user.company_id, doc.warehouse_id,
                    item.ingredient_id, item.name, item.quantity,
                )
            # Нормы потерь для отчётного авто-отхода (остаток не двигают).
            norms = {}
            ing_ids = [item.ingredient_id for item in doc.items if item.ingredient_id]
            if ing_ids:
                for ing in (await db.execute(
                    select(Ingredient).where(
                        Ingredient.company_id == user.company_id,
                        Ingredient.id.in_(ing_ids),
                    )
                )).scalars().all():
                    norms[ing.id] = ing
            for item in doc.items:
                if not item.ingredient_id or item.quantity <= 0:
                    continue
                # V46 FIFO: цена расхода — по старым партиям первыми.
                # Ручную cost_price из черновика игнорируем и перезаписываем.
                fifo_unit, fifo_total = await consume_fifo(
                    db,
                    company_id=user.company_id,
                    warehouse_id=doc.warehouse_id,
                    ingredient_id=item.ingredient_id,
                    quantity=item.quantity,
                    name=item.name,
                )
                item.cost_price = fifo_unit
                item.total = fifo_total
                db.add(StockMovement(
                    company_id=user.company_id, warehouse_id=doc.warehouse_id,
                    ingredient_id=item.ingredient_id, movement_type="expense",
                    quantity=item.quantity, unit=item.unit, cost_price=fifo_unit,
                    total_cost=fifo_total, ref_id=doc.id, created_by=user.id,
                    note=f"Расход №{doc.number}" + (f" → {doc.receiver}" if doc.receiver else ""),
                ))
                norm = norms.get(item.ingredient_id)
                waste_qty = calc_waste_quantity(
                    item.quantity,
                    getattr(norm, "loss_type", None),
                    getattr(norm, "loss_value", None),
                )
                if waste_qty > 0:
                    db.add(WasteDocument(
                        company_id=user.company_id,
                        number=await _next_doc_number(db, user.company_id, WasteDocument),
                        category=getattr(norm, "category", None),
                        warehouse_id=doc.warehouse_id,
                        warehouse_name=doc.warehouse_name,
                        ingredient_id=item.ingredient_id,
                        name=item.name,
                        quantity=waste_qty,
                        unit=item.unit,
                        cost_price=fifo_unit,
                        total_amount=waste_qty * fifo_unit,
                        reason=(
                            f"Авто: норма потерь "
                            f"{loss_label(getattr(norm, 'loss_type', None), getattr(norm, 'loss_value', None), item.unit)}"
                            f" · расход №{doc.number}"
                        ),
                        date=doc.date,
                        registered_at=_now(),
                        status="draft",
                        is_automatic=True,
                        created_by=user.id,
                        created_by_name=_user_display(user),
                    ))
        # V46 FIFO: итог документа — сумма фактических цен партий.
        if doc.warehouse_id:
            doc.total_amount = sum(
                (i.total for i in doc.items if i.quantity and i.quantity > 0),
                Decimal("0"),
            )
        doc.accepted_at = _now()

    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/expenses/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense(
    doc_id: UUID,
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ExpenseDocument).where(
            ExpenseDocument.id == doc_id,
            ExpenseDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Expense document not found")
    await db.delete(doc)
    await db.commit()


# ── Waste Documents (Отход) ──────────────────────────────────
# Построчный документ (одна позиция). Проведение уменьшает остаток
# (StockMovement type="waste") с проверкой достаточности. Идемпотентно.
@router.get("/wastes", response_model=list[WasteDocumentResponse])
async def list_wastes(
    search: str = Query("", alias="q"),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    branch_scope = effective_branch_filter(user)
    allowed_ids = await _allowed_warehouse_ids(db, user) if branch_scope is not None else None
    query = (
        select(WasteDocument)
        .where(WasteDocument.company_id == user.company_id)
        .order_by(desc(WasteDocument.created_at))
    )
    if allowed_ids is not None:
        query = query.where(WasteDocument.warehouse_id.in_(allowed_ids))
    if search:
        like = f"%{search}%"
        query = query.where(
            WasteDocument.name.ilike(like)
            | WasteDocument.category.ilike(like)
            | WasteDocument.created_by_name.ilike(like)
        )
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/wastes/{doc_id}", response_model=WasteDocumentResponse)
async def get_waste(
    doc_id: UUID,
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WasteDocument).where(
            WasteDocument.id == doc_id,
            WasteDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Waste document not found")
    await _ensure_branch_warehouse(db, doc.warehouse_id, user)
    return doc


@router.post("/wastes", response_model=WasteDocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_waste(
    data: WasteDocumentCreate,
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    await require_company_resource(
        db, Warehouse, data.warehouse_id, user.company_id, detail="Warehouse not found"
    )
    await _ensure_branch_warehouse(db, data.warehouse_id, user)
    if data.ingredient_id:
        await require_company_resource(
            db, Ingredient, data.ingredient_id, user.company_id, detail="Ingredient not found"
        )
    number = await _next_doc_number(db, user.company_id, WasteDocument)
    doc = WasteDocument(
        company_id=user.company_id,
        number=number,
        category=data.category,
        warehouse_id=data.warehouse_id,
        warehouse_name=data.warehouse_name,
        ingredient_id=data.ingredient_id,
        name=data.name,
        quantity=data.quantity,
        unit=data.unit,
        cost_price=data.cost_price,
        total_amount=data.quantity * data.cost_price,
        reason=data.reason,
        date=data.date,
        registered_at=_now(),
        status="draft",
        created_by=user.id,
        created_by_name=_user_display(user),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.patch("/wastes/{doc_id}", response_model=WasteDocumentResponse)
async def update_waste(
    doc_id: UUID,
    data: WasteDocumentUpdate,
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WasteDocument).where(
            WasteDocument.id == doc_id,
            WasteDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Waste document not found")

    # Авто-отход — только для отчёта: остаток он не двигает, поэтому
    # провести его вручную нельзя (иначе остаток уменьшился бы повторно).
    if data.status == "accepted" and doc.is_automatic:
        raise ValidationError("Авто-отход формируется только для отчёта и не проводится вручную.")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(doc, field, value)

    if data.status == "accepted" and not doc.accepted_at:
        if doc.warehouse_id and doc.ingredient_id and doc.quantity > 0:
            await _assert_sufficient_stock(
                db, user.company_id, doc.warehouse_id,
                doc.ingredient_id, doc.name, doc.quantity,
            )
            # V46 FIFO: отход списывает старые партии первыми, цену пересчитываем.
            fifo_unit, fifo_total = await consume_fifo(
                db,
                company_id=user.company_id,
                warehouse_id=doc.warehouse_id,
                ingredient_id=doc.ingredient_id,
                quantity=doc.quantity,
                name=doc.name,
            )
            doc.cost_price = fifo_unit
            doc.total_amount = fifo_total
            db.add(StockMovement(
                company_id=user.company_id, warehouse_id=doc.warehouse_id,
                ingredient_id=doc.ingredient_id, movement_type="waste",
                quantity=doc.quantity, unit=doc.unit, cost_price=fifo_unit,
                total_cost=fifo_total, ref_id=doc.id, created_by=user.id,
                note=f"Отход №{doc.number}" + (f": {doc.reason}" if doc.reason else ""),
            ))
        doc.accepted_at = _now()

    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/wastes/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_waste(
    doc_id: UUID,
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WasteDocument).where(
            WasteDocument.id == doc_id,
            WasteDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Waste document not found")
    await db.delete(doc)
    await db.commit()

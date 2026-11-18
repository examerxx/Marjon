from __future__ import annotations
import asyncio
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID, uuid4
from sqlalchemy import delete as sql_delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.modules.inventory.product_positions import ProductPositions
from app.modules.companies.models import Company
from app.modules.inventory.models import (
    Category, Ingredient, Modifier, ModifierGroup, Product, ProductIngredient,
    ProductLimitTopup, SetItem, StockItem, StockMovement, Warehouse
)
from app.modules.inventory.repository import (
    CategoryRepository, IngredientRepository, ProductRepository,
    StockItemRepository, StockMovementRepository, WarehouseRepository,
)
from app.modules.inventory.schemas import (
    CategoryCreate, CategoryUpdate, IngredientCreate, IngredientUpdate, ProductCreate,
    ProductIngredientIn, ProductUpdate, SetItemIn, StockMovementCreate,
)
from app.modules.printers.models import Printer
from app.modules.inventory.loss import calc_waste_quantity, loss_label
from app.modules.inventory.warehouse_models import WasteDocument
from app.modules.nomenclature.models import Unit
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError
from app.shared.tenant_scope import require_company_resource, require_company_resource_ids

_PRODUCT_LOAD = (
    selectinload(Product.ingredients).selectinload(ProductIngredient.ingredient),
    selectinload(Product.modifier_groups).selectinload(ModifierGroup.modifiers),
)


async def ingredient_unit_costs(
    db: AsyncSession, company_id: UUID, ingredient_ids: set[UUID]
) -> dict[UUID, Decimal]:
    """Средняя закупочная цена ингредиента по всем складам.

    Та же метрика, что у полуфабрикатов (SemiProductService._avg_ingredient_cost):
    одно и то же сырьё может лежать на разных складах по разной цене, «одной»
    цены без выбора склада не существует — средняя и есть разумный дефолт для
    калькуляции рецепта. Сырьё без закупок в словарь не попадает: его вклад
    считается нулевым, а не выдуманным.
    """
    if not ingredient_ids:
        return {}
    rows = (await db.execute(
        select(StockItem.ingredient_id, func.avg(StockItem.cost_price))
        .where(StockItem.company_id == company_id, StockItem.ingredient_id.in_(ingredient_ids))
        .group_by(StockItem.ingredient_id)
    )).all()
    return {row[0]: Decimal(str(row[1])) for row in rows if row[1] is not None}


def _recipe_cost(
    lines: list[tuple[UUID, Decimal]], ingredient_costs: dict[UUID, Decimal]
) -> Decimal:
    """Σ(норма строки рецепта × средняя закупка ингредиента).

    Округляется до копеек сразу: products.cost_price и cost_price_snapshot —
    NUMERIC(15,2), и без явного округления в API уезжали бы 20 знаков после
    запятой от средних закупочных цен.
    """
    total = sum(
        (Decimal(str(qty)) * ingredient_costs.get(ing_id, Decimal("0")) for ing_id, qty in lines),
        Decimal("0"),
    )
    return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def product_cost_total(
    db: AsyncSession, company_id: UUID, product: Product
) -> Decimal | None:
    """Себестоимость блюда = ручная база (products.cost_price) + состав.

    Вариант A: ручное число из карточки НЕ затирается и остаётся в
    products.cost_price как есть, состав прибавляется только здесь. Так
    «прочие расходы, которых нет в рецепте» (масло, специи, упаковка) и
    норма сырья складываются, а не подменяют друг друга.

    Блюдо без рецепта возвращает ровно свою базу (None, если база не задана) —
    неизвестное остаётся неизвестным и не превращается в ноль.
    """
    lines = (await db.execute(
        select(ProductIngredient.ingredient_id, ProductIngredient.quantity)
        .where(ProductIngredient.product_id == product.id)
    )).all()
    if not lines:
        return product.cost_price
    costs = await ingredient_unit_costs(db, company_id, {row[0] for row in lines})
    recipe_cost = _recipe_cost([(row[0], row[1]) for row in lines], costs)
    base = Decimal(str(product.cost_price)) if product.cost_price is not None else Decimal("0")
    return base + recipe_cost


class CategoryService:
    def __init__(self, db: AsyncSession):
        self.repo = CategoryRepository(db)

    async def _lock_order(self, company_id: UUID) -> None:
        # Lock the parent even when the catalog is empty. Create, reorder and
        # explicit position edits share this lock, so concurrent terminals cannot
        # choose the same tail or race a drag-and-drop reorder (PostgreSQL).
        company = (await self.repo.db.execute(
            select(Company.id).where(Company.id == company_id).with_for_update()
        )).scalar_one_or_none()
        if company is None:
            raise NotFoundError("Company not found")

    async def create(self, company_id: UUID, data: CategoryCreate) -> Category:
        await require_company_resource(
            self.repo.db, Category, data.parent_id, company_id, detail="Parent category not found"
        )
        await self._lock_order(company_id)
        last = (await self.repo.db.execute(
            select(func.max(Category.sort_order)).where(Category.company_id == company_id)
        )).scalar_one()
        payload = data.model_dump()
        # Includes legacy/unprefixed and archived rows: no existing sequence is
        # renumbered and the new row is strictly after every row of its company.
        # Older clients sending 0 cannot accidentally insert at the top. A higher
        # explicit position is harmless and stays compatible with API clients.
        payload["sort_order"] = max(payload["sort_order"], (last if last is not None else -1) + 1)
        return await self.repo.save(Category(company_id=company_id, **payload))

    async def list(self, company_id: UUID, include_inactive: bool = False) -> list[Category]:
        # Archive V1: is_active is the canonical archive flag (False hides
        # the row from the default active-only listing). include_inactive
        # returns the full company set so the UI can split Active/Archived
        # client-side; default False preserves every existing consumer.
        if include_inactive:
            return await self.repo.get_all(company_id)
        return await self.repo.get_active(company_id)

    async def get(self, company_id: UUID, category_id: UUID) -> Category:
        cat = await self.repo.get_by_id(category_id, company_id)
        if not cat:
            raise NotFoundError("Category not found")
        return cat

    async def update(self, company_id: UUID, category_id: UUID, data: CategoryUpdate) -> Category:
        if "sort_order" in data.model_fields_set:
            await self._lock_order(company_id)
        # Company-scoped: get() hides foreign-company ids as 404, same as read.
        cat = await self.get(company_id, category_id)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(cat, field, value)
        await self.repo.db.commit()
        return await self.get(company_id, category_id)

    # REORDER V1 (drag-and-drop порядок категорий). PARTIAL-контракт (в отличие
    # от полной перестановки залов, HallService.reorder): страница категорий
    # показывает отфильтрованный список (slug-префикс + таб Active/Archived),
    # клиент шлёт только видимые id в новом порядке. Дубликаты и чужие/
    # неизвестные id → 409, список отклоняется целиком (никаких частичных
    # применений). Перенумерация 0..n-1 затрагивает только указанные категории;
    # категории вне списка свой sort_order сохраняют. Меняется ТОЛЬКО sort_order
    # (name/slug/is_active/флаги/фото не читаются для записи).
    _REORDER_DUPLICATE_DETAIL = "Обнаружены повторяющиеся категории в порядке."
    _REORDER_MISMATCH_DETAIL = (
        "Список категорий должен содержать только категории этой компании."
    )

    async def reorder(
        self, company_id: UUID, category_ids: list[UUID]
    ) -> list[Category]:
        if len(category_ids) != len(set(category_ids)):
            raise ConflictError(self._REORDER_DUPLICATE_DETAIL)
        await self._lock_order(company_id)
        # Скоуп по компании: чужой/неизвестный id просто не найден в выборке,
        # и одно сравнение множеств отклоняет и лишний id, и id другого тенанта.
        result = await self.repo.db.execute(
            select(Category).where(
                Category.company_id == company_id,
                Category.id.in_(category_ids),
            )
        )
        by_id = {cat.id: cat for cat in result.scalars().all()}
        if set(category_ids) != set(by_id):
            raise ConflictError(self._REORDER_MISMATCH_DETAIL)
        for position, category_id in enumerate(category_ids):
            by_id[category_id].sort_order = position
        await self.repo.db.commit()
        # Канонический ответ — повторное чтение из БД (как в update()): свежий
        # updated_at сервера доступен только в новой выборке, мутрованные
        # ORM-объекты после commit отдают истёкший атрибут → MissingGreenlet.
        result = await self.repo.db.execute(
            select(Category).where(
                Category.company_id == company_id,
                Category.id.in_(category_ids),
            )
        )
        refreshed = {cat.id: cat for cat in result.scalars().all()}
        # Переставленный subset в новом порядке, не эхо запроса.
        return [refreshed[category_id] for category_id in category_ids]

    async def delete(self, company_id: UUID, category_id: UUID) -> None:
        # Hard delete only when nothing references the category; otherwise a
        # canonical 409 (FKs are NO ACTION, so the DB would reject it anyway —
        # this pre-check gives a clear message instead of an IntegrityError).
        cat = await self.get(company_id, category_id)
        used_by_product = (
            await self.repo.db.execute(
                select(Product.id).where(
                    Product.company_id == company_id,
                    ((Product.category_id == category_id) | (Product.subcategory_id == category_id)),
                ).limit(1)
            )
        ).scalar_one_or_none()
        if used_by_product is not None:
            raise ConflictError("Category is in use by dishes and cannot be deleted")
        used_by_child = (
            await self.repo.db.execute(
                select(Category.id).where(
                    Category.company_id == company_id,
                    Category.parent_id == category_id,
                ).limit(1)
            )
        ).scalar_one_or_none()
        if used_by_child is not None:
            raise ConflictError("Category has subcategories and cannot be deleted")
        await self.repo.db.delete(cat)
        await self.repo.db.commit()


class ProductService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = ProductRepository(db)

    async def _replace_ingredients(
        self, company_id: UUID, product_id: UUID, lines: list[ProductIngredientIn]
    ) -> None:
        """Explicit DELETE + INSERT, not ORM-collection mutation — see
        SemiProductService (BE-10) for why: mutating `.ingredients` on a
        not-fully-loaded object triggers a sync lazy-load that blows up
        under the async engine."""
        await require_company_resource_ids(
            self.db,
            Ingredient,
            (line.ingredient_id for line in lines),
            company_id,
            detail="Ingredient not found",
        )
        warehouse_ids = [line.warehouse_id for line in lines if line.warehouse_id]
        if warehouse_ids:
            await require_company_resource_ids(
                self.db,
                Warehouse,
                warehouse_ids,
                company_id,
                detail="Warehouse not found",
            )
        await self.db.execute(
            sql_delete(ProductIngredient).where(ProductIngredient.product_id == product_id)
        )
        for line in lines:
            self.db.add(ProductIngredient(
                product_id=product_id, ingredient_id=line.ingredient_id, quantity=line.quantity,
                warehouse_id=line.warehouse_id,
            ))
        await self.db.flush()

    async def _attach_aggregates(self, products: list[Product], company_id: UUID) -> list[Product]:
        """BE-16: category_name/subcategory_name/printer_name/
        ingredients_count/stock — all real, computed here, never
        fabricated. One extra query per lookup kind for the whole list
        (not per row)."""
        if not products:
            return products

        cat_ids = {p.category_id for p in products if p.category_id} | {
            p.subcategory_id for p in products if p.subcategory_id
        }
        cat_names: dict[UUID, str] = {}
        if cat_ids:
            rows = (await self.db.execute(
                select(Category.id, Category.name).where(
                    Category.id.in_(cat_ids), Category.company_id == company_id
                )
            )).all()
            cat_names = dict(rows)

        printer_ids = {p.printer_id for p in products if p.printer_id}
        printer_names: dict[UUID, str] = {}
        if printer_ids:
            rows = (await self.db.execute(
                select(Printer.id, Printer.name).where(
                    Printer.id.in_(printer_ids), Printer.company_id == company_id
                )
            )).all()
            printer_names = dict(rows)

        comp_by_product: dict[UUID, list[tuple[UUID, Decimal]]] = defaultdict(list)
        for p in products:
            for line in p.ingredients:
                comp_by_product[p.id].append((line.ingredient_id, line.quantity))

        # V38: счётчик состава сета — один запрос на весь список (см. ниже,
        # после product_ids).

        ingredient_ids = {ing_id for lines in comp_by_product.values() for ing_id, _ in lines}
        stock_by_ingredient: dict[UUID, Decimal] = {}
        if ingredient_ids:
            rows = (await self.db.execute(
                select(StockItem.ingredient_id, func.sum(StockItem.quantity))
                .where(StockItem.company_id == company_id, StockItem.ingredient_id.in_(ingredient_ids))
                .group_by(StockItem.ingredient_id)
            )).all()
            stock_by_ingredient = dict(rows)

        # Себестоимость состава: средняя закупка по каждому ингредиенту списка.
        # Один запрос на весь список (как остальные агрегаты), не на строку.
        ingredient_costs: dict[UUID, Decimal] = {}
        if ingredient_ids:
            ingredient_costs = await ingredient_unit_costs(self.db, company_id, ingredient_ids)

        # V3: последние пополнения (хронологически, max 2 на продукт) —
        # один запрос на весь список, как остальные агрегаты выше.
        # V3.5: видимы только события с seq строго больше checkpoint
        # products.history_reset_seq (сброс истории не удаляет строки).
        product_ids = [p.id for p in products]
        # V38: счётчик состава сета — один запрос на весь список.
        set_count_by_product: dict[UUID, int] = defaultdict(int)
        if product_ids:
            set_rows = (await self.db.execute(
                select(SetItem.set_product_id, func.count(SetItem.id))
                .where(
                    SetItem.company_id == company_id,
                    SetItem.set_product_id.in_(product_ids),
                )
                .group_by(SetItem.set_product_id)
            )).all()
            set_count_by_product.update(dict(set_rows))
        recent_by_product: dict[UUID, list[dict]] = defaultdict(list)
        if product_ids:
            topup_rows = (await self.db.execute(
                select(ProductLimitTopup)
                .where(
                    ProductLimitTopup.company_id == company_id,
                    ProductLimitTopup.product_id.in_(product_ids),
                )
                .order_by(ProductLimitTopup.seq)
            )).scalars().all()
            for t in topup_rows:
                recent_by_product[t.product_id].append({
                    "id": t.id,
                    "company_id": t.company_id,
                    "product_id": t.product_id,
                    "amount": t.amount,
                    "seq": t.seq,
                    "created_by": t.created_by,
                    "idempotency_key": t.idempotency_key,
                    "created_at": t.created_at,
                    "updated_at": t.updated_at,
                })

        for p in products:
            p.category_name = cat_names.get(p.category_id)
            p.subcategory_name = cat_names.get(p.subcategory_id)
            p.printer_name = printer_names.get(p.printer_id)
            cutoff = p.history_reset_seq or 0
            p.recent_topups = [
                t for t in recent_by_product.get(p.id, []) if t["seq"] > cutoff
            ][-2:]
            lines = comp_by_product.get(p.id, [])
            p.ingredients_count = len(lines)
            p.set_items_count = set_count_by_product.get(p.id, 0)
            # Вариант A: итог = ручная база + состав. База остаётся в
            # cost_price (её правит дровер), cost_total — только для показа
            # и для снимка при продаже.
            recipe_cost = _recipe_cost(lines, ingredient_costs)
            p.recipe_cost = recipe_cost
            base_cost = Decimal(str(p.cost_price)) if p.cost_price is not None else None
            p.cost_total = (
                (base_cost or Decimal("0")) + recipe_cost
                if (base_cost is not None or lines) else None
            )
            if lines:
                servable = [
                    stock_by_ingredient.get(ing_id, Decimal("0")) / qty
                    for ing_id, qty in lines if qty > 0
                ]
                p.stock = int(min(servable)) if servable else None
            else:
                p.stock = None
        return products

    async def create(self, company_id: UUID, data: ProductCreate) -> Product:
        positions = ProductPositions(self.db, company_id)
        await positions.lock()
        await self._validate_relations(company_id, data)
        payload = data.model_dump(exclude={"ingredients"})
        payload["sort_order"] = await positions.insert(data.is_active, data.product_type or "dish", data.sort_order)
        product = Product(company_id=company_id, **payload)
        self.db.add(product)
        await self.db.flush()
        if data.ingredients:
            await self._replace_ingredients(company_id, product.id, data.ingredients)
        await self.db.commit()
        return await self.get(company_id, product.id)

    async def list(self, company_id: UUID) -> list[Product]:
        products = await self.repo.get_available(company_id)
        return await self._reload_with_aggregates(products, company_id)

    async def list_all(self, company_id: UUID) -> list[Product]:
        bind = self.db.bind
        cached = [(o.name, o.product_type, o.sort_order) for o in self.db.identity_map.values()
                  if isinstance(o, Product)]
        print("SESS-DBG list_all session", id(self.db), "engine", id(bind),
              "pool", type(bind.pool).__name__, "url", str(bind.url), "map:", cached)
        products = await self.repo.get_all(company_id)
        return await self._reload_with_aggregates(products, company_id)

    async def _reload_with_aggregates(self, products: list[Product], company_id: UUID) -> list[Product]:
        if not products:
            return products
        ids = [p.id for p in products]
        result = await self.db.execute(
            select(Product).options(*_PRODUCT_LOAD)
            .where(Product.id.in_(ids))
            .execution_options(populate_existing=True)
        )
        by_id = {p.id: p for p in result.scalars().all()}
        ordered = [by_id[p.id] for p in products if p.id in by_id]
        return await self._attach_aggregates(ordered, company_id)

    async def get(self, company_id: UUID, product_id: UUID) -> Product:
        result = await self.db.execute(
            select(Product).options(*_PRODUCT_LOAD)
            .where(Product.id == product_id, Product.company_id == company_id)
            .execution_options(populate_existing=True)
        )
        p = result.scalar_one_or_none()
        if not p:
            raise NotFoundError("Product not found")
        await self._attach_aggregates([p], company_id)
        return p

    async def update(self, company_id: UUID, product_id: UUID, data: ProductUpdate) -> Product:
        positions = ProductPositions(self.db, company_id)
        await positions.lock()
        p = await self.get(company_id, product_id)
        await self._validate_relations(company_id, data)
        payload = data.model_dump(exclude_unset=True, exclude={"ingredients"})
        self._validate_distinct_printers(
            payload.get("printer_id", p.printer_id),
            payload.get("secondary_printer_id", p.secondary_printer_id),
        )
        active = payload.pop("is_active", p.is_active)
        requested = payload.pop("sort_order", None)
        new_type = payload.pop("product_type", p.product_type or "dish") or "dish"
        old_type = p.product_type or "dish"
        if new_type != old_type:
            # Смена типа = выход из старой последовательности + вход в новую.
            # Позиция в новой области считается ДО того, как p.product_type
            # меняется: insert()/append() делают свой select() внутри, который
            # autoflush-ит любые уже выставленные атрибуты p — посчитав p уже
            # сменившим тип, _count() задвоил бы его в целевой области.
            await positions.leave(p)
            if active != p.is_active:
                new_sort = await positions.append(active, new_type)
            elif requested is not None:
                new_sort = await positions.insert(active, new_type, requested)
            else:
                new_sort = await positions.append(active, new_type)
            p.product_type = new_type
            p.is_active = active
            p.sort_order = new_sort
        elif active != p.is_active:
            await positions.transfer(p, active)
        elif requested is not None:
            await positions.move(p, requested)
        for field, value in payload.items():
            setattr(p, field, value)
        if data.ingredients is not None:
            await self._replace_ingredients(company_id, p.id, data.ingredients)
        await self.db.commit()
        return await self.get(company_id, product_id)

    @staticmethod
    def _validate_distinct_printers(primary: UUID | None, secondary: UUID | None) -> None:
        if primary is not None and primary == secondary:
            raise ValidationError("Выберите два разных принтера")

    async def _validate_relations(
        self, company_id: UUID, data: ProductCreate | ProductUpdate
    ) -> None:
        await require_company_resource_ids(
            self.db,
            Category,
            (data.category_id, data.subcategory_id),
            company_id,
            detail="Category not found",
        )
        await require_company_resource_ids(
            self.db, Printer, (data.printer_id, data.secondary_printer_id), company_id, detail="Printer not found"
        )
        self._validate_distinct_printers(data.printer_id, data.secondary_printer_id)
        if data.unit_id is not None:
            unit = (await self.db.execute(
                select(Unit).where(
                    Unit.id == data.unit_id,
                    (Unit.company_id.is_(None)) | (Unit.company_id == company_id),
                )
            )).scalar_one_or_none()
            if unit is None:
                # Deliberately hide whether the id belongs to another tenant.
                raise NotFoundError("Unit not found")
        if data.ingredients is not None:
            await require_company_resource_ids(
                self.db,
                Ingredient,
                (line.ingredient_id for line in data.ingredients),
                company_id,
                detail="Ingredient not found",
            )

    async def update_image(self, company_id: UUID, product_id: UUID, image_url: str) -> Product:
        p = await self.get(company_id, product_id)
        p.image_url = image_url
        await self.db.commit()
        return await self.get(company_id, product_id)

    async def delete(self, company_id: UUID, product_id: UUID) -> None:
        """Мягкое удаление блюда (снимаем с продажи, скрываем из каталога)."""
        positions = ProductPositions(self.db, company_id)
        await positions.lock()
        p = await self.get(company_id, product_id)
        await positions.transfer(p, False)
        if hasattr(p, "is_available"):
            p.is_available = False
        await self.db.commit()

    async def set_availability(
        self, company_id: UUID, product_id: UUID, is_available: bool
    ) -> Product:
        """Стоп-лист: снять/вернуть блюдо в продажу (product-level is_available).

        Отдельный метод под отдельный узкий эндпоинт — чтобы кассир мог править
        только доступность, но НЕ цену/название/прочие поля (для этого остаётся
        админский PATCH /products/{id}).

        V3.2: любое ручное переключение — явное намерение человека, поэтому
        флаг системного авто-стопа всегда сбрасываем (в обе стороны).
        """
        p = await self.get(company_id, product_id)
        p.is_available = is_available
        p.limit_auto_stopped = False
        await self.db.commit()
        return await self.get(company_id, product_id)

    async def set_daily_limit(
        self, company_id: UUID, product_id: UUID, daily_limit: Decimal | None
    ) -> Product:
        """D3 «максимум блюда»: задать/снять точный дневной лимит.

        Задание числа — это «пополнение» на новый день: обнуляем счётчик
        проданного и возвращаем блюдо в продажу (сброс ручной, по образцу
        тумблера стоп-листа). daily_limit=None снимает лимит (без ограничения),
        текущий стоп при этом НЕ трогаем.
        V3.2: абсолютная перезапись — тоже ручное действие: флаг авто-стопа
        сбрасываем всегда, is_available правит существующая логика выше.
        """
        p = await self.get(company_id, product_id)
        p.daily_limit = daily_limit
        p.limit_auto_stopped = False
        if daily_limit is not None:
            p.sold_count = Decimal("0")
            p.is_available = True
        await self.db.commit()
        return await self.get(company_id, product_id)


class SetItemService:
    """V38: состав сета — блюда внутри блюда (комбо).

    Replace-семантика как у рецептов (None в PATCH = leave, [] = clear,
    list = replace): явный DELETE + INSERT, не ORM-мутация коллекции
    (та же причина, что в ProductService._replace_ingredients под
    async-движком: мутация недогруженного объекта роняет lazy-load)."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _owned_product(self, company_id: UUID, product_id: UUID) -> Product:
        result = await self.db.execute(
            select(Product).where(
                Product.id == product_id, Product.company_id == company_id
            )
        )
        product = result.scalar_one_or_none()
        if product is None:
            # Тот же 404-контракт, что у чтения (чужой id неотличим).
            raise NotFoundError("Product not found")
        return product

    async def list(self, company_id: UUID, set_product_id: UUID) -> list[dict]:
        """Строки состава сета с именами блюд (один запрос на имена)."""
        set_product = await self._owned_product(company_id, set_product_id)
        result = await self.db.execute(
            select(SetItem)
            .where(
                SetItem.company_id == company_id,
                SetItem.set_product_id == set_product.id,
            )
            .order_by(SetItem.created_at, SetItem.id)
        )
        lines = list(result.scalars().all())
        names: dict[UUID, tuple[str, str]] = {}
        ids = list({line.product_id for line in lines})
        if ids:
            rows = (await self.db.execute(
                select(Product.id, Product.name, Product.unit).where(
                    Product.company_id == company_id,
                    Product.id.in_(ids),
                )
            )).all()
            names = {row[0]: (row[1], row[2]) for row in rows}
        return [
            {
                "product_id": line.product_id,
                "product_name": names.get(line.product_id, ("", ""))[0],
                "quantity": line.quantity,
                "unit": names.get(line.product_id, ("", ""))[1],
                "price": line.price,
            }
            for line in lines
        ]

    async def replace(
        self, company_id: UUID, set_product_id: UUID, lines: list[SetItemIn]
    ) -> list[dict]:
        set_product = await self._owned_product(company_id, set_product_id)
        if lines:
            await require_company_resource_ids(
                self.db,
                Product,
                (line.product_id for line in lines),
                company_id,
                detail="Dish not found",
            )
            for line in lines:
                if line.product_id == set_product.id:
                    raise ConflictError("Set cannot contain itself")
        await self.db.execute(
            sql_delete(SetItem).where(
                SetItem.company_id == company_id,
                SetItem.set_product_id == set_product.id,
            )
        )
        for line in lines:
            self.db.add(SetItem(
                company_id=company_id,
                set_product_id=set_product.id,
                product_id=line.product_id,
                quantity=line.quantity,
                price=line.price,
            ))
        await self.db.flush()
        await self.db.commit()
        return await self.list(company_id, set_product.id)


_TOPUP_LOCKS: dict[tuple[UUID, UUID], asyncio.Lock] = {}
_TOPUP_LOCKS_GUARD = asyncio.Lock()


async def _topup_lock(company_id: UUID, product_id: UUID) -> asyncio.Lock:
    """Внутрипроцессный мьютекс на продукт для topup/reset.

    Межпроцессную сериализацию даёт SELECT FOR UPDATE (Postgres); мьютекс
    дополнительно упорядочивает корутины одного воркера — в т.ч. на СУБД
    без строчных локов (тестовый SQLite делит одно соединение, где гонка
    MAX(seq)+1 иначе превращается в откаты вместо потери данных).
    """
    async with _TOPUP_LOCKS_GUARD:
        lock = _TOPUP_LOCKS.get((company_id, product_id))
        if lock is None:
            lock = asyncio.Lock()
            _TOPUP_LOCKS[(company_id, product_id)] = lock
        return lock


class ProductTopupService:
    """V3: накопительные пополнения доступного остатка (ADD, не замена).

    Каноническая атомарная операция под блокировкой строки продукта:
    daily_limit = (daily_limit or 0) + amount, событие — append-only строкой
    в product_limit_topups. Никакого GET→PATCH с фронта: два одновременных
    оператора сериализуются SELECT FOR UPDATE до commit, ничто не теряется.
    Повтор запроса с тем же idempotency_key возвращает прежнее событие
    без повторного начисления (в т.ч. при гонке — через UNIQUE-откат).
    """
    def __init__(self, db: AsyncSession):
        self.db = db
        self.products = ProductService(db)

    async def _locked_product(self, company_id: UUID, product_id: UUID) -> Product:
        result = await self.db.execute(
            select(Product)
            .where(Product.id == product_id, Product.company_id == company_id)
            .with_for_update()
        )
        product = result.scalar_one_or_none()
        if not product:
            # Тот же 404-контракт, что у чтения (чужой id компании не отличим).
            raise NotFoundError("Product not found")
        return product

    async def _find_topup(
        self, company_id: UUID, idempotency_key: UUID
    ) -> ProductLimitTopup | None:
        result = await self.db.execute(
            select(ProductLimitTopup).where(
                ProductLimitTopup.company_id == company_id,
                ProductLimitTopup.idempotency_key == idempotency_key,
            )
        )
        return result.scalar_one_or_none()

    async def topup(
        self,
        company_id: UUID,
        product_id: UUID,
        actor_id: UUID | None,
        amount: Decimal,
        idempotency_key: UUID,
    ) -> tuple[Product, ProductLimitTopup, bool]:
        """Пополнить доступный остаток на amount. Возвращает
        (product с агрегатами, topup-событие, duplicate-флаг).

        Безопасно при конкуренции: строка продукта сериализуется FOR UPDATE
        (Postgres), а остаточная seq-гонка (СУБД без строчных локов) гасится
        bounded-ретраем вместо потери пополнения.
        """
        async with await _topup_lock(company_id, product_id):
            return await self._topup_locked(
                company_id, product_id, actor_id, amount, idempotency_key
            )

    async def _topup_locked(
        self,
        company_id: UUID,
        product_id: UUID,
        actor_id: UUID | None,
        amount: Decimal,
        idempotency_key: UUID,
    ) -> tuple[Product, ProductLimitTopup, bool]:
        for _ in range(3):
            existing = await self._find_topup(company_id, idempotency_key)
            if existing is not None:
                if existing.product_id != product_id:
                    raise ConflictError("Idempotency key already used for another product")
                return await self.products.get(company_id, product_id), existing, True

            product = await self._locked_product(company_id, product_id)
            # V3.2: первое пополнение при отсутствующем allowance: старые
            # продажи вне квоты (null = без ограничения) НЕ должны молча
            # съедать новую квоту — счётчик стартует с нуля. Существующий
            # allowance складывается как есть (sold относится к нему).
            if product.daily_limit is None:
                product.sold_count = Decimal("0")
            product.daily_limit = (product.daily_limit or Decimal("0")) + amount
            # V3.2: стоп снимаем ТОЛЬКО по флагу системного авто-стопа.
            # Ручная блокировка (флаг пуст) переживает пополнение всегда,
            # включая ручной стоп поверх исчерпанной квоты.
            if product.limit_auto_stopped:
                product.is_available = True
                product.limit_auto_stopped = False
            # Монотонный seq под той же блокировкой строки: детерминированный
            # порядок истории на любой СУБД (created_at/UUID его не дают).
            seq = (await self.db.execute(
                select(func.coalesce(func.max(ProductLimitTopup.seq), 0)).where(
                    ProductLimitTopup.company_id == company_id,
                    ProductLimitTopup.product_id == product.id,
                )
            )).scalar_one() + 1
            topup = ProductLimitTopup(
                company_id=company_id,
                product_id=product.id,
                amount=amount,
                seq=seq,
                created_by=actor_id,
                idempotency_key=idempotency_key,
            )
            self.db.add(topup)
            try:
                await self.db.flush()
            except IntegrityError:
                # Либо гонка дубликатов одного ключа, либо seq-столкновение
                # параллельных пополнений: откатываем попытку и разбираемся.
                await self.db.rollback()
                existing = await self._find_topup(company_id, idempotency_key)
                if existing is not None:
                    if existing.product_id != product_id:
                        raise ConflictError("Idempotency key already used for another product")
                    return await self.products.get(company_id, product_id), existing, True
                continue  # seq-гонка: пересчитать seq и повторить.
            await self.db.commit()
            return await self.products.get(company_id, product_id), topup, False
        raise ConflictError("Concurrent top-up conflict, please retry")

    async def reset_allowance(self, company_id: UUID, product_id: UUID) -> Product:
        """V3-сброс: обнулить доступное количество (limit=None, sold=0).

        Продукт НЕ удаляется, строки истории НЕ стираются (audit trail живёт
        в product_limit_topups). is_available НЕ трогаем: ни ручной, ни
        авто-стоп сброс не снимает — возврат в продажу только явным действием.
        V3.2: флаг авто-стопа тоже сбрасываем — причина исчерпания стёрта
        вместе со счётчиками; следующий топ-ап стартует с чистого состояния
        и сам стоп не снимет.
        """
        async with await _topup_lock(company_id, product_id):
            product = await self._locked_product(company_id, product_id)
            product.daily_limit = None
            product.sold_count = Decimal("0")
            product.limit_auto_stopped = False
            await self.db.commit()
            return await self.products.get(company_id, product_id)

    async def zero_allowance(self, company_id: UUID, product_id: UUID) -> Product:
        """V3.5: обнулить доступную квоту (остаток ровно 0, не unlimited).

        daily_limit = 0 + sold_count = 0: существующий POS-гейт при limit 0
        отклоняет любую продажу (remaining = 0), склад (StockItem) и история
        топ-апов не трогаем, OrderItem-строки не трогаем. Set-семантика —
        повтор идемпотентен. Ручной стоп переживает (is_available/флаг
        меняем только для доступного сейчас товара: он встаёт в системный
        стоп с флагом, следующий топ-ап его снимет; ручной остаётся).
        0 осознанно отличается от NULL (unlimited): контракт PATCH /limit
        по-прежнему требует gt=0, ноль — только этой операцией.
        """
        async with await _topup_lock(company_id, product_id):
            product = await self._locked_product(company_id, product_id)
            product.daily_limit = Decimal("0")
            product.sold_count = Decimal("0")
            if product.is_available or product.limit_auto_stopped:
                product.is_available = False
                product.limit_auto_stopped = True
            await self.db.commit()
            return await self.products.get(company_id, product_id)

    async def reset_history(self, company_id: UUID, product_id: UUID) -> Product:
        """V3.5: сбросить ВИДИМУЮ историю (checkpoint), не трогая остаток.

        Ставит history_reset_seq = текущий MAX(seq) (0 если топ-апов не
        было): видимое окно пустеет (UI показывает "0"), append-only строки
        НЕ удаляются, allowance/sold/is_available НЕ меняются. Set-семантика —
        повтор идемпотентен. Следующий топ-ап (seq выше) виден как [40],
        затем пары скользят как обычно; досбросочные события в окно
        не возвращаются.
        """
        async with await _topup_lock(company_id, product_id):
            product = await self._locked_product(company_id, product_id)
            max_seq = (await self.db.execute(
                select(func.coalesce(func.max(ProductLimitTopup.seq), 0)).where(
                    ProductLimitTopup.company_id == company_id,
                    ProductLimitTopup.product_id == product.id,
                )
            )).scalar_one()
            product.history_reset_seq = int(max_seq)
            await self.db.commit()
            return await self.products.get(company_id, product_id)

    async def list_topups(self, company_id: UUID, product_id: UUID) -> list[ProductLimitTopup]:
        await self.products.get(company_id, product_id)
        result = await self.db.execute(
            select(ProductLimitTopup)
            .where(
                ProductLimitTopup.company_id == company_id,
                ProductLimitTopup.product_id == product_id,
            )
            .order_by(ProductLimitTopup.seq)
        )
        return list(result.scalars().all())


class ModifierGroupService:
    """CRUD групп добавок (модификаторов) блюда. Группа принадлежит и блюду,
    и компании; опции внутри заменяются целиком (delete + insert) по образцу
    ProductService._replace_ingredients — так же безопасно под async-движком."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _replace_modifiers(self, group: ModifierGroup, lines: list) -> None:
        await self.db.execute(
            sql_delete(Modifier).where(Modifier.group_id == group.id)
        )
        for line in lines:
            self.db.add(Modifier(
                group_id=group.id,
                company_id=group.company_id,
                name=line.name,
                price_delta=line.price_delta,
                is_default=line.is_default,
                sort_order=line.sort_order,
            ))
        await self.db.flush()

    async def _load(self, company_id: UUID, group_id: UUID) -> ModifierGroup:
        result = await self.db.execute(
            select(ModifierGroup).options(selectinload(ModifierGroup.modifiers))
            .where(ModifierGroup.id == group_id, ModifierGroup.company_id == company_id)
            .execution_options(populate_existing=True)
        )
        group = result.scalar_one_or_none()
        if not group:
            raise NotFoundError("Modifier group not found")
        return group

    async def list_for_product(self, company_id: UUID, product_id: UUID) -> list[ModifierGroup]:
        result = await self.db.execute(
            select(ModifierGroup).options(selectinload(ModifierGroup.modifiers))
            .where(
                ModifierGroup.company_id == company_id,
                ModifierGroup.product_id == product_id,
            )
            .order_by(ModifierGroup.sort_order, ModifierGroup.created_at)
        )
        return list(result.scalars().all())

    async def create(self, company_id: UUID, data) -> ModifierGroup:
        # Блюдо должно существовать и принадлежать компании
        await require_company_resource(
            self.db, Product, data.product_id, company_id, detail="Product not found"
        )
        group = ModifierGroup(
            company_id=company_id,
            product_id=data.product_id,
            name=data.name,
            min_select=data.min_select,
            max_select=data.max_select,
            is_required=data.is_required,
            show_in_pos=data.show_in_pos,
            sort_order=data.sort_order,
        )
        self.db.add(group)
        await self.db.flush()
        if data.modifiers:
            await self._replace_modifiers(group, data.modifiers)
        await self.db.commit()
        return await self._load(company_id, group.id)

    async def update(self, company_id: UUID, group_id: UUID, data) -> ModifierGroup:
        group = await self._load(company_id, group_id)
        for field, value in data.model_dump(exclude_unset=True, exclude={"modifiers"}).items():
            setattr(group, field, value)
        if data.modifiers is not None:
            await self._replace_modifiers(group, data.modifiers)
        await self.db.commit()
        return await self._load(company_id, group_id)

    async def delete(self, company_id: UUID, group_id: UUID) -> None:
        group = await self._load(company_id, group_id)
        await self.db.delete(group)
        await self.db.commit()


class IngredientService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = IngredientRepository(db)

    async def _attach_aggregates(self, ingredients: list[Ingredient], company_id: UUID) -> list[Ingredient]:
        """BE-17: stock/min_stock/purchase_price summed/averaged from
        StockItem across all the company's warehouses — real numbers, not
        placeholders. 0 is a genuine "nothing recorded yet", distinct from
        the null used elsewhere in this ticket set for "not derivable"."""
        if not ingredients:
            return ingredients
        ids = [i.id for i in ingredients]
        rows = (await self.db.execute(
            select(
                StockItem.ingredient_id,
                func.sum(StockItem.quantity),
                func.sum(StockItem.min_quantity),
                func.avg(StockItem.cost_price),
            )
            .where(StockItem.company_id == company_id, StockItem.ingredient_id.in_(ids))
            .group_by(StockItem.ingredient_id)
        )).all()
        agg = {row[0]: row for row in rows}
        for ing in ingredients:
            row = agg.get(ing.id)
            ing.stock = row[1] or Decimal("0") if row else Decimal("0")
            ing.min_stock = row[2] or Decimal("0") if row else Decimal("0")
            ing.purchase_price = Decimal(str(row[3])) if row and row[3] is not None else None
        return ingredients

    async def create(self, company_id: UUID, data: IngredientCreate) -> Ingredient:
        ing = await self.repo.save(Ingredient(company_id=company_id, **data.model_dump()))
        await self._attach_aggregates([ing], company_id)
        return ing

    async def update(self, company_id: UUID, ingredient_id: UUID, data: IngredientUpdate) -> Ingredient:
        ing = await self.get(company_id, ingredient_id)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(ing, field, value)
        await self.db.commit()
        await self.db.refresh(ing)
        await self._attach_aggregates([ing], company_id)
        return ing

    async def list(self, company_id: UUID) -> list[Ingredient]:
        ingredients = await self.repo.get_all(company_id)
        return await self._attach_aggregates(ingredients, company_id)

    async def get(self, company_id: UUID, ingredient_id: UUID) -> Ingredient:
        ing = await self.repo.get_by_id(ingredient_id, company_id)
        if not ing:
            raise NotFoundError("Ingredient not found")
        await self._attach_aggregates([ing], company_id)
        return ing


async def _resolve_recipe_lines(db, company_id: UUID, product_id: UUID, depth: int = 0):
    """Техкарта продукта: [(ingredient_id, норма на 1 порцию, warehouse_id)].

    У сета (is_set) своей техкарты нет — состав лежит в set_items («блюдо
    внутри блюда»), поэтому норма сета раскрывается в нормы компонентов:
    порций компонента в сете × норма компонента. Вложенность ограничена
    глубиной 3, чтобы битый состав не зациклил рекурсию.
    """
    product = await db.get(Product, product_id)
    if product is None or product.company_id != company_id or depth > 3:
        return []
    if getattr(product, "is_set", False):
        components = (await db.execute(
            select(SetItem.product_id, SetItem.quantity).where(
                SetItem.company_id == company_id,
                SetItem.set_product_id == product_id,
            )
        )).all()
        resolved = []
        for component_id, component_qty in components:
            factor = Decimal(str(component_qty or 0))
            if factor <= 0:
                continue
            for ingredient_id, norm, warehouse_id in await _resolve_recipe_lines(
                db, company_id, component_id, depth + 1
            ):
                resolved.append((ingredient_id, norm * factor, warehouse_id))
        return resolved
    rows = (await db.execute(
        select(ProductIngredient.ingredient_id, ProductIngredient.quantity,
               ProductIngredient.warehouse_id)
        .join(Product, Product.id == ProductIngredient.product_id)
        .where(ProductIngredient.product_id == product_id, Product.company_id == company_id)
    )).all()
    return [(ingredient_id, Decimal(str(quantity or 0)), warehouse_id)
            for ingredient_id, quantity, warehouse_id in rows]


class StockService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.stock_repo = StockItemRepository(db)
        self.movement_repo = StockMovementRepository(db)
        self.warehouse_repo = WarehouseRepository(db)

    async def deduct_for_order(
        self, company_id: UUID, order_id: UUID, created_by: UUID | None = None
    ) -> int:
        """Списать сырьё по рецептам блюд завершённого заказа.

        Для каждой не отменённой позиции: recipe lines продукта × количество
        порций вычитаются из остатка ингредиента. Сет раскрывается в состав
        (set_items → компоненты → их техкарты), поэтому продажа комбо списывает
        сырьё своих блюд. Склад списания берётся из строки рецепта (V36);
        NULL или чужой/удалённый склад → главный склад компании (is_main, иначе
        первый) — историческое поведение сохранено.
        Минус разрешён: отсутствующий StockItem создаётся с отрицательным
        остатком. Каждая строка пишется как StockMovement type="sale" с
        ref_id=order_id и note="dish sale: <блюдо>" — по этому примечанию отчёт
        расхода узнаёт блюдо, даже если заказ потом удалят или техкарту изменят.

        Идемпотентность: списание считается по разнице «требуется − уже
        списано» в разрезе (ингредиент, склад), поэтому повторный вызов — no-op,
        а позиции, добавленные в заказ ПОСЛЕ оплаты (дозаказ), дописываются.
        Отменённые заказы завершить нельзя (pos.cancel отклоняет completed),
        поэтому обратного начисления здесь нет — списание финально.
        Возвращает число созданных движений.
        """
        from app.modules.pos.models import Order, OrderItem

        existing_rows = (await self.db.execute(
            select(StockMovement.ingredient_id, StockMovement.warehouse_id,
                   func.sum(StockMovement.quantity))
            .where(
                StockMovement.company_id == company_id,
                StockMovement.ref_id == order_id,
                StockMovement.movement_type == "sale",
            )
            .group_by(StockMovement.ingredient_id, StockMovement.warehouse_id)
        )).all()
        already = {(ingredient_id, warehouse_id): Decimal(str(quantity or 0))
                   for ingredient_id, warehouse_id, quantity in existing_rows}

        order = (
            await self.db.execute(
                select(Order).where(Order.id == order_id, Order.company_id == company_id)
            )
        ).scalar_one_or_none()
        if order is None:
            raise NotFoundError("Order not found")

        # Позиции читаем отдельным запросом, а не через order.items: ленивая
        # коллекция могла быть загружена до дозаказа и вернула бы старый состав.
        order_items = (await self.db.execute(
            select(OrderItem).where(OrderItem.order_id == order_id)
        )).scalars().all()

        warehouses = await self.warehouse_repo.get_all(company_id)
        if not warehouses:
            return 0
        by_id = {w.id: w for w in warehouses}
        main = next((w for w in warehouses if w.is_main), warehouses[0])
        order_ref = getattr(order, "public_id", None) or getattr(order, "order_number", None) or str(order.id)[:8]
        waste_base_number = (await self.db.execute(
            select(func.max(WasteDocument.number)).where(WasteDocument.company_id == company_id)
        )).scalar() or 0

        # Состав заказа по строкам техкарт. Сет раскрывается в компоненты
        # (set_items), поэтому комбо списывает сырьё своих блюд, а не ничего.
        required: dict[tuple, list] = {}
        for item in order_items:
            if getattr(item, "status", None) == "cancelled":
                continue
            if not item.product_id or not item.quantity:
                continue
            sold = Decimal(str(item.quantity))
            for ingredient_id, norm, warehouse_id in await _resolve_recipe_lines(
                self.db, company_id, item.product_id
            ):
                amount = norm * sold
                if amount <= 0:
                    continue
                target = by_id.get(warehouse_id) if warehouse_id else None
                warehouse_key = target.id if target is not None else main.id
                required.setdefault((ingredient_id, warehouse_key), []).append(
                    (str(item.name or ""), amount)
                )

        movements = 0
        auto_wastes = 0
        for (ingredient_id, warehouse_key), parts in required.items():
            ingredient = await self.db.get(Ingredient, ingredient_id)
            if ingredient is None or ingredient.company_id != company_id:
                continue
            target = by_id.get(warehouse_key) or main
            # Дозаказ: пишем только то, чего ещё нет в движениях этого заказа.
            remaining = sum((amount for _name, amount in parts), Decimal("0")) - already.get(
                (ingredient_id, warehouse_key), Decimal("0")
            )
            if remaining <= 0:
                continue
            for dish_name, amount in parts:
                if remaining <= 0:
                    break
                take = amount if amount <= remaining else remaining
                remaining -= take
                stock = (
                    await self.db.execute(
                        select(StockItem).where(
                            StockItem.company_id == company_id,
                            StockItem.warehouse_id == target.id,
                            StockItem.ingredient_id == ingredient_id,
                        )
                    )
                ).scalar_one_or_none()
                if stock is None:
                    stock = StockItem(
                        company_id=company_id,
                        warehouse_id=target.id,
                        ingredient_id=ingredient_id,
                        quantity=Decimal("0"),
                        unit=ingredient.unit or "кг",
                        cost_price=Decimal("0"),
                    )
                    self.db.add(stock)
                    await self.db.flush()
                # V46 FIFO: продажа списывает старые партии первыми.
                # Минус исторически разрешён: чего не хватило в партиях —
                # уходит в минус по нулевой цене (как раньше без остатка).
                from app.modules.inventory.fifo import consume_fifo, get_fifo_batches
                batches = await get_fifo_batches(
                    self.db, company_id, target.id, ingredient_id,
                )
                available = sum(
                    (Decimal(str(b.quantity_remaining)) for b in batches),
                    Decimal("0"),
                )
                take_fifo = min(available, take)
                remainder = take - take_fifo
                if take_fifo > 0:
                    fifo_unit_part, fifo_total_part = await consume_fifo(
                        self.db,
                        company_id=company_id,
                        warehouse_id=target.id,
                        ingredient_id=ingredient_id,
                        quantity=take_fifo,
                        name=ingredient.name,
                    )
                else:
                    fifo_unit_part, fifo_total_part = Decimal("0"), Decimal("0")
                if remainder > 0:
                    # Нет партий на остаток — исторический минус.
                    stock.quantity = Decimal(str(stock.quantity)) - remainder
                fifo_total = fifo_total_part
                fifo_unit = (fifo_total / take) if take > 0 else Decimal("0")
                self.db.add(StockMovement(
                    company_id=company_id,
                    warehouse_id=target.id,
                    ingredient_id=ingredient_id,
                    movement_type="sale",
                    quantity=take,
                    unit=ingredient.unit or "кг",
                    cost_price=fifo_unit,
                    total_cost=fifo_total,
                    ref_id=order_id,
                    created_by=created_by,
                    # Блюдо прямо в примечании: отчёт расхода восстановит его,
                    # даже если заказ удалят или техкарту перепишут.
                    note=f"dish sale: {dish_name}" if dish_name else "dish sale",
                ))
                movements += 1
                # Отчётный авто-отход по норме потерь ингредиента: в отчёте
                # «Отход товаров» появится запись (is_automatic, черновик),
                # остаток и деньги не трогает. Идемпотентность — от расчёта
                # «требуется − уже списано» выше: повторный вызов сюда не дойдёт.
                waste_qty = calc_waste_quantity(take, ingredient.loss_type, ingredient.loss_value)
                if waste_qty > 0:
                    auto_wastes += 1
                    cost = Decimal(str(getattr(stock, "cost_price", 0) or 0))
                    self.db.add(WasteDocument(
                        company_id=company_id,
                        number=waste_base_number + auto_wastes,
                        category=ingredient.category,
                        warehouse_id=target.id,
                        warehouse_name=target.name,
                        ingredient_id=ingredient_id,
                        name=ingredient.name,
                        quantity=waste_qty,
                        unit=ingredient.unit or "кг",
                        cost_price=cost,
                        total_amount=waste_qty * cost,
                        reason=(
                            f"Авто: норма потерь "
                            f"{loss_label(ingredient.loss_type, ingredient.loss_value, ingredient.unit or 'кг')}"
                            f" · заказ №{order_ref}"
                        ),
                        registered_at=datetime.now(timezone.utc).isoformat(),
                        status="draft",
                        is_automatic=True,
                        created_by=created_by,
                    ))
        await self.db.flush()
        return movements

    async def get_stock(self, company_id: UUID, warehouse_id: UUID | None = None) -> list[StockItem]:
        if warehouse_id:
            result = await self.db.execute(
                self.stock_repo._base_query(company_id).where(
                    StockItem.warehouse_id == warehouse_id
                )
            )
            return list(result.scalars().all())
        return await self.stock_repo.get_all(company_id)

    async def get_low_stock(self, company_id: UUID) -> list[StockItem]:
        return await self.stock_repo.get_low_stock(company_id)

    # Знаки движений для пересчёта (зеркалят create_movement и хелперы
    # warehouse_router: purchase/adjustment — плюс, остальное — минус).
    _STOCK_PLUS_TYPES = frozenset({"purchase", "adjustment"})
    _STOCK_MINUS_TYPES = frozenset({"sale", "writeoff", "transfer", "expense", "waste"})

    async def get_stock_as_of(
        self, company_id: UUID, day: date, warehouse_id: UUID | None = None, *, web_timezone: str | None = None
    ) -> list[dict]:
        """Остатки на конец календарного дня day (UTC): replay движений.

        Перемещения и инвентаризации остатки не двигают (документов без
        движений), поэтому replay purchase/expense/waste/sale/writeoff/
        transfer/adjustment сходится с текущими StockItem. Себестоимость —
        V46 FIFO: приход — партия, расход — старые партии первыми
        (оценка запаса = средняя оставшихся партий).
        Неизвестные типы игнорируем, как create_movement.
        """
        if web_timezone:
            from app.shared.web_time import web_date_conditions
            day_conditions = web_date_conditions(StockMovement.created_at, date_to=day)
        else:
            day_conditions = [func.date(StockMovement.created_at) <= day]
        query = (
            select(StockMovement)
            .where(
                StockMovement.company_id == company_id,
                *day_conditions,
            )
            .order_by(StockMovement.created_at, StockMovement.id)
        )
        if warehouse_id:
            query = query.where(StockMovement.warehouse_id == warehouse_id)
        moves = (await self.db.execute(query)).scalars().all()

        state: dict[tuple[UUID, UUID], dict] = {}
        for m in moves:
            key = (m.warehouse_id, m.ingredient_id)
            acc = state.get(key)
            if acc is None:
                acc = {"qty": Decimal("0"), "cost": Decimal("0"), "unit": m.unit or "кг", "lots": []}
                state[key] = acc
            if m.unit:
                acc["unit"] = m.unit
            qty = Decimal(str(m.quantity or 0))
            cost = Decimal(str(m.cost_price or 0))
            if m.movement_type in self._STOCK_PLUS_TYPES:
                # Исторический минус сначала закрываем новым приходом.
                if acc["qty"] < 0:
                    cover = min(-acc["qty"], qty)
                    qty -= cover
                    acc["qty"] += cover
                if qty > 0:
                    acc["lots"].append([qty, cost])
                    total_qty = sum((q for q, _ in acc["lots"]), Decimal("0"))
                    total_val = sum((q * c for q, c in acc["lots"]), Decimal("0"))
                    acc["qty"] = total_qty + min(acc["qty"], Decimal("0"))
                    acc["cost"] = (total_val / total_qty) if total_qty > 0 else cost
                elif not acc["lots"]:
                    acc["cost"] = cost
            elif m.movement_type in self._STOCK_MINUS_TYPES:
                left = qty
                for lot in acc["lots"]:
                    if left <= 0:
                        break
                    take = min(lot[0], left)
                    lot[0] -= take
                    left -= take
                acc["lots"] = [[q, c] for q, c in acc["lots"] if q > 0]
                if acc["lots"]:
                    total_qty = sum((q for q, _ in acc["lots"]), Decimal("0"))
                    total_val = sum((q * c for q, c in acc["lots"]), Decimal("0"))
                    acc["qty"] = total_qty
                    acc["cost"] = (total_val / total_qty) if total_qty > 0 else Decimal("0")
                else:
                    acc["qty"] = acc["qty"] - qty
                    acc["cost"] = Decimal("0") if acc["qty"] <= 0 else acc["cost"]

        # min_quantity и единица — из текущих StockItem (истории у них нет).
        current: dict[tuple[UUID, UUID], StockItem] = {}
        if state:
            rows = await self.stock_repo.get_all(company_id)
            for item in rows:
                current[(item.warehouse_id, item.ingredient_id)] = item

        now = datetime.now(timezone.utc)
        result = []
        for (wh_id, ing_id), acc in state.items():
            item = current.get((wh_id, ing_id))
            result.append({
                "id": uuid4(),
                "company_id": company_id,
                "warehouse_id": wh_id,
                "ingredient_id": ing_id,
                "quantity": acc["qty"],
                "unit": item.unit if item and item.unit else acc["unit"],
                "min_quantity": item.min_quantity if item else Decimal("0"),
                "cost_price": acc["cost"],
                "created_at": now,
                "updated_at": now,
            })
        return result

    async def create_movement(
        self, company_id: UUID, created_by: UUID, data: StockMovementCreate
    ) -> StockMovement:
        await require_company_resource(
            self.db, Warehouse, data.warehouse_id, company_id, detail="Warehouse not found"
        )
        await require_company_resource(
            self.db, Ingredient, data.ingredient_id, company_id, detail="Ingredient not found"
        )
        # V46 FIFO: ручные движения тоже идут через партии.
        from app.modules.inventory.fifo import add_fifo_batch, consume_fifo
        fifo_ok = False
        if data.movement_type in ("purchase", "adjustment"):
            total = data.quantity * data.cost_price
        else:
            total = data.quantity * data.cost_price
            if data.movement_type in ("sale", "writeoff", "transfer", "expense", "waste"):
                try:
                    fifo_unit, fifo_total = await consume_fifo(
                        self.db,
                        company_id=company_id,
                        warehouse_id=data.warehouse_id,
                        ingredient_id=data.ingredient_id,
                        quantity=data.quantity,
                        name=str(data.ingredient_id),
                    )
                    total = fifo_total
                    data = data.model_copy(update={"cost_price": fifo_unit})
                    fifo_ok = True
                except Exception:
                    fifo_ok = False
        payload = data.model_dump(exclude={"min_quantity"})
        movement = StockMovement(
            company_id=company_id,
            created_by=created_by,
            total_cost=total,
            **payload,
        )
        saved = await self.movement_repo.save(movement)

        # Update stock item
        result = await self.db.execute(
            select(StockItem).where(
                StockItem.company_id == company_id,
                StockItem.warehouse_id == data.warehouse_id,
                StockItem.ingredient_id == data.ingredient_id,
            )
        )
        stock = result.scalar_one_or_none()
        if stock:
            if data.movement_type in ("purchase", "adjustment"):
                # Партия уже создана ниже — здесь только min_quantity.
                pass
            elif data.movement_type in ("sale", "writeoff", "transfer"):
                if not fifo_ok:
                    # Партий не хватило — исторический минус.
                    stock.quantity -= data.quantity
                # Иначе consume_fifo уже пересчитал остаток через recalc.
            if data.min_quantity is not None:
                stock.min_quantity = data.min_quantity
            await self.stock_repo.save(stock)
        elif data.movement_type in ("purchase", "adjustment"):
            # BE-10 dependency fix: this branch never existed — a
            # brand-new ingredient's very first purchase/adjustment
            # movement was logged (StockMovement row written) but the
            # corresponding StockItem row was never created, so the
            # ingredient silently stayed at zero stock forever despite
            # the movement history saying otherwise.
            await self.stock_repo.save(StockItem(
                company_id=company_id, warehouse_id=data.warehouse_id,
                ingredient_id=data.ingredient_id, quantity=Decimal("0"),
                unit=data.unit, cost_price=Decimal("0"),
                min_quantity=data.min_quantity
                if data.min_quantity is not None else Decimal("0"),
            ))
        if data.movement_type in ("purchase", "adjustment"):
            stock_check = await self.db.execute(
                select(StockItem).where(
                    StockItem.company_id == company_id,
                    StockItem.warehouse_id == data.warehouse_id,
                    StockItem.ingredient_id == data.ingredient_id,
                )
            )
            if stock_check.scalar_one_or_none() is not None:
                await add_fifo_batch(
                    self.db,
                    company_id=company_id,
                    warehouse_id=data.warehouse_id,
                    ingredient_id=data.ingredient_id,
                    quantity=data.quantity,
                    cost_price=data.cost_price,
                    unit=data.unit,
                )
                # save() выше уже закоммитил движение и остаток —
                # партию и пересчёт коммитим отдельно, иначе потеряются.
                await self.db.commit()
        # sale/writeoff/transfer against a nonexistent StockItem: left as a
        # no-op, matching the prior behavior for the existing-row case with
        # no clamp — out of scope here to also introduce negative-stock
        # rejection across every movement type.
        return saved

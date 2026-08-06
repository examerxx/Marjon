from __future__ import annotations
from collections import defaultdict
from decimal import Decimal
from uuid import UUID
from sqlalchemy import delete as sql_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.modules.inventory.models import (
    Category, Ingredient, Product, ProductIngredient, StockItem, StockMovement, Warehouse
)
from app.modules.inventory.repository import (
    CategoryRepository, IngredientRepository, ProductRepository,
    StockItemRepository, StockMovementRepository, WarehouseRepository,
)
from app.modules.inventory.schemas import (
    CategoryCreate, IngredientCreate, IngredientUpdate, ProductCreate,
    ProductIngredientIn, ProductUpdate, StockMovementCreate,
)
from app.modules.printers.models import Printer
from app.shared.exceptions import NotFoundError

_PRODUCT_LOAD = selectinload(Product.ingredients).selectinload(ProductIngredient.ingredient)


class CategoryService:
    def __init__(self, db: AsyncSession):
        self.repo = CategoryRepository(db)

    async def create(self, company_id: UUID, data: CategoryCreate) -> Category:
        return await self.repo.save(Category(company_id=company_id, **data.model_dump()))

    async def list(self, company_id: UUID) -> list[Category]:
        return await self.repo.get_active(company_id)

    async def get(self, company_id: UUID, category_id: UUID) -> Category:
        cat = await self.repo.get_by_id(category_id, company_id)
        if not cat:
            raise NotFoundError("Category not found")
        return cat


class ProductService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = ProductRepository(db)

    async def _replace_ingredients(self, product_id: UUID, lines: list[ProductIngredientIn]) -> None:
        """Explicit DELETE + INSERT, not ORM-collection mutation — see
        SemiProductService (BE-10) for why: mutating `.ingredients` on a
        not-fully-loaded object triggers a sync lazy-load that blows up
        under the async engine."""
        await self.db.execute(
            sql_delete(ProductIngredient).where(ProductIngredient.product_id == product_id)
        )
        for line in lines:
            self.db.add(ProductIngredient(
                product_id=product_id, ingredient_id=line.ingredient_id, quantity=line.quantity,
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
                select(Category.id, Category.name).where(Category.id.in_(cat_ids))
            )).all()
            cat_names = dict(rows)

        printer_ids = {p.printer_id for p in products if p.printer_id}
        printer_names: dict[UUID, str] = {}
        if printer_ids:
            rows = (await self.db.execute(
                select(Printer.id, Printer.name).where(Printer.id.in_(printer_ids))
            )).all()
            printer_names = dict(rows)

        comp_by_product: dict[UUID, list[tuple[UUID, Decimal]]] = defaultdict(list)
        for p in products:
            for line in p.ingredients:
                comp_by_product[p.id].append((line.ingredient_id, line.quantity))

        ingredient_ids = {ing_id for lines in comp_by_product.values() for ing_id, _ in lines}
        stock_by_ingredient: dict[UUID, Decimal] = {}
        if ingredient_ids:
            rows = (await self.db.execute(
                select(StockItem.ingredient_id, func.sum(StockItem.quantity))
                .where(StockItem.company_id == company_id, StockItem.ingredient_id.in_(ingredient_ids))
                .group_by(StockItem.ingredient_id)
            )).all()
            stock_by_ingredient = dict(rows)

        for p in products:
            p.category_name = cat_names.get(p.category_id)
            p.subcategory_name = cat_names.get(p.subcategory_id)
            p.printer_name = printer_names.get(p.printer_id)
            lines = comp_by_product.get(p.id, [])
            p.ingredients_count = len(lines)
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
        payload = data.model_dump(exclude={"ingredients"})
        product = Product(company_id=company_id, **payload)
        self.db.add(product)
        await self.db.flush()
        if data.ingredients:
            await self._replace_ingredients(product.id, data.ingredients)
        await self.db.commit()
        return await self.get(company_id, product.id)

    async def list(self, company_id: UUID) -> list[Product]:
        products = await self.repo.get_available(company_id)
        return await self._reload_with_aggregates(products, company_id)

    async def list_all(self, company_id: UUID) -> list[Product]:
        products = await self.repo.get_all(company_id)
        return await self._reload_with_aggregates(products, company_id)

    async def _reload_with_aggregates(self, products: list[Product], company_id: UUID) -> list[Product]:
        if not products:
            return products
        ids = [p.id for p in products]
        result = await self.db.execute(
            select(Product).options(_PRODUCT_LOAD)
            .where(Product.id.in_(ids))
            .execution_options(populate_existing=True)
        )
        by_id = {p.id: p for p in result.scalars().all()}
        ordered = [by_id[p.id] for p in products if p.id in by_id]
        return await self._attach_aggregates(ordered, company_id)

    async def get(self, company_id: UUID, product_id: UUID) -> Product:
        result = await self.db.execute(
            select(Product).options(_PRODUCT_LOAD)
            .where(Product.id == product_id, Product.company_id == company_id)
            .execution_options(populate_existing=True)
        )
        p = result.scalar_one_or_none()
        if not p:
            raise NotFoundError("Product not found")
        await self._attach_aggregates([p], company_id)
        return p

    async def update(self, company_id: UUID, product_id: UUID, data: ProductUpdate) -> Product:
        p = await self.get(company_id, product_id)
        for field, value in data.model_dump(exclude_unset=True, exclude={"ingredients"}).items():
            setattr(p, field, value)
        if data.ingredients is not None:
            await self._replace_ingredients(p.id, data.ingredients)
        await self.db.commit()
        return await self.get(company_id, product_id)

    async def update_image(self, company_id: UUID, product_id: UUID, image_url: str) -> Product:
        p = await self.get(company_id, product_id)
        p.image_url = image_url
        await self.db.commit()
        return await self.get(company_id, product_id)

    async def delete(self, company_id: UUID, product_id: UUID) -> None:
        """Мягкое удаление блюда (снимаем с продажи, скрываем из каталога)."""
        p = await self.get(company_id, product_id)
        p.is_active = False
        if hasattr(p, "is_available"):
            p.is_available = False
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


class StockService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.stock_repo = StockItemRepository(db)
        self.movement_repo = StockMovementRepository(db)
        self.warehouse_repo = WarehouseRepository(db)

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

    async def create_movement(
        self, company_id: UUID, created_by: UUID, data: StockMovementCreate
    ) -> StockMovement:
        total = data.quantity * data.cost_price
        movement = StockMovement(
            company_id=company_id,
            created_by=created_by,
            total_cost=total,
            **data.model_dump(),
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
                stock.quantity += data.quantity
            elif data.movement_type in ("sale", "writeoff", "transfer"):
                stock.quantity -= data.quantity
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
                ingredient_id=data.ingredient_id, quantity=data.quantity,
                unit=data.unit, cost_price=data.cost_price,
            ))
        # sale/writeoff/transfer against a nonexistent StockItem: left as a
        # no-op, matching the prior behavior for the existing-row case with
        # no clamp — out of scope here to also introduce negative-stock
        # rejection across every movement type.
        return saved

from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.inventory.models import (
    Category, Ingredient, Product, StockItem, StockMovement, Warehouse
)
from app.modules.inventory.repository import (
    CategoryRepository, IngredientRepository, ProductRepository,
    StockItemRepository, StockMovementRepository, WarehouseRepository,
)
from app.modules.inventory.schemas import (
    CategoryCreate, IngredientCreate, ProductCreate, ProductUpdate, StockMovementCreate
)
from app.shared.exceptions import NotFoundError


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
        self.repo = ProductRepository(db)

    async def create(self, company_id: UUID, data: ProductCreate) -> Product:
        return await self.repo.save(Product(company_id=company_id, **data.model_dump()))

    async def list(self, company_id: UUID) -> list[Product]:
        return await self.repo.get_available(company_id)

    async def list_all(self, company_id: UUID) -> list[Product]:
        return await self.repo.get_all(company_id)

    async def get(self, company_id: UUID, product_id: UUID) -> Product:
        p = await self.repo.get_by_id(product_id, company_id)
        if not p:
            raise NotFoundError("Product not found")
        return p

    async def update(self, company_id: UUID, product_id: UUID, data: ProductUpdate) -> Product:
        p = await self.get(company_id, product_id)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(p, field, value)
        return await self.repo.save(p)

    async def update_image(self, company_id: UUID, product_id: UUID, image_url: str) -> Product:
        p = await self.get(company_id, product_id)
        p.image_url = image_url
        return await self.repo.save(p)

    async def delete(self, company_id: UUID, product_id: UUID) -> None:
        """Мягкое удаление блюда (снимаем с продажи, скрываем из каталога)."""
        p = await self.get(company_id, product_id)
        p.is_active = False
        if hasattr(p, "is_available"):
            p.is_available = False
        await self.repo.save(p)


class IngredientService:
    def __init__(self, db: AsyncSession):
        self.repo = IngredientRepository(db)

    async def create(self, company_id: UUID, data: IngredientCreate) -> Ingredient:
        return await self.repo.save(Ingredient(company_id=company_id, **data.model_dump()))

    async def list(self, company_id: UUID) -> list[Ingredient]:
        return await self.repo.get_all(company_id)

    async def get(self, company_id: UUID, ingredient_id: UUID) -> Ingredient:
        ing = await self.repo.get_by_id(ingredient_id, company_id)
        if not ing:
            raise NotFoundError("Ingredient not found")
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

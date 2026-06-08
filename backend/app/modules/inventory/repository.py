from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository, BaseRepository
from app.modules.inventory.models import (
    Category, Product, Ingredient, Warehouse, StockItem, StockMovement
)


class CategoryRepository(TenantRepository[Category]):
    def __init__(self, db: AsyncSession):
        super().__init__(Category, db)

    async def get_active(self, company_id: UUID) -> list[Category]:
        result = await self.db.execute(
            self._base_query(company_id).where(Category.is_active == True)
        )
        return list(result.scalars().all())


class ProductRepository(TenantRepository[Product]):
    def __init__(self, db: AsyncSession):
        super().__init__(Product, db)

    async def get_available(self, company_id: UUID) -> list[Product]:
        result = await self.db.execute(
            self._base_query(company_id)
            .where(Product.is_active == True, Product.is_available == True)
            .order_by(Product.sort_order)
        )
        return list(result.scalars().all())

    async def get_by_category(self, company_id: UUID, category_id: UUID) -> list[Product]:
        result = await self.db.execute(
            self._base_query(company_id).where(Product.category_id == category_id)
        )
        return list(result.scalars().all())


class IngredientRepository(TenantRepository[Ingredient]):
    def __init__(self, db: AsyncSession):
        super().__init__(Ingredient, db)


class WarehouseRepository(TenantRepository[Warehouse]):
    def __init__(self, db: AsyncSession):
        super().__init__(Warehouse, db)


class StockItemRepository(TenantRepository[StockItem]):
    def __init__(self, db: AsyncSession):
        super().__init__(StockItem, db)

    async def get_low_stock(self, company_id: UUID) -> list[StockItem]:
        from sqlalchemy import and_
        result = await self.db.execute(
            self._base_query(company_id).where(
                StockItem.quantity <= StockItem.min_quantity
            )
        )
        return list(result.scalars().all())


class StockMovementRepository(TenantRepository[StockMovement]):
    def __init__(self, db: AsyncSession):
        super().__init__(StockMovement, db)

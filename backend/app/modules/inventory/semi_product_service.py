from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from sqlalchemy import delete as sql_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.inventory.models import Ingredient, StockItem, StockMovement
from app.modules.inventory.semi_product_models import SemiProduct, SemiProductIngredient
from app.modules.inventory.semi_product_schemas import (
    SemiProductCreate, SemiProductIngredientIn, SemiProductUpdate,
)
from app.shared.exceptions import NotFoundError, ValidationError

_LOAD = selectinload(SemiProduct.ingredients).selectinload(SemiProductIngredient.ingredient)


class SemiProductService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _avg_ingredient_cost(self, company_id: UUID, ingredient_id: UUID) -> Decimal:
        """Average cost_price across this ingredient's StockItem rows (all
        warehouses) — a company can stock the same ingredient at different
        costs per warehouse, so there's no single "the" cost without
        picking one; averaging is a reasonable default for recipe costing."""
        result = await self.db.execute(
            select(func.avg(StockItem.cost_price)).where(
                StockItem.company_id == company_id,
                StockItem.ingredient_id == ingredient_id,
            )
        )
        avg = result.scalar_one_or_none()
        return Decimal(str(avg)) if avg is not None else Decimal("0")

    async def _replace_ingredients(
        self, semi_product_id: UUID, lines: list[SemiProductIngredientIn]
    ) -> None:
        """Explicit DELETE + INSERT rather than mutating the ORM
        relationship collection — `.ingredients.clear()`/`.append()` on a
        collection that hasn't been eagerly loaded triggers a synchronous
        lazy-load, which blows up under the async engine (MissingGreenlet).
        """
        await self.db.execute(
            sql_delete(SemiProductIngredient).where(
                SemiProductIngredient.semi_product_id == semi_product_id
            )
        )
        for line in lines:
            self.db.add(SemiProductIngredient(
                semi_product_id=semi_product_id,
                ingredient_id=line.ingredient_id,
                quantity=line.quantity,
            ))
        await self.db.flush()

    async def _recalc_cost(self, semi_product: SemiProduct) -> None:
        total = Decimal("0")
        for line in semi_product.ingredients:
            unit_cost = await self._avg_ingredient_cost(semi_product.company_id, line.ingredient_id)
            total += unit_cost * line.quantity
        semi_product.cost_price = total
        await self.db.flush()

    async def create(self, company_id: UUID, data: SemiProductCreate) -> SemiProduct:
        sp = SemiProduct(
            company_id=company_id, name=data.name, category_id=data.category_id,
            subcategory_id=data.subcategory_id, unit=data.unit, is_active=data.is_active,
        )
        self.db.add(sp)
        await self.db.flush()
        if data.ingredients:
            await self._replace_ingredients(sp.id, data.ingredients)
        sp = await self.get(company_id, sp.id)
        await self._recalc_cost(sp)
        await self.db.commit()
        return await self.get(company_id, sp.id)

    async def list(self, company_id: UUID) -> list[SemiProduct]:
        result = await self.db.execute(
            select(SemiProduct)
            .options(_LOAD)
            .where(SemiProduct.company_id == company_id)
            .order_by(SemiProduct.name)
        )
        return list(result.scalars().all())

    async def get(self, company_id: UUID, semi_product_id: UUID) -> SemiProduct:
        result = await self.db.execute(
            select(SemiProduct)
            .options(_LOAD)
            .where(SemiProduct.company_id == company_id, SemiProduct.id == semi_product_id)
            # populate_existing: _replace_ingredients() does a bulk (Core-
            # level) DELETE, which the ORM's identity map doesn't know
            # invalidates an already-loaded `.ingredients` collection on
            # an object it's still holding — without this, a re-fetch
            # right after replacing composition can silently return the
            # STALE, pre-replacement ingredient list.
            .execution_options(populate_existing=True)
        )
        sp = result.scalar_one_or_none()
        if sp is None:
            raise NotFoundError("Semi-product not found")
        return sp

    async def update(self, company_id: UUID, semi_product_id: UUID, data: SemiProductUpdate) -> SemiProduct:
        sp = await self.get(company_id, semi_product_id)
        for field in ("name", "category_id", "subcategory_id", "unit", "is_active"):
            value = getattr(data, field)
            if value is not None:
                setattr(sp, field, value)
        if data.ingredients is not None:
            await self._replace_ingredients(sp.id, data.ingredients)
            sp = await self.get(company_id, semi_product_id)
        await self._recalc_cost(sp)
        await self.db.commit()
        return await self.get(company_id, semi_product_id)

    async def delete(self, company_id: UUID, semi_product_id: UUID) -> None:
        sp = await self.get(company_id, semi_product_id)
        sp.is_active = False
        await self.db.commit()

    async def produce(
        self, company_id: UUID, user_id: UUID, semi_product_id: UUID,
        warehouse_id: UUID, quantity: Decimal,
    ) -> SemiProduct:
        """Списание ингредиентов со склада при производстве партии
        полуфабриката. All-or-nothing: stock is checked for every
        ingredient BEFORE any row is mutated, so a shortage on the last
        ingredient doesn't leave earlier ones partially deducted."""
        sp = await self.get(company_id, semi_product_id)
        if not sp.ingredients:
            raise ValidationError("У полуфабриката не задан состав")

        planned: list[tuple[SemiProductIngredient, StockItem]] = []
        for line in sp.ingredients:
            required_qty = line.quantity * quantity
            result = await self.db.execute(
                select(StockItem).where(
                    StockItem.company_id == company_id,
                    StockItem.warehouse_id == warehouse_id,
                    StockItem.ingredient_id == line.ingredient_id,
                )
            )
            stock = result.scalar_one_or_none()
            if not stock or stock.quantity < required_qty:
                name = line.ingredient.name if line.ingredient else str(line.ingredient_id)
                raise ValidationError(f"Недостаточно остатка «{name}» на складе для производства")
            planned.append((line, stock))

        for line, stock in planned:
            required_qty = line.quantity * quantity
            stock.quantity -= required_qty
            self.db.add(StockMovement(
                company_id=company_id, warehouse_id=warehouse_id, ingredient_id=line.ingredient_id,
                movement_type="writeoff", quantity=required_qty, unit=stock.unit,
                cost_price=stock.cost_price, total_cost=stock.cost_price * required_qty,
                ref_id=sp.id, created_by=user_id,
                note=f"Производство полуфабриката «{sp.name}» x{quantity}",
            ))
        await self.db.commit()
        return await self.get(company_id, semi_product_id)

from __future__ import annotations
from datetime import date
from decimal import Decimal
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.companies.models import Branch
from app.modules.inventory.models import Product
from app.modules.pos.models import Order, OrderItem, PosTerminal
from app.modules.pos.repository import OrderRepository, OrderItemRepository, TerminalRepository
from app.modules.pos.schemas import OrderCreate, OrderStatusUpdate, TerminalCreate
from app.shared.exceptions import NotFoundError, ValidationError


class OrderService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = OrderRepository(db)

    async def create(self, company_id: UUID, waiter_id: UUID, data: OrderCreate) -> Order:
        await self._get_branch(company_id, data.branch_id)
        order_number = await self.repo.get_next_number(company_id, data.branch_id)
        order = Order(
            company_id=company_id,
            waiter_id=waiter_id,
            order_number=order_number,
            branch_id=data.branch_id,
            terminal_id=data.terminal_id,
            customer_id=data.customer_id,
            order_type=data.order_type,
            table_number=data.table_number,
            persons_count=data.persons_count,
            note=data.note,
        )
        self.db.add(order)
        await self.db.flush()

        subtotal = Decimal("0")
        for item_data in data.items:
            product = await self._get_product(company_id, item_data.product_id)

            item_total = product.price * item_data.quantity
            subtotal += item_total
            item = OrderItem(
                order_id=order.id,
                product_id=product.id,
                name=product.name,
                price=product.price,
                quantity=item_data.quantity,
                total=item_total,
                note=item_data.note,
                modifiers=item_data.modifiers,
                course=item_data.course,
            )
            self.db.add(item)

        order.subtotal = subtotal
        order.total_amount = subtotal
        await self.db.commit()
        return await self.get(company_id, order.id)

    async def get(self, company_id: UUID, order_id: UUID) -> Order:
        order = await self.repo.get_by_id(order_id, company_id)
        if not order:
            raise NotFoundError("Order not found")
        return order

    async def list(
        self,
        company_id: UUID,
        branch_id: UUID | None = None,
        status: str | None = None,
        selected_date: date | None = None,
    ) -> list[Order]:
        if status:
            return await self.repo.get_by_status(company_id, status, branch_id, selected_date)
        return await self.repo.get_all(company_id, selected_date=selected_date)

    async def update_status(self, company_id: UUID, order_id: UUID, data: OrderStatusUpdate) -> Order:
        order = await self.get(company_id, order_id)
        order.status = data.status
        await self.repo.save(order)
        return await self.get(company_id, order_id)

    async def cancel(self, company_id: UUID, order_id: UUID) -> Order:
        order = await self.get(company_id, order_id)
        if order.status == "completed":
            raise ValidationError("Cannot cancel a completed order")
        order.status = "cancelled"
        return await self.repo.save(order)

    async def add_item(self, company_id: UUID, order_id: UUID, item_data) -> OrderItem:
        order = await self.get(company_id, order_id)
        product = await self._get_product(company_id, item_data.product_id)

        item_total = product.price * item_data.quantity
        item = OrderItem(
            order_id=order.id,
            product_id=product.id,
            name=product.name,
            price=product.price,
            quantity=item_data.quantity,
            total=item_total,
            note=item_data.note,
            modifiers=item_data.modifiers,
        )
        self.db.add(item)
        order.subtotal += item_total
        order.total_amount += item_total
        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def _get_branch(self, company_id: UUID, branch_id: UUID) -> Branch:
        result = await self.db.execute(
            select(Branch).where(Branch.id == branch_id, Branch.company_id == company_id)
        )
        branch = result.scalar_one_or_none()
        if not branch:
            raise NotFoundError("Branch not found")
        return branch

    async def _get_product(self, company_id: UUID, product_id: UUID) -> Product:
        result = await self.db.execute(
            select(Product).where(Product.id == product_id, Product.company_id == company_id)
        )
        product = result.scalar_one_or_none()
        if not product:
            raise NotFoundError("Product not found")
        return product

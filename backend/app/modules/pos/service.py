from __future__ import annotations
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.modules.companies.models import Branch
from app.modules.inventory.models import Product
from app.modules.pos.models import Order, OrderItem, PosTerminal
from app.modules.pos.repository import OrderRepository, OrderItemRepository, TerminalRepository
from app.modules.pos.schemas import (
    OrderCreate, OrderItemCreate, OrderStatusUpdate,
    OrderUpdate, TerminalCreate,
)
from app.shared.exceptions import NotFoundError, ValidationError

# ── Order status state machine ───────────────────────────────────────────────
VALID_TRANSITIONS: dict[str, set[str]] = {
    "new":       {"accepted", "cooking", "cancelled"},
    "accepted":  {"cooking", "cancelled"},
    "cooking":   {"ready", "cancelled"},
    "ready":     {"completed", "cancelled"},
    "completed": set(),           # final state — no transitions
    "cancelled": set(),           # final state — no transitions
}


def _quantize(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class OrderService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = OrderRepository(db)

    # ── Create ────────────────────────────────────────────────────────────────

    async def create(self, company_id: UUID, waiter_id: UUID, data: OrderCreate) -> Order:
        await self._get_branch(company_id, data.branch_id)
        order_number = await self._generate_daily_number(company_id, data.branch_id)

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
            item_total = _quantize(product.price * item_data.quantity)

            # Apply per-item discount if provided
            item_discount = _quantize(item_data.discount) if item_data.discount else Decimal("0")
            item_total_after_discount = max(item_total - item_discount, Decimal("0"))
            subtotal += item_total_after_discount

            item = OrderItem(
                order_id=order.id,
                product_id=product.id,
                name=product.name,
                price=product.price,
                quantity=item_data.quantity,
                discount=item_discount,
                total=item_total_after_discount,
                note=item_data.note,
                modifiers=item_data.modifiers,
                course=item_data.course,
            )
            self.db.add(item)

        # Calculate totals
        order.subtotal = subtotal
        self._recalculate_totals(order, data.discount_amount, data.service_fee_rate)
        await self.db.commit()
        return await self.get(company_id, order.id)

    # ── Read ──────────────────────────────────────────────────────────────────

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

    # ── Update status (state machine) ─────────────────────────────────────────

    async def update_status(self, company_id: UUID, order_id: UUID, data: OrderStatusUpdate) -> Order:
        order = await self.get(company_id, order_id)
        current = order.status
        target = data.status

        if target not in VALID_TRANSITIONS.get(current, set()):
            raise ValidationError(
                f"Невозможно перевести заказ из '{current}' в '{target}'. "
                f"Допустимые переходы: {VALID_TRANSITIONS.get(current, set()) or 'нет'}"
            )

        order.status = target
        await self.repo.save(order)
        return await self.get(company_id, order_id)

    # ── Cancel ────────────────────────────────────────────────────────────────

    async def cancel(self, company_id: UUID, order_id: UUID) -> Order:
        order = await self.get(company_id, order_id)
        if order.status in ("completed", "cancelled"):
            raise ValidationError(f"Невозможно отменить заказ в статусе '{order.status}'")
        order.status = "cancelled"
        return await self.repo.save(order)

    # ── Add item to existing order ────────────────────────────────────────────

    async def add_item(self, company_id: UUID, order_id: UUID, item_data: OrderItemCreate) -> Order:
        order = await self.get(company_id, order_id)
        if order.status in ("completed", "cancelled"):
            raise ValidationError("Нельзя добавить позицию к завершённому или отменённому заказу")

        product = await self._get_product(company_id, item_data.product_id)
        item_total = _quantize(product.price * item_data.quantity)
        item_discount = _quantize(item_data.discount) if item_data.discount else Decimal("0")
        item_total_after_discount = max(item_total - item_discount, Decimal("0"))

        item = OrderItem(
            order_id=order.id,
            product_id=product.id,
            name=product.name,
            price=product.price,
            quantity=item_data.quantity,
            discount=item_discount,
            total=item_total_after_discount,
            note=item_data.note,
            modifiers=item_data.modifiers,
            course=item_data.course,
        )
        self.db.add(item)

        order.subtotal += item_total_after_discount
        self._recalculate_totals(order)
        await self.db.commit()
        return await self.get(company_id, order_id)

    # ── Remove item from order ────────────────────────────────────────────────

    async def remove_item(self, company_id: UUID, order_id: UUID, item_id: UUID) -> Order:
        order = await self.get(company_id, order_id)
        if order.status in ("completed", "cancelled"):
            raise ValidationError("Нельзя удалить позицию из завершённого или отменённого заказа")

        item = await self._get_order_item(order, item_id)
        order.subtotal -= item.total
        item.status = "cancelled"
        item.total = Decimal("0")
        self._recalculate_totals(order)
        await self.db.commit()
        return await self.get(company_id, order_id)

    # ── Update order (discount / service fee / note) ──────────────────────────

    async def update_order(self, company_id: UUID, order_id: UUID, data: OrderUpdate) -> Order:
        order = await self.get(company_id, order_id)
        if order.status in ("completed", "cancelled"):
            raise ValidationError("Нельзя редактировать завершённый или отменённый заказ")

        if data.note is not None:
            order.note = data.note
        if data.table_number is not None:
            order.table_number = data.table_number
        if data.persons_count is not None:
            order.persons_count = data.persons_count

        self._recalculate_totals(order, data.discount_amount, data.service_fee_rate)
        await self.repo.save(order)
        return await self.get(company_id, order_id)

    # ── Internals ─────────────────────────────────────────────────────────────

    def _recalculate_totals(
        self,
        order: Order,
        discount_override: Decimal | None = None,
        service_fee_rate_override: float | None = None,
    ) -> None:
        """Recalculate tax, discount, service_fee, total_amount from subtotal."""
        subtotal = order.subtotal

        # Discount (manual amount)
        if discount_override is not None:
            order.discount_amount = _quantize(discount_override)
        after_discount = max(subtotal - order.discount_amount, Decimal("0"))

        # Tax (НДС 12% — from settings, applied after discount)
        tax_rate = Decimal(str(settings.default_tax_rate))
        order.tax_amount = _quantize(after_discount * tax_rate)

        # Service fee (rate-based)
        if service_fee_rate_override is not None:
            fee_rate = Decimal(str(service_fee_rate_override))
        else:
            fee_rate = Decimal(str(settings.default_service_fee_rate))
        order.service_fee = _quantize(after_discount * fee_rate)

        order.total_amount = _quantize(after_discount + order.tax_amount + order.service_fee)

    async def _generate_daily_number(self, company_id: UUID, branch_id: UUID) -> str:
        """Generate daily order number: YYYYMMDD-NNNN."""
        today = datetime.now(timezone.utc).date()
        today_start = datetime.combine(today, datetime.min.time())
        today_end = datetime.combine(today, datetime.max.time())

        result = await self.db.execute(
            select(func.count(Order.id)).where(
                Order.company_id == company_id,
                Order.branch_id == branch_id,
                Order.created_at >= today_start,
                Order.created_at <= today_end,
            )
        )
        count = result.scalar_one()
        seq = str(count + 1).zfill(4)
        return f"{today.strftime('%Y%m%d')}-{seq}"

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
            select(Product).where(
                Product.id == product_id,
                Product.company_id == company_id,
                Product.is_active == True,
            )
        )
        product = result.scalar_one_or_none()
        if not product:
            raise NotFoundError("Product not found or inactive")
        return product

    async def _get_order_item(self, order: Order, item_id: UUID) -> OrderItem:
        for item in order.items:
            if item.id == item_id and item.status != "cancelled":
                return item
        raise NotFoundError("Order item not found")


class TerminalService:
    def __init__(self, db: AsyncSession):
        self.repo = TerminalRepository(db)

    async def create(self, company_id: UUID, data: TerminalCreate) -> PosTerminal:
        return await self.repo.save(PosTerminal(company_id=company_id, **data.model_dump()))

    async def list(self, company_id: UUID) -> list[PosTerminal]:
        return await self.repo.get_all(company_id)

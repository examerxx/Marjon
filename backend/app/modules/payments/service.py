from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.payments.models import Payment
from app.modules.payments.repository import PaymentRepository
from app.modules.payments.schemas import PaymentCreate
from app.modules.pos.models import Order
from app.shared.exceptions import NotFoundError, ValidationError


class PaymentService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = PaymentRepository(db)

    async def process(self, company_id: UUID, cashier_id: UUID, data: PaymentCreate) -> Payment:
        result = await self.db.execute(
            select(Order).where(Order.id == data.order_id, Order.company_id == company_id)
        )
        order = result.scalar_one_or_none()
        if not order:
            raise NotFoundError("Order not found")

        if order.status in ("cancelled",):
            raise ValidationError("Невозможно оплатить отменённый заказ")

        if order.status == "completed":
            raise ValidationError("Заказ уже оплачен")

        # Validate payment amount matches order total
        if data.amount != order.total_amount:
            raise ValidationError(
                f"Сумма оплаты ({data.amount}) не совпадает с суммой заказа ({order.total_amount})"
            )

        # Cash change calculation
        change_given = None
        if data.method == "cash" and data.cash_received is not None:
            if data.cash_received < data.amount:
                raise ValidationError("Полученная сумма меньше суммы заказа")
            change_given = data.cash_received - data.amount

        payment = Payment(
            company_id=company_id,
            order_id=data.order_id,
            amount=data.amount,
            method=data.method,
            status="completed",
            cashier_id=cashier_id,
            cash_received=data.cash_received,
            change_given=change_given,
        )
        saved = await self.repo.save(payment)

        # Mark order as completed
        order.status = "completed"
        self.db.add(order)
        await self.db.commit()
        return saved

    async def list_for_order(self, company_id: UUID, order_id: UUID) -> list[Payment]:
        return await self.repo.get_by_order(company_id, order_id)

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
        result = await self.db.execute(select(Order).where(Order.id == data.order_id, Order.company_id == company_id))
        order = result.scalar_one_or_none()
        if not order:
            raise NotFoundError("Order not found")
        if order.status == "cancelled":
            raise ValidationError("Cannot pay for a cancelled order")
        if data.amount <= Decimal("0"):
            raise ValidationError("Payment amount must be positive")

        change_given = None
        if data.method == "cash" and data.cash_received is not None:
            if data.cash_received < data.amount:
                raise ValidationError("Cash received is less than the payment amount")
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
        # Single atomic transaction: the payment and the order status update
        # must commit together, never one without the other.
        self.db.add(payment)
        order.status = "completed"
        self.db.add(order)
        await self.db.commit()
        await self.db.refresh(payment)
        return payment

    async def list_for_order(self, company_id: UUID, order_id: UUID) -> list[Payment]:
        return await self.repo.get_by_order(company_id, order_id)

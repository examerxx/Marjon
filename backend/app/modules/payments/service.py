from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.service import AuditService
from app.modules.auth.models import User
from app.modules.finance.defaults import VIP_EXPENSE_CATEGORY_ID, VIP_PAYMENT_TYPE_ID
from app.modules.finance.idempotency import (
    OP_PAYMENT_PROCESS,
    SCOPE_COMPANY,
    FinancialOperationService,
    legacy_v1_fingerprint_compatibility,
    request_fingerprint_v2,
)
from app.modules.finance.models import FinancialOperation, FinTransaction
from app.modules.fiscal.runtime import FiscalRuntime, get_fiscal_runtime
from app.modules.fiscal.service import FiscalService
from app.modules.inventory.service import StockService
from app.modules.kitchen.websocket import kitchen_manager
from app.modules.payments.models import Payment
from app.modules.payments.repository import PaymentRepository
from app.modules.payments.schemas import PaymentCreate
from app.modules.pos.models import Order
from app.shared.exceptions import ConflictError, ForbiddenError, NotFoundError, ValidationError

logger = logging.getLogger(__name__)


FailureInjector = Callable[[str], Awaitable[None]]


class PaymentService:
    def __init__(
        self,
        db: AsyncSession,
        runtime: FiscalRuntime | None = None,
        failure_injector: FailureInjector | None = None,
    ):
        self.db = db
        self.repo = PaymentRepository(db)
        self.runtime = runtime or get_fiscal_runtime()
        self.failure_injector = failure_injector

    async def _checkpoint(self, name: str) -> None:
        if self.failure_injector is not None:
            await self.failure_injector(name)

    async def _operation_payment(
        self,
        operation: FinancialOperation,
        company_id: UUID,
    ) -> Payment:
        try:
            payment_id = UUID((operation.result_metadata or {})["payment_id"])
        except (KeyError, TypeError, ValueError):
            raise ConflictError("Stored idempotency result is unavailable")
        payment = (
            await self.db.execute(
                select(Payment).where(
                    Payment.id == payment_id,
                    Payment.company_id == company_id,
                )
            )
        ).scalar_one_or_none()
        if payment is None:
            raise ConflictError("Stored idempotency result is unavailable")
        return payment

    async def process(
        self,
        company_id: UUID,
        cashier_id: UUID,
        data: PaymentCreate,
        idempotency_key: str | None = None,
    ) -> Payment:
        try:
            order = (
                await self.db.execute(
                    select(Order)
                    .where(Order.id == data.order_id, Order.company_id == company_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
            if order is None:
                raise NotFoundError("Order not found")

            operation = None
            if idempotency_key is not None:
                claim = await FinancialOperationService(self.db).claim(
                    scope_kind=SCOPE_COMPANY,
                    scope_id=company_id,
                    operation_type=OP_PAYMENT_PROCESS,
                    idempotency_key=idempotency_key,
                    fingerprint=request_fingerprint_v2(data),
                    legacy_v1_fingerprint=lambda: (
                        legacy_v1_fingerprint_compatibility(data)
                    ),
                )
                operation = claim.operation
                if not claim.is_new:
                    payment = await self._operation_payment(operation, company_id)
                    await self.db.commit()
                    return payment

            if order.status == "cancelled":
                raise ValidationError("Cannot pay a cancelled order")
            # DEBT-ROLE-01 (закрытие дыры): «в долг» — это НЕ оплата, денег по нему
            # не приходило. Через /payments его проводить нельзя никому: иначе
            # официант обходил бы запрет на долг (PATCH /pos/orders/{id}/status его
            # блокирует), записывая полную сумму с method="debt" — заказ закрыт,
            # выручка в отчётах есть, а денег в кассе нет. Долг закрывается только
            # сменой статуса заказа, где проверяются роль и фактический недобор.
            if data.method.strip().lower() in ("debt", "в долг"):
                raise ValidationError(
                    "«В долг» — не оплата. Долг оформляется закрытием заказа, а не платежом"
                )
            if order.status == "completed":
                raise ValidationError("Order is already paid")
            # REOPEN-01: у возвращённого в работу заказа оплата уже была. Повторное
            # закрытие разрешено — прежние completed-платежи станут refunded, а
            # оплатой по новому (уменьшенному) итогу станет новая запись. Для
            # обычного заказа «уже оплачен» остаётся ошибкой.
            previous_payments = list((await self.db.execute(
                select(Payment).where(
                    Payment.company_id == company_id,
                    Payment.order_id == order.id,
                    Payment.status == "completed",
                )
            )).scalars().all())
            is_vip_request = data.method.strip().lower() == "vip"
            # VIP после частичной оплаты: гость уже заплатил часть наличными/картой,
            # остаток закрывается как VIP. Прежние частичные платежи остаются в силе.
            vip_after_partial = bool(
                is_vip_request and not data.partial and previous_payments and order.reopened_at is None
                and all((payment.provider_data or {}).get("partial") for payment in previous_payments)
            )
            if data.partial:
                if (order.reopened_at is not None or data.method not in ("cash", "card")
                    or any(not (payment.provider_data or {}).get("partial") for payment in previous_payments)):
                    raise ValidationError("This order does not support partial payments")
                remaining = order.total_amount - sum(payment.amount for payment in previous_payments)
                if data.amount <= 0 or data.amount > remaining or data.amount != data.amount.quantize(Decimal("0.01")):
                    raise ValidationError("Payment must be positive and within the remaining balance")
                closes_order = data.amount == remaining
            else:
                closes_order = True
            if not data.partial and previous_payments and order.reopened_at is None and not vip_after_partial:
                raise ValidationError("Order is already paid")
            if not data.partial and data.amount != order.total_amount:
                raise ValidationError(
                    f"Payment amount ({data.amount}) does not match order total ({order.total_amount})"
                )

            is_vip = is_vip_request
            if is_vip and ((previous_payments and not vip_after_partial) or data.cash_received is not None):
                raise ValidationError("VIP requires an unpaid order without cash received")
            vip_paid_before = sum((payment.amount for payment in previous_payments), Decimal("0")) if vip_after_partial else Decimal("0")

            if is_vip:
                from app.modules.pos.service import DEBT_FORBIDDEN_ROLE_SLUGS, _role_slugs_of

                cashier = await self.db.get(User, cashier_id)
                role_slugs = await _role_slugs_of(self.db, cashier)
                if role_slugs & DEBT_FORBIDDEN_ROLE_SLUGS:
                    raise ForbiddenError("Официант не может закрыть заказ как VIP")

            change_given = None
            if data.cash_amount is not None and data.cash_amount > 0:
                change_given = (data.cash_received if data.cash_received is not None else data.cash_amount) - data.cash_amount
            elif data.method == "cash" and data.cash_received is not None:
                if data.cash_received < data.amount:
                    raise ValidationError("Cash received is less than payment amount")
                change_given = data.cash_received - data.amount

            fiscal = FiscalService(self.db, self.runtime)
            fiscal_plan = None if is_vip else await fiscal.prepare_company(company_id)

            if data.partial and fiscal_plan is not None:
                raise ValidationError("Partial payments are unavailable with fiscal integration enabled")

            provider_data = {}
            if data.cash_amount is not None:
                provider_data["manual_breakdown"] = {
                    "cash": str(data.cash_amount), "card": str(data.card_amount),
                }
            if data.partial:
                provider_data["partial"] = True
                provider_data["remaining_amount"] = str(remaining - data.amount)

            payment = Payment(
                company_id=company_id,
                order_id=order.id,
                amount=0 if is_vip else data.amount,
                method="VIP" if is_vip else data.method,
                status="complimentary" if is_vip else "completed",
                cashier_id=cashier_id,
                cash_received=data.cash_received,
                change_given=change_given,
                provider_data=provider_data,
            )
            self.db.add(payment)
            await self.db.flush()
            # Возврат в закрытый заказ: прежняя оплата больше не действует —
            # отчёты должны видеть только новый итог, поэтому старые платежи
            # помечаем refunded (остаются в истории, но не в выручке).
            for prev in previous_payments if not (data.partial or vip_after_partial) else ():
                prev.status = "refunded"
                prev.provider_data = {
                    **(prev.provider_data or {}),
                    "refunded_by_payment_id": str(payment.id),
                }
                self.db.add(prev)
            await self._checkpoint("after_payment")

            if closes_order:
                order.status = "completed"
                self.db.add(order)
                await self.db.flush()
                # Financial completion does not imply kitchen readiness or handoff.
                await self._checkpoint("after_order")

                # Списание сырья по рецептам блюд завершённого заказа.
                # Идемпотентно (повторная оплата того же заказа не спишет
                # дважды); минус разрешён. Ошибка списания не должна ронять
                # оплату — логируем и продолжаем.
                if is_vip:
                    self.db.add(FinTransaction(
                        company_id=company_id,
                        amount=order.total_amount - vip_paid_before,
                        direction="expense",
                        payment_type_id=VIP_PAYMENT_TYPE_ID,
                        category_id=VIP_EXPENSE_CATEGORY_ID,
                        comment=f"VIP · Заказ #{order.order_number}",
                        user_id=cashier_id,
                    ))
                    await StockService(self.db).deduct_for_order(
                        company_id, order.id, created_by=cashier_id
                    )
                else:
                    try:
                        await StockService(self.db).deduct_for_order(
                            company_id, order.id, created_by=cashier_id
                        )
                    except Exception:
                        logger.exception(
                            "recipe stock deduction failed for order %s", order.id
                        )

                if fiscal_plan is not None:
                    await fiscal.schedule_payment(
                        company_id=company_id,
                        order=order,
                        payment=payment,
                        plan=fiscal_plan,
                        checkpoint=self._checkpoint,
                    )

            if operation is not None:
                FinancialOperationService.complete(
                    operation, {"payment_id": str(payment.id)}
                )
            await self._checkpoint("before_commit")
            await self.db.commit()
            await self.db.refresh(payment)
        except Exception:
            await self.db.rollback()
            raise

        try:
            await kitchen_manager.broadcast(
                company_id,
                order.branch_id,
                "order_completed" if closes_order else "order_updated",
                {"order_id": str(order.id), "order_number": order.order_number},
            )
        except Exception:
            pass

        try:
            await AuditService(self.db).log(
                company_id,
                cashier_id,
                "order.vip_close" if is_vip else "payment.create",
                "payment",
                entity_id=payment.id,
                new_data={
                    "order_id": str(order.id),
                    "amount": str(payment.amount),
                    "method": payment.method,
                },
            )
        except Exception:
            await self.db.rollback()

        return payment

    async def reset_partial(
        self, company_id: UUID, order_id: UUID, actor: User,
        expected_ids: set[UUID], branch_id: UUID | None = None,
    ) -> None:
        from app.modules.audit.models import AuditLog
        from app.modules.pos.service import DEBT_FORBIDDEN_ROLE_SLUGS, _role_slugs_of

        roles = await _role_slugs_of(self.db, actor)
        if roles & DEBT_FORBIDDEN_ROLE_SLUGS:
            raise ForbiddenError("Only a cashier can reset partial payments")
        order_query = select(Order).where(Order.id == order_id, Order.company_id == company_id)
        if branch_id is not None:
            order_query = order_query.where(Order.branch_id == branch_id)
        order = (await self.db.execute(order_query.with_for_update())).scalar_one_or_none()
        if order is None:
            raise NotFoundError("Order not found")
        if order.status in ("completed", "cancelled") or getattr(order, "reopened_at", None) is not None:
            raise ValidationError("Only open orders with partial payments may be reset")
        rows = (await self.db.execute(select(Payment).where(
            Payment.company_id == company_id, Payment.order_id == order_id,
            Payment.status == "completed",
        ))).scalars().all()
        if rows and ({row.id for row in rows} != expected_ids
                     or any(not (row.provider_data or {}).get("partial") for row in rows)):
            raise ConflictError("Payments changed. Reopen the payment window and try again.")
        for row in rows:
            row.status = "voided"
        if rows:
            self.db.add(AuditLog(
                company_id=company_id, user_id=actor.id, action="payment.partial_reset",
                entity_type="order", entity_id=order_id,
                new_data={"payments": [str(row.id) for row in rows],
                          "amount": str(sum(row.amount for row in rows))},
            ))
        await self.db.commit()

    async def list_for_order(
        self,
        company_id: UUID,
        order_id: UUID,
    ) -> list[Payment]:
        return await self.repo.get_by_order(company_id, order_id)

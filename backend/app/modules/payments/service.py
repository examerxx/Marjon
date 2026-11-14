from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.service import AuditService
from app.modules.finance.idempotency import (
    OP_PAYMENT_PROCESS,
    SCOPE_COMPANY,
    FinancialOperationService,
    legacy_v1_fingerprint_compatibility,
    request_fingerprint_v2,
)
from app.modules.finance.models import FinancialOperation
from app.modules.fiscal.runtime import FiscalRuntime, get_fiscal_runtime
from app.modules.fiscal.service import FiscalService
from app.modules.inventory.service import StockService
from app.modules.kitchen.websocket import kitchen_manager
from app.modules.payments.models import Payment
from app.modules.payments.repository import PaymentRepository
from app.modules.payments.schemas import PaymentCreate
from app.modules.pos.models import Order
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError

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
            if str(data.method or "").strip().lower() == "debt":
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
            if previous_payments and order.reopened_at is None:
                raise ValidationError("Order is already paid")
            if data.amount != order.total_amount:
                raise ValidationError(
                    f"Payment amount ({data.amount}) does not match order total ({order.total_amount})"
                )

            change_given = None
            if data.cash_amount is not None and data.cash_amount > 0:
                change_given = (data.cash_received if data.cash_received is not None else data.cash_amount) - data.cash_amount
            elif data.method == "cash" and data.cash_received is not None:
                if data.cash_received < data.amount:
                    raise ValidationError("Cash received is less than payment amount")
                change_given = data.cash_received - data.amount

            fiscal = FiscalService(self.db, self.runtime)
            fiscal_plan = await fiscal.prepare_company(company_id)

            payment = Payment(
                company_id=company_id,
                order_id=order.id,
                amount=data.amount,
                method=data.method,
                status="completed",
                cashier_id=cashier_id,
                cash_received=data.cash_received,
                change_given=change_given,
                provider_data={
                    **({"manual_breakdown": {
                        "cash": str(data.cash_amount), "card": str(data.card_amount),
                    }} if data.cash_amount is not None else {}),
                    # OFFLINE-01: оплата принята кассой без сети; время терминала
                    # сохраняем для аудита и контроля срока фискализации.
                    **({"offline_import": True,
                        "client_created_at": data.client_created_at.isoformat()}
                       if data.offline_import else {}),
                },
            )
            self.db.add(payment)
            await self.db.flush()
            # Возврат в закрытый заказ: прежняя оплата больше не действует —
            # отчёты должны видеть только новый итог, поэтому старые платежи
            # помечаем refunded (остаются в истории, но не в выручке).
            for prev in previous_payments:
                prev.status = "refunded"
                prev.provider_data = {
                    **(prev.provider_data or {}),
                    "refunded_by_payment_id": str(payment.id),
                }
                self.db.add(prev)
            await self._checkpoint("after_payment")

            order.status = "completed"
            self.db.add(order)
            await self.db.flush()
            # Financial completion does not imply kitchen readiness or handoff.
            await self._checkpoint("after_order")

            # Списание сырья по рецептам блюд завершённого заказа.
            # Идемпотентно (повторная оплата того же заказа не спишет
            # дважды); минус разрешён. Ошибка списания не должна ронять
            # оплату — логируем и продолжаем.
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
                "order_completed",
                {"order_id": str(order.id), "order_number": order.order_number},
            )
        except Exception:
            pass

        # OFFLINE-01: деньги, принятые кассой без сети, дошли до сервера.
        # Если заказ сам был офлайн, владелец уже получил уведомление при его
        # создании — второй раз не будим; иначе (связь пропала только на
        # оплате) это единственная новость о продаже.
        if data.offline_import and order.created_offline_at is None:
            try:
                from app.modules.notifications.service import NotificationService
                await NotificationService(self.db).notify_offline_payment_synced(
                    company_id, order, data.amount
                )
                await self.db.commit()
            except Exception:
                await self.db.rollback()
                logger.warning(
                    "offline payment notification failed for order %s", order.id, exc_info=True
                )

        try:
            await AuditService(self.db).log(
                company_id,
                cashier_id,
                "payment.create",
                "payment",
                entity_id=payment.id,
                new_data={
                    "order_id": str(order.id),
                    "amount": str(data.amount),
                    "method": data.method,
                    **({"offline_import": True,
                        "client_created_at": data.client_created_at.isoformat()}
                       if data.offline_import else {}),
                },
            )
        except Exception:
            await self.db.rollback()

        return payment

    async def list_for_order(
        self,
        company_id: UUID,
        order_id: UUID,
    ) -> list[Payment]:
        return await self.repo.get_by_order(company_id, order_id)

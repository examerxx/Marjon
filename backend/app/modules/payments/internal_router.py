from __future__ import annotations
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.infrastructure.database.session import get_db
from app.modules.finance.idempotency import (
    OP_PAYMENT_WEBHOOK_CONFIRM,
    SCOPE_COMPANY,
    FinancialOperationService,
    legacy_v1_fingerprint_compatibility,
    request_fingerprint_v2,
)
from app.modules.fiscal.runtime import FiscalRuntime, get_fiscal_runtime
from app.modules.fiscal.service import FiscalService
from app.modules.payments.models import Payment
from app.modules.pos.models import Order
from app.modules.kitchen.websocket import kitchen_manager

router = APIRouter(prefix="/internal", tags=["internal"])


def verify_secret(x_webhook_secret: str = Header(...)) -> None:
    if x_webhook_secret != settings.webhook_secret:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


# ── Order lookup for gateways ─────────────────────────────────────────────────

@router.get("/orders/{order_id}", dependencies=[Depends(verify_secret)])
async def get_order_for_gateway(order_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return {
        "id": str(order.id),
        "total_amount": float(order.total_amount),
        "status": order.status,
        "company_id": str(order.company_id),
    }


# ── Payment webhook from gateways ─────────────────────────────────────────────

class PaymentWebhookIn(BaseModel):
    order_id: UUID
    amount: Decimal
    method: str          # "payme" | "click"
    gateway_tx_id: str
    action: str          # "confirm" | "cancel"


@router.post("/payment-webhook", dependencies=[Depends(verify_secret)],
             status_code=status.HTTP_200_OK)
async def payment_webhook(
    data: PaymentWebhookIn,
    db: AsyncSession = Depends(get_db),
    runtime: FiscalRuntime = Depends(get_fiscal_runtime),
):
    result = await db.execute(
        select(Order).where(Order.id == data.order_id).with_for_update()
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if data.action == "confirm":
        claim = await FinancialOperationService(db).claim(
            scope_kind=SCOPE_COMPANY,
            scope_id=order.company_id,
            operation_type=OP_PAYMENT_WEBHOOK_CONFIRM,
            # Gateway identifiers may exceed the public 128-char header
            # contract; hash them without logging or truncation collisions.
            idempotency_key=hashlib.sha256(
                data.gateway_tx_id.encode("utf-8")
            ).hexdigest(),
            fingerprint=request_fingerprint_v2(data),
            legacy_v1_fingerprint=lambda: (
                legacy_v1_fingerprint_compatibility(data)
            ),
        )
        if not claim.is_new:
            await db.commit()
            return {"ok": True}

        if order.status == "completed":
            FinancialOperationService.complete(
                claim.operation,
                {"order_id": str(order.id), "already_completed": True},
            )
            await db.commit()
            return {"ok": True}

        completed_payment_id = await db.scalar(
            select(Payment.id)
            .where(
                Payment.company_id == order.company_id,
                Payment.order_id == order.id,
                Payment.status == "completed",
            )
            .limit(1)
        )
        if completed_payment_id is not None:
            FinancialOperationService.complete(
                claim.operation,
                {"order_id": str(order.id), "already_completed": True},
            )
            await db.commit()
            return {"ok": True}

        fiscal = FiscalService(db, runtime)
        fiscal_plan = await fiscal.prepare_company(order.company_id)

        payment = Payment(
            company_id=order.company_id,
            order_id=order.id,
            amount=data.amount,
            method=data.method,
            status="completed",
            fiscal_code=data.gateway_tx_id,
        )
        db.add(payment)
        await db.flush()
        order.status = "completed"
        db.add(order)
        await db.flush()
        if fiscal_plan is not None:
            await fiscal.schedule_payment(
                company_id=order.company_id,
                order=order,
                payment=payment,
                plan=fiscal_plan,
            )
        FinancialOperationService.complete(
            claim.operation,
            {"order_id": str(order.id), "payment_id": str(payment.id)},
        )
        await db.commit()

        try:
            await kitchen_manager.broadcast(
                order.company_id, order.branch_id, "order_completed",
                {"order_id": str(order.id), "order_number": order.order_number},
            )
        except Exception:
            pass

    elif data.action == "cancel":
        if order.status == "completed":
            order.status = "cancelled"
            # Phase 1A system cancellation: no authenticated user, so
            # cancelled_by_id stays NULL. Fill cancelled_at idempotently.
            if getattr(order, "cancelled_at", None) is None:
                order.cancelled_at = datetime.now(timezone.utc)
            db.add(order)
            await db.commit()

    return {"ok": True}

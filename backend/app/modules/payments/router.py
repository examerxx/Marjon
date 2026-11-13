from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Body, Depends, Header, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import (
    effective_branch_filter,
    require_company_admin,
    require_company_app_user,
)
from app.modules.auth.models import User
from app.modules.payments.models import PaymentGatewaySettings
from app.modules.fiscal.runtime import FiscalRuntime, get_fiscal_runtime
from app.modules.payments.schemas import (
    GatewaySettingsResponse, GatewaySettingsUpdate,
    PaymentCreate, PaymentResponse,
)
from app.modules.payments.service import PaymentService

router = APIRouter(prefix="/payments", tags=["payments"])


@router.post("", response_model=PaymentResponse, status_code=status.HTTP_201_CREATED)
async def process_payment(
    data: PaymentCreate,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
    runtime: FiscalRuntime = Depends(get_fiscal_runtime),
):
    return await PaymentService(db, runtime).process(
        user.company_id, user.id, data, idempotency_key
    )


@router.get("/order/{order_id}", response_model=list[PaymentResponse])
async def order_payments(
    order_id: UUID,
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    return await PaymentService(db).list_for_order(user.company_id, order_id)


@router.post("/order/{order_id}/reset-partial", status_code=status.HTTP_204_NO_CONTENT)
async def reset_partial_payments(
    order_id: UUID,
    payment_ids: set[UUID] = Body(embed=True),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    await PaymentService(db).reset_partial(
        user.company_id, order_id, user, payment_ids, effective_branch_filter(user),
    )


# ── Gateway settings (owner only) ─────────────────────────────────────────────

@router.get(
    "/gateway-settings",
    response_model=GatewaySettingsResponse,
    dependencies=[Depends(require_company_app_user)],
)
async def get_gateway_settings(
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PaymentGatewaySettings).where(
            PaymentGatewaySettings.company_id == user.company_id
        )
    )
    cfg = result.scalar_one_or_none()
    if cfg is None:
        return GatewaySettingsResponse(
            payme_enabled=False, payme_merchant_id=None,
            click_enabled=False, click_merchant_id=None, click_service_id=None,
            uzum_enabled=False, uzum_store_id=None,
        )
    return GatewaySettingsResponse(
        payme_enabled=cfg.payme_enabled,
        payme_merchant_id=cfg.payme_merchant_id,
        click_enabled=cfg.click_enabled,
        click_merchant_id=cfg.click_merchant_id,
        click_service_id=cfg.click_service_id,
        uzum_enabled=cfg.uzum_enabled,
        uzum_store_id=cfg.uzum_store_id,
    )


@router.put(
    "/gateway-settings",
    response_model=GatewaySettingsResponse,
    dependencies=[Depends(require_company_app_user)],
)
async def save_gateway_settings(
    data: GatewaySettingsUpdate,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PaymentGatewaySettings).where(
            PaymentGatewaySettings.company_id == user.company_id
        )
    )
    cfg = result.scalar_one_or_none()
    if cfg is None:
        cfg = PaymentGatewaySettings(company_id=user.company_id)
        db.add(cfg)

    cfg.payme_enabled      = data.payme_enabled
    cfg.payme_merchant_id  = data.payme_merchant_id
    if data.payme_key is not None:       # only update if provided (don't clear with None)
        cfg.payme_key = data.payme_key

    cfg.click_enabled      = data.click_enabled
    cfg.click_merchant_id  = data.click_merchant_id
    cfg.click_service_id   = data.click_service_id
    if data.click_secret_key is not None:
        cfg.click_secret_key = data.click_secret_key

    cfg.uzum_enabled   = data.uzum_enabled
    cfg.uzum_store_id  = data.uzum_store_id
    if data.uzum_key is not None:
        cfg.uzum_key = data.uzum_key

    await db.commit()
    await db.refresh(cfg)

    return GatewaySettingsResponse(
        payme_enabled=cfg.payme_enabled,
        payme_merchant_id=cfg.payme_merchant_id,
        click_enabled=cfg.click_enabled,
        click_merchant_id=cfg.click_merchant_id,
        click_service_id=cfg.click_service_id,
        uzum_enabled=cfg.uzum_enabled,
        uzum_store_id=cfg.uzum_store_id,
    )

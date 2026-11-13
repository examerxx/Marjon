# SlowAPI requires evaluated endpoint annotations for FastAPI's type resolution.
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import (
    effective_branch_filter,
    require_company_app_user,
    require_kitchen_access,
    require_permission_or_admin,
)
from app.modules.auth.models import User
from app.modules.kitchen.schemas import (
    DisplayBoard,
    DisplaySettingsResponse,
    DisplaySettingsUpdate,
    KitchenItemStatusUpdate,
    StationCreate,
    StationResponse,
)
from app.modules.kitchen.service import KitchenService
from app.modules.pos.schemas import OrderResponse
from app.shared.rate_limit import limiter

router = APIRouter(prefix="/kitchen", tags=["kitchen"])


@router.post("/stations", response_model=StationResponse, status_code=status.HTTP_201_CREATED)
async def create_station(data: StationCreate, user: User = Depends(require_kitchen_access), db: AsyncSession = Depends(get_db)):
    return await KitchenService(db).create_station(user.company_id, data)


@router.get("/stations", response_model=list[StationResponse])
async def list_stations(user: User = Depends(require_kitchen_access), db: AsyncSession = Depends(get_db)):
    return await KitchenService(db).list_stations(user.company_id)


@router.get("/orders", response_model=list[OrderResponse])
async def active_orders(
    branch_id: UUID | None = Query(None),
    user: User = Depends(require_kitchen_access),
    db: AsyncSession = Depends(get_db),
):
    # Branch-изоляция: сессия филиала видит кухонные заказы только своего
    # филиала. Кухонный экран знает свой филиал из токена и может не передавать
    # branch_id вовсе — тогда берём привязку сессии.
    resolved = effective_branch_filter(user, branch_id)
    if resolved is None:
        raise HTTPException(
            status_code=422,
            detail="branch_id is required for a network-wide session",
        )
    return await KitchenService(db).get_active_orders(user.company_id, resolved)


@router.get("/display", response_model=DisplayBoard)
@limiter.limit("120/minute")
async def visitor_display(
    request: Request,
    branch_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """ТВ-экран для посетителей: номера заказов и «готов / в очереди».

    Ручка публичная: телевизор в зале не логинится. Ссылка на него содержит
    id филиала, поэтому отдаём минимум — номер заказа и статус, без состава,
    сумм и столов. Только заказы текущего дня, с частотным лимитом.
    """
    return await KitchenService(db).get_display_orders(branch_id)


@router.get("/display/settings", response_model=DisplaySettingsResponse)
async def display_settings(
    branch_id: UUID | None = Query(None),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Состояние выключателя ТВ-экрана для настроек десктопа."""
    resolved = effective_branch_filter(user, branch_id)
    if resolved is None:
        raise HTTPException(
            status_code=422,
            detail="branch_id is required for a network-wide session",
        )
    return await KitchenService(db).get_display_settings(user.company_id, resolved)


@router.patch("/display/settings", response_model=DisplaySettingsResponse)
async def update_display_settings(
    data: DisplaySettingsUpdate,
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Включить/выключить экран очереди. Выключенный экран не отдаёт номера."""
    resolved = effective_branch_filter(user, data.branch_id)
    if resolved is None:
        raise HTTPException(
            status_code=422,
            detail="branch_id is required for a network-wide session",
        )
    return await KitchenService(db).set_display_enabled(
        user.company_id, resolved, data.enabled
    )


@router.get("/expo/orders", response_model=list[OrderResponse])
async def expo_orders(
    branch_id: UUID | None = Query(None),
    user: User = Depends(require_permission_or_admin("can_expo")),
    db: AsyncSession = Depends(get_db),
):
    """Очередь раздачи: повар отметил блюда готовыми, гость ещё не получил.

    Отдельный экран от кухни. Доступ — по праву «Раздача» в карточке
    сотрудника и только на его филиале.
    """
    resolved = effective_branch_filter(user, branch_id)
    if resolved is None:
        raise HTTPException(
            status_code=422,
            detail="branch_id is required for a network-wide session",
        )
    return await KitchenService(db).get_expo_orders(user.company_id, resolved)


@router.patch("/expo/orders/{order_id}/confirm", response_model=OrderResponse)
async def confirm_expo(
    order_id: UUID,
    user: User = Depends(require_permission_or_admin("can_expo")),
    db: AsyncSession = Depends(get_db),
):
    """Раздача подтверждает выдачу — заказ становится «готов» на ТВ."""
    return await KitchenService(db).confirm_expo(
        user.company_id, order_id, actor_id=user.id, branch_id=effective_branch_filter(user)
    )


@router.patch("/orders/items/status")
async def update_item_status(data: KitchenItemStatusUpdate, user: User = Depends(require_kitchen_access), db: AsyncSession = Depends(get_db)):
    return await KitchenService(db).update_item_status(
        user.company_id, data, actor_id=user.id, branch_id=effective_branch_filter(user)
    )


@router.patch("/orders/{order_id}/ready", response_model=OrderResponse)
async def mark_order_ready(
    order_id: UUID,
    user: User = Depends(require_kitchen_access),
    db: AsyncSession = Depends(get_db),
):
    """Mark all dishes ready atomically, independently of payment."""
    return await KitchenService(db).mark_order_ready(
        user.company_id, order_id, actor_id=user.id, branch_id=effective_branch_filter(user)
    )

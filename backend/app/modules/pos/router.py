# SlowAPI registers a wrapper whose global namespace is ``slowapi.extension``.
# Keep endpoint annotations runtime-evaluated in this module so FastAPI sees
# the concrete OrderCreate body after ``@limiter.limit`` wraps the function.
from datetime import date
from uuid import UUID
from fastapi import APIRouter, Depends, Header, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import (
    require_company_app_user,
    require_web_owner,
    effective_branch_filter,
)
from app.modules.auth.models import User
from app.modules.pos.schemas import (
    OrderCreate, OrderItemCreate, OrderItemQuantityUpdate, OrderItemWaiterUpdate, OrderItemsAdd, OrderItemsAdjust,
    OrderResponse, OrderReopen, OrderStatusUpdate, OrderUpdate,
    TerminalCreate, TerminalResponse,
    ShiftOpen, ShiftClose, ShiftResponse, MyShiftSummary,
)
from app.modules.pos.service import OrderService, TerminalService, ShiftService
from app.shared.rate_limit import limiter

router = APIRouter(prefix="/pos", tags=["pos"])


@router.post("/orders", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("120/minute")
async def create_order(request: Request, data: OrderCreate, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    # Branch-изоляция: сессия филиала создаёт заказы только в своём филиале —
    # не доверяем branch_id из тела, подставляем branch_id принципала.
    if getattr(user, "branch_id", None):
        data = data.model_copy(update={"branch_id": user.branch_id})
    return await OrderService(db, branch_scope=effective_branch_filter(user)).create(user.company_id, user.id, data)


@router.get("/orders", response_model=list[OrderResponse])
async def list_orders(
    branch_id: UUID | None = Query(None),
    status: str | None = Query(None),
    date: date | None = Query(None),
    active_only: bool = Query(False, description="Только активные: new/accepted/cooking/ready"),
    table_number: str | None = Query(None, description="Фильтр по номеру стола"),
    limit: int = Query(200, ge=1, le=1000, description="Максимум строк"),
    offset: int = Query(0, ge=0, description="Смещение"),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    # Branch-изоляция: филиалу отдаём только его заказы (его branch_id перебивает
    # запрошенный); владелец сети (branch_id=NULL) видит всё/фильтрует как раньше.
    branch_id = effective_branch_filter(user, branch_id)
    return await OrderService(db, branch_scope=effective_branch_filter(user)).list(
        user.company_id, branch_id, status, date, active_only, table_number, limit, offset
    )


@router.delete("/orders/purge", response_model=dict)
async def purge_orders(
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    """Массовая очистка отчётов (Настройки → «Очистить все отчеты»).

    Полностью удаляет ВСЕ заказы компании вместе с позициями, платежами,
    чеками и доставками — все отчёты категории «Отчёты» становятся пустыми,
    включая отчёт по отменам. Только владелец. Действие необратимо.
    """
    return await OrderService(db).purge_company_orders(user.company_id)


@router.get("/orders/{order_id}", response_model=OrderResponse)
async def get_order(order_id: UUID, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db, branch_scope=effective_branch_filter(user)).get(user.company_id, order_id)


@router.patch("/orders/{order_id}", response_model=OrderResponse)
async def update_order(order_id: UUID, data: OrderUpdate, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db, branch_scope=effective_branch_filter(user)).update_order(user.company_id, order_id, data, user)


@router.patch("/orders/{order_id}/status", response_model=OrderResponse)
async def update_order_status(order_id: UUID, data: OrderStatusUpdate, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db, branch_scope=effective_branch_filter(user)).update_status(
        user.company_id, order_id, data, actor_id=user.id, user=user
    )


@router.post("/orders/{order_id}/reopen", response_model=OrderResponse)
async def reopen_order(
    order_id: UUID, data: OrderReopen | None = None,
    user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db),
):
    """Вернуть закрытый заказ в работу (гость вернул блюдо / не получил его).

    Дальше кассир отменяет позицию с причиной, итог уменьшается, сдача
    выдаётся, заказ закрывается снова — прежние платежи становятся refunded.
    """
    return await OrderService(db, branch_scope=effective_branch_filter(user)).reopen(
        user.company_id, order_id, (data.reason if data else None), user
    )


@router.delete("/orders/{order_id}", response_model=OrderResponse)
async def cancel_order(order_id: UUID, password: str | None = Query(None), comment: str | None = Query(None), user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db, branch_scope=effective_branch_filter(user)).cancel(user.company_id, order_id, password, comment, user)


@router.post("/orders/{order_id}/items", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
async def add_item(order_id: UUID, data: OrderItemCreate, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db, branch_scope=effective_branch_filter(user)).add_item(user.company_id, order_id, data, user)


@router.post("/orders/{order_id}/items/bulk", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
async def add_items(order_id: UUID, data: OrderItemsAdd, idempotency_key: str | None = Header(None, alias="Idempotency-Key"), user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    """Дозаказ пачкой: новые блюда уходят повару одним кухонным тикетом."""
    return await OrderService(db, branch_scope=effective_branch_filter(user)).add_items(user.company_id, order_id, data.items, user, idempotency_key)


@router.post("/orders/{order_id}/items/adjust", response_model=OrderResponse)
async def adjust_items(order_id: UUID, data: OrderItemsAdjust, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    """«Сохранить» в заказе: плюс/минус на внесённых позициях одной командой.

    Уменьшение (отмена части блюда) подтверждается паролем; на кухню уходит
    тикет «ОТМЕНА БЛЮДА» и/или тикет с добавленным количеством.
    """
    return await OrderService(db, branch_scope=effective_branch_filter(user)).adjust_items(
        user.company_id, order_id, [(change.item_id, change.quantity) for change in data.changes],
        user, pin=data.pin, reason=data.reason,
    )


@router.delete("/orders/{order_id}/items/{item_id}", response_model=OrderResponse)
async def remove_item(order_id: UUID, item_id: UUID, reason: str | None = Query(None), pin: str | None = Query(None), user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db, branch_scope=effective_branch_filter(user)).remove_item(user.company_id, order_id, item_id, reason, user, pin)


@router.patch("/orders/{order_id}/items/{item_id}", response_model=OrderResponse)
async def set_item_quantity(order_id: UUID, item_id: UUID, data: OrderItemQuantityUpdate, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    """Плюс/минус на уже внесённой позиции: касса меняет количество до оплаты."""
    return await OrderService(db, branch_scope=effective_branch_filter(user)).set_item_quantity(user.company_id, order_id, item_id, data.quantity, user, price=data.price)


@router.post("/orders/{order_id}/items/{item_id}/move", response_model=OrderResponse)
async def move_item(order_id: UUID, item_id: UUID, table: str = Query(...), pin: str | None = Query(None), user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    """Перекинуть позицию на другой стол (создаёт/дополняет заказ целевого стола)."""
    return await OrderService(db, branch_scope=effective_branch_filter(user)).move_item(user.company_id, order_id, item_id, table, user, pin)


@router.patch("/orders/{order_id}/items/{item_id}/waiter", response_model=OrderResponse)
async def set_item_waiter(order_id: UUID, item_id: UUID, data: OrderItemWaiterUpdate, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    """Сменить ответственного официанта у отдельной позиции (кассир исправляет путаницу)."""
    return await OrderService(db, branch_scope=effective_branch_filter(user)).set_item_waiter(user.company_id, order_id, item_id, data, user)


# ── Terminals ─────────────────────────────────────────────────────────────────

@router.post("/terminals", response_model=TerminalResponse, status_code=status.HTTP_201_CREATED)
async def create_terminal(data: TerminalCreate, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await TerminalService(db).create(user.company_id, data)


@router.get("/terminals", response_model=list[TerminalResponse])
async def list_terminals(user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await TerminalService(db).list(user.company_id)


# ── Shifts ───────────────────────────────────────────────────────────────────

@router.post("/shifts/open", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
async def open_shift(data: ShiftOpen, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await ShiftService(db).open_shift(user.company_id, user.id, data)


@router.post("/shifts/close", response_model=ShiftResponse)
async def close_shift(data: ShiftClose, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await ShiftService(db).close_shift(user.company_id, user.id, data)


@router.get("/shifts/current")
async def current_shift(branch_id: UUID = Query(...), user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    shift = await ShiftService(db).get_current(user.company_id, branch_id, user.id)
    if not shift:
        return {"shift": None}
    return ShiftResponse.model_validate(shift)


@router.get("/shifts/me/summary", response_model=MyShiftSummary)
async def my_shift_summary(
    branch_id: UUID | None = Query(None),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    return await ShiftService(db).my_summary(user.company_id, user.id, branch_id)

# SlowAPI registers a wrapper whose global namespace is ``slowapi.extension``.
# Keep endpoint annotations runtime-evaluated in this module so FastAPI sees
# the concrete OrderCreate body after ``@limiter.limit`` wraps the function.
from datetime import date
from uuid import UUID
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import require_company_app_user
from app.modules.auth.models import User
from app.modules.pos.schemas import (
    OrderCreate, OrderItemCreate, OrderResponse,
    OrderStatusUpdate, OrderUpdate,
    TerminalCreate, TerminalResponse,
    ShiftOpen, ShiftClose, ShiftResponse,
)
from app.modules.pos.service import OrderService, TerminalService, ShiftService
from app.shared.rate_limit import limiter

router = APIRouter(prefix="/pos", tags=["pos"])


@router.post("/orders", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("120/minute")
async def create_order(request: Request, data: OrderCreate, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).create(user.company_id, user.id, data)


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
    return await OrderService(db).list(
        user.company_id, branch_id, status, date, active_only, table_number, limit, offset
    )


@router.get("/orders/{order_id}", response_model=OrderResponse)
async def get_order(order_id: UUID, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).get(user.company_id, order_id)


@router.patch("/orders/{order_id}", response_model=OrderResponse)
async def update_order(order_id: UUID, data: OrderUpdate, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).update_order(user.company_id, order_id, data)


@router.patch("/orders/{order_id}/status", response_model=OrderResponse)
async def update_order_status(order_id: UUID, data: OrderStatusUpdate, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).update_status(user.company_id, order_id, data, actor_id=user.id)


@router.delete("/orders/{order_id}", response_model=OrderResponse)
async def cancel_order(order_id: UUID, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).cancel(user.company_id, order_id, actor_id=user.id)


@router.post("/orders/{order_id}/items", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
async def add_item(order_id: UUID, data: OrderItemCreate, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).add_item(user.company_id, order_id, data)


@router.delete("/orders/{order_id}/items/{item_id}", response_model=OrderResponse)
async def remove_item(order_id: UUID, item_id: UUID, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).remove_item(user.company_id, order_id, item_id, actor_id=user.id)


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
    shift = await ShiftService(db).get_current(user.company_id, branch_id)
    if not shift:
        return {"shift": None}
    return ShiftResponse.model_validate(shift)

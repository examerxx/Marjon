from __future__ import annotations
from datetime import date
from uuid import UUID
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.pos.schemas import (
    OrderCreate, OrderItemCreate, OrderItemResponse,
    OrderResponse, OrderStatusUpdate,
    TerminalCreate, TerminalResponse,
)
from app.modules.pos.service import OrderService

router = APIRouter(prefix="/pos", tags=["pos"])


@router.post("/orders", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
async def create_order(data: OrderCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).create(user.company_id, user.id, data)


@router.get("/orders", response_model=list[OrderResponse])
async def list_orders(
    branch_id: UUID | None = Query(None),
    status: str | None = Query(None),
    date: date | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await OrderService(db).list(user.company_id, branch_id, status, date)


@router.get("/orders/{order_id}", response_model=OrderResponse)
async def get_order(order_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).get(user.company_id, order_id)


@router.patch("/orders/{order_id}/status", response_model=OrderResponse)
async def update_order_status(order_id: UUID, data: OrderStatusUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).update_status(user.company_id, order_id, data)


@router.delete("/orders/{order_id}", response_model=OrderResponse)
async def cancel_order(order_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).cancel(user.company_id, order_id)


@router.post("/orders/{order_id}/items", response_model=OrderItemResponse, status_code=status.HTTP_201_CREATED)
async def add_item(order_id: UUID, data: OrderItemCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await OrderService(db).add_item(user.company_id, order_id, data)

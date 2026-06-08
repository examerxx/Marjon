from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.kitchen.schemas import KitchenItemStatusUpdate, StationCreate, StationResponse
from app.modules.kitchen.service import KitchenService
from app.modules.pos.schemas import OrderResponse

router = APIRouter(prefix="/kitchen", tags=["kitchen"])


@router.post("/stations", response_model=StationResponse, status_code=status.HTTP_201_CREATED)
async def create_station(data: StationCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await KitchenService(db).create_station(user.company_id, data)


@router.get("/stations", response_model=list[StationResponse])
async def list_stations(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await KitchenService(db).list_stations(user.company_id)


@router.get("/orders", response_model=list[OrderResponse])
async def active_orders(branch_id: UUID = Query(...), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await KitchenService(db).get_active_orders(user.company_id, branch_id)


@router.patch("/orders/items/status")
async def update_item_status(data: KitchenItemStatusUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await KitchenService(db).update_item_status(user.company_id, data)

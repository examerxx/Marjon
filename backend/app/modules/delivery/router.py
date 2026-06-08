from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.delivery.schemas import (
    CourierAssign, CourierCreate, CourierResponse,
    DeliveryOrderCreate, DeliveryOrderResponse,
    DeliveryStatusUpdate, LocationUpdate, ZoneCreate, ZoneResponse,
)
from app.modules.delivery.service import DeliveryService

router = APIRouter(prefix="/delivery", tags=["delivery"])


@router.post("/zones", response_model=ZoneResponse, status_code=status.HTTP_201_CREATED)
async def create_zone(data: ZoneCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await DeliveryService(db).create_zone(user.company_id, data)


@router.get("/zones", response_model=list[ZoneResponse])
async def list_zones(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await DeliveryService(db).list_zones(user.company_id)


@router.post("/couriers", response_model=CourierResponse, status_code=status.HTTP_201_CREATED)
async def create_courier(data: CourierCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await DeliveryService(db).create_courier(user.company_id, user.id, data)


@router.get("/couriers", response_model=list[CourierResponse])
async def list_couriers(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await DeliveryService(db).list_couriers(user.company_id)


@router.patch("/couriers/{courier_id}/location")
async def update_location(courier_id: UUID, data: LocationUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await DeliveryService(db).update_courier_location(user.company_id, courier_id, data)


@router.post("/orders", response_model=DeliveryOrderResponse, status_code=status.HTTP_201_CREATED)
async def create_delivery_order(data: DeliveryOrderCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await DeliveryService(db).create_delivery_order(user.company_id, data)


@router.post("/orders/{delivery_id}/assign", response_model=DeliveryOrderResponse)
async def assign_courier(delivery_id: UUID, data: CourierAssign, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await DeliveryService(db).assign_courier(user.company_id, delivery_id, data)


@router.patch("/orders/{delivery_id}/status", response_model=DeliveryOrderResponse)
async def update_status(delivery_id: UUID, data: DeliveryStatusUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await DeliveryService(db).update_status(user.company_id, delivery_id, data)

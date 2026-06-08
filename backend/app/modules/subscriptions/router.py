from __future__ import annotations
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user, require_superadmin
from app.modules.auth.models import User
from app.modules.subscriptions.schemas import (
    PlanCreate, PlanResponse, SubscriptionCreate, SubscriptionResponse,
)
from app.modules.subscriptions.service import SubscriptionService

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


@router.get("/plans", response_model=list[PlanResponse])
async def list_plans(db: AsyncSession = Depends(get_db)):
    return await SubscriptionService(db).list_plans()


@router.post("/plans", response_model=PlanResponse, status_code=status.HTTP_201_CREATED)
async def create_plan(data: PlanCreate, user: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    return await SubscriptionService(db).create_plan(data)


@router.post("", response_model=SubscriptionResponse, status_code=status.HTTP_201_CREATED)
async def subscribe(data: SubscriptionCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await SubscriptionService(db).subscribe(user.company_id, data)


@router.get("/current", response_model=SubscriptionResponse | None)
async def current_subscription(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await SubscriptionService(db).get_current(user.company_id)

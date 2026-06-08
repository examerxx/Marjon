from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.loyalty.schemas import (
    EarnPointsRequest, LoyaltyAccountResponse,
    LoyaltyTransactionResponse, RedeemPointsRequest,
)
from app.modules.loyalty.service import LoyaltyService

router = APIRouter(prefix="/loyalty", tags=["loyalty"])


@router.get("/accounts/{customer_id}", response_model=LoyaltyAccountResponse)
async def get_account(customer_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await LoyaltyService(db).get_or_create_account(user.company_id, customer_id)


@router.post("/earn", response_model=LoyaltyTransactionResponse, status_code=status.HTTP_201_CREATED)
async def earn_points(data: EarnPointsRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await LoyaltyService(db).earn(user.company_id, data)


@router.post("/redeem", response_model=LoyaltyTransactionResponse, status_code=status.HTTP_201_CREATED)
async def redeem_points(data: RedeemPointsRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await LoyaltyService(db).redeem(user.company_id, data)

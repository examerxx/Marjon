from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.payments.schemas import PaymentCreate, PaymentResponse
from app.modules.payments.service import PaymentService

router = APIRouter(prefix="/payments", tags=["payments"])


@router.post("", response_model=PaymentResponse, status_code=status.HTTP_201_CREATED)
async def process_payment(data: PaymentCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await PaymentService(db).process(user.company_id, user.id, data)


@router.get("/order/{order_id}", response_model=list[PaymentResponse])
async def order_payments(order_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await PaymentService(db).list_for_order(user.company_id, order_id)

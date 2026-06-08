from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.fiscal.schemas import FiscalReceiptCreate, FiscalReceiptResponse
from app.modules.fiscal.service import FiscalService

router = APIRouter(prefix="/fiscal", tags=["fiscal"])


@router.post("/receipts", response_model=FiscalReceiptResponse, status_code=status.HTTP_201_CREATED)
async def create_receipt(data: FiscalReceiptCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await FiscalService(db).create(user.company_id, data)


@router.get("/receipts", response_model=list[FiscalReceiptResponse])
async def list_receipts(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await FiscalService(db).list(user.company_id)


@router.get("/receipts/{receipt_id}", response_model=FiscalReceiptResponse)
async def get_receipt(receipt_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await FiscalService(db).get(user.company_id, receipt_id)

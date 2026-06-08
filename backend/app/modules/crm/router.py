from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.crm.schemas import CustomerCreate, CustomerResponse, CustomerUpdate, NoteCreate, NoteResponse
from app.modules.crm.service import CustomerService

router = APIRouter(prefix="/crm", tags=["crm"])


@router.post("/customers", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
async def create_customer(data: CustomerCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await CustomerService(db).create(user.company_id, data)


@router.get("/customers", response_model=list[CustomerResponse])
async def list_customers(q: str | None = Query(None), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    svc = CustomerService(db)
    if q:
        return await svc.search(user.company_id, q)
    return await svc.list(user.company_id)


@router.get("/customers/{customer_id}", response_model=CustomerResponse)
async def get_customer(customer_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await CustomerService(db).get(user.company_id, customer_id)


@router.patch("/customers/{customer_id}", response_model=CustomerResponse)
async def update_customer(customer_id: UUID, data: CustomerUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await CustomerService(db).update(user.company_id, customer_id, data)


@router.post("/customers/{customer_id}/notes", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def add_note(customer_id: UUID, data: NoteCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await CustomerService(db).add_note(user.company_id, customer_id, user.id, data)

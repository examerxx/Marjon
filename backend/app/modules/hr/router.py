from __future__ import annotations
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.hr.schemas import (
    AttendanceCreate, AttendanceResponse,
    EmployeeCreate, EmployeeResponse,
    ShiftCreate, ShiftResponse,
)
from app.modules.hr.service import HRService

router = APIRouter(prefix="/hr", tags=["hr"])


@router.post("/employees", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
async def create_employee(data: EmployeeCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await HRService(db).create_employee(user.company_id, data)


@router.get("/employees", response_model=list[EmployeeResponse])
async def list_employees(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await HRService(db).list_employees(user.company_id)


@router.post("/shifts", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
async def create_shift(data: ShiftCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await HRService(db).create_shift(user.company_id, data)


@router.get("/shifts", response_model=list[ShiftResponse])
async def list_shifts(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await HRService(db).list_shifts(user.company_id)


@router.post("/attendance", response_model=AttendanceResponse, status_code=status.HTTP_201_CREATED)
async def log_attendance(data: AttendanceCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await HRService(db).log_attendance(user.company_id, data)

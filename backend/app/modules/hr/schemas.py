from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class EmployeeCreate(BaseSchema):
    user_id: UUID
    branch_id: UUID
    position: str
    hire_date: date
    salary_type: str = "fixed"
    salary_amount: Decimal = Decimal("0")


class EmployeeResponse(BaseResponseSchema):
    company_id: UUID
    user_id: UUID
    branch_id: UUID
    position: str
    hire_date: date
    salary_type: str
    salary_amount: Decimal


class ShiftCreate(BaseSchema):
    employee_id: UUID
    branch_id: UUID
    scheduled_start: datetime
    scheduled_end: datetime


class ShiftResponse(BaseResponseSchema):
    company_id: UUID
    employee_id: UUID
    branch_id: UUID
    scheduled_start: datetime
    scheduled_end: datetime
    actual_start: datetime | None
    actual_end: datetime | None
    status: str


class AttendanceCreate(BaseSchema):
    employee_id: UUID
    shift_id: UUID
    action: str
    method: str = "manual"
    note: str | None = None


class AttendanceResponse(BaseResponseSchema):
    employee_id: UUID
    shift_id: UUID
    action: str
    timestamp: datetime
    method: str
    note: str | None

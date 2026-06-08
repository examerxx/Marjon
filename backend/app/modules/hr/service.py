from __future__ import annotations
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.hr.models import AttendanceLog, Employee, WorkShift
from app.modules.hr.repository import AttendanceLogRepository, EmployeeRepository, WorkShiftRepository
from app.modules.hr.schemas import AttendanceCreate, EmployeeCreate, ShiftCreate
from app.shared.exceptions import NotFoundError


class HRService:
    def __init__(self, db: AsyncSession):
        self.emp_repo = EmployeeRepository(db)
        self.shift_repo = WorkShiftRepository(db)
        self.att_repo = AttendanceLogRepository(db)

    async def create_employee(self, company_id: UUID, data: EmployeeCreate) -> Employee:
        return await self.emp_repo.save(Employee(company_id=company_id, **data.model_dump()))

    async def list_employees(self, company_id: UUID) -> list[Employee]:
        return await self.emp_repo.get_all(company_id)

    async def create_shift(self, company_id: UUID, data: ShiftCreate) -> WorkShift:
        return await self.shift_repo.save(WorkShift(company_id=company_id, **data.model_dump()))

    async def list_shifts(self, company_id: UUID) -> list[WorkShift]:
        return await self.shift_repo.get_all(company_id)

    async def log_attendance(self, company_id: UUID, data: AttendanceCreate) -> AttendanceLog:
        log = AttendanceLog(
            company_id=company_id,
            timestamp=datetime.now(timezone.utc),
            **data.model_dump(),
        )
        return await self.att_repo.save(log)

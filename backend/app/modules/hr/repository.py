from __future__ import annotations
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import TenantRepository
from app.modules.hr.models import Employee, WorkShift, AttendanceLog


class EmployeeRepository(TenantRepository[Employee]):
    def __init__(self, db: AsyncSession):
        super().__init__(Employee, db)


class WorkShiftRepository(TenantRepository[WorkShift]):
    def __init__(self, db: AsyncSession):
        super().__init__(WorkShift, db)


class AttendanceLogRepository(TenantRepository[AttendanceLog]):
    def __init__(self, db: AsyncSession):
        super().__init__(AttendanceLog, db)

from __future__ import annotations
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.devent import DeventClient
from app.modules.field_service.models import Service, ServiceEmployee
from app.modules.field_service.schemas import (
    EmployeeOnMap,
    ServiceStatisticsRow,
    SyncResult,
)
from app.modules.tasks.models import Task
from app.shared.admin_crud import OrgScope


class FieldServiceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def sync_employees(self) -> SyncResult:
        """«Обновить список (devent)»: маппинг по external_id (ТЗ §8)."""
        remote = await DeventClient().fetch_employees()
        created = updated = 0
        for item in remote:
            external_id = str(item.get("id") or "")
            if not external_id:
                continue
            employee = (
                await self.db.execute(
                    select(ServiceEmployee).where(ServiceEmployee.external_id == external_id)
                )
            ).scalar_one_or_none()
            if employee is None:
                self.db.add(ServiceEmployee(
                    external_id=external_id,
                    fio=str(item.get("fio") or item.get("name") or external_id),
                    phone=item.get("phone"),
                    role=item.get("role"),
                ))
                created += 1
            else:
                employee.fio = str(item.get("fio") or item.get("name") or employee.fio)
                employee.phone = item.get("phone") or employee.phone
                employee.role = item.get("role") or employee.role
                updated += 1
        await self.db.commit()
        return SyncResult(created=created, updated=updated)

    async def sync_services(self) -> SyncResult:
        remote = await DeventClient().fetch_services()
        created = updated = 0
        for item in remote:
            external_id = str(item.get("id") or "")
            if not external_id:
                continue
            service = (
                await self.db.execute(
                    select(Service).where(Service.external_id == external_id)
                )
            ).scalar_one_or_none()
            if service is None:
                self.db.add(Service(
                    external_id=external_id,
                    name=str(item.get("name") or external_id),
                ))
                created += 1
            else:
                service.name = str(item.get("name") or service.name)
                updated += 1
        await self.db.commit()
        return SyncResult(created=created, updated=updated)

    async def employees_on_map(self, org_scope: OrgScope = None) -> list[EmployeeOnMap]:
        query = select(ServiceEmployee).where(
            ServiceEmployee.deleted_at.is_(None),
            ServiceEmployee.last_lat.is_not(None),
            ServiceEmployee.last_lng.is_not(None),
        )
        if org_scope is not None:
            query = query.where(ServiceEmployee.organization_id.in_(org_scope))
        employees = (await self.db.execute(query)).scalars().all()
        return [
            EmployeeOnMap(id=e.id, fio=e.fio, lat=e.last_lat, lng=e.last_lng)
            for e in employees
        ]

    async def services_statistics(self) -> list[ServiceStatisticsRow]:
        """Статистика по услугам: всего/завершено/просрочено задач."""
        rows = (
            await self.db.execute(
                select(
                    Service.id,
                    Service.name,
                    func.count(Task.id),
                    func.sum(case((Task.status == "completed", 1), else_=0)),
                    func.sum(case((Task.status == "overdue", 1), else_=0)),
                )
                .join(Task, Task.service_id == Service.id, isouter=True)
                .where(Service.deleted_at.is_(None))
                .group_by(Service.id, Service.name)
            )
        ).all()
        return [
            ServiceStatisticsRow(
                service_id=r[0], service_name=r[1],
                total=r[2] or 0, completed=r[3] or 0, overdue=r[4] or 0,
            )
            for r in rows
        ]

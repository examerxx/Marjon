from __future__ import annotations

"""Рейтинг сотрудников (ТЗ §5.9, §6).

Точные правила расчёта штрафов и оплачиваемой суммы — открытый вопрос ТЗ §13.
Принятая модель (согласовать с заказчиком):
  - задача «вовремя»: completed и completed_at <= deadline → points_on_time;
  - «с опозданием»: completed после deadline → points_late;
  - «не выполнено»: статус overdue/cancelled → points_not_done;
  - штраф = tariff(балл) * penalty_percent услуги за каждую невыполненную;
  - оплачиваемая сумма = баланс сотрудника − штрафы.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.field_service.models import Service, ServiceEmployee
from app.modules.ratings.schemas import RatingRow
from app.modules.tasks.models import Task


class RatingService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def compute(
        self, date_from: date | None = None, date_to: date | None = None
    ) -> list[RatingRow]:
        employees = (
            await self.db.execute(
                select(ServiceEmployee).where(
                    ServiceEmployee.deleted_at.is_(None),
                    ServiceEmployee.participates_in_rating.is_(True),
                )
            )
        ).scalars().all()

        services = {
            s.id: s
            for s in (
                await self.db.execute(select(Service).where(Service.deleted_at.is_(None)))
            ).scalars().all()
        }

        task_query = select(Task).where(
            Task.deleted_at.is_(None), Task.assignee_id.is_not(None)
        )
        if date_from:
            task_query = task_query.where(func.date(Task.created_at) >= date_from)
        if date_to:
            task_query = task_query.where(func.date(Task.created_at) <= date_to)
        tasks = (await self.db.execute(task_query)).scalars().all()

        by_assignee: dict = {}
        for task in tasks:
            by_assignee.setdefault(task.assignee_id, []).append(task)

        rows = []
        for employee in employees:
            emp_tasks = by_assignee.get(employee.id, [])
            on_time = late = not_done = 0
            on_time_points = late_points = not_done_points = 0
            penalty_sum = Decimal(0)

            for task in emp_tasks:
                service = services.get(task.service_id)
                if task.status == "completed":
                    if task.deadline and task.completed_at and task.completed_at > task.deadline:
                        late += 1
                        late_points += service.points_late if service else 0
                    else:
                        on_time += 1
                        on_time_points += service.points_on_time if service else 0
                elif task.status in ("overdue", "cancelled"):
                    not_done += 1
                    if service:
                        not_done_points += service.points_not_done
                        penalty_sum += (
                            Decimal(service.points_not_done)
                            * Decimal(service.penalty_percent or 0) / 100
                        )

            total = len(emp_tasks)
            completed = on_time + late
            rows.append(RatingRow(
                employee_id=employee.id,
                employee_fio=employee.fio,
                tasks_total=total,
                on_time=on_time,
                late=late,
                not_done=not_done,
                on_time_points=on_time_points,
                late_points=late_points,
                not_done_points=not_done_points,
                total_points=on_time_points + late_points + not_done_points,
                completion_percent=(
                    Decimal(completed * 100) / total if total else Decimal(0)
                ).quantize(Decimal("0.01")),
                penalty_sum=penalty_sum.quantize(Decimal("0.01")),
                payable_amount=(Decimal(employee.balance or 0) - penalty_sum).quantize(Decimal("0.01")),
            ))

        rows.sort(key=lambda r: -r.total_points)
        return rows

from __future__ import annotations
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.tasks.models import TASK_STATUSES, Task, TaskApproval
from app.modules.tasks.schemas import (
    TaskBoardColumn,
    TaskCreate,
    TaskResponse,
    TaskUpdate,
)
from app.shared.admin_crud import CRUDService, OrgScope
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError

# Поля задачи, которые можно менять через очередь подтверждений
APPROVABLE_FIELDS = set(TaskUpdate.model_fields)


class TaskService(CRUDService[Task]):
    def __init__(self, db: AsyncSession):
        super().__init__(Task, db)

    def _validate_status(self, status: str | None) -> None:
        if status and status not in TASK_STATUSES:
            raise ValidationError(f"Недопустимый статус задачи: {status}")

    async def create_task(self, data: TaskCreate, author_id: UUID) -> Task:
        self._validate_status(data.status)
        task = Task(**data.model_dump(exclude_unset=True), user_id=author_id)
        self.db.add(task)
        await self.db.commit()
        await self.db.refresh(task)
        return task

    async def update_task(self, task_id: UUID, data: TaskUpdate) -> Task:
        self._validate_status(data.status)
        payload = data.model_dump(exclude_unset=True)
        if payload.get("status") == "completed" and "completed_at" not in payload:
            payload["completed_at"] = datetime.now(timezone.utc)
        return await self.update(task_id, payload)

    async def board(self, org_scope: OrgScope = None) -> list[TaskBoardColumn]:
        """Доска задач: колонки по статусам (ТЗ §7)."""
        query = select(Task).where(Task.deleted_at.is_(None)).order_by(Task.created_at.desc())
        if org_scope is not None:
            query = query.where(Task.organization_id.in_(org_scope))
        tasks = (await self.db.execute(query)).scalars().all()
        columns = {status: [] for status in TASK_STATUSES}
        for task in tasks:
            columns.setdefault(task.status, []).append(task)
        return [
            TaskBoardColumn(
                status=status,
                count=len(items),
                tasks=[TaskResponse.model_validate(t) for t in items],
            )
            for status, items in columns.items()
        ]


class TaskApprovalService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(self, approval_id: UUID) -> TaskApproval:
        approval = (
            await self.db.execute(select(TaskApproval).where(TaskApproval.id == approval_id))
        ).scalar_one_or_none()
        if approval is None:
            raise NotFoundError("Task approval not found")
        return approval

    async def create(self, task_id: UUID, change: dict, user_id: UUID) -> TaskApproval:
        unknown = set(change) - APPROVABLE_FIELDS
        if unknown:
            raise ValidationError(f"Поля не подлежат изменению: {', '.join(sorted(unknown))}")
        # задача должна существовать
        await TaskService(self.db).get(task_id)
        approval = TaskApproval(task_id=task_id, change=change, user_id=user_id)
        self.db.add(approval)
        await self.db.commit()
        await self.db.refresh(approval)
        return approval

    async def approve(self, approval_id: UUID, resolver_id: UUID) -> TaskApproval:
        approval = await self.get(approval_id)
        if approval.status != "pending":
            raise ConflictError("Подтверждение уже обработано")
        update = TaskUpdate.model_validate(approval.change or {})
        await TaskService(self.db).update_task(approval.task_id, update)
        approval.status = "approved"
        approval.resolved_by = resolver_id
        await self.db.commit()
        await self.db.refresh(approval)
        return approval

    async def reject(self, approval_id: UUID, resolver_id: UUID) -> TaskApproval:
        approval = await self.get(approval_id)
        if approval.status != "pending":
            raise ConflictError("Подтверждение уже обработано")
        approval.status = "rejected"
        approval.resolved_by = resolver_id
        await self.db.commit()
        await self.db.refresh(approval)
        return approval

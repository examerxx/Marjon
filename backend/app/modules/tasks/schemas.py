from __future__ import annotations
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field
from app.shared.base_schema import BaseResponseSchema


class TaskCreate(BaseModel):
    organization_id: UUID | None = None
    region_id: UUID | None = None
    name: str
    description: str | None = None
    service_id: UUID | None = None
    source_id: UUID | None = None
    status: str = "not_accepted"
    assignee_id: UUID | None = None
    deadline: datetime | None = None


class TaskUpdate(BaseModel):
    organization_id: UUID | None = None
    region_id: UUID | None = None
    name: str | None = None
    description: str | None = None
    service_id: UUID | None = None
    source_id: UUID | None = None
    status: str | None = None
    assignee_id: UUID | None = None
    deadline: datetime | None = None
    completed_at: datetime | None = None


class TaskResponse(BaseResponseSchema):
    user_id: UUID | None
    organization_id: UUID | None
    region_id: UUID | None
    name: str
    description: str | None
    service_id: UUID | None
    source_id: UUID | None
    status: str
    assignee_id: UUID | None
    deadline: datetime | None
    completed_at: datetime | None


class TaskBoardColumn(BaseModel):
    status: str
    count: int
    tasks: list[TaskResponse]


class TaskApprovalCreate(BaseModel):
    task_id: UUID
    change: dict = Field(..., description="Предлагаемые изменения полей задачи")


class TaskApprovalResponse(BaseResponseSchema):
    task_id: UUID
    change: dict | None
    status: str
    user_id: UUID | None
    resolved_by: UUID | None

from __future__ import annotations
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.organizations.dependencies import get_org_scope
from app.modules.tasks import models, schemas
from app.modules.tasks.service import TaskApprovalService, TaskService
from app.shared.admin_crud import CRUDService, OrgScope
from app.shared.pagination import Page, PageParams

router = APIRouter()

tasks = APIRouter(prefix="/tasks", tags=["tasks"])

TASK_FILTERS = ("status", "service_id", "assignee_id", "organization_id", "region_id", "source_id", "user_id")


@tasks.get("", response_model=Page[schemas.TaskResponse],
           description=f"Фильтры по полям: {', '.join(TASK_FILTERS)}")
async def list_tasks(
    request: Request,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    search: str | None = Query(None),
    sort: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(get_current_user),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    params = PageParams(page=page, size=size)
    raw_filters = {f: request.query_params[f] for f in TASK_FILTERS if f in request.query_params}
    items, total = await TaskService(db).list(
        params, search=search, search_fields=("name", "description"), sort=sort,
        raw_filters=raw_filters, date_from=date_from, date_to=date_to,
        org_scope=org_scope, org_field="organization_id",
    )
    return Page.create([schemas.TaskResponse.model_validate(i) for i in items], total, params)


@tasks.get("/board", response_model=list[schemas.TaskBoardColumn], summary="Доска задач")
async def task_board(
    user: User = Depends(get_current_user),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    return await TaskService(db).board(org_scope)


@tasks.post("", response_model=schemas.TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(data: schemas.TaskCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await TaskService(db).create_task(data, user.id)


@tasks.get("/{task_id}", response_model=schemas.TaskResponse)
async def get_task(task_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await TaskService(db).get(task_id)


@tasks.patch("/{task_id}", response_model=schemas.TaskResponse)
async def update_task(task_id: UUID, data: schemas.TaskUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await TaskService(db).update_task(task_id, data)


@tasks.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await TaskService(db).delete(task_id)


router.include_router(tasks)


approvals = APIRouter(prefix="/task-approvals", tags=["tasks"])


@approvals.get("", response_model=Page[schemas.TaskApprovalResponse])
async def list_approvals(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    approval_status: str | None = Query(None, alias="status"),
    task_id: UUID | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    params = PageParams(page=page, size=size)
    raw_filters = {}
    if approval_status:
        raw_filters["status"] = approval_status
    if task_id:
        raw_filters["task_id"] = str(task_id)
    items, total = await CRUDService(models.TaskApproval, db).list(params, raw_filters=raw_filters)
    return Page.create([schemas.TaskApprovalResponse.model_validate(i) for i in items], total, params)


@approvals.post("", response_model=schemas.TaskApprovalResponse, status_code=status.HTTP_201_CREATED)
async def create_approval(data: schemas.TaskApprovalCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await TaskApprovalService(db).create(data.task_id, data.change, user.id)


@approvals.post("/{approval_id}/approve", response_model=schemas.TaskApprovalResponse)
async def approve(approval_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await TaskApprovalService(db).approve(approval_id, user.id)


@approvals.post("/{approval_id}/reject", response_model=schemas.TaskApprovalResponse)
async def reject(approval_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await TaskApprovalService(db).reject(approval_id, user.id)


router.include_router(approvals)

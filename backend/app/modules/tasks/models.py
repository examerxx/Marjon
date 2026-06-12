from __future__ import annotations
from datetime import datetime
from uuid import UUID
from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid
from app.shared.base_model import SoftDeleteMixin, TimeStampedModel
from app.modules.organizations.models import JsonType

TASK_STATUSES = ("not_accepted", "in_progress", "completed", "overdue", "cancelled")


class Task(TimeStampedModel, SoftDeleteMixin):
    __tablename__ = "adm_tasks"

    user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )  # постановщик
    organization_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), index=True
    )
    region_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("hb_regions.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    service_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("srv_services.id", ondelete="SET NULL"), index=True
    )
    source_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("lead_sources.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(32), default="not_accepted", index=True)
    assignee_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("srv_employees.id", ondelete="SET NULL"), index=True
    )
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskApproval(TimeStampedModel):
    """Очередь подтверждений изменений задач (ТЗ §5.8)."""

    __tablename__ = "adm_task_approvals"

    task_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("adm_tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    change: Mapped[dict | None] = mapped_column(JsonType)  # предложенное изменение
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending|approved|rejected
    user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    resolved_by: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

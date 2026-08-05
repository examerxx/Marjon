from __future__ import annotations
from uuid import UUID
from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class SupportTicket(TimeStampedModel):
    """Обращение в поддержку из плавающего виджета (ТЗ Web §3.14)."""

    __tablename__ = "support_tickets"

    company_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), index=True, nullable=True)
    user_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32))
    country: Mapped[str | None] = mapped_column(String(8))
    message: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="new")  # new|in_progress|closed


class ReceiptTemplateSettings(TimeStampedModel):
    """Шаблон чека/кухонного тикета, настраиваемый на фронте (ReceiptSettingsPage,
    ChefReceiptSettingsPage) — какие блоки печатать, тексты благодарности/футера.
    Одна строка на компанию; фактическая печать берёт эти данные в
    app/modules/printers/service.py и подставляет в EscPosFormatter."""

    __tablename__ = "receipt_template_settings"

    company_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"),
        unique=True, index=True, nullable=False,
    )
    customer_template: Mapped[dict] = mapped_column(JSON, default=dict)
    kitchen_template: Mapped[dict] = mapped_column(JSON, default=dict)
    # BE-11: optimistic concurrency, one counter per template (not shared —
    # the two are edited independently on separate settings pages, so a
    # single counter would make editing one falsely conflict with a stale
    # read of the other). Bumped on every successful PATCH to that
    # template; a caller that sends the version it last read gets a 409
    # instead of silently clobbering a concurrent edit.
    customer_version: Mapped[int] = mapped_column(Integer, default=1)
    kitchen_version: Mapped[int] = mapped_column(Integer, default=1)

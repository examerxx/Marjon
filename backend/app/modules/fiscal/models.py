from __future__ import annotations
from uuid import UUID
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class FiscalReceipt(TimeStampedModel):
    __tablename__ = "fiscal_receipts"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    order_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id"), index=True)
    payment_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("payments.id"), index=True)
    # pending | sent | failed
    status: Mapped[str] = mapped_column(String(20), default="pending")
    fiscal_code: Mapped[str | None] = mapped_column(String(255))
    receipt_url: Mapped[str | None] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(50), default="ofd_uz")
    error_message: Mapped[str | None] = mapped_column(Text)

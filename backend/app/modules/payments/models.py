from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from sqlalchemy import ForeignKey, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class Payment(TimeStampedModel):
    __tablename__ = "payments"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    order_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    # cash | card | payme | click | uzum | loyalty | mixed
    method: Mapped[str] = mapped_column(String(30), nullable=False)
    # pending | completed | failed | refunded
    status: Mapped[str] = mapped_column(String(20), default="pending")
    provider_tx_id: Mapped[str | None] = mapped_column(String(255))
    provider_data: Mapped[dict] = mapped_column(JSON, default=dict)
    cashier_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    cash_received: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    change_given: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    receipt_url: Mapped[str | None] = mapped_column(Text)
    fiscal_code: Mapped[str | None] = mapped_column(String(255))

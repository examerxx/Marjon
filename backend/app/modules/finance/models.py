from __future__ import annotations
from datetime import datetime
from uuid import UUID
from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import SoftDeleteMixin, TimeStampedModel
from app.modules.organizations.models import JsonType


class Counterparty(TimeStampedModel, SoftDeleteMixin):
    __tablename__ = "fin_counterparties"

    full_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    phone: Mapped[str | None] = mapped_column(String(32))
    balance: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    type: Mapped[str] = mapped_column(String(32), default="client")  # provider|client|employee|other


class PaymentType(TimeStampedModel):
    __tablename__ = "fin_payment_types"

    sort: Mapped[int] = mapped_column(default=0)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str | None] = mapped_column(String(32))  # card|cash|transfer|...
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class TransactionCategory(TimeStampedModel):
    __tablename__ = "fin_transaction_categories"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # income|expense
    parent_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fin_transaction_categories.id", ondelete="SET NULL")
    )
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class FinTransaction(TimeStampedModel, SoftDeleteMixin):
    __tablename__ = "fin_transactions"

    date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    amount: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)  # income|expense
    payment_type_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fin_payment_types.id", ondelete="SET NULL")
    )
    counterparty_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fin_counterparties.id", ondelete="SET NULL"), index=True
    )
    category_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fin_transaction_categories.id", ondelete="SET NULL"), index=True
    )
    organization_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), index=True
    )
    comment: Mapped[str | None] = mapped_column(Text)
    user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # Идемпотентность критичных операций оплаты (ТЗ §4.2)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), index=True)

    counterparty: Mapped[Counterparty | None] = relationship()


class FinanceTemplate(TimeStampedModel):
    __tablename__ = "fin_templates"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[dict | None] = mapped_column(JsonType)


class FinanceHistory(TimeStampedModel):
    """Аудит изменений финансовых сумм (ТЗ §4.4, §5.6)."""

    __tablename__ = "fin_history"

    status: Mapped[str | None] = mapped_column(String(32))
    ref_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), index=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    company_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    organization_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL")
    )
    new_amount: Mapped[float | None] = mapped_column(Numeric(16, 2))
    old_amount: Mapped[float | None] = mapped_column(Numeric(16, 2))
    type: Mapped[str | None] = mapped_column(String(32))
    user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    comment: Mapped[str | None] = mapped_column(Text)

from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class LoyaltyAccount(TimeStampedModel):
    __tablename__ = "loyalty_accounts"
    __table_args__ = (UniqueConstraint("company_id", "customer_id", name="uq_loyalty_customer"),)

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    customer_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("customers.id"), index=True)
    balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    lifetime_points: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    # bronze | silver | gold | platinum
    tier: Mapped[str] = mapped_column(String(20), default="bronze")

    transactions: Mapped[list[LoyaltyTransaction]] = relationship(back_populates="account", cascade="all, delete-orphan")


class LoyaltyTransaction(TimeStampedModel):
    __tablename__ = "loyalty_transactions"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    account_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("loyalty_accounts.id"), index=True)
    order_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id"), nullable=True)
    # earn | redeem | adjust | expire
    transaction_type: Mapped[str] = mapped_column(String(20), nullable=False)
    points: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    account: Mapped[LoyaltyAccount] = relationship(back_populates="transactions")

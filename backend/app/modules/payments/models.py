from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from sqlalchemy import Boolean, ForeignKey, ForeignKeyConstraint, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class Payment(TimeStampedModel):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint(
            "id", "company_id", "order_id",
            name="uq_payments_id_company_order",
        ),
        ForeignKeyConstraint(
            ["order_id", "company_id"],
            ["orders.id", "orders.company_id"],
            name="fk_payments_order_company",
        ),
    )

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    order_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    # cash | card | payme | click | uzum | loyalty | mixed
    method: Mapped[str] = mapped_column(String(30), nullable=False)
    # pending | completed | failed | refunded
    status: Mapped[str] = mapped_column(String(20), default="pending")
    provider_tx_id: Mapped[str | None] = mapped_column(String(255))
    provider_data: Mapped[dict] = mapped_column(JSON, default=dict)
    # Indexed (bi06zrd06): the cashier dimension of /analytics/z-report/detail
    # groups on this column. NULL for gateway/webhook payments, which belong
    # to no cashier report.
    cashier_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    cash_received: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    change_given: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    receipt_url: Mapped[str | None] = mapped_column(Text)
    fiscal_code: Mapped[str | None] = mapped_column(String(255))


class PaymentGatewaySettings(TimeStampedModel):
    """Per-company payment gateway credentials stored by the owner."""
    __tablename__ = "payment_gateway_settings"
    __table_args__ = (UniqueConstraint("company_id"),)

    company_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id"), index=True, nullable=False
    )

    # Payme (paycom.uz)
    payme_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    payme_merchant_id: Mapped[str | None] = mapped_column(String(255))  # for URL generation
    payme_key: Mapped[str | None] = mapped_column(String(255))          # merchant API key

    # Click (click.uz)
    click_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    click_merchant_id: Mapped[str | None] = mapped_column(String(64))
    click_service_id: Mapped[str | None] = mapped_column(String(64))
    click_secret_key: Mapped[str | None] = mapped_column(String(255))

    # Uzum Bank (uzumbank.uz) — reserved for future
    uzum_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    uzum_store_id: Mapped[str | None] = mapped_column(String(255))
    uzum_key: Mapped[str | None] = mapped_column(String(255))

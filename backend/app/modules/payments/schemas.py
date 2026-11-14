from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from app.shared.base_schema import BaseSchema, BaseResponseSchema
from pydantic import Field, model_serializer, model_validator


class PaymentCreate(BaseSchema):
    order_id: UUID
    amount: Decimal
    # cash | card | mixed | debt | название способа из веб-админки (Uzum, Yandex…).
    # Колонка payments.method — String(30), поэтому длину ограничиваем здесь,
    # а не ловим ошибку БД.
    method: str = Field(min_length=1, max_length=30)
    cash_received: Decimal | None = None
    cash_amount: Decimal | None = Field(None, ge=0)
    card_amount: Decimal | None = Field(None, ge=0)
    # OFFLINE-01: оплата, принятая кассой без сети. Разрешены только наличные:
    # карта и провайдеры требуют онлайн-подтверждения. client_created_at —
    # время на терминале, попадает в provider_data для аудита.
    offline_import: bool = False
    client_created_at: datetime | None = None

    @model_validator(mode="after")
    def validate_offline_cash_only(self):
        if not self.offline_import:
            return self
        if str(self.method or "").strip().lower() != "cash":
            raise ValueError("Offline payments are allowed for cash only")
        if self.card_amount is not None and self.card_amount > 0:
            raise ValueError("Offline payments cannot contain a card part")
        return self

    @model_validator(mode="after")
    def validate_manual_breakdown(self):
        if self.cash_amount is None and self.card_amount is None:
            return self  # Preserve the existing payment API contract.
        if self.cash_amount is None or self.card_amount is None:
            raise ValueError("Both cash_amount and card_amount are required")
        if self.amount <= 0 or self.cash_amount + self.card_amount != self.amount:
            raise ValueError("Cash and card amounts must equal the positive order total")
        expected = "mixed" if self.cash_amount > 0 and self.card_amount > 0 else "cash" if self.cash_amount > 0 else "card"
        if self.method != expected:
            raise ValueError("Payment method does not match cash/card amounts")
        if self.cash_received is not None and (self.cash_amount <= 0 or self.cash_received < self.cash_amount):
            raise ValueError("Cash received must cover the cash part")
        for value in (self.cash_amount, self.card_amount, self.amount, self.cash_received):
            if value is not None and value != value.quantize(Decimal("0.01")):
                raise ValueError("Payment amounts support at most two decimal places")
        return self

    @model_serializer(mode="wrap")
    def serialize_without_absent_breakdown(self, handler):
        # Old durable V1/V2 idempotency fingerprints must stay replayable.
        payload = handler(self)
        for key in ("cash_amount", "card_amount"):
            if payload.get(key) is None:
                payload.pop(key, None)
        if not payload.get("offline_import"):
            payload.pop("offline_import", None)
        if payload.get("client_created_at") is None:
            payload.pop("client_created_at", None)
        return payload


class PaymentResponse(BaseResponseSchema):
    company_id: UUID
    order_id: UUID
    amount: Decimal
    method: str
    status: str
    provider_tx_id: str | None
    cash_received: Decimal | None
    change_given: Decimal | None
    fiscal_code: str | None


# ── Payment gateway settings (per-company) ────────────────────────────────────

class GatewaySettingsUpdate(BaseSchema):
    payme_enabled: bool = False
    payme_merchant_id: str | None = None
    payme_key: str | None = None

    click_enabled: bool = False
    click_merchant_id: str | None = None
    click_service_id: str | None = None
    click_secret_key: str | None = None

    uzum_enabled: bool = False
    uzum_store_id: str | None = None
    uzum_key: str | None = None


class GatewaySettingsResponse(BaseSchema):
    payme_enabled: bool
    payme_merchant_id: str | None
    # payme_key intentionally omitted from response (write-only)

    click_enabled: bool
    click_merchant_id: str | None
    click_service_id: str | None
    # click_secret_key intentionally omitted

    uzum_enabled: bool
    uzum_store_id: str | None

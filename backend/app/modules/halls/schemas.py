from __future__ import annotations
from uuid import UUID
from pydantic import Field, model_validator
from app.shared.base_schema import BaseSchema, BaseResponseSchema

# BE-14: canonical pricing-type enum. The live settings form
# (SettingsPlacesPage.jsx) offers these exact Russian labels in its
# "Тип оплаты места" dropdown and posts them as `payment_type` — translated
# here the same way BE-13 handled printer_type, since this field is really
# "how is the fee calculated", not a link to an actual payment method.
PRICING_TYPES = ("percent", "hourly", "fixed", "time_based")

_PRICING_TYPE_LABEL_ALIASES = {
    "процент": "percent",
    "цена за час": "hourly",
    "фиксированная цена": "fixed",
    "цена по времени": "time_based",
}


def _normalize_hall_payload(values: dict) -> dict:
    if not isinstance(values, dict):
        return values
    values = dict(values)
    if "pricing_type" not in values and "payment_type" in values:
        raw = values.pop("payment_type")
        values["pricing_type"] = _PRICING_TYPE_LABEL_ALIASES.get(str(raw).strip().lower(), raw)
    return values


class HallCreate(BaseSchema):
    # BE-14: was hard-required with no default — SettingsPlacesPage.jsx
    # never sends it, so every place created from that page 422'd. Same
    # fix as BE-13's printer branch_id: resolved server-side when omitted.
    branch_id: UUID | None = None
    name: str
    description: str | None = None
    condition: str | None = None
    percent: float | None = Field(None, ge=0, le=100)
    pricing_type: str | None = None
    payment_type_id: UUID | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize(cls, values):
        return _normalize_hall_payload(values)

    @model_validator(mode="after")
    def check_pricing_type(self):
        if self.pricing_type is not None and self.pricing_type not in PRICING_TYPES:
            raise ValueError(f"pricing_type must be one of {PRICING_TYPES}")
        return self


class HallUpdate(BaseSchema):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None
    condition: str | None = None
    percent: float | None = Field(None, ge=0, le=100)
    pricing_type: str | None = None
    payment_type_id: UUID | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize(cls, values):
        return _normalize_hall_payload(values)

    @model_validator(mode="after")
    def check_pricing_type(self):
        if self.pricing_type is not None and self.pricing_type not in PRICING_TYPES:
            raise ValueError(f"pricing_type must be one of {PRICING_TYPES}")
        return self


class TableCreate(BaseSchema):
    number: int
    capacity: int = 4


class TableUpdate(BaseSchema):
    number: int | None = None
    capacity: int | None = None
    is_active: bool | None = None


class TableResponse(BaseResponseSchema):
    hall_id: UUID
    number: int
    capacity: int
    is_active: bool


class HallResponse(BaseResponseSchema):
    company_id: UUID
    branch_id: UUID
    name: str
    description: str | None
    is_active: bool
    condition: str | None = None
    percent: float | None = None
    pricing_type: str | None = None
    payment_type_id: UUID | None = None
    tables: list[TableResponse] = []

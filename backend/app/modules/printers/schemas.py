from __future__ import annotations
from uuid import UUID
from pydantic import Field, model_validator
from app.shared.base_schema import BaseSchema, BaseResponseSchema

# BE-13: canonical allowlists — spec asks explicitly for "допустимые
# printer_type; допустимые connection_type".
PRINTER_TYPES = ("receipt", "kitchen", "bar", "label")
CONNECTION_TYPES = ("network", "usb", "serial")

# The live settings page (SettingsPrintersPage.jsx) posts `type` with these
# exact Russian UI labels, not `printer_type` with an English slug — its
# apiMapFormToPayload has never matched this schema, so printer creation
# from that page 422s today (missing branch_id) or would 422 on type once
# that's fixed. Translated here rather than in the frontend per this
# project's "backend-only" boundary — see BE-12's compat routes for the
# same reasoning applied to printing itself.
_TYPE_LABEL_ALIASES = {
    "чековый": "receipt",
    "кухонный": "kitchen",
}


def _normalize_printer_payload(values: dict) -> dict:
    if not isinstance(values, dict):
        return values
    values = dict(values)
    if "printer_type" not in values and "type" in values:
        raw = values.pop("type")
        values["printer_type"] = _TYPE_LABEL_ALIASES.get(str(raw).strip().lower(), raw)
    if "ip_address" not in values and "host" in values:
        values["ip_address"] = values.pop("host")
    return values


class PrinterCreate(BaseSchema):
    # BE-13: was a hard-required field with no default — the live settings
    # form never sends it, so every printer creation from that page 422'd.
    # None now means "use the company's main/only branch" (PrinterService
    # resolves it; a company with zero or multiple branches and no
    # explicit branch_id gets a clear error instead of a guess).
    branch_id: UUID | None = None
    name: str
    printer_type: str          # receipt | kitchen | bar | label
    connection_type: str = "network"
    ip_address: str | None = None
    port: int = 9100
    device_path: str | None = None
    paper_width: int = 80
    zone: str | None = None
    settings: dict = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def normalize(cls, values):
        return _normalize_printer_payload(values)

    @model_validator(mode="after")
    def check_allowlists(self):
        if self.printer_type not in PRINTER_TYPES:
            raise ValueError(f"printer_type must be one of {PRINTER_TYPES}")
        if self.connection_type not in CONNECTION_TYPES:
            raise ValueError(f"connection_type must be one of {CONNECTION_TYPES}")
        return self


class PrinterUpdate(BaseSchema):
    name: str | None = None
    printer_type: str | None = None
    connection_type: str | None = None
    ip_address: str | None = None
    port: int | None = None
    device_path: str | None = None
    paper_width: int | None = None
    zone: str | None = None
    is_active: bool | None = None
    settings: dict | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize(cls, values):
        return _normalize_printer_payload(values)

    @model_validator(mode="after")
    def check_allowlists(self):
        if self.printer_type is not None and self.printer_type not in PRINTER_TYPES:
            raise ValueError(f"printer_type must be one of {PRINTER_TYPES}")
        if self.connection_type is not None and self.connection_type not in CONNECTION_TYPES:
            raise ValueError(f"connection_type must be one of {CONNECTION_TYPES}")
        return self


_SENSITIVE_SETTINGS_KEYS = ("password", "secret", "token", "api_key", "apikey", "key")


def _mask_sensitive_settings(settings: dict | None) -> dict:
    if not settings:
        return {}
    masked = dict(settings)
    for key in masked:
        if any(marker in key.lower() for marker in _SENSITIVE_SETTINGS_KEYS):
            masked[key] = "••••••"
    return masked


class PrinterResponse(BaseResponseSchema):
    company_id: UUID
    branch_id: UUID
    name: str
    printer_type: str
    connection_type: str
    ip_address: str | None
    port: int
    device_path: str | None
    paper_width: int
    zone: str | None = None
    is_active: bool
    settings: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def mask_settings(self):
        # BE-13: "маскирование чувствительных параметров" — settings is a
        # free-form ESC/POS config blob; anything that looks like a secret
        # (password/token/api_key/...) doesn't come back in plaintext.
        self.settings = _mask_sensitive_settings(self.settings)
        return self


class PrintJobRequest(BaseSchema):
    printer_id: UUID
    job_type: str           # receipt | kitchen | bar
    ref_id: UUID | None = None
    copies: int = 1


class PrintReceiptRequest(BaseSchema):
    order_id: UUID
    printer_id: UUID
    copies: int = 1


class PrintKitchenRequest(BaseSchema):
    order_id: UUID
    printer_id: UUID
    copies: int = 1


class PrintJobResponse(BaseResponseSchema):
    company_id: UUID
    printer_id: UUID
    job_type: str
    ref_id: UUID | None
    status: str
    error: str | None
    copies: int


class PrinterTestRequest(BaseSchema):
    printer_id: UUID

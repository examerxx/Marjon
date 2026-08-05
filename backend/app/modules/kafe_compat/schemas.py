from __future__ import annotations
from pydantic import field_validator
from app.shared.base_schema import BaseSchema


class ReceiptTemplateUpdate(BaseSchema):
    """BE-11: loose structural validation for the receipt/kitchen-receipt
    template JSON blob. This is a UI-driven, evolving shape (new block
    keys get added on the frontend independently of backend releases), so
    unknown top-level keys are allowed rather than rejected outright — but
    the well-known fields are type-checked to catch genuine garbage
    (e.g. paperSize being an object, blocks being a string), and `version`
    enables optional optimistic concurrency: send back the version you
    last read and a conflicting concurrent edit gets you a 409 instead of
    silently clobbering it. Omitting version keeps the old
    last-write-wins behavior for any caller that doesn't send one.
    """
    model_config = {"extra": "allow"}

    version: int | None = None
    paperSize: str | None = None
    blocks: list[str] | None = None
    enabled: dict[str, bool] | None = None
    blockStyles: dict[str, dict] | None = None
    positions: dict[str, dict] | None = None

    @field_validator("paperSize")
    @classmethod
    def check_paper_size(cls, v: str | None) -> str | None:
        if v is not None and v not in ("58mm", "80mm"):
            raise ValueError("paperSize должен быть '58mm' или '80mm'")
        return v

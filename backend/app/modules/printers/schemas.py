from __future__ import annotations
from uuid import UUID
from pydantic import Field
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class PrinterCreate(BaseSchema):
    branch_id: UUID
    name: str
    printer_type: str          # receipt | kitchen | bar | label
    connection_type: str = "network"
    ip_address: str | None = None
    port: int = 9100
    device_path: str | None = None
    paper_width: int = 80
    settings: dict = Field(default_factory=dict)


class PrinterUpdate(BaseSchema):
    name: str | None = None
    ip_address: str | None = None
    port: int | None = None
    paper_width: int | None = None
    is_active: bool | None = None
    settings: dict | None = None


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
    is_active: bool


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

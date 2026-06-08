from __future__ import annotations
from uuid import UUID
from sqlalchemy import Boolean, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class Printer(TimeStampedModel):
    """Network or USB printer configuration per branch."""
    __tablename__ = "printers"

    company_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # receipt | kitchen | bar | label
    printer_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # network | usb | serial
    connection_type: Mapped[str] = mapped_column(String(20), default="network")
    ip_address: Mapped[str | None] = mapped_column(String(45))
    port: Mapped[int] = mapped_column(Integer, default=9100)
    # e.g. "/dev/usb/lp0" or "COM3"
    device_path: Mapped[str | None] = mapped_column(String(100))
    # paper_width: 58 or 80 mm
    paper_width: Mapped[int] = mapped_column(Integer, default=80)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # extra ESC/POS settings (char_code, encoding, etc.)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)


class PrintJob(TimeStampedModel):
    """Print job queued for a specific printer."""
    __tablename__ = "print_jobs"

    company_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id"), index=True
    )
    printer_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("printers.id", ondelete="CASCADE"), index=True
    )
    # receipt | kitchen | bar
    job_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # Reference (order_id, payment_id, etc.)
    ref_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    # pending | printing | done | failed
    status: Mapped[str] = mapped_column(String(20), default="pending")
    # Raw ESC/POS payload stored as base64 OR plain text
    payload: Mapped[str] = mapped_column(String(65535), nullable=False)
    error: Mapped[str | None] = mapped_column(String(500))
    copies: Mapped[int] = mapped_column(Integer, default=1)

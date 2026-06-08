from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class Employee(TimeStampedModel):
    __tablename__ = "employees"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), index=True)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id"), index=True)
    position: Mapped[str] = mapped_column(String(100), nullable=False)
    hire_date: Mapped[date] = mapped_column(Date, nullable=False)
    dismiss_date: Mapped[date | None] = mapped_column(Date)
    # fixed | hourly | percent
    salary_type: Mapped[str] = mapped_column(String(20), default="fixed")
    salary_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))

    shifts: Mapped[list[WorkShift]] = relationship(back_populates="employee", cascade="all, delete-orphan")


class WorkShift(TimeStampedModel):
    __tablename__ = "work_shifts"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id"))
    employee_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("employees.id"), index=True)
    scheduled_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    scheduled_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actual_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # scheduled | active | completed | absent
    status: Mapped[str] = mapped_column(String(20), default="scheduled")

    employee: Mapped[Employee] = relationship(back_populates="shifts")
    attendance_logs: Mapped[list[AttendanceLog]] = relationship(back_populates="shift", cascade="all, delete-orphan")


class AttendanceLog(TimeStampedModel):
    __tablename__ = "attendance_logs"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    employee_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("employees.id"), index=True)
    shift_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("work_shifts.id"), index=True)
    # check_in | check_out
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # pin | qr | manual
    method: Mapped[str] = mapped_column(String(20), default="manual")
    note: Mapped[str | None] = mapped_column(Text)

    shift: Mapped[WorkShift] = relationship(back_populates="attendance_logs")

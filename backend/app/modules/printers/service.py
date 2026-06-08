from __future__ import annotations
import base64
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.companies.models import Branch
from app.modules.printers.formatter import (
    EscPosFormatter, KitchenTicketData, ReceiptData, ReceiptLine,
)
from app.modules.printers.models import PrintJob, Printer
from app.modules.printers.printer_client import PrinterError, print_raw
from app.modules.printers.repository import PrintJobRepository, PrinterRepository
from app.modules.printers.schemas import PrinterCreate, PrinterUpdate
from app.modules.pos.models import Order, OrderItem
from app.modules.payments.models import Payment
from app.shared.exceptions import NotFoundError


class PrinterService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = PrinterRepository(db)
        self.job_repo = PrintJobRepository(db)

    # ── Printer CRUD ─────────────────────────────────────────────────────────

    async def create(self, company_id: UUID, data: PrinterCreate) -> Printer:
        await self._get_branch(company_id, data.branch_id)
        return await self.repo.save(Printer(company_id=company_id, **data.model_dump()))

    async def list(self, company_id: UUID) -> list[Printer]:
        return await self.repo.get_all(company_id)

    async def get(self, company_id: UUID, printer_id: UUID) -> Printer:
        p = await self.repo.get_by_id(printer_id, company_id)
        if not p:
            raise NotFoundError("Printer not found")
        return p

    async def update(self, company_id: UUID, printer_id: UUID, data: PrinterUpdate) -> Printer:
        p = await self.get(company_id, printer_id)
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(p, field, value)
        return await self.repo.save(p)

    async def delete(self, company_id: UUID, printer_id: UUID) -> None:
        p = await self.get(company_id, printer_id)
        await self.repo.delete(p)

    # ── Print actions ─────────────────────────────────────────────────────────

    async def test_print(self, company_id: UUID, printer_id: UUID) -> PrintJob:
        """Print a test page."""
        printer = await self.get(company_id, printer_id)
        fmt = EscPosFormatter(printer.paper_width)
        data = (
            fmt.INIT + fmt.ALIGN_CENTER
            + fmt.BOLD_ON
            + b"=== TEST PAGE ===\n"
            + fmt.BOLD_OFF
            + f"Printer: {printer.name}\n".encode()
            + b"Connection: OK\n"
            + fmt.LF * 3
            + fmt.CUT
        )
        return await self._enqueue_and_send(company_id, printer, "test", None, data)

    async def print_receipt(
        self, company_id: UUID, order_id: UUID, printer_id: UUID, copies: int = 1
    ) -> PrintJob:
        printer = await self.get(company_id, printer_id)
        order = await self._get_order(company_id, order_id)
        receipt_data = await self._build_receipt_data(company_id, order)

        fmt = EscPosFormatter(printer.paper_width)
        raw = fmt.format_receipt(receipt_data)
        return await self._enqueue_and_send(company_id, printer, "receipt", order_id, raw, copies)

    async def print_kitchen_ticket(
        self, company_id: UUID, order_id: UUID, printer_id: UUID, copies: int = 1
    ) -> PrintJob:
        printer = await self.get(company_id, printer_id)
        order = await self._get_order(company_id, order_id)
        ticket_data = await self._build_kitchen_data(order)

        fmt = EscPosFormatter(printer.paper_width)
        raw = fmt.format_kitchen_ticket(ticket_data)
        return await self._enqueue_and_send(company_id, printer, "kitchen", order_id, raw, copies)

    # Auto-print: find printers by type and print
    async def auto_print_receipt(self, company_id: UUID, branch_id: UUID, order_id: UUID) -> list[PrintJob]:
        printers = await self.repo.get_by_type(company_id, branch_id, "receipt")
        jobs = []
        for printer in printers:
            order = await self._get_order(company_id, order_id)
            receipt_data = await self._build_receipt_data(company_id, order)
            fmt = EscPosFormatter(printer.paper_width)
            raw = fmt.format_receipt(receipt_data)
            job = await self._enqueue_and_send(company_id, printer, "receipt", order_id, raw)
            jobs.append(job)
        return jobs

    async def auto_print_kitchen(self, company_id: UUID, branch_id: UUID, order_id: UUID) -> list[PrintJob]:
        printers = await self.repo.get_by_type(company_id, branch_id, "kitchen")
        jobs = []
        for printer in printers:
            order = await self._get_order(company_id, order_id)
            ticket_data = await self._build_kitchen_data(order)
            fmt = EscPosFormatter(printer.paper_width)
            raw = fmt.format_kitchen_ticket(ticket_data)
            job = await self._enqueue_and_send(company_id, printer, "kitchen", order_id, raw)
            jobs.append(job)
        return jobs

    # ── Job queue (for POS terminals that print locally) ─────────────────────

    async def get_pending_jobs(self, company_id: UUID, printer_id: UUID) -> list[PrintJob]:
        return await self.job_repo.get_pending(company_id, printer_id)

    async def mark_job_done(self, company_id: UUID, job_id: UUID) -> PrintJob:
        job = await self.job_repo.get_by_id(job_id, company_id)
        if not job:
            raise NotFoundError("Print job not found")
        job.status = "done"
        return await self.job_repo.save(job)

    # ── Internal ─────────────────────────────────────────────────────────────

    async def _enqueue_and_send(
        self,
        company_id: UUID,
        printer: Printer,
        job_type: str,
        ref_id: UUID | None,
        raw: bytes,
        copies: int = 1,
    ) -> PrintJob:
        payload = base64.b64encode(raw).decode()
        job = PrintJob(
            company_id=company_id,
            printer_id=printer.id,
            job_type=job_type,
            ref_id=ref_id,
            payload=payload,
            copies=copies,
            status="pending",
        )
        job = await self.job_repo.save(job)

        # Try to print immediately via network
        if printer.connection_type == "network" and printer.ip_address:
            try:
                for _ in range(copies):
                    await print_raw(printer, raw)
                job.status = "done"
            except PrinterError as e:
                job.status = "failed"
                job.error = str(e)
            await self.job_repo.save(job)

        return job

    async def _get_branch(self, company_id: UUID, branch_id: UUID) -> Branch:
        result = await self.db.execute(
            select(Branch).where(Branch.id == branch_id, Branch.company_id == company_id)
        )
        branch = result.scalar_one_or_none()
        if not branch:
            raise NotFoundError("Branch not found")
        return branch

    async def _get_order(self, company_id: UUID, order_id: UUID) -> Order:
        from sqlalchemy.orm import selectinload
        result = await self.db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(Order.id == order_id, Order.company_id == company_id)
        )
        order = result.scalar_one_or_none()
        if not order:
            raise NotFoundError("Order not found")
        return order

    async def _build_receipt_data(self, company_id: UUID, order: Order) -> ReceiptData:
        # Get last payment
        pay_result = await self.db.execute(
            select(Payment).where(
                Payment.company_id == company_id,
                Payment.order_id == order.id,
                Payment.status == "completed",
            )
        )
        payment = pay_result.scalars().first()

        lines = [
            ReceiptLine(
                name=item.name,
                qty=item.quantity,
                price=item.price,
                total=item.total,
                modifiers=[m.get("name", "") for m in (item.modifiers or [])],
            )
            for item in order.items
        ]

        return ReceiptData(
            company_name="Компания",
            branch_name="Филиал",
            order_number=order.order_number,
            order_type=order.order_type,
            cashier_name="Кассир",
            items=lines,
            subtotal=order.subtotal,
            discount=order.discount_amount,
            tax=order.tax_amount,
            total=order.total_amount,
            payment_method=payment.method if payment else "—",
            cash_received=payment.cash_received if payment else None,
            change_given=payment.change_given if payment else None,
            table_number=order.table_number,
        )

    async def _build_kitchen_data(self, order: Order) -> KitchenTicketData:
        items = [
            {
                "name": item.name,
                "qty": str(item.quantity),
                "note": item.note,
                "modifiers": [m.get("name", "") for m in (item.modifiers or [])],
                "course": item.course,
            }
            for item in order.items
            if item.status not in ("cancelled", "served")
        ]
        return KitchenTicketData(
            order_number=order.order_number,
            order_type=order.order_type,
            table_number=order.table_number,
            waiter_name=None,
            items=items,
            note=order.note,
        )

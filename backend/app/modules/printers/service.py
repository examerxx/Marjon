from __future__ import annotations
import base64
import logging
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.companies.models import Branch, Company
from app.modules.kafe_compat.models import ReceiptTemplateSettings
from app.modules.printers.formatter import (
    EscPosFormatter, KitchenItem, KitchenTicketData, ReceiptData, ReceiptLine,
    derive_service_rate_percent, format_quantity,
)
from app.modules.printers.models import PrintJob, Printer
from app.modules.printers.printer_client import PrinterError, print_raw
from app.modules.printers.receipt_raster import RasterRenderError, render_customer_receipt_raster, render_kitchen_ticket_raster
from app.modules.printers.repository import PrintJobRepository, PrinterRepository
from app.modules.printers.ws_manager import printer_ws_manager
from app.modules.printers.schemas import PrinterCreate, PrinterUpdate
from app.modules.pos.models import Order, OrderItem
from app.modules.payments.models import Payment
from app.shared.exceptions import NotFoundError
from app.shared.storage import storage

logger = logging.getLogger(__name__)

# Компания без явно заданного пояса печатает по Ташкенту — тот же дефолт, что
# в pos/service.py для «операционного дня».
DEFAULT_COMPANY_TZ = "Asia/Tashkent"


# ── PRINT-LAT-01: попытка прямой печати с сервера ────────────────────────────
# Запрос печати синхронно ждёт TCP-соединения с принтером. 5 с (старое значение)
# означали 5-секундное ожидание на каждый чек, если бэкенд не в одной сети с
# принтером. 2 с достаточно любому живому LAN-принтеру, а недоступный адрес
# запоминается на минуту, чтобы следующие задания уходили на терминал сразу.
SERVER_PRINT_TIMEOUT = 2.0
# PRINT-LAT-03: авто-печать (кухонный чек при создании заказа, чек при оплате)
# идёт прямо в пути запроса кассира, поэтому ждать принтер 2 с там нельзя:
# заказ уже создан, а терминал всё равно напечатает сам, если сервер не успел.
# 0.4 с — с запасом для живого LAN-принтера (отвечает за единицы миллисекунд);
# не успели — задание остаётся pending и уходит на терминал.
AUTO_PRINT_TIMEOUT = 0.4
PRINTER_COOLDOWN_SECONDS = 60.0
_printer_cooldown: dict[UUID, float] = {}


def _start_printer_cooldown(printer_id: UUID) -> None:
    _printer_cooldown[printer_id] = time.monotonic() + PRINTER_COOLDOWN_SECONDS


def _clear_printer_cooldown(printer_id: UUID) -> None:
    _printer_cooldown.pop(printer_id, None)


def _is_printer_cooling_down(printer_id: UUID) -> bool:
    until = _printer_cooldown.get(printer_id)
    if until is None:
        return False
    if time.monotonic() >= until:
        _printer_cooldown.pop(printer_id, None)
        return False
    return True


class PrinterService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = PrinterRepository(db)
        self.job_repo = PrintJobRepository(db)

    # ── Printer CRUD ─────────────────────────────────────────────────────────

    async def create(self, company_id: UUID, data: PrinterCreate) -> Printer:
        payload = data.model_dump()
        branch_id = payload.pop("branch_id", None) or await self._resolve_default_branch(company_id)
        await self._get_branch(company_id, branch_id)
        return await self.repo.save(Printer(company_id=company_id, branch_id=branch_id, **payload))

    async def _resolve_default_branch(self, company_id: UUID) -> UUID:
        """BE-13: the live printer-settings form never sends branch_id, so
        PrinterCreate.branch_id is optional — resolve it here instead of
        422ing on every printer the frontend creates. Branch has no
        is_main flag, so this picks the earliest-created one (the branch
        created at registration for a typical single-branch company);
        raises a clear error if the company has no branch at all rather
        than guessing further."""
        result = await self.db.execute(
            select(Branch)
            .where(Branch.company_id == company_id)
            .order_by(Branch.created_at.asc())
            .limit(1)
        )
        branch = result.scalars().first()
        if not branch:
            raise NotFoundError("Company has no branch to attach this printer to — create one first")
        return branch.id

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

    @staticmethod
    def _printer_encoding(printer: Printer) -> str:
        """Кодовая страница принтера (settings.encoding), по умолчанию cp866 —
        см. EscPosFormatter._CODEPAGES для того, почему это дефолт."""
        return (printer.settings or {}).get("encoding", "cp866")

    async def _get_receipt_templates(self, company_id: UUID) -> tuple[dict, dict]:
        """Шаблоны, сохранённые на фронте (ReceiptSettingsPage/ChefReceiptSettingsPage
        через GET/PATCH /settings/receipt-template|kitchen-receipt-template).
        Возвращает ({} , {}), если ещё не настроено — форматтер тогда печатает
        все блоки (прежнее поведение)."""
        row = (
            await self.db.execute(
                select(ReceiptTemplateSettings).where(ReceiptTemplateSettings.company_id == company_id)
            )
        ).scalar_one_or_none()
        if not row:
            return {}, {}
        return row.customer_template or {}, row.kitchen_template or {}

    async def _get_logo_bytes(self, company_id: UUID) -> bytes | None:
        """Лого компании (Company.logo_key, загружается через POST /companies/me/logo).
        None, если ещё не загружено — блок 'logo' в чеке тогда просто не печатается."""
        company = await self.db.get(Company, company_id)
        if not company or not company.logo_key:
            return None
        return await storage.download(company.logo_key)

    async def test_print(self, company_id: UUID, printer_id: UUID) -> PrintJob:
        """Print a test page."""
        printer = await self.get(company_id, printer_id)
        fmt = EscPosFormatter(printer.paper_width, encoding=self._printer_encoding(printer))
        data = (
            fmt.INIT + fmt.codepage_cmd + fmt.ALIGN_CENTER
            + fmt.BOLD_ON
            + fmt._line("=== TEST PAGE ===")
            + fmt.BOLD_OFF
            + fmt._line(f"Printer: {printer.name}")
            + fmt._line("Connection: OK")
            + fmt.LF * 3
            + fmt.CUT
        )
        return await self._enqueue_and_send(company_id, printer, "test", None, data)

    async def print_summary(
        self,
        company_id: UUID,
        printer_id: UUID,
        title: str,
        lines: list[str],
        footer: str | None = None,
        copies: int = 1,
        local_print: bool = False,
    ) -> PrintJob:
        """Summary receipt (History/Reports): the client builds the lines."""
        printer = await self.get(company_id, printer_id)
        fmt = EscPosFormatter(printer.paper_width, encoding=self._printer_encoding(printer))
        tz_name = (
            await self.db.execute(select(Company.timezone).where(Company.id == company_id))
        ).scalar_one_or_none()
        raw = fmt.format_summary(
            title, lines, footer, printed_at=self._local_time(datetime.now(timezone.utc), self._zone(tz_name))
        )
        return await self._enqueue_and_send(
            company_id, printer, "summary", None, raw, copies, skip_server_print=local_print
        )

    def _render_customer_receipt(
        self, printer: Printer, receipt_data: ReceiptData, customer_tpl: dict, logo_bytes: bytes | None,
    ) -> bytes:
        """Raster is the normal customer-receipt renderer (physically
        approved — see docs/physical_receipt_parity_v1_report.md); text-mode
        is a safety fallback only. The two call sites that print a customer
        receipt (print_receipt, auto_print_receipt) both route through this
        so neither can silently drift to a different renderer than the
        other. RasterRenderError is the ONLY exception this is allowed to
        catch — it is raised solely for failures before any bytes exist, so
        falling back here can never produce a duplicate physical receipt."""
        try:
            raw = render_customer_receipt_raster(receipt_data, customer_tpl, printer.paper_width, logo_bytes)
            logger.info(
                "CUSTOMER_RECEIPT_RENDERER=raster paper_width=%s raster_width=%s payload_bytes=%s",
                printer.paper_width, 576 if printer.paper_width >= 80 else 384, len(raw),
            )
            return raw
        except RasterRenderError as exc:
            logger.warning("CUSTOMER_RECEIPT_RASTER_FAILED fallback=text error=%s", exc)
            fmt = EscPosFormatter(printer.paper_width, encoding=self._printer_encoding(printer))
            return fmt.format_receipt(receipt_data, template=customer_tpl, logo_bytes=logo_bytes)

    def _render_kitchen_ticket(
        self, printer: Printer, ticket_data: KitchenTicketData, kitchen_tpl: dict,
    ) -> bytes:
        """Kitchen-ticket counterpart to _render_customer_receipt: raster is
        the normal renderer (same typography pipeline/fonts as the customer
        receipt — see receipt_raster.render_kitchen_ticket_raster), text-mode
        is the safety fallback. Same RasterRenderError-only catch contract."""
        try:
            raw = render_kitchen_ticket_raster(ticket_data, kitchen_tpl, printer.paper_width)
            logger.info(
                "KITCHEN_TICKET_RENDERER=raster paper_width=%s payload_bytes=%s",
                printer.paper_width, len(raw),
            )
            return raw
        except RasterRenderError as exc:
            logger.warning("KITCHEN_TICKET_RASTER_FAILED fallback=text error=%s", exc)
            fmt = EscPosFormatter(printer.paper_width, encoding=self._printer_encoding(printer))
            return fmt.format_kitchen_ticket(ticket_data, template=kitchen_tpl)

    async def print_receipt(
        self, company_id: UUID, order_id: UUID, printer_id: UUID, copies: int = 1,
        local_print: bool = False,
    ) -> PrintJob:
        printer = await self.get(company_id, printer_id)
        order = await self._get_order(company_id, order_id)
        receipt_data = await self._build_receipt_data(company_id, order)
        customer_tpl, _ = await self._get_receipt_templates(company_id)
        logo_bytes = await self._get_logo_bytes(company_id)

        raw = self._render_customer_receipt(printer, receipt_data, customer_tpl, logo_bytes)
        job = await self._enqueue_and_send(
            company_id, printer, "receipt", order_id, raw, copies, skip_server_print=local_print
        )
        # Отметка «чек напечатан» → стол «ожидает оплату» (сбросится при дозаказе)
        try:
            if order.status not in ("completed", "cancelled"):
                order.receipt_printed_at = datetime.now(timezone.utc)
                await self.db.commit()
        except Exception:
            pass
        return job

    async def print_kitchen_ticket(
        self, company_id: UUID, order_id: UUID, printer_id: UUID, copies: int = 1,
        local_print: bool = False,
    ) -> PrintJob:
        printer = await self.get(company_id, printer_id)
        order = await self._get_order(company_id, order_id)
        ticket_data = await self._build_kitchen_data(company_id, order)
        _, kitchen_tpl = await self._get_receipt_templates(company_id)

        raw = self._render_kitchen_ticket(printer, ticket_data, kitchen_tpl)
        return await self._enqueue_and_send(
            company_id, printer, "kitchen", order_id, raw, copies, skip_server_print=local_print
        )

    async def get_order_for_print(self, company_id: UUID, order_id: UUID) -> Order:
        """Public wrapper around _get_order — lets the compat print-by-order
        endpoints (BE-12) validate order ownership up front, before
        auto-selecting a printer, so an unknown/foreign order_id 404s
        instead of silently returning an empty job list."""
        return await self._get_order(company_id, order_id)

    # Auto-print: find printers by type and print
    async def auto_print_receipt(self, company_id: UUID, order_id: UUID) -> list[PrintJob]:
        order = await self._get_order(company_id, order_id)
        printers = await self.repo.get_by_type(company_id, order.branch_id, "receipt")
        if not printers:
            logger.warning(
                "auto_print_receipt: no active receipt printer for company=%s (order=%s) — skipped",
                company_id, order_id,
            )
            return []
        jobs = []
        customer_tpl, _ = await self._get_receipt_templates(company_id)
        logo_bytes = await self._get_logo_bytes(company_id)
        for printer in printers:
            receipt_data = await self._build_receipt_data(company_id, order)
            raw = self._render_customer_receipt(printer, receipt_data, customer_tpl, logo_bytes)
            job = await self._enqueue_and_send(
                company_id, printer, "receipt", order_id, raw, server_timeout=AUTO_PRINT_TIMEOUT
            )
            jobs.append(job)
        return jobs

    async def auto_print_kitchen(
        self, company_id: UUID, order_id: UUID, item_ids: list[UUID] | None = None,
    ) -> list[PrintJob]:
        """Кухонный тикет на все активные kitchen-принтеры филиала.

        item_ids — дозаказ: печатаем ТОЛЬКО переданные позиции, а не весь
        заказ (остальное повар уже получил отдельным тикетом).
        """
        order = await self._get_order(company_id, order_id)
        printers = await self.repo.get_by_type(company_id, order.branch_id, "kitchen")
        if not printers:
            logger.warning(
                "auto_print_kitchen: no active kitchen printer for company=%s (order=%s) — skipped",
                company_id, order_id,
            )
            return []
        jobs = []
        _, kitchen_tpl = await self._get_receipt_templates(company_id)
        for printer in printers:
            ticket_data = await self._build_kitchen_data(company_id, order, item_ids=item_ids)
            if item_ids is not None and not ticket_data.items:
                # Все переданные позиции уже отменены/отданы — печатать пустой тикет незачем.
                continue
            raw = self._render_kitchen_ticket(printer, ticket_data, kitchen_tpl)
            job = await self._enqueue_and_send(
                company_id, printer, "kitchen", order_id, raw, server_timeout=AUTO_PRINT_TIMEOUT
            )
            jobs.append(job)
        return jobs

    async def queue_kitchen_additions(
        self, company_id: UUID, order_id: UUID, item_ids: list[UUID],
    ) -> list[tuple[PrintJob, Printer]]:
        """Prepare durable kitchen jobs in the caller's order transaction."""
        order = await self._get_order(company_id, order_id)
        printers = await self.repo.get_by_type(company_id, order.branch_id, "kitchen")
        _, template = await self._get_receipt_templates(company_id)
        ticket = await self._build_kitchen_data(company_id, order, item_ids=item_ids)
        jobs = []
        if not ticket.items:
            return jobs
        for printer in printers:
            raw = self._render_kitchen_ticket(printer, ticket, template)
            job = PrintJob(
                company_id=company_id, printer_id=printer.id, job_type="kitchen",
                ref_id=order_id, payload=base64.b64encode(raw).decode(),
                copies=1, status="pending",
            )
            self.db.add(job)
            jobs.append((job, printer))
        await self.db.flush()
        return jobs

    async def queue_kitchen_quantity_changes(
        self, company_id: UUID, order_id: UUID, deltas: dict[UUID, Decimal], *, cancel: bool,
    ) -> list[tuple[PrintJob, Printer]]:
        """Кухонный тикет на изменение количества уже внесённых позиций.

        deltas — {item_id: положительная дельта}. cancel=False — «добавили ещё»
        (обычный тикет с дельтой), cancel=True — «ОТМЕНА БЛЮДА» с отменённой
        частью. Задания ставятся в транзакцию вызывающего (как у дозаказа).
        """
        if not deltas:
            return []
        order = await self._get_order(company_id, order_id)
        printers = await self.repo.get_by_type(company_id, order.branch_id, "kitchen")
        _, template = await self._get_receipt_templates(company_id)
        ticket = await self._build_kitchen_data(
            company_id, order, item_ids=list(deltas), qty_overrides=deltas,
            kind="item_cancel" if cancel else "new", include_cancelled=cancel,
        )
        jobs: list[tuple[PrintJob, Printer]] = []
        if not ticket.items:
            return jobs
        for printer in printers:
            raw = self._render_kitchen_ticket(printer, ticket, template)
            job = PrintJob(
                company_id=company_id, printer_id=printer.id, job_type="kitchen",
                ref_id=order_id, payload=base64.b64encode(raw).decode(),
                copies=1, status="pending",
            )
            self.db.add(job)
            jobs.append((job, printer))
        await self.db.flush()
        return jobs

    async def notify_kitchen_additions(self, company_id: UUID, jobs: list[tuple[PrintJob, Printer]]) -> None:
        for job, printer in jobs:
            try:
                await printer_ws_manager.broadcast(company_id, printer.branch_id, {
                    "event": "print_job", "job_id": str(job.id), "printer_id": str(printer.id),
                    "payload": job.payload, "copies": job.copies, "job_type": job.job_type,
                    "ip_address": printer.ip_address, "port": printer.port,
                })
            except Exception:
                logger.warning("Kitchen notification failed; pending job %s remains queued", job.id)

    # ── Job queue (for POS terminals that print locally) ─────────────────────

    async def get_pending_jobs(
        self, company_id: UUID, printer_id: UUID, max_age_minutes: int = 10
    ) -> list[PrintJob]:
        """Задания, которые терминал должен напечатать сам.

        PRINT-LAT-01: отдаём только свежие (по умолчанию 10 минут). Без фильтра
        терминал при старте смены выплёвывал бы все когда-либо недопечатанные
        чеки, включая вчерашние.
        """
        jobs = await self.job_repo.get_pending(company_id, printer_id)
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
        fresh: list[PrintJob] = []
        for job in jobs:
            created = job.created_at
            if created is not None and created.tzinfo is None:
                # SQLite отдаёт naive-время (оно в UTC) — приводим к aware.
                created = created.replace(tzinfo=timezone.utc)
            if created is None or created >= cutoff:
                fresh.append(job)
        return fresh

    async def mark_job_done(self, company_id: UUID, job_id: UUID) -> PrintJob:
        job = await self.job_repo.get_by_id(job_id, company_id)
        if not job:
            raise NotFoundError("Print job not found")
        job.status = "done"
        job.error = None
        return await self.job_repo.save(job)

    async def mark_job_failed(self, company_id: UUID, job_id: UUID, error: str | None = None) -> PrintJob:
        """PRINT-LAT-01: терминал не смог напечатать — закрываем задание.

        Раньше у терминала был только «done»: при ошибке печати задание
        навсегда оставалось pending и всплывало при каждом опросе очереди.

        Если терминал — обычный браузер (нет Electron), печатать он не умеет
        вовсе. Тогда сервер допечатывает задание сам, иначе чек не выйдет
        нигде: иначе открытая вкладка «десктопа» молча съедает все задания.
        """
        job = await self.job_repo.get_by_id(job_id, company_id)
        if not job:
            raise NotFoundError("Print job not found")
        was_pending = job.status == "pending"
        job.status = "failed"
        job.error = (error or "print failed")[:500]
        job = await self.job_repo.save(job)
        if was_pending and error and "electron print unavailable" in error:
            job = await self._print_on_server(job)
        return job

    async def _print_on_server(self, job: PrintJob) -> PrintJob:
        """Fallback для браузерного терминала: печатаем сохранённый payload."""
        try:
            printer = await self.get(job.company_id, job.printer_id)
            if printer.connection_type != "network" or not printer.ip_address:
                return job
            raw = base64.b64decode(job.payload)
            for _ in range(job.copies or 1):
                await print_raw(printer, raw, timeout=SERVER_PRINT_TIMEOUT)
            job.status = "done"
            job.error = None
            return await self.job_repo.save(job)
        except (PrinterError, NotFoundError, ValueError):
            # Принтер реально недоступен — оставляем задание failed с исходной
            # причиной терминала, чтобы оно не приходило снова и снова.
            return job

    # ── Internal ─────────────────────────────────────────────────────────────

    async def _enqueue_and_send(
        self,
        company_id: UUID,
        printer: Printer,
        job_type: str,
        ref_id: UUID | None,
        raw: bytes,
        copies: int = 1,
        skip_server_print: bool = False,
        server_timeout: float = SERVER_PRINT_TIMEOUT,
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

        # Шаг 1. Пробуем напечатать сразу с сервера (принтер в одной сети с бэкендом).
        #
        # PRINT-LAT-01: раньше здесь всегда был таймаут 5 с на копию. Если бэкенд
        # стоит в облаке, а принтер — в зале, КАЖДАЯ печать ждала 5 секунд,
        # прежде чем уйти на терминал по WS: отсюда «нажимаю печать и жду».
        #
        # PRINT-LAT-02: клиент, который печатает сам (десктоп), присылает
        # local_print=True — тогда попытку с сервера не делаем вообще. Иначе
        # первый чек после «кулдауна» всё равно ждал SERVER_PRINT_TIMEOUT, а
        # кулдаун живёт в памяти воркера, и при --workers 3 каждый воркер
        # прогревался заново (то быстро, то две секунды — «ведёт себя по-разному»).
        #
        # Раньше сервер ещё и не пытался печатать на приватные адреса
        # (192.168.*), предполагая, что он в облаке. Но в зале бэкенд часто
        # стоит рядом с принтером, а терминал бывает открыт в браузере, где
        # window.electron нет — чек не выходил нигде. Поэтому решает только
        # флаг клиента: не умеет печатать сам (браузер) — печатает сервер,
        # недоступен принтер — задание уходит на терминал, как и раньше.
        printed = False
        if skip_server_print:
            job.error = "Печать на терминале клиента"
        elif printer.connection_type == "network" and printer.ip_address:
            if _is_printer_cooling_down(printer.id):
                job.error = "Принтер недоступен с сервера — задание отправлено на терминал"
            else:
                try:
                    for _ in range(copies):
                        await print_raw(printer, raw, timeout=server_timeout)
                    job.status = "done"
                    printed = True
                    _clear_printer_cooldown(printer.id)
                except PrinterError as e:
                    # НЕ помечаем failed: принтер может быть недоступен с сервера
                    # (бэкенд в облаке), но доступен из сети заведения. Оставляем
                    # pending, чтобы задание подхватил терминал (по WS) или print_agent.
                    job.status = "pending"
                    job.error = str(e)
                    _start_printer_cooldown(printer.id)
        # PRINT-DUP-01: задание сохраняем ОДИН раз и уже с финальным статусом.
        # Раньше строка писалась заранее как pending, а после успешной печати с
        # сервера статус «done» не коммитился вовсе: бумага выходила из бэкенда,
        # а строка в БД оставалась pending — терминал забирал её опросом очереди
        # и печатал тот же чек второй раз.
        # Заодно без записи в БД объект остаётся с незагруженным updated_at и
        # сериализация ответа падает с MissingGreenlet.
        job = await self.job_repo.save(job)

        # Шаг 2. Не напечатали сами — отдаём задание терминалам по WebSocket.
        # Терминал печатает локально и закрывает задание через POST /printers/jobs/{id}/done.
        if not printed:
            try:
                await printer_ws_manager.broadcast(
                    company_id,
                    printer.branch_id,
                    {
                        "event": "print_job",
                        "job_id": str(job.id),
                        "printer_id": str(printer.id),
                        "payload": payload,
                        "copies": copies,
                        "job_type": job_type,
                        # PRINT-LAT-01: ip/port прямо в сообщении — терминал
                        # печатает, даже если его список принтеров ещё не
                        # загрузился (раньше обработчик молча выходил по
                        # `if (!printer) return`, и задание висело pending).
                        "ip_address": printer.ip_address,
                        "port": printer.port,
                    },
                )
            except Exception:  # noqa: BLE001 — доставка по WS не должна ронять оплату/заказ
                pass

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
            # populate_existing: после дозаказа в identity map лежит заказ со
            # старым составом — без refresh новый тикет печатается пустым.
            .execution_options(populate_existing=True)
            .where(Order.id == order_id, Order.company_id == company_id)
        )
        order = result.scalar_one_or_none()
        if not order:
            raise NotFoundError("Order not found")
        return order

    async def _resolve_waiter_name(self, company_id: UUID, order: Order) -> str | None:
        if not order.waiter_id:
            return None
        from app.modules.auth.models import User as _User
        waiter = (
            await self.db.execute(
                select(_User).where(_User.id == order.waiter_id, _User.company_id == company_id)
            )
        ).scalar_one_or_none()
        return waiter.name if waiter else None

    async def _resolve_staff_label(self, company_id: UUID, order: Order) -> str:
        from app.modules.auth.models import User
        from app.modules.rbac.models import Role, UserRole
        if not order.waiter_id:
            return "Кассир"
        roles = (await self.db.execute(
            select(Role.slug).join(UserRole, UserRole.role_id == Role.id)
            .join(User, User.id == UserRole.user_id)
            .where(User.id == order.waiter_id, User.company_id == company_id,
                   (Role.company_id == company_id) | Role.company_id.is_(None),
                   (UserRole.branch_id == order.branch_id) | UserRole.branch_id.is_(None))
        )).scalars().all()
        return "Кассир" if "cashier" in roles else "Официант"

    @staticmethod
    def _zone(tz_name: str | None) -> ZoneInfo:
        """Company timezone for printed timestamps.

        TZ-01 (migration tz01 + the model default) backfills every company
        still on the old "UTC" default to Asia/Tashkent, so a stored "UTC"
        now means the company really is on UTC and must not be overridden.
        The fallback here only covers a missing or unknown zone name.
        """
        try:
            return ZoneInfo((tz_name or "").strip() or DEFAULT_COMPANY_TZ)
        except (ZoneInfoNotFoundError, KeyError, ValueError):
            return ZoneInfo(DEFAULT_COMPANY_TZ)

    @staticmethod
    def _local_time(value: datetime, tz: ZoneInfo) -> datetime:
        """UTC (or naive-as-UTC) timestamp → company-local wall clock.

        Naive values come back naive from Postgres when the column has no
        timezone; they are stored as UTC, so tagging them as UTC before the
        conversion is the correct reading, not a guess.
        """
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(tz)

    async def _build_receipt_data(self, company_id: UUID, order: Order) -> ReceiptData:
        # The product contract is one-payment-only (PaymentService.process
        # rejects a second completed payment and requires amount == order
        # total — see payments/service.py), so at most one row can ever
        # match here. The explicit order_by is defensive determinism, not a
        # multi-payment selection: an unordered `.first()` is non-deterministic
        # SQL even when only one row is expected to exist.
        pay_result = await self.db.execute(
            select(Payment)
            .where(
                Payment.company_id == company_id,
                Payment.order_id == order.id,
                Payment.status == "completed",
            )
            .order_by(Payment.created_at.desc())
        )
        payment = pay_result.scalars().first()

        lines = [
            ReceiptLine(
                name=item.name,
                qty=item.quantity,
                price=item.price,
                total=item.total,
                modifiers=[m.get("name", "") for m in (item.modifiers or [])],
                product_id=str(item.product_id),
                note=item.note,
                course=item.course,
                takeaway=item.takeaway,
            )
            for item in order.items
            if getattr(item, "status", None) != "cancelled"
        ]
        # CANCEL-COMMENT-01: отменённые блюда печатаем отдельным блоком с причиной —
        # гость должен видеть, что позиция снята и почему (возврат денег).
        cancelled_lines = [
            ReceiptLine(
                name=item.name,
                qty=item.quantity,
                price=item.price,
                total=Decimal("0"),
                cancel_reason=getattr(item, "cancel_reason", None),
            )
            for item in order.items
            if getattr(item, "status", None) == "cancelled"
        ]

        # Названия компании/филиала/официанта для «подробного» чека
        from app.modules.companies.models import Company, Branch
        company = (await self.db.execute(select(Company).where(Company.id == company_id))).scalar_one_or_none()
        branch = (
            await self.db.execute(
                select(Branch).where(
                    Branch.id == order.branch_id, Branch.company_id == company_id
                )
            )
        ).scalar_one_or_none()
        waiter_name = await self._resolve_waiter_name(company_id, order)

        from app.modules.pos.order_staff import resolve_receipt_staff
        receipt_staff = (await resolve_receipt_staff(self.db, company_id, [order])).get(order.id, [])

        # A customer receipt shows when this print request is prepared, not
        # when the order was created. Every new reprint gets its own timestamp.
        print_local_time = datetime.now(ZoneInfo("Asia/Tashkent"))

        # База сбора — та же, что в пересчёте заказа: активные позиции
        # «в зале» (без отменённых и «с собой»). Ставка выводится из
        # застывших цифр заказа — перепечатка покажет ставку дня продажи.
        service_base = sum(
            (item.total for item in order.items
             if getattr(item, "status", None) != "cancelled"
             and not getattr(item, "takeaway", False)),
            Decimal("0"),
        )

        return ReceiptData(
            company_name=(company.name if company else "—"),
            branch_name=(branch.name if branch else "—"),
            order_number=order.order_number,
            order_type=order.order_type,
            cashier_name=(waiter_name or "Кассир"),
            items=lines,
            subtotal=order.subtotal,
            discount=order.discount_amount,
            tax=order.tax_amount,
            total=order.total_amount,
            payment_method=(payment.method if payment else None),
            cash_received=payment.cash_received if payment else None,
            change_given=payment.change_given if payment else None,
            table_number=order.table_number,
            service_fee=order.service_fee,
            service_fee_rate=derive_service_rate_percent(order.service_fee, service_base),
            waiter_name=waiter_name,
            printed_at=print_local_time,
            staff_label=await self._resolve_staff_label(company_id, order),
            receipt_staff=receipt_staff,
            cancelled=cancelled_lines,
            customer_phone=order.customer_phone,
            customer_address=order.customer_address,
        )

    async def _build_kitchen_data(
        self, company_id: UUID, order: Order, item_ids: list[UUID] | None = None,
        qty_overrides: dict[UUID, Decimal] | None = None, kind: str = "new", include_cancelled: bool = False,
    ) -> KitchenTicketData:
        # Дозаказ печатается по-позиционно: item_ids ограничивает тикет
        # только новыми блюдами, а не всем составом стола.
        # qty_overrides — тикет на ИЗМЕНЕНИЕ количества (плюс/минус на уже
        # внесённой позиции): печатаем дельту, а не итоговое количество.
        wanted = set(item_ids) if item_ids is not None else None
        overrides = qty_overrides or {}
        items = [
            KitchenItem(
                name=item.name,
                qty=format_quantity(overrides.get(item.id, item.quantity)),
                note=item.note,
                modifiers=[m.get("name", "") for m in (item.modifiers or [])],
                course=item.course,
                total=item.total,
                product_id=str(item.product_id),
                takeaway=item.takeaway,
            )
            for item in order.items
            if (wanted is None or item.id in wanted)
            and (include_cancelled or item.status != "cancelled") and item.status != "served"
        ]
        waiter_name = await self._resolve_waiter_name(company_id, order)
        # Match the order timestamp in the preview, including stable reprints.
        # DB timestamps are UTC; SQLite/legacy naive values also represent UTC.
        created_at = order.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        order_local_time = created_at.astimezone(ZoneInfo("Asia/Tashkent"))
        return KitchenTicketData(
            order_number=order.order_number,
            order_type=order.order_type,
            table_number=order.table_number,
            waiter_name=waiter_name,
            items=items,
            note=order.note,
            status=order.status,
            printed_at=order_local_time,
            staff_label=await self._resolve_staff_label(company_id, order),
            kind=kind,
        )

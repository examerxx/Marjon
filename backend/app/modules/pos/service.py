from __future__ import annotations
import hashlib
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.modules.companies.models import Branch, Company
from app.modules.crm.models import Customer
from app.modules.halls.models import Hall, Table
from app.modules.inventory.models import Product
from app.modules.kitchen.websocket import kitchen_manager
from app.modules.audit.service import AuditService
from app.modules.pos.models import (
    Order, OrderItem, OrderNumberCounter, OrderPublicIdCounter, PosTerminal, CashierShift,
)
from app.modules.pos.repository import OrderRepository, OrderItemRepository, TerminalRepository
from app.modules.pos.schemas import (
    OrderCreate, OrderItemCreate, OrderStatusUpdate,
    OrderUpdate, TerminalCreate, ShiftOpen, ShiftClose,
)
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError
from app.shared.tenant_scope import require_company_resource

# ── Order status state machine ───────────────────────────────────────────────
VALID_TRANSITIONS: dict[str, set[str]] = {
    "new":       {"accepted", "cooking", "cancelled"},
    "accepted":  {"cooking", "cancelled"},
    "cooking":   {"ready", "cancelled"},
    "ready":     {"completed", "cancelled"},
    "completed": set(),           # final state — no transitions
    "cancelled": set(),           # final state — no transitions
}


def _quantize(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _stamp_order_cancellation(order: Order, actor_id: UUID | None) -> None:
    """Phase 1A: record truthful whole-order cancellation event, idempotently.

    Only fills missing values — never overwrites an existing cancellation
    event with a later request. System paths pass actor_id=None (stays NULL).
    """
    if order.cancelled_at is None:
        order.cancelled_at = _utcnow()
    if order.cancelled_by_id is None and actor_id is not None:
        order.cancelled_by_id = actor_id


def _stamp_item_cancellation(item: OrderItem, actor_id: UUID | None) -> None:
    """Phase 1A: record truthful item cancellation event, idempotently."""
    if item.cancelled_at is None:
        item.cancelled_at = _utcnow()
    if item.cancelled_by_id is None and actor_id is not None:
        item.cancelled_by_id = actor_id


class OrderService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = OrderRepository(db)

    # ── Create ────────────────────────────────────────────────────────────────

    async def create(self, company_id: UUID, waiter_id: UUID, data: OrderCreate) -> Order:
        await self._get_branch(company_id, data.branch_id)
        await require_company_resource(
            self.db, PosTerminal, data.terminal_id, company_id, detail="POS terminal not found"
        )
        await require_company_resource(
            self.db, Customer, data.customer_id, company_id, detail="Customer not found"
        )
        # Canonical table relation: when table_id is supplied it is authoritative —
        # validate tenant/branch ownership + active state and let the server own the
        # table_number snapshot. Otherwise fall back to the legacy free-text number.
        table_id = None
        table_number = data.table_number
        hall_name_snapshot = None
        if data.table_id is not None:
            table = await self._resolve_table(company_id, data.table_id, data.branch_id)
            table_id = table.id
            table_number = str(table.number)
            # ORDERS-TRUTH-01: freeze the hall NAME at creation. Read once here,
            # never re-resolved by the report — a later rename/archival can't
            # alter this historical value.
            hall_name_snapshot = await self._resolve_hall_name(table.hall_id)
        # ORDERS-TRUTH-01 numbering: plain 1..N per company+branch+local day.
        order_number, order_local_date = await self._generate_order_number(company_id, data.branch_id)
        public_id = await self._next_public_id(company_id)

        order = Order(
            company_id=company_id,
            waiter_id=waiter_id,
            public_id=public_id,
            order_number=order_number,
            order_local_date=order_local_date,
            branch_id=data.branch_id,
            terminal_id=data.terminal_id,
            customer_id=data.customer_id,
            order_type=data.order_type,
            table_id=table_id,
            table_number=table_number,
            hall_name_snapshot=hall_name_snapshot,
            persons_count=data.persons_count,
            note=data.note,
        )
        self.db.add(order)
        await self.db.flush()

        subtotal = Decimal("0")
        for item_data in data.items:
            product = await self._get_product(company_id, item_data.product_id)
            item_total = _quantize(product.price * item_data.quantity)

            # Apply per-item discount if provided
            item_discount = _quantize(item_data.discount) if item_data.discount else Decimal("0")
            item_total_after_discount = max(item_total - item_discount, Decimal("0"))
            subtotal += item_total_after_discount

            item = OrderItem(
                order_id=order.id,
                product_id=product.id,
                name=product.name,
                price=product.price,
                quantity=item_data.quantity,
                discount=item_discount,
                total=item_total_after_discount,
                note=item_data.note,
                modifiers=item_data.modifiers,
                course=item_data.course,
            )
            self.db.add(item)

        # Calculate totals
        order.subtotal = subtotal
        self._recalculate_totals(order, data.discount_amount, data.service_fee_rate)
        await self.db.commit()
        created_order = await self.get(company_id, order.id)
        try:
            await kitchen_manager.broadcast(
                company_id, data.branch_id, "new_order", {"order_id": str(created_order.id)}
            )
        except Exception:
            pass
        try:
            await AuditService(self.db).log(
                company_id, waiter_id, "order.create", "order",
                entity_id=created_order.id,
                new_data={"order_number": created_order.order_number, "total": str(created_order.total_amount)},
            )
        except Exception:
            pass
        return created_order

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get(self, company_id: UUID, order_id: UUID) -> Order:
        order = await self.repo.get_by_id(order_id, company_id)
        if not order:
            raise NotFoundError("Order not found")
        return order

    async def list(
        self,
        company_id: UUID,
        branch_id: UUID | None = None,
        status: str | None = None,
        selected_date: date | None = None,
        active_only: bool = False,
        table_number: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[Order]:
        if status:
            return await self.repo.get_by_status(company_id, status, branch_id, selected_date)
        return await self.repo.get_all(
            company_id,
            selected_date=selected_date,
            branch_id=branch_id,
            active_only=active_only,
            table_number=table_number,
            limit=limit,
            offset=offset,
        )

    # ── Update status (state machine) ─────────────────────────────────────────

    async def update_status(
        self, company_id: UUID, order_id: UUID, data: OrderStatusUpdate,
        actor_id: UUID | None = None,
    ) -> Order:
        order = await self.get(company_id, order_id)
        current = order.status
        target = data.status

        if target not in VALID_TRANSITIONS.get(current, set()):
            raise ValidationError(
                f"Невозможно перевести заказ из '{current}' в '{target}'. "
                f"Допустимые переходы: {VALID_TRANSITIONS.get(current, set()) or 'нет'}"
            )

        order.status = target
        if target == "cancelled":
            # Truthful whole-order cancellation via state machine (POS status
            # PATCH). Only stamps when the transition actually becomes
            # cancelled; later updates are impossible (cancelled is final).
            _stamp_order_cancellation(order, actor_id)
        if target == "cooking":
            # Kitchen accepted the whole order — move its pending items into cooking too,
            # otherwise "mark item ready" fails validation (pending can't skip to ready).
            for item in order.items:
                if item.status == "pending":
                    item.status = "cooking"
        await self.repo.save(order)
        updated_order = await self.get(company_id, order_id)
        try:
            await kitchen_manager.broadcast(
                company_id, order.branch_id, "order_updated",
                {"order_id": str(order_id), "status": target},
            )
        except Exception:
            pass
        try:
            await AuditService(self.db).log(
                company_id, None, "order.status_change", "order",
                entity_id=order_id,
                old_data={"status": current}, new_data={"status": target},
            )
        except Exception:
            pass
        return updated_order

    # ── Cancel ────────────────────────────────────────────────────────────────

    async def cancel(
        self, company_id: UUID, order_id: UUID, actor_id: UUID | None = None
    ) -> Order:
        order = await self.get(company_id, order_id)
        if order.status in ("completed", "cancelled"):
            raise ValidationError(f"Невозможно отменить заказ в статусе '{order.status}'")
        order.status = "cancelled"
        _stamp_order_cancellation(order, actor_id)
        saved = await self.repo.save(order)
        try:
            await kitchen_manager.broadcast(
                company_id, order.branch_id, "order_cancelled", {"order_id": str(order_id)}
            )
        except Exception:
            pass
        return saved

    # ── Add item to existing order ────────────────────────────────────────────

    async def add_item(self, company_id: UUID, order_id: UUID, item_data: OrderItemCreate) -> Order:
        order = await self.get(company_id, order_id)
        if order.status in ("completed", "cancelled"):
            raise ValidationError("Нельзя добавить позицию к завершённому или отменённому заказу")

        product = await self._get_product(company_id, item_data.product_id)
        item_total = _quantize(product.price * item_data.quantity)
        item_discount = _quantize(item_data.discount) if item_data.discount else Decimal("0")
        item_total_after_discount = max(item_total - item_discount, Decimal("0"))

        item = OrderItem(
            order_id=order.id,
            product_id=product.id,
            name=product.name,
            price=product.price,
            quantity=item_data.quantity,
            discount=item_discount,
            total=item_total_after_discount,
            note=item_data.note,
            modifiers=item_data.modifiers,
            course=item_data.course,
        )
        self.db.add(item)

        order.subtotal += item_total_after_discount
        self._recalculate_totals(order)
        await self.db.commit()
        return await self.get(company_id, order_id)

    # ── Remove item from order ────────────────────────────────────────────────

    async def remove_item(
        self, company_id: UUID, order_id: UUID, item_id: UUID,
        actor_id: UUID | None = None,
    ) -> Order:
        order = await self.get(company_id, order_id)
        if order.status in ("completed", "cancelled"):
            raise ValidationError("Нельзя удалить позицию из завершённого или отменённого заказа")

        item = await self._get_order_item(order, item_id)
        order.subtotal -= item.total
        item.status = "cancelled"
        _stamp_item_cancellation(item, actor_id)
        item.total = Decimal("0")
        self._recalculate_totals(order)
        await self.db.commit()
        return await self.get(company_id, order_id)

    # ── Update order (discount / service fee / note) ──────────────────────────

    async def update_order(self, company_id: UUID, order_id: UUID, data: OrderUpdate) -> Order:
        order = await self.get(company_id, order_id)
        if order.status in ("completed", "cancelled"):
            raise ValidationError("Нельзя редактировать завершённый или отменённый заказ")

        table_id_provided = "table_id" in data.model_fields_set
        table_number_provided = "table_number" in data.model_fields_set
        # Snapshot invariant: while an authoritative table_id is set, table_number is
        # a server-owned snapshot of Table.number — not an independently editable
        # field. A table_number-only PATCH (table_id omitted) on such an order would
        # let the snapshot drift from the relation, so reject it. The client must
        # change the relation explicitly (send table_id, or table_id=null to detach).
        # Legacy orders (table_id already NULL) keep free-text table_number edits.
        if table_number_provided and not table_id_provided and order.table_id is not None:
            raise ConflictError(
                "Заказ привязан к столу (table_id) — table_number является снимком "
                "и не редактируется отдельно. Передайте table_id (или table_id=null, "
                "чтобы отвязать) для изменения привязки."
            )

        if data.note is not None:
            order.note = data.note
        if data.table_number is not None:
            order.table_number = data.table_number
        # table_id is authoritative: applied after table_number so that when both
        # are sent the canonical Table.number snapshot wins. An explicit null clears
        # the relation without touching the retained table_number snapshot.
        if table_id_provided:
            if data.table_id is None:
                order.table_id = None
                # Detaching the table clears the hall snapshot — the order no
                # longer belongs to any hall. (The table_number snapshot follows
                # its existing retain-unless-explicitly-changed semantics below.)
                order.hall_name_snapshot = None
            else:
                table = await self._resolve_table(company_id, data.table_id, order.branch_id)
                order.table_id = table.id
                order.table_number = str(table.number)
                # Keep the place snapshot consistent with the table the order is
                # now linked to (same re-stamp semantics as table_number above).
                # A later hall RENAME still never mutates this frozen value.
                order.hall_name_snapshot = await self._resolve_hall_name(table.hall_id)
        if data.persons_count is not None:
            order.persons_count = data.persons_count

        self._recalculate_totals(order, data.discount_amount, data.service_fee_rate)
        await self.repo.save(order)
        return await self.get(company_id, order_id)

    # ── Internals ─────────────────────────────────────────────────────────────

    def _recalculate_totals(
        self,
        order: Order,
        discount_override: Decimal | None = None,
        service_fee_rate_override: float | None = None,
    ) -> None:
        """Recalculate tax, discount, service_fee, total_amount from subtotal."""
        subtotal = order.subtotal

        # Discount (manual amount)
        if discount_override is not None:
            order.discount_amount = _quantize(discount_override)
        after_discount = max(subtotal - order.discount_amount, Decimal("0"))

        # Tax (НДС 12% — from settings, applied after discount)
        tax_rate = Decimal(str(settings.default_tax_rate))
        order.tax_amount = _quantize(after_discount * tax_rate)

        # Service fee (rate-based)
        if service_fee_rate_override is not None:
            fee_rate = Decimal(str(service_fee_rate_override))
        else:
            fee_rate = Decimal(str(settings.default_service_fee_rate))
        order.service_fee = _quantize(after_discount * fee_rate)

        order.total_amount = _quantize(after_discount + order.tax_amount + order.service_fee)

    async def _company_local_today(self, company_id: UUID) -> date:
        """The company-local calendar date right now (default Asia/Tashkent)."""
        tz_str = await self._get_company_timezone(company_id)
        try:
            tz = ZoneInfo(tz_str)
        except (ZoneInfoNotFoundError, KeyError):
            tz = ZoneInfo("Asia/Tashkent")
        return datetime.now(tz).date()

    async def _generate_order_number(self, company_id: UUID, branch_id: UUID) -> tuple[str, date]:
        """ORDERS-TRUTH-01 human order number: plain "1","2","3"…, resetting every
        company-local calendar day, scoped per company + branch. Each branch numbers
        independently; the next local day starts again at 1.

        Concurrency-safe by construction: a pg_advisory_xact_lock keyed on
        company:branch:local_date serializes the read-modify-write of the durable
        OrderNumberCounter row (SQLite tests run single-connection and stub the lock
        as a no-op). The counter's composite unique + the Order partial-unique
        backstop guarantee no duplicate survives even if the lock is bypassed. This
        replaces the old COUNT(*)+1 scheme (which double-counted on deletes and had
        no durable state).
        """
        today_local = await self._company_local_today(company_id)

        # Serialize same company/branch/day generation (no-op stub on SQLite).
        lock_key = int.from_bytes(
            hashlib.sha256(f"{company_id}:{branch_id}:{today_local}".encode()).digest()[:8],
            "big", signed=True,
        )
        await self.db.execute(text("SELECT pg_advisory_xact_lock(:k)").bindparams(k=lock_key))

        counter = (
            await self.db.execute(
                select(OrderNumberCounter).where(
                    OrderNumberCounter.company_id == company_id,
                    OrderNumberCounter.branch_id == branch_id,
                    OrderNumberCounter.local_date == today_local,
                )
            )
        ).scalar_one_or_none()
        if counter is None:
            counter = OrderNumberCounter(
                company_id=company_id, branch_id=branch_id,
                local_date=today_local, last_value=1,
            )
            self.db.add(counter)
        else:
            counter.last_value += 1
        await self.db.flush()
        return str(counter.last_value), today_local

    async def _next_public_id(self, company_id: UUID) -> int:
        """ORDERS-TRUTH-01 stable PER-COMPANY public numeric id (target 8 digits).

        Each company numbers independently from 10000000 (counter seeded at
        9999999, first value 10000000; grows to 9+ digits rather than reuse a
        value). Sourced from the durable per-company OrderPublicIdCounter via an
        atomic read-modify-write serialized by a pg_advisory_xact_lock on the
        company (SQLite tests run single-connection and stub the lock as a
        no-op). The composite UNIQUE(company_id, public_id) on orders is the hard
        backstop. Never global, never derived from the UUID.
        """
        # Serialize same-company generation (no-op stub on SQLite). A dedicated
        # lock namespace keyed on the company id keeps it independent of the
        # order-number lock.
        lock_key = int.from_bytes(
            hashlib.sha256(f"public_id:{company_id}".encode()).digest()[:8],
            "big", signed=True,
        )
        await self.db.execute(text("SELECT pg_advisory_xact_lock(:k)").bindparams(k=lock_key))

        counter = (
            await self.db.execute(
                select(OrderPublicIdCounter).where(OrderPublicIdCounter.company_id == company_id)
            )
        ).scalar_one_or_none()
        if counter is None:
            counter = OrderPublicIdCounter(company_id=company_id, last_value=10_000_000)
            self.db.add(counter)
        else:
            counter.last_value += 1
        await self.db.flush()
        return int(counter.last_value)

    async def _resolve_hall_name(self, hall_id: UUID) -> str | None:
        return (
            await self.db.execute(select(Hall.name).where(Hall.id == hall_id))
        ).scalar_one_or_none()

    async def _get_company_timezone(self, company_id: UUID) -> str:
        result = await self.db.execute(
            select(Company.timezone).where(Company.id == company_id)
        )
        return result.scalar_one_or_none() or "Asia/Tashkent"

    async def _get_branch(self, company_id: UUID, branch_id: UUID) -> Branch:
        result = await self.db.execute(
            select(Branch).where(Branch.id == branch_id, Branch.company_id == company_id)
        )
        branch = result.scalar_one_or_none()
        if not branch:
            raise NotFoundError("Branch not found")
        return branch

    async def _resolve_table(self, company_id: UUID, table_id: UUID, branch_id: UUID) -> Table:
        """Resolve a canonical Table for an order.

        Table has no direct company_id — ownership is proven through its Hall
        (Table.hall_id → Hall.company_id), so a plain company-scoped lookup is not
        enough. We join Hall and require:
          - Hall.company_id == the order's company (tenant isolation)
          - Hall.branch_id == the order's branch (branch compatibility)
          - both Table and Hall active (no new orders against archived seating)
        Never loads another tenant's row; a miss on any condition is a 404.
        """
        result = await self.db.execute(
            select(Table)
            .join(Hall, Hall.id == Table.hall_id)
            .where(
                Table.id == table_id,
                Table.is_active.is_(True),
                Hall.company_id == company_id,
                Hall.branch_id == branch_id,
                Hall.is_active.is_(True),
                # Phase 5C-6D: no new orders against a DELETED (archived) hall.
                Hall.deleted_at.is_(None),
            )
        )
        table = result.scalar_one_or_none()
        if table is None:
            raise NotFoundError("Table not found")
        return table

    async def _get_product(self, company_id: UUID, product_id: UUID) -> Product:
        result = await self.db.execute(
            select(Product).where(
                Product.id == product_id,
                Product.company_id == company_id,
                Product.is_active == True,
            )
        )
        product = result.scalar_one_or_none()
        if not product:
            raise NotFoundError("Product not found or inactive")
        return product

    async def _get_order_item(self, order: Order, item_id: UUID) -> OrderItem:
        for item in order.items:
            if item.id == item_id and item.status != "cancelled":
                return item
        raise NotFoundError("Order item not found")


class TerminalService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = TerminalRepository(db)

    async def create(self, company_id: UUID, data: TerminalCreate) -> PosTerminal:
        await require_company_resource(
            self.db, Branch, data.branch_id, company_id, detail="Branch not found"
        )
        return await self.repo.save(PosTerminal(company_id=company_id, **data.model_dump()))

    async def list(self, company_id: UUID) -> list[PosTerminal]:
        return await self.repo.get_all(company_id)


class ShiftService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def open_shift(self, company_id: UUID, cashier_id: UUID, data: ShiftOpen) -> CashierShift:
        await require_company_resource(
            self.db, Branch, data.branch_id, company_id, detail="Branch not found"
        )
        existing = await self._get_open_shift(company_id, data.branch_id)
        if existing:
            raise ValidationError("Смена уже открыта. Закройте текущую смену перед открытием новой.")

        shift = CashierShift(
            company_id=company_id,
            branch_id=data.branch_id,
            cashier_id=cashier_id,
            opened_at=datetime.now(timezone.utc),
            opening_cash=data.opening_cash,
            status="open",
        )
        self.db.add(shift)
        await self.db.commit()
        await self.db.refresh(shift)
        return shift

    async def close_shift(self, company_id: UUID, cashier_id: UUID, data: ShiftClose) -> CashierShift:
        result = await self.db.execute(
            select(CashierShift).where(
                CashierShift.company_id == company_id,
                CashierShift.cashier_id == cashier_id,
                CashierShift.status == "open",
            )
        )
        shift = result.scalar_one_or_none()
        if not shift:
            raise NotFoundError("Нет открытой смены для закрытия")

        shift.closed_at = datetime.now(timezone.utc)
        shift.closing_cash = data.closing_cash
        shift.status = "closed"
        self.db.add(shift)
        await self.db.commit()
        await self.db.refresh(shift)
        return shift

    async def get_current(self, company_id: UUID, branch_id: UUID) -> CashierShift | None:
        return await self._get_open_shift(company_id, branch_id)

    async def get_shift_for_date(self, company_id: UUID, selected_date: date) -> CashierShift | None:
        day_start = datetime.combine(selected_date, datetime.min.time())
        day_end = datetime.combine(selected_date, datetime.max.time())
        result = await self.db.execute(
            select(CashierShift).where(
                CashierShift.company_id == company_id,
                CashierShift.opened_at >= day_start,
                CashierShift.opened_at <= day_end,
            ).order_by(CashierShift.opened_at.desc())
        )
        return result.scalar_one_or_none()

    async def _get_open_shift(self, company_id: UUID, branch_id: UUID) -> CashierShift | None:
        result = await self.db.execute(
            select(CashierShift).where(
                CashierShift.company_id == company_id,
                CashierShift.branch_id == branch_id,
                CashierShift.status == "open",
            )
        )
        return result.scalar_one_or_none()

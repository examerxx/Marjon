from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from sqlalchemy import and_, bindparam, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.analytics.schemas import (
    DashboardResponse,
    PaymentMethodSummary,
    SalesReport,
    TopProduct,
    UserActivityRank,
    ZReportCoverageNote,
    ZReportDetailEntity,
    ZReportDetailFiltersResponse,
    ZReportDetailOption,
    ZReportDetailResponse,
    ZReportFigures,
    ZReportResponse,
)
from app.modules.auth.models import RefreshToken, User
from app.modules.companies.models import Company
from app.modules.fiscal.models import FiscalReceipt
from app.modules.halls.models import Hall, Table
from app.modules.payments.models import Payment
from app.modules.pos.models import Order, OrderItem
from app.modules.rbac.models import Role, UserRole
from app.shared.tenant_scope import require_company_resource_ids


class AnalyticsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _company_tz(self, company_id: UUID) -> ZoneInfo:
        result = await self.db.execute(
            select(Company.timezone).where(Company.id == company_id)
        )
        tz_str = result.scalar_one_or_none() or "Asia/Tashkent"
        try:
            return ZoneInfo(tz_str)
        except (ZoneInfoNotFoundError, KeyError):
            return ZoneInfo("Asia/Tashkent")

    @staticmethod
    def _date_bounds(selected_date: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
        """Return UTC-aware [day_start, day_end) for a local calendar date."""
        day_start = datetime.combine(selected_date, datetime.min.time()).replace(tzinfo=tz).astimezone(timezone.utc)
        day_end   = datetime.combine(selected_date + timedelta(days=1), datetime.min.time()).replace(tzinfo=tz).astimezone(timezone.utc)
        return day_start, day_end

    async def dashboard(self, company_id: UUID, selected_date: date | None = None) -> DashboardResponse:
        # ANALYTICS-DATE-BOUNDARY-01: the window is HALF-OPEN, [day_start,
        # day_end), matching the canonical rule already enforced in z_report.
        #  * explicit ?date=D → day_end is the NEXT local midnight, so an
        #    inclusive `<= day_end` counted an order stamped exactly at
        #    D+1 00:00 local in BOTH D's and D+1's dashboard (double count).
        #  * default (no date) → day_end is overwritten with the current UTC
        #    instant, computed at query time and therefore already at or after
        #    every stored row; `<` only drops a row whose created_at equals that
        #    instant to the microsecond, so the visible totals are unchanged.
        # One predicate, one contract.
        tz = await self._company_tz(company_id)
        if selected_date:
            day_start, day_end = self._date_bounds(selected_date, tz)
        else:
            now_local = datetime.now(tz)
            today = now_local.date()
            day_start, day_end = self._date_bounds(today, tz)
            day_end = datetime.now(timezone.utc)  # up to now, not end of day

        result = await self.db.execute(
            select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
            .where(
                Order.company_id == company_id,
                Order.status.notin_(["cancelled"]),
                Order.created_at >= day_start,
                Order.created_at < day_end,
            )
        )
        count, revenue = result.one()

        active = await self.db.execute(
            select(func.count(Order.id))
            .where(
                Order.company_id == company_id,
                Order.status.in_(["new", "accepted", "cooking", "ready"]),
            )
        )
        active_count = active.scalar_one()

        avg_check = Decimal(str(revenue)) / count if count > 0 else Decimal("0")
        return DashboardResponse(
            today_revenue=Decimal(str(revenue)),
            today_orders=count,
            avg_check=avg_check,
            active_orders=active_count,
        )

    async def sales_report(self, company_id: UUID, date_from: date, date_to: date) -> list[SalesReport]:
        tz = await self._company_tz(company_id)
        start, _ = self._date_bounds(date_from, tz)
        _, end    = self._date_bounds(date_to, tz)
        # One reusable day-bucket expression with a single named bind for the
        # timezone, so SELECT / GROUP BY / ORDER BY compile to the *same*
        # PostgreSQL expression (same bind identity). Rebuilding it per clause
        # emitted a distinct bind per clause and tripped PostgreSQL's
        # "must appear in the GROUP BY clause" rule (SQLite masks this).
        day = func.date(func.timezone(bindparam("sales_tz", str(tz)), Order.created_at))
        result = await self.db.execute(
            select(
                day.label("day"),
                func.count(Order.id).label("cnt"),
                func.coalesce(func.sum(Order.total_amount), 0).label("rev"),
            )
            .where(
                Order.company_id == company_id,
                Order.status.notin_(["cancelled"]),
                Order.created_at >= start,
                Order.created_at < end,
            )
            .group_by(day)
            .order_by(day)
        )
        rows = result.all()
        return [
            SalesReport(
                date=row.day,
                orders_count=row.cnt,
                revenue=Decimal(str(row.rev)),
                avg_check=Decimal(str(row.rev)) / row.cnt if row.cnt > 0 else Decimal("0"),
            )
            for row in rows
        ]

    async def top_products(
        self,
        company_id: UUID,
        limit: int = 20,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> list[TopProduct]:
        query = (
            select(
                OrderItem.product_id,
                OrderItem.name,
                func.sum(OrderItem.quantity).label("qty"),
                func.sum(OrderItem.total).label("rev"),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .where(Order.company_id == company_id, Order.status.notin_(["cancelled"]))
            .group_by(OrderItem.product_id, OrderItem.name)
            .order_by(func.sum(OrderItem.total).desc())
            .limit(limit)
        )
        if date_from or date_to:
            tz = await self._company_tz(company_id)
        if date_from:
            query = query.where(Order.created_at >= self._date_bounds(date_from, tz)[0])
        if date_to:
            query = query.where(Order.created_at < self._date_bounds(date_to, tz)[1])

        result = await self.db.execute(
            query
        )
        return [
            TopProduct(
                product_id=row.product_id,
                name=row.name,
                quantity_sold=Decimal(str(row.qty)),
                revenue=Decimal(str(row.rev)),
            )
            for row in result.all()
        ]

    # --- ZR-PRINT-01B: per-entity detail --------------------------------
    #
    # Accounting semantics, fixed by product decision and NOT inferable from the
    # schema alone:
    #   * cashier — an order belongs to a cashier when the COMPLETED payment that
    #     closed it carries that cashier_id. Gateway/webhook payments are written
    #     with cashier_id NULL (no identifiable cashier), so they belong to no
    #     cashier section; they remain in the whole-company Z-report. Cancelled
    #     orders have no completed payment, and refunds are set by gateway
    #     webhooks that never write cashier_id — both are reported as
    #     UNSUPPORTED (None), never as an authoritative 0.
    #   * waiter — Order.waiter_id directly. Payment/receipt figures are
    #     "on orders attributed to this waiter", not "personally taken by".
    #   * hall — Order.table_id -> Table.hall_id only. Orders with table_id NULL
    #     (takeaway/delivery/QR, legacy rows) belong to no hall, so hall sections
    #     legitimately do not foot to the whole-company report.
    #
    # `net_sales` is Sum(Order.total_amount) — the FINAL order amount, already
    # inclusive of service_fee and tax (pos/service.py::_recalculate_totals:
    # total_amount = after_discount + tax_amount + service_fee). This is the
    # figure the Print UI multiplies by the user-entered waiter percentage;
    # service_fee_total is returned separately as an informational metric and is
    # NOT the percentage base.
    _DETAIL_UNSUPPORTED: dict[str, tuple[str, ...]] = {
        "cashier": ("cancelled_orders_count", "refunds_total"),
        "waiter": (),
        "hall": (),
    }
    _DETAIL_COVERAGE: dict[str, tuple[tuple[str, str], ...]] = {
        "cashier": (
            (
                "CASHIER_UNATTRIBUTED_PAYMENTS_EXCLUDED",
                "Платежи без кассира (шлюзовые оплаты) не входят ни в один отчёт "
                "по кассиру, поэтому сумма по кассирам может быть меньше общего "
                "Z-отчёта.",
            ),
            (
                "CASHIER_CANCELLED_ORDERS_UNSUPPORTED",
                "Отменённые заказы не закрываются платежом, поэтому их нельзя "
                "отнести к кассиру.",
            ),
            (
                "CASHIER_REFUNDS_UNSUPPORTED",
                "Возвраты выполняются платёжным шлюзом и не хранят кассира, "
                "поэтому сумма возвратов по кассиру не определена.",
            ),
        ),
        "waiter": (
            (
                "WAITER_PAYMENTS_VIA_ORDERS",
                "Оплаты и фискальные чеки отнесены к официанту через его заказы, "
                "а не как лично принятые им платежи.",
            ),
        ),
        "hall": (
            (
                "HALL_TABLELESS_ORDERS_EXCLUDED",
                "Заказы без стола (навынос, доставка, QR и устаревшие записи) не "
                "относятся ни к одному месту, поэтому сумма по местам может быть "
                "меньше общего Z-отчёта.",
            ),
        ),
    }

    async def z_report(
        self,
        company_id: UUID,
        selected_date: date | None = None,
        *,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> ZReportResponse:
        # Two truthful modes over the SAME raw-fact aggregation window:
        #  * single date  → [date 00:00, next-day 00:00)  (legacy, unchanged)
        #  * period        → [date_from 00:00, (date_to+1) 00:00)
        # A one-day period is byte-identical to the single-date report. All
        # queries below run ONCE over [day_start, day_end) — no per-day loop.
        #
        # ZR-PERIOD-01C: the window is HALF-OPEN. _date_bounds already returns
        # the NEXT local midnight as day_end, so every fact source must filter
        # `created_at >= day_start AND created_at < day_end`. An inclusive
        # `<= day_end` counted a fact stamped exactly at next-day local
        # midnight in BOTH this report and the following day's/period's report
        # (double counting, and a broken hand-off between adjacent periods).
        # Keep all sources below on the identical `>= / <` contract.
        tz = await self._company_tz(company_id)
        if date_from is not None and date_to is not None:
            day_start = self._date_bounds(date_from, tz)[0]
            day_end = self._date_bounds(date_to, tz)[1]
            response_date, response_from, response_to = date_to, date_from, date_to
            single = False
        else:
            day_start, day_end = self._date_bounds(selected_date, tz)
            response_date, response_from, response_to = selected_date, None, None
            single = True

        completed_orders = await self.db.execute(
            select(
                func.count(Order.id),
                func.coalesce(func.sum(Order.subtotal), 0),
                func.coalesce(func.sum(Order.discount_amount), 0),
                func.coalesce(func.sum(Order.service_fee), 0),
                func.coalesce(func.sum(Order.tax_amount), 0),
                func.coalesce(func.sum(Order.total_amount), 0),
            )
            .where(
                Order.company_id == company_id,
                Order.status == "completed",
                Order.created_at >= day_start,
                Order.created_at < day_end,
            )
        )
        orders_count, gross_sales, discounts_total, service_fee_total, tax_total, net_sales = completed_orders.one()

        cancelled_orders = await self.db.execute(
            select(func.count(Order.id))
            .where(
                Order.company_id == company_id,
                Order.status == "cancelled",
                Order.created_at >= day_start,
                Order.created_at < day_end,
            )
        )
        cancelled_orders_count = cancelled_orders.scalar_one()

        payments = await self.db.execute(
            select(
                Payment.method,
                func.count(Payment.id),
                func.coalesce(func.sum(Payment.amount), 0),
                func.coalesce(func.sum(Payment.cash_received), 0),
                func.coalesce(func.sum(Payment.change_given), 0),
            )
            .where(
                Payment.company_id == company_id,
                Payment.status == "completed",
                Payment.created_at >= day_start,
                Payment.created_at < day_end,
            )
            .group_by(Payment.method)
        )
        payment_rows = payments.all()

        payment_methods = [
            PaymentMethodSummary(
                method=row.method,
                count=row[1],
                amount=Decimal(str(row[2] or 0)),
            )
            for row in payment_rows
        ]
        payments_count = sum(row[1] for row in payment_rows)
        cash_total = sum(Decimal(str(row[2] or 0)) for row in payment_rows if row.method == "cash")
        cash_received_total = sum(Decimal(str(row[3] or 0)) for row in payment_rows)
        change_given_total = sum(Decimal(str(row[4] or 0)) for row in payment_rows)
        non_cash_total = sum(Decimal(str(row[2] or 0)) for row in payment_rows if row.method != "cash")

        refunds = await self.db.execute(
            select(func.coalesce(func.sum(Payment.amount), 0))
            .where(
                Payment.company_id == company_id,
                Payment.status == "refunded",
                Payment.created_at >= day_start,
                Payment.created_at < day_end,
            )
        )
        refunds_total = Decimal(str(refunds.scalar_one() or 0))

        fiscal = await self.db.execute(
            select(func.count(FiscalReceipt.id))
            .where(
                FiscalReceipt.company_id == company_id,
                FiscalReceipt.status == "sent",
                FiscalReceipt.created_at >= day_start,
                FiscalReceipt.created_at < day_end,
            )
        )
        fiscal_receipts_count = fiscal.scalar_one()

        net_sales_decimal = Decimal(str(net_sales or 0))
        return ZReportResponse(
            date=response_date,
            date_from=response_from,
            date_to=response_to,
            shift_opened_at="09:00" if single else None,
            shift_closed_at=None,
            is_closed=False,
            orders_count=orders_count,
            cancelled_orders_count=cancelled_orders_count,
            payments_count=payments_count,
            fiscal_receipts_count=fiscal_receipts_count,
            gross_sales=Decimal(str(gross_sales or 0)),
            discounts_total=Decimal(str(discounts_total or 0)),
            service_fee_total=Decimal(str(service_fee_total or 0)),
            tax_total=Decimal(str(tax_total or 0)),
            refunds_total=refunds_total,
            net_sales=net_sales_decimal,
            cash_total=cash_total,
            cash_received_total=cash_received_total,
            change_given_total=change_given_total,
            non_cash_total=non_cash_total,
            avg_check=net_sales_decimal / orders_count if orders_count else Decimal("0"),
            payment_methods=payment_methods,
        )

    @staticmethod
    def _figures(
        orders_row,
        cancelled: int | None,
        payment_rows,
        refunds: Decimal | None,
        receipts: int,
    ) -> ZReportFigures:
        """Assemble one figure block from raw aggregate rows.

        `orders_row` is (count, subtotal, discount, service_fee, tax, total) over
        COMPLETED orders; `payment_rows` is an iterable of
        (method, count, amount, cash_received, change_given) over COMPLETED
        payments. Identical formulas to the whole-company z_report — one
        definition, no second formula family. `cancelled` / `refunds` are None
        when the dimension cannot attribute them.
        """
        count = orders_row[0] or 0
        net_sales = Decimal(str(orders_row[5] or 0))
        rows = list(payment_rows)
        return ZReportFigures(
            orders_count=count,
            cancelled_orders_count=cancelled,
            payments_count=sum(r[1] for r in rows),
            fiscal_receipts_count=receipts,
            gross_sales=Decimal(str(orders_row[1] or 0)),
            discounts_total=Decimal(str(orders_row[2] or 0)),
            service_fee_total=Decimal(str(orders_row[3] or 0)),
            tax_total=Decimal(str(orders_row[4] or 0)),
            refunds_total=refunds,
            net_sales=net_sales,
            cash_total=sum((Decimal(str(r[2] or 0)) for r in rows if r[0] == "cash"), Decimal("0")),
            cash_received_total=sum((Decimal(str(r[3] or 0)) for r in rows), Decimal("0")),
            change_given_total=sum((Decimal(str(r[4] or 0)) for r in rows), Decimal("0")),
            non_cash_total=sum((Decimal(str(r[2] or 0)) for r in rows if r[0] != "cash"), Decimal("0")),
            avg_check=net_sales / count if count else Decimal("0"),
            payment_methods=[
                PaymentMethodSummary(
                    method=r[0], count=r[1], amount=Decimal(str(r[2] or 0))
                )
                for r in rows
            ],
        )

    @staticmethod
    def _empty_orders_row() -> tuple[int, int, int, int, int, int]:
        return (0, 0, 0, 0, 0, 0)

    async def z_report_detail(
        self,
        company_id: UUID,
        dimension: str,
        ids: list[UUID],
        selected_date: date | None = None,
        *,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> ZReportDetailResponse:
        """Per-entity Z-report sections for ONE dimension over the SAME window
        contract as z_report: half-open [day_start, day_end), company timezone.

        Exactly five grouped aggregate queries plus one entity-metadata query,
        regardless of how many entities are selected — no per-entity and no
        per-day loop. Union totals are re-aggregated from the SAME grouped raw
        facts (sums of sums are exact); only avg_check is recomputed as a ratio,
        never averaged from per-entity averages.
        """
        tz = await self._company_tz(company_id)
        if date_from is not None and date_to is not None:
            day_start = self._date_bounds(date_from, tz)[0]
            day_end = self._date_bounds(date_to, tz)[1]
            response_date, response_from, response_to = date_to, date_from, date_to
        else:
            day_start, day_end = self._date_bounds(selected_date, tz)
            response_date, response_from, response_to = selected_date, None, None

        # Dedupe preserving first-requested order: the print follows picker order.
        unique_ids: list[UUID] = []
        for entity_id in ids:
            if entity_id not in unique_ids:
                unique_ids.append(entity_id)

        # All-or-nothing tenant validation BEFORE any aggregate runs. A foreign
        # id and a nonexistent id are indistinguishable (404) — no existence
        # leak. Deliberately deleted-agnostic: an archived Hall and a
        # deactivated User stay queryable by known id, because archiving must
        # not make completed business history unreachable.
        entity_model = Hall if dimension == "hall" else User
        await require_company_resource_ids(
            self.db, entity_model, unique_ids, company_id,
            detail="Hall not found" if dimension == "hall" else "User not found",
        )

        entities = await self._detail_entities(company_id, dimension, unique_ids)
        by_id = await self._detail_figures(
            company_id, dimension, unique_ids, day_start, day_end
        )
        unsupported = list(self._DETAIL_UNSUPPORTED[dimension])
        return ZReportDetailResponse(
            dimension=dimension,
            date=response_date,
            date_from=response_from,
            date_to=response_to,
            entities=[
                ZReportDetailEntity(
                    entity_id=entity_id,
                    entity_name=entities[entity_id][0],
                    entity_is_active=entities[entity_id][1],
                    entity_deleted=entities[entity_id][2],
                    figures=by_id[entity_id],
                )
                for entity_id in unique_ids
            ],
            totals=by_id["__union__"],
            unsupported_fields=unsupported,
            coverage=[
                ZReportCoverageNote(code=code, message=message)
                for code, message in self._DETAIL_COVERAGE[dimension]
            ],
        )

    async def _detail_entities(
        self, company_id: UUID, dimension: str, ids: list[UUID]
    ) -> dict[UUID, tuple[str, bool, bool]]:
        """id -> (display name, is_active, is_deleted). Live join: no historical
        name snapshot exists for User or Hall, so a rename retroactively renames
        past reports."""
        if not ids:
            return {}
        if dimension == "hall":
            rows = (await self.db.execute(
                select(Hall.id, Hall.name, Hall.is_active, Hall.deleted_at)
                .where(Hall.id.in_(ids), Hall.company_id == company_id)
            )).all()
            return {
                r.id: (r.name or "—", bool(r.is_active), r.deleted_at is not None)
                for r in rows
            }
        rows = (await self.db.execute(
            select(User.id, User.name, User.email, User.is_active)
            .where(User.id.in_(ids), User.company_id == company_id)
        )).all()
        # User has no deleted_at — deactivation (is_active False) is the only
        # removal state, so entity_deleted is always False for personnel.
        return {
            r.id: (r.name or r.email or "—", bool(r.is_active), False)
            for r in rows
        }

    def _cashier_closures(self, company_id: UUID, ids: list[UUID]):
        """DISTINCT (cashier, order) closures.

        An order is CLOSED BY a cashier iff a COMPLETED payment for it carries
        that cashier_id. DISTINCT guarantees one row per (cashier, order), so
        joining it to Orders can never multiply order totals even if a second
        completed payment somehow existed for the same order.
        """
        return (
            select(
                Payment.cashier_id.label("k"),
                Payment.order_id.label("order_id"),
            )
            .where(
                Payment.company_id == company_id,
                Payment.status == "completed",
                Payment.cashier_id.in_(ids),
            )
            .distinct()
            .subquery()
        )

    def _detail_order_source(
        self, company_id: UUID, dimension: str, ids: list[UUID]
    ):
        """(grouping key, FROM-chain applied to a completed-Order select)."""
        if dimension == "waiter":
            key = Order.waiter_id
            return key, (lambda q: q.where(key.in_(ids)))
        if dimension == "hall":
            key = Table.hall_id
            # PK join: one table per order, so order totals cannot multiply.
            return key, (
                lambda q: q.join(Table, Table.id == Order.table_id).where(key.in_(ids))
            )
        closures = self._cashier_closures(company_id, ids)
        key = closures.c.k
        return key, (lambda q: q.join(closures, closures.c.order_id == Order.id))

    def _detail_payment_source(
        self, company_id: UUID, dimension: str, ids: list[UUID]
    ):
        """(grouping key, FROM-chain applied to a Payment select).

        cashier: Payment.cashier_id directly — the payment's own attribution.
        waiter/hall: the payment's ORDER decides, so the figures mean "payments
        on this entity's orders", never "payments personally taken by".
        """
        if dimension == "cashier":
            key = Payment.cashier_id
            return key, (lambda q: q.where(key.in_(ids)))
        order_join = and_(
            Order.id == Payment.order_id,
            Order.company_id == Payment.company_id,
        )
        if dimension == "waiter":
            key = Order.waiter_id
            return key, (lambda q: q.join(Order, order_join).where(key.in_(ids)))
        key = Table.hall_id
        return key, (
            lambda q: q.join(Order, order_join)
            .join(Table, Table.id == Order.table_id)
            .where(key.in_(ids))
        )

    def _detail_receipt_source(
        self, company_id: UUID, dimension: str, ids: list[UUID]
    ):
        """(grouping key, FROM-chain applied to a FiscalReceipt select).

        payment_id is UNIQUE on fiscal_receipts and order_id is a plain FK, so
        every join below adds at most one row per receipt.
        """
        if dimension == "cashier":
            key = Payment.cashier_id
            return key, (
                lambda q: q.join(
                    Payment,
                    and_(
                        Payment.id == FiscalReceipt.payment_id,
                        Payment.company_id == FiscalReceipt.company_id,
                        Payment.status == "completed",
                    ),
                ).where(key.in_(ids))
            )
        order_join = and_(
            Order.id == FiscalReceipt.order_id,
            Order.company_id == FiscalReceipt.company_id,
        )
        if dimension == "waiter":
            key = Order.waiter_id
            return key, (lambda q: q.join(Order, order_join).where(key.in_(ids)))
        key = Table.hall_id
        return key, (
            lambda q: q.join(Order, order_join)
            .join(Table, Table.id == Order.table_id)
            .where(key.in_(ids))
        )

    async def _detail_figures(
        self,
        company_id: UUID,
        dimension: str,
        ids: list[UUID],
        day_start: datetime,
        day_end: datetime,
    ) -> dict:
        """Five grouped aggregates -> {entity_id: figures, "__union__": figures}.

        Query count is CONSTANT in the number of selected entities and in the
        length of the period: each aggregate runs once, grouped by the dimension
        key, over the single half-open window. Union totals re-aggregate the SAME
        grouped rows (sums of sums are exact) and recompute avg_check as a ratio
        of union facts — never an average of per-entity averages.
        """
        empty = self._empty_orders_row()
        if not ids:
            union = self._figures(empty, None if dimension == "cashier" else 0, [], None if dimension == "cashier" else Decimal("0"), 0)
            return {"__union__": union}

        order_key, order_from = self._detail_order_source(company_id, dimension, ids)
        order_rows = (await self.db.execute(
            order_from(
                select(
                    order_key.label("k"),
                    func.count(Order.id),
                    func.coalesce(func.sum(Order.subtotal), 0),
                    func.coalesce(func.sum(Order.discount_amount), 0),
                    func.coalesce(func.sum(Order.service_fee), 0),
                    func.coalesce(func.sum(Order.tax_amount), 0),
                    # FINAL order amount — already inclusive of service fee and
                    # tax; this is net_sales and the waiter-percentage base.
                    func.coalesce(func.sum(Order.total_amount), 0),
                ).where(
                    Order.company_id == company_id,
                    Order.status == "completed",
                    Order.created_at >= day_start,
                    Order.created_at < day_end,
                )
            ).group_by(order_key)
        )).all()

        cancelled_rows: list = []
        if dimension != "cashier":
            # Cancelled orders never carry a completed payment, so they are
            # UNSUPPORTED for cashier — reported as None, not 0.
            cancelled_key, cancelled_from = self._detail_order_source(company_id, dimension, ids)
            cancelled_rows = (await self.db.execute(
                cancelled_from(
                    select(cancelled_key.label("k"), func.count(Order.id)).where(
                        Order.company_id == company_id,
                        Order.status == "cancelled",
                        Order.created_at >= day_start,
                        Order.created_at < day_end,
                    )
                ).group_by(cancelled_key)
            )).all()

        pay_key, pay_from = self._detail_payment_source(company_id, dimension, ids)
        payment_rows = (await self.db.execute(
            pay_from(
                select(
                    pay_key.label("k"),
                    Payment.method,
                    func.count(Payment.id),
                    func.coalesce(func.sum(Payment.amount), 0),
                    func.coalesce(func.sum(Payment.cash_received), 0),
                    func.coalesce(func.sum(Payment.change_given), 0),
                ).where(
                    Payment.company_id == company_id,
                    Payment.status == "completed",
                    Payment.created_at >= day_start,
                    Payment.created_at < day_end,
                )
            ).group_by(pay_key, Payment.method).order_by(Payment.method)
        )).all()

        refund_rows: list = []
        if dimension != "cashier":
            # Refunds are set by gateway webhooks that never write cashier_id,
            # so the refunding cashier is unknowable — UNSUPPORTED, not 0.
            refund_key, refund_from = self._detail_payment_source(company_id, dimension, ids)
            refund_rows = (await self.db.execute(
                refund_from(
                    select(refund_key.label("k"), func.coalesce(func.sum(Payment.amount), 0)).where(
                        Payment.company_id == company_id,
                        Payment.status == "refunded",
                        Payment.created_at >= day_start,
                        Payment.created_at < day_end,
                    )
                ).group_by(refund_key)
            )).all()

        receipt_key, receipt_from = self._detail_receipt_source(company_id, dimension, ids)
        receipt_rows = (await self.db.execute(
            receipt_from(
                select(receipt_key.label("k"), func.count(FiscalReceipt.id)).where(
                    FiscalReceipt.company_id == company_id,
                    FiscalReceipt.status == "sent",
                    FiscalReceipt.created_at >= day_start,
                    FiscalReceipt.created_at < day_end,
                )
            ).group_by(receipt_key)
        )).all()

        orders_by = {r[0]: tuple(r[1:]) for r in order_rows}
        cancelled_by = {r[0]: r[1] for r in cancelled_rows}
        receipts_by = {r[0]: r[1] for r in receipt_rows}
        refunds_by = {r[0]: Decimal(str(r[1] or 0)) for r in refund_rows}
        payments_by: dict = {}
        for row in payment_rows:
            payments_by.setdefault(row[0], []).append(tuple(row[1:]))

        cashier = dimension == "cashier"
        result = {
            entity_id: self._figures(
                orders_by.get(entity_id, empty),
                None if cashier else cancelled_by.get(entity_id, 0),
                payments_by.get(entity_id, []),
                None if cashier else refunds_by.get(entity_id, Decimal("0")),
                receipts_by.get(entity_id, 0),
            )
            for entity_id in ids
        }

        # Union: exact re-aggregation of the same raw grouped facts.
        union_orders = (
            sum(r[0] or 0 for r in orders_by.values()),
            sum((Decimal(str(r[1] or 0)) for r in orders_by.values()), Decimal("0")),
            sum((Decimal(str(r[2] or 0)) for r in orders_by.values()), Decimal("0")),
            sum((Decimal(str(r[3] or 0)) for r in orders_by.values()), Decimal("0")),
            sum((Decimal(str(r[4] or 0)) for r in orders_by.values()), Decimal("0")),
            sum((Decimal(str(r[5] or 0)) for r in orders_by.values()), Decimal("0")),
        )
        union_methods: dict = {}
        for rows in payments_by.values():
            for method, cnt, amount, received, change in rows:
                agg = union_methods.setdefault(
                    method, [0, Decimal("0"), Decimal("0"), Decimal("0")]
                )
                agg[0] += cnt or 0
                agg[1] += Decimal(str(amount or 0))
                agg[2] += Decimal(str(received or 0))
                agg[3] += Decimal(str(change or 0))
        result["__union__"] = self._figures(
            union_orders,
            None if cashier else sum(cancelled_by.values()),
            [(m, a[0], a[1], a[2], a[3]) for m, a in sorted(union_methods.items())],
            None if cashier else sum(refunds_by.values(), Decimal("0")),
            sum(receipts_by.values()),
        )
        return result

    async def z_report_detail_filters(
        self, company_id: UUID
    ) -> ZReportDetailFiltersResponse:
        """Current selectable entities for the per-entity Print pickers.

        Deliberately NARROWER than the detail endpoint: active company staff
        holding the non-system role, and active non-deleted halls. A deactivated
        employee or an archived hall leaves this list but stays queryable by
        known id in z_report_detail — picker discoverability and historical
        report validity are separate policies.
        """
        staff_rows = (await self.db.execute(
            select(User.id, User.name, User.email, Role.slug)
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                Role.company_id == company_id,
                Role.slug.in_(["cashier", "waiter"]),
                Role.is_system.is_(False),
            )
            .order_by(func.coalesce(User.name, User.email), User.email, User.id)
        )).all()
        hall_rows = (await self.db.execute(
            select(Hall.id, Hall.name)
            .where(
                Hall.company_id == company_id,
                Hall.is_active.is_(True),
                Hall.deleted_at.is_(None),
            )
            .order_by(Hall.name, Hall.id)
        )).all()

        # A user may hold both roles; de-dupe per (slug, id) keeping first order.
        by_slug: dict[str, list[ZReportDetailOption]] = {"cashier": [], "waiter": []}
        seen: set[tuple[str, UUID]] = set()
        for row in staff_rows:
            marker = (row.slug, row.id)
            if marker in seen:
                continue
            seen.add(marker)
            by_slug[row.slug].append(
                ZReportDetailOption(value=row.id, label=row.name or row.email or "—")
            )
        return ZReportDetailFiltersResponse(
            cashiers=by_slug["cashier"],
            waiters=by_slug["waiter"],
            halls=[
                ZReportDetailOption(value=r.id, label=r.name or "—") for r in hall_rows
            ],
        )

    async def user_activity_ranking(
        self,
        company_id: UUID,
        limit: int = 20,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> list[UserActivityRank]:
        # Duration per session capped at 24 h to avoid stale open sessions skewing averages
        cap = func.least(
            func.coalesce(RefreshToken.revoked_at, func.now()),
            RefreshToken.created_at + timedelta(hours=24),
        )
        duration_secs = func.extract("epoch", cap - RefreshToken.created_at)

        query = (
            select(
                User.id,
                User.name,
                func.count(RefreshToken.id).label("sessions"),
                func.coalesce(func.avg(duration_secs), 0).label("avg_secs"),
                func.coalesce(func.sum(duration_secs), 0).label("total_secs"),
            )
            .join(RefreshToken, RefreshToken.user_id == User.id)
            .where(User.company_id == company_id)
            .group_by(User.id, User.name)
            .order_by(func.count(RefreshToken.id).desc())
            .limit(limit)
        )
        if date_from or date_to:
            tz = await self._company_tz(company_id)
        if date_from:
            query = query.where(
                RefreshToken.created_at >= self._date_bounds(date_from, tz)[0]
            )
        if date_to:
            query = query.where(
                RefreshToken.created_at < self._date_bounds(date_to, tz)[1]
            )

        result = await self.db.execute(query)
        return [
            UserActivityRank(
                rank=i + 1,
                user_id=row.id,
                user_name=row.name or "—",
                sessions=row.sessions,
                avg_session_seconds=int(row.avg_secs or 0),
                total_session_seconds=int(row.total_secs or 0),
            )
            for i, row in enumerate(result.all())
        ]

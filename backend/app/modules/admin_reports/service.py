from __future__ import annotations
import io
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Sequence, get_args
from uuid import UUID

from fastapi.responses import StreamingResponse
from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.modules.admin_reports.schemas import (
    AttendanceRow, CancelledAuthorOption, CancelledFiltersResponse, CancelledItemRow,
    DebtCreditRow,
    DishReportFiltersResponse, DishReportResponse, DishReportRow,
    DishReportTotals, LoginHistoryRow, OrderReportRow,
    OrderReportFiltersResponse, ReportFilterOption,
    ProductCountRow, ProductReportRow, TableOrderSummary, TableReportFiltersResponse,
    TableReportRow, WaiterDishRow, WaiterReportFiltersResponse,
    WaiterReportResponse, WaiterReportRow, WaiterReportTotals,
)
from app.modules.auth.models import RefreshToken, User
from app.modules.finance.models import Counterparty, FinTransaction, PaymentType
from app.modules.finance.ownership import (
    FinanceDictionaryService,
    FinanceScope,
    SCOPE_COMPANY,
    require_finance_reference,
)
from app.modules.hr.models import Employee, WorkShift
from app.modules.companies.models import Branch
from app.modules.halls.models import Hall, Table
from app.modules.inventory.models import Category, Product
from app.modules.payments.models import Payment
from app.modules.pos.models import Order, OrderItem
from app.modules.pos.schemas import OrderCreate, OrderStatusUpdate
from app.modules.rbac.models import Role, UserRole
from app.shared.pagination import PageParams
from app.shared.tenant_scope import require_company_resource


ORDER_TYPE_LABELS = {
    "dine_in": "На месте",
    "takeaway": "На вынос",
    "delivery": "Доставка",
    "qr": "QR",
}

ORDER_STATUS_LABELS = {
    "new": "Новый",
    "accepted": "Принят",
    "cooking": "Готовится",
    "ready": "Готов",
    "completed": "Завершён",
}

ORDER_TYPE_VALUES = get_args(OrderCreate.model_fields["order_type"].annotation)
ORDER_STATUS_VALUES = get_args(OrderStatusUpdate.model_fields["status"].annotation)


def xlsx_response(filename: str, headers: Sequence[str], rows: Iterable[Sequence]) -> StreamingResponse:
    """Генерация .xlsx (ТЗ §8, Excel-экспорт)."""
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(list(headers))
    for row in rows:
        ws.append([float(v) if isinstance(v, Decimal) else v for v in row])
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class AdminReportService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _validate_branch(
        self, company_id: UUID, branch_id: UUID | None
    ) -> None:
        if branch_id is not None:
            await require_company_resource(
                self.db,
                Branch,
                branch_id,
                company_id,
                detail="Branch not found",
            )

    async def products(
        self,
        company_id: UUID,
        date_from: date | None,
        date_to: date | None,
        branch_id: UUID | None = None,
    ) -> list[ProductReportRow]:
        """Completed company sales grouped by tenant-owned product identity."""
        await self._validate_branch(company_id, branch_id)
        quantity = func.sum(OrderItem.quantity)
        total_amount = func.sum(OrderItem.total)
        query = (
            select(
                Product.id,
                Product.name,
                quantity,
                total_amount,
                func.coalesce(Product.cost_price, 0),
            )
            .select_from(OrderItem)
            .join(
                Order,
                and_(
                    Order.id == OrderItem.order_id,
                    Order.company_id == company_id,
                ),
            )
            .join(
                Product,
                and_(
                    Product.id == OrderItem.product_id,
                    Product.company_id == company_id,
                ),
            )
            .join(
                Branch,
                and_(
                    Branch.id == Order.branch_id,
                    Branch.company_id == company_id,
                ),
            )
            .where(
                Order.company_id == company_id,
                Product.company_id == company_id,
                Branch.company_id == company_id,
                Order.status == "completed",
                OrderItem.status != "cancelled",
            )
            .group_by(Product.id, Product.name, Product.cost_price)
        )
        if branch_id is not None:
            query = query.where(Order.branch_id == branch_id)
        query = self._order_date_filter(query, date_from, date_to)
        sales = (await self.db.execute(query)).all()

        rows = []
        for product_id, name, qty, total, unit_cost in sales:
            qty = Decimal(qty or 0)
            total = Decimal(total or 0)
            unit_cost = Decimal(unit_cost or 0)
            cost = (unit_cost * qty).quantize(Decimal("0.01"))
            rows.append(ProductReportRow(
                product_id=product_id,
                product_name=name,
                qty=qty,
                avg_price=(total / qty).quantize(Decimal("0.01")) if qty else Decimal(0),
                total=total.quantize(Decimal("0.01")),
                cost=cost,
                profit=(total - cost).quantize(Decimal("0.01")),
            ))
        return rows

    async def products_count(
        self,
        company_id: UUID,
        date_from: date | None,
        date_to: date | None,
        branch_id: UUID | None = None,
    ) -> list[ProductCountRow]:
        """Known product outflow from completed sales in the company schema."""
        await self._validate_branch(company_id, branch_id)
        expense = func.sum(OrderItem.quantity)
        query = (
            select(Product.id, Product.name, expense)
            .select_from(OrderItem)
            .join(
                Order,
                and_(
                    Order.id == OrderItem.order_id,
                    Order.company_id == company_id,
                ),
            )
            .join(
                Product,
                and_(
                    Product.id == OrderItem.product_id,
                    Product.company_id == company_id,
                ),
            )
            .join(
                Branch,
                and_(
                    Branch.id == Order.branch_id,
                    Branch.company_id == company_id,
                ),
            )
            .where(
                Order.company_id == company_id,
                Product.company_id == company_id,
                Branch.company_id == company_id,
                Order.status == "completed",
                OrderItem.status != "cancelled",
            )
            .group_by(Product.id, Product.name)
        )
        if branch_id is not None:
            query = query.where(Order.branch_id == branch_id)
        query = self._order_date_filter(query, date_from, date_to)
        rows = (await self.db.execute(query)).all()
        result = []
        for product_id, product_name, expense_qty in rows:
            expense_qty = Decimal(expense_qty or 0)
            result.append(
                ProductCountRow(
                    product_id=product_id,
                    product_name=product_name,
                    income_qty=Decimal("0"),
                    expense_qty=expense_qty,
                    balance_qty=-expense_qty,
                )
            )
        return result

    async def debt_credit(
        self,
        company_id: UUID,
        date_from: date | None,
        date_to: date | None,
        counterparty_id: UUID | None = None,
    ) -> list[DebtCreditRow]:
        """Дебет/кредит по контрагентам: остатки и обороты за период (ТЗ §6)."""
        scope = FinanceScope("company", company_id)
        await require_finance_reference(
            self.db,
            Counterparty,
            counterparty_id,
            scope,
            allow_system=False,
            detail="Counterparty not found",
        )
        signed = case(
            (FinTransaction.direction == "income", FinTransaction.amount),
            else_=-FinTransaction.amount,
        )
        opening = func.sum(case(
            (func.date(FinTransaction.date) < (date_from or date.min), signed), else_=0
        ))
        in_period = func.date(FinTransaction.date) >= (date_from or date.min)
        if date_to:
            in_period = in_period & (func.date(FinTransaction.date) <= date_to)
        debit = func.sum(case(
            (in_period & (FinTransaction.direction == "income"), FinTransaction.amount), else_=0
        ))
        credit = func.sum(case(
            (in_period & (FinTransaction.direction == "expense"), FinTransaction.amount), else_=0
        ))

        query = (
            select(FinTransaction.counterparty_id, Counterparty.full_name, opening, debit, credit)
            .join(
                Counterparty,
                and_(
                    Counterparty.id == FinTransaction.counterparty_id,
                    Counterparty.scope_kind == "company",
                    Counterparty.company_id == company_id,
                    Counterparty.organization_id.is_(None),
                    Counterparty.deleted_at.is_(None),
                ),
            )
            .where(
                FinTransaction.deleted_at.is_(None),
                FinTransaction.counterparty_id.is_not(None),
                FinTransaction.company_id == company_id,
                FinTransaction.organization_id.is_(None),
                Counterparty.scope_kind == "company",
                Counterparty.company_id == company_id,
            )
            .group_by(FinTransaction.counterparty_id, Counterparty.full_name)
        )
        if counterparty_id is not None:
            query = query.where(FinTransaction.counterparty_id == counterparty_id)
        if date_to:
            query = query.where(func.date(FinTransaction.date) <= date_to)
        rows = (await self.db.execute(query)).all()
        return [
            DebtCreditRow(
                counterparty_id=r[0], counterparty_name=r[1],
                opening_balance=r[2] or 0, debit=r[3] or 0, credit=r[4] or 0,
                closing_balance=(r[2] or 0) + (r[3] or 0) - (r[4] or 0),
            )
            for r in rows
        ]

    def _order_date_filter(self, query, date_from: date | None, date_to: date | None):
        if date_from:
            query = query.where(Order.created_at >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            query = query.where(Order.created_at <= datetime.combine(date_to, datetime.max.time()))
        return query

    async def orders_report(
        self,
        company_id: UUID,
        date_from: date | None,
        date_to: date | None,
        *,
        order_number: str | None = None,
        waiter_id: Sequence[UUID] | None = None,
        cashier_id: Sequence[UUID] | None = None,
        product_id: Sequence[UUID] | None = None,
        order_type: Sequence[str] | None = None,
        order_status: Sequence[str] | None = None,
        payment_method: Sequence[str] | None = None,
    ) -> list[OrderReportRow]:
        items_count = (
            select(func.count(OrderItem.id))
            .where(OrderItem.order_id == Order.id)
            .correlate(Order)
            .scalar_subquery()
        )
        query = (
            select(
                Order.id, Order.order_number, Order.created_at,
                Order.status, Order.table_number,
                User.name.label("waiter_name"),
                items_count.label("items_count"),
                Order.total_amount,
            )
            .outerjoin(
                User,
                and_(User.id == Order.waiter_id, User.company_id == company_id),
            )
            .where(Order.company_id == company_id, Order.status.notin_(["cancelled"]))
            .order_by(Order.created_at.desc())
        )
        if order_number and (normalized_order_number := order_number.strip()):
            query = query.where(Order.order_number.ilike(f"%{normalized_order_number}%"))
        if waiter_id:
            # REPORT-04 multi-value: the order's waiter must be one of the selected
            # ones. The role guard is ROW-CORRELATED — it is evaluated against the
            # order's OWN Order.waiter_id rather than against each selected id, so no
            # selected id is silently dropped: an id that no longer holds this
            # company's non-system `waiter` role simply matches no order.
            waiter_has_company_role = exists(
                select(UserRole.id)
                .join(Role, Role.id == UserRole.role_id)
                .where(
                    UserRole.user_id == Order.waiter_id,
                    Role.company_id == company_id,
                    Role.slug == "waiter",
                    Role.is_system.is_(False),
                )
            )
            query = query.where(
                Order.waiter_id.in_(list(waiter_id)),
                waiter_has_company_role,
            )
        if cashier_id:
            # Accounting attribution is UNCHANGED: the order must carry a payment
            # taken by one of the selected cashiers. The role guard is correlated to
            # that payment's own Payment.cashier_id — the ACTUALLY attributed cashier
            # — so the guard follows the attribution instead of the selection.
            attributed_cashier_has_role = exists(
                select(UserRole.id)
                .join(Role, Role.id == UserRole.role_id)
                .where(
                    UserRole.user_id == Payment.cashier_id,
                    Role.company_id == company_id,
                    Role.slug == "cashier",
                    Role.is_system.is_(False),
                )
            )
            query = query.where(
                exists(
                    select(Payment.id).where(
                        Payment.company_id == company_id,
                        Payment.order_id == Order.id,
                        Payment.cashier_id.in_(list(cashier_id)),
                        attributed_cashier_has_role,
                    )
                ),
            )
        if product_id:
            # Unchanged semantic, widened: the order CONTAINS at least one of the
            # selected dishes.
            query = query.where(
                exists(
                    select(OrderItem.id)
                    .join(Product, Product.id == OrderItem.product_id)
                    .where(
                        OrderItem.order_id == Order.id,
                        OrderItem.product_id.in_(list(product_id)),
                        Product.company_id == company_id,
                    )
                )
            )
        if order_type:
            query = query.where(Order.order_type.in_(list(order_type)))
        if order_status:
            query = query.where(Order.status.in_(list(order_status)))
        if payment_method:
            # Unchanged semantic, widened: the order has a payment whose method is one
            # of the selected ones.
            query = query.where(
                exists(
                    select(Payment.id).where(
                        Payment.company_id == company_id,
                        Payment.order_id == Order.id,
                        Payment.method.in_(list(payment_method)),
                    )
                )
            )
        query = self._order_date_filter(query, date_from, date_to)
        rows = (await self.db.execute(query)).all()
        return [
            OrderReportRow(
                order_id=r.id, order_number=r.order_number,
                created_at=r.created_at, status=r.status,
                table_number=r.table_number, waiter_name=r.waiter_name,
                items_count=r.items_count, total_amount=Decimal(str(r.total_amount or 0)),
            )
            for r in rows
        ]

    async def tables_report(
        self,
        company_id: UUID,
        date_from: date | None,
        date_to: date | None,
        *,
        table_number: str | None = None,
        waiter_id: Sequence[UUID] | None = None,
        payment_method: Sequence[str] | None = None,
        cashier_id: Sequence[UUID] | None = None,
        hall_id: Sequence[UUID] | None = None,
    ) -> list[TableReportRow]:
        # Row identity is the canonical Table when the order carries one, else the
        # legacy free-text number. Grouping by (table_id, table_number) keeps those
        # two identity classes distinct — so Table #5 in "Зал" and Table #5 in "Бар"
        # never collapse into one row, and a legacy NULL-table_id "5" stays separate
        # from a canonical Table #5. Hall is joined only for display/predicate; both
        # joins are on primary keys, so they never multiply orders/revenue.
        #
        # The lightweight per-row order summaries below reuse EXACTLY these
        # predicates, so Date/Sum lines can never disagree with the aggregate.
        conditions = [
            Order.company_id == company_id,
            Order.status == "completed",
            Order.table_number.is_not(None),
        ]
        if hall_id:
            # Tenant-safe: 404 (not a leak) if any hall isn't this company's. Hall has
            # a direct company_id, so the shared resolver applies. Filtering on the
            # canonical Table.hall_id (never table_number) also excludes legacy
            # NULL-table_id orders, which cannot truthfully belong to any hall.
            #
            # Phase 5C-6D, DELIBERATE: this resolver is deleted-agnostic — a
            # DELETED hall (deleted_at set) stays explicitly queryable here by
            # its canonical id. Marjon is POS/accounting software, so archiving
            # a place must not make its completed business history unreachable.
            # The hall is still hidden everywhere it could be PICKED (Settings,
            # POS, and the /reports/tables/filters place directory), so this is
            # an explicit by-id historical read, never a resurrection and never
            # a cross-tenant hole.
            for single_hall_id in hall_id:
                await require_company_resource(
                    self.db, Hall, single_hall_id, company_id, detail="Hall not found"
                )
            conditions.append(Table.hall_id.in_(list(hall_id)))
        if table_number and (normalized_table_number := table_number.strip()):
            conditions.append(Order.table_number.ilike(f"%{normalized_table_number}%"))
        if waiter_id:
            # REPORT-04 multi-value: the order's waiter must be one of the
            # selected ones. The role guard is ROW-CORRELATED — evaluated
            # against the order's OWN Order.waiter_id, so no selected id is
            # silently dropped: a foreign/ineligible/inactive id simply matches
            # nothing. Same rule as the old scalar eligibility, widened to lists.
            waiter_has_company_role = exists(
                select(UserRole.id)
                .join(Role, Role.id == UserRole.role_id)
                .join(User, User.id == UserRole.user_id)
                .where(
                    UserRole.user_id == Order.waiter_id,
                    User.company_id == company_id,
                    User.is_active.is_(True),
                    Role.company_id == company_id,
                    Role.slug == "waiter",
                    Role.is_system.is_(False),
                )
            )
            conditions.append(Order.waiter_id.in_(list(waiter_id)))
            conditions.append(waiter_has_company_role)
        if payment_method:
            # Completed-payment truth: pending/failed/refunded payments must not
            # qualify a table (dishes_report parity). Multiple methods OR.
            conditions.append(
                exists(
                    select(Payment.id).where(
                        Payment.company_id == company_id,
                        Payment.order_id == Order.id,
                        Payment.method.in_(list(payment_method)),
                        Payment.status == "completed",
                    )
                )
            )
        if cashier_id:
            # Attribution is UNCHANGED: the order must carry a COMPLETED payment
            # taken by one of the selected cashiers. The role guard is correlated
            # to that payment's own Payment.cashier_id — the ACTUALLY attributed
            # cashier — so the guard follows the attribution, never the selection.
            attributed_cashier_has_role = exists(
                select(UserRole.id)
                .join(Role, Role.id == UserRole.role_id)
                .join(User, User.id == UserRole.user_id)
                .where(
                    UserRole.user_id == Payment.cashier_id,
                    User.company_id == company_id,
                    User.is_active.is_(True),
                    Role.company_id == company_id,
                    Role.slug == "cashier",
                    Role.is_system.is_(False),
                )
            )
            conditions.append(
                exists(
                    select(Payment.id).where(
                        Payment.company_id == company_id,
                        Payment.order_id == Order.id,
                        Payment.cashier_id.in_(list(cashier_id)),
                        Payment.status == "completed",
                        attributed_cashier_has_role,
                    )
                ),
            )
        query = (
            select(
                Order.table_id,
                Order.table_number,
                Table.hall_id.label("hall_id"),
                Hall.name.label("hall_name"),
                func.count(Order.id).label("cnt"),
                func.coalesce(func.sum(Order.total_amount), 0).label("rev"),
            )
            .outerjoin(Table, Table.id == Order.table_id)
            .outerjoin(Hall, Hall.id == Table.hall_id)
            .where(*conditions)
            .group_by(Order.table_id, Order.table_number, Table.hall_id, Hall.name)
            .order_by(func.sum(Order.total_amount).desc())
        )
        query = self._order_date_filter(query, date_from, date_to)
        rows = (await self.db.execute(query)).all()
        # One extra query (never N+1): the same population at order grain for
        # the Date/Sum lines, deterministic created_at ascending (+ id tiebreak
        # for identical timestamps) so lines stay aligned 1:1.
        order_rows = (
            select(
                Order.id,
                Order.order_number,
                Order.created_at,
                Order.total_amount,
                Order.table_id,
                Order.table_number,
                Order.order_type,
                Order.status,
                func.coalesce(User.name, User.email).label("waiter_name"),
            )
            .outerjoin(Table, Table.id == Order.table_id)
            .outerjoin(User, User.id == Order.waiter_id)
            .where(*conditions)
            .order_by(Order.created_at.asc(), Order.id.asc())
        )
        order_rows = self._order_date_filter(order_rows, date_from, date_to)
        summaries: dict[tuple, list[TableOrderSummary]] = {}
        for o in (await self.db.execute(order_rows)).all():
            summaries.setdefault((o.table_id, o.table_number), []).append(
                TableOrderSummary(
                    order_id=o.id,
                    order_number=o.order_number,
                    created_at=o.created_at,
                    total_amount=Decimal(str(o.total_amount or 0)),
                    order_type=o.order_type,
                    status=o.status,
                    waiter_name=o.waiter_name,
                )
            )
        return [
            TableReportRow(
                table_number=r.table_number, orders_count=r.cnt,
                revenue=Decimal(str(r.rev)),
                avg_check=Decimal(str(r.rev)) / r.cnt if r.cnt else Decimal("0"),
                table_id=r.table_id, hall_id=r.hall_id, hall_name=r.hall_name,
                orders=summaries.get((r.table_id, r.table_number), []),
            )
            for r in rows
        ]

    async def tables_report_filters(self, company_id: UUID) -> TableReportFiltersResponse:
        staff_rows = (await self.db.execute(
            select(User.id, User.name, User.email, Role.slug)
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                Role.company_id == company_id,
                Role.slug.in_(["waiter", "cashier"]),
                Role.is_system.is_(False),
            )
            .order_by(Role.slug, func.coalesce(User.name, User.email), User.email, User.id)
        )).all()
        payment_method_rows, _ = await FinanceDictionaryService(
            PaymentType,
            self.db,
            system_enabled=True,
        ).list(
            FinanceScope(SCOPE_COMPANY, company_id),
            PageParams(page=1, size=1_000_000),
            raw_filters={"status": True},
            default_sort="sort,name,id",
        )

        staff_options = {"waiter": [], "cashier": []}
        seen_staff = {"waiter": set(), "cashier": set()}
        for row in staff_rows:
            if row.id in seen_staff[row.slug]:
                continue
            seen_staff[row.slug].add(row.id)
            staff_options[row.slug].append(
                ReportFilterOption(value=str(row.id), label=row.name or row.email)
            )

        payment_methods = []
        seen_payment_methods = set()
        for row in payment_method_rows:
            value = (row.type or "").strip()
            if not value or value in seen_payment_methods:
                continue
            seen_payment_methods.add(value)
            payment_methods.append(ReportFilterOption(value=value, label=row.name))

        # Places = the current company's active Hall directory (not derived from
        # order history), so an active hall with zero orders still appears and a
        # soft-deleted hall never does. Tenant-scoped by company_id.
        place_rows = (await self.db.execute(
            select(Hall.id, Hall.name)
            .where(
                Hall.company_id == company_id,
                Hall.is_active.is_(True),
                # Phase 5C-6D: a DELETED hall is never offered as a SELECTABLE
                # filter option. Its historical rows remain queryable by explicit
                # hall_id (see tables_report) — hidden from the picker, not from
                # the books.
                Hall.deleted_at.is_(None),
            )
            .order_by(Hall.name, Hall.id)
        )).all()
        places = [
            ReportFilterOption(value=str(row.id), label=row.name) for row in place_rows
        ]

        return TableReportFiltersResponse(
            waiters=staff_options["waiter"],
            cashiers=staff_options["cashier"],
            payment_methods=payment_methods,
            places=places,
            place_filter_supported=True,
        )

    async def waiters_report(
        self,
        company_id: UUID,
        date_from: date | None,
        date_to: date | None,
        *,
        waiter_id: UUID | None = None,
        service_percent: Decimal = Decimal("1"),
        include_orders: bool = True,
        include_takeaway_delivery: bool = False,
        include_service: bool = False,
    ) -> WaiterReportResponse:
        non_service_total = Order.total_amount - Order.service_fee
        ordinary_total = func.coalesce(func.sum(case(
            (Order.order_type.notin_(["takeaway", "delivery"]), non_service_total),
            else_=Decimal("0"),
        )), 0).label("orders_total")
        takeaway_delivery_total = func.coalesce(func.sum(case(
            (Order.order_type.in_(["takeaway", "delivery"]), non_service_total),
            else_=Decimal("0"),
        )), 0).label("takeaway_delivery_total")
        eligible_waiter = exists(
            select(UserRole.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                UserRole.user_id == Order.waiter_id,
                Role.company_id == company_id,
                Role.slug == "waiter",
                Role.is_system.is_(False),
            )
        )
        query = (
            select(
                Order.waiter_id,
                func.coalesce(User.name, User.email).label("waiter_name"),
                func.count(Order.id).label("orders_count"),
                ordinary_total,
                takeaway_delivery_total,
                func.coalesce(func.sum(Order.service_fee), 0).label("service_total"),
            )
            .join(User, and_(
                User.id == Order.waiter_id,
                User.company_id == company_id,
                User.is_active.is_(True),
            ))
            .where(
                Order.company_id == company_id,
                Order.status == "completed",
                eligible_waiter,
            )
            .group_by(Order.waiter_id, User.name, User.email)
            .order_by(func.sum(Order.total_amount).desc())
        )
        if waiter_id is not None:
            query = query.where(Order.waiter_id == waiter_id)
        query = self._order_date_filter(query, date_from, date_to)
        aggregate_rows = (await self.db.execute(query)).all()

        dishes_by_waiter: dict[UUID, list[WaiterDishRow]] = {}
        if aggregate_rows:
            dish_query = (
                select(
                    Order.waiter_id,
                    OrderItem.product_id,
                    OrderItem.name,
                    func.sum(OrderItem.quantity).label("quantity"),
                    func.sum(OrderItem.total).label("amount"),
                )
                .join(Order, Order.id == OrderItem.order_id)
                .join(User, and_(
                    User.id == Order.waiter_id,
                    User.company_id == company_id,
                    User.is_active.is_(True),
                ))
                .where(
                    Order.company_id == company_id,
                    Order.status == "completed",
                    OrderItem.status != "cancelled",
                    eligible_waiter,
                )
                .group_by(Order.waiter_id, OrderItem.product_id, OrderItem.name)
                .order_by(Order.waiter_id, func.sum(OrderItem.total).desc(), OrderItem.name)
            )
            if waiter_id is not None:
                dish_query = dish_query.where(Order.waiter_id == waiter_id)
            dish_query = self._order_date_filter(dish_query, date_from, date_to)
            for dish in (await self.db.execute(dish_query)).all():
                dishes_by_waiter.setdefault(dish.waiter_id, []).append(WaiterDishRow(
                    product_id=dish.product_id,
                    name=dish.name,
                    quantity=Decimal(str(dish.quantity or 0)),
                    amount=Decimal(str(dish.amount or 0)),
                ))

        def money(value: Decimal) -> Decimal:
            return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        rows: list[WaiterReportRow] = []
        for aggregate in aggregate_rows:
            orders_total = Decimal(str(aggregate.orders_total or 0))
            takeaway_total = Decimal(str(aggregate.takeaway_delivery_total or 0))
            service_total = Decimal(str(aggregate.service_total or 0))
            service_base = (
                (orders_total if include_orders else Decimal("0"))
                + (takeaway_total if include_takeaway_delivery else Decimal("0"))
                + (service_total if include_service else Decimal("0"))
            )
            dishes = dishes_by_waiter.get(aggregate.waiter_id, [])
            rows.append(WaiterReportRow(
                waiter_id=aggregate.waiter_id,
                name=aggregate.waiter_name,
                orders_count=aggregate.orders_count,
                orders_total=money(orders_total),
                takeaway_delivery_total=money(takeaway_total),
                service_total=money(service_total),
                waiter_service_total=money(service_base * service_percent / Decimal("100")),
                dishes_count=sum((dish.quantity for dish in dishes), Decimal("0")),
                dishes=dishes,
            ))

        return WaiterReportResponse(
            rows=rows,
            totals=WaiterReportTotals(
                orders_count=sum(row.orders_count for row in rows),
                orders_total=money(sum((row.orders_total for row in rows), Decimal("0"))),
                takeaway_delivery_total=money(sum((row.takeaway_delivery_total for row in rows), Decimal("0"))),
                service_total=money(sum((row.service_total for row in rows), Decimal("0"))),
                waiter_service_total=money(sum((row.waiter_service_total for row in rows), Decimal("0"))),
                dishes_count=sum((row.dishes_count for row in rows), Decimal("0")),
            ),
        )

    async def waiters_report_filters(self, company_id: UUID) -> WaiterReportFiltersResponse:
        rows = (await self.db.execute(
            select(User.id, User.name, User.email)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                exists(
                    select(UserRole.id)
                    .join(Role, Role.id == UserRole.role_id)
                    .where(
                        UserRole.user_id == User.id,
                        Role.company_id == company_id,
                        Role.slug == "waiter",
                        Role.is_system.is_(False),
                    )
                ),
            )
            .order_by(func.coalesce(User.name, User.email), User.email, User.id)
        )).all()
        return WaiterReportFiltersResponse(waiters=[
            ReportFilterOption(value=str(row.id), label=row.name or row.email)
            for row in rows
        ])

    async def dishes_report(
        self,
        company_id: UUID,
        date_from: date | None,
        date_to: date | None,
        *,
        search: str | None = None,
        author_id: Sequence[UUID] | None = None,
        product_id: Sequence[UUID] | None = None,
        order_type: Sequence[str] | None = None,
        order_status: Sequence[str] | None = None,
        category_id: Sequence[UUID] | None = None,
        payment_method: Sequence[str] | None = None,
    ) -> DishReportResponse:
        report_query = (
            select(
                OrderItem.product_id,
                OrderItem.name,
                Product.unit,
                func.sum(OrderItem.quantity).label("qty"),
                func.sum(OrderItem.total).label("total"),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .join(Product, Product.id == OrderItem.product_id)
            .where(Order.company_id == company_id, Product.company_id == company_id)
            .group_by(OrderItem.product_id, OrderItem.name, Product.unit)
            .order_by(func.sum(OrderItem.total).desc())
        )
        if order_status:
            report_query = report_query.where(Order.status.in_(list(order_status)))
        else:
            report_query = report_query.where(Order.status.notin_(["cancelled"]))
        if search and search.strip():
            report_query = report_query.where(OrderItem.name.ilike(f"%{search.strip()}%"))
        if author_id:
            # Multi-value widening of the scalar predicate: Order.waiter_id IN
            # selected ids (OR within the dimension). No role guard here — the
            # author options already offer only active same-company
            # waiter/cashier users, and the company predicate below keeps every
            # foreign id from matching anything.
            report_query = report_query.where(Order.waiter_id.in_(list(author_id)))
        if product_id:
            report_query = report_query.where(OrderItem.product_id.in_(list(product_id)))
        if order_type:
            report_query = report_query.where(Order.order_type.in_(list(order_type)))
        if category_id:
            # Primary and subcategory are both canonical category relations.
            category_ids = list(category_id)
            report_query = report_query.where(or_(
                Product.category_id.in_(category_ids),
                Product.subcategory_id.in_(category_ids),
            ))
        if payment_method:
            report_query = report_query.where(exists(
                select(Payment.id).where(
                    Payment.order_id == Order.id,
                    Payment.company_id == company_id,
                    Payment.method.in_(list(payment_method)),
                    Payment.status == "completed",
                )
            ))
        report_query = self._order_date_filter(report_query, date_from, date_to)
        rows = (await self.db.execute(report_query)).all()
        # Monetary convention matches products(): Decimal arithmetic with
        # ROUND_HALF_UP to 0.01. Weighted price preserves
        # amount == quantity * price per row (AVG(price) would break it when
        # sale prices vary within a group).
        total_quantity = Decimal("0")
        total_amount = Decimal("0")
        report_rows = []
        for r in rows:
            qty = Decimal(str(r.qty or 0))
            amount = Decimal(str(r.total or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            price = (
                (amount / qty).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if qty else Decimal("0")
            )
            total_quantity += qty
            total_amount += amount
            report_rows.append(DishReportRow(
                product_id=r.product_id, name=r.name, unit=r.unit,
                quantity=qty, price=price, amount=amount,
            ))
        return DishReportResponse(
            rows=report_rows,
            totals=DishReportTotals(
                quantity=total_quantity,
                amount=total_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            ),
        )

    async def orders_report_filters(self, company_id: UUID) -> OrderReportFiltersResponse:
        staff_rows = (await self.db.execute(
            select(User.id, User.name, User.email, Role.slug)
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                Role.company_id == company_id,
                Role.slug.in_(["waiter", "cashier"]),
                Role.is_system.is_(False),
            )
            .order_by(Role.slug, func.coalesce(User.name, User.email), User.email, User.id)
        )).all()
        product_rows = (await self.db.execute(
            select(Product.id, Product.name)
            .where(
                Product.company_id == company_id,
                Product.is_active.is_(True),
                Product.is_available.is_(True),
            )
            .order_by(Product.name, Product.id)
        )).all()
        payment_method_rows, _ = await FinanceDictionaryService(
            PaymentType,
            self.db,
            system_enabled=True,
        ).list(
            FinanceScope(SCOPE_COMPANY, company_id),
            PageParams(page=1, size=1_000_000),
            raw_filters={"status": True},
            default_sort="sort,name,id",
        )

        staff_options = {"waiter": [], "cashier": []}
        seen_staff = {"waiter": set(), "cashier": set()}
        for row in staff_rows:
            if row.id in seen_staff[row.slug]:
                continue
            seen_staff[row.slug].add(row.id)
            staff_options[row.slug].append(
                ReportFilterOption(value=str(row.id), label=row.name or row.email)
            )

        payment_methods = []
        seen_payment_methods = set()
        for row in payment_method_rows:
            value = (row.type or "").strip()
            if not value or value in seen_payment_methods:
                continue
            seen_payment_methods.add(value)
            payment_methods.append(ReportFilterOption(value=value, label=row.name))

        return OrderReportFiltersResponse(
            waiters=staff_options["waiter"],
            cashiers=staff_options["cashier"],
            products=[
                ReportFilterOption(value=str(row.id), label=row.name)
                for row in product_rows
            ],
            order_types=[
                ReportFilterOption(value=value, label=ORDER_TYPE_LABELS.get(value, value))
                for value in ORDER_TYPE_VALUES
            ],
            order_statuses=[
                ReportFilterOption(value=value, label=ORDER_STATUS_LABELS.get(value, value))
                for value in ORDER_STATUS_VALUES if value != "cancelled"
            ],
            payment_methods=payment_methods,
        )

    async def dishes_report_filters(self, company_id: UUID) -> DishReportFiltersResponse:
        # Product rule: available authors are active same-company employees with
        # a waiter OR cashier role (no order history required). The report
        # predicate itself stays Order.waiter_id == author_id — Payment.cashier_id
        # is a separate axis and is NOT merged here.
        author_rows = (await self.db.execute(
            select(User.id, User.name, User.email)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                exists(
                    select(UserRole.id)
                    .join(Role, Role.id == UserRole.role_id)
                    .where(
                        UserRole.user_id == User.id,
                        Role.company_id == company_id,
                        Role.slug.in_(["waiter", "cashier"]),
                        Role.is_system.is_(False),
                    )
                ),
            )
            .order_by(func.coalesce(User.name, User.email), User.email, User.id)
        )).all()
        product_rows = (await self.db.execute(
            select(Product.id, Product.name)
            .where(
                Product.company_id == company_id,
                Product.is_active.is_(True),
                Product.is_available.is_(True),
            )
            .order_by(Product.name, Product.id)
        )).all()
        category_rows = (await self.db.execute(
            select(Category.id, Category.name)
            .where(Category.company_id == company_id, Category.is_active.is_(True))
            .order_by(Category.name, Category.id)
        )).all()
        payment_method_rows, _ = await FinanceDictionaryService(
            PaymentType,
            self.db,
            system_enabled=True,
        ).list(
            FinanceScope(SCOPE_COMPANY, company_id),
            PageParams(page=1, size=1_000_000),
            raw_filters={"status": True},
            default_sort="sort,name,id",
        )
        payment_methods = []
        seen_payment_methods = set()
        for row in payment_method_rows:
            value = (row.type or "").strip()
            if not value or value in seen_payment_methods:
                continue
            seen_payment_methods.add(value)
            payment_methods.append(ReportFilterOption(value=value, label=row.name))

        return DishReportFiltersResponse(
            authors=[
                ReportFilterOption(value=str(row.id), label=row.name or row.email)
                for row in author_rows
            ],
            cooks=[],
            products=[ReportFilterOption(value=str(row.id), label=row.name) for row in product_rows],
            categories=[ReportFilterOption(value=str(row.id), label=row.name) for row in category_rows],
            order_types=[
                ReportFilterOption(value=value, label=ORDER_TYPE_LABELS.get(value, value))
                for value in ORDER_TYPE_VALUES
            ],
            order_statuses=[
                ReportFilterOption(value=value, label=ORDER_STATUS_LABELS.get(value, value))
                for value in ORDER_STATUS_VALUES if value != "cancelled"
            ],
            payment_methods=payment_methods,
            cook_filter_supported=False,
        )

    @staticmethod
    def _cancelled_line_amount(
        price: Decimal | float | int | None,
        quantity: Decimal | float | int | None,
        discount: Decimal | float | int | None,
    ) -> Decimal:
        """Truthful historical line amount BEFORE cancellation zeroing.

        Canonical POS formula (pos/service.py create/add_item): the stored
        ``total`` was ``quantize(price * quantity) - quantize(discount)``
        floored at zero. One POS cancellation path zeroes ``item.total``, so
        the report must recompute from the preserved snapshots instead of
        reading ``total``. Never uses Payment.amount or current Product.price.
        """
        p = Decimal(str(price or 0))
        q = Decimal(str(quantity or 0))
        d = Decimal(str(discount or 0))
        gross = (p * q).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        disc = d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return max(gross - disc, Decimal("0"))

    async def cancelled_items(
        self,
        company_id: UUID,
        date_from: date | None,
        date_to: date | None,
        *,
        order_number: str | None = None,
        author_id: Sequence[UUID] | None = None,
        dish_name: Sequence[str] | None = None,
    ) -> list[CancelledItemRow]:
        """Cancelled Dishes truth foundation (Phase 1A).

        Inclusion: OrderItem.status == 'cancelled' OR Order.status ==
        'cancelled' (item-level cancellations on live orders are included;
        items of whole-cancelled orders are included; no duplicate row when
        both are true — one row per OrderItem).

        Scope: 'item' when the item itself is cancelled (wins when both are
        cancelled), else 'order'. Event timestamp/author inherit from the
        scope owner. Historical NULL timestamps use legacy fallback
        report_event_at = COALESCE(effective cancelled_at, Order.created_at)
        with date_source marking the fallback. Period filter applies to
        report_event_at so legacy rows stay visible.
        """
        WaiterUser = aliased(User)
        ItemAuthor = aliased(User)
        OrderAuthor = aliased(User)

        effective_cancelled = case(
            (OrderItem.status == "cancelled", OrderItem.cancelled_at),
            else_=Order.cancelled_at,
        )
        report_event = func.coalesce(effective_cancelled, Order.created_at)

        query = (
            select(
                Order.id.label("order_id"),
                Order.order_number,
                Order.table_number,
                Order.order_type,
                Order.status.label("order_status"),
                Order.created_at.label("order_created_at"),
                Order.cancelled_at.label("order_cancelled_at"),
                Order.cancelled_by_id.label("order_cancelled_by_id"),
                OrderItem.id.label("order_item_id"),
                OrderItem.name,
                OrderItem.quantity,
                OrderItem.price,
                OrderItem.discount,
                OrderItem.status.label("item_status"),
                OrderItem.cancelled_at.label("item_cancelled_at"),
                OrderItem.cancelled_by_id.label("item_cancelled_by_id"),
                WaiterUser.name.label("waiter_name"),
                ItemAuthor.name.label("item_author_name"),
                ItemAuthor.email.label("item_author_email"),
                OrderAuthor.name.label("order_author_name"),
                OrderAuthor.email.label("order_author_email"),
                report_event.label("report_event_at"),
            )
            .select_from(OrderItem)
            .join(
                Order,
                and_(
                    Order.id == OrderItem.order_id,
                    Order.company_id == company_id,
                ),
            )
            .outerjoin(
                WaiterUser,
                and_(
                    WaiterUser.id == Order.waiter_id,
                    WaiterUser.company_id == company_id,
                ),
            )
            .outerjoin(
                ItemAuthor,
                and_(
                    ItemAuthor.id == OrderItem.cancelled_by_id,
                    ItemAuthor.company_id == company_id,
                ),
            )
            .outerjoin(
                OrderAuthor,
                and_(
                    OrderAuthor.id == Order.cancelled_by_id,
                    OrderAuthor.company_id == company_id,
                ),
            )
            .where(
                Order.company_id == company_id,
                or_(
                    OrderItem.status == "cancelled",
                    Order.status == "cancelled",
                ),
            )
        )
        if order_number and (normalized_order_number := order_number.strip()):
            query = query.where(
                Order.order_number.ilike(f"%{normalized_order_number}%")
            )
        if author_id:
            # OR within Author, targeting the TRUE actor per scope. Item scope
            # wins when both are cancelled, so the order-scope clause requires
            # the item NOT to be cancelled. Legacy NULL actors match nothing.
            author_ids = list(author_id)
            query = query.where(
                or_(
                    and_(
                        OrderItem.status == "cancelled",
                        OrderItem.cancelled_by_id.in_(author_ids),
                    ),
                    and_(
                        OrderItem.status != "cancelled",
                        Order.status == "cancelled",
                        Order.cancelled_by_id.in_(author_ids),
                    ),
                )
            )
        if dish_name:
            # Exact snapshot match on OrderItem.name (historical truth —
            # survives Product renames/deletes). OR within the dimension.
            query = query.where(OrderItem.name.in_(list(dish_name)))
        if date_from:
            query = query.where(
                report_event
                >= datetime.combine(date_from, datetime.min.time())
            )
        if date_to:
            query = query.where(
                report_event
                <= datetime.combine(date_to, datetime.max.time())
            )
        query = query.order_by(
            report_event.desc(), Order.created_at.desc(), Order.id, OrderItem.id
        )
        rows = (await self.db.execute(query)).all()
        result = []
        for r in rows:
            is_item_cancelled = r.item_status == "cancelled"
            scope = "item" if is_item_cancelled else "order"
            cancelled_at = (
                r.item_cancelled_at if is_item_cancelled else r.order_cancelled_at
            )
            if is_item_cancelled:
                cancelled_by_id = r.item_cancelled_by_id
                cancelled_by_name = r.item_author_name or r.item_author_email
            else:
                cancelled_by_id = r.order_cancelled_by_id
                cancelled_by_name = r.order_author_name or r.order_author_email
            date_source = (
                "cancelled_at" if cancelled_at is not None else "legacy_order_created_at"
            )
            report_event_at = cancelled_at if cancelled_at is not None else r.order_created_at
            # Legacy date/time stay on order-created truth for backward
            # compatibility with the deployed frontend.
            dt = r.order_created_at
            quantity = Decimal(str(r.quantity or 0))
            price = Decimal(str(r.price or 0))
            amount = self._cancelled_line_amount(r.price, r.quantity, r.discount)
            result.append(CancelledItemRow(
                date=dt.strftime("%d.%m.%Y") if dt else "",
                time=dt.strftime("%H:%M") if dt else "",
                order_number=r.order_number,
                table_number=r.table_number,
                name=r.name,
                quantity=quantity,
                price=price,
                waiter_name=r.waiter_name,
                unit="шт",
                order_id=r.order_id,
                order_item_id=r.order_item_id,
                order_created_at=r.order_created_at,
                cancelled_at=cancelled_at,
                cancellation_scope=scope,
                order_type=r.order_type,
                amount=amount,
                cancelled_by_id=cancelled_by_id,
                cancelled_by_name=cancelled_by_name,
                order_status=r.order_status,
                item_status=r.item_status,
                date_source=date_source,
                report_event_at=report_event_at,
            ))
        return result

    async def cancelled_filters(self, company_id: UUID) -> CancelledFiltersResponse:
        """Author + dish directories for Cancelled Dishes (tenant-scoped).

        Authors: active same-company users holding a non-system waiter OR
        cashier role — no cancellation/order history required (same product
        policy as Dishes author directory). Dishes: distinct OrderItem.name
        snapshots among cancelled-eligible rows (survives renames/deletes).
        """
        staff_rows = (await self.db.execute(
            select(User.id, User.name, User.email, Role.slug)
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                Role.company_id == company_id,
                Role.slug.in_(["waiter", "cashier"]),
                Role.is_system.is_(False),
            )
            .order_by(
                func.coalesce(User.name, User.email), User.email, User.id
            )
        )).all()
        authors: list[CancelledAuthorOption] = []
        seen_authors: set[UUID] = set()
        # A user holding both roles appears once (first row wins); role kept
        # truthful per user for the filter directory.
        for row in staff_rows:
            if row.id in seen_authors:
                continue
            seen_authors.add(row.id)
            authors.append(CancelledAuthorOption(
                id=row.id,
                name=row.name or row.email,
                role=row.slug,
            ))

        dish_rows = (await self.db.execute(
            select(OrderItem.name.distinct())
            .join(
                Order,
                and_(
                    Order.id == OrderItem.order_id,
                    Order.company_id == company_id,
                ),
            )
            .where(
                Order.company_id == company_id,
                or_(
                    OrderItem.status == "cancelled",
                    Order.status == "cancelled",
                ),
            )
            .order_by(OrderItem.name)
        )).all()
        dishes = [r[0] for r in dish_rows if r[0]]
        return CancelledFiltersResponse(authors=authors, dishes=dishes)

    async def login_history(self, company_id: UUID) -> list[LoginHistoryRow]:
        query = (
            select(
                RefreshToken.created_at,
                RefreshToken.revoked_at,
                RefreshToken.device_id,
                User.name,
                User.email,
            )
            .join(User, User.id == RefreshToken.user_id)
            .where(User.company_id == company_id)
            .order_by(RefreshToken.created_at.desc())
            .limit(200)
        )
        rows = (await self.db.execute(query)).all()
        result = []
        for r in rows:
            login_dt = r.created_at
            logout_dt = r.revoked_at
            result.append(LoginHistoryRow(
                date=login_dt.strftime("%d.%m.%Y") if login_dt else "",
                employee=r.name or r.email or "—",
                role="Сотрудник",
                device=r.device_id or "—",
                login=login_dt.strftime("%H:%M") if login_dt else "",
                logout=logout_dt.strftime("%H:%M") if logout_dt else "—",
                status="Успешно",
            ))
        return result

    async def attendance_history(self, company_id: UUID) -> list[AttendanceRow]:
        query = (
            select(
                WorkShift.actual_start, WorkShift.actual_end, WorkShift.status,
                User.name.label("user_name"),
                Employee.position,
            )
            .join(Employee, Employee.id == WorkShift.employee_id)
            .join(User, User.id == Employee.user_id)
            .where(WorkShift.company_id == company_id)
            .order_by(WorkShift.actual_start.desc())
            .limit(200)
        )
        rows = (await self.db.execute(query)).all()
        result = []
        for r in rows:
            start = r.actual_start
            end = r.actual_end
            hours = ""
            if start and end:
                diff = int((end - start).total_seconds())
                h, m = divmod(diff // 60, 60)
                hours = f"{h} ч {m} мин"
            result.append(AttendanceRow(
                date=start.strftime("%d.%m.%Y") if start else "",
                employee=r.user_name or "—",
                role=r.position or "—",
                start=start.strftime("%H:%M") if start else "",
                end=end.strftime("%H:%M") if end else "",
                hours=hours,
                status="Закрыта" if r.status == "completed" else r.status,
            ))
        return result

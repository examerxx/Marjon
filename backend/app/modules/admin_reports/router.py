from __future__ import annotations
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.admin_reports import schemas
from app.modules.admin_reports.schemas import (
    AttendanceRow, CancelledFiltersResponse, CancelledItemRow, CancelledReportTotals,
    DishReportFiltersResponse, DishReportResponse,
    DebtCreditRow, LoginHistoryRow, OrderReportFiltersResponse, OrderReportRow, ProductCountRow,
    ProductReportRow, TableReportFiltersResponse, TableReportRow,
    WaiterReportFiltersResponse, WaiterReportResponse,
)
from app.modules.admin_reports.service import AdminReportService, xlsx_response
from app.modules.auth.dependencies import (
    require_hq_admin, require_permission_or_admin, user_can_view_past_periods,
    effective_branch_filter,
)
from app.modules.auth.models import User

router = APIRouter(prefix="/reports", tags=["reports"])
admin_reports_router = APIRouter(prefix="/admin-reports", tags=["admin-reports"])

# Отчёты доступны владельцу/админу компании либо сотруднику, которому владелец
# выдал permissions.can_view_finance (тумблер «Финансы» в карточке сотрудника).
# Без can_view_past_periods — только сегодняшний день (как в финансах): иначе
# ограничение обходилось бы прямым вызовом API.
require_reports_access = require_permission_or_admin("can_view_finance")


@router.get("/cancelled/acknowledgements")
async def cancellation_acknowledgements(
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    from app.modules.admin_reports.cancellation_acknowledgements import list_receipts
    return await list_receipts(db, user)


@router.post("/cancelled/{order_id}/acknowledge")
async def acknowledge_cancellation(
    order_id: UUID,
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    from app.modules.admin_reports.cancellation_acknowledgements import acknowledge
    return await acknowledge(db, user, order_id)


async def _clamp_period(
    user: User, db: AsyncSession,
    date_from: date | None, date_to: date | None,
    *, web_timezone: str | None = None,
) -> tuple[date | None, date | None]:
    if await user_can_view_past_periods(user, db):
        return date_from, date_to
    if web_timezone:
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo(web_timezone)).date()
    else:
        today = datetime.now(timezone.utc).date()
    return today, today


# REPORT-04: the Orders report filters accept MULTIPLE values per dimension using
# this project's existing repeated-query-param pattern — the same shape
# /analytics/z-report/detail already uses for `ids`:
#   ?waiter_id=<a>&waiter_id=<b>&order_type=dine_in&order_type=delivery
# Names stay singular on purpose, so a client that still sends exactly one value
# keeps working untouched (FastAPI parses it as a one-item list) — the deployed
# OWNER frontend and the Tables/Dishes pages need no change. Comma-separated
# strings are deliberately NOT used; the project has no such convention.
# Values WITHIN one dimension are OR/IN, dimensions still combine with AND.
OrderFilterValue = Annotated[str, StringConstraints(max_length=50)]


@router.get(
    "/products",
    response_model=list[ProductReportRow],
    summary="Отчёт по продуктам (?export=excel — выгрузка)",
)
async def products_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    branch_id: UUID | None = Query(None),
    export: str | None = Query(None, description="excel — выгрузка в .xlsx"),
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    branch_id = effective_branch_filter(user, branch_id)
    date_from, date_to = await _clamp_period(user, db, date_from, date_to)
    rows = await AdminReportService(db).products(
        user.company_id, date_from, date_to, branch_id
    )
    if export == "excel":
        return xlsx_response(
            "products-report.xlsx",
            ["Продукт", "Кол-во", "Цена", "Сумма", "Себестоимость", "Прибыль"],
            [(r.product_name, r.qty, r.avg_price, r.total, r.cost, r.profit) for r in rows],
        )
    return [schemas.ProductReportRow.model_validate(r) for r in rows]


@router.get(
    "/products-count",
    response_model=list[ProductCountRow],
    summary="Отчёт по количествам (?export=excel)",
)
async def products_count_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    branch_id: UUID | None = Query(None),
    export: str | None = Query(None),
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    branch_id = effective_branch_filter(user, branch_id)
    date_from, date_to = await _clamp_period(user, db, date_from, date_to)
    rows = await AdminReportService(db).products_count(
        user.company_id, date_from, date_to, branch_id
    )
    if export == "excel":
        return xlsx_response(
            "products-count.xlsx",
            ["Продукт", "Приход", "Расход", "Остаток"],
            [(r.product_name, r.income_qty, r.expense_qty, r.balance_qty) for r in rows],
        )
    return [schemas.ProductCountRow.model_validate(r) for r in rows]


@router.get(
    "/debt-credit",
    response_model=list[DebtCreditRow],
    summary="Отчёт дебет/кредит по контрагентам (?export=excel)",
)
async def debt_credit_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    counterparty_id: UUID | None = Query(None),
    export: str | None = Query(None),
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    date_from, date_to = await _clamp_period(user, db, date_from, date_to)
    rows = await AdminReportService(db).debt_credit(
        user.company_id, date_from, date_to, counterparty_id
    )
    if export == "excel":
        return xlsx_response(
            "debt-credit.xlsx",
            ["Контрагент", "Начальный остаток", "Дебет", "Кредит", "Конечный остаток"],
            [(r.counterparty_name, r.opening_balance, r.debit, r.credit, r.closing_balance) for r in rows],
        )
    return [schemas.DebtCreditRow.model_validate(r) for r in rows]


@router.get("/orders", response_model=list[OrderReportRow])
async def orders_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    date_basis: str = Query("opened", pattern="^(opened|closed)$"),
    web_timezone: str | None = Query(None, pattern="^Asia/Tashkent$"),
    order_number: str | None = Query(None, max_length=100),
    waiter_id: list[UUID] | None = Query(None),
    cashier_id: list[UUID] | None = Query(None),
    product_id: list[UUID] | None = Query(None),
    order_type: list[OrderFilterValue] | None = Query(None),
    order_status: list[OrderFilterValue] | None = Query(None),
    payment_method: list[OrderFilterValue] | None = Query(None),
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    date_from, date_to = await _clamp_period(user, db, date_from, date_to, web_timezone=web_timezone)
    return await AdminReportService(db, web_timezone=web_timezone).orders_report(
        user.company_id,
        date_from,
        date_to,
        branch_id=effective_branch_filter(user),
        date_basis=date_basis,
        order_number=order_number,
        waiter_id=waiter_id,
        cashier_id=cashier_id,
        product_id=product_id,
        order_type=order_type,
        order_status=order_status,
        payment_method=payment_method,
    )


@router.get("/orders/filters", response_model=OrderReportFiltersResponse)
async def orders_report_filters(
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    return await AdminReportService(db).orders_report_filters(user.company_id)


@router.get("/tables", response_model=list[TableReportRow])
async def tables_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    web_timezone: str | None = Query(None, pattern="^Asia/Tashkent$"),
    table_number: str | None = Query(None, max_length=100),
    waiter_id: list[UUID] | None = Query(None),
    payment_method: list[OrderFilterValue] | None = Query(None),
    cashier_id: list[UUID] | None = Query(None),
    hall_id: list[UUID] | None = Query(None),
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    date_from, date_to = await _clamp_period(user, db, date_from, date_to, web_timezone=web_timezone)
    return await AdminReportService(db, web_timezone=web_timezone).tables_report(
        user.company_id,
        date_from,
        date_to,
        branch_id=effective_branch_filter(user),
        table_number=table_number,
        waiter_id=waiter_id,
        payment_method=payment_method,
        cashier_id=cashier_id,
        hall_id=hall_id,
    )


@router.get("/tables/filters", response_model=TableReportFiltersResponse)
async def tables_report_filters(
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    return await AdminReportService(db).tables_report_filters(user.company_id)


@router.get("/waiters", response_model=WaiterReportResponse)
async def waiters_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    web_timezone: str | None = Query(None, pattern="^Asia/Tashkent$"),
    waiter_id: UUID | None = Query(None),
    service_percent: Decimal = Query(Decimal("1"), ge=0, le=100),
    include_orders: bool = Query(True),
    include_takeaway_delivery: bool = Query(False),
    include_service: bool = Query(False),
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    date_from, date_to = await _clamp_period(user, db, date_from, date_to, web_timezone=web_timezone)
    return await AdminReportService(db, web_timezone=web_timezone).waiters_report(
        user.company_id,
        date_from,
        date_to,
        branch_id=effective_branch_filter(user),
        waiter_id=waiter_id,
        service_percent=service_percent,
        include_orders=include_orders,
        include_takeaway_delivery=include_takeaway_delivery,
        include_service=include_service,
    )


@router.get("/waiters/filters", response_model=WaiterReportFiltersResponse)
async def waiters_report_filters(
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    return await AdminReportService(db).waiters_report_filters(user.company_id)


@router.get("/dishes", response_model=DishReportResponse)
async def dishes_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    web_timezone: str | None = Query(None, pattern="^Asia/Tashkent$"),
    query: str | None = Query(None, max_length=200),
    author_id: list[UUID] | None = Query(None),
    product_id: list[UUID] | None = Query(None),
    order_type: list[OrderFilterValue] | None = Query(None),
    order_status: list[OrderFilterValue] | None = Query(None),
    category_id: list[UUID] | None = Query(None),
    payment_method: list[OrderFilterValue] | None = Query(None),
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    date_from, date_to = await _clamp_period(user, db, date_from, date_to, web_timezone=web_timezone)
    return await AdminReportService(db, web_timezone=web_timezone).dishes_report(
        user.company_id,
        date_from,
        date_to,
        branch_id=effective_branch_filter(user),
        search=query,
        author_id=author_id,
        product_id=product_id,
        order_type=order_type,
        order_status=order_status,
        category_id=category_id,
        payment_method=payment_method,
    )


@router.get("/dishes/filters", response_model=DishReportFiltersResponse)
async def dishes_report_filters(
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    return await AdminReportService(db).dishes_report_filters(user.company_id)


@router.get("/cancelled", response_model=list[CancelledItemRow])
async def cancelled_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    web_timezone: str | None = Query(None, pattern="^Asia/Tashkent$"),
    order_number: str | None = Query(None, max_length=100),
    author_id: list[UUID] | None = Query(None),
    dish_name: list[str] | None = Query(None, max_length=500),
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    # Phase 1A multi-select: repeated singular params are OR within a
    # dimension (author_id=A&author_id=B, dish_name=A&dish_name=B), AND
    # across dimensions. Scalar requests stay valid as one-item lists.
    assert user.company_id is not None
    date_from, date_to = await _clamp_period(user, db, date_from, date_to, web_timezone=web_timezone)
    return await AdminReportService(db, web_timezone=web_timezone).cancelled_items(
        user.company_id,
        date_from,
        date_to,
        branch_id=effective_branch_filter(user),
        order_number=order_number,
        author_id=author_id,
        dish_name=dish_name,
    )


@router.get("/cancelled/filters", response_model=CancelledFiltersResponse)
async def cancelled_report_filters(
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    return await AdminReportService(db).cancelled_filters(user.company_id)


@router.get("/cancelled/summary", response_model=CancelledReportTotals)
async def cancelled_report_summary(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    web_timezone: str | None = Query(None, pattern="^Asia/Tashkent$"),
    user: User = Depends(require_reports_access),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    date_from, date_to = await _clamp_period(user, db, date_from, date_to, web_timezone=web_timezone)
    return await AdminReportService(db, web_timezone=web_timezone).cancelled_items(
        user.company_id, date_from, date_to, summary_only=True, include_order_count=True,
    )


@admin_reports_router.get("/dashboard-kpis")
async def dashboard_kpis(
    _: User = Depends(require_hq_admin),
    db: AsyncSession = Depends(get_db),
):
    """BE-02: was completely unauthenticated — leaked platform-wide revenue/
    org/branch/employee counts across every tenant to anyone with the URL.

    ORG-BRIDGE-01: the four *_this_month fields back the HQ dashboard's
    "Оборот за месяц"/"Выполненная работа"/"Оплаченная сумма"/"Не оплачено"
    metric cards — real cross-tenant aggregates, scoped to the current UTC
    calendar month (a platform KPI snapshot, not a per-company financial
    statement, so UTC months rather than each company's own timezone)."""
    from sqlalchemy import func, select
    from app.modules.companies.models import Company, Branch
    from app.modules.hr.models import Employee
    from app.modules.payments.models import Payment
    from app.modules.pos.models import Order

    orgs = (await db.execute(select(func.count(Company.id)))).scalar_one()
    branches = (await db.execute(select(func.count(Branch.id)))).scalar_one()
    revenue = (await db.execute(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(Order.status == "completed")
    )).scalar_one()
    employees = (await db.execute(select(func.count(Employee.id)))).scalar_one()

    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    turnover_this_month = (await db.execute(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.status == "completed", Order.created_at >= month_start,
        )
    )).scalar_one()
    completed_orders_this_month = (await db.execute(
        select(func.count(Order.id)).where(
            Order.status == "completed", Order.created_at >= month_start,
        )
    )).scalar_one()
    paid_amount_this_month = (await db.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.status == "completed", Payment.created_at >= month_start,
        )
    )).scalar_one()
    # Один платёж на заказ (см. PaymentService.process) — поэтому "не
    # оплачено" это просто оборот завершённых заказов за месяц минус то, что
    # по ним реально поступило, без риска задвоения по нескольким платежам.
    unpaid_amount_this_month = max(Decimal(turnover_this_month) - Decimal(paid_amount_this_month), Decimal(0))

    return {
        "organizations": orgs,
        "branches": branches,
        "revenue": float(revenue),
        "subscriptions": 0,
        "employees": employees,
        "cashboxes": 0,
        "turnover_this_month": float(turnover_this_month),
        "completed_orders_this_month": completed_orders_this_month,
        "paid_amount_this_month": float(paid_amount_this_month),
        "unpaid_amount_this_month": float(unpaid_amount_this_month),
    }

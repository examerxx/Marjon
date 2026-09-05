from __future__ import annotations
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.admin_reports import schemas
from app.modules.admin_reports.schemas import (
    AttendanceRow, CancelledItemRow, DishReportFiltersResponse, DishReportRow,
    DebtCreditRow, LoginHistoryRow, OrderReportFiltersResponse, OrderReportRow, ProductCountRow,
    ProductReportRow, TableReportFiltersResponse, TableReportRow, WaiterReportRow,
)
from app.modules.admin_reports.service import AdminReportService, xlsx_response
from app.modules.auth.dependencies import require_hq_admin, require_web_owner
from app.modules.auth.models import User

router = APIRouter(prefix="/reports", tags=["reports"])
admin_reports_router = APIRouter(prefix="/admin-reports", tags=["admin-reports"])

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
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
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
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
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
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
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
    order_number: str | None = Query(None, max_length=100),
    waiter_id: list[UUID] | None = Query(None),
    cashier_id: list[UUID] | None = Query(None),
    product_id: list[UUID] | None = Query(None),
    order_type: list[OrderFilterValue] | None = Query(None),
    order_status: list[OrderFilterValue] | None = Query(None),
    payment_method: list[OrderFilterValue] | None = Query(None),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    return await AdminReportService(db).orders_report(
        user.company_id,
        date_from,
        date_to,
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
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    return await AdminReportService(db).orders_report_filters(user.company_id)


@router.get("/tables", response_model=list[TableReportRow])
async def tables_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    table_number: str | None = Query(None, max_length=100),
    waiter_id: UUID | None = Query(None),
    payment_method: str | None = Query(None, max_length=50),
    cashier_id: UUID | None = Query(None),
    hall_id: UUID | None = Query(None),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    return await AdminReportService(db).tables_report(
        user.company_id,
        date_from,
        date_to,
        table_number=table_number,
        waiter_id=waiter_id,
        payment_method=payment_method,
        cashier_id=cashier_id,
        hall_id=hall_id,
    )


@router.get("/tables/filters", response_model=TableReportFiltersResponse)
async def tables_report_filters(
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    assert user.company_id is not None
    return await AdminReportService(db).tables_report_filters(user.company_id)


@router.get("/waiters", response_model=list[WaiterReportRow])
async def waiters_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    return await AdminReportService(db).waiters_report(user.company_id, date_from, date_to)


@router.get("/dishes", response_model=list[DishReportRow])
async def dishes_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    query: str | None = Query(None, max_length=200),
    author_id: UUID | None = Query(None),
    product_id: UUID | None = Query(None),
    order_type: str | None = Query(None, max_length=50),
    order_status: str | None = Query(None, max_length=50),
    category_id: UUID | None = Query(None),
    payment_method: str | None = Query(None, max_length=50),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    return await AdminReportService(db).dishes_report(
        user.company_id,
        date_from,
        date_to,
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
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    return await AdminReportService(db).dishes_report_filters(user.company_id)


@router.get("/cancelled", response_model=list[CancelledItemRow])
async def cancelled_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    return await AdminReportService(db).cancelled_items(user.company_id, date_from, date_to)


@admin_reports_router.get("/dashboard-kpis")
async def dashboard_kpis(
    _: User = Depends(require_hq_admin),
    db: AsyncSession = Depends(get_db),
):
    """BE-02: was completely unauthenticated — leaked platform-wide revenue/
    org/branch/employee counts across every tenant to anyone with the URL."""
    from sqlalchemy import func, select
    from app.modules.companies.models import Company, Branch
    from app.modules.hr.models import Employee
    from app.modules.pos.models import Order

    orgs = (await db.execute(select(func.count(Company.id)))).scalar_one()
    branches = (await db.execute(select(func.count(Branch.id)))).scalar_one()
    revenue = (await db.execute(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(Order.status == "completed")
    )).scalar_one()
    employees = (await db.execute(select(func.count(Employee.id)))).scalar_one()
    return {
        "organizations": orgs,
        "branches": branches,
        "revenue": float(revenue),
        "subscriptions": 0,
        "employees": employees,
        "cashboxes": 0,
    }

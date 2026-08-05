from __future__ import annotations
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.admin_reports import schemas
from app.modules.admin_reports.schemas import (
    AttendanceRow, CancelledItemRow, DishReportRow,
    LoginHistoryRow, OrderReportRow, TableReportRow, WaiterReportRow,
)
from app.modules.admin_reports.service import AdminReportService, xlsx_response
from app.modules.auth.dependencies import get_current_user, require_hq_admin
from app.modules.auth.models import User

router = APIRouter(prefix="/reports", tags=["reports"])
admin_reports_router = APIRouter(prefix="/admin-reports", tags=["admin-reports"])


@router.get("/products", summary="Отчёт по продуктам (?export=excel — выгрузка)")
async def products_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    export: str | None = Query(None, description="excel — выгрузка в .xlsx"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await AdminReportService(db).products(date_from, date_to)
    if export == "excel":
        return xlsx_response(
            "products-report.xlsx",
            ["Продукт", "Кол-во", "Цена", "Сумма", "Себестоимость", "Прибыль"],
            [(r.product_name, r.qty, r.avg_price, r.total, r.cost, r.profit) for r in rows],
        )
    return [schemas.ProductReportRow.model_validate(r) for r in rows]


@router.get("/products-count", summary="Отчёт по количествам (?export=excel)")
async def products_count_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    export: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await AdminReportService(db).products_count(date_from, date_to)
    if export == "excel":
        return xlsx_response(
            "products-count.xlsx",
            ["Продукт", "Приход", "Расход", "Остаток"],
            [(r.product_name, r.income_qty, r.expense_qty, r.balance_qty) for r in rows],
        )
    return [schemas.ProductCountRow.model_validate(r) for r in rows]


@router.get("/debt-credit", summary="Отчёт дебет/кредит по контрагентам (?export=excel)")
async def debt_credit_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    export: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await AdminReportService(db).debt_credit(date_from, date_to)
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
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AdminReportService(db).orders_report(user.company_id, date_from, date_to)


@router.get("/tables", response_model=list[TableReportRow])
async def tables_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AdminReportService(db).tables_report(user.company_id, date_from, date_to)


@router.get("/waiters", response_model=list[WaiterReportRow])
async def waiters_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AdminReportService(db).waiters_report(user.company_id, date_from, date_to)


@router.get("/dishes", response_model=list[DishReportRow])
async def dishes_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AdminReportService(db).dishes_report(user.company_id, date_from, date_to)


@router.get("/cancelled", response_model=list[CancelledItemRow])
async def cancelled_report(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(get_current_user),
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

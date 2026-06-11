from __future__ import annotations
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.admin_reports import schemas
from app.modules.admin_reports.service import AdminReportService, xlsx_response
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User

router = APIRouter(prefix="/reports", tags=["reports"])


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

from __future__ import annotations
import io
from datetime import date
from decimal import Decimal
from typing import Iterable, Sequence

from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin_reports.schemas import DebtCreditRow, ProductCountRow, ProductReportRow
from app.modules.finance.models import Counterparty, FinTransaction
from app.modules.nomenclature.models import NomProduct
from app.modules.storage.models import StorageMovement


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

    def _movement_period(self, query, date_from: date | None, date_to: date | None):
        if date_from:
            query = query.where(func.date(StorageMovement.date) >= date_from)
        if date_to:
            query = query.where(func.date(StorageMovement.date) <= date_to)
        return query

    async def products(
        self, date_from: date | None, date_to: date | None
    ) -> list[ProductReportRow]:
        """Отчёт по продуктам: кол-во, цена, сумма, себестоимость, прибыль (ТЗ §6).

        Продажи — расходные движения склада; себестоимость — средняя цена прихода.
        """
        expense_qty = func.sum(StorageMovement.qty)
        expense_sum = func.sum(StorageMovement.qty * StorageMovement.price)
        query = (
            select(StorageMovement.product_id, NomProduct.name, expense_qty, expense_sum)
            .join(NomProduct, NomProduct.id == StorageMovement.product_id)
            .where(StorageMovement.direction == "expense")
            .group_by(StorageMovement.product_id, NomProduct.name)
        )
        query = self._movement_period(query, date_from, date_to)
        sales = (await self.db.execute(query)).all()

        # средняя себестоимость по всем приходам
        cost_query = (
            select(
                StorageMovement.product_id,
                func.sum(StorageMovement.qty * StorageMovement.price)
                / func.nullif(func.sum(StorageMovement.qty), 0),
            )
            .where(StorageMovement.direction == "income")
            .group_by(StorageMovement.product_id)
        )
        costs = dict((await self.db.execute(cost_query)).all())

        rows = []
        for product_id, name, qty, total in sales:
            qty = Decimal(qty or 0)
            total = Decimal(total or 0)
            unit_cost = Decimal(costs.get(product_id) or 0)
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
        self, date_from: date | None, date_to: date | None
    ) -> list[ProductCountRow]:
        income = func.sum(case(
            (StorageMovement.direction == "income", StorageMovement.qty), else_=0
        ))
        expense = func.sum(case(
            (StorageMovement.direction == "expense", StorageMovement.qty), else_=0
        ))
        query = (
            select(StorageMovement.product_id, NomProduct.name, income, expense)
            .join(NomProduct, NomProduct.id == StorageMovement.product_id)
            .group_by(StorageMovement.product_id, NomProduct.name)
        )
        query = self._movement_period(query, date_from, date_to)
        rows = (await self.db.execute(query)).all()
        return [
            ProductCountRow(
                product_id=r[0], product_name=r[1],
                income_qty=r[2] or 0, expense_qty=r[3] or 0,
                balance_qty=(r[2] or 0) - (r[3] or 0),
            )
            for r in rows
        ]

    async def debt_credit(
        self, date_from: date | None, date_to: date | None
    ) -> list[DebtCreditRow]:
        """Дебет/кредит по контрагентам: остатки и обороты за период (ТЗ §6)."""
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
            .join(Counterparty, Counterparty.id == FinTransaction.counterparty_id)
            .where(FinTransaction.deleted_at.is_(None), FinTransaction.counterparty_id.is_not(None))
            .group_by(FinTransaction.counterparty_id, Counterparty.full_name)
        )
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

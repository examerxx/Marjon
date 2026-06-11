from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel


class ProductReportRow(BaseModel):
    product_id: UUID
    product_name: str
    qty: Decimal
    avg_price: Decimal
    total: Decimal
    cost: Decimal
    profit: Decimal


class ProductCountRow(BaseModel):
    product_id: UUID
    product_name: str
    income_qty: Decimal
    expense_qty: Decimal
    balance_qty: Decimal


class DebtCreditRow(BaseModel):
    counterparty_id: UUID
    counterparty_name: str
    opening_balance: Decimal
    debit: Decimal   # приход (income)
    credit: Decimal  # расход (expense)
    closing_balance: Decimal

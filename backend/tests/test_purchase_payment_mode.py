"""Приход товаров: оплачен сразу → денежный расход; на потом → кредиторка перед поставщиком."""
from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.finance.models import FinTransaction, TransactionCategory

from tests.conftest import create_staff_headers, register_company


async def _setup(client, slug="paymode"):
    owner, _ = await register_company(client, slug=slug, email=f"owner@{slug}.example.com")
    stock = await create_staff_headers(
        client, owner, email=f"warehouse@{slug}.example.com", role_slug="warehouse"
    )
    wh = (await client.post("/warehouse/list", headers=stock, json={"name": "Main"})).json()
    ing = (await client.post("/inventory/ingredients", headers=owner, json={"name": "Мука", "unit": "кг"})).json()
    supplier = await client.post(
        "/crm/counterparties", headers=owner, json={"full_name": "Анвар", "type": "supplier"},
    )
    assert supplier.status_code in (200, 201), supplier.text
    return owner, stock, wh["id"], ing["id"]


def _body(wh_id, ing_id, **extra):
    return {
        "supplier": "Анвар", "warehouse_id": wh_id, "date": date.today().isoformat(),
        "items": [{"name": "Мука", "ingredient_id": ing_id, "quantity": 10, "unit": "кг", "cost_price": 1000}],
        **extra,
    }


async def _transactions(client, owner):
    resp = await client.get("/finance/transactions", headers=owner)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    return data["items"] if isinstance(data, dict) else data


async def _debt_credit(client, owner):
    resp = await client.get("/reports/debt-credit", headers=owner)
    assert resp.status_code == 200, resp.text
    return {row["counterparty_name"]: row for row in resp.json()}


async def test_paid_purchase_creates_cash_expense_not_creditor(client):
    owner, stock, wh_id, ing_id = await _setup(client, "paymode-a")
    resp = await client.post("/warehouse/purchases", headers=stock, json=_body(wh_id, ing_id, payment_mode="paid"))
    assert resp.status_code == 201, resp.text
    assert resp.json()["payment_mode"] == "paid"
    expenses = [t for t in await _transactions(client, owner) if t["direction"] == "expense"]
    assert len(expenses) == 1
    assert float(expenses[0]["amount"]) == 10000.0
    assert "Приход №" in (expenses[0]["comment"] or "") and "Анвар" in expenses[0]["comment"]
    # оплачено — долга перед поставщиком нет
    assert "Анвар" not in await _debt_credit(client, owner)


async def test_credit_purchase_goes_to_creditors_without_cash_expense(client):
    owner, stock, wh_id, ing_id = await _setup(client, "paymode-b")
    resp = await client.post("/warehouse/purchases", headers=stock, json=_body(wh_id, ing_id, payment_mode="credit"))
    assert resp.status_code == 201, resp.text
    assert resp.json()["payment_mode"] == "credit"
    assert [t for t in await _transactions(client, owner) if t["direction"] == "expense"] == []
    row = (await _debt_credit(client, owner))["Анвар"]
    assert float(row["credit"]) == 10000.0
    assert float(row["closing_balance"]) == -10000.0  # отрицательное сальдо = мы должны поставщику
    assert float(row["payable"]) == 10000.0


async def test_credit_purchase_requires_known_supplier(client):
    owner, stock, wh_id, ing_id = await _setup(client, "paymode-c")
    body = _body(wh_id, ing_id, payment_mode="credit")
    body["supplier"] = None
    assert (await client.post("/warehouse/purchases", headers=stock, json=body)).status_code == 422
    body["supplier"] = "Неизвестный"
    assert (await client.post("/warehouse/purchases", headers=stock, json=body)).status_code == 422


async def test_purchase_without_payment_mode_keeps_old_behaviour(client):
    owner, stock, wh_id, ing_id = await _setup(client, "paymode-d")
    resp = await client.post("/warehouse/purchases", headers=stock, json=_body(wh_id, ing_id))
    assert resp.status_code == 201, resp.text
    assert resp.json()["payment_mode"] is None
    assert [t for t in await _transactions(client, owner) if t["direction"] == "expense"] == []
    assert "Анвар" not in await _debt_credit(client, owner)


async def test_supplier_payment_reduces_creditors(client, db_engine):
    owner, stock, wh_id, ing_id = await _setup(client, "paymode-e")
    assert (await client.post("/warehouse/purchases", headers=stock, json=_body(wh_id, ing_id, payment_mode="credit"))).status_code == 201
    suppliers = (await client.get("/crm/counterparties", headers=owner)).json()["items"]
    supplier_id = UUID(next(row["id"] for row in suppliers if row["full_name"] == "Анвар"))
    me = (await client.get("/auth/me", headers=owner)).json()
    company_id = UUID(me["company_id"])
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sessions() as db:
        category = TransactionCategory(
            company_id=company_id, scope_kind="company", name="Оплата поставщику", kind="expense", status=True,
        )
        db.add(category)
        await db.flush()
        # оплатили 4 000 из 10 000 долга: расход на поставщика в категории «Оплата поставщику»
        db.add(FinTransaction(
            company_id=company_id, amount=4000, direction="expense",
            counterparty_id=supplier_id, category_id=category.id,
        ))
        await db.commit()
    row = (await _debt_credit(client, owner))["Анвар"]
    assert float(row["credit"]) == 10000.0
    assert float(row["debit"]) == 4000.0
    assert float(row["closing_balance"]) == -6000.0  # осталось должны 6 000
    assert float(row["payable"]) == 6000.0

    # обычный расход на поставщика (другая категория) по-прежнему считается кредитом
    async with sessions() as db:
        db.add(FinTransaction(company_id=company_id, amount=1000, direction="expense", counterparty_id=supplier_id))
        await db.commit()
    row = (await _debt_credit(client, owner))["Анвар"]
    assert float(row["credit"]) == 11000.0


async def test_payable_survives_old_receivable_on_same_supplier(client, db_engine):
    """Старые приходы по поставщику уводят сальдо в плюс, но долг по приходам «на потом» остаётся виден."""
    owner, stock, wh_id, ing_id = await _setup(client, "paymode-f")
    suppliers = (await client.get("/crm/counterparties", headers=owner)).json()["items"]
    supplier_id = UUID(next(row["id"] for row in suppliers if row["full_name"] == "Анвар"))
    company_id = UUID((await client.get("/auth/me", headers=owner)).json()["company_id"])
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sessions() as db:
        db.add(FinTransaction(company_id=company_id, amount=50000, direction="income", counterparty_id=supplier_id))
        await db.commit()
    assert (await client.post("/warehouse/purchases", headers=stock, json=_body(wh_id, ing_id, payment_mode="credit"))).status_code == 201
    row = (await _debt_credit(client, owner))["Анвар"]
    assert float(row["closing_balance"]) == 40000.0  # +50 000 старый приход − 10 000 долг: числится дебитором
    assert float(row["payable"]) == 10000.0  # но долг по приходу «на потом» виден отдельно

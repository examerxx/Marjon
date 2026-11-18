"""Склад при закрытии заказа целиком в долг и при отмене с галочкой «Не возвращать продукты».

* заказ, закрытый в долг БЕЗ единой оплаты, списывает продукты по рецептам, как и другие заказы;
* отмена открытого заказа по умолчанию склад не трогает (списывать нечего);
* отмена с consume_stock=true списывает продукты (блюда потрачены, на склад не вернутся).
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.modules.inventory.models import StockItem, StockMovement
from app.modules.pos.models import Order, OrderItem
from tests.test_cancelled_dishes_phase1 import _setup_company
from tests.test_recipe_stock_deduction import _attach_recipe, _ingredient, _warehouse


async def _order(ctx, *, status="accepted", portions=3):
    oid = uuid4()
    async with ctx["sessions"]() as db:
        db.add(Order(
            id=oid, company_id=ctx["company_id"], branch_id=ctx["branch_id"],
            waiter_id=ctx["owner_id"], order_number=f"DBT-{uuid4().hex[:6]}",
            order_type="dine_in", status=status,
            subtotal=Decimal("120000"), total_amount=Decimal("120000"),
        ))
        db.add(OrderItem(
            order_id=oid, product_id=ctx["product_id"], name="Лаваш",
            price=Decimal("40000"), quantity=Decimal(str(portions)),
            total=Decimal("120000"), status="pending",
        ))
        await db.commit()
    return oid


async def _moves(ctx, oid):
    async with ctx["sessions"]() as db:
        rows = (await db.execute(
            select(StockMovement).where(
                StockMovement.company_id == ctx["company_id"],
                StockMovement.ref_id == oid, StockMovement.movement_type == "sale",
            )
        )).scalars().all()
    return rows


async def _stock(ctx, wh_id, ing_id):
    async with ctx["sessions"]() as db:
        row = (await db.execute(
            select(StockItem).where(
                StockItem.company_id == ctx["company_id"],
                StockItem.warehouse_id == wh_id, StockItem.ingredient_id == ing_id,
            )
        )).scalar_one_or_none()
    return Decimal(str(row.quantity)) if row else None


async def _setup(client, db_engine, slug):
    ctx = await _setup_company(client, db_engine, slug=slug, email=f"{slug}@example.com")
    ing = await _ingredient(client, ctx["headers"])
    wh_id = await _warehouse(ctx["sessions"], ctx["company_id"])
    await _attach_recipe(client, ctx["headers"], str(ctx["product_id"]), ing["id"], 0.2)
    return ctx, wh_id, UUID(ing["id"])


@pytest.mark.asyncio
async def test_order_closed_fully_in_debt_deducts_stock(client, db_engine):
    ctx, wh_id, ing_id = await _setup(client, db_engine, "debt-stock-a")
    oid = await _order(ctx)
    resp = await client.patch(
        f"/pos/orders/{oid}/status", headers=ctx["headers"], json={"status": "completed"},
    )
    assert resp.status_code == 200, resp.text
    assert len(await _moves(ctx, oid)) == 1
    # 0.2 кг × 3 порции, склада не было — в минус, как у остальных заказов
    assert await _stock(ctx, wh_id, ing_id) == Decimal("-0.6")


@pytest.mark.asyncio
async def test_cancel_open_order_by_default_does_not_touch_stock(client, db_engine):
    ctx, wh_id, ing_id = await _setup(client, db_engine, "debt-stock-b")
    oid = await _order(ctx)
    resp = await client.delete(f"/pos/orders/{oid}", headers=ctx["headers"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "cancelled"
    assert await _moves(ctx, oid) == []
    assert await _stock(ctx, wh_id, ing_id) is None


@pytest.mark.asyncio
async def test_cancel_with_consume_stock_deducts_products(client, db_engine):
    ctx, wh_id, ing_id = await _setup(client, db_engine, "debt-stock-c")
    oid = await _order(ctx)
    resp = await client.delete(f"/pos/orders/{oid}?consume_stock=true", headers=ctx["headers"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "cancelled"
    assert len(await _moves(ctx, oid)) == 1
    assert await _stock(ctx, wh_id, ing_id) == Decimal("-0.6")


@pytest.mark.asyncio
async def test_consume_stock_twice_is_idempotent_and_skips_cancelled_dishes(client, db_engine):
    ctx, wh_id, ing_id = await _setup(client, db_engine, "debt-stock-d")
    oid = await _order(ctx, portions=2)
    async with ctx["sessions"]() as db:
        item = (await db.execute(select(OrderItem).where(OrderItem.order_id == oid))).scalars().first()
        item.status = "cancelled"  # блюдо уже отменено отдельно — его продукты не списываем
        await db.commit()
    resp = await client.delete(f"/pos/orders/{oid}?consume_stock=true", headers=ctx["headers"])
    assert resp.status_code == 200, resp.text
    assert await _moves(ctx, oid) == []

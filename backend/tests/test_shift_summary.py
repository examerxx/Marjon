"""Сводка смены для профиля сотрудника на терминале.

GET /pos/shifts/me/summary отдаёт текущую смену филиала, выработку за
операционный день и продажи самого сотрудника. Профиль на кассе показывает
эти цифры, поэтому важно, чтобы продажи считались только по его закрытым
заказам, а после закрытия смены shift приходил null.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.pos.models import Order
from tests.conftest import create_staff_headers, register_company


@pytest.mark.asyncio
async def test_shift_summary_for_staff(client, db_engine):
    owner_headers, _ = await register_company(
        client, slug="shift-summary", email="owner@shift-summary.uz"
    )
    branches = await client.get("/companies/me/branches", headers=owner_headers)
    assert branches.status_code == 200, branches.text
    branch_id = branches.json()[0]["id"]

    cashier_headers = await create_staff_headers(
        client, owner_headers, email="cashier@shift-summary.uz", role_slug="cashier"
    )
    me = await client.get("/auth/me", headers=cashier_headers)
    assert me.status_code == 200, me.text
    cashier_id = me.json()["id"]
    company_id = me.json()["company_id"]

    opened = await client.post(
        "/pos/shifts/open",
        headers=cashier_headers,
        json={"branch_id": branch_id, "opening_cash": 0},
    )
    assert opened.status_code == 201, opened.text

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        session.add(Order(
            company_id=UUID(company_id),
            branch_id=UUID(branch_id),
            waiter_id=UUID(cashier_id),
            public_id=10_000_001,
            order_number="1",
            order_type="dine_in",
            status="completed",
            total_amount=Decimal("50000"),
            created_at=datetime.now(timezone.utc),
        ))
        await session.commit()

    summary = await client.get(
        "/pos/shifts/me/summary", headers=cashier_headers, params={"branch_id": branch_id}
    )
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["shift"]["id"] == opened.json()["id"]
    assert Decimal(body["sales_total"]) == Decimal("50000")
    assert body["orders_count"] == 1

    closed = await client.post(
        "/pos/shifts/close", headers=cashier_headers, json={"closing_cash": 50000}
    )
    assert closed.status_code == 200, closed.text

    after = await client.get(
        "/pos/shifts/me/summary", headers=cashier_headers, params={"branch_id": branch_id}
    )
    assert after.status_code == 200, after.text
    assert after.json()["shift"] is None
    assert Decimal(after.json()["sales_total"]) == Decimal("50000")

"""OFFLINE-01: идемпотентный приём офлайн-заказов, снимок цены и sync API."""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select

from app.modules.audit.models import AuditLog
from app.modules.notifications.models import Notification
from app.modules.payments.models import Payment
from tests.conftest import register_company
from tests.test_cancelled_dishes_phase1 import _setup_company


async def _create(client, ctx, **extra):
    body = {
        "branch_id": str(ctx["branch_id"]),
        "items": [{
            "product_id": str(ctx["product_id"]),
            "quantity": "1",
            **({"unit_price": extra.pop("unit_price")} if "unit_price" in extra else {}),
        }],
        **extra,
    }
    return await client.post("/pos/orders", headers=ctx["headers"], json=body)


async def test_offline_order_replay_returns_same_order(client, db_engine):
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(
        client, db_engine, slug=f"off-a-{sfx}", email=f"off-a-{sfx}@example.com"
    )
    client_id = str(uuid4())

    first = await _create(client, ctx, client_id=client_id, client_number="T1-261113-001")
    assert first.status_code == 201, first.text
    second = await _create(client, ctx, client_id=client_id, client_number="T1-261113-001")
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["client_number"] == "T1-261113-001"

    from app.modules.pos.models import Order
    async with ctx["sessions"]() as db:
        rows = list((await db.execute(select(Order.id).where(Order.client_id == client_id))).scalars())
    assert [str(r) for r in rows] == [first.json()["id"]]


async def test_offline_order_notifies_company_admins(client, db_engine):
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(
        client, db_engine, slug=f"off-n-{sfx}", email=f"off-n-{sfx}@example.com"
    )

    offline = await _create(
        client, ctx, client_id=str(uuid4()),
        created_offline_at="2026-11-13T10:00:00+05:00",
    )
    assert offline.status_code == 201, offline.text

    async with ctx["sessions"]() as db:
        rows = list((await db.execute(
            select(Notification).where(Notification.company_id == ctx["company_id"])
        )).scalars())
    assert len(rows) == 1
    assert rows[0].user_id == ctx["owner_id"]
    assert rows[0].notification_type == "order.offline_synced"
    assert rows[0].data["order_id"] == offline.json()["id"]

    # Онлайн-заказ не создаёт уведомление: событие — именно возврат связи.
    online = await _create(client, ctx, client_id=str(uuid4()))
    assert online.status_code == 201, online.text
    async with ctx["sessions"]() as db:
        rows = list((await db.execute(
            select(Notification).where(Notification.company_id == ctx["company_id"])
        )).scalars())
    assert len(rows) == 1


async def test_price_snapshot_accepted_and_audited(client, db_engine):
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(
        client, db_engine, slug=f"off-b-{sfx}", email=f"off-b-{sfx}@example.com"
    )

    resp = await _create(
        client, ctx, client_id=str(uuid4()), price_snapshot=True, unit_price="90",
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert Decimal(body["subtotal"]) == Decimal("90")
    assert Decimal(body["items"][0]["price"]) == Decimal("90")

    async with ctx["sessions"]() as db:
        actions = list((await db.execute(
            select(AuditLog.action).where(AuditLog.action == "order.price_snapshot_mismatch")
        )).scalars())
    assert actions == ["order.price_snapshot_mismatch"]


async def test_offline_payment_cash_only(client, db_engine):
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(
        client, db_engine, slug=f"off-c-{sfx}", email=f"off-c-{sfx}@example.com"
    )
    order = (await _create(client, ctx, client_id=str(uuid4()))).json()
    total = str(order["total_amount"])

    card = await client.post("/payments", headers=ctx["headers"], json={
        "order_id": order["id"], "amount": total, "method": "card",
        "offline_import": True,
    })
    assert card.status_code == 422, card.text

    cash = await client.post(
        "/payments",
        headers=ctx["headers"],
        json={
            "order_id": order["id"], "amount": total, "method": "cash",
            "offline_import": True, "client_created_at": "2026-11-13T10:00:00+05:00",
        },
    )
    assert cash.status_code == 201, cash.text
    assert cash.json()["status"] == "completed"

    async with ctx["sessions"]() as db:
        payment = (await db.execute(select(Payment))).scalars().first()
    assert payment.provider_data["offline_import"] is True


async def test_sync_bootstrap_and_changes(client, db_engine):
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(
        client, db_engine, slug=f"off-d-{sfx}", email=f"off-d-{sfx}@example.com"
    )
    resp = await client.get(
        "/sync/bootstrap", headers=ctx["headers"], params={"branch_id": str(ctx["branch_id"])}
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["branch_id"] == str(ctx["branch_id"])
    assert [p["id"] for p in data["products"]] == [str(ctx["product_id"])]

    order = (await _create(client, ctx, client_id=str(uuid4()))).json()
    delta = await client.get(
        "/sync/changes",
        headers=ctx["headers"],
        params={"branch_id": str(ctx["branch_id"]), "since": "2000-01-01T00:00:00+00:00"},
    )
    assert delta.status_code == 200, delta.text
    assert [o["id"] for o in delta.json()["orders"]] == [order["id"]]


async def test_sync_changes_without_since_returns_no_history(client, db_engine):
    """Первый опрос — только установка курсора: старые заказы филиала не
    вываливаются в локальную базу терминала (иначе зал начинался бы с
    позавчерашней истории)."""
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(
        client, db_engine, slug=f"off-f-{sfx}", email=f"off-f-{sfx}@example.com"
    )
    order = (await _create(client, ctx, client_id=str(uuid4()))).json()
    assert order["id"]

    first = await client.get(
        "/sync/changes", headers=ctx["headers"], params={"branch_id": str(ctx["branch_id"])}
    )
    assert first.status_code == 200, first.text
    assert first.json()["orders"] == []
    assert first.json()["server_time"]

    after = await client.get(
        "/sync/changes",
        headers=ctx["headers"],
        params={"branch_id": str(ctx["branch_id"]), "since": first.json()["server_time"]},
    )
    assert after.status_code == 200, after.text
    assert after.json()["orders"] == []


async def test_offline_totals_must_reconcile(client, db_engine):
    """Посчитанные терминалом итоги принимаются только арифметически
    сходящимися и только с price_snapshot + created_offline_at."""
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(
        client, db_engine, slug=f"off-g-{sfx}", email=f"off-g-{sfx}@example.com"
    )
    base = {
        "client_id": str(uuid4()),
        "price_snapshot": True,
        "created_offline_at": "2026-11-13T10:00:00+05:00",
        "unit_price": "100",
    }
    bad = await _create(client, ctx, **base, offline_totals={
        "subtotal": "100.00", "discount_amount": "0", "tax_amount": "0",
        "service_fee": "0", "total_amount": "999.00",
    })
    assert bad.status_code == 422, bad.text

    ok = await _create(client, ctx, **{**base, "client_id": str(uuid4())}, offline_totals={
        "subtotal": "100.00", "discount_amount": "10.00", "tax_amount": "0",
        "service_fee": "0", "total_amount": "90.00",
    })
    assert ok.status_code == 201, ok.text
    body = ok.json()
    assert Decimal(body["subtotal"]) == Decimal("100.00")
    assert Decimal(body["discount_amount"]) == Decimal("10.00")
    assert Decimal(body["total_amount"]) == Decimal("90.00")


async def test_sync_staff_exposes_hash_not_plain_pin(client, db_engine):
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(
        client, db_engine, slug=f"off-e-{sfx}", email=f"off-e-{sfx}@example.com"
    )
    created = await client.post("/auth/users", headers=ctx["headers"], json={
        "role_name": "Cashier", "email": f"cashier-{sfx}@example.com", "password": "Passw0rd!",
        "role_slug": "cashier", "branch_id": str(ctx["branch_id"]),
    })
    assert created.status_code in (200, 201), created.text
    user_id = created.json()["id"]
    patched = await client.patch(
        f"/auth/users/{user_id}/pin", headers=ctx["headers"], json={"pin": "3333"}
    )
    assert patched.status_code in (200, 204), patched.text

    resp = await client.get(
        "/sync/staff", headers=ctx["headers"], params={"branch_id": str(ctx["branch_id"])}
    )
    assert resp.status_code == 200, resp.text
    entry = next(s for s in resp.json()["staff"] if s["id"] == user_id)
    assert entry["pin_hash"] and entry["pin_hash"] != "3333"
    assert isinstance(entry["permissions"], list)

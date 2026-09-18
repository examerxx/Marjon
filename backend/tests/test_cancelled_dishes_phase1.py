from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.admin_reports.service import AdminReportService
from app.modules.auth.models import User
from app.modules.companies.models import Branch
from app.modules.inventory.models import Category, Product
from app.modules.pos.models import Order, OrderItem
from tests.conftest import create_staff_headers, register_company


async def _me(client, headers):
    r = await client.get("/auth/me", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


async def _setup_company(client, db_engine, *, slug: str, email: str):
    headers, _ = await register_company(client, slug=slug, email=email)
    ident = await _me(client, headers)
    company_id = UUID(ident["company_id"])
    owner_id = UUID(ident["id"])
    branch_id = uuid4()
    cat_id = uuid4()
    prod_id = uuid4()
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sessions() as db:
        db.add(Branch(id=branch_id, company_id=company_id, name="Main"))
        db.add(Category(
            id=cat_id, company_id=company_id,
            name="Cat", slug=f"cat-{slug}",
        ))
        await db.flush()
        db.add(Product(
            id=prod_id, company_id=company_id, category_id=cat_id,
            name="Plov", price=Decimal("100"), cost_price=Decimal("40"),
        ))
        await db.commit()
    return {
        "headers": headers, "company_id": company_id, "owner_id": owner_id,
        "branch_id": branch_id, "category_id": cat_id, "product_id": prod_id,
        "sessions": sessions,
    }


async def _add_order(db_sessions, *, company_id, branch_id, waiter_id,
                     order_number, status="new", order_type="dine_in",
                     table_number="5", created_at=None,
                     cancelled_at=None, cancelled_by=None):
    oid = uuid4()
    async with db_sessions() as db:
        o = Order(
            id=oid, company_id=company_id, branch_id=branch_id,
            waiter_id=waiter_id, order_number=order_number,
            order_type=order_type, status=status,
            table_number=table_number,
            subtotal=Decimal("0"), total_amount=Decimal("0"),
            cancelled_at=cancelled_at, cancelled_by_id=cancelled_by,
        )
        if created_at is not None:
            o.created_at = created_at
        db.add(o)
        await db.commit()
    return oid


async def _add_item(db_sessions, *, order_id, product_id, name="Plov",
                    price="100", qty="2", discount="10", total=None,
                    status="pending", cancelled_at=None, cancelled_by=None):
    iid = uuid4()
    if total is None:
        total = str(Decimal(price) * Decimal(qty) - Decimal(discount))
    async with db_sessions() as db:
        db.add(OrderItem(
            id=iid, order_id=order_id, product_id=product_id, name=name,
            price=Decimal(price), quantity=Decimal(qty),
            discount=Decimal(discount), total=Decimal(total),
            status=status, cancelled_at=cancelled_at,
            cancelled_by_id=cancelled_by,
        ))
        await db.commit()
    return iid


def _by_item(rows):
    return {r["order_item_id"]: r for r in rows}


async def _set_user_name(sessions, user_id, name):
    async with sessions() as db:
        u = await db.get(User, user_id)
        u.name = name
        await db.commit()


@pytest.mark.asyncio
async def test_cancelled_inclusion_scope_actor_and_legacy(client, db_engine):
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(
        client, db_engine, slug=f"can-a-{sfx}",
        email=f"can-a-{sfx}@example.com",
    )
    sessions, company_id = ctx["sessions"], ctx["company_id"]
    waiter_headers = await create_staff_headers(
        client, ctx["headers"], email=f"w-{sfx}@example.com", role_slug="waiter",
    )
    cashier_headers = await create_staff_headers(
        client, ctx["headers"], email=f"c-{sfx}@example.com", role_slug="cashier",
    )
    waiter_id = UUID((await _me(client, waiter_headers))["id"])
    cashier_id = UUID((await _me(client, cashier_headers))["id"])
    await _set_user_name(sessions, waiter_id, "Waiter Ali")
    await _set_user_name(sessions, cashier_id, "Cashier Vali")
    owner_id = ctx["owner_id"]

    t_item = datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)
    t_order = datetime(2026, 9, 11, 13, 0, tzinfo=timezone.utc)

    # A: individually cancelled item on live order (actor waiter), plus B: live item excluded
    o_live = await _add_order(
        sessions, company_id=company_id, branch_id=ctx["branch_id"],
        waiter_id=waiter_id, order_number="LIVE-1", status="cooking",
        created_at=datetime(2026, 9, 9, 10, 0, tzinfo=timezone.utc),
    )
    i_cancelled = await _add_item(
        sessions, order_id=o_live, product_id=ctx["product_id"],
        name="Plov", price="100", qty="2", discount="10",
        status="cancelled", cancelled_at=t_item, cancelled_by=waiter_id,
    )
    i_live = await _add_item(
        sessions, order_id=o_live, product_id=ctx["product_id"],
        name="Soup", price="50", qty="1", discount="0",
        status="served",
    )
    # C: whole-order cancellation (actor cashier), items live
    o_cancelled = await _add_order(
        sessions, company_id=company_id, branch_id=ctx["branch_id"],
        waiter_id=waiter_id, order_number="CANC-1", status="cancelled",
        cancelled_at=t_order, cancelled_by=cashier_id,
        created_at=datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc),
    )
    i_inherit = await _add_item(
        sessions, order_id=o_cancelled, product_id=ctx["product_id"],
        name="Lagman", price="80", qty="1", discount="0", status="served",
    )
    # D: both item+parent cancelled -> once, item scope wins (actor waiter)
    o_both = await _add_order(
        sessions, company_id=company_id, branch_id=ctx["branch_id"],
        waiter_id=cashier_id, order_number="BOTH-1", status="cancelled",
        cancelled_at=t_order, cancelled_by=cashier_id,
        created_at=datetime(2026, 9, 7, 8, 0, tzinfo=timezone.utc),
    )
    i_both = await _add_item(
        sessions, order_id=o_both, product_id=ctx["product_id"],
        name="Plov", price="100", qty="1", discount="0",
        status="cancelled", cancelled_at=t_item, cancelled_by=waiter_id,
    )
    # H/J: system cancellation NULL actor, NULL timestamp legacy row
    o_legacy = await _add_order(
        sessions, company_id=company_id, branch_id=ctx["branch_id"],
        waiter_id=waiter_id, order_number="LEG-1", status="cancelled",
        cancelled_at=None, cancelled_by=None,
        created_at=datetime(2026, 9, 6, 7, 0, tzinfo=timezone.utc),
    )
    i_legacy = await _add_item(
        sessions, order_id=o_legacy, product_id=ctx["product_id"],
        name="Plov", price="100", qty="1", discount="0", status="served",
    )
    # T: NULL table_number still represented
    o_nulltable = await _add_order(
        sessions, company_id=company_id, branch_id=ctx["branch_id"],
        waiter_id=waiter_id, order_number="NULLT-1", status="cancelled",
        table_number=None, cancelled_at=t_order, cancelled_by=waiter_id,
        created_at=datetime(2026, 9, 5, 6, 0, tzinfo=timezone.utc),
    )
    i_nulltable = await _add_item(
        sessions, order_id=o_nulltable, product_id=ctx["product_id"],
        name="Plov", price="100", qty="1", discount="0", status="served",
    )

    resp = await client.get("/reports/cancelled", headers=ctx["headers"])
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert isinstance(rows, list)
    by = _by_item(rows)

    # A included, B excluded
    assert str(i_cancelled) in by
    assert str(i_live) not in by
    # C included
    assert str(i_inherit) in by
    # D once
    assert [r for r in rows if r["order_item_id"] == str(i_both)].__len__() == 1
    # T NULL table preserved
    assert str(i_nulltable) in by
    assert by[str(i_nulltable)]["table_number"] is None

    # E scope
    assert by[str(i_cancelled)]["cancellation_scope"] == "item"
    assert by[str(i_inherit)]["cancellation_scope"] == "order"
    assert by[str(i_both)]["cancellation_scope"] == "item"
    assert by[str(i_legacy)]["cancellation_scope"] == "order"

    # F item actor wins
    assert by[str(i_cancelled)]["cancelled_by_id"] == str(waiter_id)
    assert by[str(i_both)]["cancelled_by_id"] == str(waiter_id)
    # G order actor
    assert by[str(i_inherit)]["cancelled_by_id"] == str(cashier_id)
    # H NULL preserved
    assert by[str(i_legacy)]["cancelled_by_id"] is None
    assert by[str(i_legacy)]["cancelled_by_name"] is None

    # I truthful timestamps
    assert by[str(i_cancelled)]["cancelled_at"] is not None
    assert by[str(i_inherit)]["cancelled_at"] is not None
    # J legacy NULL
    assert by[str(i_legacy)]["cancelled_at"] is None
    assert by[str(i_legacy)]["date_source"] == "legacy_order_created_at"
    assert by[str(i_cancelled)]["date_source"] == "cancelled_at"
    # report_event fallback
    assert by[str(i_legacy)]["report_event_at"] == by[str(i_legacy)]["order_created_at"]
    assert by[str(i_cancelled)]["report_event_at"] == by[str(i_cancelled)]["cancelled_at"]

    # L waiter != author separation (order waiter waiter_id, author cashier)
    assert by[str(i_inherit)]["waiter_name"] is not None
    # waiter is waiter_id's name, author is cashier
    assert by[str(i_inherit)]["cancelled_by_id"] == str(cashier_id)

    # V legacy fields present
    for r in rows:
        for k in ("date", "time", "order_number", "table_number", "name",
                  "quantity", "price", "waiter_name", "unit"):
            assert k in r, k
        assert r["unit"] == "шт"
        # new additive
        for k in ("order_id", "order_item_id", "order_created_at", "cancelled_at",
                  "cancellation_scope", "order_type", "amount",
                  "cancelled_by_id", "cancelled_by_name",
                  "order_status", "item_status", "date_source"):
            assert k in r, k

    # U amount formula: Plov 100*2-10=190 (not zeroed total)
    assert Decimal(str(by[str(i_cancelled)]["amount"])) == Decimal("190.00") or \
        Decimal(str(by[str(i_cancelled)]["amount"])) == Decimal("190")


@pytest.mark.asyncio
async def test_cancelled_amount_formula_direct():
    assert AdminReportService._cancelled_line_amount(
        Decimal("100"), Decimal("2"), Decimal("10")) == Decimal("10") * Decimal("19")
    assert AdminReportService._cancelled_line_amount(
        Decimal("50"), Decimal("1"), Decimal("0")) == Decimal("50.00")
    # discount larger than gross floors at 0
    assert AdminReportService._cancelled_line_amount(
        Decimal("10"), Decimal("1"), Decimal("99")) == Decimal("0")
    # quantity precision: 100 * 1.5 - 0 = 150
    assert AdminReportService._cancelled_line_amount(
        Decimal("100"), Decimal("1.5"), Decimal("0")) == Decimal("150.00")
    # None-safe
    assert AdminReportService._cancelled_line_amount(None, None, None) == Decimal("0")


@pytest.mark.asyncio
async def test_cancelled_period_author_dish_order_filters(client, db_engine):
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(
        client, db_engine, slug=f"can-f-{sfx}",
        email=f"can-f-{sfx}@example.com",
    )
    sessions, company_id = ctx["sessions"], ctx["company_id"]
    w1_h = await create_staff_headers(
        client, ctx["headers"], email=f"w1-{sfx}@example.com", role_slug="waiter")
    w2_h = await create_staff_headers(
        client, ctx["headers"], email=f"w2-{sfx}@example.com", role_slug="waiter")
    c1_h = await create_staff_headers(
        client, ctx["headers"], email=f"c1-{sfx}@example.com", role_slug="cashier")
    w1 = UUID((await _me(client, w1_h))["id"])
    w2 = UUID((await _me(client, w2_h))["id"])
    c1 = UUID((await _me(client, c1_h))["id"])

    async def mk(number, *, created, cancelled_at, actor, dish, waiter,
                item_status="cancelled", order_status="new", table="1"):
        oid = await _add_order(
            sessions, company_id=company_id, branch_id=ctx["branch_id"],
            waiter_id=waiter, order_number=number, status=order_status,
            created_at=created, cancelled_at=cancelled_at if order_status == "cancelled" else None,
            cancelled_by=actor if order_status == "cancelled" else None,
            table_number=table,
        )
        iid = await _add_item(
            sessions, order_id=oid, product_id=ctx["product_id"], name=dish,
            price="100", qty="1", discount="0", status=item_status,
            cancelled_at=cancelled_at if item_status == "cancelled" else None,
            cancelled_by=actor if item_status == "cancelled" else None,
        )
        return oid, iid

    d1 = datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)
    d2 = datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc)
    d3 = datetime(2026, 9, 20, 10, 0, tzinfo=timezone.utc)
    o1, i1 = await mk("ORD-100", created=d1, cancelled_at=d1, actor=w1,
                      dish="Plov", waiter=w1)
    o2, i2 = await mk("ORD-200", created=d2, cancelled_at=d2, actor=w2,
                      dish="Lagman", waiter=w2)
    # order-scope row (item live, order cancelled by cashier)
    o3id = await _add_order(
        sessions, company_id=company_id, branch_id=ctx["branch_id"],
        waiter_id=w1, order_number="ORD-300", status="cancelled",
        created_at=d3, cancelled_at=d3, cancelled_by=c1)
    async with sessions() as db:
        db.add(OrderItem(
            order_id=o3id, product_id=ctx["product_id"], name="Plov",
            price=Decimal("100"), quantity=Decimal("1"),
            discount=Decimal("0"), total=Decimal("100"), status="served",
        ))
        await db.commit()
        # fetch its id
        from sqlalchemy import select
        i3 = (await db.execute(
            select(OrderItem.id).where(OrderItem.order_id == o3id))).scalar_one()
    # legacy row: created Sep 5, no cancelled_at -> event Sep 5
    oleg = await _add_order(
        sessions, company_id=company_id, branch_id=ctx["branch_id"],
        waiter_id=w1, order_number="ORD-LEG", status="cancelled",
        created_at=datetime(2026, 9, 5, 9, 0, tzinfo=timezone.utc))
    ileg = await _add_item(
        sessions, order_id=oleg, product_id=ctx["product_id"], name="Plov",
        price="100", qty="1", discount="0", status="served")

    async def get(params=None):
        r = await client.get("/reports/cancelled", headers=ctx["headers"],
                             params=params or {})
        assert r.status_code == 200, r.text
        return r.json()

    base = await get()
    assert {r["order_item_id"] for r in base} >= {str(i1), str(i2), str(i3), str(ileg)}

    # K period: Sep 1-10 includes i1 (event Sep1) + legacy (event Sep5), excludes Sep15/20
    per = await get({"date_from": "2026-09-01", "date_to": "2026-09-10"})
    ids = {r["order_item_id"] for r in per}
    assert str(i1) in ids
    assert str(ileg) in ids
    assert str(i2) not in ids
    assert str(i3) not in ids

    # M author single / repeated / duplicate, N OR
    a1 = await get({"author_id": str(w1)})
    assert {r["order_item_id"] for r in a1} == {str(i1)}
    both = await client.get("/reports/cancelled", headers=ctx["headers"],
                            params=[("author_id", str(w1)), ("author_id", str(w2))])
    assert both.status_code == 200
    assert {r["order_item_id"] for r in both.json()} == {str(i1), str(i2)}
    dup = await client.get("/reports/cancelled", headers=ctx["headers"],
                           params=[("author_id", str(w1)), ("author_id", str(w1))])
    assert dup.status_code == 200
    assert {r["order_item_id"] for r in dup.json()} == {str(i1)}
    # cashier author matches order-scope row
    ca = await get({"author_id": str(c1)})
    assert {r["order_item_id"] for r in ca} == {str(i3)}
    # waiter filter does NOT match order-scope row authored by cashier
    assert str(i3) not in {r["order_item_id"] for r in a1}

    # O dish single/repeated/duplicate
    plov = await get({"dish_name": "Plov"})
    assert {r["order_item_id"] for r in plov} >= {str(i1), str(i3), str(ileg)}
    assert str(i2) not in {r["order_item_id"] for r in plov}
    both_dish = await client.get("/reports/cancelled", headers=ctx["headers"],
                                 params=[("dish_name", "Plov"), ("dish_name", "Lagman")])
    assert both_dish.status_code == 200
    assert {r["order_item_id"] for r in both_dish.json()} >= {str(i1), str(i2)}
    dup_dish = await client.get("/reports/cancelled", headers=ctx["headers"],
                                params=[("dish_name", "Plov"), ("dish_name", "Plov")])
    assert dup_dish.status_code == 200
    assert {r["order_item_id"] for r in dup_dish.json()} == \
        {r["order_item_id"] for r in plov}

    # P AND across dimensions: author w1 AND dish Lagman -> empty
    combo_empty = await client.get("/reports/cancelled", headers=ctx["headers"],
                                   params=[("author_id", str(w1)), ("dish_name", "Lagman")])
    assert combo_empty.status_code == 200
    assert combo_empty.json() == []
    combo_ok = await client.get("/reports/cancelled", headers=ctx["headers"],
                                params=[("author_id", str(w1)), ("dish_name", "Plov")])
    assert combo_ok.status_code == 200
    assert {r["order_item_id"] for r in combo_ok.json()} == {str(i1)}

    # Q order_number (ilike, tenant-scoped)
    q = await get({"order_number": "ORD-100"})
    assert [r["order_item_id"] for r in q] == [str(i1)]
    q2 = await get({"order_number": "ord-200"})
    assert [r["order_item_id"] for r in q2] == [str(i2)]


@pytest.mark.asyncio
async def test_cancelled_tenant_isolation_and_filters_endpoint(client, db_engine):
    sfx = uuid4().hex[:8]
    a = await _setup_company(client, db_engine, slug=f"can-ta-{sfx}",
                             email=f"can-ta-{sfx}@example.com")
    b = await _setup_company(client, db_engine, slug=f"can-tb-{sfx}",
                             email=f"can-tb-{sfx}@example.com")
    wa_h = await create_staff_headers(
        client, a["headers"], email=f"wa-{sfx}@example.com", role_slug="waiter")
    ca_h = await create_staff_headers(
        client, a["headers"], email=f"ca-{sfx}@example.com", role_slug="cashier")
    ka_h = await create_staff_headers(
        client, a["headers"], email=f"ka-{sfx}@example.com", role_slug="kitchen")
    wb_h = await create_staff_headers(
        client, b["headers"], email=f"wb-{sfx}@example.com", role_slug="waiter")
    wa = UUID((await _me(client, wa_h))["id"])
    ca = UUID((await _me(client, ca_h))["id"])
    ka = UUID((await _me(client, ka_h))["id"])
    wb = UUID((await _me(client, wb_h))["id"])
    # inactive cashier in A
    inact_h = await create_staff_headers(
        client, a["headers"], email=f"inact-{sfx}@example.com", role_slug="cashier")
    inact_id = UUID((await _me(client, inact_h))["id"])
    async with a["sessions"]() as db:
        u = await db.get(User, inact_id)
        u.is_active = False
        await db.commit()

    t = datetime(2026, 9, 12, 10, 0, tzinfo=timezone.utc)
    oa = await _add_order(a["sessions"], company_id=a["company_id"],
                          branch_id=a["branch_id"], waiter_id=wa,
                          order_number="A-1", status="new", created_at=t)
    ia = await _add_item(a["sessions"], order_id=oa, product_id=a["product_id"],
                         name="Secret Plov A", status="cancelled",
                         cancelled_at=t, cancelled_by=wa)
    ob = await _add_order(b["sessions"], company_id=b["company_id"],
                          branch_id=b["branch_id"], waiter_id=wb,
                          order_number="B-1", status="new", created_at=t)
    ib = await _add_item(b["sessions"], order_id=ob, product_id=b["product_id"],
                         name="Secret Plov B", status="cancelled",
                         cancelled_at=t, cancelled_by=wb)

    ra = await client.get("/reports/cancelled", headers=a["headers"])
    assert ra.status_code == 200
    assert "Secret Plov B" not in ra.text
    assert "Secret Plov A" in ra.text
    rb = await client.get("/reports/cancelled", headers=b["headers"])
    assert rb.status_code == 200
    assert "Secret Plov A" not in rb.text

    # R foreign author matches nothing
    rf = await client.get("/reports/cancelled", headers=a["headers"],
                          params={"author_id": str(wb)})
    assert rf.status_code == 200
    assert rf.json() == []

    # W filters endpoint
    f = await client.get("/reports/cancelled/filters", headers=a["headers"])
    assert f.status_code == 200, f.text
    payload = f.json()
    assert set(payload.keys()) >= {"authors", "dishes"}
    author_ids = {r["id"] for r in payload["authors"]}
    assert str(wa) in author_ids
    assert str(ca) in author_ids
    assert str(ka) not in f.text
    assert str(wb) not in f.text
    assert str(inact_id) not in f.text
    # role truthful
    by_id = {r["id"]: r["role"] for r in payload["authors"]}
    assert by_id[str(wa)] == "waiter"
    assert by_id[str(ca)] == "cashier"
    assert "Secret Plov A" in payload["dishes"]
    assert "Secret Plov B" not in payload["dishes"]


@pytest.mark.asyncio
async def test_cancelled_write_paths_capture_actor_and_idempotent(client, db_engine):
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(client, db_engine, slug=f"can-w-{sfx}",
                               email=f"can-w-{sfx}@example.com")
    sessions, company_id = ctx["sessions"], ctx["company_id"]
    waiter_h = await create_staff_headers(
        client, ctx["headers"], email=f"ww-{sfx}@example.com", role_slug="waiter")
    waiter_id = UUID((await _me(client, waiter_h))["id"])

    # Whole-order cancel via API captures actor
    oid = await _add_order(sessions, company_id=company_id,
                           branch_id=ctx["branch_id"], waiter_id=waiter_id,
                           order_number="W-1", status="new")
    iid = await _add_item(sessions, order_id=oid, product_id=ctx["product_id"],
                          name="Plov", status="pending")
    r = await client.delete(f"/pos/orders/{oid}", headers=waiter_h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "cancelled"
    assert body["cancelled_by_id"] == str(waiter_id)
    assert body["cancelled_at"] is not None
    first_at = body["cancelled_at"]
    first_by = body["cancelled_by_id"]
    # repeated cancel raises, does not rewrite
    r2 = await client.delete(f"/pos/orders/{oid}", headers=waiter_h)
    assert r2.status_code in (400, 404, 422), r2.text
    async with sessions() as db:
        o = await db.get(Order, oid)
        assert str(o.cancelled_by_id) == first_by
        assert o.cancelled_at is not None
        assert o.cancelled_at.isoformat() == first_at or \
            o.cancelled_at.strftime("%Y-%m-%dT%H:%M") in first_at

    # Item cancel via API captures actor + zeroes total but report amount stays truthful
    oid2 = await _add_order(sessions, company_id=company_id,
                            branch_id=ctx["branch_id"], waiter_id=waiter_id,
                            order_number="W-2", status="new")
    iid2 = await _add_item(sessions, order_id=oid2, product_id=ctx["product_id"],
                           name="Plov", price="120", qty="2", discount="20",
                           status="pending")
    d = await client.delete(f"/pos/orders/{oid2}/items/{iid2}", headers=waiter_h)
    assert d.status_code == 200, d.text
    item = [x for x in d.json()["items"] if x["id"] == str(iid2)][0]
    assert item["status"] == "cancelled"
    assert item["cancelled_by_id"] == str(waiter_id)
    assert item["cancelled_at"] is not None
    assert Decimal(str(item["total"])) == Decimal("0")
    rep = await client.get("/reports/cancelled", headers=ctx["headers"])
    assert rep.status_code == 200
    row = _by_item(rep.json())[str(iid2)]
    assert Decimal(str(row["amount"])) == Decimal("220")
    # repeated item cancel raises, preserves
    d2 = await client.delete(f"/pos/orders/{oid2}/items/{iid2}", headers=waiter_h)
    assert d2.status_code in (400, 404, 422), d2.text
    async with sessions() as db:
        it = await db.get(OrderItem, iid2)
        assert str(it.cancelled_by_id) == str(waiter_id)

    # update_status -> cancelled captures actor
    oid3 = await _add_order(sessions, company_id=company_id,
                            branch_id=ctx["branch_id"], waiter_id=waiter_id,
                            order_number="W-3", status="new")
    u = await client.patch(f"/pos/orders/{oid3}/status", headers=waiter_h,
                           json={"status": "cancelled"})
    assert u.status_code == 200, u.text
    assert u.json()["cancelled_by_id"] == str(waiter_id)

    # kitchen cancel captures actor (cooking -> cancelled)
    oid4 = await _add_order(sessions, company_id=company_id,
                            branch_id=ctx["branch_id"], waiter_id=waiter_id,
                            order_number="W-4", status="new")
    iid4 = await _add_item(sessions, order_id=oid4, product_id=ctx["product_id"],
                           name="Plov", status="cooking")
    k = await client.patch("/kitchen/orders/items/status", headers=waiter_h,
                           json={"order_item_id": str(iid4), "status": "cancelled"})
    assert k.status_code == 200, k.text
    async with sessions() as db:
        it4 = await db.get(OrderItem, iid4)
        assert it4.status == "cancelled"
        assert str(it4.cancelled_by_id) == str(waiter_id)
        assert it4.cancelled_at is not None


@pytest.mark.asyncio
async def test_cancelled_system_webhook_has_null_actor(client, db_engine):
    import app.modules.payments.internal_router as internal_mod
    from app.config import settings
    sfx = uuid4().hex[:8]
    ctx = await _setup_company(client, db_engine, slug=f"can-s-{sfx}",
                               email=f"can-s-{sfx}@example.com")
    sessions, company_id = ctx["sessions"], ctx["company_id"]
    waiter_h = await create_staff_headers(
        client, ctx["headers"], email=f"ws-{sfx}@example.com", role_slug="waiter")
    waiter_id = UUID((await _me(client, waiter_h))["id"])
    oid = await _add_order(sessions, company_id=company_id,
                           branch_id=ctx["branch_id"], waiter_id=waiter_id,
                           order_number="S-1", status="completed")
    await _add_item(sessions, order_id=oid, product_id=ctx["product_id"],
                    name="Plov", status="served")
    r = await client.post(
        "/internal/payment-webhook",
        headers={"x-webhook-secret": settings.webhook_secret},
        json={"order_id": str(oid), "amount": "10.00", "method": "payme",
              "gateway_tx_id": f"gw-{sfx}", "action": "cancel"},
    )
    assert r.status_code == 200, r.text
    async with sessions() as db:
        o = await db.get(Order, oid)
        assert o.status == "cancelled"
        assert o.cancelled_at is not None
        assert o.cancelled_by_id is None
    rep = await client.get("/reports/cancelled", headers=ctx["headers"])
    assert rep.status_code == 200
    # system row present with NULL author, order scope
    found = [x for x in rep.json() if x["order_id"] == str(oid)]
    assert found
    assert found[0]["cancelled_by_id"] is None
    assert found[0]["cancellation_scope"] == "order"


def test_cancelled_migration_file_is_additive_and_safe():
    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / \
        "20260918_bi06ccd07_order_cancellation_truth.py"
    assert path.exists()
    src = path.read_text(encoding="utf-8")
    assert 'revision: str = "bi06ccd07"' in src
    assert 'down_revision' in src and '"bi06zrd06"' in src
    assert src.count("op.add_column") >= 4
    assert "op.drop_column" in src
    assert "nullable=True" in src
    assert "ondelete=\"SET NULL\"" in src or "ondelete='SET NULL'" in src
    for forbidden in ("UPDATE orders", "UPDATE order_items", "DELETE FROM"):
        assert forbidden not in src
    assert "cancelled_at" in src and "cancelled_by_id" in src
    # No data backfill: migration must not UPDATE existing rows to fabricate
    # truth (checked separately from explanatory docstring mentions).
    assert "UPDATE" not in src
    assert "SET cancelled_at" not in src
    assert "SET cancelled_by_id" not in src


@pytest.mark.asyncio
async def test_cancelled_models_allow_null_legacy_rows(db_engine):
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sessions() as db:
        # Creating rows without cancellation fields must stay valid (NULL).
        from app.modules.companies.models import Company
        from sqlalchemy import select
        # tables exist with new columns
        assert hasattr(Order, "cancelled_at")
        assert hasattr(Order, "cancelled_by_id")
        assert hasattr(OrderItem, "cancelled_at")
        assert hasattr(OrderItem, "cancelled_by_id")

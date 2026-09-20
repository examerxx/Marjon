"""ORDERS-TRUTH-01 — order public_id, plain daily order_number, hall snapshot.

Exercises the canonical OrderService generation over the in-memory SQLite
fixture (single-connection, advisory lock stubbed to a no-op in conftest):
  * public_id — stable sequence-backed numeric id starting at 10000000, unique,
    never derived from the UUID; the UUID orders.id is unchanged.
  * order_number — plain "1","2","3"… per company + branch, resetting each
    company-local calendar day; branches number independently.
  * hall_name_snapshot — Hall.name frozen at order creation; a later rename or
    table/hall archival never changes it; NULL for tableless orders.
  * orders report additively exposes public_id + hall_name, one row per order.

Concurrency + the true PostgreSQL sequence/backstop are covered separately by
the Postgres-gated suite; here the single-connection engine proves the logic
and daily/branch/tenant boundaries deterministically.
"""
from __future__ import annotations

from datetime import date
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.admin_reports.service import AdminReportService
from app.modules.auth.models import User
from app.modules.companies.models import Branch
from app.modules.halls.models import Hall, Table
from app.modules.pos.models import Order
from app.modules.pos.schemas import OrderCreate
from app.modules.pos.service import OrderService
from tests.conftest import register_company


async def _me(client, headers):
    r = await client.get("/auth/me", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


async def _setup(client, db_engine, *, slug: str, email: str):
    headers, _ = await register_company(client, slug=slug, email=email)
    ident = await _me(client, headers)
    company_id = UUID(ident["company_id"])
    waiter_id = UUID(ident["id"])
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    branch_id = uuid4()
    async with sessions() as db:
        db.add(Branch(id=branch_id, company_id=company_id, name="Main"))
        await db.commit()
    return {
        "headers": headers, "company_id": company_id, "waiter_id": waiter_id,
        "sessions": sessions, "branch_id": branch_id,
    }


async def _add_branch(sessions, company_id, name="Second"):
    bid = uuid4()
    async with sessions() as db:
        db.add(Branch(id=bid, company_id=company_id, name=name))
        await db.commit()
    return bid


async def _add_table(sessions, company_id, branch_id, *, hall_name="Основной зал", number=5):
    hall_id, table_id = uuid4(), uuid4()
    async with sessions() as db:
        db.add(Hall(id=hall_id, company_id=company_id, branch_id=branch_id, name=hall_name))
        db.add(Table(id=table_id, hall_id=hall_id, number=number))
        await db.commit()
    return hall_id, table_id


async def _create(sessions, company_id, waiter_id, *, branch_id, on_date=None, **body):
    """Create an order through the real service, optionally pinning the
    company-local 'today' so daily-reset boundaries are deterministic."""
    body.setdefault("order_type", "dine_in")
    async with sessions() as db:
        service = OrderService(db)
        if on_date is not None:
            async def _fixed(_cid, _d=on_date):
                return _d
            service._company_local_today = _fixed  # type: ignore[assignment]
        order = await service.create(company_id, waiter_id, OrderCreate(branch_id=branch_id, **body))
        return order.id


async def _fetch(sessions, order_id) -> Order:
    async with sessions() as db:
        return await db.get(Order, order_id)


# ── public_id ────────────────────────────────────────────────────────────────


async def test_public_id_starts_at_10000000_and_increments(client, db_engine):
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    id1 = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"])
    id2 = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"])
    o1, o2 = await _fetch(ctx["sessions"], id1), await _fetch(ctx["sessions"], id2)
    assert o1.public_id == 10000000
    assert o2.public_id == 10000001


async def test_public_id_is_per_company_each_starts_at_10000000(client, db_engine):
    a = await _setup(client, db_engine, slug="alpha", email="o@alpha.example.com")
    b = await _setup(client, db_engine, slug="beta", email="o@beta.example.com")
    a1 = await _create(a["sessions"], a["company_id"], a["waiter_id"], branch_id=a["branch_id"])
    a2 = await _create(a["sessions"], a["company_id"], a["waiter_id"], branch_id=a["branch_id"])
    b1 = await _create(b["sessions"], b["company_id"], b["waiter_id"], branch_id=b["branch_id"])
    # Each company numbers independently from 10000000 — no shared global space.
    assert (await _fetch(a["sessions"], a1)).public_id == 10000000
    assert (await _fetch(a["sessions"], a2)).public_id == 10000001
    assert (await _fetch(b["sessions"], b1)).public_id == 10000000


async def test_public_id_unique_and_uuid_unchanged(client, db_engine):
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    ids = [
        await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"])
        for _ in range(3)
    ]
    orders = [await _fetch(ctx["sessions"], i) for i in ids]
    public_ids = [o.public_id for o in orders]
    assert len(set(public_ids)) == 3  # unique
    # The canonical id stays a UUID, distinct from the public numeric id.
    for o in orders:
        assert isinstance(o.id, UUID)
        assert str(o.public_id) != str(o.id)


# ── order_number: plain 1..N, per branch, daily reset ────────────────────────


async def test_first_order_in_branch_day_is_one_then_two(client, db_engine):
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    d = date(2026, 9, 20)
    id1 = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], on_date=d)
    id2 = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], on_date=d)
    assert (await _fetch(ctx["sessions"], id1)).order_number == "1"
    assert (await _fetch(ctx["sessions"], id2)).order_number == "2"


async def test_branches_number_independently(client, db_engine):
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    branch_b = await _add_branch(ctx["sessions"], ctx["company_id"])
    d = date(2026, 9, 20)
    a1 = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], on_date=d)
    a2 = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], on_date=d)
    b1 = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=branch_b, on_date=d)
    assert (await _fetch(ctx["sessions"], a1)).order_number == "1"
    assert (await _fetch(ctx["sessions"], a2)).order_number == "2"
    # Branch B's first order is "1" again, independent of branch A.
    assert (await _fetch(ctx["sessions"], b1)).order_number == "1"


async def test_next_calendar_day_resets_to_one(client, db_engine):
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    day1, day2 = date(2026, 9, 20), date(2026, 9, 21)
    a = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], on_date=day1)
    b = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], on_date=day1)
    c = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], on_date=day2)
    assert (await _fetch(ctx["sessions"], a)).order_number == "1"
    assert (await _fetch(ctx["sessions"], b)).order_number == "2"
    # New local day → back to "1"; the previous day's local_date is recorded.
    order_c = await _fetch(ctx["sessions"], c)
    assert order_c.order_number == "1"
    assert order_c.order_local_date == day2
    assert (await _fetch(ctx["sessions"], a)).order_local_date == day1


async def test_new_number_survives_a_deleted_earlier_order(client, db_engine):
    """Regression vs the old COUNT(*)+1 scheme: the durable counter must not
    reissue a number after an earlier order is removed."""
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    d = date(2026, 9, 20)
    a = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], on_date=d)
    await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], on_date=d)
    async with ctx["sessions"]() as db:
        await db.delete(await db.get(Order, a))
        await db.commit()
    c = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], on_date=d)
    # COUNT+1 would have re-handed "2" (one row left); the counter yields "3".
    assert (await _fetch(ctx["sessions"], c)).order_number == "3"


# ── place: hall_name_snapshot ────────────────────────────────────────────────


async def test_hall_snapshot_written_at_creation(client, db_engine):
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    _hall_id, table_id = await _add_table(ctx["sessions"], ctx["company_id"], ctx["branch_id"], hall_name="Терраса", number=12)
    oid = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], table_id=table_id)
    order = await _fetch(ctx["sessions"], oid)
    assert order.hall_name_snapshot == "Терраса"
    assert order.table_number == "12"


async def test_hall_rename_does_not_change_snapshot(client, db_engine):
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    hall_id, table_id = await _add_table(ctx["sessions"], ctx["company_id"], ctx["branch_id"], hall_name="Основной зал")
    oid = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], table_id=table_id)
    async with ctx["sessions"]() as db:  # rename the hall AFTER the order exists
        hall = await db.get(Hall, hall_id)
        hall.name = "VIP"
        await db.commit()
    # Historical snapshot is frozen — still the name at order time.
    assert (await _fetch(ctx["sessions"], oid)).hall_name_snapshot == "Основной зал"


async def test_table_archival_does_not_erase_snapshot(client, db_engine):
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    _hall_id, table_id = await _add_table(ctx["sessions"], ctx["company_id"], ctx["branch_id"], hall_name="Зал 1")
    oid = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], table_id=table_id)
    async with ctx["sessions"]() as db:  # archive (soft-delete) the table
        table = await db.get(Table, table_id)
        table.is_active = False
        await db.commit()
    assert (await _fetch(ctx["sessions"], oid)).hall_name_snapshot == "Зал 1"


async def test_tableless_order_has_null_hall_snapshot(client, db_engine):
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    oid = await _create(
        ctx["sessions"], ctx["company_id"], ctx["waiter_id"],
        branch_id=ctx["branch_id"], order_type="takeaway",
    )
    order = await _fetch(ctx["sessions"], oid)
    assert order.hall_name_snapshot is None
    assert order.table_id is None


async def test_update_to_new_table_restamps_snapshot(client, db_engine):
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    _h1, t1 = await _add_table(ctx["sessions"], ctx["company_id"], ctx["branch_id"], hall_name="Зал 1", number=1)
    _h2, t2 = await _add_table(ctx["sessions"], ctx["company_id"], ctx["branch_id"], hall_name="Зал 2", number=2)
    oid = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], table_id=t1)
    assert (await _fetch(ctx["sessions"], oid)).hall_name_snapshot == "Зал 1"
    from app.modules.pos.schemas import OrderUpdate
    async with ctx["sessions"]() as db:
        await OrderService(db).update_order(ctx["company_id"], oid, OrderUpdate(table_id=t2))
    # A → B: snapshot re-stamps to hall B.
    assert (await _fetch(ctx["sessions"], oid)).hall_name_snapshot == "Зал 2"


async def test_update_detach_table_clears_hall_snapshot(client, db_engine):
    """§4B: table → NULL clears hall_name_snapshot (the order has no hall now);
    the table_number snapshot follows its existing retain semantics."""
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    _h1, t1 = await _add_table(ctx["sessions"], ctx["company_id"], ctx["branch_id"], hall_name="Зал 1", number=1)
    oid = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], table_id=t1)
    assert (await _fetch(ctx["sessions"], oid)).hall_name_snapshot == "Зал 1"
    from app.modules.pos.schemas import OrderUpdate
    async with ctx["sessions"]() as db:
        await OrderService(db).update_order(ctx["company_id"], oid, OrderUpdate(table_id=None))
    order = await _fetch(ctx["sessions"], oid)
    assert order.hall_name_snapshot is None
    assert order.table_id is None
    # Existing canonical semantics: table_number snapshot is retained on detach.
    assert order.table_number == "1"


async def test_unrelated_update_preserves_hall_snapshot(client, db_engine):
    """§4C: an update that doesn't touch table_id must NOT re-read Hall.name —
    so a later hall rename can never leak into the frozen snapshot."""
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    hall_id, t1 = await _add_table(ctx["sessions"], ctx["company_id"], ctx["branch_id"], hall_name="Зал 1", number=1)
    oid = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], table_id=t1)
    # Rename the hall, THEN do an unrelated (persons_count) update.
    from app.modules.pos.schemas import OrderUpdate
    async with ctx["sessions"]() as db:
        (await db.get(Hall, hall_id)).name = "VIP"
        await db.commit()
    async with ctx["sessions"]() as db:
        await OrderService(db).update_order(ctx["company_id"], oid, OrderUpdate(persons_count=4))
    order = await _fetch(ctx["sessions"], oid)
    # Snapshot is still the original name — the unrelated update never re-stamped.
    assert order.hall_name_snapshot == "Зал 1"
    assert order.persons_count == 4


# ── report regression: additive public_id + hall_name, one row per order ─────


async def test_orders_report_exposes_public_id_and_hall_name(client, db_engine):
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    _hall_id, table_id = await _add_table(ctx["sessions"], ctx["company_id"], ctx["branch_id"], hall_name="Терраса", number=8)
    oid = await _create(ctx["sessions"], ctx["company_id"], ctx["waiter_id"], branch_id=ctx["branch_id"], table_id=table_id)
    async with ctx["sessions"]() as db:
        rows = await AdminReportService(db).orders_report(ctx["company_id"], None, None)
    assert len(rows) == 1  # one row = one order
    row = rows[0]
    assert row.order_id == oid
    assert row.public_id == 10000000
    assert row.hall_name == "Терраса"
    assert row.table_number == "8"
    # Existing contract fields still present/typed.
    assert row.order_number == "1"
    assert row.order_type == "dine_in"


async def test_orders_report_tenant_isolation(client, db_engine):
    a = await _setup(client, db_engine, slug="alpha", email="o@alpha.example.com")
    b = await _setup(client, db_engine, slug="beta", email="o@beta.example.com")
    await _create(a["sessions"], a["company_id"], a["waiter_id"], branch_id=a["branch_id"])
    await _create(b["sessions"], b["company_id"], b["waiter_id"], branch_id=b["branch_id"])
    async with a["sessions"]() as db:
        a_rows = await AdminReportService(db).orders_report(a["company_id"], None, None)
    # Company A sees only its own single order — no cross-company leakage.
    assert len(a_rows) == 1
    assert a_rows[0].public_id is not None


async def test_legacy_order_number_still_readable_in_report(client, db_engine):
    """Old YYYYMMDD-NNNN orders coexist with new plain numbers and stay readable
    (report treats order_number as opaque; substring search still matches)."""
    ctx = await _setup(client, db_engine, slug="acme", email="o@acme.example.com")
    legacy_id = uuid4()
    async with ctx["sessions"]() as db:
        db.add(Order(
            id=legacy_id, company_id=ctx["company_id"], branch_id=ctx["branch_id"],
            order_number="20260918-0007", order_type="dine_in", status="completed",
            table_number="7",
        ))
        await db.commit()
    async with ctx["sessions"]() as db:
        rows = await AdminReportService(db).orders_report(ctx["company_id"], None, None)
    numbers = {r.order_number for r in rows}
    assert "20260918-0007" in numbers

"""ANALYTICS-DATE-BOUNDARY-01 — /analytics/dashboard local-day boundaries.

`dashboard()` aggregates non-cancelled Orders over a HALF-OPEN
[day_start, day_end) window derived from the company's timezone:

  * explicit ?date=D → [D 00:00 local, D+1 00:00 local)
  * no date          → [today 00:00 local, current UTC instant)

The bug this file locks down: `day_end` for an explicit date is the NEXT local
midnight, so the previous inclusive `created_at <= day_end` counted an order
stamped exactly at D+1 00:00 local in BOTH D's and D+1's dashboard.

`created_at` is DateTime(timezone=True) → `timestamptz` on PostgreSQL, where the
comparison happens in the server's own instant arithmetic. SQLite stores the
value as text and compares lexicographically, so it cannot prove that an exact
next-local-midnight instant falls on the correct side of the bound — these cases
run only against a disposable TEST_DATABASE_URL database, per the project's
existing PostgreSQL test architecture. No canonical data is touched.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.infrastructure.database.session import get_db
from app.main import app
from app.modules.companies.models import Branch, Company
from app.modules.pos.models import Order
from app.modules.rbac.permissions import seed_permissions
from app.shared.base_model import Base
from tests.conftest import register_company

TZ = "Asia/Tashkent"  # +05:00, no DST — deterministic local midnights

def _control_url():
    raw = os.getenv("TEST_DATABASE_URL")
    if not raw:
        pytest.skip("TEST_DATABASE_URL is required for dashboard boundary PostgreSQL tests")
    url = make_url(raw)
    if url.get_backend_name() != "postgresql":
        pytest.skip("PostgreSQL is required for dashboard boundary tests")
    if not url.database or "test" not in url.database.lower():
        pytest.fail("TEST_DATABASE_URL must name an explicitly disposable test DB")
    return url


async def _connect(url):
    url = make_url(url)
    return await asyncpg.connect(
        user=url.username, password=url.password,
        host=url.host, port=url.port or 5432, database=url.database,
    )


@pytest.fixture(scope="module")
def dashboard_database_url():
    control = _control_url()
    name = f"marjon_dash_bound_{uuid4().hex[:10]}"

    async def _create():
        conn = await _connect(control)
        try:
            await conn.execute(f'CREATE DATABASE "{name}"')
        finally:
            await conn.close()
        return control.set(database=name).render_as_string(hide_password=False)

    async def _drop():
        conn = await _connect(control)
        try:
            await conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        finally:
            await conn.close()

    url = asyncio.run(_create())
    try:
        yield url
    finally:
        asyncio.run(_drop())


@pytest_asyncio.fixture
async def api(dashboard_database_url):
    """(client, engine) against a fresh schema in the disposable PG database."""
    engine = create_async_engine(
        dashboard_database_url, connect_args={"prepared_statement_cache_size": 0}
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        await seed_permissions(db)

    async def override_get_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test/api/v1"
    ) as client:
        yield client, engine
    app.dependency_overrides.clear()
    await engine.dispose()


async def _owner(client, engine, tz_name=TZ):
    """Register a disposable company + owner, pinned to a known timezone."""
    suffix = uuid4().hex[:8]
    headers, _ = await register_company(
        client, slug=f"dash-{suffix}", email=f"o-{suffix}@example.com"
    )
    company_id = UUID((await client.get("/auth/me", headers=headers)).json()["company_id"])
    sf = async_sessionmaker(engine, expire_on_commit=False)
    async with sf() as db:
        await db.execute(
            update(Company).where(Company.id == company_id).values(timezone=tz_name)
        )
        await db.commit()
    return headers, company_id


def _local(tz_name, y, m, d, h=0, mi=0, s=0, us=0):
    """A UTC instant expressed from a LOCAL wall clock in the company's tz."""
    return datetime(y, m, d, h, mi, s, us, tzinfo=ZoneInfo(tz_name)).astimezone(timezone.utc)


async def _seed_orders(engine, company_id, rows):
    """rows: iterable of (created_at_utc, status, total_amount)."""
    sf = async_sessionmaker(engine, expire_on_commit=False)
    async with sf() as db:
        branch = Branch(company_id=company_id, name="Main")
        db.add(branch)
        await db.flush()
        for i, (created, status, total) in enumerate(rows):
            db.add(Order(
                company_id=company_id, branch_id=branch.id,
                order_number=f"D-{uuid4().hex[:8]}-{i}", status=status,
                subtotal=Decimal(str(total)), total_amount=Decimal(str(total)),
                created_at=created, updated_at=created,
            ))
        await db.commit()


async def _dashboard(client, headers, **params):
    resp = await client.get("/analytics/dashboard", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _boundary_company(client, engine, tz_name=TZ):
    """D = 2026-08-31 local; the midnight order belongs to 2026-09-01 local."""
    headers, cid = await _owner(client, engine, tz_name)
    await _seed_orders(engine, cid, [
        (_local(tz_name, 2026, 8, 31, 0, 0, 0, 0), "completed", 100),          # A
        (_local(tz_name, 2026, 8, 31, 23, 59, 59, 999999), "completed", 200),  # B
        (_local(tz_name, 2026, 9, 1, 0, 0, 0, 0), "completed", 400),           # C
    ])
    return headers, cid


@pytest.mark.asyncio
async def test_explicit_date_includes_start_midnight_and_last_instant(api):
    client, engine = api
    headers, _ = await _boundary_company(client, engine)
    body = await _dashboard(client, headers, date="2026-08-31")
    # A (exactly 00:00:00 local) and B (last representable instant) only.
    assert body["today_orders"] == 2
    assert Decimal(body["today_revenue"]) == Decimal("300")
    assert Decimal(body["avg_check"]) == Decimal("150")


@pytest.mark.asyncio
async def test_explicit_date_excludes_next_local_midnight(api):
    client, engine = api
    headers, _ = await _boundary_company(client, engine)
    body = await _dashboard(client, headers, date="2026-08-31")
    # C is stamped exactly at 2026-09-01 00:00 local. Under the previous
    # `created_at <= day_end` it leaked into this dashboard (3 orders / 700).
    assert body["today_orders"] == 2
    assert Decimal(body["today_revenue"]) == Decimal("300")


@pytest.mark.asyncio
async def test_next_day_dashboard_owns_the_midnight_order_without_double_count(api):
    client, engine = api
    headers, _ = await _boundary_company(client, engine)
    day = await _dashboard(client, headers, date="2026-08-31")
    nxt = await _dashboard(client, headers, date="2026-09-01")
    assert nxt["today_orders"] == 1
    assert Decimal(nxt["today_revenue"]) == Decimal("400")
    # counted exactly once across the two adjacent days
    assert day["today_orders"] + nxt["today_orders"] == 3
    assert Decimal(day["today_revenue"]) + Decimal(nxt["today_revenue"]) == Decimal("700")


@pytest.mark.asyncio
async def test_explicit_date_keeps_status_and_tenant_scope(api):
    """Boundary-only change: cancelled stays excluded, other tenants invisible."""
    client, engine = api
    a_headers, a_cid = await _owner(client, engine)
    b_headers, b_cid = await _owner(client, engine)
    await _seed_orders(engine, a_cid, [
        (_local(TZ, 2026, 8, 31, 9, 0), "completed", 100),
        (_local(TZ, 2026, 8, 31, 10, 0), "new", 50),        # non-cancelled → counted
        (_local(TZ, 2026, 8, 31, 11, 0), "cancelled", 999),  # excluded
    ])
    await _seed_orders(engine, b_cid, [
        (_local(TZ, 2026, 8, 31, 9, 0), "completed", 777),
    ])
    a = await _dashboard(client, a_headers, date="2026-08-31")
    assert a["today_orders"] == 2
    assert Decimal(a["today_revenue"]) == Decimal("150")  # never B's 777
    b = await _dashboard(client, b_headers, date="2026-08-31")
    assert Decimal(b["today_revenue"]) == Decimal("777")
    # active_orders is deliberately window-independent (open tickets, any day)
    assert a["active_orders"] == 1


@pytest.mark.asyncio
async def test_local_day_longer_than_24h_uses_calendar_boundaries(api):
    """DST safety: 2026-11-01 in America/New_York is a 25-hour local day."""
    tz_name = "America/New_York"
    client, engine = api
    headers, cid = await _owner(client, engine, tz_name)
    late = _local(tz_name, 2026, 11, 1, 23, 30)
    assert late == datetime(2026, 11, 2, 4, 30, tzinfo=timezone.utc)
    assert late >= _local(tz_name, 2026, 11, 1) + timedelta(hours=24)  # past +24h
    await _seed_orders(engine, cid, [
        (late, "completed", 100),                            # still 11-01 local
        (_local(tz_name, 2026, 11, 2), "completed", 400),    # next local midnight
    ])
    day = await _dashboard(client, headers, date="2026-11-01")
    assert day["today_orders"] == 1 and Decimal(day["today_revenue"]) == Decimal("100")
    nxt = await _dashboard(client, headers, date="2026-11-02")
    assert nxt["today_orders"] == 1 and Decimal(nxt["today_revenue"]) == Decimal("400")


@pytest.mark.asyncio
async def test_default_no_date_covers_today_up_to_now_only(api):
    """No ?date= → [today 00:00 local, now). Future rows stay out; past rows in.

    `day_end` here is `datetime.now(timezone.utc)` evaluated per request, so it
    is strictly greater than any already-stored row: switching `<= now` to
    `< now` changes nothing observable. Only a row whose created_at equalled
    that instant to the microsecond would differ, and no such row can exist
    because the timestamp is read after the row was written.
    """
    client, engine = api
    headers, cid = await _owner(client, engine)
    now = datetime.now(timezone.utc)
    today_local = now.astimezone(ZoneInfo(TZ)).date()
    start_local = _local(TZ, today_local.year, today_local.month, today_local.day)
    await _seed_orders(engine, cid, [
        (start_local, "completed", 100),                 # today's local midnight
        (now - timedelta(minutes=5), "completed", 200),  # earlier today
        (now + timedelta(hours=2), "completed", 400),    # after "now" → excluded
        (start_local - timedelta(microseconds=1), "completed", 800),  # yesterday
    ])
    body = await _dashboard(client, headers)
    assert body["today_orders"] == 2
    assert Decimal(body["today_revenue"]) == Decimal("300")
    assert Decimal(body["avg_check"]) == Decimal("150")


@pytest.mark.asyncio
async def test_default_and_explicit_agree_for_a_fully_elapsed_day(api):
    """A past local day has no "not yet happened" part, so both modes match."""
    client, engine = api
    headers, cid = await _owner(client, engine)
    await _seed_orders(engine, cid, [
        (_local(TZ, 2026, 8, 31, 12, 0), "completed", 250),
    ])
    explicit = await _dashboard(client, headers, date="2026-08-31")
    assert explicit["today_orders"] == 1
    assert Decimal(explicit["today_revenue"]) == Decimal("250")
    # today's dashboard sees none of it (different local day)
    default = await _dashboard(client, headers)
    assert default["today_orders"] == 0
    assert Decimal(default["today_revenue"]) == Decimal("0")
    assert Decimal(default["avg_check"]) == Decimal("0")

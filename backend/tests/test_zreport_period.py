"""ZR-PERIOD-01 / 01C — truthful single-date vs period aggregation for
/analytics/z-report, with END-EXCLUSIVE local-day boundaries.

Fast SQLite coverage: the endpoint aggregates raw Order/Payment/FiscalReceipt
facts over a HALF-OPEN [day_start, day_end) window (single date = one local
day; period = date_from → date_to+1). Proves the period sums real facts across
the whole range (never the end date only), recomputes non-additive fields,
validates request modes, stays tenant-scoped, and — ZR-PERIOD-01C — that a fact
stamped at exactly the next local midnight belongs to the NEXT report only (no
double counting). Uses only disposable per-test companies — no canonical data.
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
from app.modules.fiscal.models import FiscalReceipt
from app.modules.payments.models import Payment
from app.modules.pos.models import Order
from app.modules.rbac.permissions import seed_permissions
from app.shared.base_model import Base
from tests.conftest import register_company


async def _owner(client, slug):
    headers, _ = await register_company(client, slug=slug, email=f"{slug}@example.com")
    company_id = UUID((await client.get("/auth/me", headers=headers)).json()["company_id"])
    return headers, company_id


def _dt(y, m, d):
    # midday UTC so a ±hours company tz keeps the fact on the intended calendar day
    return datetime(y, m, d, 12, 0, tzinfo=timezone.utc)


async def _seed(db_engine, company_id, *, orders):
    """orders: (created_at, status, total, [payment_method, payment_amount])."""
    sf = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sf() as db:
        branch = Branch(company_id=company_id, name="Main")
        db.add(branch)
        await db.flush()
        for i, row in enumerate(orders):
            created, status, total = row[0], row[1], row[2]
            order = Order(
                company_id=company_id, branch_id=branch.id,
                order_number=f"Z-{uuid4().hex[:8]}-{i}", status=status,
                subtotal=Decimal(str(total)), total_amount=Decimal(str(total)),
                created_at=created, updated_at=created,
            )
            db.add(order)
            await db.flush()
            if len(row) >= 5 and status == "completed":
                db.add(Payment(
                    company_id=company_id, order_id=order.id,
                    amount=Decimal(str(row[4])), method=row[3], status="completed",
                    created_at=created,
                ))
        await db.commit()


async def _z(client, headers, **params):
    resp = await client.get("/analytics/z-report", headers=headers, params=params)
    return resp


# ---------------------------------------------------------------------------
# ZR-PERIOD-01C — END-EXCLUSIVE boundary helpers
# ---------------------------------------------------------------------------

async def _set_company_tz(db_engine, company_id, tz_name):
    """Pin the company's business timezone (Company.timezone defaults to UTC)."""
    sf = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sf() as db:
        await db.execute(
            update(Company).where(Company.id == company_id).values(timezone=tz_name)
        )
        await db.commit()


def _local(tz_name, y, m, d, h=0, mi=0, s=0, us=0):
    """A UTC instant expressed from a LOCAL wall clock in the company's tz."""
    return datetime(y, m, d, h, mi, s, us, tzinfo=ZoneInfo(tz_name)).astimezone(timezone.utc)


async def _seed_every_fact_source(db_engine, company_id, instants):
    """At each instant, create one of EVERY Z-report fact source.

    instants: iterable of (created_at_utc, total_amount). Per instant:
      completed order, cancelled order, completed payment, refunded payment
      (7.00), sent fiscal receipt. Lets one assertion set prove that all five
      timestamp predicates share the same [start, end) window.
    """
    sf = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sf() as db:
        branch = Branch(company_id=company_id, name="Main")
        db.add(branch)
        await db.flush()
        for i, (created, total) in enumerate(instants):
            def _order(status, amount):
                return Order(
                    company_id=company_id, branch_id=branch.id,
                    order_number=f"B-{uuid4().hex[:8]}-{i}-{status[:4]}", status=status,
                    subtotal=Decimal(str(amount)), total_amount=Decimal(str(amount)),
                    created_at=created, updated_at=created,
                )

            done = _order("completed", total)
            db.add_all([done, _order("cancelled", 999)])
            await db.flush()
            paid = Payment(
                company_id=company_id, order_id=done.id, amount=Decimal(str(total)),
                method="cash", status="completed", created_at=created, updated_at=created,
            )
            refund = Payment(
                company_id=company_id, order_id=done.id, amount=Decimal("7.00"),
                method="cash", status="refunded", created_at=created, updated_at=created,
            )
            db.add_all([paid, refund])
            await db.flush()
            db.add(FiscalReceipt(
                company_id=company_id, order_id=done.id, payment_id=paid.id,
                status="sent", created_at=created, updated_at=created,
            ))
        await db.commit()


TZ = "Asia/Tashkent"  # +05:00, no DST — deterministic local midnights


async def _boundary_company(client, db_engine, slug, tz_name=TZ):
    headers, cid = await _owner(client, slug)
    await _set_company_tz(db_engine, cid, tz_name)
    # D = 2026-08-31 local; the midnight fact belongs to 2026-09-01 local.
    await _seed_every_fact_source(db_engine, cid, [
        (_local(tz_name, 2026, 8, 31, 0, 0, 0, 0), 100),          # A: exact start
        (_local(tz_name, 2026, 8, 31, 23, 59, 59, 999999), 200),  # B: last instant
        (_local(tz_name, 2026, 9, 1, 0, 0, 0, 0), 400),           # C: next midnight
    ])
    return headers, cid


def _sources(body):
    """The count/money aggregates driven by the five timestamp predicates."""
    return (
        body["orders_count"], body["net_sales"], body["cancelled_orders_count"],
        body["payments_count"], body["refunds_total"], body["fiscal_receipts_count"],
    )


async def test_start_midnight_included_last_instant_included_next_midnight_excluded(
    client, db_engine
):
    headers, _ = await _boundary_company(client, db_engine, "zbstart")
    body = (await _z(client, headers, date="2026-08-31")).json()
    # A + B only. C (exactly 2026-09-01 00:00 local) must NOT leak in — that was
    # the `created_at <= day_end` bug this phase corrects.
    assert _sources(body) == (2, "300.00", 2, 2, "14.00", 2)
    assert body["cash_total"] == "300.00"
    assert body["gross_sales"] == "300.00"
    assert body["avg_check"] == "150.00"


async def test_next_day_report_owns_the_midnight_fact_without_double_count(
    client, db_engine
):
    headers, _ = await _boundary_company(client, db_engine, "zbnext")
    day = (await _z(client, headers, date="2026-08-31")).json()
    nxt = (await _z(client, headers, date="2026-09-01")).json()
    # The midnight fact is counted exactly once — in the NEXT day's report.
    assert _sources(nxt) == (1, "400.00", 1, 1, "7.00", 1)
    assert day["orders_count"] + nxt["orders_count"] == 3
    assert Decimal(day["net_sales"]) + Decimal(nxt["net_sales"]) == Decimal("700.00")
    assert day["cancelled_orders_count"] + nxt["cancelled_orders_count"] == 3
    assert day["payments_count"] + nxt["payments_count"] == 3
    assert day["fiscal_receipts_count"] + nxt["fiscal_receipts_count"] == 3
    assert Decimal(day["refunds_total"]) + Decimal(nxt["refunds_total"]) == Decimal("21.00")


async def test_period_end_boundary_is_exclusive_and_next_period_owns_midnight(
    client, db_engine
):
    headers, cid = await _owner(client, "zbperiod")
    await _set_company_tz(db_engine, cid, TZ)
    await _seed_every_fact_source(db_engine, cid, [
        (_local(TZ, 2026, 8, 30, 0, 0, 0, 0), 100),          # from-day start
        (_local(TZ, 2026, 8, 31, 23, 59, 59, 999999), 200),  # to-day last instant
        (_local(TZ, 2026, 9, 1, 0, 0, 0, 0), 400),           # day AFTER to
    ])
    period = (await _z(
        client, headers, date_from="2026-08-30", date_to="2026-08-31"
    )).json()
    assert _sources(period) == (2, "300.00", 2, 2, "14.00", 2)

    after = (await _z(
        client, headers, date_from="2026-09-01", date_to="2026-09-01"
    )).json()
    assert _sources(after) == (1, "400.00", 1, 1, "7.00", 1)
    assert period["orders_count"] + after["orders_count"] == 3


async def test_one_day_period_equals_legacy_single_date_after_boundary_fix(
    client, db_engine
):
    headers, _ = await _boundary_company(client, db_engine, "zbequiv")
    legacy = (await _z(client, headers, date="2026-08-31")).json()
    period = (await _z(
        client, headers, date_from="2026-08-31", date_to="2026-08-31"
    )).json()
    ignored = {"date", "date_from", "date_to", "shift_opened_at"}
    assert {k: v for k, v in legacy.items() if k not in ignored} == \
           {k: v for k, v in period.items() if k not in ignored}
    assert period["date_from"] == "2026-08-31" and period["date_to"] == "2026-08-31"
    assert legacy["date_from"] is None and legacy["date_to"] is None


async def test_local_day_longer_than_24h_uses_calendar_boundaries_not_plus_24h(
    client, db_engine
):
    """DST safety: 2026-11-01 in America/New_York is a 25-hour local day.

    A naive `start + timedelta(hours=24)` window would end at 23:00 local and
    silently drop the 23:30 fact. The local-calendar conversion keeps it in.
    """
    tz_name = "America/New_York"
    headers, cid = await _owner(client, "zbdst")
    await _set_company_tz(db_engine, cid, tz_name)
    late = _local(tz_name, 2026, 11, 1, 23, 30)
    assert late == datetime(2026, 11, 2, 4, 30, tzinfo=timezone.utc)
    assert late >= _local(tz_name, 2026, 11, 1) + timedelta(hours=24)  # past +24h
    await _seed_every_fact_source(db_engine, cid, [
        (late, 100),                            # still 2026-11-01 local
        (_local(tz_name, 2026, 11, 2), 400),    # next local midnight → excluded
    ])
    body = (await _z(client, headers, date="2026-11-01")).json()
    assert _sources(body) == (1, "100.00", 1, 1, "7.00", 1)
    nxt = (await _z(client, headers, date="2026-11-02")).json()
    assert _sources(nxt) == (1, "400.00", 1, 1, "7.00", 1)


async def test_single_date_unchanged_and_has_no_period_metadata(client, db_engine):
    headers, cid = await _owner(client, "zsingle")
    await _seed(db_engine, cid, orders=[
        (_dt(2026, 8, 10), "completed", 100, "cash", 100),
        (_dt(2026, 8, 10), "completed", 200, "card", 200),
        (_dt(2026, 8, 11), "completed", 300, "cash", 300),
    ])
    resp = await _z(client, headers, date="2026-08-10")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["orders_count"] == 2
    assert body["net_sales"] == "300.00"
    assert body["date"] == "2026-08-10"
    assert body["date_from"] is None and body["date_to"] is None


async def test_period_sums_facts_across_all_days_not_just_end(client, db_engine):
    headers, cid = await _owner(client, "zperiod")
    await _seed(db_engine, cid, orders=[
        (_dt(2026, 8, 10), "completed", 100, "cash", 100),
        (_dt(2026, 8, 10), "completed", 200, "card", 200),
        (_dt(2026, 8, 11), "completed", 300, "cash", 300),
    ])
    resp = await _z(client, headers, date_from="2026-08-10", date_to="2026-08-11")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # 3 orders across BOTH days — never just the end date's 300
    assert body["orders_count"] == 3
    assert body["net_sales"] == "600.00"
    assert body["gross_sales"] == "600.00"
    # payment split aggregated across the range
    assert body["cash_total"] == "400.00"
    assert body["non_cash_total"] == "200.00"
    assert body["payments_count"] == 3
    # period metadata proves exactly what was covered
    assert body["date_from"] == "2026-08-10"
    assert body["date_to"] == "2026-08-11"
    assert body["date"] == "2026-08-11"


async def test_period_avg_check_is_recomputed_not_summed(client, db_engine):
    headers, cid = await _owner(client, "zavg")
    await _seed(db_engine, cid, orders=[
        (_dt(2026, 8, 10), "completed", 100, "cash", 100),
        (_dt(2026, 8, 11), "completed", 300, "cash", 300),
    ])
    resp = await _z(client, headers, date_from="2026-08-10", date_to="2026-08-11")
    body = resp.json()
    # 400 / 2 = 200 — NOT (100 + 300) day-averages summed (=400)
    assert body["avg_check"] == "200.00"


async def test_period_excludes_cancelled_from_sales_but_counts_them(client, db_engine):
    headers, cid = await _owner(client, "zcancel")
    await _seed(db_engine, cid, orders=[
        (_dt(2026, 8, 10), "completed", 100, "cash", 100),
        (_dt(2026, 8, 10), "cancelled", 999),
        (_dt(2026, 8, 11), "cancelled", 555),
    ])
    body = (await _z(client, headers, date_from="2026-08-10", date_to="2026-08-11")).json()
    assert body["orders_count"] == 1
    assert body["net_sales"] == "100.00"
    assert body["cancelled_orders_count"] == 2


async def test_period_boundaries_inclusive_start_and_end_day(client, db_engine):
    headers, cid = await _owner(client, "zbound")
    await _seed(db_engine, cid, orders=[
        (_dt(2026, 8, 9), "completed", 50, "cash", 50),    # day BEFORE from → excluded
        (_dt(2026, 8, 10), "completed", 100, "cash", 100),  # from → included
        (_dt(2026, 8, 12), "completed", 300, "cash", 300),  # to → included
        (_dt(2026, 8, 13), "completed", 70, "cash", 70),    # day AFTER to → excluded
    ])
    body = (await _z(client, headers, date_from="2026-08-10", date_to="2026-08-12")).json()
    assert body["orders_count"] == 2
    assert body["net_sales"] == "400.00"


async def test_period_tenant_isolation(client, db_engine):
    a_headers, a_cid = await _owner(client, "ztenanta")
    b_headers, b_cid = await _owner(client, "ztenantb")
    await _seed(db_engine, a_cid, orders=[(_dt(2026, 8, 10), "completed", 100, "cash", 100)])
    await _seed(db_engine, b_cid, orders=[(_dt(2026, 8, 10), "completed", 999, "cash", 999)])
    body = (await _z(client, a_headers, date_from="2026-08-10", date_to="2026-08-11")).json()
    assert body["orders_count"] == 1
    assert body["net_sales"] == "100.00"  # never B's 999


async def test_request_mode_validation(client, db_engine):
    headers, _ = await _owner(client, "zvalid")
    # both modes together
    assert (await _z(client, headers, date="2026-08-10", date_from="2026-08-10", date_to="2026-08-11")).status_code == 422
    # only one half of the range
    assert (await _z(client, headers, date_from="2026-08-10")).status_code == 422
    assert (await _z(client, headers, date_to="2026-08-11")).status_code == 422
    # inverted range
    assert (await _z(client, headers, date_from="2026-08-12", date_to="2026-08-10")).status_code == 422
    # over the 366-day guard
    assert (await _z(client, headers, date_from="2025-01-01", date_to="2026-12-31")).status_code == 422
    # neither mode
    assert (await _z(client, headers)).status_code == 422
    # a one-day period is valid (== single date)
    assert (await _z(client, headers, date_from="2026-08-10", date_to="2026-08-10")).status_code == 200


async def test_zreport_wire_contract_is_frozen(client, db_engine):
    """ZR-PRINT-01B extracted ZReportFigures for the detail endpoint. The general
    Z-report's JSON must be byte-identical: same keys, same ORDER, no nesting,
    and no detail parameter accepted here."""
    headers, cid = await _owner(client, "zwire")
    await _seed(db_engine, cid, orders=[(_dt(2026, 8, 10), "completed", 100, "cash", 100)])
    body = (await _z(client, headers, date="2026-08-10")).json()
    assert list(body.keys()) == [
        "date", "date_from", "date_to",
        "shift_opened_at", "shift_closed_at", "is_closed",
        "orders_count", "cancelled_orders_count", "payments_count",
        "fiscal_receipts_count",
        "gross_sales", "discounts_total", "service_fee_total", "tax_total",
        "refunds_total", "net_sales",
        "cash_total", "cash_received_total", "change_given_total",
        "non_cash_total", "avg_check", "payment_methods",
    ]
    # flat, not nested under a figures block
    assert "figures" not in body
    assert isinstance(body["payment_methods"], list)
    assert set(body["payment_methods"][0]) == {"method", "amount", "count"}
    # the whole-company stubs are unchanged, and never null-typed away
    assert body["shift_opened_at"] == "09:00" and body["is_closed"] is False
    # counts/money that the detail endpoint may report as null stay concrete here
    assert body["cancelled_orders_count"] == 0 and body["refunds_total"] == "0"
    # the general endpoint must NOT accept per-entity params
    ignored = await client.get(
        "/analytics/z-report", headers=headers,
        params=[("date", "2026-08-10"), ("dimension", "waiter"), ("ids", str(cid))],
    )
    assert ignored.status_code == 200, ignored.text
    assert ignored.json() == body



# ---------------------------------------------------------------------------
# ZR-PERIOD-01C — the same boundary contract on REAL PostgreSQL.
#
# `created_at` is DateTime(timezone=True) → `timestamptz` on PostgreSQL, where
# the >= / < comparison happens in the server's own instant arithmetic. SQLite
# stores the value as text and compares lexicographically, so it cannot prove
# that an exact next-local-midnight instant lands on the correct side of the
# bound. These cases run only against a disposable TEST_DATABASE_URL database.
# ---------------------------------------------------------------------------

def _pg_control_url():
    raw = os.getenv("TEST_DATABASE_URL")
    if not raw:
        pytest.skip("TEST_DATABASE_URL is required for Z-report boundary PostgreSQL tests")
    url = make_url(raw)
    if url.get_backend_name() != "postgresql":
        pytest.skip("PostgreSQL is required for Z-report boundary tests")
    if not url.database or "test" not in url.database.lower():
        pytest.fail("TEST_DATABASE_URL must name an explicitly disposable test DB")
    return url


async def _pg_connect(url):
    url = make_url(url)
    return await asyncpg.connect(
        user=url.username, password=url.password,
        host=url.host, port=url.port or 5432, database=url.database,
    )


@pytest.fixture(scope="module")
def zreport_database_url():
    control = _pg_control_url()
    name = f"marjon_zreport_bound_{uuid4().hex[:10]}"

    async def _create():
        conn = await _pg_connect(control)
        try:
            await conn.execute(f'CREATE DATABASE "{name}"')
        finally:
            await conn.close()
        return control.set(database=name).render_as_string(hide_password=False)

    async def _drop():
        conn = await _pg_connect(control)
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
async def pg_client(zreport_database_url):
    """(client, engine) against a fresh schema in the disposable PG database."""
    engine = create_async_engine(
        zreport_database_url, connect_args={"prepared_statement_cache_size": 0}
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


async def _pg_owner(client):
    suffix = uuid4().hex[:8]
    return await _owner(client, f"zpg-{suffix}")


@pytest.mark.asyncio
async def test_pg_midnight_fact_belongs_to_next_day_only(pg_client):
    client, engine = pg_client
    headers, cid = await _pg_owner(client)
    await _set_company_tz(engine, cid, TZ)
    await _seed_every_fact_source(engine, cid, [
        (_local(TZ, 2026, 8, 31, 0, 0, 0, 0), 100),
        (_local(TZ, 2026, 8, 31, 23, 59, 59, 999999), 200),
        (_local(TZ, 2026, 9, 1, 0, 0, 0, 0), 400),
    ])
    day = (await _z(client, headers, date="2026-08-31")).json()
    nxt = (await _z(client, headers, date="2026-09-01")).json()
    assert _sources(day) == (2, "300.00", 2, 2, "14.00", 2)   # C excluded
    assert _sources(nxt) == (1, "400.00", 1, 1, "7.00", 1)    # C counted once
    assert Decimal(day["net_sales"]) + Decimal(nxt["net_sales"]) == Decimal("700.00")


@pytest.mark.asyncio
async def test_pg_period_end_exclusive_and_one_day_equals_legacy(pg_client):
    client, engine = pg_client
    headers, cid = await _pg_owner(client)
    await _set_company_tz(engine, cid, TZ)
    await _seed_every_fact_source(engine, cid, [
        (_local(TZ, 2026, 8, 30, 0, 0, 0, 0), 100),
        (_local(TZ, 2026, 8, 31, 23, 59, 59, 999999), 200),
        (_local(TZ, 2026, 9, 1, 0, 0, 0, 0), 400),
    ])
    period = (await _z(client, headers, date_from="2026-08-30", date_to="2026-08-31")).json()
    assert _sources(period) == (2, "300.00", 2, 2, "14.00", 2)
    after = (await _z(client, headers, date_from="2026-09-01", date_to="2026-09-01")).json()
    assert _sources(after) == (1, "400.00", 1, 1, "7.00", 1)

    legacy = (await _z(client, headers, date="2026-09-01")).json()
    ignored = {"date", "date_from", "date_to", "shift_opened_at"}
    assert {k: v for k, v in legacy.items() if k not in ignored} == \
           {k: v for k, v in after.items() if k not in ignored}

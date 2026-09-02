"""ZR-PRINT-01B — per-entity Z-report detail: /analytics/z-report/detail.

Three dimensions, three different truths, all over the SAME half-open
company-timezone window as the whole-company Z-report:

  * cashier — an order belongs to a cashier when the COMPLETED payment that
    closed it carries that cashier_id. Gateway payments (cashier_id NULL) belong
    to no cashier. Cancelled orders and refunds are UNSUPPORTED (None), never 0.
  * waiter  — Order.waiter_id directly; payment/receipt figures mean "on this
    waiter's orders", not "personally taken by".
  * hall    — Order.table_id -> Table.hall_id only; table-less orders belong to
    no hall, so hall sections legitimately do not foot to the general report.

PostgreSQL only: created_at is timestamptz, the boundary instants and the
grouped aggregates must be compared in the server's own arithmetic, and the
DISTINCT-closure join that guarantees no order-total multiplication is a real
SQL property. Runs against a disposable TEST_DATABASE_URL database; no canonical
data is touched.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
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
from app.modules.halls.models import Hall, Table
from app.modules.payments.models import Payment
from app.modules.pos.models import Order
from app.modules.rbac.permissions import seed_permissions
from app.shared.base_model import Base
from tests.conftest import create_staff_headers, register_company

TZ = "Asia/Tashkent"  # +05:00, no DST — deterministic local midnights
DETAIL = "/analytics/z-report/detail"

def _control_url():
    raw = os.getenv("TEST_DATABASE_URL")
    if not raw:
        pytest.skip("TEST_DATABASE_URL is required for Z-report detail PostgreSQL tests")
    url = make_url(raw)
    if url.get_backend_name() != "postgresql":
        pytest.skip("PostgreSQL is required for Z-report detail tests")
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
def detail_database_url():
    control = _control_url()
    name = f"marjon_zrdetail_{uuid4().hex[:10]}"

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
async def api(detail_database_url):
    """(client, engine) against a fresh schema in the disposable PG database."""
    engine = create_async_engine(
        detail_database_url, connect_args={"prepared_statement_cache_size": 0}
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


def _local(y, m, d, h=12, mi=0, s=0, us=0, tz_name=TZ):
    """A UTC instant expressed from a LOCAL wall clock in the company's tz."""
    return datetime(y, m, d, h, mi, s, us, tzinfo=ZoneInfo(tz_name)).astimezone(timezone.utc)


async def _owner(client, engine, tz_name=TZ):
    suffix = uuid4().hex[:8]
    headers, _ = await register_company(
        client, slug=f"zrd-{suffix}", email=f"o-{suffix}@example.com"
    )
    company_id = UUID((await client.get("/auth/me", headers=headers)).json()["company_id"])
    sf = async_sessionmaker(engine, expire_on_commit=False)
    async with sf() as db:
        await db.execute(
            update(Company).where(Company.id == company_id).values(timezone=tz_name)
        )
        await db.commit()
    return headers, company_id


async def _staff(client, owner_headers, role_slug, *, name=None):
    """Create a real RBAC staff user, returning (id, name). Uses the canonical
    endpoint so role membership is genuine, not hand-inserted."""
    suffix = uuid4().hex[:8]
    payload = {
        "email": f"{role_slug}-{suffix}@example.com",
        "password": "Passw0rd!",
        "role_slug": role_slug,
    }
    if name:
        payload["role_name"] = name
    created = await client.post("/auth/users", headers=owner_headers, json=payload)
    assert created.status_code == 201, created.text
    body = created.json()
    return UUID(body["id"]), body.get("name") or body["email"]


async def _branch(engine, company_id):
    sf = async_sessionmaker(engine, expire_on_commit=False)
    async with sf() as db:
        branch = Branch(company_id=company_id, name="Main")
        db.add(branch)
        await db.commit()
        return branch.id


async def _hall_with_table(engine, company_id, branch_id, name, number, *, deleted=False):
    sf = async_sessionmaker(engine, expire_on_commit=False)
    async with sf() as db:
        hall = Hall(
            company_id=company_id, branch_id=branch_id, name=name,
            deleted_at=datetime.now(timezone.utc) if deleted else None,
        )
        db.add(hall)
        await db.flush()
        table = Table(hall_id=hall.id, number=number)
        db.add(table)
        await db.commit()
        return hall.id, table.id


async def _order(
    engine,
    company_id,
    branch_id,
    *,
    created,
    status="completed",
    waiter_id=None,
    table_id=None,
    subtotal="0",
    discount="0",
    service_fee="0",
    tax="0",
    total="0",
):
    """One Order with explicit money parts. total is the FINAL amount, which in
    production equals after_discount + tax + service_fee."""
    sf = async_sessionmaker(engine, expire_on_commit=False)
    async with sf() as db:
        order = Order(
            company_id=company_id, branch_id=branch_id,
            order_number=f"D-{uuid4().hex[:10]}", status=status,
            waiter_id=waiter_id, table_id=table_id,
            table_number=str(table_id)[:8] if table_id else None,
            subtotal=Decimal(subtotal), discount_amount=Decimal(discount),
            service_fee=Decimal(service_fee), tax_amount=Decimal(tax),
            total_amount=Decimal(total),
            created_at=created, updated_at=created,
        )
        db.add(order)
        await db.commit()
        return order.id


async def _payment(
    engine,
    company_id,
    order_id,
    *,
    created,
    cashier_id=None,
    method="cash",
    status="completed",
    amount="0",
    cash_received=None,
    change_given=None,
    receipt=False,
):
    sf = async_sessionmaker(engine, expire_on_commit=False)
    async with sf() as db:
        payment = Payment(
            company_id=company_id, order_id=order_id, amount=Decimal(amount),
            method=method, status=status, cashier_id=cashier_id,
            cash_received=Decimal(cash_received) if cash_received is not None else None,
            change_given=Decimal(change_given) if change_given is not None else None,
            created_at=created, updated_at=created,
        )
        db.add(payment)
        await db.flush()
        if receipt:
            db.add(FiscalReceipt(
                company_id=company_id, order_id=order_id, payment_id=payment.id,
                status="sent", created_at=created, updated_at=created,
            ))
        await db.commit()
        return payment.id


async def _detail(client, headers, *, dimension, ids, **params):
    query = [("dimension", dimension), *(("ids", str(i)) for i in ids)]
    query += [(k, v) for k, v in params.items()]
    return await client.get(DETAIL, headers=headers, params=query)


async def _ok(client, headers, *, dimension, ids, **params):
    resp = await _detail(client, headers, dimension=dimension, ids=ids, **params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _fig(body, index):
    return body["entities"][index]["figures"]


@pytest.mark.asyncio
async def test_cashier_sections_split_by_closing_payment(api):
    """Each cashier section contains only the orders that cashier actually closed."""
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    cashier_a, name_a = await _staff(client, headers, "cashier", name="Кассир А")
    cashier_b, _ = await _staff(client, headers, "cashier", name="Кассир Б")
    day = _local(2026, 8, 31)

    order_a = await _order(engine, cid, branch, created=day, subtotal="100", total="112")
    await _payment(engine, cid, order_a, created=day, cashier_id=cashier_a,
                   amount="112", cash_received="120", change_given="8", receipt=True)
    order_b = await _order(engine, cid, branch, created=day, subtotal="200", total="224")
    await _payment(engine, cid, order_b, created=day, cashier_id=cashier_b,
                   method="card", amount="224", receipt=True)

    body = await _ok(client, headers, dimension="cashier",
                     ids=[cashier_a, cashier_b], date="2026-08-31")
    assert body["dimension"] == "cashier"
    a, b = _fig(body, 0), _fig(body, 1)
    assert body["entities"][0]["entity_id"] == str(cashier_a)
    assert body["entities"][0]["entity_name"] == name_a
    assert (a["orders_count"], a["net_sales"], a["cash_total"], a["non_cash_total"]) == \
           (1, "112.00", "112.00", "0")
    assert (a["cash_received_total"], a["change_given_total"]) == ("120.00", "8.00")
    assert a["fiscal_receipts_count"] == 1 and a["payments_count"] == 1
    assert (b["orders_count"], b["net_sales"], b["cash_total"], b["non_cash_total"]) == \
           (1, "224.00", "0", "224.00")
    # union is authoritative, not a pooled average
    assert body["totals"]["orders_count"] == 2
    assert body["totals"]["net_sales"] == "336.00"
    assert body["totals"]["avg_check"] == "168.00"


@pytest.mark.asyncio
async def test_cashier_excludes_gateway_null_cashier_and_states_coverage(api):
    """A gateway payment (cashier_id NULL) belongs to no cashier section."""
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    cashier_a, _ = await _staff(client, headers, "cashier")
    day = _local(2026, 8, 31)

    order_a = await _order(engine, cid, branch, created=day, total="100")
    await _payment(engine, cid, order_a, created=day, cashier_id=cashier_a, amount="100")
    gateway_order = await _order(engine, cid, branch, created=day, total="900")
    await _payment(engine, cid, gateway_order, created=day, cashier_id=None,
                   method="payme", amount="900")

    body = await _ok(client, headers, dimension="cashier", ids=[cashier_a], date="2026-08-31")
    a = _fig(body, 0)
    assert a["orders_count"] == 1 and a["net_sales"] == "100.00"
    assert body["totals"]["net_sales"] == "100.00"   # 900 never attributed
    codes = {note["code"] for note in body["coverage"]}
    assert "CASHIER_UNATTRIBUTED_PAYMENTS_EXCLUDED" in codes
    assert all(note["message"] for note in body["coverage"])


@pytest.mark.asyncio
async def test_cashier_unsupported_fields_are_null_not_zero(api):
    """cancelled_orders_count / refunds_total cannot be attributed to a cashier."""
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    cashier_a, _ = await _staff(client, headers, "cashier")
    day = _local(2026, 8, 31)
    order_a = await _order(engine, cid, branch, created=day, total="100")
    await _payment(engine, cid, order_a, created=day, cashier_id=cashier_a, amount="100")
    cancelled = await _order(engine, cid, branch, created=day, status="cancelled", total="500")
    await _payment(engine, cid, cancelled, created=day, cashier_id=cashier_a,
                   status="refunded", amount="500")

    body = await _ok(client, headers, dimension="cashier", ids=[cashier_a], date="2026-08-31")
    assert set(body["unsupported_fields"]) == {"cancelled_orders_count", "refunds_total"}
    for figures in (_fig(body, 0), body["totals"]):
        assert figures["cancelled_orders_count"] is None
        assert figures["refunds_total"] is None
    codes = {note["code"] for note in body["coverage"]}
    assert {"CASHIER_CANCELLED_ORDERS_UNSUPPORTED", "CASHIER_REFUNDS_UNSUPPORTED"} <= codes


@pytest.mark.asyncio
async def test_waiter_and_cashier_attribution_are_independent(api):
    """Order taken by waiter A, closed by cashier B — each dimension is right."""
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    waiter_a, _ = await _staff(client, headers, "waiter", name="Официант А")
    cashier_b, _ = await _staff(client, headers, "cashier", name="Кассир Б")
    day = _local(2026, 8, 31)

    order = await _order(engine, cid, branch, created=day, waiter_id=waiter_a,
                         subtotal="500", total="560")
    await _payment(engine, cid, order, created=day, cashier_id=cashier_b, amount="560")

    waiter_body = await _ok(client, headers, dimension="waiter",
                            ids=[waiter_a], date="2026-08-31")
    cashier_body = await _ok(client, headers, dimension="cashier",
                             ids=[cashier_b], date="2026-08-31")
    assert _fig(waiter_body, 0)["net_sales"] == "560.00"
    assert _fig(cashier_body, 0)["net_sales"] == "560.00"
    # the waiter is NOT reachable as a cashier and vice versa
    empty_as_cashier = await _ok(client, headers, dimension="cashier",
                                 ids=[waiter_a], date="2026-08-31")
    assert _fig(empty_as_cashier, 0)["orders_count"] == 0
    empty_as_waiter = await _ok(client, headers, dimension="waiter",
                                ids=[cashier_b], date="2026-08-31")
    assert _fig(empty_as_waiter, 0)["orders_count"] == 0


@pytest.mark.asyncio
async def test_waiter_net_sales_is_final_amount_including_service_fee(api):
    """net_sales is the percentage base: Order.total_amount, service INCLUDED.

    Product contract (ZR-PRINT-01B §4.2/§20): "Сумма заказов" is the final order
    amount inclusive of service fee; "Сумма услуги" (service_fee_total) is a
    separate informational figure and is NOT the base. Money is chosen so every
    wrong candidate is a different number.
    """
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    waiter_a, _ = await _staff(client, headers, "waiter")
    day = _local(2026, 8, 31)
    # after_discount 175000; tax 10500; service 20500 -> final 206000
    await _order(engine, cid, branch, created=day, waiter_id=waiter_a,
                 subtotal="180000", discount="5000", tax="10500",
                 service_fee="20500", total="206000")

    figures = _fig(await _ok(client, headers, dimension="waiter",
                             ids=[waiter_a], date="2026-08-31"), 0)
    assert figures["net_sales"] == "206000.00"          # final, service included
    assert figures["service_fee_total"] == "20500.00"   # separate metric
    assert figures["gross_sales"] == "180000.00"        # subtotal, NOT the base
    assert figures["discounts_total"] == "5000.00"
    assert figures["tax_total"] == "10500.00"
    # explicit: the base is not the subtotal, not net-of-service, not the fee
    assert figures["net_sales"] != figures["gross_sales"]
    assert Decimal(figures["net_sales"]) - Decimal(figures["service_fee_total"]) == Decimal("185500")
    # backend must NOT compute the percentage itself
    assert "waiter_percent" not in figures and "waiter_percent" not in str(figures)


@pytest.mark.asyncio
async def test_hall_sections_exclude_tableless_orders(api):
    """Only orders genuinely linked to a Table/Hall belong to that hall."""
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    hall_a, table_a = await _hall_with_table(engine, cid, branch, "Зал А", 1)
    hall_b, table_b = await _hall_with_table(engine, cid, branch, "Зал Б", 2)
    day = _local(2026, 8, 31)

    await _order(engine, cid, branch, created=day, table_id=table_a, total="100")
    await _order(engine, cid, branch, created=day, table_id=table_b, total="200")
    # takeaway: no table at all — belongs to no hall
    await _order(engine, cid, branch, created=day, table_id=None, total="700")

    body = await _ok(client, headers, dimension="hall",
                     ids=[hall_a, hall_b], date="2026-08-31")
    assert [e["entity_name"] for e in body["entities"]] == ["Зал А", "Зал Б"]
    assert _fig(body, 0)["net_sales"] == "100.00"
    assert _fig(body, 1)["net_sales"] == "200.00"
    assert body["totals"]["net_sales"] == "300.00"   # 700 excluded, by design
    codes = {note["code"] for note in body["coverage"]}
    assert "HALL_TABLELESS_ORDERS_EXCLUDED" in codes


@pytest.mark.asyncio
async def test_archived_hall_history_remains_queryable_by_id(api):
    """An archived hall leaves the picker but keeps its business history."""
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    hall_id, table_id = await _hall_with_table(engine, cid, branch, "Архив", 7, deleted=True)
    day = _local(2026, 8, 31)
    await _order(engine, cid, branch, created=day, table_id=table_id, total="450")

    body = await _ok(client, headers, dimension="hall", ids=[hall_id], date="2026-08-31")
    entity = body["entities"][0]
    assert entity["entity_deleted"] is True
    assert _fig(body, 0)["net_sales"] == "450.00"
    # and it is hidden from the picker
    options = (await client.get(f"{DETAIL}/filters", headers=headers)).json()
    assert str(hall_id) not in [o["value"] for o in options["halls"]]


@pytest.mark.asyncio
async def test_deactivated_employee_history_remains_queryable_by_id(api):
    """Deactivating an employee must not erase their completed history."""
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    waiter_id, _ = await _staff(client, headers, "waiter", name="Уволенный")
    day = _local(2026, 8, 31)
    await _order(engine, cid, branch, created=day, waiter_id=waiter_id, total="333")

    deleted = await client.delete(f"/auth/users/{waiter_id}", headers=headers)
    assert deleted.status_code == 204, deleted.text

    body = await _ok(client, headers, dimension="waiter", ids=[waiter_id], date="2026-08-31")
    entity = body["entities"][0]
    assert entity["entity_is_active"] is False and entity["entity_deleted"] is False
    assert _fig(body, 0)["net_sales"] == "333.00"
    options = (await client.get(f"{DETAIL}/filters", headers=headers)).json()
    assert str(waiter_id) not in [o["value"] for o in options["waiters"]]


@pytest.mark.asyncio
async def test_requested_id_order_is_preserved_and_duplicates_deduped(api):
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    w1, _ = await _staff(client, headers, "waiter", name="Первый")
    w2, _ = await _staff(client, headers, "waiter", name="Второй")
    w3, _ = await _staff(client, headers, "waiter", name="Третий")
    day = _local(2026, 8, 31)
    for waiter, total in ((w1, "10"), (w2, "20"), (w3, "30")):
        await _order(engine, cid, branch, created=day, waiter_id=waiter, total=total)

    body = await _ok(client, headers, dimension="waiter",
                     ids=[w3, w1, w2], date="2026-08-31")
    assert [e["entity_id"] for e in body["entities"]] == [str(w3), str(w1), str(w2)]
    assert [e["figures"]["net_sales"] for e in body["entities"]] == \
           ["30.00", "10.00", "20.00"]

    duped = await _ok(client, headers, dimension="waiter",
                      ids=[w2, w2, w1, w2], date="2026-08-31")
    assert [e["entity_id"] for e in duped["entities"]] == [str(w2), str(w1)]
    assert duped["totals"]["orders_count"] == 2      # not 4


@pytest.mark.asyncio
async def test_union_avg_check_is_recomputed_not_averaged(api):
    """Chosen so averaging per-entity averages gives a different number."""
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    w1, _ = await _staff(client, headers, "waiter")
    w2, _ = await _staff(client, headers, "waiter")
    day = _local(2026, 8, 31)
    # A: 1 order of 300 (avg 300). B: 3 orders of 100 (avg 100).
    await _order(engine, cid, branch, created=day, waiter_id=w1, total="300")
    for _ in range(3):
        await _order(engine, cid, branch, created=day, waiter_id=w2, total="100")

    body = await _ok(client, headers, dimension="waiter", ids=[w1, w2], date="2026-08-31")
    assert _fig(body, 0)["avg_check"] == "300.00"
    assert _fig(body, 1)["avg_check"] == "100.00"
    # true union: 600 / 4 = 150 — NOT (300 + 100) / 2 = 200
    assert body["totals"]["orders_count"] == 4
    assert body["totals"]["net_sales"] == "600.00"
    assert Decimal(body["totals"]["avg_check"]) == Decimal("150")


@pytest.mark.asyncio
async def test_payment_methods_are_deduped_per_entity_and_in_union(api):
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    ca, _ = await _staff(client, headers, "cashier")
    cb, _ = await _staff(client, headers, "cashier")
    day = _local(2026, 8, 31)
    for cashier, method, amount in (
        (ca, "cash", "100"), (ca, "cash", "50"), (ca, "card", "200"),
        (cb, "card", "300"),
    ):
        order = await _order(engine, cid, branch, created=day, total=amount)
        await _payment(engine, cid, order, created=day, cashier_id=cashier,
                       method=method, amount=amount)

    body = await _ok(client, headers, dimension="cashier", ids=[ca, cb], date="2026-08-31")
    a_methods = {m["method"]: m for m in _fig(body, 0)["payment_methods"]}
    assert set(a_methods) == {"card", "cash"}
    assert (a_methods["cash"]["count"], a_methods["cash"]["amount"]) == (2, "150.00")
    assert (a_methods["card"]["count"], a_methods["card"]["amount"]) == (1, "200.00")
    assert _fig(body, 0)["cash_total"] == "150.00"
    assert _fig(body, 0)["non_cash_total"] == "200.00"

    union = body["totals"]["payment_methods"]
    assert [m["method"] for m in union] == ["card", "cash"]   # deterministic order
    by_method = {m["method"]: m for m in union}
    assert (by_method["card"]["count"], by_method["card"]["amount"]) == (2, "500.00")
    assert (by_method["cash"]["count"], by_method["cash"]["amount"]) == (2, "150.00")
    assert body["totals"]["payments_count"] == 4


@pytest.mark.asyncio
async def test_no_row_multiplication_from_joins(api):
    """Many items/receipts per order must not inflate order totals or counts.

    A second completed payment on one order is impossible through the API, but
    the DISTINCT-closure join must be robust to it anyway — otherwise a single
    order's total would be counted twice for the same cashier.
    """
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    cashier, _ = await _staff(client, headers, "cashier")
    day = _local(2026, 8, 31)
    order = await _order(engine, cid, branch, created=day, total="1000")
    await _payment(engine, cid, order, created=day, cashier_id=cashier,
                   amount="600", receipt=True)
    await _payment(engine, cid, order, created=day, cashier_id=cashier,
                   method="card", amount="400", receipt=True)

    figures = _fig(await _ok(client, headers, dimension="cashier",
                             ids=[cashier], date="2026-08-31"), 0)
    assert figures["orders_count"] == 1              # not 2
    assert figures["net_sales"] == "1000.00"         # not 2000
    assert figures["payments_count"] == 2            # both payments are real
    assert figures["fiscal_receipts_count"] == 2


@pytest.mark.asyncio
async def test_tenant_isolation_and_foreign_ids_are_404(api):
    client, engine = api
    a_headers, a_cid = await _owner(client, engine)
    b_headers, b_cid = await _owner(client, engine)
    a_branch = await _branch(engine, a_cid)
    b_branch = await _branch(engine, b_cid)
    a_waiter, _ = await _staff(client, a_headers, "waiter")
    b_waiter, _ = await _staff(client, b_headers, "waiter")
    b_cashier, _ = await _staff(client, b_headers, "cashier")
    b_hall, b_table = await _hall_with_table(engine, b_cid, b_branch, "Чужой", 1)
    day = _local(2026, 8, 31)
    await _order(engine, a_cid, a_branch, created=day, waiter_id=a_waiter, total="100")
    b_order = await _order(engine, b_cid, b_branch, created=day, waiter_id=b_waiter,
                           table_id=b_table, total="999")
    await _payment(engine, b_cid, b_order, created=day, cashier_id=b_cashier, amount="999")

    own = await _ok(client, a_headers, dimension="waiter", ids=[a_waiter], date="2026-08-31")
    assert _fig(own, 0)["net_sales"] == "100.00"     # never B's 999

    # foreign id of each type, and a nonexistent id → 404, no existence leak
    for dimension, foreign in (
        ("waiter", b_waiter), ("cashier", b_cashier), ("hall", b_hall),
        ("waiter", uuid4()), ("hall", uuid4()),
    ):
        resp = await _detail(client, a_headers, dimension=dimension,
                             ids=[foreign], date="2026-08-31")
        assert resp.status_code == 404, (dimension, resp.text)
        assert "999" not in resp.text and "Чужой" not in resp.text

    # all-or-nothing: one foreign id rejects the whole request
    mixed = await _detail(client, a_headers, dimension="waiter",
                          ids=[a_waiter, b_waiter], date="2026-08-31")
    assert mixed.status_code == 404, mixed.text

    # a ?company_id= query injection cannot re-scope the request
    injected = await _ok(client, a_headers, dimension="waiter", ids=[a_waiter],
                         date="2026-08-31", company_id=str(b_cid))
    assert _fig(injected, 0)["net_sales"] == "100.00"


@pytest.mark.asyncio
async def test_date_modes_match_the_general_zreport_contract(api):
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    waiter, _ = await _staff(client, headers, "waiter")
    await _order(engine, cid, branch, created=_local(2026, 8, 30), waiter_id=waiter, total="100")
    await _order(engine, cid, branch, created=_local(2026, 8, 31), waiter_id=waiter, total="200")

    single = await _ok(client, headers, dimension="waiter", ids=[waiter], date="2026-08-31")
    assert _fig(single, 0)["net_sales"] == "200.00"
    assert single["date"] == "2026-08-31"
    assert single["date_from"] is None and single["date_to"] is None

    period = await _ok(client, headers, dimension="waiter", ids=[waiter],
                       date_from="2026-08-30", date_to="2026-08-31")
    assert _fig(period, 0)["net_sales"] == "300.00"
    assert (period["date"], period["date_from"], period["date_to"]) == \
           ("2026-08-31", "2026-08-30", "2026-08-31")

    one_day = await _ok(client, headers, dimension="waiter", ids=[waiter],
                        date_from="2026-08-31", date_to="2026-08-31")
    assert _fig(one_day, 0) == _fig(single, 0)   # one-day period == ?date

    invalid = (
        {"date": "2026-08-31", "date_from": "2026-08-30", "date_to": "2026-08-31"},
        {"date_from": "2026-08-30"},
        {"date_to": "2026-08-31"},
        {"date_from": "2026-08-31", "date_to": "2026-08-30"},
        {"date_from": "2025-01-01", "date_to": "2026-12-31"},
        {},
    )
    for params in invalid:
        resp = await _detail(client, headers, dimension="waiter", ids=[waiter], **params)
        assert resp.status_code == 422, (params, resp.text)


@pytest.mark.asyncio
async def test_half_open_upper_boundary_and_company_timezone(api):
    """Next local midnight belongs to the NEXT report, in the company's tz."""
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    waiter, _ = await _staff(client, headers, "waiter")
    cashier, _ = await _staff(client, headers, "cashier")
    hall_id, table_id = await _hall_with_table(engine, cid, branch, "Зал", 1)

    for local_dt, total in (
        (_local(2026, 8, 31, 0, 0, 0, 0), "100"),            # exact start
        (_local(2026, 8, 31, 23, 59, 59, 999999), "200"),    # last instant
        (_local(2026, 9, 1, 0, 0, 0, 0), "400"),             # next midnight
    ):
        order = await _order(engine, cid, branch, created=local_dt, waiter_id=waiter,
                             table_id=table_id, total=total)
        await _payment(engine, cid, order, created=local_dt, cashier_id=cashier,
                       amount=total, receipt=True)

    for dimension, entity in (("waiter", waiter), ("cashier", cashier), ("hall", hall_id)):
        day = await _ok(client, headers, dimension=dimension, ids=[entity], date="2026-08-31")
        nxt = await _ok(client, headers, dimension=dimension, ids=[entity], date="2026-09-01")
        assert _fig(day, 0)["net_sales"] == "300.00", dimension
        assert _fig(nxt, 0)["net_sales"] == "400.00", dimension
        # counted exactly once across the two adjacent days
        assert _fig(day, 0)["orders_count"] + _fig(nxt, 0)["orders_count"] == 3, dimension
        assert _fig(day, 0)["payments_count"] + _fig(nxt, 0)["payments_count"] == 3, dimension
        assert _fig(day, 0)["fiscal_receipts_count"] + \
               _fig(nxt, 0)["fiscal_receipts_count"] == 3, dimension


@pytest.mark.asyncio
async def test_unknown_dimension_and_missing_ids_are_rejected(api):
    client, engine = api
    headers, cid = await _owner(client, engine)
    waiter, _ = await _staff(client, headers, "waiter")

    menu = await _detail(client, headers, dimension="menu", ids=[waiter], date="2026-08-31")
    assert menu.status_code == 422, menu.text          # menu deliberately absent
    no_ids = await client.get(DETAIL, headers=headers,
                              params={"dimension": "waiter", "date": "2026-08-31"})
    assert no_ids.status_code == 422, no_ids.text
    empty = await client.get(DETAIL, headers=headers,
                             params=[("dimension", "waiter"), ("ids", ""), ("date", "2026-08-31")])
    assert empty.status_code == 422, empty.text


@pytest.mark.asyncio
async def test_filters_list_current_entities_only_and_never_menu(api):
    client, engine = api
    headers, cid = await _owner(client, engine)
    branch = await _branch(engine, cid)
    cashier, cashier_name = await _staff(client, headers, "cashier", name="Кассир")
    waiter, waiter_name = await _staff(client, headers, "waiter", name="Официант")
    hall_id, _ = await _hall_with_table(engine, cid, branch, "Активный", 1)
    archived, _ = await _hall_with_table(engine, cid, branch, "Архив", 2, deleted=True)
    # another tenant's staff must never appear
    other_headers, _ = await _owner(client, engine)
    foreign_cashier, _ = await _staff(client, other_headers, "cashier", name="Чужой кассир")

    resp = await client.get(f"{DETAIL}/filters", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [(o["value"], o["label"]) for o in body["cashiers"]] == \
           [(str(cashier), cashier_name)]
    assert [(o["value"], o["label"]) for o in body["waiters"]] == \
           [(str(waiter), waiter_name)]
    assert [(o["value"], o["label"]) for o in body["halls"]] == [(str(hall_id), "Активный")]
    assert str(archived) not in resp.text and "Чужой кассир" not in resp.text
    assert body["menu_filter_supported"] is False
    assert "categories" not in body and "menu" not in body and "products" not in body


@pytest.mark.asyncio
async def test_detail_requires_owner_authorization(api):
    client, engine = api
    headers, cid = await _owner(client, engine)
    waiter, _ = await _staff(client, headers, "waiter")
    suffix = uuid4().hex[:8]
    cashier_headers = await create_staff_headers(
        client, headers, email=f"c-{suffix}@example.com", role_slug="cashier"
    )

    for path, params in (
        (DETAIL, {"dimension": "waiter", "ids": str(waiter), "date": "2026-08-31"}),
        (f"{DETAIL}/filters", {}),
    ):
        assert (await client.get(path, params=params)).status_code == 401
        forbidden = await client.get(path, headers=cashier_headers, params=params)
        assert forbidden.status_code == 403, forbidden.text

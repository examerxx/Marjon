from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.admin_reports.service import AdminReportService
from app.modules.companies.models import Branch
from app.modules.finance.models import PaymentType
from app.modules.halls.models import Hall, Table
from app.modules.payments.models import Payment
from app.modules.pos.models import Order
from tests.conftest import register_company
from tests.test_reports_tenant_scope_postgres import reports_api, reports_database_url


async def _create_staff(client, owner_headers, *, email: str, role_slug: str):
    response = await client.post(
        "/auth/users",
        headers=owner_headers,
        json={"email": email, "password": "Passw0rd!", "role_slug": role_slug},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_tables_report_maps_supported_read_only_filters(client, monkeypatch):
    headers, _ = await register_company(
        client,
        slug="table-filters",
        email="table-filters@example.com",
    )
    waiter_id = uuid4()
    cashier_id = uuid4()
    captured = {}

    async def fake_report(self, company_id, date_from, date_to, **filters):
        captured.update(
            {"company_id": company_id, "date_from": date_from, "date_to": date_to, **filters}
        )
        return []

    monkeypatch.setattr(AdminReportService, "tables_report", fake_report)
    response = await client.get(
        "/reports/tables",
        headers=headers,
        params={
            "date_from": "2026-08-01",
            "date_to": "2026-08-25",
            "table_number": "12A",
            "waiter_id": str(waiter_id),
            "payment_method": "cash",
            "cashier_id": str(cashier_id),
        },
    )

    assert response.status_code == 200, response.text
    assert captured["table_number"] == "12A"
    # Old scalar clients keep working: a single value arrives as a 1-item list.
    assert captured["waiter_id"] == [waiter_id]
    assert captured["payment_method"] == ["cash"]
    assert captured["cashier_id"] == [cashier_id]

    # New repeated params arrive as multi-item lists on the same names.
    repeated = await client.get(
        "/reports/tables",
        headers=headers,
        params=[
            ("date_from", "2026-08-01"),
            ("date_to", "2026-08-25"),
            ("waiter_id", str(waiter_id)),
            ("waiter_id", str(uuid4())),
            ("payment_method", "cash"),
            ("payment_method", "card"),
        ],
    )
    assert repeated.status_code == 200, repeated.text
    assert len(captured["waiter_id"]) == 2
    assert captured["payment_method"] == ["cash", "card"]


@pytest.mark.asyncio
async def test_tables_report_zero_orders_returns_empty_http_response(reports_api):
    client, sessions = reports_api
    suffix = uuid4().hex[:8]
    owner_headers, _ = await register_company(
        client,
        slug=f"tables-zero-{suffix}",
        email=f"tables-zero-{suffix}@example.com",
    )
    profile = await client.get("/auth/me", headers=owner_headers)
    assert profile.status_code == 200, profile.text
    company_id = UUID(profile.json()["company_id"])

    async with sessions() as db:
        order_count = await db.scalar(
            select(func.count()).select_from(Order).where(Order.company_id == company_id)
        )
    assert order_count == 0

    response = await client.get(
        "/reports/tables",
        headers=owner_headers,
        params={"date_from": "2026-08-01", "date_to": "2026-08-25"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == []


@pytest.mark.asyncio
async def test_tables_filters_are_tenant_safe_zero_history_and_do_not_multiply_rows(reports_api):
    client, sessions = reports_api
    suffix = uuid4().hex[:8]
    a_headers, _ = await register_company(
        client,
        slug=f"tables-a-{suffix}",
        email=f"tables-a-{suffix}@example.com",
    )
    b_headers, _ = await register_company(
        client,
        slug=f"tables-b-{suffix}",
        email=f"tables-b-{suffix}@example.com",
    )
    company_a = UUID((await client.get("/auth/me", headers=a_headers)).json()["company_id"])
    company_b = UUID((await client.get("/auth/me", headers=b_headers)).json()["company_id"])

    waiter_a = await _create_staff(
        client, a_headers, email=f"waiter-a-{suffix}@example.com", role_slug="waiter"
    )
    waiter_other = await _create_staff(
        client, a_headers, email=f"waiter-other-{suffix}@example.com", role_slug="waiter"
    )
    cashier_a = await _create_staff(
        client, a_headers, email=f"cashier-a-{suffix}@example.com", role_slug="cashier"
    )
    cashier_other = await _create_staff(
        client, a_headers, email=f"cashier-other-{suffix}@example.com", role_slug="cashier"
    )
    waiter_b = await _create_staff(
        client, b_headers, email=f"waiter-b-{suffix}@example.com", role_slug="waiter"
    )
    cashier_b = await _create_staff(
        client, b_headers, email=f"cashier-b-{suffix}@example.com", role_slug="cashier"
    )

    ids = {name: uuid4() for name in (
        "branch_a", "branch_b", "order_target", "order_same_table", "order_other", "order_b",
    )}
    async with sessions() as db:
        db.add_all([
            Branch(id=ids["branch_a"], company_id=company_a, name="Branch A"),
            Branch(id=ids["branch_b"], company_id=company_b, name="Branch B"),
            PaymentType(
                company_id=company_a, scope_kind="company", name="Tenant Cash",
                type="cash", sort=10, status=True,
            ),
            PaymentType(
                company_id=company_b, scope_kind="company", name="Foreign Secret Pay",
                type="foreign", sort=10, status=True,
            ),
            PaymentType(
                scope_kind="system", name="System Card", type="card", sort=20, status=True,
            ),
        ])
        await db.commit()

    metadata = await client.get("/reports/tables/filters", headers=a_headers)
    assert metadata.status_code == 200, metadata.text
    options = metadata.json()
    assert options["waiters"] == [
        {"value": waiter_a["id"], "label": waiter_a["email"]},
        {"value": waiter_other["id"], "label": waiter_other["email"]},
    ]
    assert options["cashiers"] == [
        {"value": cashier_a["id"], "label": cashier_a["email"]},
        {"value": cashier_other["id"], "label": cashier_other["email"]},
    ]
    assert options["payment_methods"] == [
        {"value": "cash", "label": "Tenant Cash"},
        {"value": "card", "label": "System Card"},
    ]
    assert options["places"] == []
    assert options["place_filter_supported"] is True
    assert waiter_b["id"] not in metadata.text
    assert cashier_b["id"] not in metadata.text
    assert "Foreign Secret" not in metadata.text

    async with sessions() as db:
        db.add_all([
            Order(
                id=ids["order_target"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=UUID(waiter_a["id"]), order_number="TARGET-1",
                order_type="dine_in", status="completed", table_number="12A",
                subtotal=Decimal("200"), total_amount=Decimal("200"),
                created_at=datetime(2026, 8, 10, 10, 0),
            ),
            Order(
                id=ids["order_same_table"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=UUID(waiter_other["id"]), order_number="TARGET-2",
                order_type="dine_in", status="completed", table_number="12A",
                subtotal=Decimal("50"), total_amount=Decimal("50"),
                created_at=datetime(2026, 8, 10, 12, 0),
            ),
            Order(
                id=ids["order_other"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=UUID(waiter_other["id"]), order_number="OTHER-1",
                order_type="dine_in", status="completed", table_number="7",
                subtotal=Decimal("75"), total_amount=Decimal("75"),
                created_at=datetime(2026, 8, 10, 14, 0),
            ),
            Order(
                id=ids["order_b"], company_id=company_b, branch_id=ids["branch_b"],
                waiter_id=UUID(waiter_b["id"]), order_number="FOREIGN-1",
                order_type="dine_in", status="completed", table_number="12A",
                subtotal=Decimal("900"), total_amount=Decimal("900"),
            ),
        ])
        await db.flush()
        db.add_all([
            Payment(
                company_id=company_a, order_id=ids["order_target"], amount=Decimal("100"),
                method="cash", status="completed", cashier_id=UUID(cashier_a["id"]),
            ),
            Payment(
                company_id=company_a, order_id=ids["order_target"], amount=Decimal("100"),
                method="cash", status="completed", cashier_id=UUID(cashier_a["id"]),
            ),
            Payment(
                company_id=company_a, order_id=ids["order_same_table"], amount=Decimal("50"),
                method="card", status="completed", cashier_id=UUID(cashier_other["id"]),
            ),
            Payment(
                company_id=company_b, order_id=ids["order_b"], amount=Decimal("900"),
                method="cash", status="completed", cashier_id=UUID(cashier_b["id"]),
            ),
        ])
        await db.commit()

    async def table_rows(**params):
        response = await client.get("/reports/tables", headers=a_headers, params=params)
        assert response.status_code == 200, response.text
        return response.json()

    unfiltered = await table_rows()
    # Legacy orders (table_number only, no canonical table_id) → canonical identity
    # fields are null but present (additive Phase 2 contract). The additive
    # `orders` summaries carry the same population in created_at order so Date
    # lines align 1:1 with Sum lines.
    assert [(r["table_number"], r["orders_count"], r["revenue"]) for r in unfiltered] == [
        ("12A", 2, "250.00"),
        ("7", 1, "75.00"),
    ]
    row_12a, row_7 = unfiltered
    for row in (row_12a, row_7):
        assert set(row) == {
            "table_number", "orders_count", "revenue", "avg_check",
            "table_id", "hall_id", "hall_name", "orders",
        }
    assert row_12a["avg_check"] == "125.00"
    assert [o["order_number"] for o in row_12a["orders"]] == ["TARGET-1", "TARGET-2"]
    assert [o["total_amount"] for o in row_12a["orders"]] == ["200.00", "50.00"]
    assert [o["order_id"] for o in row_12a["orders"]] == [
        str(ids["order_target"]), str(ids["order_same_table"]),
    ]
    assert row_12a["orders"][0]["created_at"].startswith("2026-08-10T10:00")
    assert row_12a["orders"][1]["created_at"].startswith("2026-08-10T12:00")
    assert [o["order_number"] for o in row_7["orders"]] == ["OTHER-1"]
    assert [row["table_number"] for row in await table_rows(table_number="12")] == ["12A"]
    assert (await table_rows(waiter_id=waiter_a["id"]))[0]["orders_count"] == 1
    assert (await table_rows(payment_method="cash"))[0]["orders_count"] == 1
    assert (await table_rows(cashier_id=cashier_a["id"]))[0]["orders_count"] == 1
    assert await table_rows(waiter_id=waiter_b["id"]) == []
    assert await table_rows(cashier_id=cashier_b["id"]) == []


@pytest.mark.asyncio
async def test_tables_phase1_order_summaries_filters_identity_and_completed_payments(
    client, db_engine
):
    """SQLite Phase 1 contract for the additive per-row order summaries.

    Proves: bare-array shape preserved; canonical (table_id) identity incl.
    same number across halls; legacy bucket summaries; created_at-ascending
    Date/Sum alignment; every filter honored identically by aggregates and
    summaries; completed-only payment/cashier semantics; completed-only
    population; tenant isolation.
    """
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    suffix = uuid4().hex[:8]
    a_headers, _ = await register_company(
        client, slug=f"tblsum-a-{suffix}", email=f"tblsum-a-{suffix}@example.com"
    )
    b_headers, _ = await register_company(
        client, slug=f"tblsum-b-{suffix}", email=f"tblsum-b-{suffix}@example.com"
    )
    company_a = UUID((await client.get("/auth/me", headers=a_headers)).json()["company_id"])
    company_b = UUID((await client.get("/auth/me", headers=b_headers)).json()["company_id"])

    waiter_a = await _create_staff(
        client, a_headers, email=f"tblsum-waiter-a-{suffix}@example.com", role_slug="waiter"
    )
    cashier_a = await _create_staff(
        client, a_headers, email=f"tblsum-cashier-a-{suffix}@example.com", role_slug="cashier"
    )
    kitchen_a = await _create_staff(
        client, a_headers, email=f"tblsum-kitchen-a-{suffix}@example.com", role_slug="kitchen"
    )

    ids = {name: uuid4() for name in (
        "branch_a", "branch_b", "zal", "bar", "t3_zal", "t3_bar",
        "o1", "o2", "o3_bar", "o_legacy", "o_new", "o_foreign",
    )}
    async with sessions() as db:
        db.add_all([
            Branch(id=ids["branch_a"], company_id=company_a, name="Branch A"),
            Branch(id=ids["branch_b"], company_id=company_b, name="Branch B"),
        ])
        await db.flush()
        db.add_all([
            Hall(id=ids["zal"], company_id=company_a, branch_id=ids["branch_a"],
                 name="Zal", is_active=True),
            Hall(id=ids["bar"], company_id=company_a, branch_id=ids["branch_a"],
                 name="Bar", is_active=True),
        ])
        await db.flush()
        db.add_all([
            Table(id=ids["t3_zal"], hall_id=ids["zal"], number=3, is_active=True),
            Table(id=ids["t3_bar"], hall_id=ids["bar"], number=3, is_active=True),
        ])
        await db.flush()
        db.add_all([
            Order(
                id=ids["o1"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=UUID(waiter_a["id"]), order_number="T3-EARLY",
                table_id=ids["t3_zal"], table_number="3",
                order_type="dine_in", status="completed",
                subtotal=Decimal("120"), total_amount=Decimal("120"),
                created_at=datetime(2026, 9, 9, 10, 35),
            ),
            Order(
                id=ids["o2"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=UUID(waiter_a["id"]), order_number="T3-LATE",
                table_id=ids["t3_zal"], table_number="3",
                order_type="dine_in", status="completed",
                subtotal=Decimal("85"), total_amount=Decimal("85"),
                created_at=datetime(2026, 9, 10, 14, 20),
            ),
            Order(
                id=ids["o3_bar"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=UUID(waiter_a["id"]), order_number="BAR-1",
                table_id=ids["t3_bar"], table_number="3",
                order_type="dine_in", status="completed",
                subtotal=Decimal("200"), total_amount=Decimal("200"),
                created_at=datetime(2026, 9, 10, 9, 0),
            ),
            # Legacy bucket: number but no canonical table_id.
            Order(
                id=ids["o_legacy"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=UUID(waiter_a["id"]), order_number="LEGACY-9",
                table_id=None, table_number="9",
                order_type="dine_in", status="completed",
                subtotal=Decimal("50"), total_amount=Decimal("50"),
                created_at=datetime(2026, 9, 10, 11, 0),
            ),
            # Non-completed order: must not appear anywhere.
            Order(
                id=ids["o_new"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=UUID(waiter_a["id"]), order_number="NEW-1",
                table_id=ids["t3_zal"], table_number="3",
                order_type="dine_in", status="new",
                subtotal=Decimal("999"), total_amount=Decimal("999"),
                created_at=datetime(2026, 9, 10, 15, 0),
            ),
            Order(
                id=ids["o_foreign"], company_id=company_b, branch_id=ids["branch_b"],
                order_number="FOREIGN-1",
                table_id=None, table_number="3",
                order_type="dine_in", status="completed",
                subtotal=Decimal("700"), total_amount=Decimal("700"),
                created_at=datetime(2026, 9, 10, 10, 0),
            ),
        ])
        await db.flush()
        db.add_all([
            Payment(
                company_id=company_a, order_id=ids["o1"], amount=Decimal("120"),
                method="cash", status="completed", cashier_id=UUID(cashier_a["id"]),
            ),
            Payment(
                company_id=company_a, order_id=ids["o2"], amount=Decimal("85"),
                method="cash", status="completed", cashier_id=UUID(cashier_a["id"]),
            ),
            Payment(
                company_id=company_a, order_id=ids["o3_bar"], amount=Decimal("200"),
                method="card", status="completed", cashier_id=UUID(cashier_a["id"]),
            ),
            # Pending payment: must NOT qualify its order for payment filters.
            Payment(
                company_id=company_a, order_id=ids["o_legacy"], amount=Decimal("50"),
                method="cash", status="pending", cashier_id=UUID(cashier_a["id"]),
            ),
        ])
        await db.commit()

    async def table_rows(headers, **params):
        response = await client.get("/reports/tables", headers=headers, params=params)
        assert response.status_code == 200, response.text
        body = response.json()
        assert isinstance(body, list), body
        return body

    rows = await table_rows(a_headers)
    assert len(rows) == 3, rows
    by_key = {(r["table_id"], r["table_number"]): r for r in rows}
    zal = by_key[(str(ids["t3_zal"]), "3")]
    bar = by_key[(str(ids["t3_bar"]), "3")]
    legacy = by_key[(None, "9")]
    # Same number in different halls stays two canonical rows.
    assert zal["hall_name"] == "Zal" and bar["hall_name"] == "Bar"
    assert zal["orders_count"] == 2 and zal["revenue"] == "205.00"
    assert bar["orders_count"] == 1 and bar["revenue"] == "200.00"
    assert legacy["hall_id"] is None and legacy["orders_count"] == 1
    # Non-completed and foreign orders never leak into aggregates.
    assert "999" not in str(rows) and "700" not in str(rows)
    # Legacy compatibility fields preserved.
    assert set(zal) == {
        "table_number", "orders_count", "revenue", "avg_check",
        "table_id", "hall_id", "hall_name", "orders",
    }
    # Date/Sum alignment: created_at ascending, 1:1 with totals.
    assert [o["order_number"] for o in zal["orders"]] == ["T3-EARLY", "T3-LATE"]
    assert [o["total_amount"] for o in zal["orders"]] == ["120.00", "85.00"]
    assert [o["order_id"] for o in zal["orders"]] == [str(ids["o1"]), str(ids["o2"])]
    assert zal["orders"][0]["created_at"].startswith("2026-09-09T10:35")
    assert zal["orders"][1]["created_at"].startswith("2026-09-10T14:20")
    assert [o["order_number"] for o in legacy["orders"]] == ["LEGACY-9"]
    # Modal fields ride the same summaries: stored type/status + live waiter.
    assert [o["order_type"] for o in zal["orders"]] == ["dine_in", "dine_in"]
    assert [o["status"] for o in zal["orders"]] == ["completed", "completed"]
    assert zal["orders"][0]["waiter_name"] == f"tblsum-waiter-a-{suffix}@example.com"

    # Summaries honor every filter exactly like the aggregates.
    cash_rows = await table_rows(a_headers, payment_method="cash")
    # o3_bar paid by card only, o_legacy only pending: cash leaves just zal.
    assert [(r["table_id"], r["table_number"]) for r in cash_rows] == [
        (str(ids["t3_zal"]), "3"),
    ]
    # o_legacy has only a PENDING cash payment: excluded by completed-only rule.
    assert all(r["table_number"] != "9" for r in cash_rows)
    zal_cash = cash_rows[0]
    assert zal_cash["orders_count"] == 2
    assert [o["order_number"] for o in zal_cash["orders"]] == ["T3-EARLY", "T3-LATE"]

    by_cashier = await table_rows(a_headers, cashier_id=cashier_a["id"])
    assert len(by_cashier) == 2, by_cashier  # zal (2 completed) + bar (1 completed)
    assert all(r["table_number"] == "3" for r in by_cashier)

    by_waiter = await table_rows(a_headers, waiter_id=waiter_a["id"])
    assert len(by_waiter) == 3, by_waiter

    # Ineligible author (unrelated role) matches nothing.
    assert await table_rows(a_headers, waiter_id=kitchen_a["id"]) == []

    # Hall filter keeps canonical rows and drops the legacy bucket.
    zal_only = await table_rows(a_headers, hall_id=str(ids["zal"]))
    assert len(zal_only) == 1 and zal_only[0]["table_id"] == str(ids["t3_zal"])
    assert [o["order_number"] for o in zal_only[0]["orders"]] == ["T3-EARLY", "T3-LATE"]

    # Date period constrains summaries and aggregates together.
    day2 = await table_rows(a_headers, date_from="2026-09-10", date_to="2026-09-10")
    zal_day2 = [r for r in day2 if r["table_id"] == str(ids["t3_zal"])][0]
    assert zal_day2["orders_count"] == 1 and zal_day2["revenue"] == "85.00"
    assert [o["order_number"] for o in zal_day2["orders"]] == ["T3-LATE"]
    assert await table_rows(a_headers, date_from="2026-09-11", date_to="2026-09-11") == []

    # Foreign tenant sees only its own history.
    foreign = await table_rows(b_headers)
    assert len(foreign) == 1 and foreign[0]["table_number"] == "3"
    assert [o["order_number"] for o in foreign[0]["orders"]] == ["FOREIGN-1"]


@pytest.mark.asyncio
async def test_tables_multi_select_or_within_and_across_dimensions(client, db_engine):
    """Multi-select truth for tables: OR within a dimension, AND across.

    Covers waiter/hall/cashier/payment lists, duplicates, foreign and
    malformed ids, completed-payment requirement under lists, and row
    orders[] honoring the exact same multi-filter population.
    """
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    suffix = uuid4().hex[:8]
    a_headers, _ = await register_company(
        client, slug=f"tblmulti-a-{suffix}", email=f"tblmulti-a-{suffix}@example.com"
    )
    company_a = UUID((await client.get("/auth/me", headers=a_headers)).json()["company_id"])
    w1 = UUID((await _create_staff(
        client, a_headers, email=f"tblmulti-w1-{suffix}@example.com", role_slug="waiter"
    ))["id"])
    w2 = UUID((await _create_staff(
        client, a_headers, email=f"tblmulti-w2-{suffix}@example.com", role_slug="waiter"
    ))["id"])
    c1 = UUID((await _create_staff(
        client, a_headers, email=f"tblmulti-c1-{suffix}@example.com", role_slug="cashier"
    ))["id"])
    c2 = UUID((await _create_staff(
        client, a_headers, email=f"tblmulti-c2-{suffix}@example.com", role_slug="cashier"
    ))["id"])

    ids = {name: uuid4() for name in (
        "branch", "h1", "h2", "ta", "tb", "oa1", "oa2", "ob1",
    )}
    async with sessions() as db:
        db.add(Branch(id=ids["branch"], company_id=company_a, name="Branch"))
        await db.flush()
        db.add_all([
            Hall(id=ids["h1"], company_id=company_a, branch_id=ids["branch"],
                 name="H1", is_active=True),
            Hall(id=ids["h2"], company_id=company_a, branch_id=ids["branch"],
                 name="H2", is_active=True),
        ])
        await db.flush()
        db.add_all([
            Table(id=ids["ta"], hall_id=ids["h1"], number=1, is_active=True),
            Table(id=ids["tb"], hall_id=ids["h2"], number=2, is_active=True),
        ])
        await db.flush()
        db.add_all([
            Order(
                id=ids["oa1"], company_id=company_a, branch_id=ids["branch"],
                waiter_id=w1, order_number="MA-1",
                table_id=ids["ta"], table_number="1",
                order_type="dine_in", status="completed",
                subtotal=Decimal("100"), total_amount=Decimal("100"),
                created_at=datetime(2026, 9, 9, 10, 0),
            ),
            Order(
                id=ids["oa2"], company_id=company_a, branch_id=ids["branch"],
                waiter_id=w2, order_number="MA-2",
                table_id=ids["ta"], table_number="1",
                order_type="dine_in", status="completed",
                subtotal=Decimal("50"), total_amount=Decimal("50"),
                created_at=datetime(2026, 9, 10, 11, 0),
            ),
            Order(
                id=ids["ob1"], company_id=company_a, branch_id=ids["branch"],
                waiter_id=w1, order_number="MB-1",
                table_id=ids["tb"], table_number="2",
                order_type="dine_in", status="completed",
                subtotal=Decimal("200"), total_amount=Decimal("200"),
                created_at=datetime(2026, 9, 10, 12, 0),
            ),
        ])
        await db.flush()
        db.add_all([
            Payment(company_id=company_a, order_id=ids["oa1"], amount=Decimal("100"),
                    method="cash", status="completed", cashier_id=c1),
            Payment(company_id=company_a, order_id=ids["oa2"], amount=Decimal("50"),
                    method="card", status="completed", cashier_id=c2),
            Payment(company_id=company_a, order_id=ids["ob1"], amount=Decimal("200"),
                    method="cash", status="completed", cashier_id=c1),
        ])
        await db.commit()

    async def table_rows(params=None, **kw):
        response = await client.get(
            "/reports/tables", headers=a_headers, params=params if params is not None else kw
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert isinstance(body, list), body
        return body

    def by_table(rows):
        return {(r["table_id"], r["table_number"]): r for r in rows}

    base = by_table(await table_rows())
    assert set(base) == {(str(ids["ta"]), "1"), (str(ids["tb"]), "2")}
    assert base[(str(ids["ta"]), "1")]["orders_count"] == 2

    # OR within each dimension.
    assert set(by_table(await table_rows(
        params=[("waiter_id", str(w1)), ("waiter_id", str(w2))],
    ))) == set(base)
    assert set(by_table(await table_rows(
        params=[("hall_id", str(ids["h1"])), ("hall_id", str(ids["h2"]))],
    ))) == set(base)
    assert set(by_table(await table_rows(
        params=[("cashier_id", str(c1)), ("cashier_id", str(c2))],
    ))) == set(base)
    assert set(by_table(await table_rows(
        params=[("payment_method", "cash"), ("payment_method", "card")],
    ))) == set(base)

    # Single picks narrow; duplicates collapse to the same set.
    assert set(by_table(await table_rows(params=[("waiter_id", str(w2))]))) == {
        (str(ids["ta"]), "1"),
    }
    dup = await table_rows(params=[("waiter_id", str(w1)), ("waiter_id", str(w1))])
    single = await table_rows(params=[("waiter_id", str(w1))])
    assert [o["order_number"] for r in dup for o in r["orders"]] == [
        o["order_number"] for r in single for o in r["orders"]
    ]

    # AND across dimensions + summaries honor the same population.
    combo = by_table(await table_rows(params=[
        ("waiter_id", str(w1)),
        ("hall_id", str(ids["h2"])),
        ("cashier_id", str(c1)),
        ("payment_method", "cash"),
    ]))
    assert set(combo) == {(str(ids["tb"]), "2")}
    assert [o["order_number"] for o in combo[(str(ids["tb"]), "2")]["orders"]] == ["MB-1"]

    # Foreign and malformed ids: no leak, scalar 422 contract kept.
    assert await table_rows(params=[("waiter_id", str(uuid4()))]) == []
    assert await table_rows(params=[("waiter_id", str(w1)), ("waiter_id", str(uuid4()))]) != []
    bad_hall = await client.get(
        "/reports/tables", headers=a_headers, params={"hall_id": str(uuid4())}
    )
    assert bad_hall.status_code == 404, bad_hall.text
    bad_uuid = await client.get(
        "/reports/tables", headers=a_headers, params={"waiter_id": "not-a-uuid"}
    )
    assert bad_uuid.status_code == 422, bad_uuid.text

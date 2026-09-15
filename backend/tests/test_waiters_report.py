from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.admin_reports.schemas import WaiterReportResponse, WaiterReportTotals
from app.modules.admin_reports.service import AdminReportService
from app.modules.companies.models import Branch
from app.modules.inventory.models import Product
from app.modules.pos.models import Order, OrderItem
from tests.conftest import register_company


async def _create_staff(client, headers, *, email: str, role: str, name: str):
    response = await client.post(
        "/auth/users",
        headers=headers,
        json={
            "email": email,
            "password": "Passw0rd!",
            "role_slug": role,
            "role_name": name,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _empty_report() -> WaiterReportResponse:
    return WaiterReportResponse(
        rows=[],
        totals=WaiterReportTotals(
            orders_count=0,
            orders_total=0,
            takeaway_delivery_total=0,
            service_total=0,
            waiter_service_total=0,
            dishes_count=0,
        ),
    )


@pytest.mark.asyncio
async def test_waiters_route_maps_filters_defaults_and_validates_percent(client, monkeypatch):
    headers, _ = await register_company(
        client, slug="waiters-map", email="waiters-map@example.com"
    )
    waiter_id = uuid4()
    captured = []

    async def fake_report(self, company_id, date_from, date_to, **filters):
        captured.append((company_id, date_from, date_to, filters))
        return _empty_report()

    monkeypatch.setattr(AdminReportService, "waiters_report", fake_report)

    response = await client.get(
        "/reports/waiters",
        headers=headers,
        params={
            "date_from": "2026-08-01",
            "date_to": "2026-08-31",
            "waiter_id": str(waiter_id),
            "service_percent": "12.5",
            "include_orders": "false",
            "include_takeaway_delivery": "true",
            "include_service": "true",
        },
    )
    assert response.status_code == 200, response.text
    _, date_from, date_to, filters = captured[-1]
    assert (date_from.isoformat(), date_to.isoformat()) == ("2026-08-01", "2026-08-31")
    assert filters == {
        "waiter_id": waiter_id,
        "service_percent": Decimal("12.5"),
        "include_orders": False,
        "include_takeaway_delivery": True,
        "include_service": True,
    }

    default_response = await client.get("/reports/waiters", headers=headers)
    assert default_response.status_code == 200
    assert captured[-1][3] == {
        "waiter_id": None,
        "service_percent": Decimal("1"),
        "include_orders": True,
        "include_takeaway_delivery": False,
        "include_service": False,
    }

    for invalid in ("-0.1", "100.1", "nan", "bad"):
        rejected = await client.get(
            "/reports/waiters", headers=headers, params={"service_percent": invalid}
        )
        assert rejected.status_code == 422, (invalid, rejected.text)


@pytest.mark.asyncio
async def test_waiters_report_aggregates_real_orders_without_double_counting(client, db_engine):
    suffix = uuid4().hex[:8]
    a_headers, _ = await register_company(
        client, slug=f"waiters-a-{suffix}", email=f"owner-a-{suffix}@example.com"
    )
    b_headers, _ = await register_company(
        client, slug=f"waiters-b-{suffix}", email=f"owner-b-{suffix}@example.com"
    )
    company_a = UUID((await client.get("/auth/me", headers=a_headers)).json()["company_id"])
    company_b = UUID((await client.get("/auth/me", headers=b_headers)).json()["company_id"])
    waiter_a = await _create_staff(
        client, a_headers, email=f"w1-{suffix}@example.com", role="waiter", name="Алишер"
    )
    waiter_a2 = await _create_staff(
        client, a_headers, email=f"w2-{suffix}@example.com", role="waiter", name="Эльёр"
    )
    cashier_a = await _create_staff(
        client, a_headers, email=f"c-{suffix}@example.com", role="cashier", name="Кассир"
    )
    waiter_b = await _create_staff(
        client, b_headers, email=f"wb-{suffix}@example.com", role="waiter", name="Секрет B"
    )

    ids = {name: uuid4() for name in (
        "branch_a", "branch_b", "plov", "tea", "foreign_product",
        "ordinary", "takeaway", "delivery", "qr", "cancelled", "old", "cashier", "foreign",
    )}
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sessions() as db:
        db.add_all([
            Branch(id=ids["branch_a"], company_id=company_a, name="A"),
            Branch(id=ids["branch_b"], company_id=company_b, name="B"),
            Product(id=ids["plov"], company_id=company_a, name="Плов", price=40, cost_price=20),
            Product(id=ids["tea"], company_id=company_a, name="Чай", price=20, cost_price=5),
            Product(id=ids["foreign_product"], company_id=company_b, name="Секрет", price=900, cost_price=1),
        ])
        await db.flush()

        def order(key, company, branch, waiter, number, kind, status, total, service, day=10):
            return Order(
                id=ids[key], company_id=company, branch_id=branch, waiter_id=UUID(waiter["id"]),
                order_number=number, order_type=kind, status=status,
                subtotal=Decimal(total) - Decimal(service), service_fee=Decimal(service),
                total_amount=Decimal(total), created_at=datetime(2026, 8 if day else 7, day or 31, 12, tzinfo=timezone.utc),
            )

        db.add_all([
            order("ordinary", company_a, ids["branch_a"], waiter_a, "A-1", "dine_in", "completed", "112", "12"),
            order("takeaway", company_a, ids["branch_a"], waiter_a, "A-2", "takeaway", "completed", "55", "5"),
            order("delivery", company_a, ids["branch_a"], waiter_a, "A-3", "delivery", "completed", "32", "2"),
            order("qr", company_a, ids["branch_a"], waiter_a2, "A-4", "qr", "completed", "20", "0"),
            order("cancelled", company_a, ids["branch_a"], waiter_a, "A-X", "dine_in", "cancelled", "999", "99"),
            order("old", company_a, ids["branch_a"], waiter_a, "A-OLD", "dine_in", "completed", "777", "77", day=0),
            order("cashier", company_a, ids["branch_a"], cashier_a, "A-C", "dine_in", "completed", "200", "20"),
            order("foreign", company_b, ids["branch_b"], waiter_b, "B-SECRET", "dine_in", "completed", "900", "90"),
        ])
        await db.flush()
        db.add_all([
            OrderItem(order_id=ids["ordinary"], product_id=ids["plov"], name="Плов", price=40, quantity=2, total=80, status="served"),
            OrderItem(order_id=ids["ordinary"], product_id=ids["tea"], name="Чай", price=20, quantity=1, total=20, status="served"),
            OrderItem(order_id=ids["takeaway"], product_id=ids["plov"], name="Плов", price=50, quantity=1, total=50, status="served"),
            OrderItem(order_id=ids["delivery"], product_id=ids["tea"], name="Чай отменён", price=10, quantity=3, total=30, status="cancelled"),
            OrderItem(order_id=ids["qr"], product_id=ids["tea"], name="Чай", price=20, quantity=1, total=20, status="served"),
            OrderItem(order_id=ids["cancelled"], product_id=ids["plov"], name="Отменённый плов", price=900, quantity=1, total=900, status="served"),
            OrderItem(order_id=ids["foreign"], product_id=ids["foreign_product"], name="Секрет", price=810, quantity=1, total=810, status="served"),
        ])
        await db.commit()

    params = {"date_from": "2026-08-01", "date_to": "2026-08-31"}
    response = await client.get("/reports/waiters", headers=a_headers, params=params)
    assert response.status_code == 200, response.text
    report = response.json()
    assert [row["name"] for row in report["rows"]] == ["Алишер", "Эльёр"]
    alisher = report["rows"][0]
    assert alisher | {} == {
        "waiter_id": waiter_a["id"],
        "name": "Алишер",
        "orders_count": 3,
        "orders_total": "100.00",
        "takeaway_delivery_total": "80.00",
        "service_total": "19.00",
        "waiter_service_total": "1.00",
        "dishes_count": "4.000",
        "dishes": [
            {"product_id": str(ids["plov"]), "name": "Плов", "quantity": "3.000", "amount": "130.00"},
            {"product_id": str(ids["tea"]), "name": "Чай", "quantity": "1.000", "amount": "20.00"},
        ],
    }
    assert report["totals"] == {
        "orders_count": 4,
        "orders_total": "120.00",
        "takeaway_delivery_total": "80.00",
        "service_total": "19.00",
        "waiter_service_total": "1.20",
        "dishes_count": "5.000",
    }
    assert "Секрет" not in response.text
    assert "A-OLD" not in response.text
    assert "Кассир" not in response.text

    selected = await client.get(
        "/reports/waiters",
        headers=a_headers,
        params={
            **params,
            "waiter_id": waiter_a["id"],
            "service_percent": "12.5",
            "include_orders": "true",
            "include_takeaway_delivery": "true",
            "include_service": "true",
        },
    )
    assert selected.status_code == 200, selected.text
    assert len(selected.json()["rows"]) == 1
    assert selected.json()["rows"][0]["waiter_service_total"] == "24.88"
    assert selected.json()["totals"]["waiter_service_total"] == "24.88"

    component_cases = [
        ({"include_orders": "true", "include_takeaway_delivery": "false", "include_service": "false"}, "100.00"),
        ({"include_orders": "false", "include_takeaway_delivery": "true", "include_service": "false"}, "80.00"),
        ({"include_orders": "false", "include_takeaway_delivery": "false", "include_service": "true"}, "19.00"),
    ]
    for toggles, expected in component_cases:
        result = await client.get(
            "/reports/waiters",
            headers=a_headers,
            params={**params, "waiter_id": waiter_a["id"], "service_percent": "100", **toggles},
        )
        assert result.status_code == 200, result.text
        assert result.json()["rows"][0]["waiter_service_total"] == expected

    zero = await client.get(
        "/reports/waiters",
        headers=a_headers,
        params={**params, "waiter_id": waiter_a["id"], "service_percent": "0"},
    )
    assert zero.json()["rows"][0]["waiter_service_total"] == "0.00"

    empty = await client.get(
        "/reports/waiters",
        headers=a_headers,
        params={"date_from": "2030-01-01", "date_to": "2030-01-31"},
    )
    assert empty.status_code == 200
    assert empty.json() == {
        "rows": [],
        "totals": {
            "orders_count": 0,
            "orders_total": "0.00",
            "takeaway_delivery_total": "0.00",
            "service_total": "0.00",
            "waiter_service_total": "0.00",
            "dishes_count": "0",
        },
    }

    foreign_filter = await client.get(
        "/reports/waiters", headers=a_headers, params={**params, "waiter_id": waiter_b["id"]}
    )
    assert foreign_filter.status_code == 200
    assert foreign_filter.json()["rows"] == []


@pytest.mark.asyncio
async def test_waiter_filter_options_use_active_company_waiter_roles_only(client):
    suffix = uuid4().hex[:8]
    a_headers, _ = await register_company(
        client, slug=f"waiter-filter-a-{suffix}", email=f"filter-a-{suffix}@example.com"
    )
    b_headers, _ = await register_company(
        client, slug=f"waiter-filter-b-{suffix}", email=f"filter-b-{suffix}@example.com"
    )
    waiter_a = await _create_staff(
        client, a_headers, email=f"wa-{suffix}@example.com", role="waiter", name="Официант A"
    )
    cashier_a = await _create_staff(
        client, a_headers, email=f"ca-{suffix}@example.com", role="cashier", name="Кассир A"
    )
    waiter_b = await _create_staff(
        client, b_headers, email=f"wb-{suffix}@example.com", role="waiter", name="Официант B"
    )
    inactive = await _create_staff(
        client, a_headers, email=f"wi-{suffix}@example.com", role="waiter", name="Неактивный"
    )
    deactivated = await client.delete(f"/auth/users/{inactive['id']}", headers=a_headers)
    assert deactivated.status_code == 204, deactivated.text

    response = await client.get("/reports/waiters/filters", headers=a_headers)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "waiters": [{"value": waiter_a["id"], "label": "Официант A"}]
    }
    assert cashier_a["id"] not in response.text
    assert waiter_b["id"] not in response.text
    assert inactive["id"] not in response.text


@pytest.mark.asyncio
async def test_waiters_report_requires_owner_auth(client):
    report = await client.get("/reports/waiters")
    filters = await client.get("/reports/waiters/filters")
    assert report.status_code in {401, 403}
    assert filters.status_code in {401, 403}

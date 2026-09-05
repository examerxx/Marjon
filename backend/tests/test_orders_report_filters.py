from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete

from app.modules.admin_reports.service import AdminReportService
from app.modules.companies.models import Branch
from app.modules.finance.models import PaymentType
from app.modules.inventory.models import Product
from app.modules.payments.models import Payment
from app.modules.pos.models import Order, OrderItem
from app.modules.rbac.models import UserRole
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
async def test_orders_report_maps_supported_read_only_filters(client, monkeypatch):
    headers, _ = await register_company(
        client,
        slug="order-filters",
        email="order-filters@example.com",
    )
    ids = {name: uuid4() for name in ("waiter", "cashier", "product")}
    captured = {}

    async def fake_report(self, company_id, date_from, date_to, **filters):
        captured.update(
            {"company_id": company_id, "date_from": date_from, "date_to": date_to, **filters}
        )
        return []

    monkeypatch.setattr(AdminReportService, "orders_report", fake_report)
    response = await client.get(
        "/reports/orders",
        headers=headers,
        params={
            "date_from": "2026-08-01",
            "date_to": "2026-08-25",
            "order_number": "A-42",
            "waiter_id": str(ids["waiter"]),
            "cashier_id": str(ids["cashier"]),
            "product_id": str(ids["product"]),
            "order_type": "dine_in",
            "order_status": "completed",
            "payment_method": "cash",
        },
    )

    assert response.status_code == 200, response.text
    assert captured["order_number"] == "A-42"
    # REPORT-04: the filter dimensions are repeated query params now, so ONE value
    # arrives as a one-item list. The wire form of a single-value request is
    # unchanged, which is why the deployed frontend keeps working untouched.
    assert captured["waiter_id"] == [ids["waiter"]]
    assert captured["cashier_id"] == [ids["cashier"]]
    assert captured["product_id"] == [ids["product"]]
    assert captured["order_type"] == ["dine_in"]
    assert captured["order_status"] == ["completed"]
    assert captured["payment_method"] == ["cash"]


@pytest.mark.asyncio
async def test_orders_report_maps_repeated_filter_values(client, monkeypatch):
    """REPORT-04: ?waiter_id=a&waiter_id=b reaches the service as a list, in order."""
    headers, _ = await register_company(
        client,
        slug="order-multi-map",
        email="order-multi-map@example.com",
    )
    waiters = [uuid4(), uuid4()]
    cashiers = [uuid4(), uuid4()]
    products = [uuid4(), uuid4(), uuid4()]
    captured = {}

    async def fake_report(self, company_id, date_from, date_to, **filters):
        captured.update(filters)
        return []

    monkeypatch.setattr(AdminReportService, "orders_report", fake_report)
    response = await client.get(
        "/reports/orders",
        headers=headers,
        params=[
            ("date_from", "2026-08-01"),
            ("date_to", "2026-08-25"),
            *[("waiter_id", str(v)) for v in waiters],
            *[("cashier_id", str(v)) for v in cashiers],
            *[("product_id", str(v)) for v in products],
            ("order_type", "dine_in"),
            ("order_type", "delivery"),
            ("order_status", "completed"),
            ("order_status", "ready"),
            ("payment_method", "cash"),
            ("payment_method", "card"),
        ],
    )

    assert response.status_code == 200, response.text
    assert captured["waiter_id"] == waiters
    assert captured["cashier_id"] == cashiers
    assert captured["product_id"] == products
    assert captured["order_type"] == ["dine_in", "delivery"]
    assert captured["order_status"] == ["completed", "ready"]
    assert captured["payment_method"] == ["cash", "card"]


@pytest.mark.asyncio
async def test_orders_report_rejects_overlong_filter_value(client):
    """The per-item length bound survives the widening to a list."""
    headers, _ = await register_company(
        client,
        slug="order-multi-bound",
        email="order-multi-bound@example.com",
    )
    response = await client.get(
        "/reports/orders",
        headers=headers,
        params={"order_type": "x" * 51},
    )
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_orders_filters_are_tenant_safe_and_do_not_duplicate_orders(reports_api):
    client, sessions = reports_api
    suffix = uuid4().hex[:8]
    a_headers, _ = await register_company(
        client,
        slug=f"orders-a-{suffix}",
        email=f"orders-a-{suffix}@example.com",
    )
    b_headers, _ = await register_company(
        client,
        slug=f"orders-b-{suffix}",
        email=f"orders-b-{suffix}@example.com",
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

    ids = {
        name: uuid4()
        for name in (
            "branch_a",
            "branch_b",
            "product_a",
            "product_other",
            "product_b",
            "order_target",
            "order_other",
            "order_malformed",
            "order_b",
        )
    }
    async with sessions() as db:
        db.add_all(
            [
                Branch(id=ids["branch_a"], company_id=company_a, name="Branch A"),
                Branch(id=ids["branch_b"], company_id=company_b, name="Branch B"),
                Product(
                    id=ids["product_a"], company_id=company_a, name="Target Dish",
                    price=Decimal("100"), is_active=True, is_available=True,
                ),
                Product(
                    id=ids["product_other"], company_id=company_a, name="Other Dish",
                    price=Decimal("50"), is_active=True, is_available=True,
                ),
                Product(
                    id=ids["product_b"], company_id=company_b, name="Foreign Secret Dish",
                    price=Decimal("900"), is_active=True, is_available=True,
                ),
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
            ]
        )
        await db.commit()

    metadata = await client.get("/reports/orders/filters", headers=a_headers)
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
    assert options["products"] == [
        {"value": str(ids["product_other"]), "label": "Other Dish"},
        {"value": str(ids["product_a"]), "label": "Target Dish"},
    ]
    assert [row["value"] for row in options["order_types"]] == [
        "dine_in", "takeaway", "delivery", "qr",
    ]
    assert [row["value"] for row in options["order_statuses"]] == [
        "new", "accepted", "cooking", "ready", "completed",
    ]
    assert options["payment_methods"] == [
        {"value": "cash", "label": "Tenant Cash"},
        {"value": "card", "label": "System Card"},
    ]
    assert waiter_b["id"] not in metadata.text
    assert cashier_b["id"] not in metadata.text
    assert "Foreign Secret" not in metadata.text

    async with sessions() as db:
        db.add_all(
            [
                Order(
                    id=ids["order_target"], company_id=company_a, branch_id=ids["branch_a"],
                    waiter_id=UUID(waiter_a["id"]), order_number="TARGET-42",
                    order_type="dine_in", status="completed",
                    subtotal=Decimal("200"), total_amount=Decimal("200"),
                ),
                Order(
                    id=ids["order_other"], company_id=company_a, branch_id=ids["branch_a"],
                    waiter_id=UUID(waiter_other["id"]), order_number="OTHER-7",
                    order_type="takeaway", status="ready",
                    subtotal=Decimal("50"), total_amount=Decimal("50"),
                ),
                Order(
                    id=ids["order_malformed"], company_id=company_a, branch_id=ids["branch_a"],
                    waiter_id=UUID(waiter_other["id"]), order_number="MALFORMED",
                    order_type="delivery", status="completed",
                    subtotal=Decimal("900"), total_amount=Decimal("900"),
                ),
                Order(
                    id=ids["order_b"], company_id=company_b, branch_id=ids["branch_b"],
                    waiter_id=UUID(waiter_b["id"]), order_number="FOREIGN-SECRET",
                    order_type="dine_in", status="completed",
                    subtotal=Decimal("900"), total_amount=Decimal("900"),
                ),
            ]
        )
        await db.flush()
        db.add_all(
            [
                OrderItem(
                    order_id=ids["order_target"], product_id=ids["product_a"],
                    name="Target Dish", price=Decimal("100"), quantity=Decimal("1"),
                    total=Decimal("100"),
                ),
                OrderItem(
                    order_id=ids["order_target"], product_id=ids["product_other"],
                    name="Second Dish", price=Decimal("100"), quantity=Decimal("1"),
                    total=Decimal("100"),
                ),
                OrderItem(
                    order_id=ids["order_other"], product_id=ids["product_other"],
                    name="Other Dish", price=Decimal("50"), quantity=Decimal("1"),
                    total=Decimal("50"),
                ),
                OrderItem(
                    order_id=ids["order_malformed"], product_id=ids["product_b"],
                    name="Malformed Foreign Dish", price=Decimal("900"), quantity=Decimal("1"),
                    total=Decimal("900"),
                ),
                OrderItem(
                    order_id=ids["order_b"], product_id=ids["product_b"],
                    name="Foreign Secret Dish", price=Decimal("900"), quantity=Decimal("1"),
                    total=Decimal("900"),
                ),
                Payment(
                    company_id=company_a, order_id=ids["order_target"],
                    amount=Decimal("100"), method="cash", status="completed",
                    cashier_id=UUID(cashier_a["id"]),
                ),
                Payment(
                    company_id=company_a, order_id=ids["order_target"],
                    amount=Decimal("100"), method="cash", status="completed",
                    cashier_id=UUID(cashier_a["id"]),
                ),
                Payment(
                    company_id=company_a, order_id=ids["order_other"],
                    amount=Decimal("50"), method="card", status="completed",
                    cashier_id=UUID(cashier_other["id"]),
                ),
                Payment(
                    company_id=company_b, order_id=ids["order_b"],
                    amount=Decimal("900"), method="cash", status="completed",
                    cashier_id=UUID(cashier_b["id"]),
                ),
            ]
        )
        await db.commit()

    async def order_numbers(**params):
        response = await client.get("/reports/orders", headers=a_headers, params=params)
        assert response.status_code == 200, response.text
        return response.json()

    unfiltered = await order_numbers()
    assert [row["order_number"] for row in unfiltered].count("TARGET-42") == 1
    assert {row["order_number"] for row in unfiltered} == {
        "TARGET-42", "OTHER-7", "MALFORMED",
    }
    assert next(row for row in unfiltered if row["order_number"] == "TARGET-42")["items_count"] == 2
    assert [row["order_number"] for row in await order_numbers(order_number="TARGET")] == ["TARGET-42"]
    assert [row["order_number"] for row in await order_numbers(waiter_id=waiter_a["id"])] == ["TARGET-42"]
    assert [row["order_number"] for row in await order_numbers(cashier_id=cashier_a["id"])] == ["TARGET-42"]
    assert [row["order_number"] for row in await order_numbers(product_id=str(ids["product_a"]))] == ["TARGET-42"]
    assert [row["order_number"] for row in await order_numbers(order_type="takeaway")] == ["OTHER-7"]
    assert [row["order_number"] for row in await order_numbers(order_status="ready")] == ["OTHER-7"]
    assert [row["order_number"] for row in await order_numbers(payment_method="cash")] == ["TARGET-42"]
    assert await order_numbers(product_id=str(ids["product_b"])) == []
    assert await order_numbers(waiter_id=waiter_b["id"]) == []
    assert await order_numbers(cashier_id=cashier_b["id"]) == []


@pytest.mark.asyncio
async def test_orders_report_multi_value_filters_are_or_within_and_across(reports_api):
    """REPORT-04 semantics, against a real database.

    Several values inside ONE dimension are OR/IN; different dimensions still
    combine with AND. The waiter role guard is row-correlated (it follows
    Order.waiter_id), and the cashier role guard follows the ACTUALLY attributed
    Payment.cashier_id — so revoking a role narrows the result without any
    selected id being dropped from the request.
    """
    client, sessions = reports_api
    suffix = uuid4().hex[:8]
    headers, _ = await register_company(
        client,
        slug=f"orders-multi-{suffix}",
        email=f"orders-multi-{suffix}@example.com",
    )
    company = UUID((await client.get("/auth/me", headers=headers)).json()["company_id"])

    waiters = [
        await _create_staff(client, headers, email=f"w{i}-{suffix}@example.com", role_slug="waiter")
        for i in range(1, 4)
    ]
    cashiers = [
        await _create_staff(client, headers, email=f"c{i}-{suffix}@example.com", role_slug="cashier")
        for i in range(1, 3)
    ]
    ids = {name: uuid4() for name in ("branch", "p1", "p2", "p3", "o1", "o2", "o3")}

    async with sessions() as db:
        db.add_all([
            Branch(id=ids["branch"], company_id=company, name=f"Branch {suffix}"),
            *[
                Product(
                    id=ids[key], company_id=company, name=f"Dish {key}",
                    price=Decimal("100"), is_active=True, is_available=True,
                )
                for key in ("p1", "p2", "p3")
            ],
            PaymentType(
                company_id=company, scope_kind="company", name="Cash",
                type="cash", sort=10, status=True,
            ),
            PaymentType(
                company_id=company, scope_kind="company", name="Card",
                type="card", sort=20, status=True,
            ),
        ])
        await db.commit()

    # Orders/items/payments go in after the reference rows are committed: payments
    # carry a composite (order_id, company_id) FK, so their order must already exist.
    async with sessions() as db:
        db.add_all([
            Order(
                id=ids["o1"], company_id=company, branch_id=ids["branch"],
                waiter_id=UUID(waiters[0]["id"]), order_number=f"M1-{suffix}",
                order_type="dine_in", status="completed",
                subtotal=Decimal("100"), total_amount=Decimal("100"),
            ),
            Order(
                id=ids["o2"], company_id=company, branch_id=ids["branch"],
                waiter_id=UUID(waiters[1]["id"]), order_number=f"M2-{suffix}",
                order_type="delivery", status="ready",
                subtotal=Decimal("100"), total_amount=Decimal("100"),
            ),
            Order(
                id=ids["o3"], company_id=company, branch_id=ids["branch"],
                waiter_id=UUID(waiters[2]["id"]), order_number=f"M3-{suffix}",
                order_type="takeaway", status="completed",
                subtotal=Decimal("100"), total_amount=Decimal("100"),
            ),
        ])
        await db.commit()

    async with sessions() as db:
        db.add_all([
            OrderItem(
                order_id=ids["o1"], product_id=ids["p1"], name="Dish p1",
                price=Decimal("100"), quantity=Decimal("1"), total=Decimal("100"),
            ),
            OrderItem(
                order_id=ids["o2"], product_id=ids["p2"], name="Dish p2",
                price=Decimal("100"), quantity=Decimal("1"), total=Decimal("100"),
            ),
            OrderItem(
                order_id=ids["o3"], product_id=ids["p3"], name="Dish p3",
                price=Decimal("100"), quantity=Decimal("1"), total=Decimal("100"),
            ),
            Payment(
                company_id=company, order_id=ids["o1"], amount=Decimal("100"),
                method="cash", status="completed", cashier_id=UUID(cashiers[0]["id"]),
            ),
            Payment(
                company_id=company, order_id=ids["o2"], amount=Decimal("100"),
                method="card", status="completed", cashier_id=UUID(cashiers[1]["id"]),
            ),
            Payment(
                company_id=company, order_id=ids["o3"], amount=Decimal("100"),
                method="cash", status="completed", cashier_id=UUID(cashiers[0]["id"]),
            ),
        ])
        await db.commit()

    async def numbers(params):
        response = await client.get("/reports/orders", headers=headers, params=params)
        assert response.status_code == 200, response.text
        return sorted(row["order_number"] for row in response.json())

    m1, m2, m3 = (f"M1-{suffix}", f"M2-{suffix}", f"M3-{suffix}")

    # OR within one dimension
    assert await numbers([("waiter_id", waiters[0]["id"]), ("waiter_id", waiters[1]["id"])]) == sorted([m1, m2])
    assert await numbers([("cashier_id", cashiers[0]["id"]), ("cashier_id", cashiers[1]["id"])]) == sorted([m1, m2, m3])
    assert await numbers([("product_id", str(ids["p1"])), ("product_id", str(ids["p3"]))]) == sorted([m1, m3])
    assert await numbers([("order_type", "dine_in"), ("order_type", "delivery")]) == sorted([m1, m2])
    assert await numbers([("order_status", "completed"), ("order_status", "ready")]) == sorted([m1, m2, m3])
    assert await numbers([("payment_method", "cash"), ("payment_method", "card")]) == sorted([m1, m2, m3])

    # a single value still behaves exactly as before
    assert await numbers([("waiter_id", waiters[2]["id"])]) == [m3]
    assert await numbers([("order_type", "takeaway")]) == [m3]

    # AND across dimensions
    assert await numbers([
        ("waiter_id", waiters[0]["id"]), ("waiter_id", waiters[1]["id"]),
        ("order_type", "dine_in"), ("order_type", "delivery"),
        ("order_status", "completed"),
    ]) == [m1]
    assert await numbers([
        ("waiter_id", waiters[0]["id"]), ("waiter_id", waiters[1]["id"]),
        ("payment_method", "card"),
    ]) == [m2]

    # row-correlated waiter guard: revoking waiter2's role removes ITS order only,
    # while waiter2's id stays in the request.
    async with sessions() as db:
        await db.execute(
            delete(UserRole).where(UserRole.user_id == UUID(waiters[1]["id"]))
        )
        await db.commit()
    assert await numbers([("waiter_id", waiters[0]["id"]), ("waiter_id", waiters[1]["id"])]) == [m1]

    # cashier guard follows the attributed payment's cashier.
    async with sessions() as db:
        await db.execute(
            delete(UserRole).where(UserRole.user_id == UUID(cashiers[1]["id"]))
        )
        await db.commit()
    assert await numbers([("cashier_id", cashiers[0]["id"]), ("cashier_id", cashiers[1]["id"])]) == sorted([m1, m3])

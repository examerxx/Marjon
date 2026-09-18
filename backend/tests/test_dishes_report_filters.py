from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.admin_reports.schemas import DishReportFiltersResponse, ReportFilterOption
from app.modules.admin_reports.service import AdminReportService
from app.modules.auth.models import User
from app.modules.companies.models import Branch
from app.modules.finance.models import PaymentType
from app.modules.inventory.models import Category, Product
from app.modules.payments.models import Payment
from app.modules.pos.models import Order, OrderItem
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
async def test_dishes_report_maps_supported_read_only_filters(client, monkeypatch):
    headers, _ = await register_company(client, slug="dish-filters", email="dish-filters@example.com")
    ids = {name: uuid4() for name in ("author", "product", "category")}
    captured = {}

    async def fake_report(self, company_id, date_from, date_to, **filters):
        captured.update({"company_id": company_id, "date_from": date_from, "date_to": date_to, **filters})
        return {"rows": [], "totals": {"quantity": "0", "amount": "0"}}

    monkeypatch.setattr(AdminReportService, "dishes_report", fake_report)
    response = await client.get(
        "/reports/dishes",
        headers=headers,
        params={
            "date_from": "2026-08-01",
            "date_to": "2026-08-25",
            "query": "Плов",
            "author_id": str(ids["author"]),
            "product_id": str(ids["product"]),
            "order_type": "dine_in",
            "order_status": "completed",
            "category_id": str(ids["category"]),
            "payment_method": "cash",
        },
    )

    assert response.status_code == 200
    assert captured["search"] == "Плов"
    # Old scalar clients keep working: a single value arrives as a 1-item list.
    assert captured["author_id"] == [ids["author"]]
    assert captured["product_id"] == [ids["product"]]
    assert captured["order_type"] == ["dine_in"]
    assert captured["order_status"] == ["completed"]
    assert captured["category_id"] == [ids["category"]]
    assert captured["payment_method"] == ["cash"]

    # New repeated params arrive as multi-item lists on the same names.
    repeated = await client.get(
        "/reports/dishes",
        headers=headers,
        params=[
            ("date_from", "2026-08-01"),
            ("date_to", "2026-08-25"),
            ("author_id", str(ids["author"])),
            ("author_id", str(uuid4())),
            ("order_type", "dine_in"),
            ("order_type", "delivery"),
        ],
    )
    assert repeated.status_code == 200, repeated.text
    assert len(captured["author_id"]) == 2
    assert captured["order_type"] == ["dine_in", "delivery"]

@pytest.mark.asyncio
async def test_dishes_filter_metadata_reports_unsupported_cook_dimension(client, monkeypatch):
    headers, _ = await register_company(client, slug="dish-options", email="dish-options@example.com")

    async def fake_filters(self, company_id):
        return DishReportFiltersResponse(
            authors=[ReportFilterOption(value=str(uuid4()), label="Автор")],
            cooks=[],
            products=[],
            categories=[],
            order_types=[ReportFilterOption(value="dine_in", label="На месте")],
            order_statuses=[ReportFilterOption(value="completed", label="Завершён")],
            payment_methods=[ReportFilterOption(value="cash", label="Наличные")],
            cook_filter_supported=False,
        )

    monkeypatch.setattr(AdminReportService, "dishes_report_filters", fake_filters)
    response = await client.get("/reports/dishes/filters", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["cook_filter_supported"] is False
    assert payload["cooks"] == []
    assert payload["order_types"] == [{"value": "dine_in", "label": "На месте"}]


@pytest.mark.asyncio
async def test_dishes_filters_preserve_tenant_scope_and_payment_aggregation(client, db_engine):
    suffix = uuid4().hex[:8]
    a_email = f"dish-a-{suffix}@example.com"
    b_email = f"dish-b-{suffix}@example.com"
    a_headers, _ = await register_company(client, slug=f"dish-a-{suffix}", email=a_email)
    b_headers, _ = await register_company(client, slug=f"dish-b-{suffix}", email=b_email)
    a_identity = (await client.get("/auth/me", headers=a_headers)).json()
    b_identity = (await client.get("/auth/me", headers=b_headers)).json()
    company_a = UUID(a_identity["company_id"])
    company_b = UUID(b_identity["company_id"])
    waiter_a_email = f"dish-waiter-a-{suffix}@example.com"
    waiter_b_email = f"dish-waiter-b-{suffix}@example.com"
    user_a = UUID((await _create_staff(
        client, a_headers, email=waiter_a_email, role_slug="waiter"
    ))["id"])
    user_b = UUID((await _create_staff(
        client, b_headers, email=waiter_b_email, role_slug="waiter"
    ))["id"])

    ids = {name: uuid4() for name in (
        "branch_a", "branch_b", "category_a", "category_b",
        "product_a", "product_a_other", "product_b",
        "order_a", "order_a_other", "order_a_foreign_product", "order_b",
    )}
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sessions() as db:
        db.add_all([
            Branch(id=ids["branch_a"], company_id=company_a, name="Branch A"),
            Branch(id=ids["branch_b"], company_id=company_b, name="Branch B Secret"),
            Category(
                id=ids["category_a"], company_id=company_a,
                name="Category A", slug=f"category-a-{suffix}",
            ),
            Category(
                id=ids["category_b"], company_id=company_b,
                name="Category B Secret", slug=f"category-b-{suffix}",
            ),
        ])
        await db.flush()
        db.add_all([
            Product(
                id=ids["product_a"], company_id=company_a,
                category_id=ids["category_a"], name="Plov A",
                price=Decimal("100"), cost_price=Decimal("40"),
            ),
            Product(
                id=ids["product_a_other"], company_id=company_a,
                category_id=ids["category_a"], name="Soup A",
                price=Decimal("50"), cost_price=Decimal("20"),
            ),
            Product(
                id=ids["product_b"], company_id=company_b,
                category_id=ids["category_b"], name="Company B Secret",
                price=Decimal("900"), cost_price=Decimal("10"),
            ),
        ])
        await db.flush()
        db.add_all([
            Order(
                id=ids["order_a"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=user_a, order_number="A-FILTERED", order_type="dine_in",
                status="completed", subtotal=Decimal("200"), total_amount=Decimal("200"),
            ),
            Order(
                id=ids["order_a_other"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=user_a, order_number="A-OTHER", order_type="takeaway",
                status="completed", subtotal=Decimal("50"), total_amount=Decimal("50"),
            ),
            Order(
                id=ids["order_a_foreign_product"], company_id=company_a,
                branch_id=ids["branch_a"], waiter_id=user_b,
                order_number="A-FOREIGN-PRODUCT", order_type="dine_in",
                status="completed", subtotal=Decimal("700"), total_amount=Decimal("700"),
            ),
            Order(
                id=ids["order_b"], company_id=company_b, branch_id=ids["branch_b"],
                waiter_id=user_b, order_number="B-SECRET", order_type="delivery",
                status="completed", subtotal=Decimal("900"), total_amount=Decimal("900"),
            ),
        ])
        await db.flush()
        db.add_all([
            OrderItem(
                order_id=ids["order_a"], product_id=ids["product_a"], name="Plov A",
                price=Decimal("100"), quantity=Decimal("2"), total=Decimal("200"),
            ),
            OrderItem(
                order_id=ids["order_a_other"], product_id=ids["product_a_other"], name="Soup A",
                price=Decimal("50"), quantity=Decimal("1"), total=Decimal("50"),
            ),
            OrderItem(
                order_id=ids["order_a_foreign_product"], product_id=ids["product_b"],
                name="Company B Secret via malformed relation",
                price=Decimal("700"), quantity=Decimal("1"), total=Decimal("700"),
            ),
            OrderItem(
                order_id=ids["order_b"], product_id=ids["product_b"], name="Company B Secret",
                price=Decimal("900"), quantity=Decimal("1"), total=Decimal("900"),
            ),
            Payment(
                company_id=company_a, order_id=ids["order_a"],
                amount=Decimal("100"), method="cash", status="completed",
            ),
            Payment(
                company_id=company_a, order_id=ids["order_a"],
                amount=Decimal("100"), method="cash", status="completed",
            ),
            Payment(
                company_id=company_a, order_id=ids["order_a_other"],
                amount=Decimal("50"), method="card", status="completed",
            ),
            Payment(
                company_id=company_b, order_id=ids["order_b"],
                amount=Decimal("900"), method="payme", status="completed",
            ),
            PaymentType(
                company_id=company_a, scope_kind="company",
                name="Cash A", type="cash", sort=10, status=True,
            ),
            PaymentType(
                company_id=company_a, scope_kind="company",
                name="Card A", type="card", sort=20, status=True,
            ),
            PaymentType(
                company_id=company_b, scope_kind="company",
                name="Company B Payment Secret", type="payme", sort=10, status=True,
            ),
        ])
        await db.commit()

    unfiltered = await client.get("/reports/dishes", headers=a_headers)
    assert unfiltered.status_code == 200, unfiltered.text
    assert {row["product_id"] for row in unfiltered.json()["rows"]} == {
        str(ids["product_a"]), str(ids["product_a_other"]),
    }
    assert "Company B Secret" not in unfiltered.text

    filtered = await client.get(
        "/reports/dishes",
        headers=a_headers,
        params={
            "query": "Plov",
            "author_id": str(user_a),
            "product_id": str(ids["product_a"]),
            "order_type": "dine_in",
            "order_status": "completed",
            "category_id": str(ids["category_a"]),
            "payment_method": "cash",
        },
    )
    assert filtered.status_code == 200, filtered.text
    assert len(filtered.json()["rows"]) == 1
    assert Decimal(filtered.json()["rows"][0]["quantity"]) == Decimal("2")
    assert Decimal(filtered.json()["rows"][0]["amount"]) == Decimal("200")

    foreign_product = await client.get(
        "/reports/dishes",
        headers=a_headers,
        params={"product_id": str(ids["product_b"])},
    )
    assert foreign_product.status_code == 200
    assert foreign_product.json() == {
        "rows": [],
        "totals": {"quantity": "0", "amount": "0.00"},
    }

    metadata = await client.get("/reports/dishes/filters", headers=a_headers)
    assert metadata.status_code == 200, metadata.text
    options = metadata.json()
    assert options["cook_filter_supported"] is False
    assert options["cooks"] == []
    assert {row["value"] for row in options["products"]} == {
        str(ids["product_a"]), str(ids["product_a_other"]),
    }
    assert {row["value"] for row in options["categories"]} == {str(ids["category_a"])}
    assert {row["value"] for row in options["authors"]} == {str(user_a)}
    assert {row["value"] for row in options["payment_methods"]} == {"cash", "card"}
    assert "Company B Secret" not in metadata.text
    assert b_email not in metadata.text
    assert waiter_b_email not in metadata.text


async def _assert_reference_metadata_is_available_without_history(client, sessions):
    suffix = uuid4().hex[:8]
    a_headers, _ = await register_company(
        client,
        slug=f"reference-meta-a-{suffix}",
        email=f"reference-meta-owner-a-{suffix}@example.com",
    )
    b_headers, _ = await register_company(
        client,
        slug=f"reference-meta-b-{suffix}",
        email=f"reference-meta-owner-b-{suffix}@example.com",
    )
    company_a = UUID((await client.get("/auth/me", headers=a_headers)).json()["company_id"])
    company_b = UUID((await client.get("/auth/me", headers=b_headers)).json()["company_id"])
    ids = {name: uuid4() for name in (
        "category_a", "category_a_inactive", "category_b",
        "product_a", "product_a_unavailable", "product_b",
    )}

    async with sessions() as db:
        db.add_all([
            Category(
                id=ids["category_a"], company_id=company_a,
                name="Zero History Category A", slug=f"zero-history-a-{suffix}",
                is_active=True,
            ),
            Category(
                id=ids["category_a_inactive"], company_id=company_a,
                name="Inactive Category A", slug=f"inactive-a-{suffix}",
                is_active=False,
            ),
            Category(
                id=ids["category_b"], company_id=company_b,
                name="Foreign Category Secret", slug=f"foreign-b-{suffix}",
                is_active=True,
            ),
        ])
        await db.flush()
        db.add_all([
            Product(
                id=ids["product_a"], company_id=company_a,
                category_id=ids["category_a"], name="Zero History Product A",
                price=Decimal("100"), is_active=True, is_available=True,
            ),
            Product(
                id=ids["product_a_unavailable"], company_id=company_a,
                category_id=ids["category_a"], name="Unavailable Product A",
                price=Decimal("100"), is_active=True, is_available=False,
            ),
            Product(
                id=ids["product_b"], company_id=company_b,
                category_id=ids["category_b"], name="Foreign Product Secret",
                price=Decimal("100"), is_active=True, is_available=True,
            ),
            PaymentType(
                company_id=company_a, scope_kind="company",
                name="Tenant Cash", type="cash", sort=10, status=True,
            ),
            PaymentType(
                company_id=company_a, scope_kind="company",
                name="Inactive Payment", type="inactive", sort=20, status=False,
            ),
            PaymentType(
                company_id=company_b, scope_kind="company",
                name="Foreign Payment Secret", type="foreign", sort=10, status=True,
            ),
            PaymentType(
                scope_kind="system",
                name="System Card", type="card", sort=20, status=True,
            ),
        ])
        await db.commit()

    metadata = await client.get("/reports/dishes/filters", headers=a_headers)
    assert metadata.status_code == 200, metadata.text
    options = metadata.json()
    assert options["products"] == [
        {"value": str(ids["product_a"]), "label": "Zero History Product A"}
    ]
    assert options["categories"] == [
        {"value": str(ids["category_a"]), "label": "Zero History Category A"}
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
    assert options["cooks"] == []
    assert options["cook_filter_supported"] is False
    assert "Inactive Category A" not in metadata.text
    assert "Unavailable Product A" not in metadata.text
    assert "Inactive Payment" not in metadata.text
    assert "Foreign Category Secret" not in metadata.text
    assert "Foreign Product Secret" not in metadata.text
    assert "Foreign Payment Secret" not in metadata.text


@pytest.mark.asyncio
async def test_reference_metadata_is_available_without_history(client, db_engine):
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    await _assert_reference_metadata_is_available_without_history(client, sessions)


@pytest.mark.asyncio
async def test_reference_metadata_is_available_without_history_postgres(reports_api):
    client, sessions = reports_api
    await _assert_reference_metadata_is_available_without_history(client, sessions)


async def _assert_waiter_metadata_uses_current_company_roles(client, sessions):
    suffix = uuid4().hex[:8]
    a_headers, _ = await register_company(
        client,
        slug=f"waiter-meta-a-{suffix}",
        email=f"waiter-meta-owner-a-{suffix}@example.com",
    )
    b_headers, _ = await register_company(
        client,
        slug=f"waiter-meta-b-{suffix}",
        email=f"waiter-meta-owner-b-{suffix}@example.com",
    )
    a_identity = (await client.get("/auth/me", headers=a_headers)).json()
    company_a = UUID(a_identity["company_id"])

    waiter_a_email = f"zero-order-waiter-a-{suffix}@example.com"
    cashier_a_email = f"cashier-only-a-{suffix}@example.com"
    waiter_b_email = f"foreign-waiter-b-{suffix}@example.com"
    cashier_b_email = f"foreign-cashier-b-{suffix}@example.com"
    kitchen_a_email = f"kitchen-a-{suffix}@example.com"
    inactive_cashier_a_email = f"inactive-cashier-a-{suffix}@example.com"
    waiter_a = await _create_staff(
        client, a_headers, email=waiter_a_email, role_slug="waiter"
    )
    cashier_a = await _create_staff(
        client, a_headers, email=cashier_a_email, role_slug="cashier"
    )
    kitchen_a = await _create_staff(
        client, a_headers, email=kitchen_a_email, role_slug="kitchen"
    )
    inactive_cashier_a = await _create_staff(
        client, a_headers, email=inactive_cashier_a_email, role_slug="cashier"
    )
    waiter_b = await _create_staff(
        client, b_headers, email=waiter_b_email, role_slug="waiter"
    )
    cashier_b = await _create_staff(
        client, b_headers, email=cashier_b_email, role_slug="cashier"
    )
    async with sessions() as db:
        inactive_user = await db.get(User, UUID(inactive_cashier_a["id"]))
        inactive_user.is_active = False
        await db.commit()

    metadata_before_orders = await client.get(
        "/reports/dishes/filters", headers=a_headers
    )
    assert metadata_before_orders.status_code == 200, metadata_before_orders.text
    authors = metadata_before_orders.json()["authors"]
    # Product rule: active same-company waiters AND cashiers are offered with
    # no order history required; everyone else is excluded.
    assert {row["value"] for row in authors} == {waiter_a["id"], cashier_a["id"]}
    assert {row["label"] for row in authors} == {waiter_a_email, cashier_a_email}
    for excluded_id, excluded_email in (
        (kitchen_a["id"], kitchen_a_email),
        (inactive_cashier_a["id"], inactive_cashier_a_email),
        (waiter_b["id"], waiter_b_email),
        (cashier_b["id"], cashier_b_email),
    ):
        assert excluded_id not in metadata_before_orders.text
        assert excluded_email not in metadata_before_orders.text

    ids = {name: uuid4() for name in ("branch", "category", "product", "order")}
    async with sessions() as db:
        db.add_all([
            Branch(id=ids["branch"], company_id=company_a, name="Waiter Metadata Branch"),
            Category(
                id=ids["category"], company_id=company_a,
                name="Waiter Metadata Category", slug=f"waiter-meta-{suffix}",
            ),
        ])
        await db.flush()
        db.add(Product(
            id=ids["product"], company_id=company_a,
            category_id=ids["category"], name="Waiter Metadata Dish",
            price=Decimal("75"), cost_price=Decimal("25"),
        ))
        await db.flush()
        db.add(Order(
            id=ids["order"], company_id=company_a, branch_id=ids["branch"],
            waiter_id=UUID(waiter_a["id"]), order_number="WAITER-METADATA",
            order_type="dine_in", status="completed",
            subtotal=Decimal("75"), total_amount=Decimal("75"),
        ))
        await db.flush()
        db.add(OrderItem(
            order_id=ids["order"], product_id=ids["product"],
            name="Waiter Metadata Dish", price=Decimal("75"),
            quantity=Decimal("1"), total=Decimal("75"),
        ))
        await db.commit()

    filtered = await client.get(
        "/reports/dishes",
        headers=a_headers,
        params={"author_id": waiter_a["id"]},
    )
    assert filtered.status_code == 200, filtered.text
    assert [row["product_id"] for row in filtered.json()["rows"]] == [str(ids["product"])]

    # The order-author predicate is unchanged: a cashier-created order still
    # matches author_id == cashier (Payment.cashier_id is NOT consulted), while
    # an unrelated-role user truthfully matches nothing.
    cashier_order_id = uuid4()
    async with sessions() as db:
        db.add(Order(
            id=cashier_order_id, company_id=company_a, branch_id=ids["branch"],
            waiter_id=UUID(cashier_a["id"]), order_number="CASHIER-AUTHORED",
            order_type="dine_in", status="completed",
            subtotal=Decimal("75"), total_amount=Decimal("75"),
        ))
        await db.flush()
        db.add(OrderItem(
            order_id=cashier_order_id, product_id=ids["product"],
            name="Waiter Metadata Dish", price=Decimal("75"),
            quantity=Decimal("1"), total=Decimal("75"),
        ))
        await db.commit()

    cashier_filtered = await client.get(
        "/reports/dishes",
        headers=a_headers,
        params={"author_id": cashier_a["id"]},
    )
    assert cashier_filtered.status_code == 200, cashier_filtered.text
    assert [row["product_id"] for row in cashier_filtered.json()["rows"]] == [str(ids["product"])]

    kitchen_filtered = await client.get(
        "/reports/dishes",
        headers=a_headers,
        params={"author_id": kitchen_a["id"]},
    )
    assert kitchen_filtered.status_code == 200, kitchen_filtered.text
    assert kitchen_filtered.json() == {
        "rows": [],
        "totals": {"quantity": "0", "amount": "0.00"},
    }


@pytest.mark.asyncio
async def test_waiter_with_zero_orders_is_available_in_dishes_metadata(client, db_engine):
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    await _assert_waiter_metadata_uses_current_company_roles(client, sessions)


@pytest.mark.asyncio
async def test_waiter_with_zero_orders_is_available_in_dishes_metadata_postgres(
    reports_api,
):
    client, sessions = reports_api
    await _assert_waiter_metadata_uses_current_company_roles(client, sessions)


async def _assert_each_supported_dishes_predicate_independently_constrains_results(
    client,
    sessions,
):
    suffix = uuid4().hex[:8]
    headers, _ = await register_company(
        client,
        slug=f"predicate-{suffix}",
        email=f"predicate-owner-{suffix}@example.com",
    )
    identity = (await client.get("/auth/me", headers=headers)).json()
    company_id = UUID(identity["company_id"])
    owner_id = UUID(identity["id"])
    other_waiter_id = uuid4()
    ids = {name: uuid4() for name in (
        "branch", "target_category", "other_category",
        "target_product", "other_product", "target_order", "other_order",
    )}

    async with sessions() as db:
        db.add_all([
            User(
                id=other_waiter_id,
                company_id=company_id,
                email=f"predicate-waiter-{suffix}@example.com",
                password_hash="unused-in-test",
            ),
            Branch(id=ids["branch"], company_id=company_id, name="Predicate Branch"),
            Category(
                id=ids["target_category"], company_id=company_id,
                name="Target Category", slug=f"target-{suffix}",
            ),
            Category(
                id=ids["other_category"], company_id=company_id,
                name="Other Category", slug=f"other-{suffix}",
            ),
        ])
        await db.flush()
        db.add_all([
            Product(
                id=ids["target_product"], company_id=company_id,
                category_id=ids["target_category"], name="Target Plov",
                price=Decimal("100"), cost_price=Decimal("40"),
            ),
            Product(
                id=ids["other_product"], company_id=company_id,
                category_id=ids["other_category"], name="Other Soup",
                price=Decimal("50"), cost_price=Decimal("20"),
            ),
        ])
        await db.flush()
        db.add_all([
            Order(
                id=ids["target_order"], company_id=company_id, branch_id=ids["branch"],
                waiter_id=owner_id, order_number="PREDICATE-TARGET",
                order_type="dine_in", status="completed",
                subtotal=Decimal("200"), total_amount=Decimal("200"),
            ),
            Order(
                id=ids["other_order"], company_id=company_id, branch_id=ids["branch"],
                waiter_id=other_waiter_id, order_number="PREDICATE-OTHER",
                order_type="takeaway", status="ready",
                subtotal=Decimal("50"), total_amount=Decimal("50"),
            ),
        ])
        await db.flush()
        db.add_all([
            OrderItem(
                order_id=ids["target_order"], product_id=ids["target_product"],
                name="Target Plov", price=Decimal("100"),
                quantity=Decimal("2"), total=Decimal("200"),
            ),
            OrderItem(
                order_id=ids["other_order"], product_id=ids["other_product"],
                name="Other Soup", price=Decimal("50"),
                quantity=Decimal("1"), total=Decimal("50"),
            ),
            Payment(
                company_id=company_id, order_id=ids["target_order"],
                amount=Decimal("100"), method="cash", status="completed",
            ),
            Payment(
                company_id=company_id, order_id=ids["target_order"],
                amount=Decimal("100"), method="cash", status="completed",
            ),
            Payment(
                company_id=company_id, order_id=ids["other_order"],
                amount=Decimal("50"), method="card", status="completed",
            ),
        ])
        await db.commit()

    baseline = await client.get("/reports/dishes", headers=headers)
    assert baseline.status_code == 200, baseline.text
    assert {row["product_id"] for row in baseline.json()["rows"]} == {
        str(ids["target_product"]), str(ids["other_product"]),
    }

    cases = (
        ("query", "Target"),
        ("author_id", str(owner_id)),
        ("product_id", str(ids["target_product"])),
        ("order_type", "dine_in"),
        ("order_status", "completed"),
        ("category_id", str(ids["target_category"])),
        ("payment_method", "cash"),
    )
    for parameter, value in cases:
        response = await client.get(
            "/reports/dishes",
            headers=headers,
            params={parameter: value},
        )
        assert response.status_code == 200, (parameter, response.text)
        assert [row["product_id"] for row in response.json()["rows"]] == [
            str(ids["target_product"])
        ], parameter
        if parameter == "payment_method":
            assert Decimal(response.json()["rows"][0]["quantity"]) == Decimal("2")
            assert Decimal(response.json()["rows"][0]["amount"]) == Decimal("200")


@pytest.mark.asyncio
async def test_each_supported_dishes_predicate_independently_constrains_results(client, db_engine):
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    await _assert_each_supported_dishes_predicate_independently_constrains_results(
        client,
        sessions,
    )


@pytest.mark.asyncio
async def test_each_supported_dishes_predicate_independently_constrains_results_postgres(
    reports_api,
):
    client, sessions = reports_api
    await _assert_each_supported_dishes_predicate_independently_constrains_results(
        client,
        sessions,
    )


async def _assert_dishes_phase1_truth(client, sessions):
    """Phase 1 contract: truthful unit/weighted price, authoritative totals,
    subcategory matching, completed-payments-only filter, historical name
    grouping, zero shape. No cost/profit/status keys anywhere."""
    suffix = uuid4().hex[:8]
    headers, _ = await register_company(
        client, slug=f"phase1-{suffix}", email=f"phase1-owner-{suffix}@example.com",
    )
    identity = (await client.get("/auth/me", headers=headers)).json()
    company_id = UUID(identity["company_id"])
    owner_id = UUID(identity["id"])
    ids = {name: uuid4() for name in (
        "branch", "primary_category", "sub_category", "other_category",
        "weighted", "rounded", "unit_null", "sub_product", "renamed",
        "pending_pay_order", "completed_pay_order",
        "order_w1", "order_w2", "order_r", "order_s", "order_u",
        "order_old", "order_new", "order_pend", "order_comp",
    )}

    async with sessions() as db:
        db.add(Branch(id=ids["branch"], company_id=company_id, name="Phase1 Branch"))
        db.add_all([
            Category(id=ids["primary_category"], company_id=company_id,
                     name="Primary", slug=f"primary-{suffix}"),
            Category(id=ids["sub_category"], company_id=company_id,
                     name="Sub", slug=f"sub-{suffix}"),
            Category(id=ids["other_category"], company_id=company_id,
                     name="Other", slug=f"other-{suffix}"),
        ])
        await db.flush()
        db.add_all([
            Product(id=ids["weighted"], company_id=company_id,
                    category_id=ids["primary_category"], name="Weighted Plov",
                    price=Decimal("20000"), unit="порц"),
            Product(id=ids["rounded"], company_id=company_id,
                    category_id=ids["primary_category"], name="Rounded Soup",
                    price=Decimal("100"), unit="порц"),
            Product(id=ids["unit_null"], company_id=company_id,
                    category_id=ids["primary_category"], name="No Unit Dish",
                    price=Decimal("50"), unit=None),
            Product(id=ids["sub_product"], company_id=company_id,
                    category_id=ids["other_category"],
                    subcategory_id=ids["sub_category"], name="Sub Dish",
                    price=Decimal("70"), unit="порц"),
            Product(id=ids["renamed"], company_id=company_id,
                    category_id=ids["primary_category"], name="New Name",
                    price=Decimal("90"), unit="порц"),
        ])
        await db.flush()

        def _order(key, number):
            return Order(
                id=ids[key], company_id=company_id, branch_id=ids["branch"],
                waiter_id=owner_id, order_number=number, order_type="dine_in",
                status="completed", subtotal=Decimal("0"), total_amount=Decimal("0"),
            )

        db.add_all([
            _order("order_w1", "W-1"), _order("order_w2", "W-2"),
            _order("order_r", "R-1"), _order("order_s", "S-1"),
            _order("order_u", "U-1"),
            _order("order_old", "O-OLD"), _order("order_new", "O-NEW"),
            _order("order_pend", "O-PEND"), _order("order_comp", "O-COMP"),
        ])
        await db.flush()
        db.add_all([
            # Weighted price fixture: 1x10000 + 3x20000 => qty 4, total 70000.
            OrderItem(order_id=ids["order_w1"], product_id=ids["weighted"],
                      name="Weighted Plov", price=Decimal("10000"),
                      quantity=Decimal("1"), total=Decimal("10000")),
            OrderItem(order_id=ids["order_w2"], product_id=ids["weighted"],
                      name="Weighted Plov", price=Decimal("20000"),
                      quantity=Decimal("3"), total=Decimal("60000")),
            # Rounding fixture: 100/3 => 33.33, never 33.333...
            OrderItem(order_id=ids["order_r"], product_id=ids["rounded"],
                      name="Rounded Soup", price=Decimal("100"),
                      quantity=Decimal("3"), total=Decimal("100")),
            OrderItem(order_id=ids["order_s"], product_id=ids["sub_product"],
                      name="Sub Dish", price=Decimal("70"),
                      quantity=Decimal("2"), total=Decimal("140")),
            OrderItem(order_id=ids["order_u"], product_id=ids["unit_null"],
                      name="No Unit Dish", price=Decimal("50"),
                      quantity=Decimal("1"), total=Decimal("50")),
            # Same product, historical names stay separate groups.
            OrderItem(order_id=ids["order_old"], product_id=ids["renamed"],
                      name="Old Name", price=Decimal("90"),
                      quantity=Decimal("1"), total=Decimal("90")),
            OrderItem(order_id=ids["order_new"], product_id=ids["renamed"],
                      name="New Name", price=Decimal("90"),
                      quantity=Decimal("2"), total=Decimal("180")),
            OrderItem(order_id=ids["order_pend"], product_id=ids["weighted"],
                      name="Weighted Plov", price=Decimal("20000"),
                      quantity=Decimal("1"), total=Decimal("20000")),
            OrderItem(order_id=ids["order_comp"], product_id=ids["weighted"],
                      name="Weighted Plov", price=Decimal("20000"),
                      quantity=Decimal("1"), total=Decimal("20000")),
            Payment(
                company_id=company_id, order_id=ids["order_pend"],
                amount=Decimal("20000"), method="cash", status="pending",
            ),
            Payment(
                company_id=company_id, order_id=ids["order_comp"],
                amount=Decimal("20000"), method="cash", status="completed",
            ),
        ])
        await db.commit()

    response = await client.get("/reports/dishes", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload.keys()) == {"rows", "totals"}
    by_id_name = {(row["product_id"], row["name"]): row for row in payload["rows"]}

    # Weighted price, not AVG: (10000 + 60000 + 20000 + 20000) / (1+3+1+1).
    weighted = by_id_name[(str(ids["weighted"]), "Weighted Plov")]
    assert Decimal(weighted["quantity"]) == Decimal("6")
    assert Decimal(weighted["amount"]) == Decimal("110000")
    assert Decimal(weighted["price"]) == Decimal("18333.33")
    # Rounding to 0.01, never repeating decimals.
    rounded = by_id_name[(str(ids["rounded"]), "Rounded Soup")]
    assert Decimal(rounded["price"]) == Decimal("33.33")
    # Unit comes from the master; never a report-level literal fallback.
    assert weighted["unit"] == "порц"
    # ORM column default fills explicit None with "шт" — still master truth,
    # and the contract tolerates null for legacy raw-SQL NULLs.
    assert by_id_name[(str(ids["unit_null"]), "No Unit Dish")]["unit"] == "шт"
    # No fake cost/profit/status keys anywhere in Phase 1 rows.
    for row in payload["rows"]:
        assert "cost" not in row
        assert "profit" not in row
        assert "status" not in row
    # Authoritative totals match the rows exactly.
    assert Decimal(payload["totals"]["quantity"]) == sum(
        (Decimal(r["quantity"]) for r in payload["rows"]), Decimal("0")
    )
    assert Decimal(payload["totals"]["amount"]) == sum(
        (Decimal(r["amount"]) for r in payload["rows"]), Decimal("0")
    )
    assert Decimal(payload["totals"]["quantity"]) == Decimal("15")
    assert Decimal(payload["totals"]["amount"]) == Decimal("110560")

    # Subcategory matches the canonical category filter.
    sub = await client.get(
        "/reports/dishes", headers=headers,
        params={"category_id": str(ids["sub_category"])},
    )
    assert sub.status_code == 200, sub.text
    assert [row["product_id"] for row in sub.json()["rows"]] == [str(ids["sub_product"])]

    # Pending payments do not satisfy the payment-method filter.
    pend = await client.get(
        "/reports/dishes", headers=headers,
        params={"payment_method": "cash", "product_id": str(ids["weighted"])},
    )
    assert pend.status_code == 200, pend.text
    assert Decimal(pend.json()["rows"][0]["quantity"]) == Decimal("1")
    assert Decimal(pend.json()["rows"][0]["amount"]) == Decimal("20000")

    # Renamed dish keeps historical name groups separate.
    ren = await client.get(
        "/reports/dishes", headers=headers,
        params={"product_id": str(ids["renamed"])},
    )
    assert ren.status_code == 200, ren.text
    assert sorted(row["name"] for row in ren.json()["rows"]) == ["New Name", "Old Name"]

    # Zero-data shape carries zero totals, never nulls.
    empty = await client.get(
        "/reports/dishes", headers=headers, params={"query": "no-such-dish-at-all"},
    )
    assert empty.status_code == 200
    assert empty.json()["rows"] == []
    assert Decimal(empty.json()["totals"]["quantity"]) == Decimal("0")
    assert Decimal(empty.json()["totals"]["amount"]) == Decimal("0")


@pytest.mark.asyncio
async def test_dishes_phase1_truth(client, db_engine):
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    await _assert_dishes_phase1_truth(client, sessions)


@pytest.mark.asyncio
async def test_dishes_phase1_truth_postgres(reports_api):
    client, sessions = reports_api
    await _assert_dishes_phase1_truth(client, sessions)


@pytest.mark.asyncio
async def test_dishes_multi_select_or_within_and_across_dimensions(client, db_engine):
    """Multi-select truth: OR within a dimension, AND across dimensions.

    Covers authors/products/types/statuses/categories/payments, the
    primary+subcategory category rule, duplicates, foreign and malformed ids,
    empty selection, and totals computed over the exact filtered population.
    """
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    suffix = uuid4().hex[:8]
    a_headers, _ = await register_company(
        client, slug=f"multi-a-{suffix}", email=f"multi-a-{suffix}@example.com"
    )
    b_headers, _ = await register_company(
        client, slug=f"multi-b-{suffix}", email=f"multi-b-{suffix}@example.com"
    )
    company_a = UUID((await client.get("/auth/me", headers=a_headers)).json()["company_id"])
    company_b = UUID((await client.get("/auth/me", headers=b_headers)).json()["company_id"])
    w1 = UUID((await _create_staff(
        client, a_headers, email=f"multi-w1-{suffix}@example.com", role_slug="waiter"
    ))["id"])
    w2 = UUID((await _create_staff(
        client, a_headers, email=f"multi-w2-{suffix}@example.com", role_slug="waiter"
    ))["id"])
    w_foreign = UUID((await _create_staff(
        client, b_headers, email=f"multi-wb-{suffix}@example.com", role_slug="waiter"
    ))["id"])

    ids = {name: uuid4() for name in (
        "branch_a", "branch_b", "cat_main", "cat_sub",
        "p1", "p2", "o1", "o2", "o3", "o4_new", "o_foreign",
    )}
    async with sessions() as db:
        db.add_all([
            Branch(id=ids["branch_a"], company_id=company_a, name="Branch A"),
            Branch(id=ids["branch_b"], company_id=company_b, name="Branch B"),
            Category(id=ids["cat_main"], company_id=company_a,
                     name="Main", slug=f"multi-main-{suffix}"),
            Category(id=ids["cat_sub"], company_id=company_a,
                     name="Sub", slug=f"multi-sub-{suffix}"),
        ])
        await db.flush()
        db.add_all([
            Product(id=ids["p1"], company_id=company_a, category_id=ids["cat_main"],
                    name="Multi Plov", price=Decimal("100"), cost_price=Decimal("40")),
            Product(id=ids["p2"], company_id=company_a, subcategory_id=ids["cat_sub"],
                    name="Multi Soup", price=Decimal("50"), cost_price=Decimal("20")),
        ])
        await db.flush()
        db.add_all([
            Order(
                id=ids["o1"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=w1, order_number="M-1", order_type="dine_in",
                status="completed", subtotal=Decimal("200"), total_amount=Decimal("200"),
            ),
            Order(
                id=ids["o2"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=w2, order_number="M-2", order_type="delivery",
                status="completed", subtotal=Decimal("50"), total_amount=Decimal("50"),
            ),
            Order(
                id=ids["o3"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=w1, order_number="M-3", order_type="dine_in",
                status="completed", subtotal=Decimal("150"), total_amount=Decimal("150"),
            ),
            Order(
                id=ids["o4_new"], company_id=company_a, branch_id=ids["branch_a"],
                waiter_id=w1, order_number="M-4-NEW", order_type="dine_in",
                status="new", subtotal=Decimal("100"), total_amount=Decimal("100"),
            ),
            Order(
                id=ids["o_foreign"], company_id=company_b, branch_id=ids["branch_b"],
                waiter_id=w_foreign, order_number="M-FOREIGN",
                order_type="dine_in", status="completed",
                subtotal=Decimal("700"), total_amount=Decimal("700"),
            ),
        ])
        await db.flush()
        db.add_all([
            OrderItem(order_id=ids["o1"], product_id=ids["p1"], name="Multi Plov",
                      price=Decimal("100"), quantity=Decimal("2"), total=Decimal("200")),
            OrderItem(order_id=ids["o2"], product_id=ids["p2"], name="Multi Soup",
                      price=Decimal("50"), quantity=Decimal("1"), total=Decimal("50")),
            OrderItem(order_id=ids["o3"], product_id=ids["p2"], name="Multi Soup",
                      price=Decimal("50"), quantity=Decimal("3"), total=Decimal("150")),
            OrderItem(order_id=ids["o4_new"], product_id=ids["p1"], name="Multi Plov",
                      price=Decimal("100"), quantity=Decimal("1"), total=Decimal("100")),
            Payment(company_id=company_a, order_id=ids["o1"], amount=Decimal("200"),
                    method="cash", status="completed"),
            Payment(company_id=company_a, order_id=ids["o2"], amount=Decimal("50"),
                    method="card", status="completed"),
        ])
        await db.commit()

    async def dish_rows(params=None, **kw):
        response = await client.get(
            "/reports/dishes", headers=a_headers, params=params if params is not None else kw
        )
        assert response.status_code == 200, response.text
        return response.json()

    def by_product(body):
        return {row["product_id"]: row for row in body["rows"]}

    # Baseline: new (not cancelled) included, foreign excluded.
    base = await dish_rows()
    assert set(by_product(base)) == {str(ids["p1"]), str(ids["p2"])}
    assert Decimal(base["totals"]["quantity"]) == Decimal("7")
    assert Decimal(base["totals"]["amount"]) == Decimal("500")

    # Authors OR: [w1, w2] == baseline; [w1] narrows; duplicates collapse.
    both = await dish_rows(params=[("author_id", str(w1)), ("author_id", str(w2))])
    assert set(by_product(both)) == {str(ids["p1"]), str(ids["p2"])}
    one = await dish_rows(params=[("author_id", str(w1))])
    assert set(by_product(one)) == {str(ids["p1"]), str(ids["p2"])}
    assert Decimal(one["rows"][0]["quantity"]) + Decimal(one["rows"][1]["quantity"]) == Decimal("6")
    dup = await dish_rows(params=[("author_id", str(w1)), ("author_id", str(w1))])
    assert set(by_product(dup)) == set(by_product(one))
    mixed = await dish_rows(params=[("author_id", str(w1)), ("author_id", str(w_foreign))])
    assert set(by_product(mixed)) == set(by_product(one))
    assert "FOREIGN" not in str(mixed)
    assert (await dish_rows(params=[("author_id", str(w_foreign))]))["rows"] == []

    # Malformed UUID keeps the scalar 422 contract.
    bad = await client.get(
        "/reports/dishes", headers=a_headers, params={"author_id": "not-a-uuid"}
    )
    assert bad.status_code == 422, bad.text

    # Categories: primary OR subcategory across the selected list.
    cats = await dish_rows(params=[("category_id", str(ids["cat_main"])), ("category_id", str(ids["cat_sub"]))])
    assert set(by_product(cats)) == {str(ids["p1"]), str(ids["p2"])}
    main_only = await dish_rows(params=[("category_id", str(ids["cat_main"]))])
    assert set(by_product(main_only)) == {str(ids["p1"])}
    sub_only = await dish_rows(params=[("category_id", str(ids["cat_sub"]))])
    assert set(by_product(sub_only)) == {str(ids["p2"])}

    # Products / types / statuses.
    assert set(by_product(await dish_rows(
        params=[("product_id", str(ids["p1"])), ("product_id", str(ids["p2"]))],
    ))) == {str(ids["p1"]), str(ids["p2"])}
    assert set(by_product(await dish_rows(
        params=[("order_type", "dine_in"), ("order_type", "delivery")],
    ))) == {str(ids["p1"]), str(ids["p2"])}
    assert set(by_product(await dish_rows(params=[("order_type", "delivery")]))) == {str(ids["p2"])}
    assert set(by_product(await dish_rows(
        params=[("order_status", "new"), ("order_status", "completed")],
    ))) == {str(ids["p1"]), str(ids["p2"])}

    # Payments: completed-only, OR across methods.
    pays = await dish_rows(params=[("payment_method", "cash"), ("payment_method", "card")])
    assert set(by_product(pays)) == {str(ids["p1"]), str(ids["p2"])}
    assert Decimal(pays["rows"][0]["quantity"]) + Decimal(pays["rows"][1]["quantity"]) == Decimal("3")
    cash_only = await dish_rows(params=[("payment_method", "cash")])
    assert set(by_product(cash_only)) == {str(ids["p1"])}

    # AND across dimensions + totals over the exact population.
    combo = await dish_rows(params=[
        ("author_id", str(w1)), ("author_id", str(w2)),
        ("order_type", "dine_in"),
        ("payment_method", "cash"),
    ])
    combo_rows = by_product(combo)
    assert set(combo_rows) == {str(ids["p1"])}
    assert Decimal(combo_rows[str(ids["p1"])]["quantity"]) == Decimal("2")
    assert Decimal(combo_rows[str(ids["p1"])]["amount"]) == Decimal("200")
    assert Decimal(combo["totals"]["quantity"]) == Decimal("2")
    assert Decimal(combo["totals"]["amount"]) == Decimal("200")

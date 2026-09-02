from __future__ import annotations

import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
from types import SimpleNamespace
from uuid import UUID, uuid4

import asyncpg
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient
from jose import jwt
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.engine import make_url

from app.infrastructure.database.session import get_db
from app.config import settings
from app.main import app
from app.modules.auth.dependencies import require_hq_admin
from app.modules.auth.models import User
from app.modules.auth.security import hash_password
from app.modules.companies.models import Branch
from app.modules.finance.models import Counterparty, FinTransaction
from app.modules.inventory.models import Product
from app.modules.organizations.dependencies import get_org_scope
from app.modules.organizations.models import Organization
from app.modules.pos.models import Order, OrderItem
from app.modules.payments import webhooks as payment_webhooks
from app.modules.rbac.permissions import seed_permissions
from app.shared.base_model import Base
from tests.conftest import register_company


def _control_url():
    raw = os.getenv("TEST_DATABASE_URL")
    if not raw:
        pytest.skip("TEST_DATABASE_URL is required for BI-05D PostgreSQL tests")
    url = make_url(raw)
    if url.get_backend_name() != "postgresql":
        pytest.skip("PostgreSQL is required for BI-05D tests")
    if not url.database or "test" not in url.database.lower():
        pytest.fail("TEST_DATABASE_URL must name an explicitly disposable test DB")
    return url


async def _connect(url):
    url = make_url(url)
    return await asyncpg.connect(
        user=url.username,
        password=url.password,
        host=url.host,
        port=url.port or 5432,
        database=url.database,
    )


async def _create_database(control_url, name: str) -> str:
    connection = await _connect(control_url)
    try:
        await connection.execute(f'CREATE DATABASE "{name}"')
    finally:
        await connection.close()
    return control_url.set(database=name).render_as_string(hide_password=False)


async def _drop_database(control_url, name: str) -> None:
    connection = await _connect(control_url)
    try:
        await connection.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
    finally:
        await connection.close()


@pytest.fixture(scope="module")
def reports_database_url():
    control = _control_url()
    name = f"marjon_bi05d_reports_{uuid4().hex[:10]}"
    url = asyncio.run(_create_database(control, name))
    try:
        yield url
    finally:
        asyncio.run(_drop_database(control, name))


@pytest_asyncio.fixture
async def reports_api(reports_database_url):
    engine = create_async_engine(
        reports_database_url,
        connect_args={"prepared_statement_cache_size": 0},
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        await seed_permissions(db)

    async def override_get_db() -> AsyncSession:
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test/api/v1"
    ) as client:
        yield client, sessions
    app.dependency_overrides.clear()
    await engine.dispose()


async def _companies(client: AsyncClient):
    suffix = uuid4().hex[:8]
    a_headers, _ = await register_company(
        client,
        slug=f"bi05d-a-{suffix}",
        email=f"a-{suffix}@example.com",
    )
    b_headers, _ = await register_company(
        client,
        slug=f"bi05d-b-{suffix}",
        email=f"b-{suffix}@example.com",
    )
    a_id = UUID((await client.get("/auth/me", headers=a_headers)).json()["company_id"])
    b_id = UUID((await client.get("/auth/me", headers=b_headers)).json()["company_id"])
    return a_headers, b_headers, a_id, b_id


def test_k_n_route_table_has_one_canonical_contract_per_method_path() -> None:
    rows = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods - {"HEAD", "OPTIONS"}:
            rows.append((method, route.path_format, route))

    counts = Counter((method, path) for method, path, _ in rows)
    assert len(rows) == len(counts) == 456
    assert not [key for key, count in counts.items() if count > 1]

    expected = {
        "/api/v1/reports/products": "products_report",
        "/api/v1/reports/products-count": "products_count_report",
        "/api/v1/reports/debt-credit": "debt_credit_report",
        "/api/v1/reports/orders": "orders_report",
        "/api/v1/reports/orders/filters": "orders_report_filters",
        "/api/v1/reports/tables": "tables_report",
        "/api/v1/reports/tables/filters": "tables_report_filters",
        "/api/v1/reports/waiters": "waiters_report",
        "/api/v1/reports/dishes": "dishes_report",
        "/api/v1/reports/dishes/filters": "dishes_report_filters",
        "/api/v1/reports/cancelled": "cancelled_report",
        "/api/v1/analytics/z-report": "z_report",
        "/api/v1/analytics/z-report/detail": "z_report_detail",
        "/api/v1/analytics/z-report/detail/filters": "z_report_detail_filters",
        "/api/v1/organizations": "list_organizations_directory",
    }
    by_path = defaultdict(list)
    for method, path, route in rows:
        if method == "GET":
            by_path[path].append(route.endpoint.__name__)
    for path, handler in expected.items():
        assert by_path[path] == [handler]

    schema = app.openapi()
    assert len(schema["paths"]) == 250
    for path, handler in expected.items():
        route = next(
            route
            for method, candidate, route in rows
            if method == "GET" and candidate == path
        )
        operation = schema["paths"][path]["get"]
        assert route.endpoint.__name__ == handler
        assert operation["operationId"] == route.unique_id
        assert "schema" in operation["responses"]["200"]["content"]["application/json"]


@pytest.mark.asyncio
async def test_a_f_company_reports_scope_before_aggregation_and_reject_foreign_filters(
    reports_api,
) -> None:
    client, sessions = reports_api
    a_headers, _b_headers, company_a, company_b = await _companies(client)

    branch_a_id, branch_b_id = uuid4(), uuid4()
    product_a_id, product_b_id = uuid4(), uuid4()
    counterparty_a_id, counterparty_b_id = uuid4(), uuid4()
    secret_markers = {"Company B Secret", "Counterparty B Secret"}

    async with sessions() as db:
        db.add_all(
            [
                Branch(
                    id=branch_a_id,
                    company_id=company_a,
                    name="Company A Branch",
                ),
                Branch(
                    id=branch_b_id,
                    company_id=company_b,
                    name="Company B Secret",
                ),
                Product(
                    id=product_a_id,
                    company_id=company_a,
                    name="Shared Product",
                    price=Decimal("100"),
                    cost_price=Decimal("40"),
                ),
                Product(
                    id=product_b_id,
                    company_id=company_b,
                    name="Shared Product",
                    price=Decimal("100"),
                    cost_price=Decimal("10"),
                ),
            ]
        )
        await db.flush()

        order_a_id, order_b_id = uuid4(), uuid4()
        malformed_branch_order_id, malformed_product_order_id = uuid4(), uuid4()
        db.add_all(
            [
                Order(
                    id=order_a_id,
                    company_id=company_a,
                    branch_id=branch_a_id,
                    order_number="A-VALID",
                    status="completed",
                    subtotal=Decimal("100"),
                    total_amount=Decimal("100"),
                ),
                Order(
                    id=order_b_id,
                    company_id=company_b,
                    branch_id=branch_b_id,
                    order_number="B-SECRET",
                    status="completed",
                    subtotal=Decimal("900"),
                    total_amount=Decimal("900"),
                ),
                # Historical malformed relations must not contribute even
                # when the Order row itself carries company A.
                Order(
                    id=malformed_branch_order_id,
                    company_id=company_a,
                    branch_id=branch_b_id,
                    order_number="A-BAD-BRANCH",
                    status="completed",
                    subtotal=Decimal("700"),
                    total_amount=Decimal("700"),
                ),
                Order(
                    id=malformed_product_order_id,
                    company_id=company_a,
                    branch_id=branch_a_id,
                    order_number="A-BAD-PRODUCT",
                    status="completed",
                    subtotal=Decimal("600"),
                    total_amount=Decimal("600"),
                ),
            ]
        )
        await db.flush()
        db.add_all(
            [
                OrderItem(
                    order_id=order_a_id,
                    product_id=product_a_id,
                    name="Shared Product",
                    price=Decimal("50"),
                    quantity=Decimal("2"),
                    total=Decimal("100"),
                    status="served",
                ),
                OrderItem(
                    order_id=order_b_id,
                    product_id=product_b_id,
                    name="Shared Product",
                    price=Decimal("100"),
                    quantity=Decimal("9"),
                    total=Decimal("900"),
                    status="served",
                ),
                OrderItem(
                    order_id=malformed_branch_order_id,
                    product_id=product_a_id,
                    name="Malformed branch item",
                    price=Decimal("700"),
                    quantity=Decimal("1"),
                    total=Decimal("700"),
                    status="served",
                ),
                OrderItem(
                    order_id=malformed_product_order_id,
                    product_id=product_b_id,
                    name="Malformed product item",
                    price=Decimal("600"),
                    quantity=Decimal("1"),
                    total=Decimal("600"),
                    status="served",
                ),
            ]
        )

        counterparty_a = Counterparty(
            id=counterparty_a_id,
            full_name="Counterparty A",
            scope_kind="company",
            company_id=company_a,
        )
        counterparty_b = Counterparty(
            id=counterparty_b_id,
            full_name="Counterparty B Secret",
            scope_kind="company",
            company_id=company_b,
        )
        legacy_counterparty = Counterparty(
            full_name="Legacy Counterparty Secret",
            scope_kind="legacy",
        )
        db.add_all([counterparty_a, counterparty_b, legacy_counterparty])
        await db.flush()
        db.add_all(
            [
                FinTransaction(
                    amount=Decimal("100"),
                    direction="income",
                    company_id=company_a,
                    counterparty_id=counterparty_a_id,
                ),
                FinTransaction(
                    amount=Decimal("900"),
                    direction="income",
                    company_id=company_b,
                    counterparty_id=counterparty_b_id,
                ),
                FinTransaction(
                    amount=Decimal("700"),
                    direction="income",
                    company_id=company_a,
                    counterparty_id=counterparty_b_id,
                ),
                FinTransaction(
                    amount=Decimal("300"),
                    direction="income",
                    counterparty_id=legacy_counterparty.id,
                ),
            ]
        )
        await db.commit()

    products = await client.get(
        f"/reports/products?company_id={company_b}", headers=a_headers
    )
    assert products.status_code == 200, products.text
    assert {row["product_id"] for row in products.json()} == {str(product_a_id)}
    assert Decimal(products.json()[0]["qty"]) == Decimal("2")
    assert Decimal(products.json()[0]["total"]) == Decimal("100")
    assert Decimal(products.json()[0]["cost"]) == Decimal("80")

    product_counts = await client.get("/reports/products-count", headers=a_headers)
    assert product_counts.status_code == 200, product_counts.text
    assert {row["product_id"] for row in product_counts.json()} == {
        str(product_a_id)
    }
    assert Decimal(product_counts.json()[0]["expense_qty"]) == Decimal("2")

    for endpoint in ("/reports/products", "/reports/products-count"):
        foreign = await client.get(
            endpoint, params={"branch_id": str(branch_b_id)}, headers=a_headers
        )
        assert foreign.status_code == 404
        assert not any(marker in foreign.text for marker in secret_markers)

    debt = await client.get(
        "/reports/debt-credit",
        params={"company_id": str(company_b)},
        headers=a_headers,
    )
    assert debt.status_code == 200, debt.text
    assert {row["counterparty_id"] for row in debt.json()} == {
        str(counterparty_a_id)
    }
    assert Decimal(debt.json()[0]["debit"]) == Decimal("100")
    assert Decimal(debt.json()[0]["closing_balance"]) == Decimal("100")
    assert not any(marker in debt.text for marker in secret_markers)
    assert "Legacy Counterparty Secret" not in debt.text

    foreign_counterparty = await client.get(
        "/reports/debt-credit",
        params={"counterparty_id": str(counterparty_b_id)},
        headers=a_headers,
    )
    assert foreign_counterparty.status_code == 404
    assert not any(marker in foreign_counterparty.text for marker in secret_markers)


@pytest.mark.asyncio
async def test_g_j_hq_org_scope_and_bidirectional_auth_scope_denial(
    reports_api,
) -> None:
    client, sessions = reports_api
    app_headers, _b_headers, company_a, _company_b = await _companies(client)

    organization_x_id, organization_y_id = uuid4(), uuid4()
    admin_email = f"hq-{uuid4().hex[:8]}@example.com"
    admin_password = "RootPass1!"
    async with sessions() as db:
        restricted_hq = User(
            email=f"restricted-{uuid4().hex[:8]}@example.com",
            password_hash=hash_password("Restricted1!"),
            is_superadmin=False,
            is_active=True,
        )
        db.add_all(
            [
                Organization(id=organization_x_id, name="Organization X"),
                Organization(id=organization_y_id, name="Organization Y Secret"),
                restricted_hq,
                User(
                    company_id=company_a,
                    email=admin_email,
                    password_hash=hash_password(admin_password),
                    is_superadmin=True,
                    is_active=True,
                ),
            ]
        )
        await db.flush()
        tx_x = FinTransaction(
            amount=Decimal("100"),
            direction="income",
            organization_id=organization_x_id,
        )
        tx_y = FinTransaction(
            amount=Decimal("900"),
            direction="income",
            organization_id=organization_y_id,
        )
        db.add_all([tx_x, tx_y])
        await db.commit()
        tx_x_id = tx_x.id

    app_to_hq = await client.get(
        "/hq/finance/transactions", headers=app_headers
    )
    assert app_to_hq.status_code == 403

    async def override_hq_authorization() -> User:
        return restricted_hq

    async def override_org_scope():
        return [organization_x_id]

    app.dependency_overrides[require_hq_admin] = override_hq_authorization
    app.dependency_overrides[get_org_scope] = override_org_scope
    try:
        scoped = await client.get("/hq/finance/transactions")
        assert scoped.status_code == 200, scoped.text
        assert scoped.json()["total"] == 1
        assert [row["id"] for row in scoped.json()["items"]] == [str(tx_x_id)]
        assert all(
            row["organization_id"] == str(organization_x_id)
            for row in scoped.json()["items"]
        )
        assert "Organization Y Secret" not in scoped.text

        injected_y = await client.get(
            "/hq/finance/transactions",
            params={"organization_id": str(organization_y_id)},
        )
        assert injected_y.status_code == 200, injected_y.text
        assert injected_y.json()["total"] == 0
        assert injected_y.json()["items"] == []
        assert "Organization Y Secret" not in injected_y.text
    finally:
        app.dependency_overrides.pop(require_hq_admin, None)
        app.dependency_overrides.pop(get_org_scope, None)

    login = await client.post(
        "/auth/admin/login",
        json={"email": admin_email, "password": admin_password},
    )
    assert login.status_code == 200, login.text
    hq_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    for endpoint in (
        "/reports/products",
        "/reports/debt-credit",
        "/finance/transactions",
        "/finance/payment-types",
    ):
        response = await client.get(endpoint, headers=hq_headers)
        assert response.status_code == 403, (endpoint, response.text)


@pytest.mark.asyncio
async def test_bi05e1_company_payment_fiscal_subscription_routes_require_app_scope(
    reports_api,
    monkeypatch,
) -> None:
    client, sessions = reports_api
    app_headers, _b_headers, company_a, _company_b = await _companies(client)
    admin_email = f"bi05e1-hq-{uuid4().hex[:8]}@example.com"
    admin_password = "RootPass1!"

    async with sessions() as db:
        app_user = (
            await db.execute(
                select(User).where(
                    User.company_id == company_a,
                    User.is_superadmin.is_(False),
                )
            )
        ).scalars().first()
        assert app_user is not None
        db.add(
            User(
                company_id=company_a,
                email=admin_email,
                password_hash=hash_password(admin_password),
                is_superadmin=True,
                is_active=True,
            )
        )
        await db.commit()
        legacy_payload = {
            "sub": str(app_user.id),
            "company_id": str(company_a),
            "type": "access",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        }
        legacy_headers = {
            "Authorization": "Bearer "
            + jwt.encode(
                legacy_payload,
                settings.secret_key,
                algorithm=settings.algorithm,
            )
        }

    login = await client.post(
        "/auth/admin/login",
        json={"email": admin_email, "password": admin_password},
    )
    assert login.status_code == 200, login.text
    hq_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    writes = (
        (
            "POST",
            "/payments",
            {"order_id": str(uuid4()), "amount": "10.00", "method": "cash"},
        ),
        (
            "POST",
            "/fiscal/receipts",
            {
                "order_id": str(uuid4()),
                "payment_id": str(uuid4()),
                "provider": "ofd_uz",
            },
        ),
        ("PUT", "/fiscal/settings", {"enabled": False}),
        (
            "POST",
            "/subscriptions",
            {"plan_id": str(uuid4()), "billing_cycle": "monthly"},
        ),
    )
    for method, path, payload in writes:
        denied = await client.request(
            method, path, headers=hq_headers, json=payload
        )
        assert denied.status_code == 403, (path, denied.text)

        app_response = await client.request(
            method, path, headers=app_headers, json=payload
        )
        assert app_response.status_code != 403, (path, app_response.text)

        legacy_response = await client.request(
            method, path, headers=legacy_headers, json=payload
        )
        assert legacy_response.status_code != 403, (path, legacy_response.text)

    reads = (
        f"/payments/order/{uuid4()}",
        "/payments/gateway-settings",
        "/fiscal/receipts",
        f"/fiscal/receipts/{uuid4()}",
        "/fiscal/settings",
        "/subscriptions/current",
    )
    for path in reads:
        denied = await client.get(path, headers=hq_headers)
        assert denied.status_code == 403, (path, denied.text)
        app_response = await client.get(path, headers=app_headers)
        assert app_response.status_code != 403, (path, app_response.text)
        legacy_response = await client.get(path, headers=legacy_headers)
        assert legacy_response.status_code != 403, (path, legacy_response.text)

    internal = await client.post(
        "/internal/payment-webhook",
        json={
            "order_id": str(uuid4()),
            "amount": "10.00",
            "method": "payme",
            "gateway_tx_id": "bi05e1-provider",
            "action": "confirm",
        },
    )
    assert internal.status_code == 422
    assert internal.headers.get("www-authenticate") != "Bearer"

    monkeypatch.setattr(
        payment_webhooks,
        "settings",
        SimpleNamespace(
            click_secret_key="",
            payme_merchant_id="",
            payme_secret_key="",
            uzum_secret_key="",
        ),
    )
    provider_requests = (
        ("/payments/webhooks/click", {"data": {}}),
        ("/payments/webhooks/payme", {"json": {}}),
        ("/payments/webhooks/uzum", {"json": {}}),
    )
    for path, request_kwargs in provider_requests:
        provider_response = await client.post(path, **request_kwargs)
        assert provider_response.headers.get("www-authenticate") != "Bearer"
        assert "Not authenticated" not in provider_response.text

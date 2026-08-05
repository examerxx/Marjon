from __future__ import annotations

from tests.conftest import register_company


async def test_template_starts_empty(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.get("/settings/receipt-template", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {}


async def test_save_without_version_succeeds_and_returns_version(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch(
        "/settings/receipt-template", headers=headers, json={"paperSize": "80mm"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["paperSize"] == "80mm"
    assert "version" in body


async def test_optimistic_concurrency_rejects_stale_version(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    first = await client.patch(
        "/settings/receipt-template", headers=headers, json={"paperSize": "80mm"}
    )
    v1 = first.json()["version"]

    # Correct version succeeds and bumps.
    second = await client.patch(
        "/settings/receipt-template", headers=headers, json={"version": v1, "footerText": "x"}
    )
    assert second.status_code == 200
    v2 = second.json()["version"]
    assert v2 != v1

    # Reusing the now-stale version fails.
    stale = await client.patch(
        "/settings/receipt-template", headers=headers, json={"version": v1, "footerText": "y"}
    )
    assert stale.status_code == 409


async def test_invalid_paper_size_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch("/settings/receipt-template", headers=headers, json={"paperSize": "A4"})
    assert resp.status_code == 422


async def test_unknown_field_allowed_flexible_blob(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch(
        "/settings/receipt-template", headers=headers, json={"someFutureBlockKey": True}
    )
    assert resp.status_code == 200
    assert resp.json()["someFutureBlockKey"] is True


async def test_customer_and_kitchen_versions_are_independent(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.patch("/settings/receipt-template", headers=headers, json={"paperSize": "80mm"})
    await client.patch("/settings/receipt-template", headers=headers, json={"paperSize": "58mm"})
    customer = await client.get("/settings/receipt-template", headers=headers)
    customer_version = customer.json()["version"]

    kitchen = await client.get("/settings/kitchen-receipt-template", headers=headers)
    # Kitchen has been touched zero times; its counter must not have moved
    # just because the customer template was edited twice.
    assert kitchen.json()["version"] != customer_version or kitchen.json()["version"] == 1


async def test_write_requires_company_admin(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.post(
        "/auth/users", headers=owner_headers,
        json={"email": "cashier@acme.example.com", "password": "Passw0rd!", "role_slug": "cashier"},
    )
    login = await client.post(
        "/auth/login", json={"email": "cashier@acme.example.com", "password": "Passw0rd!"}
    )
    cashier_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    denied = await client.patch(
        "/settings/receipt-template", headers=cashier_headers, json={"paperSize": "58mm"}
    )
    assert denied.status_code == 403

    allowed = await client.get("/settings/receipt-template", headers=cashier_headers)
    assert allowed.status_code == 200


async def test_template_scoped_per_company(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")

    await client.patch("/settings/receipt-template", headers=a_headers, json={"paperSize": "80mm"})
    b_template = await client.get("/settings/receipt-template", headers=b_headers)
    assert b_template.json() == {}

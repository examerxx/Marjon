from __future__ import annotations

from tests.conftest import register_company


async def test_not_found_has_unified_envelope(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.get(
        "/inventory/products/00000000-0000-0000-0000-000000000000", headers=headers
    )
    assert resp.status_code == 404
    body = resp.json()
    assert isinstance(body["detail"], str)  # backward compat — unchanged shape
    assert body["code"] == "NOT_FOUND"
    assert body["message"]
    assert body["field_errors"] == {}


async def test_unauthenticated_has_unified_envelope(client):
    resp = await client.get("/inventory/products")
    assert resp.status_code == 401
    assert resp.json()["code"] == "UNAUTHORIZED"


async def test_forbidden_has_unified_envelope(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.post(
        "/auth/users", headers=owner_headers,
        json={"email": "cashier@acme.example.com", "password": "Passw0rd!", "role_slug": "cashier"},
    )
    login = await client.post(
        "/auth/login", json={"email": "cashier@acme.example.com", "password": "Passw0rd!"}
    )
    cashier_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    resp = await client.post(
        "/inventory/products", headers=cashier_headers, json={"name": "x", "price": 100}
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "PERMISSION_DENIED"


async def test_conflict_has_unified_envelope(client):
    await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.post(
        "/auth/register",
        json={
            "company_name": "Dup", "company_slug": "dup-acme",
            "email": "owner@acme.example.com", "password": "Passw0rd!",
        },
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "CONFLICT"


async def test_pydantic_validation_error_has_field_errors(client):
    resp = await client.post("/auth/register", json={"company_name": "x"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert len(body["field_errors"]) > 0
    assert "email" in body["field_errors"]


async def test_custom_validation_error_has_unified_envelope(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch("/companies/me", headers=headers, json={"currency": "notacurrency"})
    assert resp.status_code == 422
    assert resp.json()["code"] == "VALIDATION_ERROR"

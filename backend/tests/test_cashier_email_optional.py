"""CASHIER-EMAIL-OPTIONAL-01: staff creation without Email.

Canonical contract: POST /auth/users accepts no address for operational
staff; persisted email is NULL; non-null addresses stay unique; Owner/Admin
email flows are unchanged.
"""
from __future__ import annotations

from tests.conftest import register_company


async def _create_cashier(client, owner_headers, **overrides):
    payload = {"password": "Passw0rd!", "role_slug": "cashier"}
    if "name" in overrides:
        # CompanyUserCreate carries the display name as role_name.
        overrides["role_name"] = overrides.pop("name")
    payload.update(overrides)
    resp = await client.post("/auth/users", headers=owner_headers, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_cashier_without_email_persists_null(client):
    """A: no email in request → 201, stored email is NULL, readable back."""
    owner_headers, _ = await register_company(
        client, slug="noemail", email="owner@noemail.example.com"
    )
    created = await _create_cashier(
        client, owner_headers, phone="+998900000001", name="Mine"
    )
    assert created["email"] is None
    assert created["phone"] == "+998900000001"

    listing = await client.get("/auth/users", headers=owner_headers)
    assert listing.status_code == 200, listing.text
    row = next(u for u in listing.json() if u["id"] == created["id"])
    assert row["email"] is None


async def test_second_cashier_without_email_has_no_conflict(client):
    """B: two NULL emails coexist — no uniqueness false-positive."""
    owner_headers, _ = await register_company(
        client, slug="twonull", email="owner@twonull.example.com"
    )
    first = await _create_cashier(client, owner_headers, phone="+998900000011")
    second = await _create_cashier(client, owner_headers, phone="+998900000012")
    assert first["email"] is None
    assert second["email"] is None
    assert first["id"] != second["id"]


async def test_optional_email_still_stored_when_provided(client):
    """C: a provided address keeps working exactly as before."""
    owner_headers, _ = await register_company(
        client, slug="withemail", email="owner@withemail.example.com"
    )
    created = await _create_cashier(
        client,
        owner_headers,
        email="cashier@withemail.example.com",
        phone="+998900000021",
    )
    assert created["email"] == "cashier@withemail.example.com"


async def test_duplicate_non_null_email_still_conflicts(client):
    """D: uniqueness for real addresses is preserved (create + update)."""
    owner_headers, _ = await register_company(
        client, slug="dupe", email="owner@dupe.example.com"
    )
    await _create_cashier(
        client, owner_headers, email="taken@dupe.example.com", phone="+998900000031"
    )
    clash = await client.post(
        "/auth/users",
        headers=owner_headers,
        json={
            "password": "Passw0rd!",
            "role_slug": "cashier",
            "email": "taken@dupe.example.com",
            "phone": "+998900000032",
        },
    )
    assert clash.status_code == 409, clash.text

    other = await _create_cashier(client, owner_headers, phone="+998900000033")
    move = await client.patch(
        f"/auth/users/{other['id']}",
        headers=owner_headers,
        json={"email": "taken@dupe.example.com"},
    )
    assert move.status_code == 409, move.text


async def test_owner_email_flows_unchanged(client):
    """E: Owner registration/login still require and use Email."""
    bad = await client.post(
        "/auth/register",
        json={"company_name": "No Mail", "company_slug": "nomail", "password": "Passw0rd!"},
    )
    assert bad.status_code == 422, bad.text

    owner_headers, _ = await register_company(
        client, slug="ownerkept", email="owner@ownerkept.example.com"
    )
    login = await client.post(
        "/auth/login",
        json={"email": "owner@ownerkept.example.com", "password": "Passw0rd!"},
    )
    assert login.status_code == 200, login.text
    assert owner_headers  # fixture headers remain usable


async def test_emailless_cashier_logs_in_by_phone(client):
    """F/auth: Email is not an authentication identity for cashiers."""
    owner_headers, _ = await register_company(
        client, slug="phonelogin", email="owner@phonelogin.example.com"
    )
    await _create_cashier(client, owner_headers, phone="+998900000041")
    login = await client.post(
        "/auth/login", json={"phone": "+998900000041", "password": "Passw0rd!"}
    )
    assert login.status_code == 200, login.text


async def test_emailless_cashier_updates_and_deactivates(client):
    """F/read-update: NULL-email row lists, patches and deactivates cleanly."""
    owner_headers, _ = await register_company(
        client, slug="nulllife", email="owner@nulllife.example.com"
    )
    created = await _create_cashier(client, owner_headers, phone="+998900000051")

    patched = await client.patch(
        f"/auth/users/{created['id']}",
        headers=owner_headers,
        json={"name": "Renamed", "is_active": False},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["email"] is None
    assert patched.json()["name"] == "Renamed"
    assert patched.json()["is_active"] is False

    reactivated = await client.patch(
        f"/auth/users/{created['id']}",
        headers=owner_headers,
        json={"is_active": True},
    )
    assert reactivated.status_code == 200, reactivated.text
    assert reactivated.json()["email"] is None


def test_openapi_cashier_create_does_not_require_email():
    """OpenAPI: Email optional on staff create, required on register."""
    from app.main import app

    schemas = app.openapi()["components"]["schemas"]
    create_required = schemas["CompanyUserCreate"].get("required", [])
    assert "email" not in create_required
    assert "password" in create_required
    assert "role_slug" in create_required
    register_required = schemas["RegisterRequest"].get("required", [])
    assert "email" in register_required

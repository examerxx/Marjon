from __future__ import annotations

from tests.conftest import register_company


async def test_register_returns_tokens(client):
    headers, data = await register_company(client, slug="acme", email="owner@acme.example.com")
    assert data["access_token"]
    assert data["refresh_token"]
    assert data["token_type"] == "bearer"


async def test_duplicate_email_rejected(client):
    await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.post(
        "/auth/register",
        json={
            "company_name": "Acme 2",
            "company_slug": "acme-2",
            "email": "owner@acme.example.com",
            "password": "Passw0rd!",
        },
    )
    assert resp.status_code == 409


async def test_login_success_and_wrong_password(client):
    await register_company(client, slug="acme", email="owner@acme.example.com", password="Secret123!")

    ok = await client.post("/auth/login", json={"email": "owner@acme.example.com", "password": "Secret123!"})
    assert ok.status_code == 200
    assert ok.json()["access_token"]

    bad = await client.post("/auth/login", json={"email": "owner@acme.example.com", "password": "wrong"})
    assert bad.status_code == 401


async def test_me_requires_auth(client):
    resp = await client.get("/auth/me")
    assert resp.status_code == 401


async def test_me_returns_owner_role(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.get("/auth/me", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "owner@acme.example.com"
    assert "owner" in body["role_slugs"]


async def test_refresh_rotates_token(client):
    _, data = await register_company(client, slug="acme", email="owner@acme.example.com")
    old_refresh = data["refresh_token"]

    resp = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert resp.status_code == 200
    new_tokens = resp.json()
    assert new_tokens["refresh_token"] != old_refresh

    # Old refresh token must be revoked after rotation.
    reuse = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert reuse.status_code == 401

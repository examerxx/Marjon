from __future__ import annotations

from tests.conftest import register_company


async def test_scoped_logout_revokes_only_that_session(client):
    _, dev_a = await register_company(client, slug="acme", email="owner@acme.example.com")

    login = await client.post(
        "/auth/login", json={"email": "owner@acme.example.com", "password": "Passw0rd!"}
    )
    assert login.status_code == 200
    dev_b = login.json()

    logout = await client.post(
        "/auth/logout",
        headers={"Authorization": f"Bearer {dev_a['access_token']}"},
        json={"refresh_token": dev_a["refresh_token"]},
    )
    assert logout.status_code == 204

    # Device A's refresh token is dead now...
    dead = await client.post("/auth/refresh", json={"refresh_token": dev_a["refresh_token"]})
    assert dead.status_code == 401

    # ...but device B's session is untouched.
    alive = await client.post("/auth/refresh", json={"refresh_token": dev_b["refresh_token"]})
    assert alive.status_code == 200


async def test_logout_all_revokes_every_session(client):
    _, dev_a = await register_company(client, slug="acme", email="owner@acme.example.com")
    login = await client.post(
        "/auth/login", json={"email": "owner@acme.example.com", "password": "Passw0rd!"}
    )
    dev_b = login.json()

    resp = await client.post(
        "/auth/logout-all", headers={"Authorization": f"Bearer {dev_b['access_token']}"}
    )
    assert resp.status_code == 204

    for dev in (dev_a, dev_b):
        dead = await client.post("/auth/refresh", json={"refresh_token": dev["refresh_token"]})
        assert dead.status_code == 401


async def test_logout_without_body_revokes_all_for_backward_compat(client):
    _, dev_a = await register_company(client, slug="acme", email="owner@acme.example.com")
    login = await client.post(
        "/auth/login", json={"email": "owner@acme.example.com", "password": "Passw0rd!"}
    )
    dev_b = login.json()

    resp = await client.post(
        "/auth/logout", headers={"Authorization": f"Bearer {dev_a['access_token']}"}
    )
    assert resp.status_code == 204

    for dev in (dev_a, dev_b):
        dead = await client.post("/auth/refresh", json={"refresh_token": dev["refresh_token"]})
        assert dead.status_code == 401


async def test_refresh_rotation_rejects_reused_token(client):
    _, data = await register_company(client, slug="acme", email="owner@acme.example.com")
    old_refresh = data["refresh_token"]

    first = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert first.status_code == 200

    reuse = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert reuse.status_code == 401

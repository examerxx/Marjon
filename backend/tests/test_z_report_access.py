from __future__ import annotations

from datetime import date, datetime, timezone

from tests.conftest import register_company


async def _create_cashier(client, owner_headers, email="cashier@acme.example.com"):
    created = await client.post(
        "/auth/users",
        headers=owner_headers,
        json={"email": email, "password": "Passw0rd!", "role_slug": "cashier"},
    )
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]
    login = await client.post(
        "/auth/login", json={"email": email, "password": "Passw0rd!"}
    )
    assert login.status_code == 200, login.text
    return user_id, {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _grant(owner_client_headers, client, user_id, permissions):
    resp = await client.patch(
        f"/auth/users/{user_id}", headers=owner_client_headers, json={"permissions": permissions}
    )
    assert resp.status_code == 200, resp.text


async def test_cashier_without_flag_cannot_open_z_report(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    _, cashier_headers = await _create_cashier(client, owner_headers)
    resp = await client.get("/analytics/z-report", headers=cashier_headers, params={"date": "2026-09-17"})
    assert resp.status_code == 403


async def test_cashier_with_flag_can_open_z_report(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    user_id, cashier_headers = await _create_cashier(client, owner_headers)
    await _grant(owner_headers, client, user_id, {"can_view_z_report": True})
    resp = await client.get("/analytics/z-report", headers=cashier_headers, params={"date": "2026-09-17"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["orders_count"] == 0


async def test_cashier_without_past_periods_gets_only_today(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    user_id, cashier_headers = await _create_cashier(client, owner_headers)
    await _grant(owner_headers, client, user_id, {"can_view_z_report": True})
    resp = await client.get(
        "/analytics/z-report",
        headers=cashier_headers,
        params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["date"] == datetime.now(timezone.utc).date().isoformat()


async def test_cashier_with_finance_flag_can_open_dishes_report(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    user_id, cashier_headers = await _create_cashier(client, owner_headers)
    denied = await client.get("/reports/dishes", headers=cashier_headers)
    assert denied.status_code == 403
    await _grant(owner_headers, client, user_id, {"can_view_finance": True})
    allowed = await client.get("/reports/dishes", headers=cashier_headers)
    assert allowed.status_code == 200, allowed.text


async def test_owner_keeps_access_to_reports(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    today = date.today().isoformat()
    z_resp = await client.get("/analytics/z-report", headers=owner_headers, params={"date": today})
    assert z_resp.status_code == 200, z_resp.text
    dishes_resp = await client.get("/reports/dishes", headers=owner_headers)
    assert dishes_resp.status_code == 200, dishes_resp.text

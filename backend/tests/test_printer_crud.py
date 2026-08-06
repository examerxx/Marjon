from __future__ import annotations

from tests.conftest import register_company


async def test_frontend_payload_shape_now_works(client):
    """SettingsPrintersPage.jsx's apiMapFormToPayload sends {name, type,
    ip_address, port, zone, is_active} — no branch_id, no connection_type,
    `type` (not printer_type) with Russian labels. This used to always
    422 (branch_id was required and printer_type was never satisfied)."""
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    branch = await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})
    branch_id = branch.json()["id"]

    resp = await client.post(
        "/printers", headers=headers,
        json={
            "name": "Касса", "type": "Чековый", "ip_address": "192.168.1.50",
            "port": 9100, "zone": "Касса", "is_active": True,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["printer_type"] == "receipt"
    assert body["zone"] == "Касса"
    assert body["branch_id"] == branch_id


async def test_branch_id_auto_resolves_when_omitted(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    branch = await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})
    branch_id = branch.json()["id"]

    resp = await client.post(
        "/printers", headers=headers, json={"name": "Kitchen", "printer_type": "kitchen"}
    )
    assert resp.status_code == 201
    assert resp.json()["branch_id"] == branch_id


async def test_no_branch_gives_clear_error_not_a_guess(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.post(
        "/printers", headers=headers, json={"name": "Kitchen", "printer_type": "kitchen"}
    )
    assert resp.status_code == 404


async def test_host_alias_for_ip_address(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})

    resp = await client.post(
        "/printers", headers=headers,
        json={"name": "Kitchen", "printer_type": "kitchen", "host": "10.0.0.5"},
    )
    assert resp.status_code == 201
    assert resp.json()["ip_address"] == "10.0.0.5"


async def test_invalid_printer_type_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})

    resp = await client.post(
        "/printers", headers=headers, json={"name": "x", "printer_type": "fax_machine"}
    )
    assert resp.status_code == 422


async def test_invalid_connection_type_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})

    resp = await client.post(
        "/printers", headers=headers,
        json={"name": "x", "printer_type": "receipt", "connection_type": "bluetooth"},
    )
    assert resp.status_code == 422


async def test_sensitive_settings_masked(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})

    created = await client.post(
        "/printers", headers=headers,
        json={
            "name": "Cloud", "printer_type": "receipt",
            "settings": {"api_key": "sk-real-secret", "encoding": "cp866"},
        },
    )
    assert created.status_code == 201
    assert created.json()["settings"]["api_key"] == "••••••"
    assert created.json()["settings"]["encoding"] == "cp866"

    got = await client.get(f"/printers/{created.json()['id']}", headers=headers)
    assert got.json()["settings"]["api_key"] == "••••••"


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

    resp = await client.post(
        "/printers", headers=cashier_headers, json={"name": "x", "printer_type": "receipt"}
    )
    assert resp.status_code == 403


async def test_printer_scoped_per_company(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")
    await client.post("/companies/me/branches", headers=a_headers, json={"name": "Main"})

    created = await client.post(
        "/printers", headers=a_headers, json={"name": "Receipt", "printer_type": "receipt"}
    )
    printer_id = created.json()["id"]

    resp = await client.get(f"/printers/{printer_id}", headers=b_headers)
    assert resp.status_code == 404

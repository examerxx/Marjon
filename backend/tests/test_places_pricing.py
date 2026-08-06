from __future__ import annotations

from tests.conftest import register_company


async def test_frontend_payload_shape_now_works(client):
    """SettingsPlacesPage.jsx's apiMapFormToPayload sends
    {name, condition, percent, payment_type} to /halls, with no branch_id
    and `payment_type` holding a Russian pricing-model label. This used to
    always 422 (branch_id was required)."""
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    branch = await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})
    branch_id = branch.json()["id"]

    resp = await client.post(
        "/halls", headers=headers,
        json={"name": "ЗАЛЛ", "condition": "10%", "percent": 10, "payment_type": "процент"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["pricing_type"] == "percent"
    assert body["branch_id"] == branch_id
    assert body["condition"] == "10%"
    assert float(body["percent"]) == 10.0


async def test_branch_id_auto_resolves_when_omitted(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    branch = await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})
    branch_id = branch.json()["id"]

    resp = await client.post("/halls", headers=headers, json={"name": "Bar"})
    assert resp.status_code == 201
    assert resp.json()["branch_id"] == branch_id


async def test_no_branch_gives_clear_error(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.post("/halls", headers=headers, json={"name": "Bar"})
    assert resp.status_code == 404


async def test_all_pricing_type_labels_translate(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})

    cases = {
        "процент": "percent",
        "цена за час": "hourly",
        "фиксированная цена": "fixed",
        "цена по времени": "time_based",
    }
    for label, expected in cases.items():
        resp = await client.post(
            "/halls", headers=headers, json={"name": f"Place {label}", "payment_type": label}
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["pricing_type"] == expected


async def test_invalid_pricing_type_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})

    resp = await client.post(
        "/halls", headers=headers, json={"name": "x", "pricing_type": "not_real"}
    )
    assert resp.status_code == 422


async def test_percent_out_of_range_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})

    resp = await client.post("/halls", headers=headers, json={"name": "x", "percent": 150})
    assert resp.status_code == 422


async def test_update_pricing_fields(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})
    created = await client.post("/halls", headers=headers, json={"name": "VIP"})
    hall_id = created.json()["id"]

    resp = await client.patch(
        f"/halls/{hall_id}", headers=headers,
        json={"payment_type": "фиксированная цена", "percent": 5},
    )
    assert resp.status_code == 200
    assert resp.json()["pricing_type"] == "fixed"
    assert float(resp.json()["percent"]) == 5.0


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

    denied = await client.post("/halls", headers=cashier_headers, json={"name": "x"})
    assert denied.status_code == 403

    allowed = await client.get("/halls", headers=cashier_headers)
    assert allowed.status_code == 200


async def test_place_scoped_per_company(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")
    await client.post("/companies/me/branches", headers=a_headers, json={"name": "Main"})

    created = await client.post("/halls", headers=a_headers, json={"name": "VIP"})
    hall_id = created.json()["id"]

    resp = await client.get(f"/halls/{hall_id}", headers=b_headers)
    assert resp.status_code == 404

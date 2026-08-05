from __future__ import annotations

from tests.conftest import register_company


async def test_existing_frontend_payload_still_works(client):
    """SettingsProfilePage always sends name/phone/address/inn/currency,
    including blank strings for fields the company hasn't set yet."""
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch(
        "/companies/me", headers=headers,
        json={"name": "Acme Cafe", "phone": "", "address": "", "inn": "", "currency": "UZS"},
    )
    assert resp.status_code == 200, resp.text


async def test_vat_rate_and_service_fee_actually_save(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch(
        "/companies/me", headers=headers,
        json={"vat_rate": 12, "service_fee": 10},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["vat_rate"] == 12.0
    assert body["service_fee"] == 10.0

    get_resp = await client.get("/companies/me", headers=headers)
    assert get_resp.json()["vat_rate"] == 12.0


async def test_unknown_field_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch("/companies/me", headers=headers, json={"made_up_field": "x"})
    assert resp.status_code == 422


async def test_invalid_phone_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch("/companies/me", headers=headers, json={"phone": "not-a-phone"})
    assert resp.status_code == 422


async def test_invalid_inn_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch("/companies/me", headers=headers, json={"inn": "abc"})
    assert resp.status_code == 422


async def test_invalid_currency_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch("/companies/me", headers=headers, json={"currency": "dollars"})
    assert resp.status_code == 422


async def test_currency_normalized_to_uppercase(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch("/companies/me", headers=headers, json={"currency": "usd"})
    assert resp.status_code == 200
    assert resp.json()["currency"] == "USD"


async def test_vat_rate_out_of_range_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.patch("/companies/me", headers=headers, json={"vat_rate": 150})
    assert resp.status_code == 422


async def test_company_update_requires_company_admin(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    staff = await client.post(
        "/auth/users", headers=owner_headers,
        json={"email": "cashier@acme.example.com", "password": "Passw0rd!", "role_slug": "cashier"},
    )
    login = await client.post(
        "/auth/login", json={"email": "cashier@acme.example.com", "password": "Passw0rd!"}
    )
    cashier_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    resp = await client.patch("/companies/me", headers=cashier_headers, json={"name": "Hacked"})
    assert resp.status_code == 403

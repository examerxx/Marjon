from __future__ import annotations

from tests.conftest import register_company


async def _create_staff(client, owner_headers, *, email, role_slug="cashier",
                         phone=None, password="Passw0rd!"):
    resp = await client.post(
        "/auth/users", headers=owner_headers,
        json={"email": email, "password": password, "role_slug": role_slug, "phone": phone},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_staff_update_supports_all_spec_fields(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    staff = await _create_staff(client, owner_headers, email="cashier@acme.example.com")

    resp = await client.patch(
        f"/auth/users/{staff['id']}", headers=owner_headers,
        json={
            "name": "New Name", "phone": "+998901112233",
            "role_slug": "waiter", "is_active": False,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "New Name"
    assert body["phone"] == "+998901112233"
    assert body["role_slug"] == "waiter"
    assert body["is_active"] is False


async def test_deactivated_staff_can_be_reactivated(client):
    """BE-07: is_active was previously not a PATCH-able field, and the
    staff list filtered to is_active == True — so a deactivated employee
    became permanently unrecoverable through the API."""
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    staff = await _create_staff(client, owner_headers, email="cashier@acme.example.com")

    deactivate = await client.patch(
        f"/auth/users/{staff['id']}", headers=owner_headers, json={"is_active": False}
    )
    assert deactivate.status_code == 200
    assert deactivate.json()["is_active"] is False

    listing = await client.get("/auth/users", headers=owner_headers)
    assert any(u["id"] == staff["id"] for u in listing.json())

    reactivate = await client.patch(
        f"/auth/users/{staff['id']}", headers=owner_headers, json={"is_active": True}
    )
    assert reactivate.status_code == 200
    assert reactivate.json()["is_active"] is True


async def test_staff_update_rejects_duplicate_phone(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await _create_staff(client, owner_headers, email="a@acme.example.com", phone="+998900000001")
    b = await _create_staff(client, owner_headers, email="b@acme.example.com", phone="+998900000002")

    resp = await client.patch(
        f"/auth/users/{b['id']}", headers=owner_headers, json={"phone": "+998900000001"}
    )
    assert resp.status_code == 409


async def test_staff_update_rejects_duplicate_email(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await _create_staff(client, owner_headers, email="a@acme.example.com")
    b = await _create_staff(client, owner_headers, email="b@acme.example.com")

    resp = await client.patch(
        f"/auth/users/{b['id']}", headers=owner_headers, json={"email": "a@acme.example.com"}
    )
    assert resp.status_code == 409


async def test_staff_update_scoped_to_own_company(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")
    b_staff = await _create_staff(client, b_headers, email="cashier@beta.example.com")

    resp = await client.patch(
        f"/auth/users/{b_staff['id']}", headers=a_headers, json={"name": "Hacked"}
    )
    assert resp.status_code == 404


async def test_staff_update_requires_company_admin_role(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    staff = await _create_staff(client, owner_headers, email="cashier@acme.example.com")

    login = await client.post(
        "/auth/login", json={"email": "cashier@acme.example.com", "password": "Passw0rd!"}
    )
    cashier_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    resp = await client.patch(
        f"/auth/users/{staff['id']}", headers=cashier_headers, json={"name": "Self promote"}
    )
    assert resp.status_code == 403


async def test_staff_update_requires_auth(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    staff = await _create_staff(client, owner_headers, email="cashier@acme.example.com")

    resp = await client.patch(f"/auth/users/{staff['id']}", json={"name": "x"})
    assert resp.status_code == 401

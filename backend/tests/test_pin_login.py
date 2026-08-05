from __future__ import annotations
import uuid

from tests.conftest import register_company


async def _create_staff(client, owner_headers, *, email, role_slug="cashier"):
    resp = await client.post(
        "/auth/users", headers=owner_headers,
        json={"email": email, "password": "Passw0rd!", "role_slug": role_slug},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_pin_set_and_login_round_trip(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    staff = await _create_staff(client, owner_headers, email="cashier@acme.example.com")

    setpin = await client.patch(
        f"/auth/users/{staff['id']}/pin", headers=owner_headers, json={"pin": "1234"}
    )
    assert setpin.status_code == 204

    login = await client.post("/auth/pin-login", json={"employee_id": staff["id"], "pin": "1234"})
    assert login.status_code == 200
    assert login.json()["access_token"]


async def test_pin_rejects_invalid_format(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    staff = await _create_staff(client, owner_headers, email="cashier@acme.example.com")

    for bad_pin in ("12", "abcd", "123456789"):
        resp = await client.patch(
            f"/auth/users/{staff['id']}/pin", headers=owner_headers, json={"pin": bad_pin}
        )
        assert resp.status_code == 422, f"pin={bad_pin!r} -> {resp.status_code}"


async def test_pin_wrong_value_rejected(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    staff = await _create_staff(client, owner_headers, email="cashier@acme.example.com")
    await client.patch(f"/auth/users/{staff['id']}/pin", headers=owner_headers, json={"pin": "1234"})

    resp = await client.post("/auth/pin-login", json={"employee_id": staff["id"], "pin": "0000"})
    assert resp.status_code == 401


async def test_pin_login_unknown_employee_returns_401_not_404(client):
    """No user enumeration via the PIN endpoint."""
    resp = await client.post(
        "/auth/pin-login", json={"employee_id": str(uuid.uuid4()), "pin": "1234"}
    )
    assert resp.status_code == 401


async def test_pin_unique_within_company(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    a = await _create_staff(client, owner_headers, email="a@acme.example.com")
    b = await _create_staff(client, owner_headers, email="b@acme.example.com")

    await client.patch(f"/auth/users/{a['id']}/pin", headers=owner_headers, json={"pin": "1111"})
    resp = await client.patch(f"/auth/users/{b['id']}/pin", headers=owner_headers, json={"pin": "1111"})
    assert resp.status_code == 409


async def test_pin_can_be_reused_across_different_companies(client):
    """Uniqueness is scoped to company, not global."""
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")
    a_staff = await _create_staff(client, a_headers, email="cashier@alpha.example.com")
    b_staff = await _create_staff(client, b_headers, email="cashier@beta.example.com")

    r1 = await client.patch(f"/auth/users/{a_staff['id']}/pin", headers=a_headers, json={"pin": "2222"})
    r2 = await client.patch(f"/auth/users/{b_staff['id']}/pin", headers=b_headers, json={"pin": "2222"})
    assert r1.status_code == 204
    assert r2.status_code == 204


async def test_pin_locks_after_repeated_failures(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    staff = await _create_staff(client, owner_headers, email="cashier@acme.example.com")
    await client.patch(f"/auth/users/{staff['id']}/pin", headers=owner_headers, json={"pin": "1234"})

    for _ in range(5):
        resp = await client.post("/auth/pin-login", json={"employee_id": staff["id"], "pin": "0000"})
        assert resp.status_code == 401

    # Correct PIN, but account is now locked.
    locked = await client.post("/auth/pin-login", json={"employee_id": staff["id"], "pin": "1234"})
    assert locked.status_code == 401


async def test_pin_reset_clears_lockout(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    staff = await _create_staff(client, owner_headers, email="cashier@acme.example.com")
    await client.patch(f"/auth/users/{staff['id']}/pin", headers=owner_headers, json={"pin": "1234"})

    for _ in range(5):
        await client.post("/auth/pin-login", json={"employee_id": staff["id"], "pin": "0000"})

    reset = await client.patch(f"/auth/users/{staff['id']}/pin", headers=owner_headers, json={"pin": "5678"})
    assert reset.status_code == 204

    login = await client.post("/auth/pin-login", json={"employee_id": staff["id"], "pin": "5678"})
    assert login.status_code == 200


async def test_pin_set_requires_company_admin(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    staff = await _create_staff(client, owner_headers, email="cashier@acme.example.com")

    login = await client.post(
        "/auth/login", json={"email": "cashier@acme.example.com", "password": "Passw0rd!"}
    )
    cashier_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    resp = await client.patch(
        f"/auth/users/{staff['id']}/pin", headers=cashier_headers, json={"pin": "9999"}
    )
    assert resp.status_code == 403


async def test_pin_set_scoped_to_own_company(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")
    b_staff = await _create_staff(client, b_headers, email="cashier@beta.example.com")

    resp = await client.patch(
        f"/auth/users/{b_staff['id']}/pin", headers=a_headers, json={"pin": "1234"}
    )
    assert resp.status_code == 404

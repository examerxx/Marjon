from __future__ import annotations

from tests.conftest import register_company


async def _create_staff(client, owner_headers, *, email, role_slug, password="Passw0rd!"):
    resp = await client.post(
        "/auth/users",
        headers=owner_headers,
        json={"email": email, "password": password, "role_slug": role_slug},
    )
    return resp


async def _login(client, email, password="Passw0rd!"):
    resp = await client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_owner_gets_full_permission_set(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.get("/rbac/me/permissions", headers=owner_headers)
    assert resp.status_code == 200
    perms = resp.json()
    assert "finance:manage" in perms
    assert "inventory:stock:write" in perms
    assert len(perms) >= 30  # every seeded permission


async def test_unknown_role_slug_is_rejected(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await _create_staff(client, owner_headers, email="x@acme.example.com", role_slug="hacker_god")
    assert resp.status_code == 422


async def test_cashier_gets_restricted_permission_set(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    created = await _create_staff(client, owner_headers, email="cashier@acme.example.com", role_slug="cashier")
    assert created.status_code == 201, created.text

    cashier_headers = await _login(client, "cashier@acme.example.com")
    resp = await client.get("/rbac/me/permissions", headers=cashier_headers)
    assert resp.status_code == 200
    perms = set(resp.json())
    assert "finance:manage" not in perms
    assert "inventory:stock:write" not in perms
    assert "pos:orders:create" in perms


async def test_cashier_cannot_write_finance_but_can_read(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await _create_staff(client, owner_headers, email="cashier@acme.example.com", role_slug="cashier")
    cashier_headers = await _login(client, "cashier@acme.example.com")

    denied = await client.post(
        "/finance/payment-types", headers=cashier_headers, json={"name": "Cash", "type": "cash"}
    )
    assert denied.status_code == 403

    created = await client.post(
        "/finance/payment-types", headers=owner_headers, json={"name": "Cash", "type": "cash"}
    )
    assert created.status_code == 201

    read = await client.get("/finance/payment-types", headers=cashier_headers)
    assert read.status_code == 200


async def test_warehouse_role_can_manage_warehouse_but_cashier_cannot(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await _create_staff(client, owner_headers, email="cashier@acme.example.com", role_slug="cashier")
    await _create_staff(client, owner_headers, email="wh@acme.example.com", role_slug="warehouse")
    cashier_headers = await _login(client, "cashier@acme.example.com")
    wh_headers = await _login(client, "wh@acme.example.com")

    denied = await client.post("/warehouse/list", headers=cashier_headers, json={"name": "Illegal"})
    assert denied.status_code == 403

    allowed = await client.post("/warehouse/list", headers=wh_headers, json={"name": "Main"})
    assert allowed.status_code == 201, allowed.text


async def test_role_permission_grant_and_revoke_take_effect_live(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await _create_staff(client, owner_headers, email="cashier@acme.example.com", role_slug="cashier")
    cashier_headers = await _login(client, "cashier@acme.example.com")

    roles = (await client.get("/rbac/roles", headers=owner_headers)).json()
    cashier_role = next(r for r in roles if r["slug"] == "cashier")

    catalog = (await client.get("/rbac/permissions", headers=owner_headers)).json()
    finance_manage = next(p for p in catalog if p["module"] == "finance" and p["action"] == "manage")

    # Before grant: denied
    denied = await client.post(
        "/finance/payment-types", headers=cashier_headers, json={"name": "Card", "type": "card"}
    )
    assert denied.status_code == 403

    grant = await client.post(
        f"/rbac/roles/{cashier_role['id']}/permissions",
        headers=owner_headers,
        json={"permission_id": finance_manage["id"]},
    )
    assert grant.status_code == 204

    # After grant, same token, no re-login: allowed
    allowed = await client.post(
        "/finance/payment-types", headers=cashier_headers, json={"name": "Card", "type": "card"}
    )
    assert allowed.status_code == 201

    revoke = await client.delete(
        f"/rbac/roles/{cashier_role['id']}/permissions/{finance_manage['id']}",
        headers=owner_headers,
    )
    assert revoke.status_code == 204

    denied_again = await client.post(
        "/finance/payment-types", headers=cashier_headers, json={"name": "Transfer", "type": "card"}
    )
    assert denied_again.status_code == 403


async def test_role_permission_management_is_tenant_scoped(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")

    a_roles = (await client.get("/rbac/roles", headers=a_headers)).json()
    a_owner_role = next(r for r in a_roles if r["slug"] == "owner")

    catalog = (await client.get("/rbac/permissions", headers=b_headers)).json()
    some_perm = catalog[0]

    # Company B must not be able to modify company A's role.
    resp = await client.post(
        f"/rbac/roles/{a_owner_role['id']}/permissions",
        headers=b_headers,
        json={"permission_id": some_perm["id"]},
    )
    assert resp.status_code == 404

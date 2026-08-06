from __future__ import annotations

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.auth.models import User
from app.modules.auth.security import hash_password
from tests.conftest import register_company


async def _create_superadmin(db_engine, email="root@marjon.local", password="RootPass1!"):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        session.add(User(
            email=email, password_hash=hash_password(password),
            is_superadmin=True, is_active=True,
        ))
        await session.commit()
    return email, password


async def _hq_login(client, db_engine):
    email, password = await _create_superadmin(db_engine)
    login = await client.post("/auth/admin/login", json={"email": email, "password": password})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def test_directory_includes_aggregate_fields(client, db_engine):
    hq_headers = await _hq_login(client, db_engine)
    created = await client.post(
        "/organizations", headers=hq_headers,
        json={"name": "Test Org", "type": "cafe", "tariff_price": 100000, "working_days": 30},
    )
    assert created.status_code == 201
    org_id = created.json()["id"]

    listing = await client.get("/organizations", headers=hq_headers)
    assert listing.status_code == 200
    body = listing.json()
    assert "items" in body and "total" in body

    found = next(i for i in body["items"] if i["id"] == org_id)
    assert found["type"] == "cafe"
    assert "owner_name" in found
    assert "admin_name" in found
    assert "branches_count" in found
    # No fabricated data: no link exists yet, so these are honestly null,
    # not a fake 0/placeholder.
    assert found["owner_name"] is None
    assert found["admin_name"] is None
    assert found["branches_count"] is None


async def test_directory_owner_name_populates_when_linked(client, db_engine):
    hq_headers = await _hq_login(client, db_engine)
    created = await client.post("/organizations", headers=hq_headers, json={"name": "Test Org"})
    org_id = created.json()["id"]

    account = await client.post(
        "/accounts", headers=hq_headers,
        json={
            "username": "orgowner", "password": "Passw0rd!", "name": "Иван Иванов",
            "role_slug": "owner", "organization_ids": [org_id],
        },
    )
    assert account.status_code == 201

    listing = await client.get("/organizations", headers=hq_headers)
    found = next(i for i in listing.json()["items"] if i["id"] == org_id)
    assert found["owner_name"] == "Иван Иванов"


async def test_directory_status_filter_still_works(client, db_engine):
    """The admin frontend calls GET /organizations?status=active directly
    (adminFinanceApi.listOrganizations) — must keep working after the
    custom aggregate handler replaced the generic crud_router list."""
    hq_headers = await _hq_login(client, db_engine)
    await client.post("/organizations", headers=hq_headers, json={"name": "Active Org"})

    resp = await client.get("/organizations", headers=hq_headers, params={"status": "active"})
    assert resp.status_code == 200
    assert all(i["status"] == "active" for i in resp.json()["items"])


async def test_directory_search_filter(client, db_engine):
    hq_headers = await _hq_login(client, db_engine)
    await client.post("/organizations", headers=hq_headers, json={"name": "Findable Org"})

    resp = await client.get("/organizations", headers=hq_headers, params={"search": "Findable"})
    assert resp.status_code == 200
    assert any(i["name"] == "Findable Org" for i in resp.json()["items"])


async def test_directory_requires_hq_admin(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.get("/organizations", headers=owner_headers)
    assert resp.status_code == 403


async def test_directory_requires_auth(client):
    resp = await client.get("/organizations")
    assert resp.status_code == 401


async def test_single_organization_crud_unaffected(client, db_engine):
    """GET/PATCH /organizations/{id} still go through the plain
    crud_router endpoints, untouched by the custom list handler."""
    hq_headers = await _hq_login(client, db_engine)
    created = await client.post("/organizations", headers=hq_headers, json={"name": "Org"})
    org_id = created.json()["id"]

    get_resp = await client.get(f"/organizations/{org_id}", headers=hq_headers)
    assert get_resp.status_code == 200

    patch_resp = await client.patch(f"/organizations/{org_id}", headers=hq_headers, json={"type": "bar"})
    assert patch_resp.status_code == 200
    assert patch_resp.json()["type"] == "bar"

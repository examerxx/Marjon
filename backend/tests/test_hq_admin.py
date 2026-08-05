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


async def test_admin_login_rejects_wrong_password(client, db_engine):
    email, _ = await _create_superadmin(db_engine)
    resp = await client.post("/auth/admin/login", json={"email": email, "password": "wrong"})
    assert resp.status_code == 401


async def test_admin_login_rejects_non_superadmin(client):
    await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.post(
        "/auth/admin/login", json={"email": "owner@acme.example.com", "password": "Passw0rd!"}
    )
    assert resp.status_code == 403


async def test_admin_login_succeeds_for_superadmin(client, db_engine):
    email, password = await _create_superadmin(db_engine)
    resp = await client.post("/auth/admin/login", json={"email": email, "password": password})
    assert resp.status_code == 200
    assert resp.json()["access_token"]


async def test_hq_endpoint_rejects_unauthenticated(client):
    resp = await client.get("/organizations")
    assert resp.status_code == 401


async def test_hq_endpoint_rejects_regular_owner_session(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.get("/organizations", headers=headers)
    assert resp.status_code == 403


async def test_hq_endpoint_allows_hq_admin_session(client, db_engine):
    email, password = await _create_superadmin(db_engine)
    login = await client.post("/auth/admin/login", json={"email": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    resp = await client.get("/organizations", headers=headers)
    assert resp.status_code == 200


async def test_superadmin_via_regular_login_cannot_reach_hq_endpoint(client, db_engine):
    """A superadmin token issued by /auth/login (not /auth/admin/login) must
    NOT pass require_hq_admin — auth_scope, not just the is_superadmin flag,
    gates HQ endpoints (BE-01/BE-02)."""
    email, password = await _create_superadmin(db_engine)
    login = await client.post("/auth/login", json={"email": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    resp = await client.get("/organizations", headers=headers)
    assert resp.status_code == 403

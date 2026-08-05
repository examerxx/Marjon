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


async def test_tasks_reject_regular_company_session(client):
    """BE-03: /tasks used to accept any get_current_user (any authenticated
    company owner/staff could read/write the HQ task board)."""
    owner_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    resp = await client.get("/tasks", headers=owner_headers)
    assert resp.status_code == 403


async def test_tasks_allow_hq_admin_session(client, db_engine):
    email, password = await _create_superadmin(db_engine)
    login = await client.post("/auth/admin/login", json={"email": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    resp = await client.get("/tasks", headers=headers)
    assert resp.status_code == 200

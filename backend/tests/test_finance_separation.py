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


async def test_kafe_finance_transactions_are_scoped_per_company(client):
    """BE-04: /finance/transactions (kafe_compat, unprefixed) used to be
    shadowed by the HQ router and, before that fix, was unfiltered — every
    company saw every other company's transactions."""
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")

    created = await client.post(
        "/finance/transactions", headers=a_headers,
        json={"amount": 1000, "direction": "income", "comment": "Alpha sale"},
    )
    assert created.status_code == 201, created.text

    b_list = await client.get("/finance/transactions", headers=b_headers)
    assert b_list.status_code == 200
    assert b_list.json()["count"] == 0

    a_list = await client.get("/finance/transactions", headers=a_headers)
    assert a_list.json()["count"] == 1


async def test_cannot_patch_other_companys_kafe_transaction(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")

    created = await client.post(
        "/finance/transactions", headers=a_headers,
        json={"amount": 500, "direction": "expense"},
    )
    tx_id = created.json()["id"]

    resp = await client.patch(
        f"/finance/transactions/{tx_id}", headers=b_headers, json={"amount": 1}
    )
    assert resp.status_code == 404


async def test_hq_finance_transactions_requires_hq_admin(client):
    owner_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    resp = await client.get("/hq/finance/transactions", headers=owner_headers)
    assert resp.status_code == 403


async def test_hq_finance_transactions_reachable_by_hq_admin(client, db_engine):
    email, password = await _create_superadmin(db_engine)
    login = await client.post("/auth/admin/login", json={"email": email, "password": password})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    resp = await client.get("/hq/finance/transactions", headers=headers)
    assert resp.status_code == 200

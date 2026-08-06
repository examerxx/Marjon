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


async def test_payment_type_accepts_owner_app_field_names(client):
    """SettingsPaymentMethodsPage.jsx sends sort_order (not sort) and reads
    is_active (not status) — previously silently dropped/always-True."""
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.post(
        "/finance/payment-types", headers=headers, json={"name": "Click", "sort_order": 5}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["sort"] == 5
    assert body["sort_order"] == 5
    assert body["is_active"] is True


async def test_payment_type_deactivation_reflects_in_is_active(client):
    """Regression: the frontend read item.is_active, which never existed
    in the response, so `undefined !== false` made every payment type
    display as Active regardless of its real status."""
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    created = await client.post("/finance/payment-types", headers=headers, json={"name": "Click"})
    pt_id = created.json()["id"]

    deactivated = await client.patch(
        f"/finance/payment-types/{pt_id}", headers=headers, json={"is_active": False}
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] is False
    assert deactivated.json()["is_active"] is False

    listing = await client.get("/finance/payment-types", headers=headers)
    found = next(i for i in listing.json()["items"] if i["id"] == pt_id)
    assert found["is_active"] is False


async def test_payment_type_canonical_names_still_work(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.post(
        "/finance/payment-types", headers=headers, json={"name": "Cash", "sort": 1, "status": True}
    )
    assert resp.status_code == 201
    assert resp.json()["sort"] == 1


async def test_units_readable_by_regular_owner(client):
    """Unit has no company_id (a genuinely global picklist), but
    SettingsUnitsPage.jsx is an owner-app screen — it could never even
    list units before (require_hq_admin on every crud_router endpoint
    including GET), so it always silently showed hardcoded demo rows."""
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.get("/units", headers=headers)
    assert resp.status_code == 200


async def test_units_write_still_requires_hq_admin(client):
    """Writes stay HQ-only — it's a shared, cross-tenant resource; a
    careless edit from one company would affect every company."""
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.post("/units", headers=headers, json={"name": "Kilogram"})
    assert resp.status_code == 403


async def test_unit_accepts_owner_app_field_names_and_is_visible_to_owners(client, db_engine):
    email, password = await _create_superadmin(db_engine)
    login = await client.post("/auth/admin/login", json={"email": email, "password": password})
    hq_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    created = await client.post(
        "/units", headers=hq_headers, json={"name": "Kilogram", "short_name": "kg", "sort_order": 2}
    )
    assert created.status_code == 201
    body = created.json()
    assert body["sort"] == 2
    assert body["sort_order"] == 2

    off = await client.patch(f"/units/{body['id']}", headers=hq_headers, json={"is_active": False})
    assert off.status_code == 200
    assert off.json()["status"] is False

    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    listing = await client.get("/units", headers=owner_headers)
    items = listing.json()["items"] if isinstance(listing.json(), dict) and "items" in listing.json() else listing.json()
    assert any(u["id"] == body["id"] for u in items)

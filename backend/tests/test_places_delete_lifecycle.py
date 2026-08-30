"""Phase 5C-6D — Hall delete/archive state (deleted_at) vs inactive (is_active).

Fast SQLite coverage proving DELETE archives a hall out of Settings while
PATCH is_active=false only marks it inactive-and-still-visible; that history
(Tables) is preserved; that deleted halls leave list/reorder/operational
scopes; and that ordering stays deterministic after a delete.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.halls.models import Hall, Table
from tests.conftest import register_company


async def _branches(client, headers):
    resp = await client.get("/companies/me/branches", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _create(client, headers, name, **extra):
    resp = await client.post("/halls", headers=headers, json={"name": name, **extra})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _list(client, headers, *, include_inactive=False):
    params = {"include_inactive": "true"} if include_inactive else {}
    resp = await client.get("/halls", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _names(client, headers, *, include_inactive=False):
    return [h["name"] for h in await _list(client, headers, include_inactive=include_inactive)]


# ── State separation: inactive != deleted ──────────────────────────────────

async def test_patch_inactive_keeps_hall_visible_and_not_deleted(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    hall = await _create(client, headers, "Зал")
    resp = await client.patch(f"/halls/{hall['id']}", headers=headers, json={"is_active": False})
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is False
    # Still present in the archive-inclusive Settings list — inactive, NOT deleted.
    assert "Зал" in await _names(client, headers, include_inactive=True)


async def test_delete_removes_hall_from_settings_directory(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    a = await _create(client, headers, "A")
    await _create(client, headers, "B")
    assert (await client.delete(f"/halls/{a['id']}", headers=headers)).status_code == 204
    # Gone from BOTH the default and the include_inactive Settings directory.
    assert await _names(client, headers) == ["B"]
    assert await _names(client, headers, include_inactive=True) == ["B"]


async def test_inactive_hall_can_then_be_deleted(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    a = await _create(client, headers, "A")
    await client.patch(f"/halls/{a['id']}", headers=headers, json={"is_active": False})
    assert "A" in await _names(client, headers, include_inactive=True)
    assert (await client.delete(f"/halls/{a['id']}", headers=headers)).status_code == 204
    # Deleting an already-inactive hall yields the same final result: it's gone.
    assert "A" not in await _names(client, headers, include_inactive=True)


async def test_deleted_hall_not_addressable_for_management(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    a = await _create(client, headers, "A")
    await client.delete(f"/halls/{a['id']}", headers=headers)
    # get / edit / tables all 404 for a deleted hall.
    assert (await client.get(f"/halls/{a['id']}", headers=headers)).status_code == 404
    assert (await client.patch(f"/halls/{a['id']}", headers=headers, json={"name": "X"})).status_code == 404
    assert (await client.get(f"/halls/{a['id']}/tables", headers=headers)).status_code == 404


async def test_foreign_tenant_delete_rejected(client):
    a_headers, _ = await register_company(client, slug="alpha", email="o@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="o@beta.example.com")
    foreign = await _create(client, b_headers, "Foreign")
    assert (await client.delete(f"/halls/{foreign['id']}", headers=a_headers)).status_code == 404
    # Still present for its real owner — nothing was archived cross-tenant.
    assert "Foreign" in await _names(client, b_headers, include_inactive=True)


# ── History preserved (soft archive, never a hard delete) ──────────────────

async def test_delete_preserves_hall_row_and_child_tables(client, db_engine):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    a = await _create(client, headers, "A")
    created = await client.post(
        f"/halls/{a['id']}/tables", headers=headers, json={"number": 5, "capacity": 4}
    )
    assert created.status_code == 201, created.text
    assert (await client.delete(f"/halls/{a['id']}", headers=headers)).status_code == 204

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        hall_id = UUID(a["id"])
        hall = (await session.execute(select(Hall).where(Hall.id == hall_id))).scalar_one()
        # Row still exists, archived via deleted_at (NOT physically removed).
        assert hall.deleted_at is not None
        tables = (await session.execute(select(Table).where(Table.hall_id == hall_id))).scalars().all()
        # Table history preserved (not hard-deleted); deactivated so it is not
        # operationally selectable under an archived hall.
        assert len(tables) == 1
        assert tables[0].number == 5
        assert tables[0].is_active is False


# ── Reorder excludes deleted; ordering stays deterministic ─────────────────

async def test_reorder_complete_set_excludes_deleted_and_compacts(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    branch_id = (await _branches(client, headers))[0]["id"]
    a = await _create(client, headers, "A")  # sort_order 0
    b = await _create(client, headers, "B")  # sort_order 1
    c = await _create(client, headers, "C")  # sort_order 2
    assert (await client.delete(f"/halls/{b['id']}", headers=headers)).status_code == 204

    # After delete, remaining halls are compacted to a contiguous 0..n-1.
    rows = await _list(client, headers, include_inactive=True)
    assert [r["name"] for r in rows] == ["A", "C"]
    assert [r["sort_order"] for r in rows] == [0, 1]

    # Complete-list reorder now means the NON-DELETED set only.
    ok = await client.patch(
        "/halls/reorder", headers=headers,
        json={"branch_id": branch_id, "hall_ids": [c["id"], a["id"]]},
    )
    assert ok.status_code == 200, ok.text
    assert [r["name"] for r in ok.json()] == ["C", "A"]

    # Including the DELETED hall's id breaks the complete-set match → 409.
    bad = await client.patch(
        "/halls/reorder", headers=headers,
        json={"branch_id": branch_id, "hall_ids": [c["id"], a["id"], b["id"]]},
    )
    assert bad.status_code == 409, bad.text

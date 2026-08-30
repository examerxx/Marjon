"""Phase 5C-6A — branch-scoped persistent Hall ordering (behavioural).

Fast SQLite coverage of the create-append semantics, deterministic list order,
the complete-list reorder contract, its rejections, and the invariants that the
reorder must never violate (branch_id / is_active / pricing / tables). The
PostgreSQL DB-authority proofs (migration upgrade, deterministic backfill,
downgrade/re-upgrade, nullability, index) live in
``test_hall_ordering_postgres.py``.
"""
from __future__ import annotations

from uuid import uuid4

from tests.conftest import register_company


async def _branches(client, headers):
    resp = await client.get("/companies/me/branches", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _create_hall(client, headers, name, *, branch_id=None, **extra):
    payload = {"name": name, **extra}
    if branch_id is not None:
        payload["branch_id"] = branch_id
    resp = await client.post("/halls", headers=headers, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _list(client, headers, *, branch_id=None, include_inactive=False):
    params = {}
    if branch_id is not None:
        params["branch_id"] = branch_id
    if include_inactive:
        params["include_inactive"] = "true"
    resp = await client.get("/halls", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _reorder(client, headers, branch_id, hall_ids):
    return await client.patch(
        "/halls/reorder",
        headers=headers,
        json={"branch_id": branch_id, "hall_ids": hall_ids},
    )


# PLACEHOLDER_APPEND

# ── Create append semantics ────────────────────────────────────────────────

async def test_create_appends_to_branch_end_zero_based(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    a = await _create_hall(client, headers, "Зал A")
    b = await _create_hall(client, headers, "Зал B")
    c = await _create_hall(client, headers, "Зал C")
    assert [a["sort_order"], b["sort_order"], c["sort_order"]] == [0, 1, 2]


async def test_list_is_ordered_by_sort_order(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    branch_id = (await _branches(client, headers))[0]["id"]
    for name in ("A", "B", "C"):
        await _create_hall(client, headers, name)
    rows = await _list(client, headers, branch_id=branch_id)
    assert [r["name"] for r in rows] == ["A", "B", "C"]
    assert [r["sort_order"] for r in rows] == [0, 1, 2]


async def test_each_branch_numbers_independently_from_zero(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    first_branch = (await _branches(client, headers))[0]["id"]
    second = await client.post(
        "/companies/me/branches", headers=headers, json={"name": "Второй филиал"}
    )
    second_branch = second.json()["id"]
    a1 = await _create_hall(client, headers, "A1", branch_id=first_branch)
    a2 = await _create_hall(client, headers, "A2", branch_id=first_branch)
    b1 = await _create_hall(client, headers, "B1", branch_id=second_branch)
    # Second branch starts its own numbering at 0, not at the company max.
    assert [a1["sort_order"], a2["sort_order"]] == [0, 1]
    assert b1["sort_order"] == 0


async def test_company_wide_list_groups_by_branch_then_sort_order(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    first_branch = (await _branches(client, headers))[0]["id"]
    second = await client.post(
        "/companies/me/branches", headers=headers, json={"name": "Второй филиал"}
    )
    second_branch = second.json()["id"]
    await _create_hall(client, headers, "A1", branch_id=first_branch)
    await _create_hall(client, headers, "B1", branch_id=second_branch)
    await _create_hall(client, headers, "A2", branch_id=first_branch)
    rows = await _list(client, headers)  # no branch filter → company-wide
    # No fake global drag order: halls are GROUPED by branch (each branch's
    # halls are contiguous, never interleaved), and within a branch they follow
    # sort_order. Which branch group comes first is a stable deterministic rule
    # (Branch.created_at, id) — not asserted here, only the grouping contract.
    branch_of = {r["name"]: r["branch_id"] for r in rows}
    positions = {r["name"]: i for i, r in enumerate(rows)}
    # A1 immediately precedes A2 (same branch, sort_order 0 then 1).
    assert branch_of["A1"] == branch_of["A2"] == first_branch
    assert positions["A2"] == positions["A1"] + 1
    # B1's branch group does not fall BETWEEN A1 and A2 (no interleaving).
    assert not (positions["A1"] < positions["B1"] < positions["A2"])
    # Each branch is contiguous: exactly one contiguous run per branch_id.
    branch_sequence = [r["branch_id"] for r in rows]
    runs = [b for i, b in enumerate(branch_sequence) if i == 0 or b != branch_sequence[i - 1]]
    assert len(runs) == len(set(runs))



# ── Reorder happy path ─────────────────────────────────────────────────────

async def test_reorder_persists_and_returns_canonical_order(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    branch_id = (await _branches(client, headers))[0]["id"]
    a = await _create_hall(client, headers, "A")
    b = await _create_hall(client, headers, "B")
    c = await _create_hall(client, headers, "C")
    resp = await _reorder(client, headers, branch_id, [c["id"], a["id"], b["id"]])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Response is canonical DB state, ordered — not the raw request echo.
    assert [r["name"] for r in body] == ["C", "A", "B"]
    assert [r["sort_order"] for r in body] == [0, 1, 2]
    # Persisted: a fresh list reflects the new order.
    rows = await _list(client, headers, branch_id=branch_id)
    assert [r["name"] for r in rows] == ["C", "A", "B"]


# ── Reorder rejections (all 409/404, never partially applied) ──────────────

async def test_reorder_duplicate_id_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    branch_id = (await _branches(client, headers))[0]["id"]
    a = await _create_hall(client, headers, "A")
    b = await _create_hall(client, headers, "B")
    resp = await _reorder(client, headers, branch_id, [a["id"], a["id"]])
    assert resp.status_code == 409, resp.text
    # Nothing changed.
    rows = await _list(client, headers, branch_id=branch_id)
    assert [r["name"] for r in rows] == ["A", "B"]


async def test_reorder_missing_hall_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    branch_id = (await _branches(client, headers))[0]["id"]
    a = await _create_hall(client, headers, "A")
    await _create_hall(client, headers, "B")
    # Incomplete list (only one of two halls) → rejected.
    resp = await _reorder(client, headers, branch_id, [a["id"]])
    assert resp.status_code == 409, resp.text


async def test_reorder_cross_branch_hall_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    first_branch = (await _branches(client, headers))[0]["id"]
    second = await client.post(
        "/companies/me/branches", headers=headers, json={"name": "Второй филиал"}
    )
    second_branch = second.json()["id"]
    a = await _create_hall(client, headers, "A", branch_id=first_branch)
    other = await _create_hall(client, headers, "OTHER", branch_id=second_branch)
    # A branch-B hall may never appear in a branch-A reorder.
    resp = await _reorder(client, headers, first_branch, [a["id"], other["id"]])
    assert resp.status_code == 409, resp.text
    # Branch B hall keeps its branch and position.
    b_rows = await _list(client, headers, branch_id=second_branch)
    assert [r["name"] for r in b_rows] == ["OTHER"]
    assert b_rows[0]["branch_id"] == second_branch


async def test_reorder_foreign_tenant_hall_rejected(client):
    a_headers, _ = await register_company(client, slug="alpha", email="o@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="o@beta.example.com")
    a_branch = (await _branches(client, a_headers))[0]["id"]
    mine = await _create_hall(client, a_headers, "MINE", branch_id=a_branch)
    foreign = await _create_hall(client, b_headers, "FOREIGN")
    resp = await _reorder(client, a_headers, a_branch, [mine["id"], foreign["id"]])
    assert resp.status_code == 409, resp.text


async def test_reorder_unknown_branch_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    a = await _create_hall(client, headers, "A")
    resp = await _reorder(client, headers, str(uuid4()), [a["id"]])
    assert resp.status_code == 404, resp.text


async def test_reorder_wrong_branch_for_hall_rejected(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    first_branch = (await _branches(client, headers))[0]["id"]
    second = await client.post(
        "/companies/me/branches", headers=headers, json={"name": "Второй филиал"}
    )
    second_branch = second.json()["id"]
    a = await _create_hall(client, headers, "A", branch_id=first_branch)
    # Hall A belongs to branch 1; reordering it under branch 2 is rejected
    # (branch 2's complete set does not contain it).
    resp = await _reorder(client, headers, second_branch, [a["id"]])
    assert resp.status_code == 409, resp.text


# ── Invariants: reorder mutates ONLY sort_order ────────────────────────────

async def test_inactive_hall_participates_and_stays_inactive(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    branch_id = (await _branches(client, headers))[0]["id"]
    a = await _create_hall(
        client, headers, "A", pricing_type="fixed", price_amount="100000.00"
    )
    b = await _create_hall(client, headers, "B")
    # Archive A (soft-delete), then reorder the COMPLETE set incl. the archived
    # hall. Settings must be able to reposition archived halls.
    assert (await client.patch(f"/halls/{a['id']}", headers=headers, json={"is_active": False})).status_code == 200
    resp = await _reorder(client, headers, branch_id, [b["id"], a["id"]])
    assert resp.status_code == 200, resp.text
    rows = {r["name"]: r for r in await _list(client, headers, branch_id=branch_id, include_inactive=True)}
    # Order applied, and A is still archived — reorder never reactivated it.
    assert rows["B"]["sort_order"] == 0
    assert rows["A"]["sort_order"] == 1
    assert rows["A"]["is_active"] is False
    assert rows["B"]["is_active"] is True
    # branch and pricing survived untouched.
    assert rows["A"]["branch_id"] == branch_id
    assert rows["A"]["pricing_type"] == "fixed"
    assert str(rows["A"]["price_amount"]) in ("100000.00", "100000.0", "100000")


async def test_include_inactive_keeps_stored_position(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    branch_id = (await _branches(client, headers))[0]["id"]
    a = await _create_hall(client, headers, "A")  # sort_order 0
    b = await _create_hall(client, headers, "B")  # sort_order 1
    c = await _create_hall(client, headers, "C")  # sort_order 2
    # Archive the MIDDLE hall; it must remain in position 1, not sorted apart.
    assert (await client.patch(f"/halls/{b['id']}", headers=headers, json={"is_active": False})).status_code == 200
    rows = await _list(client, headers, branch_id=branch_id, include_inactive=True)
    assert [r["name"] for r in rows] == ["A", "B", "C"]
    assert [r["sort_order"] for r in rows] == [0, 1, 2]


async def test_reorder_does_not_touch_tables(client):
    headers, _ = await register_company(client, slug="acme", email="o@acme.example.com")
    branch_id = (await _branches(client, headers))[0]["id"]
    a = await _create_hall(client, headers, "A")
    b = await _create_hall(client, headers, "B")
    created = await client.post(
        f"/halls/{a['id']}/tables", headers=headers, json={"number": 5, "capacity": 4}
    )
    assert created.status_code == 201, created.text
    resp = await _reorder(client, headers, branch_id, [b["id"], a["id"]])
    assert resp.status_code == 200, resp.text
    tables = await client.get(f"/halls/{a['id']}/tables", headers=headers)
    assert tables.status_code == 200, tables.text
    assert [t["number"] for t in tables.json()] == [5]

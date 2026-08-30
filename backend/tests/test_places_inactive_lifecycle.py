"""Phase 5C-4 — inactive listing + reactivation contract for Hall/Table.

Lifecycle rules proven here:
  * default listings stay ACTIVE-ONLY (backward compatible); `include_inactive`
    is additive and affects VISIBILITY only — never ownership, never the
    Phase 5C-3 active-number uniqueness rule;
  * deactivating a hall cascades to its still-active tables (soft only);
  * reactivating a hall NEVER resurrects its tables, and requires an active
    parent branch (Phase 5C-1);
  * "hall inactive + table active" is unreachable through the supported API.
"""
from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.companies.models import Branch
from tests.conftest import register_company

INACTIVE_HALL_DETAIL = "Место неактивно — сначала активируйте место"
INACTIVE_BRANCH_DETAIL = "Филиал неактивен"
DUPLICATE_DETAIL = "Стол с таким номером уже существует в этом месте"


async def _owner(client, slug="acme"):
    headers, _ = await register_company(
        client, slug=slug, email=f"owner@{slug}.example.com"
    )
    return headers


async def _hall(client, headers, name="Зал"):
    resp = await client.post("/halls", headers=headers, json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _table(client, headers, hall_id, number, capacity=4):
    resp = await client.post(
        f"/halls/{hall_id}/tables", headers=headers,
        json={"number": number, "capacity": capacity},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _deactivate_all_branches(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        await session.execute(update(Branch).values(is_active=False))
        await session.commit()


async def _branch_rows(db_engine):
    """Branch rows straight from the DB — the /companies/me/branches listing is
    active-only, so it cannot prove the absence of a side effect."""
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        result = await session.execute(select(Branch.id, Branch.is_active))
        return list(result.all())


async def _list_halls(client, headers, *, include_inactive=None):
    params = {} if include_inactive is None else {"include_inactive": include_inactive}
    resp = await client.get("/halls", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _list_tables(client, headers, hall_id, *, include_inactive=None):
    params = {} if include_inactive is None else {"include_inactive": include_inactive}
    resp = await client.get(
        f"/halls/{hall_id}/tables", headers=headers, params=params
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _patch_hall(client, headers, hall_id, payload):
    return await client.patch(f"/halls/{hall_id}", headers=headers, json=payload)


async def _patch_table(client, headers, hall_id, table_id, payload):
    return await client.patch(
        f"/halls/{hall_id}/tables/{table_id}", headers=headers, json=payload
    )


def _by_id(rows, row_id):
    return next((row for row in rows if row["id"] == row_id), None)


def _flags(rows):
    """{number: is_active} for a nested/flat table collection."""
    return {row["number"]: row["is_active"] for row in rows}


# ── §21 Hall listing ──────────────────────────────────────────────────────

async def test_default_hall_list_hides_inactive_hall(client):
    headers = await _owner(client)
    live = await _hall(client, headers, "Зал")
    archived = await _hall(client, headers, "Архив")
    assert (await _patch_hall(client, headers, archived, {"is_active": False})).status_code == 200

    ids = [row["id"] for row in await _list_halls(client, headers)]
    assert ids == [live]
    # explicit false is identical to omitted
    ids_false = [
        row["id"] for row in await _list_halls(client, headers, include_inactive="false")
    ]
    assert ids_false == [live]


async def test_include_inactive_true_lists_inactive_hall(client):
    headers = await _owner(client)
    live = await _hall(client, headers, "Зал")
    archived = await _hall(client, headers, "Архив")
    await _patch_hall(client, headers, archived, {"is_active": False})

    rows = await _list_halls(client, headers, include_inactive="true")
    assert {row["id"] for row in rows} == {live, archived}
    assert _by_id(rows, archived)["is_active"] is False
    assert _by_id(rows, live)["is_active"] is True


async def test_hall_list_tenant_isolation_holds_with_include_inactive(client):
    """include_inactive widens visibility, never ownership."""
    a_headers = await _owner(client, slug="alpha")
    b_headers = await _owner(client, slug="beta")
    a_live = await _hall(client, a_headers, "Зал A")
    a_archived = await _hall(client, a_headers, "Архив A")
    await _patch_hall(client, a_headers, a_archived, {"is_active": False})
    b_live = await _hall(client, b_headers, "Зал B")

    b_rows = await _list_halls(client, b_headers, include_inactive="true")
    assert {row["id"] for row in b_rows} == {b_live}
    a_rows = await _list_halls(client, a_headers, include_inactive="true")
    assert {row["id"] for row in a_rows} == {a_live, a_archived}


async def test_hall_list_branch_filter_still_applies_with_include_inactive(client):
    headers = await _owner(client)
    second = await client.post(
        "/companies/me/branches", headers=headers, json={"name": "Второй филиал"}
    )
    assert second.status_code == 201, second.text
    second_branch = second.json()["id"]
    first_branch = next(
        b["id"]
        for b in (await client.get("/companies/me/branches", headers=headers)).json()
        if b["id"] != second_branch
    )
    resp = await client.post(
        "/halls", headers=headers, json={"name": "VIP", "branch_id": second_branch}
    )
    assert resp.status_code == 201, resp.text
    vip = resp.json()["id"]
    await _patch_hall(client, headers, vip, {"is_active": False})

    rows = await _list_halls(client, headers, include_inactive="true")
    assert {row["id"] for row in rows} == {vip}

    scoped = await client.get(
        "/halls", headers=headers,
        params={"include_inactive": "true", "branch_id": first_branch},
    )
    assert scoped.status_code == 200, scoped.text
    assert scoped.json() == []


# ── §22 Table listing (flat + nested) ─────────────────────────────────────

async def test_default_table_listing_hides_inactive_table(client):
    headers = await _owner(client)
    hall = await _hall(client, headers)
    live = await _table(client, headers, hall, 1)
    archived = await _table(client, headers, hall, 2)
    assert (
        await client.delete(f"/halls/{hall}/tables/{archived}", headers=headers)
    ).status_code == 204

    assert [t["id"] for t in await _list_tables(client, headers, hall)] == [live]
    # nested collection on the hall directory agrees
    nested = (await _list_halls(client, headers))[0]["tables"]
    assert [t["id"] for t in nested] == [live]
    # and on the single-hall read
    single = await client.get(f"/halls/{hall}", headers=headers)
    assert [t["id"] for t in single.json()["tables"]] == [live]


async def test_include_inactive_true_exposes_inactive_table_everywhere(client):
    headers = await _owner(client)
    hall = await _hall(client, headers)
    live = await _table(client, headers, hall, 1)
    archived = await _table(client, headers, hall, 2)
    await client.delete(f"/halls/{hall}/tables/{archived}", headers=headers)

    flat = await _list_tables(client, headers, hall, include_inactive="true")
    assert _flags(flat) == {1: True, 2: False}
    assert {t["id"] for t in flat} == {live, archived}

    nested = (await _list_halls(client, headers, include_inactive="true"))[0]["tables"]
    assert _flags(nested) == {1: True, 2: False}

    single = await client.get(
        f"/halls/{hall}", headers=headers, params={"include_inactive": "true"}
    )
    assert single.status_code == 200, single.text
    assert _flags(single.json()["tables"]) == {1: True, 2: False}


async def test_deactivated_table_hidden_by_default_and_visible_via_flag(client):
    """§22 G+H — the same row, both views."""
    headers = await _owner(client)
    hall = await _hall(client, headers)
    table = await _table(client, headers, hall, 7)

    assert (
        await client.delete(f"/halls/{hall}/tables/{table}", headers=headers)
    ).status_code == 204
    assert await _list_tables(client, headers, hall) == []

    archived = await _list_tables(client, headers, hall, include_inactive="true")
    assert [t["id"] for t in archived] == [table]
    assert archived[0]["is_active"] is False
    assert archived[0]["number"] == 7  # no renumbering on soft delete


async def test_table_listing_tenant_isolation_with_include_inactive(client):
    a_headers = await _owner(client, slug="alpha")
    b_headers = await _owner(client, slug="beta")
    hall = await _hall(client, a_headers)
    table = await _table(client, a_headers, hall, 1)
    await client.delete(f"/halls/{hall}/tables/{table}", headers=a_headers)

    foreign = await client.get(
        f"/halls/{hall}/tables", headers=b_headers, params={"include_inactive": "true"}
    )
    assert foreign.status_code == 404, foreign.text


# ── §8/§9/§10/§23 Hall deactivate → reactivate cascade ────────────────────

async def test_hall_delete_cascades_to_active_tables_only(client):
    headers = await _owner(client)
    hall = await _hall(client, headers)
    await _table(client, headers, hall, 1)
    two = await _table(client, headers, hall, 2)
    await _table(client, headers, hall, 3)
    await client.delete(f"/halls/{hall}/tables/{two}", headers=headers)

    assert (await _patch_hall(client, headers, hall, {"is_active": False})).status_code == 200

    rows = await _list_halls(client, headers, include_inactive="true")
    hall_row = _by_id(rows, hall)
    assert hall_row["is_active"] is False
    assert _flags(hall_row["tables"]) == {1: False, 2: False, 3: False}


async def test_hall_patch_is_active_false_cascades_like_delete(client):
    """§17 — deactivation via PATCH must close the same invariant as DELETE."""
    headers = await _owner(client)
    hall = await _hall(client, headers)
    await _table(client, headers, hall, 1)
    await _table(client, headers, hall, 2)

    resp = await _patch_hall(client, headers, hall, {"is_active": False})
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is False

    archived = await _list_tables(client, headers, hall, include_inactive="true")
    assert _flags(archived) == {1: False, 2: False}


async def test_hall_reactivation_never_resurrects_tables(client):
    """§23 exact scenario: #1 active, #2 inactive, #3 active."""
    headers = await _owner(client)
    hall = await _hall(client, headers)
    one = await _table(client, headers, hall, 1)
    two = await _table(client, headers, hall, 2)
    await _table(client, headers, hall, 3)
    await client.delete(f"/halls/{hall}/tables/{two}", headers=headers)

    await _patch_hall(client, headers, hall, {"is_active": False})
    after_deactivate = _by_id(
        await _list_halls(client, headers, include_inactive="true"), hall
    )
    assert after_deactivate["is_active"] is False
    assert _flags(after_deactivate["tables"]) == {1: False, 2: False, 3: False}

    reactivated = await _patch_hall(client, headers, hall, {"is_active": True})
    assert reactivated.status_code == 200, reactivated.text
    assert reactivated.json()["is_active"] is True
    # every table stays archived — no guessing of prior state
    assert reactivated.json()["tables"] == []
    assert _flags(
        await _list_tables(client, headers, hall, include_inactive="true")
    ) == {1: False, 2: False, 3: False}

    # tables come back one at a time, by hand
    single = await _patch_table(client, headers, hall, one, {"is_active": True})
    assert single.status_code == 200, single.text
    assert _flags(
        await _list_tables(client, headers, hall, include_inactive="true")
    ) == {1: True, 2: False, 3: False}
    assert _flags(await _list_tables(client, headers, hall)) == {1: True}


# ── §9/§24 Branch invariant on hall reactivation ──────────────────────────

async def test_hall_reactivation_under_inactive_branch_conflicts(client, db_engine):
    headers = await _owner(client)
    hall = await _hall(client, headers)
    await _patch_hall(client, headers, hall, {"is_active": False})
    await _deactivate_all_branches(db_engine)

    resp = await _patch_hall(client, headers, hall, {"is_active": True})
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == INACTIVE_BRANCH_DETAIL
    # still archived, and no branch was created/reactivated as a side effect
    assert _by_id(
        await _list_halls(client, headers, include_inactive="true"), hall
    )["is_active"] is False
    assert [is_active for _id, is_active in await _branch_rows(db_engine)] == [False]


async def test_hall_metadata_edit_under_inactive_branch_still_allowed(client, db_engine):
    """The branch check gates activation only — not ordinary edits."""
    headers = await _owner(client)
    hall = await _hall(client, headers)
    await _deactivate_all_branches(db_engine)

    resp = await _patch_hall(client, headers, hall, {"name": "Переименован"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Переименован"


async def test_active_hall_patch_is_active_true_is_noop_not_branch_gated(client, db_engine):
    """An already-active hall re-asserting is_active=true is not a transition."""
    headers = await _owner(client)
    hall = await _hall(client, headers)
    await _deactivate_all_branches(db_engine)

    resp = await _patch_hall(client, headers, hall, {"is_active": True})
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is True


# ── §14/§20 Archived hall stays administratively editable ─────────────────

async def test_inactive_hall_remains_editable(client):
    headers = await _owner(client)
    hall = await _hall(client, headers)
    await _patch_hall(client, headers, hall, {"is_active": False})

    resp = await _patch_hall(
        client, headers, hall,
        {"name": "Архивный зал", "description": "заметка", "percent": 5},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Архивный зал"
    assert body["description"] == "заметка"
    # editing metadata must not silently reactivate it
    assert body["is_active"] is False


# ── §11 Table creation under an inactive hall ─────────────────────────────

async def test_create_table_under_inactive_hall_conflicts(client):
    headers = await _owner(client)
    hall = await _hall(client, headers)
    await _patch_hall(client, headers, hall, {"is_active": False})

    resp = await client.post(
        f"/halls/{hall}/tables", headers=headers, json={"number": 1, "capacity": 4}
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == INACTIVE_HALL_DETAIL
    # the hall was NOT silently activated, and no row was created
    assert _by_id(
        await _list_halls(client, headers, include_inactive="true"), hall
    )["is_active"] is False
    assert await _list_tables(client, headers, hall, include_inactive="true") == []


# ── §12/§17/§18 Table reactivation ────────────────────────────────────────

async def test_reactivate_table_under_inactive_hall_conflicts(client):
    headers = await _owner(client)
    hall = await _hall(client, headers)
    table = await _table(client, headers, hall, 1)
    await _patch_hall(client, headers, hall, {"is_active": False})

    resp = await _patch_table(client, headers, hall, table, {"is_active": True})
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == INACTIVE_HALL_DETAIL
    assert _flags(
        await _list_tables(client, headers, hall, include_inactive="true")
    ) == {1: False}


async def test_reactivate_table_under_active_hall_succeeds_when_number_free(client):
    headers = await _owner(client)
    hall = await _hall(client, headers)
    table = await _table(client, headers, hall, 5)
    await client.delete(f"/halls/{hall}/tables/{table}", headers=headers)

    resp = await _patch_table(client, headers, hall, table, {"is_active": True})
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is True
    assert resp.json()["number"] == 5
    assert [t["id"] for t in await _list_tables(client, headers, hall)] == [table]


async def test_reactivate_table_into_duplicate_active_number_conflicts(client):
    """§18 — Phase 5C-3 uniqueness is reused, not weakened."""
    headers = await _owner(client)
    hall = await _hall(client, headers)
    historical = await _table(client, headers, hall, 5)
    await client.delete(f"/halls/{hall}/tables/{historical}", headers=headers)
    current = await _table(client, headers, hall, 5)

    resp = await _patch_table(client, headers, hall, historical, {"is_active": True})
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == DUPLICATE_DETAIL
    # exactly one active #5 survives
    active = await _list_tables(client, headers, hall)
    assert [t["id"] for t in active] == [current]


async def test_inactive_table_metadata_edit_allowed_while_hall_inactive(client):
    """§15 — administrative edit vs operational activation."""
    headers = await _owner(client)
    hall = await _hall(client, headers)
    table = await _table(client, headers, hall, 1, capacity=4)
    await _patch_hall(client, headers, hall, {"is_active": False})

    resp = await _patch_table(client, headers, hall, table, {"capacity": 8})
    assert resp.status_code == 200, resp.text
    assert resp.json()["capacity"] == 8
    assert resp.json()["is_active"] is False


async def test_table_deactivate_is_soft_and_keeps_number(client):
    """§13 — no hard delete, no renumbering, no replacement row."""
    headers = await _owner(client)
    hall = await _hall(client, headers)
    table = await _table(client, headers, hall, 4)

    assert (
        await client.delete(f"/halls/{hall}/tables/{table}", headers=headers)
    ).status_code == 204

    archived = await _list_tables(client, headers, hall, include_inactive="true")
    assert len(archived) == 1
    assert archived[0]["id"] == table
    assert archived[0]["number"] == 4
    assert archived[0]["is_active"] is False


# ── §16/§17 State-space invariants ────────────────────────────────────────

async def test_hall_active_with_inactive_table_is_a_valid_state(client):
    """§16 — hall activation must never cascade downward."""
    headers = await _owner(client)
    hall = await _hall(client, headers)
    one = await _table(client, headers, hall, 1)
    two = await _table(client, headers, hall, 2)
    await client.delete(f"/halls/{hall}/tables/{two}", headers=headers)

    rows = await _list_halls(client, headers, include_inactive="true")
    hall_row = _by_id(rows, hall)
    assert hall_row["is_active"] is True
    assert _flags(hall_row["tables"]) == {1: True, 2: False}
    assert [t["id"] for t in hall_row["tables"] if t["is_active"]] == [one]


async def test_hall_inactive_with_active_table_is_unreachable(client):
    """§17 — every supported route into an inactive hall keeps tables archived."""
    headers = await _owner(client)
    hall = await _hall(client, headers)
    table = await _table(client, headers, hall, 1)

    for deactivate in (
        lambda: _patch_hall(client, headers, hall, {"is_active": False}),
    ):
        # reactivate the hall (tables stay archived) then deactivate again
        await _patch_hall(client, headers, hall, {"is_active": True})
        assert (await deactivate()).status_code in (200, 204)

        hall_row = _by_id(
            await _list_halls(client, headers, include_inactive="true"), hall
        )
        assert hall_row["is_active"] is False
        tables = await _list_tables(
            client, headers, hall, include_inactive="true"
        )
        assert [t["is_active"] for t in tables] == [False]

        # and no PATCH can flip a table active while the hall is archived
        blocked = await _patch_table(client, headers, hall, table, {"is_active": True})
        assert blocked.status_code == 409, blocked.text

    # creating one is blocked too, so the state has no reachable entry point
    created = await client.post(
        f"/halls/{hall}/tables", headers=headers, json={"number": 9}
    )
    assert created.status_code == 409, created.text


# ── §19 include_inactive vs uniqueness ────────────────────────────────────

async def test_include_inactive_shows_duplicate_numbers_without_relaxing_uniqueness(client):
    """Visibility only: an archived #5 and an active #5 may both appear, but
    only the active one participates in Phase 5C-3 uniqueness."""
    headers = await _owner(client)
    hall = await _hall(client, headers)
    historical = await _table(client, headers, hall, 5)
    await client.delete(f"/halls/{hall}/tables/{historical}", headers=headers)
    current = await _table(client, headers, hall, 5)

    both = await _list_tables(client, headers, hall, include_inactive="true")
    assert [t["number"] for t in both] == [5, 5]
    assert {t["id"] for t in both} == {historical, current}
    assert sorted(t["is_active"] for t in both) == [False, True]

    # a second ACTIVE #5 is still refused
    dup = await client.post(f"/halls/{hall}/tables", headers=headers, json={"number": 5})
    assert dup.status_code == 409, dup.text
    assert dup.json()["detail"] == DUPLICATE_DETAIL


# ── §7 no N+1 on the nested collection ────────────────────────────────────

async def test_nested_tables_load_in_constant_query_count(client, db_engine):
    """selectinload keeps the nested load at one extra query regardless of how
    many halls are returned — the count must not grow with the row count."""
    from sqlalchemy import event

    headers = await _owner(client)
    for index in range(1, 4):
        hall = await _hall(client, headers, f"Зал {index}")
        await _table(client, headers, hall, index)

    statements: list[str] = []

    @event.listens_for(db_engine.sync_engine, "before_cursor_execute")
    def _record(_conn, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    try:
        statements.clear()
        await _list_halls(client, headers, include_inactive="true")
        with_archive = [s for s in statements if " halls" in s or " tables" in s]

        statements.clear()
        await _list_halls(client, headers)
        default = [s for s in statements if " halls" in s or " tables" in s]
    finally:
        event.remove(db_engine.sync_engine, "before_cursor_execute", _record)

    # one SELECT for halls + one for the whole tables collection, both modes
    assert len(with_archive) == 2, with_archive
    assert len(default) == 2, default


# ── §8/§23 History is never touched ───────────────────────────────────────

async def test_hall_deactivate_reactivate_preserves_order_table_link(client):
    """A hall cascade + later reactivation must not strand or rewrite
    Order.table_id (Phase 1 invariant)."""
    headers = await _owner(client)
    branch_id = (await client.get("/companies/me/branches", headers=headers)).json()[0]["id"]
    hall = await _hall(client, headers)
    table = await _table(client, headers, hall, 7)

    created = await client.post(
        "/pos/orders", headers=headers,
        json={
            "branch_id": branch_id, "order_type": "dine_in",
            "table_id": table, "items": [],
        },
    )
    assert created.status_code == 201, created.text
    order_id = created.json()["id"]
    assert created.json()["table_number"] == "7"

    await _patch_hall(client, headers, hall, {"is_active": False})
    reactivated = await _patch_hall(client, headers, hall, {"is_active": True})
    assert reactivated.status_code == 200, reactivated.text

    refetched = await client.get(f"/pos/orders/{order_id}", headers=headers)
    assert refetched.status_code == 200, refetched.text
    assert refetched.json()["table_id"] == table
    assert refetched.json()["table_number"] == "7"

    # the table itself is still archived with its original number
    archived = await _list_tables(client, headers, hall, include_inactive="true")
    assert [(t["id"], t["number"], t["is_active"]) for t in archived] == [
        (table, 7, False)
    ]

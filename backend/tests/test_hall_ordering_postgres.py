"""Phase 5C-6A PostgreSQL proof for branch-scoped Hall ordering.

The DB-authority facts — the migration adds a NOT NULL `sort_order`, backfills
it deterministically PER BRANCH by (created_at, id), creates the composite
index, and cleanly downgrades/re-upgrades — cannot be exercised on SQLite, so
everything here runs against the disposable TEST_DATABASE_URL server.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy.engine import make_url

from tests.test_migrations import (
    EXPECTED_HEAD,
    _column_exists,
    _connect,
    _current_revision,
    _index_exists,
    _run_alembic,
    migration_database_factory,  # noqa: F401  (fixture re-export)
)

COLUMN = "sort_order"
INDEX = "ix_halls_branch_sort_order"
PREDECESSOR = "bi06tnu03"


async def _column_not_null(database_url: str, table: str, column: str) -> bool:
    connection = await _connect(make_url(database_url))
    try:
        nullable = await connection.fetchval(
            """
            SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
            """,
            table,
            column,
        )
        return nullable == "NO"
    finally:
        await connection.close()


async def _seed_pre_migration(database_url: str):
    """Insert a company, two branches and halls (with controlled created_at)
    directly, BEFORE sort_order exists. Returns the ids needed to assert the
    deterministic per-branch backfill."""
    connection = await _connect(make_url(database_url))
    company_id = uuid4()
    branch_a, branch_b = uuid4(), uuid4()
    # branch A: three halls, ascending created_at (a1 < a2 < a3)
    a1, a2, a3 = uuid4(), uuid4(), uuid4()
    # branch A also gets a created_at TIE broken by id: t1, t2 share a timestamp
    tie_low, tie_high = sorted((uuid4(), uuid4()))
    # branch B: two halls
    b1, b2 = uuid4(), uuid4()
    try:
        await connection.execute(
            """
            INSERT INTO companies(id, slug, name, timezone, currency, is_active,
                                  created_at, updated_at)
            VALUES($1, $2, 'P5C6A', 'UTC', 'UZS', true, now(), now())
            """,
            company_id, f"p5c6a-{uuid4().hex[:8]}",
        )
        for branch_id, name in ((branch_a, "Branch A"), (branch_b, "Branch B")):
            await connection.execute(
                """
                INSERT INTO branches(id, company_id, name, is_active,
                                     created_at, updated_at)
                VALUES($1, $2, $3, true, now(), now())
                """,
                branch_id, company_id, name,
            )

        async def _hall(hall_id, branch_id, name, created_at):
            await connection.execute(
                """
                INSERT INTO halls(id, company_id, branch_id, name, is_active,
                                  created_at, updated_at)
                VALUES($1, $2, $3, $4, true, $5, $5)
                """,
                hall_id, company_id, branch_id, name, created_at,
            )

        def _ts(hour):
            return datetime(2026, 8, 1, hour, 0, 0, tzinfo=timezone.utc)

        await _hall(a1, branch_a, "A1", _ts(10))
        await _hall(a2, branch_a, "A2", _ts(11))
        await _hall(a3, branch_a, "A3", _ts(12))
        # Two more in branch A sharing ONE created_at → id breaks the tie.
        await _hall(tie_low, branch_a, "TIE_LOW", _ts(13))
        await _hall(tie_high, branch_a, "TIE_HIGH", _ts(13))
        await _hall(b1, branch_b, "B1", datetime(2026, 8, 2, 10, tzinfo=timezone.utc))
        await _hall(b2, branch_b, "B2", datetime(2026, 8, 2, 11, tzinfo=timezone.utc))
    finally:
        await connection.close()
    return {
        "branch_a": [a1, a2, a3, tie_low, tie_high],
        "branch_b": [b1, b2],
    }


async def _sort_orders(database_url: str, hall_ids: list[UUID]) -> dict[UUID, int]:
    connection = await _connect(make_url(database_url))
    try:
        rows = await connection.fetch(
            "SELECT id, sort_order FROM halls WHERE id = ANY($1::uuid[])",
            hall_ids,
        )
        return {row["id"]: row["sort_order"] for row in rows}
    finally:
        await connection.close()


# PLACEHOLDER_APPEND

@pytest.mark.skipif(
    not __import__("os").getenv("TEST_DATABASE_URL"),
    reason="TEST_DATABASE_URL is required for PostgreSQL ordering tests",
)
def test_migration_adds_notnull_sort_order_and_index(migration_database_factory) -> None:
    database_url = migration_database_factory("hall_sort_order_shape")
    _run_alembic(database_url, "upgrade", PREDECESSOR)
    assert not asyncio.run(_column_exists(database_url, "halls", COLUMN))
    assert not asyncio.run(_index_exists(database_url, INDEX))

    _run_alembic(database_url, "upgrade", "head")
    assert asyncio.run(_current_revision(database_url)) == EXPECTED_HEAD
    assert asyncio.run(_column_exists(database_url, "halls", COLUMN))
    assert asyncio.run(_index_exists(database_url, INDEX))
    assert asyncio.run(_column_not_null(database_url, "halls", COLUMN))


@pytest.mark.skipif(
    not __import__("os").getenv("TEST_DATABASE_URL"),
    reason="TEST_DATABASE_URL is required for PostgreSQL ordering tests",
)
def test_backfill_is_deterministic_per_branch(migration_database_factory) -> None:
    database_url = migration_database_factory("hall_sort_order_backfill")
    _run_alembic(database_url, "upgrade", PREDECESSOR)
    ids = asyncio.run(_seed_pre_migration(database_url))

    _run_alembic(database_url, "upgrade", "head")

    a = asyncio.run(_sort_orders(database_url, ids["branch_a"]))
    b = asyncio.run(_sort_orders(database_url, ids["branch_b"]))
    a1, a2, a3, tie_low, tie_high = ids["branch_a"]
    b1, b2 = ids["branch_b"]
    # Branch A: 0-based by created_at, then id for the shared-timestamp tie.
    assert a[a1] == 0 and a[a2] == 1 and a[a3] == 2
    assert a[tie_low] == 3 and a[tie_high] == 4  # tie_low < tie_high by id
    # Branch B numbers independently, also from 0.
    assert b[b1] == 0 and b[b2] == 1
    # Each branch got a clean contiguous 0..n-1 permutation (no gaps/dups).
    assert sorted(a.values()) == [0, 1, 2, 3, 4]
    assert sorted(b.values()) == [0, 1]


@pytest.mark.skipif(
    not __import__("os").getenv("TEST_DATABASE_URL"),
    reason="TEST_DATABASE_URL is required for PostgreSQL ordering tests",
)
def test_downgrade_then_reupgrade_restores_column_and_index(migration_database_factory) -> None:
    database_url = migration_database_factory("hall_sort_order_downgrade")
    _run_alembic(database_url, "upgrade", "head")
    assert asyncio.run(_column_exists(database_url, "halls", COLUMN))

    _run_alembic(database_url, "downgrade", "-1")
    assert asyncio.run(_current_revision(database_url)) == PREDECESSOR
    assert not asyncio.run(_column_exists(database_url, "halls", COLUMN))
    assert not asyncio.run(_index_exists(database_url, INDEX))
    # The Phase 5C-3 layer underneath is untouched by our downgrade.
    assert asyncio.run(_index_exists(database_url, "uq_tables_hall_number_active"))

    _run_alembic(database_url, "upgrade", "head")
    assert asyncio.run(_current_revision(database_url)) == EXPECTED_HEAD
    assert asyncio.run(_column_exists(database_url, "halls", COLUMN))
    assert asyncio.run(_index_exists(database_url, INDEX))
    assert asyncio.run(_column_not_null(database_url, "halls", COLUMN))

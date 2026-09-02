"""Phase 5C-6D PostgreSQL proof for the Hall delete/archive column.

The migration adds a nullable `deleted_at` and downgrades cleanly; these are
DB-authority facts (column type/nullability, clean down/up) that belong on a
real PostgreSQL server rather than SQLite.
"""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy.engine import make_url

from tests.test_migrations import (
    EXPECTED_HEAD,
    _column_exists,
    _connect,
    _current_revision,
    _run_alembic,
    migration_database_factory,  # noqa: F401  (fixture re-export)
)

COLUMN = "deleted_at"
PREDECESSOR = "bi06hso04"


async def _column_is_nullable_timestamptz(database_url: str) -> bool:
    connection = await _connect(make_url(database_url))
    try:
        row = await connection.fetchrow(
            """
            SELECT is_nullable, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'halls'
              AND column_name = $1
            """,
            COLUMN,
        )
        return bool(row) and row["is_nullable"] == "YES" and row["data_type"] == "timestamp with time zone"
    finally:
        await connection.close()


@pytest.mark.skipif(
    not __import__("os").getenv("TEST_DATABASE_URL"),
    reason="TEST_DATABASE_URL is required for PostgreSQL delete-state tests",
)
def test_migration_adds_nullable_deleted_at(migration_database_factory) -> None:
    database_url = migration_database_factory("hall_deleted_at_shape")
    _run_alembic(database_url, "upgrade", PREDECESSOR)
    assert not asyncio.run(_column_exists(database_url, "halls", COLUMN))

    _run_alembic(database_url, "upgrade", "head")
    assert asyncio.run(_current_revision(database_url)) == EXPECTED_HEAD
    assert asyncio.run(_column_exists(database_url, "halls", COLUMN))
    assert asyncio.run(_column_is_nullable_timestamptz(database_url))


@pytest.mark.skipif(
    not __import__("os").getenv("TEST_DATABASE_URL"),
    reason="TEST_DATABASE_URL is required for PostgreSQL delete-state tests",
)
def test_downgrade_then_reupgrade_restores_deleted_at(migration_database_factory) -> None:
    database_url = migration_database_factory("hall_deleted_at_downgrade")
    _run_alembic(database_url, "upgrade", "head")
    assert asyncio.run(_column_exists(database_url, "halls", COLUMN))

    # Downgrade to this migration's OWN predecessor by revision, not "-1":
    # the graph head moves on (ZR-PRINT-01B added bi06zrd06 above bi06hde05),
    # and this test is about peeling halls.deleted_at specifically.
    _run_alembic(database_url, "downgrade", PREDECESSOR)
    assert asyncio.run(_current_revision(database_url)) == PREDECESSOR
    assert not asyncio.run(_column_exists(database_url, "halls", COLUMN))
    # The Phase 5C-6A ordering layer underneath is untouched by our downgrade.
    assert asyncio.run(_column_exists(database_url, "halls", "sort_order"))

    _run_alembic(database_url, "upgrade", "head")
    assert asyncio.run(_current_revision(database_url)) == EXPECTED_HEAD
    assert asyncio.run(_column_is_nullable_timestamptz(database_url))

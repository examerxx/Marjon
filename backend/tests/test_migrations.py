from __future__ import annotations

import base64
import ast
import asyncio
from collections import Counter
import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from uuid import uuid4
import zlib

import asyncpg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.engine import make_url

from app.shared.base_model import Base


BACKEND_ROOT = Path(__file__).resolve().parents[1]
VERSIONS_DIR = BACKEND_ROOT / "migrations" / "versions"
EXPECTED_HEAD = "bi06hde05"
EXPECTED_NULLABLE_COLUMN_COUNT = 262
EXPECTED_PARITY_OPERATIONS = {"remove_index", "remove_table_comment"}
FIXTURES_DIR = BACKEND_ROOT / "tests" / "fixtures"
PROVEN_LEGACY_SOURCE_COMMIT = (
    "1573cb48c810321c5e4f4e69a282a444919f9e76"
)
PROVEN_LEGACY_SOURCE_REVISION = "a1f2admin01"
PROVEN_LEGACY_SCHEMA_SHA256 = (
    "6e3edf9e2454a9c31dd52aa9e68ca4231fe6e979c67b4308ea2cee93bde8d1b1"
)
PROVEN_LEGACY_EVIDENCE_SHA256 = (
    "6b5fe9cc4fcc751cd8617631d835bcc279a4c5129d68079561673209d73a0e11"
)


def _revision_metadata(path: Path) -> tuple[str, str | None]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    values: dict[str, str | None] = {}
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        target = node.target if isinstance(node, ast.AnnAssign) else node.targets[0]
        if not isinstance(target, ast.Name) or target.id not in {
            "revision",
            "down_revision",
        }:
            continue
        value = ast.literal_eval(node.value)
        if isinstance(value, tuple):
            raise AssertionError(f"{path.name} unexpectedly branches the graph")
        values[target.id] = value
    return values["revision"], values["down_revision"]


def _assigned_literal(tree: ast.Module, name: str):
    for node in tree.body:
        if isinstance(node, ast.AnnAssign):
            targets = [node.target]
        elif isinstance(node, ast.Assign):
            targets = node.targets
        else:
            continue
        if any(isinstance(target, ast.Name) and target.id == name for target in targets):
            return ast.literal_eval(node.value)
    raise KeyError(name)


def _bi02_nullable_columns() -> tuple[tuple[str, str], ...]:
    columns: list[tuple[str, str]] = []
    for path in sorted(VERSIONS_DIR.glob("*bi02*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        try:
            value = _assigned_literal(tree, "_COLUMNS")
        except KeyError:
            continue
        if isinstance(value, tuple) and all(
            isinstance(item, tuple) and len(item) == 2 for item in value
        ):
            columns.extend(value)
    return tuple(columns)


def _decompress_fixture(name: str) -> bytes:
    encoded = (FIXTURES_DIR / name).read_bytes()
    return zlib.decompress(base64.b64decode(encoded))


def _proven_legacy_schema_sql() -> str:
    schema = _decompress_fixture("pre_bi02_a1_schema.sql.zlib.b64")
    assert hashlib.sha256(schema).hexdigest() == PROVEN_LEGACY_SCHEMA_SHA256
    sql = schema.decode("utf-8")
    assert "DROP NOT NULL" not in sql.upper()
    return sql


def _proven_legacy_evidence() -> dict:
    raw = _decompress_fixture("pre_bi02_a1_evidence.json.zlib.b64")
    assert hashlib.sha256(raw).hexdigest() == PROVEN_LEGACY_EVIDENCE_SHA256
    return json.loads(raw)


def test_revision_graph_is_linear_complete_and_has_one_head() -> None:
    revisions: dict[str, tuple[str | None, Path]] = {}
    for path in sorted(VERSIONS_DIR.glob("*.py")):
        revision, down_revision = _revision_metadata(path)
        assert revision not in revisions, f"duplicate revision id: {revision}"
        revisions[revision] = (down_revision, path)

    for revision, (down_revision, path) in revisions.items():
        assert down_revision is None or down_revision in revisions, (
            f"{path.name}: missing down_revision {down_revision!r}"
        )

    parents = {
        down_revision
        for down_revision, _path in revisions.values()
        if down_revision is not None
    }
    heads = set(revisions) - parents
    assert heads == {EXPECTED_HEAD}

    visited: set[str] = set()
    cursor: str | None = EXPECTED_HEAD
    while cursor is not None:
        assert cursor not in visited, f"cycle at revision {cursor}"
        visited.add(cursor)
        cursor = revisions[cursor][0]
    assert visited == set(revisions)
    assert len(revisions) == 48

    nullable_columns = _bi02_nullable_columns()
    assert len(nullable_columns) == EXPECTED_NULLABLE_COLUMN_COUNT
    assert len(set(nullable_columns)) == EXPECTED_NULLABLE_COLUMN_COUNT


def test_phase5c2_price_amount_migration_is_additive_and_chains_from_bi06tid01() -> None:
    path = VERSIONS_DIR / "20260828_bi06hpa02_hall_price_amount.py"
    revision, down_revision = _revision_metadata(path)
    assert revision == "bi06hpa02"
    assert down_revision == "bi06tid01"

    source = path.read_text(encoding="utf-8")
    # upgrade adds halls.price_amount, downgrade drops it
    assert "op.add_column" in source
    assert "op.drop_column" in source
    assert '_TABLE = "halls"' in source
    assert '_COLUMN = "price_amount"' in source
    assert "Numeric(15, 2)" in source
    assert "nullable=True" in source
    # Phase 5C-2 is schema-additive only: no out-of-scope Phase 5C work here
    assert "location" not in source
    assert "create_index" not in source
    assert "create_unique_constraint" not in source
    assert "include_inactive" not in source


def test_phase5c3_table_unique_migration_is_partial_and_chains_from_bi06hpa02() -> None:
    path = VERSIONS_DIR / "20260828_bi06tnu03_table_number_unique.py"
    revision, down_revision = _revision_metadata(path)
    assert revision == "bi06tnu03"
    assert down_revision == "bi06hpa02"

    source = path.read_text(encoding="utf-8")
    # PARTIAL unique index over (hall_id, number) for ACTIVE rows only
    assert '_INDEX = "uq_tables_hall_number_active"' in source
    assert 'op.create_index' in source
    assert 'unique=True' in source
    assert 'postgresql_where' in source
    assert '_PREDICATE = "is_active"' in source
    assert 'op.drop_index' in source
    # never an unconditional uniqueness rule
    assert "create_unique_constraint" not in source
    # duplicate preflight must fail loudly and never repair data
    assert "HAVING count(*) > 1" in source
    assert "RuntimeError" in source
    for destructive in ("DELETE FROM tables", "UPDATE tables", "op.execute"):
        assert destructive not in source
    # Phase 5C-3 is scoped: no price/branch/inactive-directory work here
    assert "price_amount" not in source
    assert "include_inactive" not in source
    assert "location" not in source


def test_phase5c6a_hall_sort_order_migration_is_additive_and_chains_from_bi06tnu03() -> None:
    path = VERSIONS_DIR / "20260829_bi06hso04_hall_sort_order.py"
    revision, down_revision = _revision_metadata(path)
    assert revision == "bi06hso04"
    assert down_revision == "bi06tnu03"

    source = path.read_text(encoding="utf-8")
    # Adds halls.sort_order (Integer) + a composite branch index; downgrade
    # drops both.
    assert 'op.add_column' in source
    assert '_COLUMN = "sort_order"' in source
    assert '_TABLE = "halls"' in source
    assert '_INDEX = "ix_halls_branch_sort_order"' in source
    assert 'op.create_index' in source
    assert 'op.drop_index' in source
    assert 'op.drop_column' in source
    # Backfill is deterministic PER BRANCH by the stable chronological key,
    # never by physical row order — and it is a NOT NULL column afterwards.
    assert "PARTITION BY branch_id" in source
    assert "ORDER BY created_at, id" in source
    assert "nullable=False" in source
    # Ordering is a plain (non-unique) index — no strict/deferrable uniqueness.
    assert "unique=True" not in source
    assert "create_unique_constraint" not in source
    assert "DEFERRABLE" not in source.upper()
    # The backfill writes ONLY sort_order and is non-destructive — it never
    # mutates ownership/lifecycle/pricing and deletes nothing.
    assert "SET sort_order = ordered.position" in source
    assert "DELETE FROM" not in source
    assert "SET is_active" not in source
    assert "SET branch_id" not in source
    assert "SET company_id" not in source


def test_phase5c6d_hall_deleted_at_migration_is_additive_and_chains_from_bi06hso04() -> None:
    path = VERSIONS_DIR / "20260829_bi06hde05_hall_deleted_at.py"
    revision, down_revision = _revision_metadata(path)
    assert revision == "bi06hde05"
    assert down_revision == "bi06hso04"

    source = path.read_text(encoding="utf-8")
    # Adds ONLY halls.deleted_at (nullable timestamptz); downgrade drops it.
    assert 'op.add_column' in source
    assert '_TABLE = "halls"' in source
    assert '_COLUMN = "deleted_at"' in source
    assert "DateTime(timezone=True)" in source
    assert "nullable=True" in source
    assert 'op.drop_column' in source
    # Purely additive: no backfill, no destructive/lifecycle mutation, no index.
    assert "op.execute" not in source
    assert "UPDATE" not in source
    assert "DELETE FROM" not in source
    assert "create_index" not in source
    assert "is_active" not in source


def test_historical_migrations_do_not_use_mutable_application_metadata() -> None:
    forbidden_calls: list[str] = []
    application_imports: list[str] = []

    for path in sorted(VERSIONS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if node.func.attr in {"create_all", "drop_all"}:
                    forbidden_calls.append(f"{path.name}:{node.lineno}")
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "app" or alias.name.startswith("app."):
                        application_imports.append(
                            f"{path.name}:{node.lineno}:{alias.name}"
                        )
            if isinstance(node, ast.ImportFrom):
                module = node.module or ""
                if module == "app" or module.startswith("app."):
                    application_imports.append(
                        f"{path.name}:{node.lineno}:{module}"
                    )

    assert forbidden_calls == []
    assert application_imports == []


def test_alembic_env_registers_non_router_model_modules() -> None:
    source = (BACKEND_ROOT / "migrations" / "env.py").read_text(encoding="utf-8")
    for module in (
        "app.modules.halls.models",
        "app.modules.inventory.semi_product_models",
        "app.modules.inventory.warehouse_models",
        "app.modules.kafe_compat.models",
    ):
        assert f"import {module}" in source
    assert "transaction_per_migration=True" in source
    assert "SET LOCAL lock_timeout" in source
    assert "SET LOCAL statement_timeout" in source


def _test_control_url():
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL migration tests")
    url = make_url(raw_url)
    if url.get_backend_name() != "postgresql":
        pytest.skip("PostgreSQL is required for migration integration tests")
    if not url.database or "test" not in url.database.lower():
        pytest.fail("TEST_DATABASE_URL must name an explicitly disposable test DB")
    return url


async def _connect(url, database: str | None = None):
    return await asyncpg.connect(
        user=url.username,
        password=url.password,
        host=url.host,
        port=url.port or 5432,
        database=database or url.database,
    )


async def _restore_proven_legacy_snapshot(database_url: str) -> None:
    url = make_url(database_url)
    connection = await _connect(url)
    transaction = connection.transaction()
    await transaction.start()
    try:
        await connection.execute(_proven_legacy_schema_sql())
        await connection.execute(
            "INSERT INTO public.alembic_version(version_num) VALUES($1)",
            PROVEN_LEGACY_SOURCE_REVISION,
        )
        await transaction.commit()
    except BaseException:
        await transaction.rollback()
        raise
    finally:
        await connection.close()


async def _create_databases(control_url, names: tuple[str, ...]) -> None:
    connection = await _connect(control_url)
    try:
        for name in names:
            await connection.execute(f'CREATE DATABASE "{name}"')
    finally:
        await connection.close()


async def _drop_databases(control_url, names: tuple[str, ...]) -> None:
    connection = await _connect(control_url)
    try:
        for name in names:
            await connection.execute(
                """
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = $1 AND pid <> pg_backend_pid()
                """,
                name,
            )
            await connection.execute(f'DROP DATABASE IF EXISTS "{name}"')
    finally:
        await connection.close()


def _database_url(control_url, database: str) -> str:
    return control_url.set(database=database).render_as_string(
        hide_password=False
    )


@pytest.fixture
def migration_database_factory():
    control_url = _test_control_url()
    databases: list[str] = []

    def create(label: str) -> str:
        name = f"marjon_migration_test_{uuid4().hex[:10]}_{label}"
        asyncio.run(_create_databases(control_url, (name,)))
        databases.append(name)
        return _database_url(control_url, name)

    try:
        yield create
    finally:
        if databases:
            asyncio.run(_drop_databases(control_url, tuple(databases)))


def _invoke_alembic(
    database_url: str, *arguments: str, timeout: int = 180
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment.update(
        {
            "DATABASE_URL": database_url,
            "MIGRATION_DATABASE_URL": database_url,
            "DEBUG": "true",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    return subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=BACKEND_ROOT,
        env=environment,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _run_alembic(database_url: str, *arguments: str) -> str:
    result = _invoke_alembic(database_url, *arguments)
    assert result.returncode == 0, (
        f"alembic {' '.join(arguments)} failed\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    return result.stdout + result.stderr


async def _column_exists(database_url: str, table: str, column: str) -> bool:
    url = make_url(database_url)
    connection = await _connect(url)
    try:
        return bool(
            await connection.fetchval(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = $1
                      AND column_name = $2
                )
                """,
                table,
                column,
            )
        )
    finally:
        await connection.close()


async def _index_exists(database_url: str, index_name: str) -> bool:
    url = make_url(database_url)
    connection = await _connect(url)
    try:
        return bool(
            await connection.fetchval(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_indexes
                    WHERE schemaname = 'public'
                      AND indexname = $1
                )
                """,
                index_name,
            )
        )
    finally:
        await connection.close()


async def _index_state(database_url: str, index_name: str):
    url = make_url(database_url)
    connection = await _connect(url)
    try:
        return await connection.fetchrow(
            """
            SELECT
                index_relation.oid AS index_oid,
                table_relation.relname AS table_name,
                access_method.amname AS access_method,
                index_catalog.indisunique AS is_unique,
                index_catalog.indisvalid AS is_valid,
                index_catalog.indisready AS is_ready,
                ARRAY(
                    SELECT pg_get_indexdef(
                        index_relation.oid,
                        key_position,
                        TRUE
                    )
                    FROM generate_series(
                        1,
                        index_catalog.indnkeyatts
                    ) AS key_position
                    ORDER BY key_position
                ) AS key_columns,
                pg_get_indexdef(index_relation.oid) AS definition
            FROM pg_index AS index_catalog
            JOIN pg_class AS index_relation
              ON index_relation.oid = index_catalog.indexrelid
            JOIN pg_class AS table_relation
              ON table_relation.oid = index_catalog.indrelid
            JOIN pg_namespace AS namespace
              ON namespace.oid = index_relation.relnamespace
            JOIN pg_am AS access_method
              ON access_method.oid = index_relation.relam
            WHERE namespace.nspname = current_schema()
              AND index_relation.relname = $1
            """,
            index_name,
        )
    finally:
        await connection.close()


def _assert_valid_attendance_index(state) -> None:
    assert state is not None
    assert state["table_name"] == "attendance_logs"
    assert state["access_method"] == "btree"
    assert state["is_unique"] is False
    assert state["is_ready"] is True
    assert state["is_valid"] is True
    assert state["key_columns"] == ["shift_id"]
    assert state["definition"].endswith("USING btree (shift_id)")


async def _make_bi02_columns_nullable(database_url: str) -> None:
    url = make_url(database_url)
    connection = await _connect(url)
    transaction = connection.transaction()
    await transaction.start()
    try:
        for table_name, column_name in _bi02_nullable_columns():
            await connection.execute(
                f'ALTER TABLE "{table_name}" '
                f'ALTER COLUMN "{column_name}" DROP NOT NULL'
            )
        await transaction.commit()
    except BaseException:
        await transaction.rollback()
        raise
    finally:
        await connection.close()


async def _bi02_column_nullability(database_url: str) -> dict[tuple[str, str], str]:
    url = make_url(database_url)
    connection = await _connect(url)
    try:
        result: dict[tuple[str, str], str] = {}
        for table_name, column_name in _bi02_nullable_columns():
            nullable = await connection.fetchval(
                """
                SELECT is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = $1
                  AND column_name = $2
                """,
                table_name,
                column_name,
            )
            result[(table_name, column_name)] = nullable
        return result
    finally:
        await connection.close()


async def _insert_representative_legacy_rows(
    database_url: str, *, duplicate_attendance: bool = False
) -> None:
    url = make_url(database_url)
    connection = await _connect(url)
    try:
        await connection.execute(
            """
            INSERT INTO companies(
                id, slug, name, timezone, currency, is_active,
                created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000001',
                'bi02-legacy', 'BI-02 Legacy', 'Asia/Tashkent', 'UZS', TRUE,
                '2026-08-07 01:00:00+00', '2026-08-07 01:00:00+00'
            );
            INSERT INTO branches(
                id, company_id, name, is_active, created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000002',
                '00000000-0000-0000-0000-000000000001',
                'Legacy Branch', TRUE,
                '2026-08-07 01:01:00+00', '2026-08-07 01:01:00+00'
            );
            INSERT INTO users(
                id, company_id, email, password_hash,
                is_active, is_superadmin, created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000003',
                '00000000-0000-0000-0000-000000000001',
                'legacy@example.test', 'test-hash', TRUE, FALSE,
                '2026-08-07 01:02:00+00', '2026-08-07 01:02:00+00'
            );
            INSERT INTO roles(
                id, company_id, name, slug, is_system, created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000004',
                '00000000-0000-0000-0000-000000000001',
                'Legacy Role', 'legacy-role', FALSE,
                '2026-08-07 01:03:00+00', '2026-08-07 01:03:00+00'
            );
            INSERT INTO permissions(
                id, module, action, scope, created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000005',
                'test', 'read', 'company',
                '2026-08-07 01:04:00+00', '2026-08-07 01:04:00+00'
            );
            INSERT INTO role_permissions(
                id, role_id, permission_id, created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000006',
                '00000000-0000-0000-0000-000000000004',
                '00000000-0000-0000-0000-000000000005',
                '2026-08-07 01:05:00+00', '2026-08-07 01:05:00+00'
            );
            INSERT INTO user_roles(
                id, user_id, role_id, branch_id, created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000007',
                '00000000-0000-0000-0000-000000000003',
                '00000000-0000-0000-0000-000000000004',
                '00000000-0000-0000-0000-000000000002',
                '2026-08-07 01:06:00+00', '2026-08-07 01:06:00+00'
            );
            INSERT INTO categories(
                id, company_id, name, slug, sort_order, is_active,
                created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000008',
                '00000000-0000-0000-0000-000000000001',
                'Legacy Category', 'legacy-category', 1, TRUE,
                '2026-08-07 01:07:00+00', '2026-08-07 01:07:00+00'
            );
            INSERT INTO products(
                id, company_id, category_id, name, price,
                tax_rate, unit, sort_order, is_active, is_available,
                created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000009',
                '00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000008',
                'Legacy Product', 25, 12, 'pcs', 1, TRUE, TRUE,
                '2026-08-07 01:08:00+00', '2026-08-07 01:08:00+00'
            );
            INSERT INTO product_branch(
                id, product_id, branch_id, is_available, stop_list,
                created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000010',
                '00000000-0000-0000-0000-000000000009',
                '00000000-0000-0000-0000-000000000002', TRUE, FALSE,
                '2026-08-07 01:09:00+00', '2026-08-07 01:09:00+00'
            );
            INSERT INTO ingredients(
                id, company_id, name, unit, is_active, created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000011',
                '00000000-0000-0000-0000-000000000001',
                'Legacy Ingredient', 'kg', TRUE,
                '2026-08-07 01:10:00+00', '2026-08-07 01:10:00+00'
            );
            INSERT INTO warehouses(
                id, company_id, branch_id, name, is_main,
                created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000012',
                '00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000002',
                'Legacy Warehouse', TRUE,
                '2026-08-07 01:11:00+00', '2026-08-07 01:11:00+00'
            );
            INSERT INTO stock_items(
                id, company_id, warehouse_id, ingredient_id,
                quantity, unit, min_quantity, cost_price,
                created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000013',
                '00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000012',
                '00000000-0000-0000-0000-000000000011',
                10, 'kg', 1, 5,
                '2026-08-07 01:12:00+00', '2026-08-07 01:12:00+00'
            );
            INSERT INTO orders(
                id, company_id, branch_id, order_number, order_type, status,
                persons_count, subtotal, discount_amount, tax_amount,
                service_fee, total_amount, source, created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000014',
                '00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000002',
                'LEGACY-1', 'dine_in', 'completed', 2,
                50, 0, 6, 2, 58, 'pos',
                '2026-08-07 01:13:00+00', '2026-08-07 01:13:00+00'
            );
            INSERT INTO order_items(
                id, order_id, product_id, name, price, quantity,
                discount, total, status, modifiers, course,
                created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000015',
                '00000000-0000-0000-0000-000000000014',
                '00000000-0000-0000-0000-000000000009',
                'Legacy Product', 25, 2, 0, 50, 'served', '[]'::json, 1,
                '2026-08-07 01:14:00+00', '2026-08-07 01:14:00+00'
            );
            INSERT INTO payments(
                id, company_id, order_id, amount, method, status,
                provider_data, created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000016',
                '00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000014',
                58, 'cash', 'completed', '{}'::json,
                '2026-08-07 01:15:00+00', '2026-08-07 01:15:00+00'
            );
            INSERT INTO employees(
                id, company_id, user_id, branch_id, position, hire_date,
                salary_type, salary_amount, created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000017',
                '00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000003',
                '00000000-0000-0000-0000-000000000002',
                'Cashier', '2026-01-01', 'fixed', 1000,
                '2026-08-07 01:16:00+00', '2026-08-07 01:16:00+00'
            );
            INSERT INTO work_shifts(
                id, company_id, branch_id, employee_id,
                scheduled_start, scheduled_end, status,
                created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000018',
                '00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000002',
                '00000000-0000-0000-0000-000000000017',
                '2026-08-07 02:00:00+00', '2026-08-07 10:00:00+00',
                'completed',
                '2026-08-07 01:17:00+00', '2026-08-07 01:17:00+00'
            );
            INSERT INTO attendance_logs(
                id, company_id, employee_id, shift_id,
                action, timestamp, method, created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000019',
                '00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000017',
                '00000000-0000-0000-0000-000000000018',
                'check_in', '2026-08-07 02:00:00+00', 'manual',
                '2026-08-07 01:18:00+00', '2026-08-07 01:18:00+00'
            );
            """
        )
        if duplicate_attendance:
            await connection.execute(
                """
                INSERT INTO attendance_logs(
                    id, company_id, employee_id, shift_id,
                    action, timestamp, method, created_at, updated_at
                ) VALUES (
                    '00000000-0000-0000-0000-000000000020',
                    '00000000-0000-0000-0000-000000000001',
                    '00000000-0000-0000-0000-000000000017',
                    '00000000-0000-0000-0000-000000000018',
                    'check_out', '2026-08-07 10:00:00+00', 'manual',
                    '2026-08-07 01:19:00+00', '2026-08-07 01:19:00+00'
                )
                """
            )
    finally:
        await connection.close()


def _register_migration_models() -> None:
    tree = ast.parse(
        (BACKEND_ROOT / "migrations" / "env.py").read_text(encoding="utf-8")
    )
    for node in tree.body:
        if not isinstance(node, ast.Import):
            continue
        for alias in node.names:
            if alias.name.startswith("app."):
                importlib.import_module(alias.name)


async def _schema_differences(database_url: str) -> list[tuple]:
    _register_migration_models()
    differences: list = []

    def compare(sync_connection) -> None:
        differences.extend(
            compare_metadata(
                MigrationContext.configure(sync_connection), Base.metadata
            )
        )

    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(compare)
    finally:
        await engine.dispose()

    operations: list[tuple] = []

    def flatten(value) -> None:
        if isinstance(value, tuple) and value and isinstance(value[0], str):
            operations.append(value)
        elif isinstance(value, (list, tuple)):
            for item in value:
                flatten(item)

    flatten(differences)
    return operations


async def _assert_only_documented_parity_differences(database_url: str) -> None:
    differences = await _schema_differences(database_url)
    assert {difference[0] for difference in differences}.issubset(
        EXPECTED_PARITY_OPERATIONS
    )
    assert [
        difference
        for difference in differences
        if difference[0] not in EXPECTED_PARITY_OPERATIONS
    ] == []


async def _assert_representative_rows_preserved(database_url: str) -> None:
    url = make_url(database_url)
    connection = await _connect(url)
    try:
        expected = {
            "users": "legacy@example.test",
            "roles": "legacy-role",
            "companies": "bi02-legacy",
            "branches": "Legacy Branch",
            "products": "Legacy Product",
            "stock_items": "10.0000",
            "orders": "LEGACY-1",
            "order_items": "Legacy Product",
            "payments": "completed",
            "employees": "Cashier",
            "attendance_logs": "check_in",
        }
        queries = {
            "users": "SELECT email FROM users WHERE id = '00000000-0000-0000-0000-000000000003'",
            "roles": "SELECT slug FROM roles WHERE id = '00000000-0000-0000-0000-000000000004'",
            "companies": "SELECT slug FROM companies WHERE id = '00000000-0000-0000-0000-000000000001'",
            "branches": "SELECT name FROM branches WHERE id = '00000000-0000-0000-0000-000000000002'",
            "products": "SELECT name FROM products WHERE id = '00000000-0000-0000-0000-000000000009'",
            "stock_items": "SELECT quantity::text FROM stock_items WHERE id = '00000000-0000-0000-0000-000000000013'",
            "orders": "SELECT order_number FROM orders WHERE id = '00000000-0000-0000-0000-000000000014'",
            "order_items": "SELECT name FROM order_items WHERE id = '00000000-0000-0000-0000-000000000015'",
            "payments": "SELECT status FROM payments WHERE id = '00000000-0000-0000-0000-000000000016'",
            "employees": "SELECT position FROM employees WHERE id = '00000000-0000-0000-0000-000000000017'",
            "attendance_logs": "SELECT action FROM attendance_logs WHERE id = '00000000-0000-0000-0000-000000000019'",
        }
        for table_name, query in queries.items():
            assert await connection.fetchval(query) == expected[table_name]
    finally:
        await connection.close()


async def _create_interrupted_concurrent_attendance_index(
    database_url: str,
) -> None:
    url = make_url(database_url)
    holder = await _connect(url)
    builder = await _connect(url)
    observer = await _connect(url)
    holder_transaction = holder.transaction(isolation="repeatable_read")
    await holder_transaction.start()
    build_task = None
    try:
        await holder.fetchval("SELECT count(*) FROM attendance_logs")
        build_task = asyncio.create_task(
            builder.execute(
                """
                CREATE INDEX CONCURRENTLY ix_attendance_logs_shift_id
                ON attendance_logs (shift_id)
                """
            )
        )

        deadline = asyncio.get_running_loop().time() + 10
        while asyncio.get_running_loop().time() < deadline:
            state = await observer.fetchrow(
                """
                SELECT indisready AS is_ready, indisvalid AS is_valid
                FROM pg_index
                WHERE indexrelid =
                    to_regclass('public.ix_attendance_logs_shift_id')
                """
            )
            if state and state["is_ready"] and not state["is_valid"]:
                break
            if build_task.done():
                await build_task
                raise AssertionError(
                    "concurrent index completed before invalid state was observed"
                )
            await asyncio.sleep(0.05)
        else:
            raise AssertionError(
                "concurrent index did not reach indisready=true/indisvalid=false"
            )

        assert await observer.fetchval(
            "SELECT pg_cancel_backend($1)", builder.get_server_pid()
        )
        with pytest.raises(asyncpg.PostgresError):
            await build_task
    finally:
        await holder_transaction.rollback()
        if build_task is not None and not build_task.done():
            build_task.cancel()
        await holder.close()
        await builder.close()
        await observer.close()

    state = await _index_state(
        database_url, "ix_attendance_logs_shift_id"
    )
    assert state is not None
    assert state["is_ready"] is True
    assert state["is_valid"] is False


async def _current_revision(database_url: str) -> str:
    url = make_url(database_url)
    connection = await _connect(url)
    try:
        return await connection.fetchval("SELECT version_num FROM alembic_version")
    finally:
        await connection.close()


async def _prepare_legacy_p5_state(database_url: str) -> None:
    """Reproduce objects leaked by the old mutable a1 migration."""
    url = make_url(database_url)
    connection = await _connect(url)
    try:
        await connection.execute("DROP TABLE tables")
        await connection.execute("DROP TABLE halls")
        await connection.execute(
            "ALTER TABLE fin_transactions ADD COLUMN company_id UUID"
        )
        await connection.execute(
            """
            ALTER TABLE fin_transactions
            ADD CONSTRAINT fin_transactions_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES companies(id)
            ON DELETE SET NULL
            """
        )
        await connection.execute(
            """
            CREATE INDEX ix_fin_transactions_company_id
            ON fin_transactions (company_id)
            """
        )
        await connection.execute(
            """
            ALTER TABLE organizations
            ADD COLUMN type VARCHAR(50) NOT NULL
            """
        )
    finally:
        await connection.close()


@pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"),
    reason="TEST_DATABASE_URL is required for PostgreSQL migration tests",
)
def test_postgresql_fresh_upgrade_timing_downgrade_and_second_fresh() -> None:
    control_url = _test_control_url()
    suffix = uuid4().hex[:10]
    databases = (
        f"marjon_migration_test_{suffix}_one",
        f"marjon_migration_test_{suffix}_two",
        f"marjon_migration_test_{suffix}_legacy",
    )
    asyncio.run(_create_databases(control_url, databases))
    first_url = _database_url(control_url, databases[0])
    second_url = _database_url(control_url, databases[1])
    legacy_url = _database_url(control_url, databases[2])

    try:
        _run_alembic(first_url, "upgrade", "p5q6logo1")
        assert not asyncio.run(
            _column_exists(first_url, "fin_transactions", "company_id")
        )
        assert not asyncio.run(
            _column_exists(first_url, "organizations", "type")
        )

        _run_alembic(first_url, "upgrade", "q7r8fin01")
        assert asyncio.run(
            _column_exists(first_url, "fin_transactions", "company_id")
        )
        _run_alembic(first_url, "upgrade", "w8x9hall1")
        assert not asyncio.run(
            _column_exists(first_url, "organizations", "type")
        )

        _run_alembic(first_url, "upgrade", "head")
        assert asyncio.run(_current_revision(first_url)) == EXPECTED_HEAD
        assert asyncio.run(
            _index_exists(first_url, "ix_attendance_logs_shift_id")
        )
        assert asyncio.run(
            _column_exists(first_url, "ingredients", "supplier_name")
        )
        assert asyncio.run(
            _column_exists(first_url, "orders", "table_id")
        )
        assert asyncio.run(
            _index_exists(first_url, "ix_orders_table_id")
        )
        assert asyncio.run(
            _column_exists(first_url, "halls", "price_amount")
        )
        assert asyncio.run(
            _index_exists(first_url, "uq_tables_hall_number_active")
        )
        assert asyncio.run(
            _column_exists(first_url, "halls", "sort_order")
        )
        assert asyncio.run(
            _index_exists(first_url, "ix_halls_branch_sort_order")
        )
        assert asyncio.run(
            _column_exists(first_url, "halls", "deleted_at")
        )

        # Phase 5C-6D head peels off first: halls.deleted_at goes, while
        # halls.sort_order + its branch index below stay intact.
        _run_alembic(first_url, "downgrade", "-1")
        assert asyncio.run(_current_revision(first_url)) != EXPECTED_HEAD
        assert not asyncio.run(
            _column_exists(first_url, "halls", "deleted_at")
        )
        assert asyncio.run(
            _column_exists(first_url, "halls", "sort_order")
        )
        assert asyncio.run(
            _index_exists(first_url, "ix_halls_branch_sort_order")
        )

        # Phase 5C-6A layer next: halls.sort_order + its branch index go, while
        # the Phase 5C-3 table-number index below stays intact.
        _run_alembic(first_url, "downgrade", "-1")
        assert not asyncio.run(
            _column_exists(first_url, "halls", "sort_order")
        )
        assert not asyncio.run(
            _index_exists(first_url, "ix_halls_branch_sort_order")
        )
        assert asyncio.run(
            _index_exists(first_url, "uq_tables_hall_number_active")
        )

        # Phase 5C-3 layer next: the partial table-number unique index goes,
        # while halls.price_amount and orders.table_id below stay intact.
        _run_alembic(first_url, "downgrade", "-1")
        assert not asyncio.run(
            _index_exists(first_url, "uq_tables_hall_number_active")
        )
        assert asyncio.run(
            _column_exists(first_url, "halls", "price_amount")
        )

        # Phase 5C-2 layer next: halls.price_amount is dropped while
        # the BI-06 orders.table_id layer underneath stays intact.
        _run_alembic(first_url, "downgrade", "-1")
        assert not asyncio.run(
            _column_exists(first_url, "halls", "price_amount")
        )
        assert asyncio.run(
            _column_exists(first_url, "orders", "table_id")
        )

        # BI-06 layer next: orders.table_id + its index are removed,
        # leaving the historical BI-05E1 fingerprint chain below intact.
        _run_alembic(first_url, "downgrade", "-1")
        assert not asyncio.run(
            _column_exists(first_url, "orders", "table_id")
        )
        assert not asyncio.run(
            _index_exists(first_url, "ix_orders_table_id")
        )

        _run_alembic(first_url, "downgrade", "-1")
        assert not asyncio.run(
            _column_exists(first_url, "financial_operations", "fingerprint_version")
        )
        assert asyncio.run(
            _index_exists(first_url, "ix_attendance_logs_shift_id")
        )
        assert asyncio.run(
            _column_exists(first_url, "ingredients", "supplier_name")
        )
        _run_alembic(first_url, "downgrade", "-1")
        assert asyncio.run(
            _index_exists(first_url, "ix_attendance_logs_shift_id")
        )
        _run_alembic(first_url, "downgrade", "-1")
        assert asyncio.run(
            _index_exists(first_url, "ix_attendance_logs_shift_id")
        )
        _run_alembic(first_url, "downgrade", "-1")
        assert asyncio.run(
            _index_exists(first_url, "ix_attendance_logs_shift_id")
        )
        _run_alembic(first_url, "downgrade", "-1")
        assert not asyncio.run(
            _index_exists(first_url, "ix_attendance_logs_shift_id")
        )
        assert asyncio.run(
            _column_exists(first_url, "ingredients", "supplier_name")
        )
        _run_alembic(first_url, "upgrade", "head")
        assert asyncio.run(_current_revision(first_url)) == EXPECTED_HEAD
        assert asyncio.run(
            _index_exists(first_url, "ix_attendance_logs_shift_id")
        )

        _run_alembic(second_url, "upgrade", "head")
        assert asyncio.run(_current_revision(second_url)) == EXPECTED_HEAD
        assert asyncio.run(
            _index_exists(second_url, "ix_attendance_logs_shift_id")
        )
        differences = asyncio.run(_schema_differences(second_url))
        assert {difference[0] for difference in differences} == {
            "remove_index",
            "remove_table_comment",
        }
        assert sorted(
            difference[1].name
            for difference in differences
            if difference[0] == "remove_index"
        ) == [
            "ix_orders_branch_created",
            "ix_orders_status",
            "ix_orders_table_number",
        ]
        assert sorted(
            difference[1].name
            for difference in differences
            if difference[0] == "remove_table_comment"
        ) == ["halls", "tables"]

        _run_alembic(legacy_url, "upgrade", "p5q6logo1")
        asyncio.run(_prepare_legacy_p5_state(legacy_url))
        _run_alembic(legacy_url, "upgrade", "head")
        assert asyncio.run(_current_revision(legacy_url)) == EXPECTED_HEAD
        assert asyncio.run(
            _index_exists(legacy_url, "ix_attendance_logs_shift_id")
        )
        for table, column in (
            ("fin_transactions", "company_id"),
            ("organizations", "type"),
            ("halls", "condition"),
            ("tables", "hall_id"),
        ):
            assert asyncio.run(_column_exists(legacy_url, table, column))
    finally:
        asyncio.run(_drop_databases(control_url, databases))


def test_postgresql_proven_git_legacy_snapshot_and_data_preservation(
    migration_database_factory,
) -> None:
    database_url = migration_database_factory("proven_git_legacy")
    evidence = _proven_legacy_evidence()
    assert evidence["source_commit"] == PROVEN_LEGACY_SOURCE_COMMIT
    assert evidence["source_revision"] == PROVEN_LEGACY_SOURCE_REVISION
    assert evidence["source_schema_sha256"] == PROVEN_LEGACY_SCHEMA_SHA256.upper()
    assert evidence["counts_at_source"] == {
        "YES": 229,
        "NO": 0,
        "MISSING": 33,
    }
    assert evidence["counts_at_z4"] == {
        "YES": 229,
        "NO": 33,
        "MISSING": 0,
    }

    evidence_targets = {
        tuple(record["table_column"].split(".", 1)): record
        for record in evidence["targets"]
    }
    assert set(evidence_targets) == set(_bi02_nullable_columns())
    assert all(
        record["introduced_commit"] != "UNVERIFIABLE_FROM_GIT"
        for record in evidence_targets.values()
    )

    asyncio.run(_restore_proven_legacy_snapshot(database_url))
    assert (
        asyncio.run(_current_revision(database_url))
        == PROVEN_LEGACY_SOURCE_REVISION
    )

    before = asyncio.run(_bi02_column_nullability(database_url))
    assert len(before) == EXPECTED_NULLABLE_COLUMN_COUNT
    assert Counter(before.values()) == Counter({"YES": 229, None: 33})
    for target, record in evidence_targets.items():
        expected = (
            None
            if record["historical_nullable"] == "MISSING"
            else record["historical_nullable"]
        )
        assert before[target] == expected

    asyncio.run(_insert_representative_legacy_rows(database_url))
    _run_alembic(database_url, "upgrade", "z4a5ingr1")
    assert asyncio.run(_current_revision(database_url)) == "z4a5ingr1"

    at_z4 = asyncio.run(_bi02_column_nullability(database_url))
    assert Counter(at_z4.values()) == Counter({"YES": 229, "NO": 33})
    for target, record in evidence_targets.items():
        assert at_z4[target] == record["z4_nullable"]

    _run_alembic(database_url, "upgrade", "head")

    assert asyncio.run(_current_revision(database_url)) == EXPECTED_HEAD
    after = asyncio.run(_bi02_column_nullability(database_url))
    assert len(after) == EXPECTED_NULLABLE_COLUMN_COUNT
    assert set(after.values()) == {"NO"}
    asyncio.run(_assert_representative_rows_preserved(database_url))
    _assert_valid_attendance_index(
        asyncio.run(
            _index_state(database_url, "ix_attendance_logs_shift_id")
        )
    )
    asyncio.run(_assert_only_documented_parity_differences(database_url))


def test_postgresql_null_preflight_rolls_back_and_can_be_remediated(
    migration_database_factory,
) -> None:
    database_url = migration_database_factory("null_preflight")
    _run_alembic(database_url, "upgrade", "z4a5ingr1")
    asyncio.run(_make_bi02_columns_nullable(database_url))

    async def prepare_null() -> None:
        connection = await _connect(make_url(database_url))
        try:
            await connection.execute(
                """
                INSERT INTO roles(
                    id, name, slug, is_system, created_at, updated_at
                ) VALUES (
                    '10000000-0000-0000-0000-000000000001',
                    'NULL Probe', 'null-probe', NULL,
                    '2026-08-07 02:00:00+00',
                    '2026-08-07 02:00:00+00'
                )
                """
            )
        finally:
            await connection.close()

    asyncio.run(prepare_null())
    result = _invoke_alembic(database_url, "upgrade", "bi02auth01")
    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "roles.is_system" in output
    assert "1 NULL rows" in output
    assert asyncio.run(_current_revision(database_url)) == "z4a5ingr1"

    async def verify_failure_and_remediate() -> None:
        connection = await _connect(make_url(database_url))
        try:
            assert await connection.fetchval(
                "SELECT count(*) FROM roles "
                "WHERE slug = 'null-probe' AND is_system IS NULL"
            ) == 1
            assert await connection.fetchval(
                """
                SELECT is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'roles'
                  AND column_name = 'is_system'
                """
            ) == "YES"
            await connection.execute(
                "UPDATE roles SET is_system = FALSE "
                "WHERE slug = 'null-probe'"
            )
        finally:
            await connection.close()

    asyncio.run(verify_failure_and_remediate())
    _run_alembic(database_url, "upgrade", "head")
    assert asyncio.run(_current_revision(database_url)) == EXPECTED_HEAD


def test_postgresql_concurrent_index_recovery_and_idempotency(
    migration_database_factory,
) -> None:
    valid_url = migration_database_factory("index_valid")
    invalid_url = migration_database_factory("index_invalid")
    mismatched_url = migration_database_factory("index_mismatched")

    async def remove_historical_index(database_url: str) -> None:
        connection = await _connect(make_url(database_url))
        try:
            await connection.execute(
                "DROP INDEX IF EXISTS ix_attendance_logs_shift_id"
            )
        finally:
            await connection.close()

    async def remove_stamped_new_head_table(database_url: str) -> None:
        """Undo schema leaked intentionally by the attendance stamp test."""
        connection = await _connect(make_url(database_url))
        try:
            await connection.execute(
                "DROP TABLE IF EXISTS financial_operations"
            )
        finally:
            await connection.close()

    _run_alembic(valid_url, "upgrade", "bi02wh17")
    asyncio.run(remove_historical_index(valid_url))
    assert not asyncio.run(
        _index_exists(valid_url, "ix_attendance_logs_shift_id")
    )
    # This test exercises the historical BI-02 index recovery path. Stop at
    # BI-05B so its deliberate stamp-back cleanup does not strand BI-05A's
    # ownership columns/triggers while pretending the database is at BI-02.
    _run_alembic(valid_url, "upgrade", "bi05bfin19")
    valid_state = asyncio.run(
        _index_state(valid_url, "ix_attendance_logs_shift_id")
    )
    _assert_valid_attendance_index(valid_state)

    _run_alembic(valid_url, "stamp", "bi02wh17")
    original_oid = valid_state["index_oid"]
    _run_alembic(valid_url, "upgrade", "bi02idx18")
    no_op_state = asyncio.run(
        _index_state(valid_url, "ix_attendance_logs_shift_id")
    )
    _assert_valid_attendance_index(no_op_state)
    assert no_op_state["index_oid"] == original_oid

    asyncio.run(remove_stamped_new_head_table(valid_url))
    _run_alembic(valid_url, "downgrade", "bi02wh17")
    assert not asyncio.run(
        _index_exists(valid_url, "ix_attendance_logs_shift_id")
    )
    _run_alembic(valid_url, "upgrade", "head")
    _assert_valid_attendance_index(
        asyncio.run(
            _index_state(valid_url, "ix_attendance_logs_shift_id")
        )
    )

    _run_alembic(invalid_url, "upgrade", "bi02wh17")
    asyncio.run(remove_historical_index(invalid_url))
    asyncio.run(
        _insert_representative_legacy_rows(
            invalid_url, duplicate_attendance=True
        )
    )
    asyncio.run(_create_interrupted_concurrent_attendance_index(invalid_url))
    _run_alembic(invalid_url, "upgrade", "head")
    _assert_valid_attendance_index(
        asyncio.run(
            _index_state(invalid_url, "ix_attendance_logs_shift_id")
        )
    )

    _run_alembic(mismatched_url, "upgrade", "bi02wh17")
    asyncio.run(remove_historical_index(mismatched_url))

    async def create_mismatched_index() -> None:
        connection = await _connect(make_url(mismatched_url))
        try:
            await connection.execute(
                """
                CREATE INDEX ix_attendance_logs_shift_id
                ON attendance_logs (company_id)
                """
            )
        finally:
            await connection.close()

    asyncio.run(create_mismatched_index())
    _run_alembic(mismatched_url, "upgrade", "head")
    _assert_valid_attendance_index(
        asyncio.run(
            _index_state(mismatched_url, "ix_attendance_logs_shift_id")
        )
    )


def test_postgresql_transaction_boundary_and_lock_timeout(
    migration_database_factory,
) -> None:
    database_url = migration_database_factory("lock_boundary")
    _run_alembic(database_url, "upgrade", "z4a5ingr1")
    asyncio.run(_make_bi02_columns_nullable(database_url))

    async def exercise_lock_boundary():
        url = make_url(database_url)
        blocker = await _connect(url)
        observer = await _connect(url)
        probe = await _connect(url)
        blocker_transaction = blocker.transaction()
        await blocker_transaction.start()
        migration_task = None
        try:
            await blocker.execute("LOCK TABLE companies IN ACCESS SHARE MODE")
            started_at = time.monotonic()
            migration_task = asyncio.create_task(
                asyncio.to_thread(
                    _invoke_alembic,
                    database_url,
                    "upgrade",
                    "bi02org02",
                    timeout=30,
                )
            )

            deadline = asyncio.get_running_loop().time() + 4
            while asyncio.get_running_loop().time() < deadline:
                waiting = await observer.fetchval(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM pg_locks
                        WHERE relation = 'companies'::regclass
                          AND mode = 'AccessExclusiveLock'
                          AND NOT granted
                    )
                    """
                )
                if waiting:
                    break
                await asyncio.sleep(0.05)
            else:
                raise AssertionError(
                    "bi02org02 did not wait for the conflicting company lock"
                )

            probe_transaction = probe.transaction()
            await probe_transaction.start()
            try:
                await probe.execute(
                    "LOCK TABLE users IN ACCESS EXCLUSIVE MODE NOWAIT"
                )
            finally:
                await probe_transaction.rollback()

            result = await migration_task
            elapsed = time.monotonic() - started_at
            assert result.returncode != 0
            assert "lock timeout" in (result.stdout + result.stderr).lower()
            assert 4 <= elapsed < 15
        finally:
            await blocker_transaction.rollback()
            if migration_task is not None and not migration_task.done():
                migration_task.cancel()
            await blocker.close()
            await observer.close()
            await probe.close()

    asyncio.run(exercise_lock_boundary())
    assert asyncio.run(_current_revision(database_url)) == "bi02auth01"

    nullability = asyncio.run(_bi02_column_nullability(database_url))
    assert nullability[("users", "is_active")] == "NO"
    assert nullability[("companies", "timezone")] == "YES"

    async def assert_no_data_changes() -> None:
        connection = await _connect(make_url(database_url))
        try:
            assert await connection.fetchval("SELECT count(*) FROM users") == 0
            assert await connection.fetchval("SELECT count(*) FROM companies") == 0
        finally:
            await connection.close()

    asyncio.run(assert_no_data_changes())

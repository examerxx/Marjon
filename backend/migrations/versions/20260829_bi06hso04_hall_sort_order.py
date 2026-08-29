"""Add branch-scoped Hall ordering (halls.sort_order).

Phase 5C-6A: places (halls) need a persistent, deterministic display order that
is BRANCH-SCOPED — a hall's position is meaningful only among the other halls of
its own branch, never company-global. This adds an integer `sort_order` column
plus a composite btree index on (branch_id, sort_order) for ordered reads.

Backfill is deterministic PER BRANCH: existing halls are numbered 0, 1, 2, ...
within each branch by their stable chronological order (created_at, then id as
the tie-breaker) — never by natural database row order. After backfill the
column is set NOT NULL. Position uniqueness inside a branch is enforced by the
application (complete-list atomic reorder + append-under-branch-lock), so no
unique constraint is created here — a plain index keeps the reorder write path
simple and avoids the transient-collision handling a strict constraint forces.

Nothing is deleted, renamed, deactivated or re-owned: branch_id/company_id,
is_active, pricing (price_amount/pricing_type/condition/percent) and the tables
relation are all untouched.

Revision ID: bi06hso04
Revises: bi06tnu03
Create Date: 2026-08-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "bi06hso04"
down_revision: Union[str, None] = "bi06tnu03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "halls"
_COLUMN = "sort_order"
_INDEX = "ix_halls_branch_sort_order"


def _require_postgresql() -> None:
    if op.get_bind().dialect.name != "postgresql":
        raise RuntimeError("BI-06 halls.sort_order migration requires PostgreSQL")


def _column_exists() -> bool:
    return bool(
        op.get_bind().execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = :table
                      AND column_name = :column
                )
                """
            ),
            {"table": _TABLE, "column": _COLUMN},
        ).scalar()
    )


def _index_exists() -> bool:
    return bool(
        op.get_bind().execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM pg_indexes
                    WHERE schemaname = current_schema() AND indexname = :index
                )
                """
            ),
            {"index": _INDEX},
        ).scalar()
    )


def upgrade() -> None:
    _require_postgresql()
    if not _column_exists():
        # Add nullable first so existing rows can be backfilled before the
        # NOT NULL is enforced. server_default=0 is a safety net for any future
        # non-service insert; the service always assigns an explicit position.
        op.add_column(
            _TABLE,
            sa.Column(_COLUMN, sa.Integer(), nullable=True, server_default=sa.text("0")),
        )
        # Deterministic per-branch backfill: 0-based, ordered by the stable
        # chronological key (created_at, id). Never relies on physical row order.
        op.execute(
            """
            UPDATE halls AS h
            SET sort_order = ordered.position
            FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY branch_id
                           ORDER BY created_at, id
                       ) - 1 AS position
                FROM halls
            ) AS ordered
            WHERE h.id = ordered.id
            """
        )
        op.alter_column(_TABLE, _COLUMN, existing_type=sa.Integer(), nullable=False)
    if not _index_exists():
        op.create_index(_INDEX, _TABLE, ["branch_id", "sort_order"])


def downgrade() -> None:
    _require_postgresql()
    if _index_exists():
        op.drop_index(_INDEX, table_name=_TABLE)
    if _column_exists():
        op.drop_column(_TABLE, _COLUMN)

"""Add user-facing Hall delete/archive state (halls.deleted_at).

Phase 5C-6D: the Settings "Место" Trash action must ARCHIVE a hall — a state
distinct from the active/inactive flag. An inactive hall ("Неавтивен") stays
visible in Settings; a non-null `deleted_at` removes the hall from the Settings
directory and every operational surface (POS table pick, waiter picker, report
filter options) while preserving its Tables and historical Order.table_id
references. This follows the repo's dominant soft-delete convention
(`SoftDeleteMixin.deleted_at`, filtered with `deleted_at IS NULL`).

Additive and non-destructive: the nullable timestamp column starts NULL for
every existing hall (i.e. NOT deleted). Nothing is dropped, renamed, renumbered,
deactivated or re-owned — ownership, ordering, the active flag, pricing, percent,
condition, Tables and Orders are all untouched.

Revision ID: bi06hde05
Revises: bi06hso04
Create Date: 2026-08-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "bi06hde05"
down_revision: Union[str, None] = "bi06hso04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "halls"
_COLUMN = "deleted_at"


def _require_postgresql() -> None:
    if op.get_bind().dialect.name != "postgresql":
        raise RuntimeError("BI-06 halls.deleted_at migration requires PostgreSQL")


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


def upgrade() -> None:
    _require_postgresql()
    if not _column_exists():
        # Nullable, no default: existing halls stay NULL = not deleted. No
        # backfill — the active flag is a separate, untouched state.
        op.add_column(
            _TABLE,
            sa.Column(_COLUMN, sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    _require_postgresql()
    if _column_exists():
        op.drop_column(_TABLE, _COLUMN)

"""V25 — canonical dish-category flags for the OWNER category UI.

Adds categories.calculate_service / categories.show_in_menu (NOT NULL boolean,
default false). Existing categories backfill to false via server_default "0"
(conservative: no fake ON state), same convention as v24auto01 product flags.
Idempotent like sibling migrations: a DB bootstrapped by create_tables.py
already has the columns.

Revision ID: v25cat01
Revises: v24auto01
Create Date: 2026-10-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "v25cat01"
down_revision: Union[str, None] = "v24auto01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    existing = _columns("categories")
    if "calculate_service" not in existing:
        op.add_column(
            "categories",
            sa.Column("calculate_service", sa.Boolean(), nullable=False, server_default="0"),
        )
    if "show_in_menu" not in existing:
        op.add_column(
            "categories",
            sa.Column("show_in_menu", sa.Boolean(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    existing = _columns("categories")
    if "show_in_menu" in existing:
        op.drop_column("categories", "show_in_menu")
    if "calculate_service" in existing:
        op.drop_column("categories", "calculate_service")

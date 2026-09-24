"""Add modifier_groups.show_in_pos, missing since the model gained it

ModifierGroup.show_in_pos (app/modules/inventory/models.py) is the web-admin
toggle that controls whether a dish's add-on group is offered on the desktop
cashier. Read by the menu/product response and filtered before reaching the POS.
No migration created the column yet.

Added only when missing, for the same reason as z3a4ordcmt07: a database
bootstrapped by create_tables.py already has it and may still be stamped at an
earlier revision. server_default "1" keeps existing groups visible (the previous
behaviour, where every configured group showed).

Revision ID: b5c6modpos09
Revises: a4b5daystart08
Create Date: 2026-09-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b5c6modpos09"
down_revision: Union[str, None] = "a4b5daystart08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "modifier_groups"
_COLUMN = "show_in_pos"


def _columns() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(_TABLE)}


def upgrade() -> None:
    if _COLUMN not in _columns():
        op.add_column(
            _TABLE,
            sa.Column(_COLUMN, sa.Boolean(), nullable=False, server_default="1"),
        )


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)

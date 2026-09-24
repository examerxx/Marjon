"""Add companies.day_start_hour, missing since the model gained it

Company.day_start_hour (app/modules/companies/models.py) sets the hour when the
"operational day" begins, so order numbering resets when the venue closes rather
than at midnight. It's read by pos/service.py._generate_daily_number and written
from the web admin (company profile). No migration created the column yet.

Added only when missing, like the sibling column-restore migrations: a database
bootstrapped by create_tables.py (metadata.create_all + `alembic stamp head`)
already has it and may still be stamped at an earlier revision. server_default
"0" keeps existing rows valid (midnight reset, the previous behaviour).

Revision ID: a4b5daystart08
Revises: bi08dcs01
Create Date: 2026-09-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a4b5daystart08"
down_revision: Union[str, None] = "bi08dcs01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "companies"
_COLUMN = "day_start_hour"


def _columns() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(_TABLE)}


def upgrade() -> None:
    if _COLUMN not in _columns():
        op.add_column(
            _TABLE,
            sa.Column(_COLUMN, sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)

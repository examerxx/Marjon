"""layout01_table_coords

Revision ID: layout01
Revises: ce10b54132e8
Create Date: 2026-11-06

Схема зала (конструктор): позиция стола на канве 1000×620.
NULL — стол ещё не расставлен, касса показывает его обычной сеткой.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "layout01"
down_revision: Union[str, None] = "ce10b54132e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tables", sa.Column("x", sa.Integer(), nullable=True))
    op.add_column("tables", sa.Column("y", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("tables", "y")
    op.drop_column("tables", "x")

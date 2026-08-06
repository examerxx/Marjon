"""Add zone to printers (BE-13)

Revision ID: v6w7prn1
Revises: u4v5rcpt2
Create Date: 2026-08-06
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "v6w7prn1"
down_revision: Union[str, None] = "u4v5rcpt2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("printers", sa.Column("zone", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("printers", "zone")

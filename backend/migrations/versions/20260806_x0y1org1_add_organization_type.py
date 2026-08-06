"""Add type to organizations (BE-15)

Revision ID: x0y1org1
Revises: w8x9hall1
Create Date: 2026-08-06
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "x0y1org1"
down_revision: Union[str, None] = "w8x9hall1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("type", sa.String(50), nullable=False, server_default="restaurant"),
    )


def downgrade() -> None:
    op.drop_column("organizations", "type")

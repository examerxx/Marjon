"""Add version to receipt_template_settings (BE-11)

GET/PATCH /settings/(kitchen-)receipt-template existed but had no
optimistic-concurrency field and no structure validation at all
(the PATCH handler took a raw `data: dict` and shallow-merged it in) —
two admins editing the template around the same time would silently
clobber each other with no warning.

Revision ID: u4v5rcpt2
Revises: t2u3semi1
Create Date: 2026-08-06
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "u4v5rcpt2"
down_revision: Union[str, None] = "t2u3semi1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Separate counters, not one shared `version` — customer_template and
    # kitchen_template live on the same row but are edited independently
    # (separate settings pages); a single shared counter would make
    # editing one falsely conflict with a stale read of the other.
    op.add_column(
        "receipt_template_settings",
        sa.Column("customer_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "receipt_template_settings",
        sa.Column("kitchen_version", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("receipt_template_settings", "kitchen_version")
    op.drop_column("receipt_template_settings", "customer_version")

"""Secure PIN storage + lockout fields (BE-08)

users.pin_code existed but was never actually used by any endpoint
(POST /auth/pin-login was a permanent stub) and, worse, was a plain
String(8) — i.e. designed to hold the PIN in plaintext. Renames it to
pin_hash (a bcrypt hash, via the same hash_password()/verify_password()
used for account passwords) and adds per-account lockout counters so
repeated failed PIN attempts can be throttled independently of the
global rate limiter.

Revision ID: r8s9pin01
Revises: q7r8fin01
Create Date: 2026-08-06
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "r8s9pin01"
down_revision: Union[str, None] = "q7r8fin01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename AND widen in one statement — a bare rename keeps the old
    # VARCHAR(8), which is far too small for a bcrypt hash (60 chars).
    op.alter_column(
        "users", "pin_code",
        new_column_name="pin_hash",
        type_=sa.String(255),
        existing_type=sa.String(8),
    )
    op.add_column(
        "users",
        sa.Column("pin_failed_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users",
        sa.Column("pin_locked_until", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "pin_locked_until")
    op.drop_column("users", "pin_failed_attempts")
    op.alter_column(
        "users", "pin_hash",
        new_column_name="pin_code",
        type_=sa.String(8),
        existing_type=sa.String(255),
    )

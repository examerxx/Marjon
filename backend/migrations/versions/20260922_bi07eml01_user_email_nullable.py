"""CASHIER-EMAIL-OPTIONAL-01: users.email becomes nullable.

Cashier staff creation must work without Email (OWNER → Сотрудники → Кассир
drawer no longer sends one, and no fake address may be invented). Previously
`users.email` was NOT NULL at the ORM, Pydantic and PostgreSQL levels, so
every company-user insert required a real address.

Additive, non-destructive, PostgreSQL only, idempotent:

  A. users.email DROP NOT NULL. Existing addresses are untouched; no rows
     are rewritten. PostgreSQL treats NULL as distinct inside the existing
     UNIQUE constraint/index, so any number of emailless staff accounts can
     coexist while non-null addresses stay globally unique. No partial
     index is required and none is created.

  B. Downgrade re-applies NOT NULL only when no NULL emails exist
     (otherwise it refuses instead of destroying data).

Revision ID: bi07eml01
Revises: bi06oid08
Create Date: 2026-09-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "bi07eml01"
down_revision: Union[str, None] = "bi06oid08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _require_postgresql() -> None:
    if op.get_bind().dialect.name != "postgresql":
        raise RuntimeError("CASHIER-EMAIL-OPTIONAL-01 migration requires PostgreSQL")


def _email_is_nullable() -> bool:
    return (
        op.get_bind().execute(
            sa.text(
                """
                SELECT is_nullable FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'users' AND column_name = 'email'
                """
            )
        ).scalar()
        == "YES"
    )


def _null_email_count() -> int:
    return int(
        op.get_bind().execute(
            sa.text("SELECT COUNT(*) FROM users WHERE email IS NULL")
        ).scalar()
        or 0
    )


def upgrade() -> None:
    _require_postgresql()
    if _email_is_nullable():
        return
    op.alter_column("users", "email", existing_type=sa.String(255), nullable=True)


def downgrade() -> None:
    _require_postgresql()
    if not _email_is_nullable():
        return
    if _null_email_count() > 0:
        raise RuntimeError(
            "CASHIER-EMAIL-OPTIONAL-01 downgrade refused: "
            "users.email rows are NULL"
        )
    op.alter_column("users", "email", existing_type=sa.String(255), nullable=False)

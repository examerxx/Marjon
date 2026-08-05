"""Add vat_rate/service_fee to companies (BE-09)

The frontend company-profile screen expects vat_rate and service_fee, but
neither existed on the Company model at all — PATCH /companies/me
silently ignored them (CompanyUpdate had no such fields, and pydantic's
default extra="ignore" means an unknown field is just dropped, not
rejected), so the screen could show a 200 success while the values were
never actually persisted.

Revision ID: s0t1cmp1
Revises: r8s9pin01
Create Date: 2026-08-06
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "s0t1cmp1"
down_revision: Union[str, None] = "r8s9pin01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("vat_rate", sa.Numeric(5, 2), nullable=True))
    op.add_column("companies", sa.Column("service_fee", sa.Numeric(5, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("companies", "service_fee")
    op.drop_column("companies", "vat_rate")

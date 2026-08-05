"""Add address/phone/inn/logo_url/logo_key to companies table

Same class of bug as k8l9sync01/j6k7usr02: SettingsProfilePage.jsx already
sends address/phone/inn/logo to the company profile, but CompanyUpdate/Response
never had matching columns, so the data was silently dropped and only kept in
browser localStorage. This wires it up for real, including a printable company
logo (app/modules/printers/formatter.py renders it as an ESC/POS raster image).

Revision ID: p5q6logo1
Revises: n3o4rcpt01
Create Date: 2026-08-01
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "p5q6logo1"
down_revision: Union[str, None] = "n3o4rcpt01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("address", sa.Text(), nullable=True))
    op.add_column("companies", sa.Column("phone", sa.String(32), nullable=True))
    op.add_column("companies", sa.Column("inn", sa.String(32), nullable=True))
    op.add_column("companies", sa.Column("logo_url", sa.String(512), nullable=True))
    op.add_column("companies", sa.Column("logo_key", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("companies", "logo_key")
    op.drop_column("companies", "logo_url")
    op.drop_column("companies", "inn")
    op.drop_column("companies", "phone")
    op.drop_column("companies", "address")

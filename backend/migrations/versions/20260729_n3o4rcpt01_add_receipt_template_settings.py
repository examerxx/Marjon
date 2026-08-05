"""Add receipt_template_settings table

Backs GET/PATCH /settings/receipt-template and /settings/kitchen-receipt-template
(app/modules/kafe_compat/router.py), one row per company holding the customer
and kitchen receipt templates the frontend editor (ReceiptSettingsPage,
ChefReceiptSettingsPage) saves — consumed by EscPosFormatter at print time.

Revision ID: n3o4rcpt01
Revises: g2h3usr01
Create Date: 2026-07-29

Note: upstream (source repo) chains this after m1n2sync02 (halls/tables/
product_recipes), h4i5pin01 (pin_hash), j6k7usr02, k8l9sync01 — none of
which exist in this branch's migration history. Retargeted to our actual
head since this table is self-contained (only FKs to companies.id, which
already exists) and doesn't depend on any of those.
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
from sqlalchemy.types import Uuid

revision: str = "n3o4rcpt01"
down_revision: Union[str, None] = "g2h3usr01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "receipt_template_settings",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, unique=True, index=True),
        sa.Column("customer_template", sa.JSON(), nullable=False),
        sa.Column("kitchen_template", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("receipt_template_settings")

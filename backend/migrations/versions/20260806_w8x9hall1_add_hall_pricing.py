"""Add place-pricing fields to halls (BE-14)

Текущий /halls didn't match the "places" screen at all —
SettingsPlacesPage.jsx posts {name, condition, percent, payment_type} to
this exact endpoint (no branch_id), while HallCreate only knew name/
description/branch_id (branch_id required, no default). Extended the
existing Hall model (ТЗ's "Вариант A") rather than adding a parallel
/settings/places endpoint, since the frontend already targets /halls.

Revision ID: w8x9hall1
Revises: v6w7prn1
Create Date: 2026-08-06
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
from sqlalchemy.types import Uuid

revision: str = "w8x9hall1"
down_revision: Union[str, None] = "v6w7prn1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("halls", sa.Column("condition", sa.Text(), nullable=True))
    op.add_column("halls", sa.Column("percent", sa.Numeric(5, 2), nullable=True))
    op.add_column("halls", sa.Column("pricing_type", sa.String(20), nullable=True))
    op.add_column(
        "halls",
        sa.Column("payment_type_id", Uuid(as_uuid=True),
                  sa.ForeignKey("fin_payment_types.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("halls", "payment_type_id")
    op.drop_column("halls", "pricing_type")
    op.drop_column("halls", "percent")
    op.drop_column("halls", "condition")

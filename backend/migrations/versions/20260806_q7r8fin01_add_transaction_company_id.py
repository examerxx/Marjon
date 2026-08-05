"""Add company_id to fin_transactions (BE-04)

/finance/transactions was reached by both the HQ admin panel and the
owner/kafe app under the same path with different intended semantics:
FinTransaction only had organization_id (an HQ concept), so the kafe-side
handlers in kafe_compat/router.py — despite their own comment claiming
"company-scoped" — never actually filtered by company at all. This adds
the missing column so the kafe endpoints can be genuinely company-scoped,
while the HQ endpoints (now moved to /hq/finance/*) keep using
organization_id unchanged.

Revision ID: q7r8fin01
Revises: p5q6logo1
Create Date: 2026-08-06
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
from sqlalchemy.types import Uuid

revision: str = "q7r8fin01"
down_revision: Union[str, None] = "p5q6logo1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "fin_transactions",
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_fin_transactions_company_id", "fin_transactions", ["company_id"])


def downgrade() -> None:
    op.drop_index("ix_fin_transactions_company_id", table_name="fin_transactions")
    op.drop_column("fin_transactions", "company_id")

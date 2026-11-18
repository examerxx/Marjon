"""Identify cashier shifts opened in a terminal support session."""
from alembic import op
import sqlalchemy as sa

revision = "support_session_shifts"
down_revision = "layout01"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("cashier_shifts", sa.Column(
        "support_session", sa.Boolean(), nullable=False, server_default=sa.false()
    ))


def downgrade():
    op.drop_column("cashier_shifts", "support_session")

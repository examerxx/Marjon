"""Seed the default payment methods and VIP expense category."""
from uuid import UUID

from alembic import op
from sqlalchemy.dialects.postgresql import insert
import sqlalchemy as sa

revision = "vipfinance01"
down_revision = "display01"
branch_labels = None
depends_on = None

PAYMENT_TYPES = (
    ("fef15000-0000-4000-8000-000000000001", "Наличными", "cash"),
    ("fef15000-0000-4000-8000-000000000002", "Карта", "card"),
    ("fef15000-0000-4000-8000-000000000003", "VIP", "vip"),
    ("fef15000-0000-4000-8000-000000000004", "В долг", "debt"),
)
VIP_CATEGORY = UUID("fef15000-0000-4000-8000-000000000005")


def upgrade():
    payments = sa.table(
        "fin_payment_types", sa.column("id", sa.Uuid()), sa.column("name", sa.String()),
        sa.column("type", sa.String()), sa.column("sort", sa.Integer()), sa.column("status", sa.Boolean()), sa.column("scope_kind", sa.String()),
    )
    op.execute(insert(payments).values([
        dict(id=UUID(payment_id), name=name, type=kind, sort=index, status=True, scope_kind="system")
        for index, (payment_id, name, kind) in enumerate(PAYMENT_TYPES, start=1)
    ]).on_conflict_do_update(index_elements=["id"], set_={"sort": sa.literal_column("excluded.sort")}))
    categories = sa.table(
        "fin_transaction_categories", sa.column("id", sa.Uuid()), sa.column("name", sa.String()),
        sa.column("kind", sa.String()), sa.column("status", sa.Boolean()), sa.column("scope_kind", sa.String()),
    )
    op.execute(insert(categories).values(
        id=VIP_CATEGORY, name="VIP", kind="expense", status=True, scope_kind="system",
    ).on_conflict_do_nothing(index_elements=["id"]))


def downgrade():
    # Keep dictionary references intact once used by a tenant or a transaction.
    for payment_id, _, _ in PAYMENT_TYPES:
        op.execute(sa.text("""
            DELETE FROM fin_payment_types
            WHERE id = :id AND NOT EXISTS (
                SELECT 1 FROM fin_transactions WHERE payment_type_id = :id
            ) AND NOT EXISTS (
                SELECT 1 FROM fin_payment_types WHERE source_template_id = :id
            )
        """).bindparams(sa.bindparam("id", UUID(payment_id), type_=sa.Uuid())))
    op.execute(sa.text("""
        DELETE FROM fin_transaction_categories
        WHERE id = :id AND NOT EXISTS (
            SELECT 1 FROM fin_transactions WHERE category_id = :id
        ) AND NOT EXISTS (
            SELECT 1 FROM fin_transaction_categories WHERE source_template_id = :id OR parent_id = :id
        )
    """).bindparams(sa.bindparam("id", VIP_CATEGORY, type_=sa.Uuid())))

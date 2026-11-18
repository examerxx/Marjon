"""Приход товаров: как оплачен — сразу или в долг поставщику.

payment_mode: 'paid' — оплачен сразу (создан денежный расход), 'credit' — на потом
(сумма — кредиторка перед поставщиком). NULL — старые приходы, ничего не меняется.
"""
from alembic import op
import sqlalchemy as sa

revision = "purchasepay01"
down_revision = "printer02"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("purchase_documents", sa.Column("payment_mode", sa.String(length=10), nullable=True))
    op.add_column("purchase_documents", sa.Column("payment_type_id", sa.Uuid(), nullable=True))
    op.add_column("purchase_documents", sa.Column("finance_transaction_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_purchase_documents_payment_type", "purchase_documents", "fin_payment_types",
        ["payment_type_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_purchase_documents_fin_tx", "purchase_documents", "fin_transactions",
        ["finance_transaction_id"], ["id"], ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint("fk_purchase_documents_fin_tx", "purchase_documents", type_="foreignkey")
    op.drop_constraint("fk_purchase_documents_payment_type", "purchase_documents", type_="foreignkey")
    op.drop_column("purchase_documents", "finance_transaction_id")
    op.drop_column("purchase_documents", "payment_type_id")
    op.drop_column("purchase_documents", "payment_mode")

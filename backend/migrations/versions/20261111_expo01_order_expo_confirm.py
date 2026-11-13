"""expo01_order_expo_confirm

Revision ID: expo01
Revises: layout01
Create Date: 2026-11-11

Раздача (expo) как отдельный гейт между «повар всё сделал» и ТВ-экраном:
повар отмечает блюда готовыми, сотрудник раздачи подтверждает выдачу, и
только после этого заказ уходит на экран посетителей как «готов».
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "expo01"
down_revision: Union[str, None] = "layout01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "orders", sa.Column("expo_confirmed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "orders", sa.Column("expo_confirmed_by_id", sa.Uuid(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_orders_expo_confirmed_by_id_users",
        "orders",
        "users",
        ["expo_confirmed_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_orders_expo_confirmed_by_id", "orders", ["expo_confirmed_by_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_orders_expo_confirmed_by_id", table_name="orders")
    op.drop_constraint("fk_orders_expo_confirmed_by_id_users", "orders", type_="foreignkey")
    op.drop_column("orders", "expo_confirmed_by_id")
    op.drop_column("orders", "expo_confirmed_at")

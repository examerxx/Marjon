"""offline01_order_sync

Revision ID: offline01
Revises: display01
Create Date: 2026-11-13

Офлайн-заказы кассы: клиентский UUID для идемпотентного повтора, локальный
номер терминала, время создания офлайн и время приёма сервером. Уникальный
частичный индекс (company_id, client_id) не даёт принять один заказ дважды.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "offline01"
down_revision: Union[str, None] = "display01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("client_id", sa.String(length=64), nullable=True))
    op.add_column("orders", sa.Column("client_number", sa.String(length=40), nullable=True))
    op.add_column(
        "orders", sa.Column("created_offline_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "orders", sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        "uq_orders_company_client_id",
        "orders",
        ["company_id", "client_id"],
        unique=True,
        postgresql_where=sa.text("client_id IS NOT NULL"),
        sqlite_where=sa.text("client_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_orders_company_client_id", table_name="orders")
    op.drop_column("orders", "synced_at")
    op.drop_column("orders", "created_offline_at")
    op.drop_column("orders", "client_number")
    op.drop_column("orders", "client_id")

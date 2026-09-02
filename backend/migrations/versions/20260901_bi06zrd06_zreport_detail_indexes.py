"""Index the per-entity Z-report attribution columns.

ZR-PRINT-01B: /analytics/z-report/detail filters and groups facts by exactly two
personnel columns — orders.waiter_id (waiter dimension) and payments.cashier_id
(cashier dimension, the completed payment that closed an order). Both were
declared as plain FKs with no index, so every per-entity detail query narrowed on
company_id and then filtered an unindexed column.

The hall dimension already has its path indexed (ix_orders_table_id +
ix_tables_hall_id), so nothing is added for it here. Scope is deliberately the
two direct predicates only: no speculative composite or unrelated index.

Both columns are nullable and both indexes are plain btree, so NULL-heavy rows
(gateway payments carry cashier_id NULL) cost nothing extra and no row is
rewritten. Purely additive and idempotent in both directions.

Revision ID: bi06zrd06
Revises: bi06hde05
Create Date: 2026-09-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "bi06zrd06"
down_revision: Union[str, None] = "bi06hde05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (index name, table, column)
_INDEXES: tuple[tuple[str, str, str], ...] = (
    ("ix_orders_waiter_id", "orders", "waiter_id"),
    ("ix_payments_cashier_id", "payments", "cashier_id"),
)


def _require_postgresql() -> None:
    if op.get_bind().dialect.name != "postgresql":
        raise RuntimeError("BI-06 Z-report detail index migration requires PostgreSQL")


def _index_exists(name: str) -> bool:
    return bool(
        op.get_bind()
        .execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM pg_indexes
                    WHERE schemaname = current_schema() AND indexname = :index
                )
                """
            ),
            {"index": name},
        )
        .scalar()
    )


def upgrade() -> None:
    _require_postgresql()
    for name, table, column in _INDEXES:
        if not _index_exists(name):
            op.create_index(name, table, [column])


def downgrade() -> None:
    _require_postgresql()
    for name, table, _column in reversed(_INDEXES):
        if _index_exists(name):
            op.drop_index(name, table_name=table)

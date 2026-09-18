"""Add cancellation truth columns (orders/order_items.cancelled_at/by).

Phase 1A Cancelled Dishes foundation: truthful per-entity cancellation event
(when/who), separate from updated_at / Order.waiter_id / Payment.cashier_id.

Additive and non-destructive: four nullable columns, all starting NULL for
every existing row (unknown/legacy truth is never backfilled from updated_at,
waiter or cashier). No data rewrite, no default actor, no reason column.
System/webhook cancellations legitimately keep cancelled_by_id NULL.

Revision ID: bi06ccd07
Revises: bi06zrd06
Create Date: 2026-09-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "bi06ccd07"
down_revision: Union[str, None] = "bi06zrd06"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS: tuple[tuple[str, str], ...] = (
    ("orders", "cancelled_at"),
    ("orders", "cancelled_by_id"),
    ("order_items", "cancelled_at"),
    ("order_items", "cancelled_by_id"),
)

_INDEXES: tuple[tuple[str, str, str], ...] = (
    ("ix_orders_cancelled_by_id", "orders", "cancelled_by_id"),
    ("ix_order_items_cancelled_by_id", "order_items", "cancelled_by_id"),
)

_FKS: tuple[tuple[str, str, str], ...] = (
    ("orders_cancelled_by_id_fkey", "orders", "cancelled_by_id"),
    ("order_items_cancelled_by_id_fkey", "order_items", "cancelled_by_id"),
)


def _require_postgresql() -> None:
    if op.get_bind().dialect.name != "postgresql":
        raise RuntimeError("BI-06 cancellation truth migration requires PostgreSQL")


def _column_exists(table: str, column: str) -> bool:
    return bool(
        op.get_bind()
        .execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = :table
                      AND column_name = :column
                )
                """
            ),
            {"table": table, "column": column},
        )
        .scalar()
    )


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


def _fk_exists(table: str, fk: str) -> bool:
    return bool(
        op.get_bind()
        .execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = :fk
                      AND conrelid = CAST(:table AS regclass)
                )
                """
            ),
            {"fk": fk, "table": table},
        )
        .scalar()
    )


def upgrade() -> None:
    _require_postgresql()
    if not _column_exists("orders", "cancelled_at"):
        op.add_column(
            "orders",
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _column_exists("orders", "cancelled_by_id"):
        op.add_column(
            "orders",
            sa.Column("cancelled_by_id", sa.Uuid(), nullable=True),
        )
        op.create_foreign_key(
            "orders_cancelled_by_id_fkey",
            "orders",
            "users",
            ["cancelled_by_id"],
            ["id"],
            ondelete="SET NULL",
        )
    elif not _fk_exists("orders", "orders_cancelled_by_id_fkey"):
        op.create_foreign_key(
            "orders_cancelled_by_id_fkey",
            "orders",
            "users",
            ["cancelled_by_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if not _column_exists("order_items", "cancelled_at"):
        op.add_column(
            "order_items",
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _column_exists("order_items", "cancelled_by_id"):
        op.add_column(
            "order_items",
            sa.Column("cancelled_by_id", sa.Uuid(), nullable=True),
        )
        op.create_foreign_key(
            "order_items_cancelled_by_id_fkey",
            "order_items",
            "users",
            ["cancelled_by_id"],
            ["id"],
            ondelete="SET NULL",
        )
    elif not _fk_exists("order_items", "order_items_cancelled_by_id_fkey"):
        op.create_foreign_key(
            "order_items_cancelled_by_id_fkey",
            "order_items",
            "users",
            ["cancelled_by_id"],
            ["id"],
            ondelete="SET NULL",
        )
    for name, table, column in _INDEXES:
        if not _index_exists(name):
            op.create_index(name, table, [column])
    # No backfill: historical rows stay NULL where truth is unknown.
    # Never derive cancelled_at from updated_at, nor actor from waiter/cashier.


def downgrade() -> None:
    _require_postgresql()
    for name, table, _column in reversed(_INDEXES):
        if _index_exists(name):
            op.drop_index(name, table_name=table)
    for fk, table, _column in reversed(_FKS):
        if _column_exists(table, _column) and _fk_exists(table, fk):
            op.drop_constraint(fk, table, type_="foreignkey")
    for table, column in reversed(_COLUMNS):
        if _column_exists(table, column):
            op.drop_column(table, column)

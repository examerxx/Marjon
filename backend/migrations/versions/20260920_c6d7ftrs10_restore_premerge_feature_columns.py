"""Restore premerge feature columns dropped by the upstream merge

The cross-lineage merge with upstream deleted our fork's old migration lineage,
so a set of columns the models still declare lost their migration. They are part
of features we deliberately kept:
  * companies: cancel_password (opt-in order-cancel secret, read by pos/service),
    waiter_service_percent (waiter share in the waiters report), and the receipt-
    constructor templates receipt_template / kitchen_receipt_template;
  * products: stop-list / daily_limit and sold_count;
  * POS heritage on orders / order_items: customer contact, receipt stamp,
    cancel comment, takeaway, item author.
The four companies columns matter even beyond their features: repository.py,
kafe_compat and printers load the whole Company entity (select(Company) /
db.get(Company)), so on Postgres a missing column breaks company-by-slug login
lookup, not just the feature. This re-adds them on top of the surviving chain.

Idempotent, like the sibling column-restore migrations: a database bootstrapped
by create_tables.py (metadata.create_all + `alembic stamp head`) already has the
columns and may still be stamped earlier — each column is added only when the
inspector doesn't see it. Server defaults keep existing rows valid for the three
NOT NULL columns (companies.waiter_service_percent, products.sold_count,
order_items.takeaway).

Revision ID: c6d7ftrs10
Revises: b5c6modpos09
Create Date: 2026-09-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "c6d7ftrs10"
down_revision: Union[str, None] = "b5c6modpos09"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


# Cross-СУБД JSON: JSONB на Postgres, обычный JSON на SQLite — как в модели
# (app/modules/organizations/models.py: JsonType) и в миграции a1f2admin01.
_JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


# (table, column, type, add-column kwargs) — nullable columns need no default;
# the three NOT NULL columns carry a server_default so existing rows stay valid.
_ADDS: tuple[tuple[str, str, sa.types.TypeEngine, dict], ...] = (
    ("companies", "cancel_password", sa.String(length=64), {"nullable": True}),
    ("companies", "waiter_service_percent", sa.Integer(), {"nullable": False, "server_default": "0"}),
    ("companies", "receipt_template", _JSON, {"nullable": True}),
    ("companies", "kitchen_receipt_template", _JSON, {"nullable": True}),
    ("products", "daily_limit", sa.Integer(), {"nullable": True}),
    ("products", "sold_count", sa.Integer(), {"nullable": False, "server_default": "0"}),
    ("orders", "customer_phone", sa.String(length=30), {"nullable": True}),
    ("orders", "customer_address", sa.Text(), {"nullable": True}),
    ("orders", "receipt_printed_at", sa.DateTime(timezone=True), {"nullable": True}),
    ("orders", "cancel_comment", sa.Text(), {"nullable": True}),
    ("order_items", "takeaway", sa.Boolean(), {"nullable": False, "server_default": sa.false()}),
    # users.permissions — опциональный легаси-слой пер-юзерных тумблеров прав
    # (см. app/modules/auth/models.py). Nullable, RBAC остаётся основным путём.
    ("users", "permissions", _JSON, {"nullable": True}),
)


def upgrade() -> None:
    for table, column, coltype, kwargs in _ADDS:
        if column not in _columns(table):
            op.add_column(table, sa.Column(column, coltype, **kwargs))

    # order_items.added_by → users.id (nullable FK). Named constraint so the
    # downgrade can drop it explicitly on backends that require a name.
    if "added_by" not in _columns("order_items"):
        op.add_column(
            "order_items",
            sa.Column(
                "added_by",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("users.id", name="fk_order_items_added_by_users"),
                nullable=True,
            ),
        )


def downgrade() -> None:
    if "added_by" in _columns("order_items"):
        op.drop_column("order_items", "added_by")
    for table, column, _coltype, _kwargs in reversed(_ADDS):
        if column in _columns(table):
            op.drop_column(table, column)

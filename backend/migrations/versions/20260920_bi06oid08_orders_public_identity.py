"""ORDERS-TRUTH-01: per-company order public_id + plain daily order_number + hall snapshot.

Additive, non-destructive backend identity truth for the Orders report:

  A. orders.public_id — stable PER-COMPANY numeric business id (BIGINT, NOT
     NULL). Each company numbers independently from 10000000 (a display target,
     not a hard cap — it may grow to 9+ digits rather than ever reuse a value).
     Uniqueness is composite UNIQUE(company_id, public_id) — never global, so it
     leaks no platform-wide order volume and gives each tenant its own 8-digit
     space. The canonical UUID orders.id is UNCHANGED. Existing rows are
     backfilled deterministically PER COMPANY (created_at ASC, id ASC).

  B. orders.order_local_date — the company-local calendar date a NEW-format
     order_number belongs to. NULL for legacy rows (they keep their historical
     "YYYYMMDD-NNNN" order_number and stay outside the per-day backstop).

  C. orders.hall_name_snapshot — Hall.name frozen at order time. Backfilled
     ONLY where table_id still resolves to a Table→Hall; otherwise left NULL
     (never invented). A later hall rename/archival never changes it.

  D. order_number_counters — durable per (company, branch, local_date) counter.
     order_public_id_counters — durable per-company public_id counter
     (initialized to MAX(public_id) after backfill; first future value = MAX+1).

  E. Partial UNIQUE (company_id, branch_id, order_local_date, order_number)
     WHERE order_local_date IS NOT NULL — DB backstop for the new numbering;
     legacy rows (order_local_date NULL) are exempt.

Legacy order_number / UUID / created_at values are NOT rewritten. PostgreSQL
only. Additive and idempotent; safe for existing data.

Revision ID: bi06oid08
Revises: bi06ccd07
Create Date: 2026-09-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "bi06oid08"
down_revision: Union[str, None] = "bi06ccd07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PUBLIC_ID_START = 10000000


def _require_postgresql() -> None:
    if op.get_bind().dialect.name != "postgresql":
        raise RuntimeError("ORDERS-TRUTH-01 migration requires PostgreSQL")


def _column_exists(table: str, column: str) -> bool:
    return bool(
        op.get_bind().execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = :table AND column_name = :column
                )
                """
            ),
            {"table": table, "column": column},
        ).scalar()
    )


def _table_exists(table: str) -> bool:
    return bool(
        op.get_bind().execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = current_schema() AND table_name = :table
                )
                """
            ),
            {"table": table},
        ).scalar()
    )


def _index_exists(name: str) -> bool:
    return bool(
        op.get_bind().execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM pg_indexes "
                "WHERE schemaname = current_schema() AND indexname = :i)"
            ),
            {"i": name},
        ).scalar()
    )


def _constraint_exists(name: str) -> bool:
    return bool(
        op.get_bind().execute(
            sa.text("SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = :c)"),
            {"c": name},
        ).scalar()
    )


def upgrade() -> None:
    _require_postgresql()

    # ── A. public_id: per-company deterministic backfill, NOT NULL, composite unique
    if not _column_exists("orders", "public_id"):
        op.add_column("orders", sa.Column("public_id", sa.BigInteger(), nullable=True))
        # Deterministic backfill PER COMPANY: each tenant's rows numbered from
        # 10000000 by (created_at ASC, id ASC). row_number is partitioned by
        # company_id so every company starts independently at 10000000.
        op.execute(
            sa.text(
                f"""
                WITH ordered AS (
                    SELECT id,
                           row_number() OVER (
                               PARTITION BY company_id
                               ORDER BY created_at ASC, id ASC
                           ) - 1 AS rn
                    FROM orders
                )
                UPDATE orders o
                   SET public_id = {PUBLIC_ID_START} + ordered.rn
                  FROM ordered
                 WHERE o.id = ordered.id
                """
            )
        )
    if not _constraint_exists("uq_orders_company_public_id"):
        op.create_unique_constraint(
            "uq_orders_company_public_id", "orders", ["company_id", "public_id"]
        )
    # Invariant: public_id is NEVER NULL. Safe because every existing row was
    # just backfilled and the sole production creator (OrderService.create)
    # always assigns it from the per-company counter below.
    op.execute(sa.text("ALTER TABLE orders ALTER COLUMN public_id SET NOT NULL"))

    # ── B. order_local_date (NULL for legacy) ────────────────────────────────
    if not _column_exists("orders", "order_local_date"):
        op.add_column("orders", sa.Column("order_local_date", sa.Date(), nullable=True))

    # ── C. hall_name_snapshot + backfill only where table_id resolves ────────
    if not _column_exists("orders", "hall_name_snapshot"):
        op.add_column("orders", sa.Column("hall_name_snapshot", sa.String(length=255), nullable=True))
        op.execute(
            sa.text(
                """
                UPDATE orders o
                   SET hall_name_snapshot = h.name
                  FROM tables t
                  JOIN halls h ON h.id = t.hall_id
                 WHERE o.table_id = t.id
                """
            )
        )

    # ── D. durable counter tables ────────────────────────────────────────────
    if not _table_exists("order_number_counters"):
        op.create_table(
            "order_number_counters",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("company_id", sa.Uuid(), sa.ForeignKey("companies.id"), nullable=False, index=True),
            sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id"), nullable=False, index=True),
            sa.Column("local_date", sa.Date(), nullable=False),
            sa.Column("last_value", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("company_id", "branch_id", "local_date", name="uq_order_number_counters_scope"),
        )
    if not _table_exists("order_public_id_counters"):
        op.create_table(
            "order_public_id_counters",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("company_id", sa.Uuid(), sa.ForeignKey("companies.id"), nullable=False, index=True),
            sa.Column("last_value", sa.BigInteger(), nullable=False, server_default=sa.text(str(PUBLIC_ID_START - 1))),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("company_id", name="uq_order_public_id_counters_company"),
        )
        # Initialize each company's counter to its backfilled MAX(public_id) so
        # the next generated value is MAX+1. Companies with no orders get no row
        # (the service creates it lazily, starting at 10000000).
        op.execute(
            sa.text(
                """
                INSERT INTO order_public_id_counters (id, company_id, last_value, created_at, updated_at)
                SELECT gen_random_uuid(), company_id, MAX(public_id), now(), now()
                  FROM orders
                 GROUP BY company_id
                """
            )
        )

    # ── E. partial-unique backstop for the NEW numbering scheme ──────────────
    if not _index_exists("uq_orders_company_branch_localdate_number"):
        op.create_index(
            "uq_orders_company_branch_localdate_number",
            "orders",
            ["company_id", "branch_id", "order_local_date", "order_number"],
            unique=True,
            postgresql_where=sa.text("order_local_date IS NOT NULL"),
        )


def downgrade() -> None:
    _require_postgresql()
    if _index_exists("uq_orders_company_branch_localdate_number"):
        op.drop_index("uq_orders_company_branch_localdate_number", table_name="orders")
    if _table_exists("order_public_id_counters"):
        op.drop_table("order_public_id_counters")
    if _table_exists("order_number_counters"):
        op.drop_table("order_number_counters")
    if _column_exists("orders", "hall_name_snapshot"):
        op.drop_column("orders", "hall_name_snapshot")
    if _column_exists("orders", "order_local_date"):
        op.drop_column("orders", "order_local_date")
    if _constraint_exists("uq_orders_company_public_id"):
        op.drop_constraint("uq_orders_company_public_id", "orders", type_="unique")
    if _column_exists("orders", "public_id"):
        op.drop_column("orders", "public_id")

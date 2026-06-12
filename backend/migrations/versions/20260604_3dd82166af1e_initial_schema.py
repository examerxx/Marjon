"""initial_schema

Revision ID: 3dd82166af1e
Revises:
Create Date: 2026-06-04 10:28:49.518407

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.types import Uuid

revision: str = "3dd82166af1e"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Companies & Branches ──────────────────────────────────────────────
    op.create_table(
        "companies",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(100), unique=True, index=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("country_code", sa.String(2)),
        sa.Column("timezone", sa.String(50), server_default="UTC"),
        sa.Column("currency", sa.String(3), server_default="UZS"),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "branches",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("address", sa.Text),
        sa.Column("city", sa.String(100)),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Users & Auth ──────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("email", sa.String(255), unique=True, index=True, nullable=False),
        sa.Column("phone", sa.String(20)),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("is_superadmin", sa.Boolean, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "refresh_tokens",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("token_hash", sa.String(64), unique=True, nullable=False, index=True),
        sa.Column("device_id", sa.String(255)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── RBAC ──────────────────────────────────────────────────────────────
    op.create_table(
        "roles",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("is_system", sa.Boolean, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("company_id", "slug", name="uq_role_company_slug"),
    )

    op.create_table(
        "permissions",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("module", sa.String(50), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("scope", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("module", "action", "scope", name="uq_permission"),
    )

    op.create_table(
        "role_permissions",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("role_id", Uuid(as_uuid=True), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("permission_id", Uuid(as_uuid=True), sa.ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "user_roles",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("role_id", Uuid(as_uuid=True), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("branch_id", Uuid(as_uuid=True), sa.ForeignKey("branches.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Inventory ─────────────────────────────────────────────────────────
    op.create_table(
        "categories",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("parent_id", Uuid(as_uuid=True), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("image_url", sa.Text),
        sa.Column("sort_order", sa.Integer, server_default="0"),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "products",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("category_id", Uuid(as_uuid=True), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("image_url", sa.Text),
        sa.Column("barcode", sa.String(100)),
        sa.Column("sku", sa.String(100)),
        sa.Column("price", sa.Numeric(15, 2), nullable=False),
        sa.Column("cost_price", sa.Numeric(15, 2)),
        sa.Column("tax_rate", sa.Numeric(5, 2), server_default="12.0"),
        sa.Column("unit", sa.String(20), server_default="шт"),
        sa.Column("sort_order", sa.Integer, server_default="0"),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("is_available", sa.Boolean, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "modifier_groups",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("product_id", Uuid(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("min_select", sa.Integer, server_default="0"),
        sa.Column("max_select", sa.Integer, server_default="1"),
        sa.Column("is_required", sa.Boolean, server_default=sa.text("false")),
        sa.Column("sort_order", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "modifiers",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("group_id", Uuid(as_uuid=True), sa.ForeignKey("modifier_groups.id", ondelete="CASCADE")),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("price_delta", sa.Numeric(15, 2), server_default="0"),
        sa.Column("is_default", sa.Boolean, server_default=sa.text("false")),
        sa.Column("sort_order", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "product_branch",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("product_id", Uuid(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE"), index=True),
        sa.Column("branch_id", Uuid(as_uuid=True), sa.ForeignKey("branches.id", ondelete="CASCADE"), index=True),
        sa.Column("price", sa.Numeric(15, 2)),
        sa.Column("is_available", sa.Boolean, server_default=sa.text("true")),
        sa.Column("stop_list", sa.Boolean, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "ingredients",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), index=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("unit", sa.String(20), server_default="кг"),
        sa.Column("category", sa.String(100)),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "warehouses",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), index=True),
        sa.Column("branch_id", Uuid(as_uuid=True), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("address", sa.Text),
        sa.Column("is_main", sa.Boolean, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "stock_items",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("warehouse_id", Uuid(as_uuid=True), sa.ForeignKey("warehouses.id", ondelete="CASCADE"), index=True),
        sa.Column("ingredient_id", Uuid(as_uuid=True), sa.ForeignKey("ingredients.id"), index=True),
        sa.Column("quantity", sa.Numeric(15, 4), server_default="0"),
        sa.Column("unit", sa.String(20), server_default="кг"),
        sa.Column("min_quantity", sa.Numeric(15, 4), server_default="0"),
        sa.Column("cost_price", sa.Numeric(15, 4), server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "stock_movements",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("warehouse_id", Uuid(as_uuid=True), sa.ForeignKey("warehouses.id"), index=True),
        sa.Column("ingredient_id", Uuid(as_uuid=True), sa.ForeignKey("ingredients.id")),
        sa.Column("movement_type", sa.String(30), nullable=False),
        sa.Column("quantity", sa.Numeric(15, 4), nullable=False),
        sa.Column("unit", sa.String(20)),
        sa.Column("cost_price", sa.Numeric(15, 4), server_default="0"),
        sa.Column("total_cost", sa.Numeric(15, 2), server_default="0"),
        sa.Column("ref_id", Uuid(as_uuid=True), nullable=True),
        sa.Column("created_by", Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── CRM ───────────────────────────────────────────────────────────────
    op.create_table(
        "customers",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("name", sa.String(255)),
        sa.Column("email", sa.String(255)),
        sa.Column("birth_date", sa.Date),
        sa.Column("gender", sa.String(1)),
        sa.Column("source", sa.String(50), server_default="pos"),
        sa.Column("total_orders", sa.Integer, server_default="0"),
        sa.Column("total_spent", sa.Numeric(15, 2), server_default="0"),
        sa.Column("last_visit_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "customer_notes",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("customer_id", Uuid(as_uuid=True), sa.ForeignKey("customers.id", ondelete="CASCADE"), index=True),
        sa.Column("author_id", Uuid(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── POS ───────────────────────────────────────────────────────────────
    op.create_table(
        "pos_terminals",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("branch_id", Uuid(as_uuid=True), sa.ForeignKey("branches.id"), index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "orders",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("branch_id", Uuid(as_uuid=True), sa.ForeignKey("branches.id"), index=True),
        sa.Column("terminal_id", Uuid(as_uuid=True), sa.ForeignKey("pos_terminals.id"), nullable=True),
        sa.Column("customer_id", Uuid(as_uuid=True), sa.ForeignKey("customers.id"), nullable=True),
        sa.Column("waiter_id", Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("order_number", sa.String(20), nullable=False),
        sa.Column("order_type", sa.String(20), server_default="dine_in"),
        sa.Column("status", sa.String(20), server_default="new"),
        sa.Column("table_number", sa.String(20)),
        sa.Column("persons_count", sa.Integer, server_default="1"),
        sa.Column("subtotal", sa.Numeric(15, 2), server_default="0"),
        sa.Column("discount_amount", sa.Numeric(15, 2), server_default="0"),
        sa.Column("tax_amount", sa.Numeric(15, 2), server_default="0"),
        sa.Column("service_fee", sa.Numeric(15, 2), server_default="0"),
        sa.Column("total_amount", sa.Numeric(15, 2), server_default="0"),
        sa.Column("note", sa.Text),
        sa.Column("source", sa.String(50), server_default="pos"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "order_items",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("order_id", Uuid(as_uuid=True), sa.ForeignKey("orders.id", ondelete="CASCADE"), index=True),
        sa.Column("product_id", Uuid(as_uuid=True), sa.ForeignKey("products.id"), index=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("price", sa.Numeric(15, 2), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("discount", sa.Numeric(15, 2), server_default="0"),
        sa.Column("total", sa.Numeric(15, 2), nullable=False),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("note", sa.Text),
        sa.Column("modifiers", sa.JSON, server_default="[]"),
        sa.Column("course", sa.Integer, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Payments ──────────────────────────────────────────────────────────
    op.create_table(
        "payments",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("order_id", Uuid(as_uuid=True), sa.ForeignKey("orders.id"), index=True),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("method", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("provider_tx_id", sa.String(255)),
        sa.Column("provider_data", sa.JSON, server_default="{}"),
        sa.Column("cashier_id", Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("cash_received", sa.Numeric(15, 2)),
        sa.Column("change_given", sa.Numeric(15, 2)),
        sa.Column("receipt_url", sa.Text),
        sa.Column("fiscal_code", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Kitchen ───────────────────────────────────────────────────────────
    op.create_table(
        "kitchen_stations",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("branch_id", Uuid(as_uuid=True), sa.ForeignKey("branches.id"), index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("category_ids", sa.JSON, server_default="[]"),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Loyalty ───────────────────────────────────────────────────────────
    op.create_table(
        "loyalty_accounts",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("customer_id", Uuid(as_uuid=True), sa.ForeignKey("customers.id"), index=True),
        sa.Column("balance", sa.Numeric(15, 2), server_default="0"),
        sa.Column("lifetime_points", sa.Numeric(15, 2), server_default="0"),
        sa.Column("tier", sa.String(20), server_default="bronze"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("company_id", "customer_id", name="uq_loyalty_customer"),
    )

    op.create_table(
        "loyalty_transactions",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("account_id", Uuid(as_uuid=True), sa.ForeignKey("loyalty_accounts.id"), index=True),
        sa.Column("order_id", Uuid(as_uuid=True), sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("transaction_type", sa.String(20), nullable=False),
        sa.Column("points", sa.Numeric(15, 2), nullable=False),
        sa.Column("balance_after", sa.Numeric(15, 2), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Delivery ──────────────────────────────────────────────────────────
    op.create_table(
        "delivery_zones",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("branch_id", Uuid(as_uuid=True), sa.ForeignKey("branches.id"), index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("polygon", sa.JSON, server_default="[]"),
        sa.Column("delivery_fee", sa.Numeric(15, 2), server_default="0"),
        sa.Column("min_order", sa.Numeric(15, 2), server_default="0"),
        sa.Column("estimated_minutes", sa.Integer, server_default="30"),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "couriers",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("user_id", Uuid(as_uuid=True), sa.ForeignKey("users.id"), index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("vehicle_type", sa.String(20), server_default="bike"),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("is_available", sa.Boolean, server_default=sa.text("false")),
        sa.Column("current_lat", sa.Numeric(10, 8)),
        sa.Column("current_lng", sa.Numeric(11, 8)),
        sa.Column("last_location_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "delivery_orders",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("order_id", Uuid(as_uuid=True), sa.ForeignKey("orders.id"), index=True),
        sa.Column("courier_id", Uuid(as_uuid=True), sa.ForeignKey("couriers.id"), nullable=True),
        sa.Column("zone_id", Uuid(as_uuid=True), sa.ForeignKey("delivery_zones.id"), nullable=True),
        sa.Column("status", sa.String(20), server_default="new"),
        sa.Column("address_text", sa.Text, nullable=False),
        sa.Column("address_lat", sa.Numeric(10, 8)),
        sa.Column("address_lng", sa.Numeric(11, 8)),
        sa.Column("delivery_fee", sa.Numeric(15, 2), server_default="0"),
        sa.Column("estimated_time", sa.Integer),
        sa.Column("actual_time", sa.Integer),
        sa.Column("assigned_at", sa.DateTime(timezone=True)),
        sa.Column("picked_up_at", sa.DateTime(timezone=True)),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── HR ────────────────────────────────────────────────────────────────
    op.create_table(
        "employees",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("user_id", Uuid(as_uuid=True), sa.ForeignKey("users.id"), index=True),
        sa.Column("branch_id", Uuid(as_uuid=True), sa.ForeignKey("branches.id"), index=True),
        sa.Column("position", sa.String(100), nullable=False),
        sa.Column("hire_date", sa.Date, nullable=False),
        sa.Column("dismiss_date", sa.Date),
        sa.Column("salary_type", sa.String(20), server_default="fixed"),
        sa.Column("salary_amount", sa.Numeric(15, 2), server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "work_shifts",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("branch_id", Uuid(as_uuid=True), sa.ForeignKey("branches.id")),
        sa.Column("employee_id", Uuid(as_uuid=True), sa.ForeignKey("employees.id"), index=True),
        sa.Column("scheduled_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scheduled_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actual_start", sa.DateTime(timezone=True)),
        sa.Column("actual_end", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(20), server_default="scheduled"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "attendance_logs",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("employee_id", Uuid(as_uuid=True), sa.ForeignKey("employees.id"), index=True),
        sa.Column("shift_id", Uuid(as_uuid=True), sa.ForeignKey("work_shifts.id"), nullable=True),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("method", sa.String(20), server_default="manual"),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Notifications ─────────────────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("user_id", Uuid(as_uuid=True), sa.ForeignKey("users.id"), index=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("notification_type", sa.String(50), nullable=False),
        sa.Column("channel", sa.String(20), server_default="in_app"),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("data", sa.JSON, server_default="{}"),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Audit ─────────────────────────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("user_id", Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("branch_id", Uuid(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=False),
        sa.Column("entity_id", Uuid(as_uuid=True), nullable=True),
        sa.Column("old_data", sa.JSON),
        sa.Column("new_data", sa.JSON),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("user_agent", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Fiscal ────────────────────────────────────────────────────────────
    op.create_table(
        "fiscal_receipts",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("order_id", Uuid(as_uuid=True), sa.ForeignKey("orders.id"), index=True),
        sa.Column("payment_id", Uuid(as_uuid=True), sa.ForeignKey("payments.id"), index=True),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("fiscal_code", sa.String(255)),
        sa.Column("receipt_url", sa.Text),
        sa.Column("provider", sa.String(50), server_default="ofd_uz"),
        sa.Column("error_message", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Subscriptions ─────────────────────────────────────────────────────
    op.create_table(
        "plans",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(100), unique=True, nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("price_monthly", sa.Numeric(15, 2), nullable=False),
        sa.Column("price_yearly", sa.Numeric(15, 2), nullable=False),
        sa.Column("features", sa.JSON, server_default="{}"),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "subscriptions",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("plan_id", Uuid(as_uuid=True), sa.ForeignKey("plans.id"), index=True),
        sa.Column("status", sa.String(20), server_default="trial"),
        sa.Column("billing_cycle", sa.String(10), server_default="monthly"),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True)),
        sa.Column("current_period_start", sa.DateTime(timezone=True)),
        sa.Column("current_period_end", sa.DateTime(timezone=True)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "invoices",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("subscription_id", Uuid(as_uuid=True), sa.ForeignKey("subscriptions.id"), index=True),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("currency", sa.String(3), server_default="UZS"),
        sa.Column("status", sa.String(20), server_default="draft"),
        sa.Column("due_date", sa.DateTime(timezone=True)),
        sa.Column("paid_at", sa.DateTime(timezone=True)),
        sa.Column("payment_id", Uuid(as_uuid=True), sa.ForeignKey("payments.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Printers ──────────────────────────────────────────────────────────
    op.create_table(
        "printers",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), index=True),
        sa.Column("branch_id", Uuid(as_uuid=True), sa.ForeignKey("branches.id", ondelete="CASCADE"), index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("printer_type", sa.String(30), nullable=False),
        sa.Column("connection_type", sa.String(20), server_default="network"),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("port", sa.Integer, server_default="9100"),
        sa.Column("device_path", sa.String(100)),
        sa.Column("paper_width", sa.Integer, server_default="80"),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("settings", sa.JSON, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "print_jobs",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id"), index=True),
        sa.Column("printer_id", Uuid(as_uuid=True), sa.ForeignKey("printers.id", ondelete="CASCADE"), index=True),
        sa.Column("job_type", sa.String(30), nullable=False),
        sa.Column("ref_id", Uuid(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("payload", sa.String(65535), nullable=False),
        sa.Column("error", sa.String(500)),
        sa.Column("copies", sa.Integer, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    tables = [
        "print_jobs", "printers",
        "invoices", "subscriptions", "plans",
        "fiscal_receipts",
        "audit_logs",
        "notifications",
        "attendance_logs", "work_shifts", "employees",
        "delivery_orders", "couriers", "delivery_zones",
        "loyalty_transactions", "loyalty_accounts",
        "kitchen_stations",
        "payments",
        "order_items", "orders", "pos_terminals",
        "customer_notes", "customers",
        "stock_movements", "stock_items", "warehouses",
        "ingredients", "product_branch", "modifiers",
        "modifier_groups", "products", "categories",
        "user_roles", "role_permissions", "permissions", "roles",
        "refresh_tokens", "users",
        "branches", "companies",
    ]
    for t in tables:
        op.drop_table(t)

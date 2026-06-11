"""warehouse document tables

Revision ID: whdoc001
Revises: a1f2admin01
Create Date: 2026-06-11 17:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "whdoc001"
down_revision = "a1f2admin01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if "purchase_documents" in existing:
        # Tables already created manually — skip
        return

    op.create_table(
        "purchase_documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("supplier", sa.String(255), nullable=True),
        sa.Column("warehouse_id", UUID(as_uuid=True), sa.ForeignKey("warehouses.id"), nullable=True),
        sa.Column("warehouse_name", sa.String(255), nullable=True),
        sa.Column("date", sa.String(20), nullable=True),
        sa.Column("registered_at", sa.String(40), nullable=True),
        sa.Column("accepted_at", sa.String(40), nullable=True),
        sa.Column("items_count", sa.Integer(), server_default="0"),
        sa.Column("total_amount", sa.Numeric(15, 2), server_default="0"),
        sa.Column("status", sa.String(20), server_default="draft"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_by_name", sa.String(255), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), onupdate=sa.text("now()")),
    )

    op.create_table(
        "purchase_document_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("document_id", UUID(as_uuid=True), sa.ForeignKey("purchase_documents.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("ingredient_id", UUID(as_uuid=True), sa.ForeignKey("ingredients.id"), nullable=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("quantity", sa.Numeric(15, 4), server_default="0"),
        sa.Column("unit", sa.String(20), server_default="кг"),
        sa.Column("cost_price", sa.Numeric(15, 4), server_default="0"),
        sa.Column("total", sa.Numeric(15, 2), server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), onupdate=sa.text("now()")),
    )

    op.create_table(
        "transfer_documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("from_warehouse_id", UUID(as_uuid=True), sa.ForeignKey("warehouses.id"), nullable=True),
        sa.Column("from_warehouse_name", sa.String(255), nullable=True),
        sa.Column("to_warehouse_id", UUID(as_uuid=True), sa.ForeignKey("warehouses.id"), nullable=True),
        sa.Column("to_warehouse_name", sa.String(255), nullable=True),
        sa.Column("date", sa.String(20), nullable=True),
        sa.Column("items_count", sa.Integer(), server_default="0"),
        sa.Column("status", sa.String(20), server_default="draft"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_by_name", sa.String(255), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), onupdate=sa.text("now()")),
    )

    op.create_table(
        "inventory_checks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("warehouse_id", UUID(as_uuid=True), sa.ForeignKey("warehouses.id"), nullable=True),
        sa.Column("warehouse_name", sa.String(255), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("check_type", sa.String(100), server_default="Приход и расход учтены"),
        sa.Column("status", sa.String(20), server_default="draft"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_by_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), onupdate=sa.text("now()")),
    )

    op.create_table(
        "write_off_documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("category", sa.String(255), nullable=True),
        sa.Column("items_count", sa.Integer(), server_default="0"),
        sa.Column("status", sa.String(20), server_default="draft"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_by_name", sa.String(255), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), onupdate=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("write_off_documents")
    op.drop_table("inventory_checks")
    op.drop_table("transfer_documents")
    op.drop_table("purchase_document_items")
    op.drop_table("purchase_documents")

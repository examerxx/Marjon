"""Add semi_products + semi_product_ingredients (BE-10)

/inventory/semi-products didn't exist on the backend at all — the
NomenclaturePage.jsx "Полуфабрикаты" tab has called this endpoint since
before this ticket, always hitting a 404 and silently falling back to
demo data.

Revision ID: t2u3semi1
Revises: s0t1cmp1
Create Date: 2026-08-06
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
from sqlalchemy.types import Uuid

revision: str = "t2u3semi1"
down_revision: Union[str, None] = "s0t1cmp1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "semi_products",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("company_id", Uuid(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", Uuid(as_uuid=True), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("subcategory_id", Uuid(as_uuid=True), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("unit", sa.String(20), nullable=False, server_default="кг"),
        sa.Column("cost_price", sa.Numeric(15, 4), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_semi_products_company_id", "semi_products", ["company_id"])

    op.create_table(
        "semi_product_ingredients",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("semi_product_id", Uuid(as_uuid=True), sa.ForeignKey("semi_products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ingredient_id", Uuid(as_uuid=True), sa.ForeignKey("ingredients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quantity", sa.Numeric(15, 4), nullable=False),
    )
    op.create_index("ix_semi_product_ingredients_semi_product_id", "semi_product_ingredients", ["semi_product_id"])
    op.create_index("ix_semi_product_ingredients_ingredient_id", "semi_product_ingredients", ["ingredient_id"])


def downgrade() -> None:
    op.drop_table("semi_product_ingredients")
    op.drop_table("semi_products")

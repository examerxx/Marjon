"""BE-16: product response contract — product_type/subcategory/printer + composition

NomenclaturePage.jsx (owner app "Блюда" screen, GET/POST/PATCH
/inventory/products) reads product_type, category_name, subcategory_name,
printer_name, ingredients_count, stock — none of which existed. Adds the
real columns plus a product_ingredients composition table (mirrors BE-10's
semi_product_ingredients) so ingredients_count/stock are genuinely computed,
not fabricated.

Revision ID: y2z3prod1
Revises: x0y1org1
Create Date: 2026-08-06
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
from sqlalchemy.types import Uuid

revision: str = "y2z3prod1"
down_revision: Union[str, None] = "x0y1org1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("product_type", sa.String(20), nullable=False, server_default="dish"),
    )
    op.add_column(
        "products",
        sa.Column("subcategory_id", Uuid(as_uuid=True), sa.ForeignKey("categories.id"), nullable=True),
    )
    op.add_column(
        "products",
        sa.Column("printer_id", Uuid(as_uuid=True), sa.ForeignKey("printers.id", ondelete="SET NULL"), nullable=True),
    )

    op.create_table(
        "product_ingredients",
        sa.Column("id", Uuid(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("product_id", Uuid(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ingredient_id", Uuid(as_uuid=True), sa.ForeignKey("ingredients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quantity", sa.Numeric(15, 4), nullable=False),
    )
    op.create_index("ix_product_ingredients_product_id", "product_ingredients", ["product_id"])
    op.create_index("ix_product_ingredients_ingredient_id", "product_ingredients", ["ingredient_id"])


def downgrade() -> None:
    op.drop_table("product_ingredients")
    op.drop_column("products", "printer_id")
    op.drop_column("products", "subcategory_id")
    op.drop_column("products", "product_type")

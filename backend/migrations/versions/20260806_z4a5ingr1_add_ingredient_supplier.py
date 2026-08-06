"""BE-17: add supplier_name to ingredients

stock/min_stock/purchase_price are aggregated from StockItem rows at read
time (an ingredient's real stock/cost is per-warehouse, summed/averaged
across them — see IngredientService), not stored on Ingredient itself.
supplier_name is the one field that's genuinely a property of the
ingredient, not derived, so it gets a real column.

Revision ID: z4a5ingr1
Revises: y2z3prod1
Create Date: 2026-08-06
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "z4a5ingr1"
down_revision: Union[str, None] = "y2z3prod1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ingredients", sa.Column("supplier_name", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("ingredients", "supplier_name")

from alembic import op
import sqlalchemy as sa

revision = "printer02"
down_revision = "vipfinance01"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("products", sa.Column("secondary_printer_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_products_secondary_printer", "products", "printers",
        ["secondary_printer_id"], ["id"], ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint("fk_products_secondary_printer", "products", type_="foreignkey")
    op.drop_column("products", "secondary_printer_id")

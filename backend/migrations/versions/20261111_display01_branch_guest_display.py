"""display01_branch_guest_display

Revision ID: display01
Revises: expo01
Create Date: 2026-11-11

Выключатель публичного экрана очереди на филиале. Десктоп кассы переключает
флаг, ТВ-страница читает его вместе с доской: при false номера заказов не
отдаются, на подключённом экране остаётся только логотип.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "display01"
down_revision: Union[str, None] = "expo01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "branches",
        sa.Column(
            "guest_display_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("branches", "guest_display_enabled")

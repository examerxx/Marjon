"""initial_schema

Revision ID: 3dd82166af1e
Revises:
Create Date: 2026-06-04 10:28:49.518407

"""
from typing import Sequence, Union

from alembic import op

from app.shared.base_model import Base
import app.modules.companies.models      # noqa: F401
import app.modules.auth.models           # noqa: F401
import app.modules.rbac.models           # noqa: F401
import app.modules.inventory.models      # noqa: F401
import app.modules.crm.models            # noqa: F401
import app.modules.pos.models            # noqa: F401
import app.modules.payments.models       # noqa: F401
import app.modules.kitchen.models        # noqa: F401
import app.modules.loyalty.models        # noqa: F401
import app.modules.delivery.models       # noqa: F401
import app.modules.hr.models             # noqa: F401
import app.modules.notifications.models  # noqa: F401
import app.modules.audit.models          # noqa: F401
import app.modules.fiscal.models         # noqa: F401
import app.modules.subscriptions.models  # noqa: F401
import app.modules.printers.models       # noqa: F401


revision: str = "3dd82166af1e"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)

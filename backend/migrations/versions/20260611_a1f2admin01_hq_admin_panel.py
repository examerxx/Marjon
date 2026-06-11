"""hq_admin_panel — модули главной админки

Revision ID: a1f2admin01
Revises: 3dd82166af1e
Create Date: 2026-06-11

Создаёт таблицы главной админ-панели (гео-справочники, организации,
маркетинг/лиды, номенклатура, склад, финансы, сервис/задачи, настройки)
и добавляет username/name к users (логин аккаунтов админки).

Таблицы создаются из metadata моделей — единый источник истины со схемой
приложения (как и initial_schema, созданная из моделей).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1f2admin01"
down_revision: Union[str, None] = "3dd82166af1e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TABLES = [
    # handbook
    "hb_countries", "hb_regions", "hb_districts",
    # organizations
    "organization_statuses", "organizations", "user_organizations", "offline_jobs",
    # departments
    "adm_departments",
    # marketing
    "lead_statuses", "lead_tags", "lead_cancellation_reasons",
    "lead_sources", "activity_types", "leads", "lead_tag_links",
    # nomenclature
    "nm_categories", "nm_units", "nm_products", "nm_orders",
    # storage
    "adm_storages", "adm_providers", "adm_comings", "adm_coming_items",
    "adm_storage_movements",
    # finance
    "fin_counterparties", "fin_payment_types", "fin_transaction_categories",
    "fin_transactions", "fin_templates", "fin_history",
    # field service
    "srv_employees", "srv_services", "srv_tech_help",
    # tasks
    "adm_tasks", "adm_task_approvals",
    # settings
    "adm_languages", "adm_translations", "adm_image_backgrounds",
    "adm_store_versions", "adm_user_logs",
]


def _metadata() -> sa.MetaData:
    from app.shared.base_model import Base
    import app.modules.handbook.models        # noqa: F401
    import app.modules.organizations.models   # noqa: F401
    import app.modules.departments.models     # noqa: F401
    import app.modules.marketing.models       # noqa: F401
    import app.modules.nomenclature.models    # noqa: F401
    import app.modules.storage.models         # noqa: F401
    import app.modules.finance.models         # noqa: F401
    import app.modules.field_service.models   # noqa: F401
    import app.modules.tasks.models           # noqa: F401
    import app.modules.admin_settings.models  # noqa: F401
    return Base.metadata


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(150), nullable=True))
    op.add_column("users", sa.Column("name", sa.String(255), nullable=True))
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    metadata = _metadata()
    bind = op.get_bind()
    metadata.create_all(
        bind,
        tables=[metadata.tables[name] for name in NEW_TABLES],
        checkfirst=True,
    )


def downgrade() -> None:
    metadata = _metadata()
    bind = op.get_bind()
    metadata.drop_all(
        bind,
        tables=[metadata.tables[name] for name in NEW_TABLES],
        checkfirst=True,
    )

    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "name")
    op.drop_column("users", "username")

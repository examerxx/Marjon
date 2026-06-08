from __future__ import annotations
import asyncio
from logging.config import fileConfig
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from alembic import context

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

from app.config import settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

config.set_main_option(
    "sqlalchemy.url",
    settings.database_url.replace("%", "%%"),
)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    from sqlalchemy.ext.asyncio import create_async_engine
    # Use Session Pooler (port 5432) if available — it supports prepared statements.
    # Transaction Pooler (port 6543) does NOT support them.
    migration_url = settings.migration_database_url or settings.database_url
    connect_args = {"ssl": "require"} if migration_url.startswith("postgresql") else {}
    connectable = create_async_engine(
        migration_url,
        poolclass=pool.NullPool,
        connect_args=connect_args,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

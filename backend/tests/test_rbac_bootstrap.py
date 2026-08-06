from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.rbac.models import Permission
from app.modules.rbac.permissions import DEFAULT_PERMISSIONS, seed_permissions


async def test_seed_permissions_is_idempotent(client, db_engine):
    """BE-25: re-running the seed must not create duplicate Permission
    rows — conftest's `client` fixture already seeded once during setup;
    calling it again here must report zero new rows and leave the total
    count unchanged."""
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        before = (await session.execute(select(func.count()).select_from(Permission))).scalar_one()
        assert before == len(DEFAULT_PERMISSIONS)

        second_run_created = await seed_permissions(session)
        assert second_run_created == 0

        after = (await session.execute(select(func.count()).select_from(Permission))).scalar_one()
        assert after == before


async def test_seed_permissions_no_duplicate_module_action_scope(client, db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        rows = (
            await session.execute(select(Permission.module, Permission.action, Permission.scope))
        ).all()
        assert len(rows) == len(set(rows))  # no duplicate (module, action, scope) tuples

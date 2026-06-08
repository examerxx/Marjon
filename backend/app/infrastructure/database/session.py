from __future__ import annotations
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.config import settings
from app.shared.base_model import Base


def _make_engine():
    url = settings.database_url
    is_postgres = url.startswith("postgresql")

    connect_args: dict = {}
    engine_kwargs: dict = {"echo": settings.debug}

    if is_postgres:
        connect_args = {
            "prepared_statement_cache_size": 0,
        }
        # Enable SSL only for Supabase / remote PostgreSQL (not for local Docker)
        if not settings.debug:
            connect_args["ssl"] = "require"

        engine_kwargs.update({
            "pool_size": 5,
            "max_overflow": 10,
            "pool_pre_ping": True,
        })
    else:
        # SQLite (dev fallback)
        connect_args = {"check_same_thread": False}

    return create_async_engine(url, connect_args=connect_args, **engine_kwargs)


engine = _make_engine()
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def create_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

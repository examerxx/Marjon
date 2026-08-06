from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("DEBUG", "true")

import pytest_asyncio
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Importing app.main registers every module's models on Base.metadata.
from app.main import app
from app.infrastructure.database.session import get_db
from app.modules.rbac.permissions import seed_permissions
from app.shared.base_model import Base


@pytest_asyncio.fixture(autouse=True)
def _reset_rate_limiter():
    """app.state.limiter is a module-level singleton shared across the whole
    pytest session (the app is imported once at collection time), so its
    in-memory hit counters carry over between tests. Without this, any test
    file with more than the per-endpoint limit's worth of total calls (e.g.
    5/minute on /auth/register, used by several tests to set up fixtures)
    starts failing with 429s partway through the suite — not a real bug,
    just uninitialized test isolation for the rate limiter's own state."""
    app.state.limiter.reset()
    yield


@pytest_asyncio.fixture
async def db_engine():
    """A fresh in-memory SQLite database per test, with the full schema created."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )

    # pos/service.py uses SELECT pg_advisory_xact_lock(:k) to serialize
    # order-number generation under real (Postgres) concurrency — SQLite
    # has no such function and doesn't need one (tests run single-
    # connection), so register a no-op stand-in rather than let every
    # test that creates a POS order fail with "no such function".
    @event.listens_for(engine.sync_engine, "connect")
    def _stub_pg_advisory_xact_lock(dbapi_connection, _record):
        dbapi_connection.create_function("pg_advisory_xact_lock", 1, lambda _key: None)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # BE-05: production seeds the Permission catalog at app startup (see
    # main.py's lifespan), but that runs against AsyncSessionLocal's own
    # engine, not this per-test one — so tests need their own seed or every
    # role's permission sync (owner/cashier/etc.) would attach zero rows.
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        await seed_permissions(session)

    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_engine):
    """HTTP client wired to the app with get_db overridden to the test engine."""
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def override_get_db() -> AsyncSession:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test/api/v1") as ac:
            yield ac
    app.dependency_overrides.clear()


async def register_company(client, *, slug: str, email: str, password: str = "Passw0rd!"):
    """Register a company + owner, returning (auth_headers, token_payload)."""
    resp = await client.post(
        "/auth/register",
        json={
            "company_name": slug.title(),
            "company_slug": slug,
            "email": email,
            "password": password,
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    return headers, data

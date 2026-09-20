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
from app.modules.pos.models import Order
from app.modules.rbac.permissions import seed_permissions
from app.shared.base_model import Base

# ORDERS-TRUTH-01: orders.public_id is NOT NULL in the model AND the production
# DB (per-company identity, assigned by OrderService.create — the only
# production creator). Many test files insert Order rows DIRECTLY (bypassing the
# service) to set up report/z-report fixtures; those inserts legitimately omit
# public_id. Rather than thread an explicit id through ~42 call sites, this one
# shared before_insert hook stamps a deterministic, high-range public_id ONLY
# when a test leaves it unset. It never fires for service-created orders (they
# always assign public_id first), and the high 90000000+ range with a per-row
# counter cannot collide with the service's 10000000-based per-company values
# within any test. Test-only: registered here in conftest, never in app code.
_TEST_PUBLIC_ID = [90_000_000]


@event.listens_for(Order, "before_insert")
def _assign_test_public_id(_mapper, _connection, target):  # pragma: no cover - test harness
    if getattr(target, "public_id", None) is None:
        target.public_id = _TEST_PUBLIC_ID[0]
        _TEST_PUBLIC_ID[0] += 1


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


async def create_staff_headers(
    client,
    owner_headers,
    *,
    email: str,
    role_slug: str,
    password: str = "Passw0rd!",
):
    """Create an existing operational-role account and return its app session."""
    created = await client.post(
        "/auth/users",
        headers=owner_headers,
        json={"email": email, "password": password, "role_slug": role_slug},
    )
    assert created.status_code == 201, created.text
    login = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}

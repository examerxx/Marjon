from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("DEBUG", "true")

import pytest_asyncio
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Importing app.main registers every module's models on Base.metadata.
from app.main import app
from app.infrastructure.database.session import get_db
from app.shared.base_model import Base


@pytest_asyncio.fixture
async def db_engine():
    """A fresh in-memory SQLite database per test, with the full schema created."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
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

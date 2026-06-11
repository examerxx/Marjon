# Backend tests

Async API tests running the real FastAPI app against an isolated in-memory
SQLite database (one fresh schema per test, no Alembic, no external services).

## Install & run

```bash
pip install -r requirements-dev.txt
pytest
```

## Layout

- `conftest.py` — fixtures: per-test in-memory DB engine, an `httpx` client with
  `get_db` overridden to that engine, and a `register_company` helper.
- `test_auth.py` — registration, login, `/auth/me`, and refresh-token rotation +
  revocation.
- `test_tenant_isolation.py` — proves a company cannot list, read, or update
  another company's data (the core multi-tenant safety guarantee).

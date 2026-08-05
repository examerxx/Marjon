from __future__ import annotations

from tests.conftest import register_company

# BE-02 follow-up: a systematic re-check of "special check" list from the
# spec turned up five more HQ admin-panel modules whose CRUD came from
# crud_router() (correctly defaulting to require_hq_admin) but whose
# hand-written extra endpoints were left on get_current_user — any
# authenticated company owner/cashier/waiter could read/write the
# platform's own HQ data (sales leads, HQ product archive state, HQ
# storage receipts, field-service technician data, HQ audit/user logs).
# Several of those endpoints (get/update/delete-by-id) had no org scoping
# at all, so it wasn't just an information leak — it was read/write.

HQ_ONLY_GET_ENDPOINTS = [
    "/leads",
    "/products/archive",
    "/comings",
    "/reports/storage-balances",
    "/employees/on-map",
    "/translations/export",
    "/user-logs",
]


async def test_hq_gap_endpoints_reject_regular_company_session(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    for path in HQ_ONLY_GET_ENDPOINTS:
        resp = await client.get(path, headers=owner_headers)
        assert resp.status_code == 403, f"{path} -> {resp.status_code} (expected 403)"


async def test_hq_gap_endpoints_reject_unauthenticated(client):
    for path in HQ_ONLY_GET_ENDPOINTS:
        resp = await client.get(path)
        assert resp.status_code == 401, f"{path} -> {resp.status_code} (expected 401)"

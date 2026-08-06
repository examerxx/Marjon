from __future__ import annotations

from tests.conftest import register_company


async def _setup_order_and_printers(client, headers, *, with_printers=True):
    branch = await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})
    branch_id = branch.json()["id"]

    order = await client.post(
        "/pos/orders", headers=headers,
        json={"branch_id": branch_id, "order_type": "dine_in", "table_number": "5"},
    )
    order_id = order.json()["id"]

    receipt_printer = kitchen_printer = None
    if with_printers:
        rp = await client.post(
            "/printers", headers=headers,
            json={
                "branch_id": branch_id, "name": "Receipt", "printer_type": "receipt",
                "connection_type": "network", "ip_address": "192.0.2.1", "port": 9100,
            },
        )
        kp = await client.post(
            "/printers", headers=headers,
            json={
                "branch_id": branch_id, "name": "Kitchen", "printer_type": "kitchen",
                "connection_type": "network", "ip_address": "192.0.2.2", "port": 9100,
            },
        )
        receipt_printer, kitchen_printer = rp.json(), kp.json()

    return order_id, branch_id, receipt_printer, kitchen_printer


async def test_compat_route_matches_frontend_call_shape(client):
    """frontend/src/api/receipt.js has always called POST
    /printers/print/orders/{order_id}/receipt|kitchen with an empty body —
    this must work end-to-end without any printer_id."""
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    order_id, _, receipt_printer, kitchen_printer = await _setup_order_and_printers(client, headers)

    receipt_resp = await client.post(f"/printers/print/orders/{order_id}/receipt", headers=headers)
    assert receipt_resp.status_code == 200
    jobs = receipt_resp.json()
    assert len(jobs) == 1
    assert jobs[0]["printer_id"] == receipt_printer["id"]
    assert jobs[0]["job_type"] == "receipt"

    kitchen_resp = await client.post(f"/printers/print/orders/{order_id}/kitchen", headers=headers)
    assert kitchen_resp.status_code == 200
    kjobs = kitchen_resp.json()
    assert kjobs[0]["printer_id"] == kitchen_printer["id"]
    assert kjobs[0]["job_type"] == "kitchen"


async def test_compat_route_clear_error_when_no_printer_configured(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    order_id, _, _, _ = await _setup_order_and_printers(client, headers, with_printers=False)

    resp = await client.post(f"/printers/print/orders/{order_id}/receipt", headers=headers)
    assert resp.status_code == 404


async def test_compat_route_unknown_order_404s(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    resp = await client.post(
        "/printers/print/orders/00000000-0000-0000-0000-000000000000/receipt", headers=headers
    )
    assert resp.status_code == 404


async def test_canonical_contract_still_works(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    order_id, _, receipt_printer, _ = await _setup_order_and_printers(client, headers)

    resp = await client.post(
        "/printers/print/receipt", headers=headers,
        json={"order_id": order_id, "printer_id": receipt_printer["id"], "copies": 1},
    )
    assert resp.status_code == 200
    assert resp.json()["printer_id"] == receipt_printer["id"]


async def test_canonical_contract_rejects_cross_company_printer(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")
    order_id, _, receipt_printer, _ = await _setup_order_and_printers(client, a_headers)

    resp = await client.post(
        "/printers/print/receipt", headers=b_headers,
        json={"order_id": order_id, "printer_id": receipt_printer["id"], "copies": 1},
    )
    assert resp.status_code == 404


async def test_canonical_contract_rejects_cross_company_order(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")
    order_id, _, _, _ = await _setup_order_and_printers(client, a_headers)
    _, _, b_receipt_printer, _ = await _setup_order_and_printers(client, b_headers)

    resp = await client.post(
        "/printers/print/receipt", headers=b_headers,
        json={"order_id": order_id, "printer_id": b_receipt_printer["id"], "copies": 1},
    )
    assert resp.status_code == 404


async def test_print_requires_auth(client):
    resp = await client.post("/printers/print/orders/00000000-0000-0000-0000-000000000000/receipt")
    assert resp.status_code == 401

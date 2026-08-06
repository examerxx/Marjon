from __future__ import annotations

from tests.conftest import register_company


async def test_accepting_purchase_increases_stock(client):
    """Regression: accepting a purchase document previously only stamped
    accepted_at, with zero effect on StockItem."""
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    wh = await client.post("/warehouse/list", headers=headers, json={"name": "Main"})
    ing = await client.post("/inventory/ingredients", headers=headers, json={"name": "Flour", "unit": "кг"})
    ing = ing.json()

    doc = await client.post(
        "/warehouse/purchases", headers=headers,
        json={
            "supplier": "FlourCo", "warehouse_id": wh.json()["id"],
            "items": [{"name": "Flour", "ingredient_id": ing["id"], "quantity": 50, "unit": "кг", "cost_price": 4000}],
        },
    )
    assert doc.status_code == 201
    doc_id = doc.json()["id"]
    assert doc.json()["status"] == "draft"

    before = await client.get("/inventory/stock", headers=headers)
    assert not any(s["ingredient_id"] == ing["id"] for s in before.json())

    accepted = await client.patch(f"/warehouse/purchases/{doc_id}", headers=headers, json={"status": "accepted"})
    assert accepted.status_code == 200
    assert accepted.json()["accepted_at"] is not None

    after = await client.get("/inventory/stock", headers=headers)
    row = next(s for s in after.json() if s["ingredient_id"] == ing["id"])
    assert float(row["quantity"]) == 50.0


async def test_accepting_purchase_twice_is_idempotent(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    wh = await client.post("/warehouse/list", headers=headers, json={"name": "Main"})
    ing = await client.post("/inventory/ingredients", headers=headers, json={"name": "Sugar", "unit": "кг"})
    ing = ing.json()

    doc = await client.post(
        "/warehouse/purchases", headers=headers,
        json={
            "warehouse_id": wh.json()["id"],
            "items": [{"name": "Sugar", "ingredient_id": ing["id"], "quantity": 10, "unit": "кг", "cost_price": 8000}],
        },
    )
    doc_id = doc.json()["id"]

    await client.patch(f"/warehouse/purchases/{doc_id}", headers=headers, json={"status": "accepted"})
    await client.patch(f"/warehouse/purchases/{doc_id}", headers=headers, json={"status": "accepted"})

    stock = await client.get("/inventory/stock", headers=headers)
    row = next(s for s in stock.json() if s["ingredient_id"] == ing["id"])
    assert float(row["quantity"]) == 10.0  # not 20 — the second accept was a no-op


async def test_draft_purchase_does_not_affect_stock(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    wh = await client.post("/warehouse/list", headers=headers, json={"name": "Main"})
    ing = await client.post("/inventory/ingredients", headers=headers, json={"name": "Salt", "unit": "кг"})
    ing = ing.json()

    await client.post(
        "/warehouse/purchases", headers=headers,
        json={
            "warehouse_id": wh.json()["id"],
            "items": [{"name": "Salt", "ingredient_id": ing["id"], "quantity": 5, "unit": "кг", "cost_price": 3000}],
        },
    )

    stock = await client.get("/inventory/stock", headers=headers)
    assert not any(s["ingredient_id"] == ing["id"] for s in stock.json())


async def test_purchase_total_is_server_computed(client):
    """The frontend sends a redundant `total` field; the server computes
    its own authoritative total_amount from items and ignores it."""
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    wh = await client.post("/warehouse/list", headers=headers, json={"name": "Main"})

    resp = await client.post(
        "/warehouse/purchases", headers=headers,
        json={
            "warehouse_id": wh.json()["id"], "total": 999999,
            "items": [{"name": "Item", "quantity": 2, "unit": "кг", "cost_price": 1000}],
        },
    )
    assert resp.status_code == 201
    assert float(resp.json()["total_amount"]) == 2000.0

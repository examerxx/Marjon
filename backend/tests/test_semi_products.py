from __future__ import annotations

from tests.conftest import register_company


async def _setup_stocked_ingredient(client, headers, *, name, qty, cost):
    wh = await client.post("/warehouse/list", headers=headers, json={"name": "Main"})
    ing = await client.post("/inventory/ingredients", headers=headers, json={"name": name, "unit": "кг"})
    ing = ing.json()
    await client.post(
        "/inventory/stock/movements", headers=headers,
        json={
            "warehouse_id": wh.json()["id"], "ingredient_id": ing["id"],
            "movement_type": "purchase", "quantity": qty, "unit": "кг", "cost_price": cost,
        },
    )
    return wh.json()["id"], ing


async def test_semi_product_create_computes_cost_from_composition(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    wh_id, tomato = await _setup_stocked_ingredient(client, headers, name="Tomato", qty=10, cost=5000)
    _, onion = await _setup_stocked_ingredient(client, headers, name="Onion", qty=5, cost=3000)

    resp = await client.post(
        "/inventory/semi-products", headers=headers,
        json={
            "name": "Sauce", "unit": "кг",
            "ingredients": [
                {"ingredient_id": tomato["id"], "quantity": 2},
                {"ingredient_id": onion["id"], "quantity": 1},
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["ingredients_count"] == 2
    assert float(body["cost_price"]) == 2 * 5000 + 1 * 3000


async def test_semi_product_stock_creates_stockitem_on_first_purchase(client):
    """Regression: create_movement() used to only UPDATE an existing
    StockItem row, never create one — a brand-new ingredient's first
    purchase was logged as a movement but never actually added stock."""
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    wh = await client.post("/warehouse/list", headers=headers, json={"name": "Main"})
    ing = await client.post("/inventory/ingredients", headers=headers, json={"name": "Salt", "unit": "кг"})
    ing = ing.json()

    await client.post(
        "/inventory/stock/movements", headers=headers,
        json={
            "warehouse_id": wh.json()["id"], "ingredient_id": ing["id"],
            "movement_type": "purchase", "quantity": 5, "unit": "кг", "cost_price": 1000,
        },
    )
    stock = await client.get("/inventory/stock", headers=headers)
    row = next(s for s in stock.json() if s["ingredient_id"] == ing["id"])
    assert float(row["quantity"]) == 5


async def test_semi_product_update_replaces_composition(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    _, tomato = await _setup_stocked_ingredient(client, headers, name="Tomato", qty=10, cost=5000)

    created = await client.post(
        "/inventory/semi-products", headers=headers,
        json={"name": "Sauce", "ingredients": [{"ingredient_id": tomato["id"], "quantity": 2}]},
    )
    sp_id = created.json()["id"]

    updated = await client.patch(
        f"/inventory/semi-products/{sp_id}", headers=headers,
        json={"ingredients": [{"ingredient_id": tomato["id"], "quantity": 3}]},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["ingredients_count"] == 1
    assert float(body["cost_price"]) == 3 * 5000

    # Re-fetch independently to make sure the stored state (not just the
    # response of the PATCH itself) reflects the replacement.
    refetched = await client.get(f"/inventory/semi-products/{sp_id}", headers=headers)
    assert refetched.json()["ingredients_count"] == 1
    assert float(refetched.json()["cost_price"]) == 3 * 5000


async def test_semi_product_produce_deducts_stock(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    wh_id, tomato = await _setup_stocked_ingredient(client, headers, name="Tomato", qty=10, cost=5000)

    created = await client.post(
        "/inventory/semi-products", headers=headers,
        json={"name": "Sauce", "ingredients": [{"ingredient_id": tomato["id"], "quantity": 3}]},
    )
    sp_id = created.json()["id"]

    produce = await client.post(
        f"/inventory/semi-products/{sp_id}/produce", headers=headers,
        json={"warehouse_id": wh_id, "quantity": 2},
    )
    assert produce.status_code == 200

    stock = await client.get("/inventory/stock", headers=headers)
    row = next(s for s in stock.json() if s["ingredient_id"] == tomato["id"])
    assert float(row["quantity"]) == 10 - 6


async def test_semi_product_produce_rejects_insufficient_stock(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    wh_id, tomato = await _setup_stocked_ingredient(client, headers, name="Tomato", qty=5, cost=5000)

    created = await client.post(
        "/inventory/semi-products", headers=headers,
        json={"name": "Sauce", "ingredients": [{"ingredient_id": tomato["id"], "quantity": 3}]},
    )
    sp_id = created.json()["id"]

    resp = await client.post(
        f"/inventory/semi-products/{sp_id}/produce", headers=headers,
        json={"warehouse_id": wh_id, "quantity": 100},
    )
    assert resp.status_code == 422

    # Stock must be unchanged after a rejected production.
    stock = await client.get("/inventory/stock", headers=headers)
    row = next(s for s in stock.json() if s["ingredient_id"] == tomato["id"])
    assert float(row["quantity"]) == 5


async def test_semi_product_scoped_per_company(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")

    created = await client.post("/inventory/semi-products", headers=a_headers, json={"name": "Sauce A"})
    sp_id = created.json()["id"]

    resp = await client.get(f"/inventory/semi-products/{sp_id}", headers=b_headers)
    assert resp.status_code == 404


async def test_semi_product_write_requires_company_admin(client):
    owner_headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    await client.post(
        "/auth/users", headers=owner_headers,
        json={"email": "cashier@acme.example.com", "password": "Passw0rd!", "role_slug": "cashier"},
    )
    login = await client.post(
        "/auth/login", json={"email": "cashier@acme.example.com", "password": "Passw0rd!"}
    )
    cashier_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    denied = await client.post("/inventory/semi-products", headers=cashier_headers, json={"name": "x"})
    assert denied.status_code == 403

    allowed = await client.get("/inventory/semi-products", headers=cashier_headers)
    assert allowed.status_code == 200


async def test_semi_product_delete_is_soft(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    created = await client.post("/inventory/semi-products", headers=headers, json={"name": "Sauce"})
    sp_id = created.json()["id"]

    resp = await client.delete(f"/inventory/semi-products/{sp_id}", headers=headers)
    assert resp.status_code == 204

    still_there = await client.get(f"/inventory/semi-products/{sp_id}", headers=headers)
    assert still_there.status_code == 200
    assert still_there.json()["is_active"] is False


async def test_semi_products_require_auth(client):
    resp = await client.get("/inventory/semi-products")
    assert resp.status_code == 401

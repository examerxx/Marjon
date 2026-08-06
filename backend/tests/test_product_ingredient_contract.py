from __future__ import annotations

from tests.conftest import register_company


async def _setup_beef(client, headers):
    wh = await client.post("/warehouse/list", headers=headers, json={"name": "Main"})
    ing = await client.post(
        "/inventory/ingredients", headers=headers,
        json={"name": "Beef", "unit": "кг", "supplier_name": "MeatCo"},
    )
    ing = ing.json()
    await client.post(
        "/inventory/stock/movements", headers=headers,
        json={
            "warehouse_id": wh.json()["id"], "ingredient_id": ing["id"],
            "movement_type": "purchase", "quantity": 20, "unit": "кг", "cost_price": 60000,
        },
    )
    return ing


async def test_ingredient_aggregates_are_real(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    beef = await _setup_beef(client, headers)

    listing = await client.get("/inventory/ingredients", headers=headers)
    found = next(i for i in listing.json() if i["id"] == beef["id"])
    assert float(found["stock"]) == 20.0
    assert float(found["purchase_price"]) == 60000.0
    assert found["supplier_name"] == "MeatCo"


async def test_ingredient_update(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    beef = await _setup_beef(client, headers)

    resp = await client.patch(
        f"/inventory/ingredients/{beef['id']}", headers=headers, json={"supplier_name": "NewCo"}
    )
    assert resp.status_code == 200
    assert resp.json()["supplier_name"] == "NewCo"


async def test_product_composition_computes_stock_and_names(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    beef = await _setup_beef(client, headers)
    cat = await client.post("/inventory/categories", headers=headers, json={"name": "Mains", "slug": "mains"})
    cat = cat.json()
    subcat = await client.post(
        "/inventory/categories", headers=headers, json={"name": "Meat", "slug": "meat", "parent_id": cat["id"]}
    )
    subcat = subcat.json()
    await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})
    printer = await client.post("/printers", headers=headers, json={"name": "Kitchen", "printer_type": "kitchen"})
    printer = printer.json()

    created = await client.post(
        "/inventory/products", headers=headers,
        json={
            "name": "Steak", "price": 150000, "category_id": cat["id"], "subcategory_id": subcat["id"],
            "printer_id": printer["id"],
            "ingredients": [{"ingredient_id": beef["id"], "quantity": 0.4}],
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["category_name"] == "Mains"
    assert body["subcategory_name"] == "Meat"
    assert body["printer_name"] == "Kitchen"
    assert body["ingredients_count"] == 1
    assert body["stock"] == 50  # 20kg / 0.4kg per serving


async def test_product_without_composition_has_null_stock_not_zero(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    created = await client.post(
        "/inventory/products", headers=headers, json={"name": "Water", "price": 5000, "product_type": "sale"}
    )
    assert created.status_code == 201
    body = created.json()
    assert body["ingredients_count"] == 0
    assert body["stock"] is None


async def test_product_composition_update_recomputes_stock(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    beef = await _setup_beef(client, headers)
    created = await client.post(
        "/inventory/products", headers=headers,
        json={"name": "Steak", "price": 100000, "ingredients": [{"ingredient_id": beef["id"], "quantity": 0.4}]},
    )
    product_id = created.json()["id"]
    assert created.json()["stock"] == 50

    updated = await client.patch(
        f"/inventory/products/{product_id}", headers=headers,
        json={"ingredients": [{"ingredient_id": beef["id"], "quantity": 1.0}]},
    )
    assert updated.status_code == 200
    assert updated.json()["stock"] == 20


async def test_product_list_includes_aggregates(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    beef = await _setup_beef(client, headers)
    created = await client.post(
        "/inventory/products", headers=headers,
        json={"name": "Steak", "price": 100000, "ingredients": [{"ingredient_id": beef["id"], "quantity": 0.4}]},
    )
    product_id = created.json()["id"]

    listing = await client.get("/inventory/products", headers=headers, params={"include_all": True})
    found = next(p for p in listing.json() if p["id"] == product_id)
    assert found["stock"] == 50
    assert found["ingredients_count"] == 1


async def test_product_get_returns_ingredient_details(client):
    headers, _ = await register_company(client, slug="acme", email="owner@acme.example.com")
    beef = await _setup_beef(client, headers)
    created = await client.post(
        "/inventory/products", headers=headers,
        json={"name": "Steak", "price": 100000, "ingredients": [{"ingredient_id": beef["id"], "quantity": 0.4}]},
    )
    product_id = created.json()["id"]

    got = await client.get(f"/inventory/products/{product_id}", headers=headers)
    assert got.status_code == 200
    line = got.json()["ingredients"][0]
    assert line["ingredient_name"] == "Beef"
    assert line["unit"] == "кг"


async def test_product_scoped_per_company(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")

    created = await client.post("/inventory/products", headers=a_headers, json={"name": "Dish", "price": 1000})
    product_id = created.json()["id"]

    resp = await client.get(f"/inventory/products/{product_id}", headers=b_headers)
    assert resp.status_code == 404

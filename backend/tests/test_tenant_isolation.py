from __future__ import annotations

from tests.conftest import register_company


async def _create_product(client, headers, name="Plov", price="50000"):
    resp = await client.post(
        "/inventory/products",
        headers=headers,
        json={"name": name, "price": price},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_products_are_scoped_per_company(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")

    await _create_product(client, a_headers, name="Alpha Plov")
    await _create_product(client, b_headers, name="Beta Lagman")

    a_list = await client.get("/inventory/products", headers=a_headers)
    b_list = await client.get("/inventory/products", headers=b_headers)
    a_names = {p["name"] for p in a_list.json()}
    b_names = {p["name"] for p in b_list.json()}

    assert a_names == {"Alpha Plov"}
    assert b_names == {"Beta Lagman"}


async def test_cannot_read_other_companys_product_by_id(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")

    product = await _create_product(client, a_headers, name="Secret Dish")
    pid = product["id"]

    # Company B must not be able to fetch company A's product.
    resp = await client.get(f"/inventory/products/{pid}", headers=b_headers)
    assert resp.status_code == 404


async def test_cannot_update_other_companys_product(client):
    a_headers, _ = await register_company(client, slug="alpha", email="owner@alpha.example.com")
    b_headers, _ = await register_company(client, slug="beta", email="owner@beta.example.com")

    product = await _create_product(client, a_headers, name="Priced Dish", price="10000")
    pid = product["id"]

    resp = await client.patch(
        f"/inventory/products/{pid}",
        headers=b_headers,
        json={"price": "1"},
    )
    assert resp.status_code == 404

    # Confirm company A's product is unchanged.
    check = await client.get(f"/inventory/products/{pid}", headers=a_headers)
    assert check.json()["price"] == "10000.00"

from __future__ import annotations

from uuid import uuid4

from tests.conftest import register_company


async def _create_category(client, headers, name="Супы", slug=None):
    body = {"name": name, "slug": slug or f"cat-{uuid4().hex[:8]}"}
    resp = await client.post("/inventory/categories", headers=headers, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_category_update_name_and_status_persist(client):
    headers, _ = await register_company(client, slug="catupd-a", email="owner@catupd-a.example.com")
    created = await _create_category(client, headers)
    cid = created["id"]
    assert created["is_active"] is True

    resp = await client.patch(
        f"/inventory/categories/{cid}", headers=headers, json={"name": "Супы и бульоны"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Супы и бульоны"
    # Untouched canonical fields survive a partial update.
    assert resp.json()["slug"] == created["slug"]
    assert resp.json()["sort_order"] == created["sort_order"]

    resp = await client.patch(
        f"/inventory/categories/{cid}", headers=headers, json={"is_active": False}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is False

    listed = await client.get("/inventory/categories", headers=headers)
    assert listed.status_code == 200
    assert listed.json() == []


async def test_category_update_cross_company_is_not_found(client):
    headers_a, _ = await register_company(client, slug="catupd-b", email="owner@catupd-b.example.com")
    headers_b, _ = await register_company(client, slug="catupd-c", email="owner@catupd-c.example.com")
    created = await _create_category(client, headers_a)

    resp = await client.patch(
        f"/inventory/categories/{created['id']}", headers=headers_b, json={"name": "Чужое"}
    )
    assert resp.status_code == 404, resp.text

    # Owner's own row is untouched.
    listed = await client.get("/inventory/categories", headers=headers_a)
    assert created["id"] in [c["id"] for c in listed.json()]


async def test_category_update_missing_and_unauthenticated(client):
    headers, _ = await register_company(client, slug="catupd-d", email="owner@catupd-d.example.com")

    resp = await client.patch(
        f"/inventory/categories/{uuid4()}", headers=headers, json={"name": "Нет такой"}
    )
    assert resp.status_code == 404, resp.text

    created = await _create_category(client, headers)
    resp = await client.patch(f"/inventory/categories/{created['id']}", json={"name": "Аноним"})
    assert resp.status_code in (401, 403), resp.text


async def test_category_create_with_flags_returns_them(client):
    headers, _ = await register_company(client, slug="catflag-a", email="owner@catflag-a.example.com")
    resp = await client.post(
        "/inventory/categories",
        headers=headers,
        json={"name": "Супы", "slug": "supy", "calculate_service": True, "show_in_menu": True},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["calculate_service"] is True
    assert body["show_in_menu"] is True

    plain = await _create_category(client, headers, name="Салаты", slug="salads")
    assert plain["calculate_service"] is False
    assert plain["show_in_menu"] is False


async def test_category_patch_flags_independently_and_get_survives(client):
    headers, _ = await register_company(client, slug="catflag-b", email="owner@catflag-b.example.com")
    created = await _create_category(client, headers)

    resp = await client.patch(
        f"/inventory/categories/{created['id']}", headers=headers, json={"calculate_service": True}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["calculate_service"] is True
    assert resp.json()["show_in_menu"] is False

    resp = await client.patch(
        f"/inventory/categories/{created['id']}", headers=headers, json={"show_in_menu": True}
    )
    assert resp.json()["calculate_service"] is True
    assert resp.json()["show_in_menu"] is True

    listed = await client.get("/inventory/categories", headers=headers)
    row = next(c for c in listed.json() if c["id"] == created["id"])
    assert row["calculate_service"] is True
    assert row["show_in_menu"] is True


async def test_category_delete_unreferenced_and_missing_and_cross_tenant(client):
    headers_a, _ = await register_company(client, slug="catdel-a", email="owner@catdel-a.example.com")
    headers_b, _ = await register_company(client, slug="catdel-b", email="owner@catdel-b.example.com")
    created = await _create_category(client, headers_a)

    resp = await client.delete(f"/inventory/categories/{created['id']}", headers=headers_b)
    assert resp.status_code == 404, resp.text

    resp = await client.delete(f"/inventory/categories/{uuid4()}", headers=headers_a)
    assert resp.status_code == 404, resp.text

    resp = await client.delete(f"/inventory/categories/{created['id']}", headers=headers_a)
    assert resp.status_code == 204, resp.text

    listed = await client.get("/inventory/categories", headers=headers_a)
    assert created["id"] not in [c["id"] for c in listed.json()]


async def test_category_delete_referenced_returns_conflict(client):
    headers, _ = await register_company(client, slug="catdel-c", email="owner@catdel-c.example.com")
    created = await _create_category(client, headers)
    product = await client.post(
        "/inventory/products",
        headers=headers,
        json={"name": "Плов", "price": 40000, "category_id": created["id"]},
    )
    assert product.status_code == 201, product.text

    resp = await client.delete(f"/inventory/categories/{created['id']}", headers=headers)
    assert resp.status_code == 409, resp.text

    listed = await client.get("/inventory/categories", headers=headers)
    assert created["id"] in [c["id"] for c in listed.json()]

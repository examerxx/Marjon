"""Кухня: «сделал / не сделал» по блюду и автоготовность заказа.

Фиксируем контракт, на котором держится новый KDS:

* блюдо можно вернуть в работу (ready → cooking) — «не сделал»;
* когда готовы все неотменённые блюда, заказ сам становится ready;
* вернули блюдо — заказ снова cooking;
* «весь заказ готов» одной кнопкой закрывает и блюда, и заказ;
* готовые заказы остаются на доске (колонка «К отдаче»);
* дозаказ с кассы/мобилки возвращает готовый заказ в работу;
* публичный ТВ-экран отдаёт только номер и «готов / в очереди».
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.pos.models import Order, OrderItem
from tests.conftest import register_company

BRANCH_LOGIN = "+998 90 555-77-88"
BRANCH_PASSWORD = "Kitchen-Ready-1"


async def _kitchen_context(client, *, slug: str):
    owner_headers, _ = await register_company(
        client, slug=slug, email=f"owner@{slug}.example.com"
    )
    branch = (
        await client.post(
            "/companies/me/branches",
            headers=owner_headers,
            json={"name": "Main", "login": BRANCH_LOGIN, "password": BRANCH_PASSWORD},
        )
    ).json()

    cook = (
        await client.post(
            "/auth/users",
            headers=owner_headers,
            json={
                "email": f"cook@{slug}.example.com",
                "password": "Passw0rd!",
                "phone": "+998901113344",
                "role_slug": "kitchen",
                "branch_id": branch["id"],
            },
        )
    ).json()
    assert (
        await client.patch(
            f"/auth/users/{cook['id']}/pin", headers=owner_headers, json={"pin": "1234"}
        )
    ).status_code == 204

    product = await client.post(
        "/inventory/products",
        headers=owner_headers,
        json={"name": "Плов", "price": "42000"},
    )
    assert product.status_code == 201, product.text
    return owner_headers, branch, product.json()["id"]


async def _cook_headers(client) -> dict:
    device = await client.post(
        "/auth/kitchen/session", json={"login": BRANCH_LOGIN, "password": BRANCH_PASSWORD}
    )
    assert device.status_code == 200, device.text
    login = await client.post(
        "/auth/kitchen/pin",
        headers={"Authorization": f"Bearer {device.json()['access_token']}"},
        json={"pin": "1234"},
    )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


EXPO_PHONE = "+998901112200"
EXPO_PASSWORD = "Expo-Pass-1"


async def _expo_headers(client, owner, branch, *, permissions=None, phone=EXPO_PHONE) -> dict:
    """Сотрудник раздачи: обычный app-вход по телефону и паролю.

    По умолчанию выдаём право can_expo; permissions={} — сотрудник без права
    (нужен для проверки запрета).
    """
    created = await client.post(
        "/auth/users",
        headers=owner,
        json={
            "phone": phone,
            "password": EXPO_PASSWORD,
            "role_slug": "cashier",
            "branch_id": branch["id"],
            "permissions": {"can_expo": True} if permissions is None else permissions,
        },
    )
    assert created.status_code == 201, created.text
    login = await client.post(
        "/auth/login", json={"phone": phone, "password": EXPO_PASSWORD}
    )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _confirm_expo(client, headers, order_id) -> dict:
    response = await client.patch(f"/kitchen/expo/orders/{order_id}/confirm", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()



@pytest.fixture(autouse=True)
def _no_printing(monkeypatch):
    monkeypatch.setattr(
        "app.modules.printers.service.print_raw",
        AsyncMock(side_effect=AssertionError("No physical printing in tests")),
    )
    monkeypatch.setattr(
        "app.modules.printers.service.printer_ws_manager.broadcast", AsyncMock()
    )


@pytest.fixture(autouse=True)
def kitchen_events(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr("app.modules.kitchen.websocket.kitchen_manager.broadcast", broadcast)
    return broadcast


async def _create_order(client, owner_headers, branch, product_id, *, items: int = 2) -> dict:
    response = await client.post(
        "/pos/orders",
        headers=owner_headers,
        json={
            "branch_id": branch["id"],
            "order_type": "dine_in",
            "table_number": "3",
            "items": [{"product_id": product_id, "quantity": 1} for _ in range(items)],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _set_item(client, cook_headers, item_id, status: str) -> dict:
    response = await client.patch(
        "/kitchen/orders/items/status",
        headers=cook_headers,
        json={"order_item_id": str(item_id), "status": status},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _order_status(client, owner_headers, order_id) -> str:
    response = await client.get(f"/pos/orders/{order_id}", headers=owner_headers)
    assert response.status_code == 200, response.text
    return response.json()["status"]


async def test_items_drive_order_readiness_and_can_be_undone(client, db_engine):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-ready")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    order_id = order["id"]
    first, second = order["items"][0]["id"], order["items"][1]["id"]

    # Одно блюдо готово — заказ ещё в работе.
    body = await _set_item(client, cook, first, "ready")
    assert body["status"] == "ready"
    assert body["order_status"] == "new"

    # Готово второе — заказ закрывается сам, без отдельной кнопки.
    body = await _set_item(client, cook, second, "ready")
    assert body["order_status"] == "ready"
    assert await _order_status(client, owner, order_id) == "ready"

    # «Не сделал»: блюдо возвращается в работу и заказ снова готовится.
    body = await _set_item(client, cook, second, "cooking")
    assert body["order_status"] == "cooking"
    assert await _order_status(client, owner, order_id) == "cooking"

    # Готовый заказ остаётся на доске — колонка «К отдаче».
    await _set_item(client, cook, second, "ready")
    board = await client.get("/kitchen/orders", headers=cook)
    assert board.status_code == 200, board.text
    board_statuses = {row["id"]: row["status"] for row in board.json()}
    assert board_statuses[str(order_id)] == "ready"


async def test_cancelled_dish_does_not_block_readiness(client, db_engine):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-cancel")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    order_id = order["id"]
    first, second = order["items"][0]["id"], order["items"][1]["id"]

    await _set_item(client, cook, first, "cooking")
    await _set_item(client, cook, first, "cancelled")
    body = await _set_item(client, cook, second, "ready")
    assert body["order_status"] == "ready", "отменённое блюдо не должно держать заказ"
    assert await _order_status(client, owner, order_id) == "ready"


async def test_whole_order_ready_marks_every_dish(client, db_engine):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-all")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    order_id = order["id"]

    response = await client.patch(f"/kitchen/orders/{order_id}/ready", headers=cook)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ready"
    assert {item["status"] for item in response.json()["items"]} == {"ready"}


async def test_added_dishes_return_ready_order_to_kitchen(client, db_engine):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-add")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    order_id = order["id"]

    ready = await client.patch(f"/kitchen/orders/{order_id}/ready", headers=cook)
    assert ready.status_code == 200, ready.text

    added = await client.post(
        f"/pos/orders/{order_id}/items",
        headers=owner,
        json={"product_id": product_id, "quantity": 1},
    )
    assert added.status_code == 201, added.text
    assert added.json()["status"] == "cooking"

    board = await client.get("/kitchen/orders", headers=cook)
    row = next(item for item in board.json() if item["id"] == order_id)
    assert row["status"] == "cooking"
    assert any(item["status"] == "pending" for item in row["items"])


async def test_visitor_display_is_public_and_minimal(client, db_engine):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-tv")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    order_id = order["id"]

    # Без токена: телевизор в зале не логинится.
    board = await client.get("/kitchen/display", params={"branch_id": branch["id"]})
    assert board.status_code == 200, board.text
    body = board.json()
    assert body["branch_name"] == "Main"
    row = next(item for item in body["orders"] if item["number"] == order["order_number"])
    assert row["status"] == "queued"
    assert set(row) == {"number", "status", "created_at"}, "лишние поля на ТВ не нужны"

    await client.patch(f"/kitchen/orders/{order_id}/ready", headers=cook)
    board = await client.get("/kitchen/display", params={"branch_id": branch["id"]})
    row = next(item for item in board.json()["orders"] if item["number"] == order["order_number"])
    assert row["status"] == "queued", "без подтверждения раздачи заказ ещё не готов"

    expo = await _expo_headers(client, owner, branch)
    await _confirm_expo(client, expo, order_id)
    board = await client.get("/kitchen/display", params={"branch_id": branch["id"]})
    row = next(item for item in board.json()["orders"] if item["number"] == order["order_number"])
    assert row["status"] == "ready"


async def test_visitor_display_rejects_unknown_branch(client, db_engine):
    from uuid import uuid4

    response = await client.get("/kitchen/display", params={"branch_id": str(uuid4())})
    assert response.status_code == 404, response.text


async def _pay(client, owner_headers, order: dict) -> None:
    total = order["total_amount"]
    response = await client.post(
        "/payments",
        headers=owner_headers,
        json={
            "order_id": order["id"],
            "amount": total,
            "method": "cash",
            "cash_received": total,
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "completed"


async def _display_status(client, branch, order_number: str) -> str:
    board = await client.get("/kitchen/display", params={"branch_id": branch["id"]})
    assert board.status_code == 200, board.text
    return next(
        row["status"] for row in board.json()["orders"] if row["number"] == order_number
    )


async def test_paid_order_waits_for_dishes_before_leaving_kitchen(client, db_engine):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-paid")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    order_id = order["id"]

    await _pay(client, owner, order)
    paid = (await client.get(f"/pos/orders/{order_id}", headers=owner)).json()
    assert paid["status"] == "completed"
    assert {item["status"] for item in paid["items"]} == {"pending"}, (
        "Payment must not pretend the kitchen finished the dishes"
    )

    board = await client.get("/kitchen/orders", headers=cook)
    row = next(item for item in board.json() if item["id"] == order_id)
    assert row["status"] == "completed"
    assert await _display_status(client, branch, order["order_number"]) == "queued"

    for item in paid["items"]:
        await _set_item(client, cook, item["id"], "ready")
    assert await _display_status(client, branch, order["order_number"]) == "queued"

    expo = await _expo_headers(client, owner, branch)
    await _confirm_expo(client, expo, order_id)
    assert await _display_status(client, branch, order["order_number"]) == "ready"

    # «Не сделал» после выдачи: подтверждение снимается, заказ снова в очереди.
    await _set_item(client, cook, paid["items"][0]["id"], "cooking")
    assert await _display_status(client, branch, order["order_number"]) == "queued"


async def test_whole_ready_keeps_payment_cancelled_and_served(client, db_engine):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-paid-all")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id, items=3)
    order_id = order["id"]
    pending, served, cancelled = (item["id"] for item in order["items"])

    await _set_item(client, cook, served, "ready")
    await _set_item(client, cook, served, "served")
    await _set_item(client, cook, cancelled, "cooking")
    await _set_item(client, cook, cancelled, "cancelled")
    await _pay(client, owner, order)

    response = await client.patch(f"/kitchen/orders/{order_id}/ready", headers=cook)
    assert response.status_code == 200, response.text
    statuses = {item["id"]: item["status"] for item in response.json()["items"]}
    assert statuses[pending] == "ready"
    assert statuses[served] == "served"
    assert statuses[cancelled] == "cancelled"

    order_row = (await client.get(f"/pos/orders/{order_id}", headers=owner)).json()
    assert order_row["status"] == "completed", "Financial state must stay completed"
    payments = await client.get(f"/payments/order/{order_id}", headers=owner)
    assert [row["status"] for row in payments.json()] == ["completed"]


async def test_cancelled_order_rejects_kitchen_mutations(client, db_engine):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-cancelled")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    order_id = order["id"]
    cancelled = await client.patch(
        f"/pos/orders/{order_id}/status", headers=owner, json={"status": "cancelled"}
    )
    assert cancelled.status_code == 200, cancelled.text

    item = await client.patch(
        "/kitchen/orders/items/status",
        headers=cook,
        json={"order_item_id": order["items"][0]["id"], "status": "ready"},
    )
    assert item.status_code == 422, item.text
    whole = await client.patch(f"/kitchen/orders/{order_id}/ready", headers=cook)
    assert whole.status_code == 422, whole.text

    board = await client.get("/kitchen/orders", headers=cook)
    assert all(row["id"] != order_id for row in board.json())


async def test_served_paid_order_leaves_kitchen_board(client, db_engine):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-served")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    order_id = order["id"]
    await _pay(client, owner, order)
    for item in order["items"]:
        await _set_item(client, cook, item["id"], "ready")
        await _set_item(client, cook, item["id"], "served")

    board = await client.get("/kitchen/orders", headers=cook)
    assert all(row["id"] != order_id for row in board.json())
    display = await client.get("/kitchen/display", params={"branch_id": branch["id"]})
    assert all(row["number"] != order["order_number"] for row in display.json()["orders"])


async def _get_order(client, owner, order_id):
    response = await client.get(f"/pos/orders/{order_id}", headers=owner)
    assert response.status_code == 200, response.text
    return response.json()


async def _payments(client, owner, order_id):
    response = await client.get(f"/payments/order/{order_id}", headers=owner)
    assert response.status_code == 200, response.text
    return response.json()


async def _assert_on_boards(client, cook, branch, order, display_status):
    board = await client.get("/kitchen/orders", headers=cook)
    assert board.status_code == 200, board.text
    row = next(row for row in board.json() if row["id"] == order["id"])
    assert row["status"] == order["status"]
    assert {item["id"]: item["status"] for item in row["items"]} == {
        item["id"]: item["status"] for item in order["items"]
    }
    display = await client.get("/kitchen/display", params={"branch_id": branch["id"]})
    assert display.status_code == 200, display.text
    row = next(row for row in display.json()["orders"] if row["number"] == order["order_number"])
    assert row["status"] == display_status
    assert set(row) == {"number", "status", "created_at"}


def _assert_order_event(events, order, status):
    events.assert_any_await(
        UUID(order["company_id"]), UUID(order["branch_id"]), "order_updated",
        {"order_id": order["id"], "status": status},
    )


async def test_payment_before_ready_keeps_kitchen_work_and_financial_completion(
    client, kitchen_events,
):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-paid")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    first, second = (item["id"] for item in order["items"])
    await _set_item(client, cook, second, "cooking")

    # Exercise the real payment endpoint, not a pre-seeded completed status.
    paid = await client.post(
        "/payments", headers=owner,
        json={"order_id": order["id"], "amount": order["total_amount"], "method": "cash"},
    )
    assert paid.status_code == 201, paid.text
    payment = paid.json()
    assert payment["status"] == "completed"
    assert Decimal(payment["amount"]) == Decimal(order["total_amount"])
    assert await _payments(client, owner, order["id"]) == [payment]

    current = await _get_order(client, owner, order["id"])
    assert current["status"] == "completed"
    assert {item["id"]: item["status"] for item in current["items"]} == {
        first: "pending", second: "cooking",
    }
    await _assert_on_boards(client, cook, branch, current, "queued")

    # Partial readiness, all-ready, undo, whole-ready and its retry must never
    # reopen the financial order or create/refund/change a payment.
    steps = [
        (first, "ready", {first: "ready", second: "cooking"}, "queued"),
        (second, "ready", {first: "ready", second: "ready"}, "queued"),
        (second, "cooking", {first: "ready", second: "cooking"}, "queued"),
        (None, None, {first: "ready", second: "ready"}, "queued"),
        (None, None, {first: "ready", second: "ready"}, "queued"),
    ]
    for item_id, target, expected_items, display_status in steps:
        kitchen_events.reset_mock()
        if item_id is None:
            ready = await client.patch(f"/kitchen/orders/{order['id']}/ready", headers=cook)
            assert ready.status_code == 200, ready.text
            assert ready.json()["status"] == "completed"
        else:
            changed = await _set_item(client, cook, item_id, target)
            assert changed["order_status"] == "completed"
            kitchen_events.assert_any_await(
                UUID(order["company_id"]), UUID(branch["id"]), "item_status_changed",
                {"order_item_id": item_id, "order_id": order["id"], "status": target},
            )
        current = await _get_order(client, owner, order["id"])
        assert current["status"] == "completed"
        assert {item["id"]: item["status"] for item in current["items"]} == expected_items
        assert current["total_amount"] == order["total_amount"]
        assert await _payments(client, owner, order["id"]) == [payment]
        await _assert_on_boards(client, cook, branch, current, display_status)
        _assert_order_event(kitchen_events, order, "completed")

    # Раздача подтверждает выдачу уже оплаченного заказа: ТВ показывает «готов»,
    # а финансовое состояние и платёж не меняются.
    confirmed = await _confirm_expo(client, owner, order["id"])
    assert confirmed["expo_confirmed_at"] is not None
    assert await _display_status(client, branch, order["order_number"]) == "ready"
    assert (await _get_order(client, owner, order["id"]))["status"] == "completed"
    assert await _payments(client, owner, order["id"]) == [payment]


async def test_pos_completion_does_not_mark_dishes_served(client):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-pos-complete")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    await _set_item(client, cook, order["items"][1]["id"], "cooking")
    before = await _get_order(client, owner, order["id"])

    completed = await client.patch(
        f"/pos/orders/{order['id']}/status", headers=owner, json={"status": "completed"},
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    assert {item["id"]: item["status"] for item in completed.json()["items"]} == {
        item["id"]: item["status"] for item in before["items"]
    }
    assert await _payments(client, owner, order["id"]) == []
    await _assert_on_boards(client, cook, branch, completed.json(), "queued")


@pytest.mark.parametrize("mutation", ["dish-ready", "dish-cooking", "whole-ready"])
async def test_cancelled_parent_rejects_kitchen_mutations(client, kitchen_events, mutation):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-cancel-parent")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    cancelled = await client.patch(
        f"/pos/orders/{order['id']}/status", headers=owner, json={"status": "cancelled"},
    )
    assert cancelled.status_code == 200, cancelled.text
    before = await _get_order(client, owner, order["id"])
    # The item transition itself is valid; it is the parent that forbids it.
    assert {item["status"] for item in before["items"]} == {"pending"}
    kitchen_events.reset_mock()
    if mutation == "whole-ready":
        response = await client.patch(f"/kitchen/orders/{order['id']}/ready", headers=cook)
    else:
        response = await client.patch(
            "/kitchen/orders/items/status", headers=cook,
            json={"order_item_id": order["items"][0]["id"], "status": mutation.removeprefix("dish-")},
        )
    assert response.status_code == 422, response.text
    assert await _get_order(client, owner, order["id"]) == before
    kitchen_events.assert_not_awaited()
    board = await client.get("/kitchen/orders", headers=cook)
    assert board.status_code == 200, board.text
    assert board.json() == []
    display = await client.get("/kitchen/display", params={"branch_id": branch["id"]})
    assert display.status_code == 200, display.text
    assert display.json()["orders"] == []


async def test_whole_ready_preserves_cancelled_and_served_items(client, kitchen_events):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-whole-mixed")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id, items=5)
    pending, cooking, ready, served, cancelled = (item["id"] for item in order["items"])
    await _set_item(client, cook, cooking, "cooking")
    await _set_item(client, cook, ready, "ready")
    await _set_item(client, cook, served, "ready")
    await _set_item(client, cook, served, "served")
    await _set_item(client, cook, cancelled, "cooking")
    await _set_item(client, cook, cancelled, "cancelled")
    before = await _get_order(client, owner, order["id"])
    untouched = {item["id"]: item for item in before["items"] if item["id"] in (served, cancelled)}
    assert untouched[cancelled]["cancelled_at"] is not None
    assert untouched[cancelled]["cancelled_by_id"] is not None

    kitchen_events.reset_mock()
    response = await client.patch(f"/kitchen/orders/{order['id']}/ready", headers=cook)
    assert response.status_code == 200, response.text
    current = await _get_order(client, owner, order["id"])
    assert response.json() == current
    assert current["status"] == "ready"
    assert {item["id"]: item["status"] for item in current["items"]} == {
        pending: "ready", cooking: "ready", ready: "ready", served: "served", cancelled: "cancelled",
    }
    assert {item["id"]: item for item in current["items"] if item["id"] in untouched} == untouched
    _assert_order_event(kitchen_events, order, "ready")
    await _assert_on_boards(client, cook, branch, current, "queued")


@pytest.mark.parametrize("days_ago", [0, 2], ids=["today", "historical"])
async def test_completed_all_served_orders_are_excluded(client, db_engine, days_ago):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-served")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    # Historical fixture deliberately has a fresh updated_at: exclusion must
    # depend on handoff, not just the 8-hour ready cutoff.
    async with async_sessionmaker(db_engine)() as db:
        stored = await db.get(Order, UUID(order["id"]))
        stored.status = "completed"
        stored.order_local_date -= timedelta(days=days_ago)
        stored.created_at = datetime.now(timezone.utc) - timedelta(days=days_ago)
        stored.updated_at = datetime.now(timezone.utc)
        await db.execute(update(OrderItem).where(OrderItem.order_id == stored.id).values(status="served"))
        await db.commit()
    board = await client.get("/kitchen/orders", headers=cook)
    assert board.status_code == 200, board.text
    assert board.json() == []
    display = await client.get("/kitchen/display", params={"branch_id": branch["id"]})
    assert display.status_code == 200, display.text
    assert display.json()["orders"] == []


@pytest.mark.parametrize("parent_status", ["ready", "completed"])
async def test_kds_ready_cutoff_and_tv_operational_date_are_independent(
    client, db_engine, monkeypatch, parent_status,
):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-cutoff")
    cook = await _cook_headers(client)
    now = datetime(2026, 11, 3, 20, 30, tzinfo=timezone.utc)
    # Asia/Tashkent is already on the next calendar day. TV must use the
    # operational date, not UTC date or the order's creation timestamp.
    local_today = date(2026, 11, 4)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz) if tz is not None else now.replace(tzinfo=None)

    monkeypatch.setattr("app.modules.kitchen.service.datetime", FrozenDateTime)
    monkeypatch.setattr(
        "app.modules.pos.service.OrderService._company_local_today",
        AsyncMock(return_value=local_today),
    )
    cutoff = now - timedelta(hours=8)
    # Без подтверждения раздачи готовые блюда на ТВ остаются «в очереди» —
    # этот тест проверяет только KDS-cutoff и операционный день ТВ.
    cases = [
        ("recent", "ready", cutoff + timedelta(microseconds=1), local_today, True, "queued"),
        ("boundary", "ready", cutoff, local_today, True, "queued"),
        ("expired", "ready", cutoff - timedelta(microseconds=1), local_today, False, "queued"),
        ("pending", "pending", cutoff - timedelta(days=1), local_today, True, "queued"),
        ("cooking", "cooking", cutoff - timedelta(days=1), local_today, True, "queued"),
        ("yesterday", "ready", now, local_today - timedelta(days=1), True, None),
        ("legacy", "ready", now, None, True, None),
    ]
    expected_kds, expected_tv = set(), {}
    async with async_sessionmaker(db_engine)() as db:
        for number, item_status, updated_at, local_date, on_kds, tv_status in cases:
            order = Order(
                company_id=UUID(branch["company_id"]), branch_id=UUID(branch["id"]),
                order_number=number, order_local_date=local_date, status=parent_status,
                created_at=now - timedelta(days=3), updated_at=updated_at,
            )
            # Mixed done/cancelled items ensure cutoff checks every active dish.
            order.items = [
                OrderItem(
                    product_id=UUID(product_id), name="Fixture dish", price=Decimal("42000"),
                    quantity=1, total=Decimal("42000"), status=status,
                )
                for status in (item_status, "served", "cancelled")
            ]
            db.add(order)
            await db.flush()
            if on_kds:
                expected_kds.add(str(order.id))
            if tv_status:
                expected_tv[number] = tv_status
        await db.commit()

    board = await client.get("/kitchen/orders", headers=cook)
    assert board.status_code == 200, board.text
    assert {row["id"] for row in board.json()} == expected_kds
    display = await client.get("/kitchen/display", params={"branch_id": branch["id"]})
    assert display.status_code == 200, display.text
    assert {row["number"]: row["status"] for row in display.json()["orders"]} == expected_tv
    assert all(set(row) == {"number", "status", "created_at"} for row in display.json()["orders"])


@pytest.mark.parametrize("scope", ["branch", "company"])
async def test_kitchen_mutations_and_boards_are_scoped(client, db_engine, kitchen_events, scope):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-scope")
    cook = await _cook_headers(client)
    own_order = await _create_order(client, owner, branch, product_id)
    foreign_owner = owner
    if scope == "company":
        foreign_owner, _ = await register_company(
            client, slug="kds-foreign", email="owner@kds-foreign.example.com",
        )
        product = await client.post(
            "/inventory/products", headers=foreign_owner,
            json={"name": "Other company dish", "price": "10000"},
        )
        assert product.status_code == 201, product.text
        product_id = product.json()["id"]
    created_branch = await client.post(
        "/companies/me/branches", headers=foreign_owner, json={"name": "Other branch"},
    )
    assert created_branch.status_code == 201, created_branch.text
    foreign_branch = created_branch.json()
    foreign_order = await _create_order(client, foreign_owner, foreign_branch, product_id)
    # Different visible numbers make accidental cross-branch TV leakage observable.
    async with async_sessionmaker(db_engine)() as db:
        await db.execute(update(Order).where(Order.id == UUID(foreign_order["id"])).values(order_number="987"))
        await db.commit()
    before = await _get_order(client, foreign_owner, foreign_order["id"])
    kitchen_events.reset_mock()
    # An unscoped owner session must still enforce company isolation.
    actors = [cook, owner] if scope == "company" else [cook]
    for actor in actors:
        item_response = await client.patch(
            "/kitchen/orders/items/status", headers=actor,
            json={"order_item_id": foreign_order["items"][0]["id"], "status": "ready"},
        )
        assert item_response.status_code == 404, item_response.text
        order_response = await client.patch(
            f"/kitchen/orders/{foreign_order['id']}/ready", headers=actor,
        )
        assert order_response.status_code == 404, order_response.text
    assert await _get_order(client, foreign_owner, foreign_order["id"]) == before
    kitchen_events.assert_not_awaited()

    board = await client.get(
        "/kitchen/orders", headers=cook, params={"branch_id": foreign_branch["id"]},
    )
    assert board.status_code == 200, board.text
    assert {row["id"] for row in board.json()} == {own_order["id"]}
    if scope == "company":
        owner_board = await client.get(
            "/kitchen/orders", headers=owner, params={"branch_id": foreign_branch["id"]},
        )
        assert owner_board.status_code == 200, owner_board.text
        assert owner_board.json() == []
    for selected_branch, expected_number in ((branch, own_order["order_number"]), (foreign_branch, "987")):
        display = await client.get("/kitchen/display", params={"branch_id": selected_branch["id"]})
        assert display.status_code == 200, display.text
        assert set(display.json()) == {"company_name", "branch_name", "enabled", "orders"}
        assert display.json()["branch_name"] == selected_branch["name"]
        assert display.json()["company_name"]
        rows = display.json()["orders"]
        assert len(rows) == 1
        assert rows[0]["number"] == expected_number
        assert rows[0]["status"] == "queued"
        assert set(rows[0]) == {"number", "status", "created_at"}


async def test_removing_last_unfinished_dish_makes_order_ready(client, kitchen_events):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-remove")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)
    first, second = (item["id"] for item in order["items"])
    await _set_item(client, cook, first, "ready")
    await _set_item(client, cook, second, "cooking")
    kitchen_events.reset_mock()
    removed = await client.delete(
        f"/pos/orders/{order['id']}/items/{second}", headers=owner,
        params={"reason": "Synthetic cancellation"},
    )
    assert removed.status_code == 200, removed.text
    current = await _get_order(client, owner, order["id"])
    assert current["status"] == "ready"
    assert {item["id"]: item["status"] for item in current["items"]} == {
        first: "ready", second: "cancelled",
    }
    _assert_order_event(kitchen_events, order, "ready")
    await _assert_on_boards(client, cook, branch, current, "queued")


@pytest.mark.parametrize("initial_status", ["ready", "served"])
async def test_increasing_done_dish_quantity_returns_it_to_cooking(client, kitchen_events, initial_status):
    owner, branch, product_id = await _kitchen_context(client, slug="kds-quantity")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id, items=1)
    item_id = order["items"][0]["id"]
    await _set_item(client, cook, item_id, "ready")
    if initial_status == "served":
        await _set_item(client, cook, item_id, "served")
    assert await _order_status(client, owner, order["id"]) == "ready"
    expo = await _expo_headers(client, owner, branch)
    # served уже означает выдачу — подтверждать нечего; ready ждёт раздачу.
    if initial_status == "ready":
        await _confirm_expo(client, expo, order["id"])
    assert await _display_status(client, branch, order["order_number"]) == "ready"
    kitchen_events.reset_mock()
    increased = await client.patch(
        f"/pos/orders/{order['id']}/items/{item_id}", headers=owner, json={"quantity": 2},
    )
    assert increased.status_code == 200, increased.text
    current = await _get_order(client, owner, order["id"])
    assert current["status"] == "cooking"
    assert current["items"][0]["status"] == "cooking"
    assert current["expo_confirmed_at"] is None, "дозаказ снимает подтверждение раздачи"
    assert Decimal(current["items"][0]["quantity"]) == 2
    assert Decimal(current["subtotal"]) == Decimal(order["subtotal"]) * 2
    _assert_order_event(kitchen_events, order, "cooking")
    await _assert_on_boards(client, cook, branch, current, "queued")


async def test_expo_queue_and_confirmation_handoff(client, kitchen_events):
    """Раздача: готовая еда ждёт подтверждения, подтверждение уводит заказ на ТВ."""
    owner, branch, product_id = await _kitchen_context(client, slug="expo-queue")
    cook = await _cook_headers(client)
    expo = await _expo_headers(client, owner, branch)
    order = await _create_order(client, owner, branch, product_id)

    empty = await client.get("/kitchen/expo/orders", headers=expo)
    assert empty.status_code == 200, empty.text
    assert empty.json() == []

    # Частично готовый заказ ещё не выдаётся.
    await _set_item(client, cook, order["items"][0]["id"], "ready")
    assert (await client.get("/kitchen/expo/orders", headers=expo)).json() == []

    whole = await client.patch(f"/kitchen/orders/{order['id']}/ready", headers=cook)
    assert whole.status_code == 200, whole.text
    queue = (await client.get("/kitchen/expo/orders", headers=expo)).json()
    assert [row["id"] for row in queue] == [order["id"]]
    assert queue[0]["table_number"] == "3"
    assert queue[0]["expo_confirmed_at"] is None
    assert all(item["status"] == "ready" for item in queue[0]["items"])

    kitchen_events.reset_mock()
    confirmed = await _confirm_expo(client, expo, order["id"])
    assert confirmed["expo_confirmed_at"] is not None
    assert confirmed["expo_confirmed_by_id"] is not None
    kitchen_events.assert_any_await(
        UUID(order["company_id"]), UUID(branch["id"]), "order_updated",
        {"order_id": order["id"], "status": "ready"},
    )

    # Подтверждённый заказ уходит с доски повара и появляется на ТВ готовым.
    assert (await client.get("/kitchen/expo/orders", headers=expo)).json() == []
    board = (await client.get("/kitchen/orders", headers=cook)).json()
    assert all(row["id"] != order["id"] for row in board)
    assert await _display_status(client, branch, order["order_number"]) == "ready"

    # Повторное подтверждение ничего не меняет.
    again = await _confirm_expo(client, expo, order["id"])
    assert again["expo_confirmed_at"] == confirmed["expo_confirmed_at"]


async def test_expo_requires_permission_and_rejects_kitchen_token(client):
    owner, branch, product_id = await _kitchen_context(client, slug="expo-perm")
    cook = await _cook_headers(client)
    outsider = await _expo_headers(client, owner, branch, permissions={})
    order = await _create_order(client, owner, branch, product_id)
    await client.patch(f"/kitchen/orders/{order['id']}/ready", headers=cook)

    for headers in (outsider, cook):
        listed = await client.get("/kitchen/expo/orders", headers=headers)
        assert listed.status_code == 403, listed.text
        confirmed = await client.patch(
            f"/kitchen/expo/orders/{order['id']}/confirm", headers=headers,
        )
        assert confirmed.status_code == 403, confirmed.text

    # Заказ не подтверждён и остаётся в очереди гостей.
    assert await _display_status(client, branch, order["order_number"]) == "queued"


async def test_expo_cannot_confirm_incomplete_order(client):
    owner, branch, product_id = await _kitchen_context(client, slug="expo-incomplete")
    cook = await _cook_headers(client)
    expo = await _expo_headers(client, owner, branch)
    order = await _create_order(client, owner, branch, product_id)
    await _set_item(client, cook, order["items"][0]["id"], "ready")

    response = await client.patch(
        f"/kitchen/expo/orders/{order['id']}/confirm", headers=expo,
    )
    assert response.status_code == 422, response.text
    row = await _get_order(client, owner, order["id"])
    assert row["expo_confirmed_at"] is None
    assert await _display_status(client, branch, order["order_number"]) == "queued"


async def test_adding_dish_after_expo_confirmation_returns_order_to_cook(client, kitchen_events):
    """Дозаказ после выдачи: блюдо должно вернуться на доску повара, а не исчезнуть."""
    owner, branch, product_id = await _kitchen_context(client, slug="kds-expo-dozakaz")
    cook = await _cook_headers(client)
    expo = await _expo_headers(client, owner, branch)
    order = await _create_order(client, owner, branch, product_id)
    await client.patch(f"/kitchen/orders/{order['id']}/ready", headers=cook)
    await _confirm_expo(client, expo, order["id"])
    board = (await client.get("/kitchen/orders", headers=cook)).json()
    assert all(row["id"] != order["id"] for row in board), "подтверждённый заказ ушёл с доски"

    added = await client.post(
        f"/pos/orders/{order['id']}/items", headers=owner,
        json={"product_id": product_id, "quantity": 1},
    )
    assert added.status_code == 201, added.text
    assert added.json()["expo_confirmed_at"] is None, "дозаказ снимает подтверждение раздачи"

    board = (await client.get("/kitchen/orders", headers=cook)).json()
    row = next(row for row in board if row["id"] == order["id"])
    assert any(item["status"] == "pending" for item in row["items"])
    assert await _display_status(client, branch, order["order_number"]) == "queued"


async def test_guest_display_toggle_hides_and_restores_queue(client, db_engine):
    """Выключатель в настройках десктопа: ТВ не отдаёт номера, кухня работает."""
    owner, branch, product_id = await _kitchen_context(client, slug="kds-display-toggle")
    cook = await _cook_headers(client)
    order = await _create_order(client, owner, branch, product_id)

    state = await client.get(
        "/kitchen/display/settings", headers=owner, params={"branch_id": branch["id"]},
    )
    assert state.status_code == 200, state.text
    assert state.json() == {
        "branch_id": branch["id"], "branch_name": "Main", "enabled": True,
    }

    off = await client.patch(
        "/kitchen/display/settings", headers=owner,
        json={"branch_id": branch["id"], "enabled": False},
    )
    assert off.status_code == 200, off.text
    assert off.json()["enabled"] is False

    hidden = await client.get("/kitchen/display", params={"branch_id": branch["id"]})
    assert hidden.status_code == 200, hidden.text
    hidden_body = hidden.json()
    assert hidden_body["enabled"] is False
    assert hidden_body["branch_name"] == "Main"
    assert hidden_body["orders"] == [], (
        "выключенный экран не должен отдавать номера заказов"
    )

    # Повар продолжает работать: гостевая доска — не кухонная.
    board = await client.get("/kitchen/orders", headers=cook)
    assert {row["id"] for row in board.json()} == {order["id"]}

    on = await client.patch(
        "/kitchen/display/settings", headers=owner,
        json={"branch_id": branch["id"], "enabled": True},
    )
    assert on.status_code == 200, on.text
    assert on.json()["enabled"] is True
    restored = await client.get("/kitchen/display", params={"branch_id": branch["id"]})
    assert restored.json()["enabled"] is True
    assert [row["number"] for row in restored.json()["orders"]] == [order["order_number"]]


async def test_guest_display_toggle_is_branch_scoped_and_staff_only(client):
    from uuid import uuid4

    owner, branch, _ = await _kitchen_context(client, slug="kds-display-scope")
    cook = await _cook_headers(client)
    second = await client.post(
        "/companies/me/branches", headers=owner, json={"name": "Second"},
    )
    assert second.status_code == 201, second.text
    second_branch = second.json()

    await client.patch(
        "/kitchen/display/settings", headers=owner,
        json={"branch_id": branch["id"], "enabled": False},
    )
    untouched = await client.get(
        "/kitchen/display/settings", headers=owner,
        params={"branch_id": second_branch["id"]},
    )
    assert untouched.json()["enabled"] is True, "филиалы переключаются независимо"

    # Кухонная сессия повара номерами в зале не распоряжается.
    assert (await client.get("/kitchen/display/settings", headers=cook)).status_code == 403
    assert (
        await client.patch(
            "/kitchen/display/settings", headers=cook, json={"enabled": True},
        )
    ).status_code == 403

    # Сетевая сессия владельца без branch_id не угадывает филиал.
    assert (await client.get("/kitchen/display/settings", headers=owner)).status_code == 422
    assert (
        await client.patch(
            "/kitchen/display/settings", headers=owner, json={"enabled": True},
        )
    ).status_code == 422

    missing = await client.patch(
        "/kitchen/display/settings", headers=owner,
        json={"branch_id": str(uuid4()), "enabled": True},
    )
    assert missing.status_code == 404, missing.text

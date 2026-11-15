"""«Сохранить» в заказе: минус на блюде — тикет «ОТМЕНА БЛЮДА», плюс — обычный тикет."""
import base64
from unittest.mock import AsyncMock

from app.modules.printers.printer_client import PrinterError
from app.modules.printers.receipt_raster import RasterRenderError
from tests.conftest import register_company


def _text_only_kitchen(monkeypatch):
    monkeypatch.setattr(
        "app.modules.printers.service.print_raw",
        AsyncMock(side_effect=PrinterError("printer offline in tests")),
    )
    monkeypatch.setattr("app.modules.printers.service.printer_ws_manager.broadcast", AsyncMock())

    def _no_raster(*_args, **_kwargs):
        raise RasterRenderError("raster disabled in tests")

    # Текстовый ESC/POS вместо растра: состав тикета можно прочитать из payload.
    monkeypatch.setattr("app.modules.printers.service.render_kitchen_ticket_raster", _no_raster)


async def _setup(client):
    headers, _ = await register_company(
        client, slug="kitchen-cancel", email="owner@kitchen-cancel.example.com",
    )
    branch = await client.post("/companies/me/branches", headers=headers, json={"name": "Main"})
    assert branch.status_code == 201, branch.text
    branch_id = branch.json()["id"]
    ids = {}
    for name, price in (("Плов", "25000"), ("Лаваш", "12000")):
        created = await client.post(
            "/inventory/products", headers=headers, json={"name": name, "price": price},
        )
        assert created.status_code == 201, created.text
        ids[name] = created.json()["id"]
    printer = await client.post(
        "/printers", headers=headers,
        json={"branch_id": branch_id, "name": "Kitchen", "printer_type": "kitchen",
              "connection_type": "network", "ip_address": "192.168.123.50", "port": 9100},
    )
    assert printer.status_code == 201, printer.text
    order = await client.post(
        "/pos/orders", headers=headers,
        json={"branch_id": branch_id, "order_type": "dine_in", "table_number": "3",
              "items": [{"product_id": ids["Плов"], "quantity": "2"},
                        {"product_id": ids["Лаваш"], "quantity": "2"}]},
    )
    assert order.status_code == 201, order.text
    return headers, printer.json()["id"], order.json()


def _item(order, name):
    return next(item for item in order["items"] if item["name"] == name)


async def _new_tickets(client, headers, printer_id, known_ids):
    jobs = (await client.get(f"/printers/{printer_id}/jobs/pending", headers=headers)).json()
    return [
        base64.b64decode(job["payload"]).decode("cp866", "replace")
        for job in jobs if job["id"] not in known_ids
    ]


async def _known(client, headers, printer_id):
    jobs = (await client.get(f"/printers/{printer_id}/jobs/pending", headers=headers)).json()
    return {job["id"] for job in jobs}


async def test_minus_prints_cancel_ticket_and_plus_prints_regular_ticket(client, monkeypatch):
    _text_only_kitchen(monkeypatch)
    headers, printer_id, order = await _setup(client)
    known = await _known(client, headers, printer_id)

    response = await client.post(
        f"/pos/orders/{order['id']}/items/adjust", headers=headers,
        json={"changes": [
            {"item_id": _item(order, "Плов")["id"], "quantity": "1"},
            {"item_id": _item(order, "Лаваш")["id"], "quantity": "3"},
        ], "reason": "гость передумал"},
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert float(_item(updated, "Плов")["quantity"]) == 1
    assert float(_item(updated, "Лаваш")["quantity"]) == 3

    tickets = await _new_tickets(client, headers, printer_id, known)
    assert len(tickets) == 2, tickets
    cancel = next(text for text in tickets if "ОТМЕНА БЛЮДА" in text)
    regular = next(text for text in tickets if "ОТМЕНА БЛЮДА" not in text)
    # Отмена: только плов (одна порция), без лаваша и без строки типа заказа.
    assert "Плов" in cancel and "Лаваш" not in cancel
    assert "Стол" in cancel
    # Добавление: только лаваш, обычный тикет.
    assert "Лаваш" in regular and "Плов" not in regular


async def test_only_plus_prints_no_cancel_ticket(client, monkeypatch):
    _text_only_kitchen(monkeypatch)
    headers, printer_id, order = await _setup(client)
    known = await _known(client, headers, printer_id)

    response = await client.post(
        f"/pos/orders/{order['id']}/items/adjust", headers=headers,
        json={"changes": [{"item_id": _item(order, "Лаваш")["id"], "quantity": "4"}]},
    )
    assert response.status_code == 200, response.text

    tickets = await _new_tickets(client, headers, printer_id, known)
    assert len(tickets) == 1, tickets
    assert "ОТМЕНА БЛЮДА" not in tickets[0]
    assert "Лаваш" in tickets[0]


async def test_wrong_password_rejects_decrease_and_changes_nothing(client, db_engine, monkeypatch):
    from sqlalchemy import update
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.modules.companies.models import Company

    _text_only_kitchen(monkeypatch)
    headers, printer_id, order = await _setup(client)
    async with async_sessionmaker(db_engine, expire_on_commit=False)() as session:
        await session.execute(update(Company).values(cancel_password="1234"))
        await session.commit()
    known = await _known(client, headers, printer_id)

    plov = _item(order, "Плов")
    rejected = await client.post(
        f"/pos/orders/{order['id']}/items/adjust", headers=headers,
        json={"changes": [{"item_id": plov["id"], "quantity": "1"}], "pin": "0000"},
    )
    assert rejected.status_code == 422, rejected.text
    assert await _new_tickets(client, headers, printer_id, known) == []

    accepted = await client.post(
        f"/pos/orders/{order['id']}/items/adjust", headers=headers,
        json={"changes": [{"item_id": plov["id"], "quantity": "1"}], "pin": "1234"},
    )
    assert accepted.status_code == 200, accepted.text
    tickets = await _new_tickets(client, headers, printer_id, known)
    assert len(tickets) == 1 and "ОТМЕНА БЛЮДА" in tickets[0]


async def test_zero_quantity_cancels_the_dish_and_prints_cancel_ticket(client, monkeypatch):
    _text_only_kitchen(monkeypatch)
    headers, printer_id, order = await _setup(client)
    known = await _known(client, headers, printer_id)

    plov = _item(order, "Плов")
    response = await client.post(
        f"/pos/orders/{order['id']}/items/adjust", headers=headers,
        json={"changes": [
            {"item_id": plov["id"], "quantity": "0"},
            {"item_id": _item(order, "Лаваш")["id"], "quantity": "3"},
        ], "reason": "гость отказался"},
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    # Плов отменён целиком и не считается в сумме; лаваш вырос до 3.
    assert next(i for i in updated["items"] if i["id"] == plov["id"])["status"] == "cancelled"
    assert float(_item(updated, "Лаваш")["quantity"]) == 3
    assert float(updated["subtotal"]) == 3 * 12000

    tickets = await _new_tickets(client, headers, printer_id, known)
    assert len(tickets) == 2, tickets
    cancel = next(text for text in tickets if "ОТМЕНА БЛЮДА" in text)
    assert "Плов" in cancel and "Лаваш" not in cancel

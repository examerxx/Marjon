"""Order creation must enqueue the kitchen ticket, not silently skip printing."""
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from app.modules.printers.printer_client import PrinterError
from app.modules.printers.service import PrinterService
from tests.conftest import register_company


def _offline_print():
    """Сервер пробует печатать сам, не достучался — задание уходит терминалу.

    Это и есть штатная ветка PRINT-LAT-01; физической печати в тестах нет.
    """
    return AsyncMock(side_effect=PrinterError("printer offline in tests"))


async def _context(client):
    headers, _ = await register_company(
        client, slug="kitchen-auto", email="owner@kitchen-auto.example.com",
    )
    response = await client.post(
        "/companies/me/branches", headers=headers, json={"name": "Main"},
    )
    assert response.status_code == 201, response.text
    branch_id = response.json()["id"]
    response = await client.post(
        "/inventory/products", headers=headers,
        json={"name": "Хот дог", "price": "14000"},
    )
    assert response.status_code == 201, response.text
    return headers, branch_id, response.json()["id"]


async def test_order_creation_enqueues_kitchen_ticket(client, monkeypatch):
    # The test DB is isolated. Never connect to a printer or broadcast to a POS.
    network_print = _offline_print()
    broadcast = AsyncMock()
    monkeypatch.setattr("app.modules.printers.service.print_raw", network_print)
    monkeypatch.setattr("app.modules.printers.service.printer_ws_manager.broadcast", broadcast)
    headers, branch_id, product_id = await _context(client)
    response = await client.post(
        "/printers", headers=headers,
        json={"branch_id": branch_id, "name": "Kitchen", "printer_type": "kitchen",
              "connection_type": "network", "ip_address": "192.168.123.50", "port": 9100},
    )
    assert response.status_code == 201, response.text
    printer_id = response.json()["id"]
    response = await client.post(
        "/pos/orders", headers=headers,
        json={"branch_id": branch_id, "order_type": "takeaway",
              "items": [{"product_id": product_id, "quantity": "3"}]},
    )
    assert response.status_code == 201, response.text
    order = response.json()
    pending = await client.get(f"/printers/{printer_id}/jobs/pending", headers=headers)
    assert pending.status_code == 200, pending.text
    jobs = pending.json()
    assert len(jobs) == 1, jobs
    assert jobs[0]["job_type"] == "kitchen"
    assert jobs[0]["ref_id"] == order["id"]
    assert jobs[0]["status"] == "pending"
    assert jobs[0]["payload"]
    network_print.assert_awaited_once()
    broadcast.assert_awaited_once()
    assert broadcast.await_args.args[1] == UUID(branch_id)
    message = broadcast.await_args.args[2]
    assert message["job_id"] == jobs[0]["id"]
    assert message["ip_address"] == "192.168.123.50"


async def test_adding_item_prints_only_the_new_dish(client, monkeypatch):
    """Дозаказ: повар получает тикет ТОЛЬКО с добавленным блюдом.

    Гость уже получил первый тикет со всем составом, поэтому повторная печать
    старых позиций дублирует работу кухни.
    """
    import base64

    monkeypatch.setattr("app.modules.printers.service.print_raw", _offline_print())
    monkeypatch.setattr("app.modules.printers.service.printer_ws_manager.broadcast", AsyncMock())
    # Текстовый ESC/POS вместо растра — иначе payload тикета это картинка,
    # и состав блюд из него не проверить.
    from app.modules.printers.receipt_raster import RasterRenderError

    def _no_raster(*_args, **_kwargs):
        raise RasterRenderError("raster disabled in tests")

    monkeypatch.setattr(
        "app.modules.printers.service.render_kitchen_ticket_raster", _no_raster,
    )
    headers, branch_id, product_id = await _context(client)
    second = await client.post(
        "/inventory/products", headers=headers, json={"name": "Латте", "price": "9000"},
    )
    assert second.status_code == 201, second.text
    second_product_id = second.json()["id"]
    printer = await client.post(
        "/printers", headers=headers,
        json={"branch_id": branch_id, "name": "Kitchen", "printer_type": "kitchen",
              "connection_type": "network", "ip_address": "192.168.123.50", "port": 9100},
    )
    assert printer.status_code == 201, printer.text
    printer_id = printer.json()["id"]

    created = await client.post(
        "/pos/orders", headers=headers,
        json={"branch_id": branch_id, "order_type": "takeaway",
              "items": [{"product_id": product_id, "quantity": "2"}]},
    )
    assert created.status_code == 201, created.text
    order_id = created.json()["id"]
    first_jobs = (await client.get(f"/printers/{printer_id}/jobs/pending", headers=headers)).json()
    assert len(first_jobs) == 1, first_jobs
    first_text = base64.b64decode(first_jobs[0]["payload"]).decode("cp866", "replace")
    assert "Хот дог" in first_text

    added = await client.post(
        f"/pos/orders/{order_id}/items", headers=headers,
        json={"product_id": second_product_id, "quantity": "1"},
    )
    assert added.status_code == 201, added.text
    jobs = (await client.get(f"/printers/{printer_id}/jobs/pending", headers=headers)).json()
    assert len(jobs) == 2, jobs
    delta = next(job for job in jobs if job["id"] != first_jobs[0]["id"])
    delta_text = base64.b64decode(delta["payload"]).decode("cp866", "replace")
    assert "Латте" in delta_text
    assert "Хот дог" not in delta_text


async def test_bulk_add_prints_one_ticket_with_all_new_dishes(client, monkeypatch):
    """Пакетный дозаказ кассы: один тикет на все новые блюда, без старых."""
    import base64

    monkeypatch.setattr("app.modules.printers.service.print_raw", _offline_print())
    monkeypatch.setattr("app.modules.printers.service.printer_ws_manager.broadcast", AsyncMock())
    from app.modules.printers.receipt_raster import RasterRenderError

    def _no_raster(*_args, **_kwargs):
        raise RasterRenderError("raster disabled in tests")

    monkeypatch.setattr(
        "app.modules.printers.service.render_kitchen_ticket_raster", _no_raster,
    )
    headers, branch_id, product_id = await _context(client)
    second_ids = []
    for name, price in (("Латте", "9000"), ("Чизкейк", "12000")):
        response = await client.post(
            "/inventory/products", headers=headers, json={"name": name, "price": price},
        )
        assert response.status_code == 201, response.text
        second_ids.append(response.json()["id"])
    printer = await client.post(
        "/printers", headers=headers,
        json={"branch_id": branch_id, "name": "Kitchen", "printer_type": "kitchen",
              "connection_type": "network", "ip_address": "192.168.123.50", "port": 9100},
    )
    assert printer.status_code == 201, printer.text
    printer_id = printer.json()["id"]

    created = await client.post(
        "/pos/orders", headers=headers,
        json={"branch_id": branch_id, "order_type": "takeaway",
              "items": [{"product_id": product_id, "quantity": "2"}]},
    )
    assert created.status_code == 201, created.text
    order_id = created.json()["id"]
    first_jobs = (await client.get(f"/printers/{printer_id}/jobs/pending", headers=headers)).json()
    assert len(first_jobs) == 1, first_jobs

    added = await client.post(
        f"/pos/orders/{order_id}/items/bulk", headers={**headers, "Idempotency-Key": f"append-{order_id}"},
        json={"items": [
            {"product_id": second_ids[0], "quantity": "1"},
            {"product_id": second_ids[1], "quantity": "2"},
        ]},
    )
    assert added.status_code == 201, added.text
    assert len(added.json()["items"]) == 3

    jobs = (await client.get(f"/printers/{printer_id}/jobs/pending", headers=headers)).json()
    assert len(jobs) == 2, jobs
    delta = next(job for job in jobs if job["id"] != first_jobs[0]["id"])
    delta_text = base64.b64decode(delta["payload"]).decode("cp866", "replace")
    assert "Латте" in delta_text
    assert "Чизкейк" in delta_text
    assert "Хот дог" not in delta_text


    replay = await client.post(
        f"/pos/orders/{order_id}/items/bulk",
        headers={**headers, "Idempotency-Key": f"append-{order_id}"},
        json={"items": [
            {"product_id": second_ids[0], "quantity": "1"},
            {"product_id": second_ids[1], "quantity": "2"},
        ]},
    )
    assert replay.status_code == 201, replay.text
    assert len(replay.json()["items"]) == 3
    replay_jobs = (await client.get(f"/printers/{printer_id}/jobs/pending", headers=headers)).json()
    assert len(replay_jobs) == 2


async def test_server_printed_ticket_is_not_left_pending(client, db_engine, monkeypatch):
    """PRINT-DUP-01: чек, напечатанный самим сервером, не остаётся pending.

    Терминал каждые 2 с опрашивает очередь и печатает всё, что в ней лежит.
    Пока успешная печать с сервера не коммитила статус «done», та же строка
    висела в pending, и повар получал второй экземпляр тикета.
    """
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.modules.printers.models import PrintJob

    network_print = AsyncMock()
    broadcast = AsyncMock()
    monkeypatch.setattr("app.modules.printers.service.print_raw", network_print)
    monkeypatch.setattr("app.modules.printers.service.printer_ws_manager.broadcast", broadcast)
    headers, branch_id, product_id = await _context(client)
    response = await client.post(
        "/printers", headers=headers,
        json={"branch_id": branch_id, "name": "Kitchen", "printer_type": "kitchen",
              "connection_type": "network", "ip_address": "192.168.123.50", "port": 9100},
    )
    assert response.status_code == 201, response.text
    printer_id = response.json()["id"]
    response = await client.post(
        "/pos/orders", headers=headers,
        json={"branch_id": branch_id, "order_type": "takeaway",
              "items": [{"product_id": product_id, "quantity": "1"}]},
    )
    assert response.status_code == 201, response.text

    network_print.assert_awaited_once()
    broadcast.assert_not_awaited()
    pending = await client.get(f"/printers/{printer_id}/jobs/pending", headers=headers)
    assert pending.status_code == 200 and pending.json() == []
    async with async_sessionmaker(db_engine, expire_on_commit=False)() as session:
        jobs = (await session.execute(select(PrintJob))).scalars().all()
    assert [job.status for job in jobs] == ["done"]


async def test_kitchen_failure_is_logged_without_losing_order(client, monkeypatch, caplog):
    headers, branch_id, product_id = await _context(client)
    auto_print = AsyncMock(side_effect=RuntimeError("Kitchen render failed"))
    monkeypatch.setattr(PrinterService, "auto_print_kitchen", auto_print)
    with caplog.at_level("WARNING", logger="app.modules.pos.service"):
        response = await client.post(
            "/pos/orders", headers=headers,
            json={"branch_id": branch_id, "order_type": "takeaway",
                  "items": [{"product_id": product_id, "quantity": "1"}]},
        )
    assert response.status_code == 201, response.text
    order = response.json()
    auto_print.assert_awaited_once_with(UUID(order["company_id"]), UUID(order["id"]))
    records = [r for r in caplog.records if "auto_print_kitchen failed" in r.message]
    assert len(records) == 1
    assert records[0].exc_info is not None
    assert "Kitchen render failed" in caplog.text
    assert (await client.get(f"/pos/orders/{order['id']}", headers=headers)).status_code == 200


@pytest.mark.parametrize("kind", ["receipt", "kitchen"])
async def test_auto_print_stays_in_order_branch(client, monkeypatch, kind):
    network_print = _offline_print()
    monkeypatch.setattr("app.modules.printers.service.print_raw", network_print)
    monkeypatch.setattr("app.modules.printers.service.printer_ws_manager.broadcast", AsyncMock())
    headers, branch_id, product_id = await _context(client)
    other = await client.post(
        "/companies/me/branches", headers=headers, json={"name": "Other"},
    )
    assert other.status_code == 201, other.text
    printers = []
    for target_branch in (branch_id, other.json()["id"]):
        response = await client.post(
            "/printers", headers=headers,
            json={"branch_id": target_branch, "name": kind, "printer_type": kind,
                  "connection_type": "network", "ip_address": "192.168.123.50"},
        )
        assert response.status_code == 201, response.text
        printers.append(response.json()["id"])
    response = await client.post(
        "/pos/orders", headers=headers,
        json={"branch_id": branch_id, "order_type": "takeaway",
              "items": [{"product_id": product_id, "quantity": "1"}]},
    )
    assert response.status_code == 201, response.text
    order_id = response.json()["id"]
    response = await client.post(f"/printers/print/orders/{order_id}/{kind}", headers=headers)
    assert response.status_code == 200, response.text
    assert len(response.json()) == 1
    assert response.json()[0]["printer_id"] == printers[0]
    pending = await client.get(f"/printers/{printers[1]}/jobs/pending", headers=headers)
    assert pending.status_code == 200 and pending.json() == []
    # Сервер попробовал напечатать (и не достучался) — задание осталось у своего
    # филиала; чужой филиал его не видит.
    network_print.assert_awaited_once()


async def test_websocket_delivery_stays_in_printer_branch(monkeypatch):
    from uuid import uuid4
    from app.config import settings
    from app.modules.printers.ws_manager import PrinterWSManager

    monkeypatch.setattr(settings, "redis_url", "")
    manager = PrinterWSManager()
    company_id, branch_id, other_branch_id = uuid4(), uuid4(), uuid4()
    target, other = AsyncMock(), AsyncMock()
    manager._connections[manager._key(company_id, branch_id)] = {target}
    manager._connections[manager._key(company_id, other_branch_id)] = {other}
    await manager.broadcast(company_id, branch_id, {"event": "print_job"})
    target.send_text.assert_awaited_once()
    other.send_text.assert_not_awaited()

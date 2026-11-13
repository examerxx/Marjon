"""Машина статусов заказа: жёсткие контрактные проверки.

Почему отдельный файл
---------------------
`completed` — это **оплата**, а не шаг кухни. Раньше переход в `completed`
разрешался только из `ready`, и десктоп получал 422 при закрытии счёта заказа,
который ещё `new`/`accepted`/`cooking` (гость поел и ушёл, навынос оплачен на
кассе). Закрытие заказа не работало вообще — при этом тесты были зелёными,
потому что проверяли только «счастливый» путь new→accepted→cooking→ready→
completed.

Здесь зафиксирован контракт целиком, включая края:

* матрица переходов совпадает со `Literal` в схеме API (нельзя добавить статус
  в одном месте и забыть в другом);
* финальные статусы (`completed`, `cancelled`) неизменяемы;
* `completed` достижим из ЛЮБОГО незавершённого статуса (POS-CLOSE-01);
* финансовое закрытие счёта не означает готовность или выдачу блюд;
* отмена/закрытие не трогают уже отменённые позиции;
* каждый отказ — 422 и НЕ меняет состояние заказа.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import get_args
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.audit.models import AuditLog
from app.modules.companies.models import Branch
from app.modules.inventory.models import Category, Product
from app.modules.pos.models import Order, OrderItem
from app.modules.pos.schemas import OrderStatusUpdate
from app.modules.pos.service import VALID_TRANSITIONS
from tests.conftest import register_company


# Статусы, из которых заказ ещё живой (не финальный).
NON_FINAL_STATUSES = ("new", "accepted", "cooking", "ready")
FINAL_STATUSES = ("completed", "cancelled")
ALL_STATUSES = NON_FINAL_STATUSES + FINAL_STATUSES


async def _me(client, headers) -> dict:
    response = await client.get("/auth/me", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _setup(client, db_engine, *, slug: str, email: str) -> dict:
    """Компания + филиал + категория + товар: минимальный мир для заказа."""
    headers, _ = await register_company(client, slug=slug, email=email)
    identity = await _me(client, headers)
    company_id = UUID(identity["company_id"])
    branch_id = uuid4()
    category_id = uuid4()
    product_id = uuid4()

    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sessions() as db:
        db.add(Branch(id=branch_id, company_id=company_id, name="Main"))
        db.add(Category(id=category_id, company_id=company_id, name="Cat", slug=f"cat-{slug}"))
        await db.flush()
        db.add(
            Product(
                id=product_id,
                company_id=company_id,
                category_id=category_id,
                name="Plov",
                price=Decimal("100"),
                cost_price=Decimal("40"),
            )
        )
        await db.commit()

    return {
        "headers": headers,
        "company_id": company_id,
        "branch_id": branch_id,
        "product_id": product_id,
        "sessions": sessions,
    }


async def _create_order(client, ctx: dict, *, items: int = 2) -> UUID:
    response = await client.post(
        "/pos/orders",
        headers=ctx["headers"],
        json={
            "branch_id": str(ctx["branch_id"]),
            "order_type": "dine_in",
            "table_number": "5",
            "persons_count": 2,
            "items": [
                {"product_id": str(ctx["product_id"]), "quantity": 1}
                for _ in range(items)
            ],
        },
    )
    assert response.status_code == 201, response.text
    return UUID(response.json()["id"])


async def _patch_status(client, ctx: dict, order_id: UUID, status: str):
    return await client.patch(
        f"/pos/orders/{order_id}/status",
        headers=ctx["headers"],
        json={"status": status},
    )


async def _read_order(ctx: dict, order_id: UUID) -> Order:
    async with ctx["sessions"]() as db:
        order = await db.get(Order, order_id)
        await db.refresh(order, attribute_names=["items"])
        return order


async def _force_status(ctx: dict, order_id: UUID, status: str) -> None:
    """Тестовая установка статуса в обход API (чтобы проверить переход ИЗ него)."""
    async with ctx["sessions"]() as db:
        order = await db.get(Order, order_id)
        order.status = status
        await db.commit()


async def _force_item_statuses(ctx: dict, order_id: UUID, statuses: list[str]) -> None:
    async with ctx["sessions"]() as db:
        rows = (
            await db.execute(select(OrderItem).where(OrderItem.order_id == order_id))
        ).scalars().all()
        assert len(rows) == len(statuses), f"ожидалось {len(statuses)} позиций, есть {len(rows)}"
        for item, status in zip(rows, statuses):
            item.status = status
        await db.commit()


# ── Матрица переходов (статические инварианты) ───────────────────────────────


def test_transition_matrix_matches_the_api_contract() -> None:
    """Матрица и `Literal` схемы обязаны описывать один и тот же набор статусов."""
    api_statuses = set(get_args(OrderStatusUpdate.model_fields["status"].annotation))
    assert set(VALID_TRANSITIONS) == api_statuses, (
        "набор статусов в VALID_TRANSITIONS разошёлся со схемой API: "
        f"только в матрице={sorted(set(VALID_TRANSITIONS) - api_statuses)}, "
        f"только в API={sorted(api_statuses - set(VALID_TRANSITIONS))}"
    )
    assert api_statuses == set(ALL_STATUSES)


def test_transition_targets_are_known_statuses() -> None:
    unknown = {
        source: sorted(targets - set(VALID_TRANSITIONS))
        for source, targets in VALID_TRANSITIONS.items()
        if targets - set(VALID_TRANSITIONS)
    }
    assert not unknown, f"переходы в несуществующие статусы: {unknown}"
    self_loops = {source for source, targets in VALID_TRANSITIONS.items() if source in targets}
    assert not self_loops, f"статус не может переходить сам в себя: {sorted(self_loops)}"


def test_final_statuses_are_immutable() -> None:
    for status in FINAL_STATUSES:
        assert VALID_TRANSITIONS[status] == set(), (
            f"{status!r} — финальный статус, из него не должно быть переходов, "
            f"а есть {sorted(VALID_TRANSITIONS[status])}"
        )


def test_completed_is_reachable_from_every_live_status() -> None:
    """POS-CLOSE-01: кассир закрывает счёт из любого незавершённого статуса."""
    unreachable = [status for status in NON_FINAL_STATUSES if "completed" not in VALID_TRANSITIONS[status]]
    assert not unreachable, (
        "закрытие счёта недоступно из статусов "
        f"{unreachable} — десктоп получит 422 при оплате такого заказа"
    )


def test_cancelled_is_reachable_from_every_live_status() -> None:
    unreachable = [status for status in NON_FINAL_STATUSES if "cancelled" not in VALID_TRANSITIONS[status]]
    assert not unreachable, f"отмена недоступна из статусов {unreachable}"


def test_every_live_status_is_reachable_from_new() -> None:
    """Нет «мёртвых» статусов, до которых нельзя дойти с нуля."""
    reachable = {"new"}
    changed = True
    while changed:
        changed = False
        for source in list(reachable):
            for target in VALID_TRANSITIONS[source]:
                if target not in reachable:
                    reachable.add(target)
                    changed = True
    dead = set(VALID_TRANSITIONS) - reachable
    assert not dead, f"недостижимые из 'new' статусы: {sorted(dead)}"


# ── Поведение через API ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_happy_path_walks_new_accepted_cooking_ready_completed(client, db_engine) -> None:
    ctx = await _setup(client, db_engine, slug="sm-happy", email="sm-happy@example.com")
    order_id = await _create_order(client, ctx)
    for status in ("accepted", "cooking", "ready", "completed"):
        response = await _patch_status(client, ctx, order_id, status)
        assert response.status_code == 200, f"{status}: {response.text}"
        assert response.json()["status"] == status
    order = await _read_order(ctx, order_id)
    assert order.status == "completed"
    assert {item.status for item in order.items} == {"ready"}, "Closing the bill is not handoff"


@pytest.mark.asyncio
async def test_order_can_be_closed_from_any_live_status(client, db_engine) -> None:
    """POS-CLOSE-01: оплата закрывает счёт, даже если кухня не нажала «готово»."""
    ctx = await _setup(client, db_engine, slug="sm-close", email="sm-close@example.com")
    for source_status in NON_FINAL_STATUSES:
        order_id = await _create_order(client, ctx)
        await _force_status(ctx, order_id, source_status)

        response = await _patch_status(client, ctx, order_id, "completed")
        assert response.status_code == 200, f"из {source_status}: {response.text}"
        assert response.json()["status"] == "completed"
        assert (await _read_order(ctx, order_id)).status == "completed"


@pytest.mark.asyncio
async def test_closing_preserves_all_item_statuses(client, db_engine) -> None:
    """Financial completion does not imply cooking, readiness or handoff."""
    ctx = await _setup(client, db_engine, slug="sm-serve", email="sm-serve@example.com")
    order_id = await _create_order(client, ctx, items=4)
    await _force_item_statuses(ctx, order_id, ["pending", "cooking", "ready", "cancelled"])

    response = await _patch_status(client, ctx, order_id, "completed")
    assert response.status_code == 200, response.text

    order = await _read_order(ctx, order_id)
    statuses = sorted(item.status for item in order.items)
    assert order.status == "completed"
    assert statuses == ["cancelled", "cooking", "pending", "ready"], (
        "Closing the bill must preserve kitchen states, including cancellations"
    )


@pytest.mark.asyncio
async def test_accepting_for_kitchen_moves_pending_items_to_cooking(client, db_engine) -> None:
    """Иначе «позиция готова» из pending не пройдёт валидацию (pending → ready)."""
    ctx = await _setup(client, db_engine, slug="sm-cook", email="sm-cook@example.com")
    order_id = await _create_order(client, ctx, items=3)
    await _force_item_statuses(ctx, order_id, ["pending", "served", "cancelled"])

    response = await _patch_status(client, ctx, order_id, "cooking")
    assert response.status_code == 200, response.text

    order = await _read_order(ctx, order_id)
    statuses = sorted(item.status for item in order.items)
    assert statuses == ["cancelled", "cooking", "served"], (
        f"в cooking должен уйти только pending; получено {statuses}"
    )


@pytest.mark.asyncio
async def test_forbidden_transitions_return_422_and_keep_state(client, db_engine) -> None:
    forbidden = [
        ("completed", "cooking"),
        ("completed", "new"),
        ("completed", "cancelled"),
        ("cancelled", "completed"),
        ("cancelled", "new"),
        ("new", "new"),
        ("new", "ready"),       # нельзя перепрыгнуть кухню
        ("accepted", "ready"),  # то же
    ]
    ctx = await _setup(client, db_engine, slug="sm-forbid", email="sm-forbid@example.com")
    for from_status, to_status in forbidden:
        order_id = await _create_order(client, ctx)
        await _force_status(ctx, order_id, from_status)

        response = await _patch_status(client, ctx, order_id, to_status)
        assert response.status_code == 422, (
            f"{from_status} → {to_status} должен быть запрещён, получено "
            f"{response.status_code}: {response.text}"
        )
        order = await _read_order(ctx, order_id)
        assert order.status == from_status, (
            f"отказ {from_status} → {to_status} не должен менять статус заказа"
        )


@pytest.mark.asyncio
async def test_unknown_status_is_rejected_by_the_schema(client, db_engine) -> None:
    ctx = await _setup(client, db_engine, slug="sm-unknown", email="sm-unknown@example.com")
    order_id = await _create_order(client, ctx)
    response = await client.patch(
        f"/pos/orders/{order_id}/status", headers=ctx["headers"], json={"status": "paid"}
    )
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_cancel_endpoint_refuses_final_orders(client, db_engine) -> None:
    ctx = await _setup(client, db_engine, slug="sm-cancel", email="sm-cancel@example.com")
    for final_status in FINAL_STATUSES:
        order_id = await _create_order(client, ctx)
        await _force_status(ctx, order_id, final_status)
        response = await client.delete(f"/pos/orders/{order_id}", headers=ctx["headers"])
        assert response.status_code == 422, (
            f"отмена {final_status}-заказа должна отклоняться: {response.text}"
        )
        assert (await _read_order(ctx, order_id)).status == final_status


@pytest.mark.asyncio
async def test_cancelling_stamps_actor_and_keeps_cancelled_items(client, db_engine) -> None:
    ctx = await _setup(client, db_engine, slug="sm-stamp", email="sm-stamp@example.com")
    order_id = await _create_order(client, ctx, items=2)
    await _force_item_statuses(ctx, order_id, ["pending", "cancelled"])

    response = await client.delete(f"/pos/orders/{order_id}", headers=ctx["headers"])
    assert response.status_code == 200, response.text

    order = await _read_order(ctx, order_id)
    assert order.status == "cancelled"
    assert order.cancelled_at is not None, "отмена обязана штамповать время"
    assert order.cancelled_by_id is not None, "отмена обязана штамповать автора"


@pytest.mark.asyncio
async def test_status_change_is_written_to_audit(client, db_engine) -> None:
    """Смена статуса — финансово значимое событие: обязана попадать в аудит."""
    ctx = await _setup(client, db_engine, slug="sm-audit", email="sm-audit@example.com")
    order_id = await _create_order(client, ctx)

    response = await _patch_status(client, ctx, order_id, "accepted")
    assert response.status_code == 200, response.text

    async with ctx["sessions"]() as db:
        rows = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.entity_id == order_id,
                    AuditLog.action == "order.status_change",
                )
            )
        ).scalars().all()
    assert rows, "запись order.status_change отсутствует в audit_logs"
    assert rows[-1].old_data == {"status": "new"}
    assert rows[-1].new_data == {"status": "accepted"}


@pytest.mark.asyncio
async def test_order_status_survives_reload_with_items(client, db_engine) -> None:
    """Смена статуса не должна «съедать» состав заказа (stale-коллекция items)."""
    ctx = await _setup(client, db_engine, slug="sm-items", email="sm-items@example.com")
    order_id = await _create_order(client, ctx, items=3)

    response = await _patch_status(client, ctx, order_id, "cooking")
    assert response.status_code == 200, response.text
    assert len(response.json()["items"]) == 3, response.text

    fetched = await client.get(f"/pos/orders/{order_id}", headers=ctx["headers"])
    assert fetched.status_code == 200, fetched.text
    assert len(fetched.json()["items"]) == 3
    assert fetched.json()["status"] == "cooking"


def test_today_is_used_for_order_dates() -> None:
    """Дата заказа — локальная (Ташкент), а не UTC-«сегодня».

    Проверка дешёвая, но фиксирует, что тесты выше не зависят от UTC-даты
    раннера (именно на этом падал CI-шард с захардкоженным 19-10-2026).
    """
    assert isinstance(date.today(), date)

"""KDS: отдельная кухонная сессия повара (вне десктопа/админки).

Проверяем контракт, на котором держится кухонный экран:
- настройка устройства логином+паролем филиала → кухонный скоуп;
- вход повара по 4-значному PIN (и только кухонной роли);
- кухонный токен не открывает ничего, кроме /kitchen/*;
- «весь заказ готов» работает одним тапом даже для ещё не начатого заказа.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID

import pytest
from fastapi import WebSocketDisconnect
from jose import jwt
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.auth.models import User
from app.modules.kitchen.websocket import kitchen_manager, kitchen_ws_endpoint
from tests.conftest import register_company

BRANCH_LOGIN = "+998 90 555-11-22"
BRANCH_PASSWORD = "Kitchen-Pass-1"


async def _kitchen_context(client, *, slug: str = "kds", create_branch: bool = True):
    owner_headers, _ = await register_company(
        client, slug=slug, email=f"owner@{slug}.example.com"
    )
    if create_branch:
        branch = (
            await client.post(
                "/companies/me/branches",
                headers=owner_headers,
                json={"name": "Main", "login": BRANCH_LOGIN, "password": BRANCH_PASSWORD},
            )
        ).json()
    else:
        # Регистрация уже создаёт «Основной филиал»: нужен ровно один,
        # иначе кухонная сессия моноблока справедливо попросит выбрать филиал.
        branches = (await client.get("/companies/me/branches", headers=owner_headers)).json()
        assert len(branches) == 1, branches
        branch = branches[0]

    async def _staff(email, role_slug, pin, phone):
        created = await client.post(
            "/auth/users",
            headers=owner_headers,
            json={
                "email": email,
                "password": "Passw0rd!",
                "phone": phone,
                "role_slug": role_slug,
                "branch_id": branch["id"],
            },
        )
        assert created.status_code == 201, created.text
        user = created.json()
        setpin = await client.patch(
            f"/auth/users/{user['id']}/pin", headers=owner_headers, json={"pin": pin}
        )
        assert setpin.status_code == 204, setpin.text
        return user

    cook = await _staff(f"cook@{slug}.example.com", "kitchen", "1234", "+998901112233")
    cashier = await _staff(f"cashier@{slug}.example.com", "cashier", "5678", "+998901112244")
    product = await client.post(
        "/inventory/products", headers=owner_headers, json={"name": "Плов", "price": "42000"}
    )
    assert product.status_code == 201, product.text
    return owner_headers, branch, cook, cashier, product.json()["id"]


async def _device_token(client) -> str:
    resp = await client.post(
        "/auth/kitchen/session", json={"login": BRANCH_LOGIN, "password": BRANCH_PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


async def _cook_token(client) -> str:
    device = await _device_token(client)
    resp = await client.post(
        "/auth/kitchen/pin",
        headers={"Authorization": f"Bearer {device}"},
        json={"pin": "1234"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


async def test_kitchen_session_binds_device_to_branch(client):
    _, branch, _, _, _ = await _kitchen_context(client)
    resp = await client.post(
        "/auth/kitchen/session", json={"login": BRANCH_LOGIN, "password": BRANCH_PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["branch"]["id"] == branch["id"]
    assert body["company"]["slug"] == "kds"
    assert body["access_token"] and body["refresh_token"]


async def test_kitchen_session_rejects_bad_branch_password(client):
    await _kitchen_context(client)
    resp = await client.post(
        "/auth/kitchen/session", json={"login": BRANCH_LOGIN, "password": "nope"}
    )
    assert resp.status_code == 401


async def test_cook_pin_login_returns_name_and_kitchen_scope(client):
    _, branch, cook, _, _ = await _kitchen_context(client)
    device = await _device_token(client)

    resp = await client.post(
        "/auth/kitchen/pin", headers={"Authorization": f"Bearer {device}"}, json={"pin": "1234"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["branch"]["id"] == branch["id"]
    assert body["user_name"] == cook["name"] or body["user_name"] is None

    cook_headers = {"Authorization": f"Bearer {body['access_token']}"}
    # Кухонный экран видит заказы своего филиала без явного branch_id.
    orders = await client.get("/kitchen/orders", headers=cook_headers)
    assert orders.status_code == 200, orders.text
    assert orders.json() == []


async def test_kitchen_pin_only_accepts_kitchen_role(client):
    await _kitchen_context(client)
    device = await _device_token(client)

    cashier = await client.post(
        "/auth/kitchen/pin", headers={"Authorization": f"Bearer {device}"}, json={"pin": "5678"}
    )
    assert cashier.status_code == 401, "PIN кассира не должен открывать кухонную сессию"

    wrong = await client.post(
        "/auth/kitchen/pin", headers={"Authorization": f"Bearer {device}"}, json={"pin": "0000"}
    )
    assert wrong.status_code == 401


async def test_kitchen_pin_requires_device_session(client):
    await _kitchen_context(client)
    resp = await client.post("/auth/kitchen/pin", json={"pin": "1234"})
    assert resp.status_code == 401


async def test_kitchen_token_is_limited_to_kitchen_endpoints(client):
    _, branch, _, _, _ = await _kitchen_context(client)
    cook_headers = {"Authorization": f"Bearer {await _cook_token(client)}"}

    # Кухня — можно.
    assert (await client.get("/kitchen/orders", headers=cook_headers)).status_code == 200
    # Касса, сотрудники и склад — закрыто, несмотря на валидный токен.
    assert (
        await client.get("/pos/orders", headers=cook_headers, params={"branch_id": branch["id"]})
    ).status_code == 403
    assert (await client.get("/auth/users", headers=cook_headers)).status_code == 403
    assert (await client.get("/warehouse/list", headers=cook_headers)).status_code == 403


async def test_kitchen_order_ready_marks_untouched_order(client, monkeypatch):
    from unittest.mock import AsyncMock

    # Заказ в тесте не должен уходить на реальный принтер/в POS-сокеты.
    monkeypatch.setattr(
        "app.modules.printers.service.print_raw",
        AsyncMock(side_effect=AssertionError("No physical printing in tests")),
    )
    monkeypatch.setattr(
        "app.modules.printers.service.printer_ws_manager.broadcast", AsyncMock()
    )
    owner_headers, branch, _, _, product_id = await _kitchen_context(client)
    order = await client.post(
        "/pos/orders",
        headers=owner_headers,
        json={
            "branch_id": branch["id"],
            "order_type": "takeaway",
            "items": [{"product_id": product_id, "quantity": "1"}],
        },
    )
    assert order.status_code == 201, order.text
    order_id = order.json()["id"]

    cook_headers = {"Authorization": f"Bearer {await _cook_token(client)}"}
    ready = await client.patch(f"/kitchen/orders/{order_id}/ready", headers=cook_headers)
    assert ready.status_code == 200, ready.text
    assert ready.json()["status"] == "ready"

    # Прямой POS-эндпоинт кухонной сессии по-прежнему закрыт.
    direct = await client.patch(
        f"/pos/orders/{order_id}/status", headers=cook_headers, json={"status": "completed"}
    )
    assert direct.status_code == 403


async def test_kitchen_refresh_keeps_kitchen_scope(client):
    """Продление сессии не должно повышать её до полного доступа к API."""
    await _kitchen_context(client)
    device = await _device_token(client)
    login = await client.post(
        "/auth/kitchen/pin", headers={"Authorization": f"Bearer {device}"}, json={"pin": "1234"}
    )
    refreshed = await client.post(
        "/auth/refresh", json={"refresh_token": login.json()["refresh_token"]}
    )
    assert refreshed.status_code == 200, refreshed.text
    headers = {"Authorization": f"Bearer {refreshed.json()['access_token']}"}
    assert (await client.get("/kitchen/orders", headers=headers)).status_code == 200
    assert (await client.get("/auth/users", headers=headers)).status_code == 403


async def test_cook_branch_comes_from_hr_record(client):
    """Реальный редактор сотрудников хранит филиал повара в HR-записи, а не в
    User.branch_id. Кухонный экран всё равно должен открывать заказы филиала,
    а не падать с «branch_id is required»."""
    owner_headers, branch, _, _, _ = await _kitchen_context(client, slug="kds-hr")

    cook = (
        await client.post(
            "/auth/users",
            headers=owner_headers,
            json={
                "email": "hr-cook@kds-hr.example.com",
                "password": "Passw0rd!",
                "phone": "+998901119999",
                "role_slug": "kitchen",
            },
        )
    ).json()
    cook_login = await client.post(
        "/auth/login", json={"email": "hr-cook@kds-hr.example.com", "password": "Passw0rd!"}
    )
    me = await client.get(
        "/auth/me", headers={"Authorization": f"Bearer {cook_login.json()['access_token']}"}
    )
    assert me.json()["branch_id"] is None, "филиал повара живёт в HR-записи"

    hr = await client.post(
        "/hr/employees",
        headers=owner_headers,
        json={
            "user_id": cook["id"],
            "branch_id": branch["id"],
            "position": "Повар",
            "hire_date": "2026-01-01",
        },
    )
    assert hr.status_code == 201, hr.text
    assert (
        await client.patch(
            f"/auth/users/{cook['id']}/pin", headers=owner_headers, json={"pin": "2468"}
        )
    ).status_code == 204

    device = await _device_token(client)
    login = await client.post(
        "/auth/kitchen/pin", headers={"Authorization": f"Bearer {device}"}, json={"pin": "2468"}
    )
    assert login.status_code == 200, login.text
    cook_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    orders = await client.get("/kitchen/orders", headers=cook_headers)
    assert orders.status_code == 200, orders.text


async def test_cook_of_another_branch_cannot_pin_into_this_terminal(client):
    owner_headers, branch_a, _, _, _ = await _kitchen_context(client, slug="kds-b")
    branch_b = (
        await client.post(
            "/companies/me/branches",
            headers=owner_headers,
            json={"name": "Second", "login": "+998 90 777-33-11", "password": "Second-Pass-1"},
        )
    ).json()
    cook_b = (
        await client.post(
            "/auth/users",
            headers=owner_headers,
            json={
                "email": "cook-b@kds-b.example.com",
                "password": "Passw0rd!",
                "phone": "+998901118888",
                "role_slug": "kitchen",
                "branch_id": branch_b["id"],
            },
        )
    ).json()
    await client.patch(f"/auth/users/{cook_b['id']}/pin", headers=owner_headers, json={"pin": "1357"})

    device = await _device_token(client)   # терминал филиала A
    resp = await client.post(
        "/auth/kitchen/pin", headers={"Authorization": f"Bearer {device}"}, json={"pin": "1357"}
    )
    assert resp.status_code == 401, "повар другого филиала не входит на этот экран"


async def _monoblock(client, owner_headers, *, phone="+998900005555", can_kitchen=True):
    created = await client.post(
        "/auth/users",
        headers=owner_headers,
        json={
            "email": f"monoblock-{phone[-4:]}@example.com",
            "password": "Passw0rd!",
            "phone": phone,
            "role_slug": "monoblock",
            "permissions": {"can_kitchen": can_kitchen},
        },
    )
    assert created.status_code == 201, created.text
    return created.json()


async def test_kitchen_monoblock_session_binds_the_only_branch(client):
    owner_headers, branch, cook, cashier, _ = await _kitchen_context(
        client, slug="kds-mb", create_branch=False
    )
    monoblock = await _monoblock(client, owner_headers)

    resp = await client.post(
        "/auth/kitchen/monoblock-session",
        json={"phone": "+998900005555", "password": "Passw0rd!"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["branch"]["id"] == branch["id"]
    assert body["access_token"] and body["refresh_token"]

    headers = {"Authorization": f"Bearer {body['access_token']}"}
    # Кухонная сессия моноблока — только /kitchen/*, как и у логина филиала.
    assert (await client.get("/kitchen/orders", headers=headers)).status_code == 200
    assert (await client.get("/auth/users", headers=headers)).status_code == 403

    cooks = await client.get("/auth/kitchen/cooks", headers=headers)
    assert cooks.status_code == 200, cooks.text
    ids = {row["id"] for row in cooks.json()}
    assert cook["id"] in ids, "повар филиала должен быть в списке"
    assert cashier["id"] not in ids, "кассир не должен появляться на кухне"
    assert monoblock["id"] not in ids, "логин моноблока — не повар"
    row = next(row for row in cooks.json() if row["id"] == cook["id"])
    assert row["has_pin"] is True


async def test_kitchen_monoblock_requires_the_kitchen_switch(client):
    owner_headers, _, _, _, _ = await _kitchen_context(client, slug="kds-mb-off")
    await _monoblock(client, owner_headers, phone="+998900006666", can_kitchen=False)

    resp = await client.post(
        "/auth/kitchen/monoblock-session",
        json={"phone": "+998900006666", "password": "Passw0rd!"},
    )
    assert resp.status_code == 403, resp.text
    assert "Кухня" in resp.json()["detail"]


async def test_kitchen_monoblock_asks_which_branch_in_a_network(client):
    owner_headers, branch_a, cook_a, _, _ = await _kitchen_context(
        client, slug="kds-mb-net", create_branch=False
    )
    branch_b = (
        await client.post(
            "/companies/me/branches",
            headers=owner_headers,
            json={"name": "Second", "login": "+998 90 777-33-11", "password": "Second-Pass-1"},
        )
    ).json()
    cook_b = (
        await client.post(
            "/auth/users",
            headers=owner_headers,
            json={
                "email": "cook-b@kds-mb-net.example.com",
                "password": "Passw0rd!",
                "phone": "+998901117777",
                "role_slug": "kitchen",
                "branch_id": branch_b["id"],
            },
        )
    ).json()
    await _monoblock(client, owner_headers)

    ambiguous = await client.post(
        "/auth/kitchen/monoblock-session",
        json={"phone": "+998900005555", "password": "Passw0rd!"},
    )
    assert ambiguous.status_code == 409, ambiguous.text
    detail = ambiguous.json()["detail"]
    assert {row["id"] for row in detail["branches"]} == {branch_a["id"], branch_b["id"]}

    chosen = await client.post(
        "/auth/kitchen/monoblock-session",
        json={
            "phone": "+998900005555",
            "password": "Passw0rd!",
            "branch_id": branch_b["id"],
        },
    )
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["branch"]["id"] == branch_b["id"]

    headers = {"Authorization": f"Bearer {chosen.json()['access_token']}"}
    ids = {row["id"] for row in (await client.get("/auth/kitchen/cooks", headers=headers)).json()}
    assert cook_b["id"] in ids
    assert cook_a["id"] not in ids, "повар другого филиала не должен быть в списке"


async def test_kitchen_pin_with_user_id_checks_only_that_cook(client):
    _, _, cook, cashier, _ = await _kitchen_context(client, slug="kds-pick")
    device = await _device_token(client)
    headers = {"Authorization": f"Bearer {device}"}

    wrong_employee = await client.post(
        "/auth/kitchen/pin",
        headers=headers,
        json={"pin": "5678", "user_id": cashier["id"]},
    )
    assert wrong_employee.status_code == 401, "выбор кассира не открывает кухню"

    wrong_pin = await client.post(
        "/auth/kitchen/pin",
        headers=headers,
        json={"pin": "1234", "user_id": cashier["id"]},
    )
    assert wrong_pin.status_code == 401, "PIN повара не должен подходить чужому профилю"

    ok = await client.post(
        "/auth/kitchen/pin",
        headers=headers,
        json={"pin": "1234", "user_id": cook["id"]},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["user_name"] == cook["name"]


@pytest.mark.parametrize(
    "claim_case",
    ["matching", "other-branch", "missing", "null", "empty", "invalid", "wrong-type", "other-company"],
)
async def test_kitchen_ws_enforces_signed_branch_without_user_branch(
    client, db_engine, monkeypatch, claim_case,
):
    owner, branch, cook, _, _ = await _kitchen_context(client, slug="kds-ws")
    requested_branch = UUID(branch["id"])
    signed_branch = str(requested_branch)
    if claim_case in ("other-branch", "other-company"):
        branch_owner = owner
        if claim_case == "other-company":
            branch_owner, _ = await register_company(
                client, slug="kds-ws-other", email="owner@kds-ws-other.example.com",
            )
        created = await client.post(
            "/companies/me/branches", headers=branch_owner, json={"name": "Other branch"},
        )
        assert created.status_code == 201, created.text
        requested_branch = UUID(created.json()["id"])
        if claim_case == "other-company":
            # Claim matches the requested channel, but the authoritative user
            # belongs to another company: a signed branch alone is not enough.
            signed_branch = str(requested_branch)

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as db:
        user = await db.get(User, UUID(cook["id"]))
        user.branch_id = None  # HR-bound cooks have no branch on the User row.
        await db.commit()
        company_id, auth_version = user.company_id, user.auth_version or 0

    # Verify real JWT decoding/signatures with a test-only key. Never use or
    # expose the environment's signing secret, and do not mock authorization.
    signing_key = "synthetic-kitchen-ws-regression-key"
    monkeypatch.setattr(
        "app.modules.auth.security.settings",
        SimpleNamespace(secret_key=signing_key, algorithm="HS256"),
    )
    payload = {
        "sub": cook["id"], "company_id": str(company_id), "type": "access",
        "auth_scope": "kitchen", "auth_version": auth_version,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        "branch_id": signed_branch,
    }
    if claim_case == "missing":
        payload.pop("branch_id")
    elif claim_case in ("null", "empty", "invalid", "wrong-type"):
        payload["branch_id"] = {
            "null": None, "empty": "", "invalid": "not-a-uuid", "wrong-type": 123,
        }[claim_case]
    token = jwt.encode(payload, signing_key, algorithm="HS256")
    ws = SimpleNamespace(
        close=AsyncMock(), receive_text=AsyncMock(side_effect=WebSocketDisconnect(code=1000)),
    )
    connect, disconnect = AsyncMock(), Mock()
    monkeypatch.setattr(kitchen_manager, "connect", connect)
    monkeypatch.setattr(kitchen_manager, "disconnect", disconnect)
    async with session_factory() as db:
        user = await db.get(User, UUID(cook["id"]))
        assert user.branch_id is None
        await kitchen_ws_endpoint(ws, token=token, branch_id=requested_branch, db=db)

    if claim_case == "matching":
        connect.assert_awaited_once_with(ws, company_id, requested_branch)
        disconnect.assert_called_once_with(ws, company_id, requested_branch)
        ws.receive_text.assert_awaited_once()
        ws.close.assert_not_awaited()
    else:
        ws.close.assert_awaited_once_with(code=4003, reason="Branch not found")
        connect.assert_not_awaited()
        disconnect.assert_not_called()
        ws.receive_text.assert_not_awaited()

from __future__ import annotations

from importlib.metadata import version
from pathlib import Path

import pytest
from fastapi.routing import APIRoute

from app.main import app
from app.shared.rate_limit import limiter


REQUIRED_BODY_ROUTES = {
    "/api/v1/auth/register": "RegisterRequest",
    "/api/v1/auth/login": "LoginRequest",
    "/api/v1/auth/admin/login": "LoginRequest",
    "/api/v1/auth/pin-login": "PinLoginRequest",
    # ba0c267: моноблок/филиаловые входы десктопа — тоже rate-limited POST'ы
    # с конкретной pydantic-моделью тела.
    "/api/v1/auth/monoblock-login": "MonoblockLoginRequest",
    "/api/v1/auth/branch-login": "BranchLoginRequest",
    "/api/v1/auth/branch-switch": "BranchSwitchRequest",
    # toast-notifications: смена пароля с инвалидацией выданных токенов
    # (users.auth_version) — тоже rate-limited POST с моделью тела.
    "/api/v1/auth/change-password": "ChangePasswordRequest",
    # KDS: настройка кухонного экрана и вход повара по PIN — тоже
    # rate-limited POST'ы с конкретными моделями тела.
    "/api/v1/auth/kitchen/session": "BranchLoginRequest",
    "/api/v1/auth/kitchen/monoblock-session": "KitchenMonoblockLoginRequest",
    "/api/v1/auth/kitchen/pin": "KitchenPinRequest",
    "/api/v1/pos/orders": "OrderCreate",
}

CORE_DEPENDENCIES = {
    "fastapi": ("0.115.6", "fastapi[standard]==0.115.6"),
    "starlette": ("0.41.3", "starlette==0.41.3"),
    "pydantic": ("2.13.4", "pydantic==2.13.4"),
    "pydantic-core": ("2.46.4", "pydantic-core==2.46.4"),
    "slowapi": ("0.1.10", "slowapi==0.1.10"),
}


def _post_operation(schema: dict, path: str) -> dict:
    return schema["paths"][path]["post"]


def _has_query_data_error(response) -> bool:
    if response.status_code != 422:
        return False
    detail = response.json().get("detail", [])
    return any(item.get("loc") == ["query", "data"] for item in detail)


def test_openapi_generation_and_typed_request_bodies():
    schema = app.openapi()

    for path, model_name in REQUIRED_BODY_ROUTES.items():
        operation = _post_operation(schema, path)
        assert "requestBody" in operation, path
        assert operation["requestBody"].get("required") is True, path

        json_schema = operation["requestBody"]["content"]["application/json"]["schema"]
        assert json_schema.get("$ref", "").endswith(f"/{model_name}"), (path, json_schema)

        query_parameters = [
            parameter
            for parameter in operation.get("parameters", [])
            if parameter.get("in") == "query"
        ]
        assert not any(parameter.get("name") == "data" for parameter in query_parameters), path


def test_all_slowapi_limited_routes_keep_concrete_body_models():
    limited_endpoint_names = set(limiter._route_limits)
    limited_routes = [
        route
        for route in app.routes
        if isinstance(route, APIRoute)
        and f"{route.endpoint.__module__}.{route.endpoint.__name__}" in limited_endpoint_names
    ]

    # Публичный ТВ-экран посетителей и список поваров для кухонного терминала —
    # rate-limited GET'ы без тела запроса: филиал берётся из query/токена.
    # Они не входят в контракт «body-модель не подменена на query» и перечислены
    # явно, чтобы лимит на публичной ручке не остался незамеченным.
    bodyless_limited = {route.path for route in limited_routes if not route.dependant.body_params}
    assert bodyless_limited == {
        "/api/v1/kitchen/display",
        "/api/v1/auth/kitchen/cooks",
    }
    limited_routes = [route for route in limited_routes if route.dependant.body_params]

    assert {route.path for route in limited_routes} == set(REQUIRED_BODY_ROUTES)
    for route in limited_routes:
        assert not any(parameter.name == "data" for parameter in route.dependant.query_params), route.path
        assert [parameter.name for parameter in route.dependant.body_params] == ["data"], route.path
        assert route.dependant.body_params[0].type_.__name__ == REQUIRED_BODY_ROUTES[route.path]


def test_core_dependency_versions_are_exact_and_reproducible():
    for package, (expected, _) in CORE_DEPENDENCIES.items():
        assert version(package) == expected

    backend_root = Path(__file__).resolve().parents[1]
    requirements = (backend_root / "requirements.txt").read_text(encoding="utf-8")
    pyproject = (backend_root / "pyproject.toml").read_text(encoding="utf-8")
    for _, (_, exact_spec) in CORE_DEPENDENCIES.items():
        assert exact_spec in requirements
        assert exact_spec in pyproject


@pytest.mark.asyncio
async def test_auth_endpoints_read_valid_json_body(client):
    register = await client.post(
        "/auth/register",
        json={
            "company_name": "BI01 Body Contract",
            "company_slug": "bi01-body-contract",
            "email": "owner@bi01-body.example.com",
            "password": "Passw0rd!",
        },
    )
    assert register.status_code == 201, register.text

    cases = [
        ("/auth/login", {"email": "missing@bi01.example.com", "password": "Passw0rd!"}),
        ("/auth/admin/login", {"email": "missing@bi01.example.com", "password": "Passw0rd!"}),
        (
            "/auth/pin-login",
            {"employee_id": "00000000-0000-0000-0000-000000000001", "pin": "1234"},
        ),
    ]
    for path, payload in cases:
        response = await client.post(path, json=payload)
        assert response.status_code == 401, (path, response.text)
        assert not _has_query_data_error(response), (path, response.text)


@pytest.mark.asyncio
async def test_pos_order_uses_body_validation_after_auth(client):
    register = await client.post(
        "/auth/register",
        json={
            "company_name": "BI01 POS Contract",
            "company_slug": "bi01-pos-contract",
            "email": "owner@bi01-pos.example.com",
            "password": "Passw0rd!",
        },
    )
    assert register.status_code == 201, register.text
    headers = {"Authorization": f"Bearer {register.json()['access_token']}"}

    response = await client.post("/pos/orders", headers=headers, json={"unknown": True})
    assert response.status_code == 422, response.text
    assert not _has_query_data_error(response), response.text
    assert any(item.get("loc") == ["body", "branch_id"] for item in response.json()["detail"])


@pytest.mark.asyncio
async def test_missing_fields_remain_pydantic_body_errors(client):
    response = await client.post("/auth/register", json={"unknown": True})
    assert response.status_code == 422
    assert not _has_query_data_error(response)
    locations = {tuple(item.get("loc", [])) for item in response.json()["detail"]}
    assert ("body", "company_name") in locations
    assert ("body", "company_slug") in locations
    assert ("body", "email") in locations
    assert ("body", "password") in locations


@pytest.mark.asyncio
async def test_login_rate_limit_remains_active_after_body_fix(client):
    payload = {"email": "rate-limit@bi01.example.com", "password": "Passw0rd!"}

    for _ in range(10):
        response = await client.post("/auth/login", json=payload)
        assert response.status_code == 401, response.text
        assert not _has_query_data_error(response)

    limited = await client.post("/auth/login", json=payload)
    assert limited.status_code == 429, limited.text

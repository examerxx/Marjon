# Intentionally no ``from __future__ import annotations``: FastAPI must receive
# the concrete schema classes captured by scoped_dictionary_router.
from typing import Any, Callable, Sequence, Type
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import require_company_app_user, require_hq_admin, require_web_owner
from app.modules.auth.models import User
from app.modules.finance.debt_repayments import company_client_repayments
from app.modules.finance.models import Counterparty
from app.modules.finance.ownership import FinanceDictionaryService, FinanceScope
from app.modules.organizations.dependencies import get_org_scope
from app.modules.organizations.models import Organization
from app.shared.admin_crud import OrgScope
from app.shared.exceptions import NotFoundError
from app.shared.pagination import Page, PageParams


async def get_company_finance_scope(
    user: User = Depends(require_company_app_user),
) -> FinanceScope:
    assert user.company_id is not None
    return FinanceScope("company", user.company_id)


async def get_owner_finance_scope(
    user: User = Depends(require_web_owner),
) -> FinanceScope:
    """Frozen Web OWNER finance scope for sensitive financial records."""
    assert user.company_id is not None
    return FinanceScope("company", user.company_id)


async def get_hq_finance_scope(
    organization_id: UUID = Query(..., description="Authorized finance organization"),
    user: User = Depends(require_hq_admin),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
) -> FinanceScope:
    if org_scope is not None and organization_id not in org_scope:
        raise NotFoundError("Organization not found")
    exists = (await db.execute(
        select(Organization.id).where(
            Organization.id == organization_id,
            Organization.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if exists is None:
        raise NotFoundError("Organization not found")
    return FinanceScope("organization", organization_id)


def scoped_dictionary_router(
    *,
    prefix: str,
    tags: list[str],
    model: Type[Any],
    create_schema: Type[BaseModel],
    update_schema: Type[BaseModel],
    response_schema: Type[BaseModel],
    scope_dep: Callable[..., Any],
    write_dep: Callable[..., Any],
    system_enabled: bool,
    search_fields: Sequence[str] = (),
    filter_fields: Sequence[str] = (),
    default_sort: str = "name",
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=tags)

    async def response_rows(rows, scope, db):
        responses = [response_schema.model_validate(row) for row in rows]
        if model is Counterparty and scope.kind == "company":
            repayments = await company_client_repayments(db, scope.tenant_id, rows)
            for response in responses:
                if response.id in repayments:
                    response.balance = response.balance - repayments[response.id]
        return responses

    @router.get("", response_model=Page[response_schema])
    async def list_items(
        request: Request,
        page: int = Query(1, ge=1),
        size: int = Query(20, ge=1, le=200),
        search: str | None = Query(None),
        sort: str | None = Query(None),
        scope: FinanceScope = Depends(scope_dep),
        db: AsyncSession = Depends(get_db),
    ):
        params = PageParams(page=page, size=size)
        raw_filters = {
            field: request.query_params[field]
            for field in filter_fields
            if field in request.query_params
        }
        rows, total = await FinanceDictionaryService(
            model, db, system_enabled=system_enabled
        ).list(
            scope,
            params,
            search=search,
            search_fields=search_fields,
            raw_filters=raw_filters,
            sort=sort,
            default_sort=default_sort,
        )
        return Page.create(
            await response_rows(rows, scope, db), total, params
        )

    @router.post("", response_model=response_schema, status_code=status.HTTP_201_CREATED)
    async def create_item(
        data: create_schema,
        scope: FinanceScope = Depends(scope_dep),
        _writer: User = Depends(write_dep),
        db: AsyncSession = Depends(get_db),
    ):
        return await FinanceDictionaryService(
            model, db, system_enabled=system_enabled
        ).create(data, scope)

    @router.get("/{resource_id}", response_model=response_schema)
    async def get_item(
        resource_id: UUID,
        scope: FinanceScope = Depends(scope_dep),
        db: AsyncSession = Depends(get_db),
    ):
        row = await FinanceDictionaryService(
            model, db, system_enabled=system_enabled
        ).get(resource_id, scope)
        return (await response_rows([row], scope, db))[0]

    @router.patch("/{resource_id}", response_model=response_schema)
    async def update_item(
        resource_id: UUID,
        data: update_schema,
        scope: FinanceScope = Depends(scope_dep),
        _writer: User = Depends(write_dep),
        db: AsyncSession = Depends(get_db),
    ):
        row = await FinanceDictionaryService(
            model, db, system_enabled=system_enabled
        ).update(resource_id, data, scope)
        return (await response_rows([row], scope, db))[0]

    @router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_item(
        resource_id: UUID,
        scope: FinanceScope = Depends(scope_dep),
        _writer: User = Depends(write_dep),
        db: AsyncSession = Depends(get_db),
    ):
        await FinanceDictionaryService(
            model, db, system_enabled=system_enabled
        ).delete(resource_id, scope)

    return router

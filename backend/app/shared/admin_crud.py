# Внимание: без `from __future__ import annotations` — фабрика crud_router
# подставляет схемы из closure в аннотации эндпоинтов, FastAPI должен видеть
# реальные классы, а не строки.
"""Generic CRUD layer for the HQ admin-panel modules.

Implements the list-endpoint conventions from the admin-panel spec:
pagination (`page`/`size`), search (`search=`), sorting (`sort=field,-field`),
field filters, period filters (`date_from`/`date_to`), organization scoping
and soft delete (rows with a `deleted_at` column are hidden, not removed).
"""

from datetime import datetime, timezone, date
from typing import Any, Callable, Generic, Optional, Sequence, Type, TypeVar
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, asc, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import Uuid

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.shared.base_model import TimeStampedModel
from app.shared.exceptions import NotFoundError, ValidationError
from app.shared.pagination import Page, PageParams

M = TypeVar("M", bound=TimeStampedModel)

# Org scope: None means "all organizations" (superadmin), otherwise an
# allow-list of organization ids the current account is linked to.
OrgScope = Optional[list[UUID]]


async def unrestricted_scope() -> OrgScope:
    return None


def _json_safe(model: type, payload: dict) -> dict:
    """Значения JSON-колонок приводим к JSON-сериализуемым (UUID, Decimal, date)."""
    from pydantic_core import to_jsonable_python
    from sqlalchemy import JSON as SAJSON

    for key, value in list(payload.items()):
        column = getattr(model, key, None)
        if column is not None and hasattr(column, "type") and isinstance(column.type, SAJSON):
            payload[key] = to_jsonable_python(value)
    return payload


def _coerce(column, raw: str) -> Any:
    t = column.type
    if isinstance(t, Uuid):
        return UUID(raw)
    if isinstance(t, Boolean):
        return raw.lower() in ("1", "true", "yes")
    if isinstance(t, Integer):
        return int(raw)
    if isinstance(t, Numeric):
        return float(raw)
    return raw


class CRUDService(Generic[M]):
    """Query helper shared by all admin-panel modules."""

    def __init__(self, model: Type[M], db: AsyncSession):
        self.model = model
        self.db = db

    # ── queries ──────────────────────────────────────────────────────────
    def _alive(self, query):
        if hasattr(self.model, "deleted_at"):
            query = query.where(self.model.deleted_at.is_(None))
        return query

    def _apply_sort(self, query, sort: str | None, default_sort: str):
        for token in (sort or default_sort).split(","):
            token = token.strip()
            if not token:
                continue
            direction = desc if token.startswith("-") else asc
            name = token.lstrip("-")
            column = getattr(self.model, name, None)
            if column is None:
                raise ValidationError(f"Unknown sort field: {name}")
            query = query.order_by(direction(column))
        return query

    def _apply_filters(self, query, raw_filters: dict[str, str]):
        for name, raw in raw_filters.items():
            column = getattr(self.model, name, None)
            if column is None or raw in (None, ""):
                continue
            try:
                query = query.where(column == _coerce(column, raw))
            except (ValueError, TypeError):
                raise ValidationError(f"Invalid value for filter '{name}'")
        return query

    async def list(
        self,
        params: PageParams,
        *,
        search: str | None = None,
        search_fields: Sequence[str] = (),
        sort: str | None = None,
        default_sort: str = "-created_at",
        raw_filters: dict[str, str] | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        date_field: str = "created_at",
        org_scope: OrgScope = None,
        org_field: str | None = None,
    ) -> tuple[list[M], int]:
        query = self._alive(select(self.model))

        if search and search_fields:
            pattern = f"%{search}%"
            query = query.where(
                or_(*(getattr(self.model, f).ilike(pattern) for f in search_fields))
            )
        if raw_filters:
            query = self._apply_filters(query, raw_filters)

        dcol = getattr(self.model, date_field, None)
        if dcol is not None:
            if date_from:
                query = query.where(func.date(dcol) >= date_from)
            if date_to:
                query = query.where(func.date(dcol) <= date_to)

        if org_scope is not None and org_field and hasattr(self.model, org_field):
            query = query.where(getattr(self.model, org_field).in_(org_scope))

        count_q = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_q)).scalar_one()

        query = self._apply_sort(query, sort, default_sort)
        query = query.offset(params.offset).limit(params.size)
        items = list((await self.db.execute(query)).scalars().all())
        return items, total

    async def get(self, id: UUID) -> M:
        obj = (
            await self.db.execute(self._alive(select(self.model)).where(self.model.id == id))
        ).scalar_one_or_none()
        if obj is None:
            raise NotFoundError(f"{self.model.__name__} not found")
        return obj

    async def create(self, data: BaseModel | dict, **extra: Any) -> M:
        payload = data if isinstance(data, dict) else data.model_dump(exclude_unset=True)
        payload = _json_safe(self.model, payload)
        obj = self.model(**payload, **extra)
        self.db.add(obj)
        await self.db.commit()
        await self.db.refresh(obj)
        return obj

    async def update(self, id: UUID, data: BaseModel | dict) -> M:
        obj = await self.get(id)
        payload = data if isinstance(data, dict) else data.model_dump(exclude_unset=True)
        payload = _json_safe(self.model, payload)
        for key, value in payload.items():
            setattr(obj, key, value)
        await self.db.commit()
        await self.db.refresh(obj)
        return obj

    async def delete(self, id: UUID) -> None:
        obj = await self.get(id)
        if hasattr(obj, "deleted_at"):
            obj.deleted_at = datetime.now(timezone.utc)
        else:
            await self.db.delete(obj)
        await self.db.commit()


def crud_router(
    *,
    prefix: str,
    tags: list[str],
    model: Type[M],
    create_schema: Type[BaseModel],
    update_schema: Type[BaseModel],
    response_schema: Type[BaseModel],
    search_fields: Sequence[str] = (),
    filter_fields: Sequence[str] = (),
    default_sort: str = "-created_at",
    date_field: str = "created_at",
    org_field: str | None = None,
    scope_dep: Callable[..., Any] = unrestricted_scope,
    router: APIRouter | None = None,
) -> APIRouter:
    """Build a standard CRUD router for one resource.

    `filter_fields` are read from the query string and matched by equality
    (values are coerced to the column type). Extra non-CRUD endpoints can be
    attached by passing an existing `router` or by adding routes afterwards.
    """
    r = router or APIRouter(prefix=prefix, tags=tags)
    filter_desc = ", ".join(filter_fields) or "—"

    @r.get("", response_model=Page[response_schema], summary=f"List {model.__name__}",
           description=f"Фильтры по полям: {filter_desc}")
    async def list_items(
        request: Request,
        page: int = Query(1, ge=1),
        size: int = Query(20, ge=1, le=200),
        search: str | None = Query(None),
        sort: str | None = Query(None, description="Пример: name,-created_at"),
        date_from: date | None = Query(None),
        date_to: date | None = Query(None),
        user: User = Depends(get_current_user),
        org_scope: OrgScope = Depends(scope_dep),
        db: AsyncSession = Depends(get_db),
    ):
        params = PageParams(page=page, size=size)
        raw_filters = {
            f: request.query_params[f] for f in filter_fields if f in request.query_params
        }
        items, total = await CRUDService(model, db).list(
            params,
            search=search,
            search_fields=search_fields,
            sort=sort,
            default_sort=default_sort,
            raw_filters=raw_filters,
            date_from=date_from,
            date_to=date_to,
            date_field=date_field,
            org_scope=org_scope,
            org_field=org_field,
        )
        return Page.create(
            [response_schema.model_validate(i) for i in items], total, params
        )

    @r.post("", response_model=response_schema, status_code=status.HTTP_201_CREATED,
            summary=f"Create {model.__name__}")
    async def create_item(
        data: create_schema,  # type: ignore[valid-type]
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        return await CRUDService(model, db).create(data)

    @r.get("/{item_id}", response_model=response_schema, summary=f"Get {model.__name__}")
    async def get_item(
        item_id: UUID,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        return await CRUDService(model, db).get(item_id)

    @r.patch("/{item_id}", response_model=response_schema, summary=f"Update {model.__name__}")
    async def update_item(
        item_id: UUID,
        data: update_schema,  # type: ignore[valid-type]
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        return await CRUDService(model, db).update(item_id, data)

    @r.put("/{item_id}", response_model=response_schema, include_in_schema=False)
    async def replace_item(
        item_id: UUID,
        data: update_schema,  # type: ignore[valid-type]
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        return await CRUDService(model, db).update(item_id, data)

    @r.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT,
              summary=f"Delete {model.__name__}")
    async def delete_item(
        item_id: UUID,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        await CRUDService(model, db).delete(item_id)

    return r

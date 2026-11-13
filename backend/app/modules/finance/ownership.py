from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Generic, Literal, Sequence, TypeVar
from uuid import UUID

from sqlalchemy import Boolean, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased
from sqlalchemy.types import Uuid

from app.modules.finance.defaults import DEFAULT_PAYMENT_IDS
from app.modules.finance.models import (
    Counterparty,
    FinanceTemplate,
    PaymentType,
    TransactionCategory,
)
from app.shared.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from app.shared.pagination import PageParams


SCOPE_SYSTEM = "system"
SCOPE_COMPANY = "company"
SCOPE_ORGANIZATION = "organization"
SCOPE_LEGACY = "legacy"

TenantKind = Literal["company", "organization"]
M = TypeVar("M", PaymentType, TransactionCategory, FinanceTemplate, Counterparty)


@dataclass(frozen=True)
class FinanceScope:
    kind: TenantKind
    tenant_id: UUID

    @property
    def owner_field(self) -> str:
        return "company_id" if self.kind == SCOPE_COMPANY else "organization_id"


def _tenant_predicate(model: type[Any], scope: FinanceScope):
    return and_(
        model.scope_kind == scope.kind,
        getattr(model, scope.owner_field) == scope.tenant_id,
    )


def _alive(model: type[Any]):
    if hasattr(model, "deleted_at"):
        return model.deleted_at.is_(None)
    return True


class FinanceDictionaryService(Generic[M]):
    """Server-authoritative visibility and mutation rules for BI-05A dictionaries."""

    def __init__(self, model: type[M], db: AsyncSession, *, system_enabled: bool):
        self.model = model
        self.db = db
        self.system_enabled = system_enabled

    def _visible(self, scope: FinanceScope):
        tenant = _tenant_predicate(self.model, scope)
        if not self.system_enabled:
            return tenant

        copy = aliased(self.model)
        shadowed = (
            select(copy.id)
            .where(
                _tenant_predicate(copy, scope),
                copy.source_template_id == self.model.id,
                _alive(copy),
            )
            .exists()
        )
        return or_(
            tenant,
            and_(self.model.scope_kind == SCOPE_SYSTEM, ~shadowed),
        )

    async def list(
        self,
        scope: FinanceScope,
        params: PageParams,
        *,
        search: str | None = None,
        search_fields: Sequence[str] = (),
        raw_filters: dict[str, Any] | None = None,
        sort: str | None = None,
        default_sort: str = "name",
    ) -> tuple[list[M], int]:
        query = select(self.model).where(self._visible(scope), _alive(self.model))
        if search:
            pattern = f"%{search}%"
            query = query.where(
                or_(*(getattr(self.model, field).ilike(pattern) for field in search_fields))
            )
        for field, value in (raw_filters or {}).items():
            column = getattr(self.model, field, None)
            if column is not None and value not in (None, ""):
                if isinstance(column.type, Boolean):
                    value = str(value).lower() in ("1", "true", "yes")
                elif isinstance(column.type, Uuid):
                    try:
                        value = UUID(str(value))
                    except (TypeError, ValueError):
                        raise ValidationError(f"Invalid value for filter '{field}'")
                query = query.where(column == value)

        total = (await self.db.execute(
            select(func.count()).select_from(query.order_by(None).subquery())
        )).scalar_one()
        for token in (sort or default_sort).split(","):
            token = token.strip()
            descending = token.startswith("-")
            field = token.lstrip("-")
            column = getattr(self.model, field, None)
            if column is None:
                raise ValidationError(f"Unknown sort field: {field}")
            query = query.order_by(column.desc() if descending else column.asc())
        rows = (await self.db.execute(
            query.offset(params.offset).limit(params.size)
        )).scalars().all()
        return list(rows), total

    async def get(self, resource_id: UUID, scope: FinanceScope) -> M:
        visible = _tenant_predicate(self.model, scope)
        if self.system_enabled:
            # A tenant copy shadows its source only in effective LIST results;
            # the immutable system record remains directly readable by id.
            visible = or_(visible, self.model.scope_kind == SCOPE_SYSTEM)
        row = (await self.db.execute(
            select(self.model).where(
                self.model.id == resource_id,
                visible,
                _alive(self.model),
            )
        )).scalar_one_or_none()
        if row is None:
            raise NotFoundError(f"{self.model.__name__} not found")
        return row

    async def _get_owned(self, resource_id: UUID, scope: FinanceScope) -> M:
        row = (await self.db.execute(
            select(self.model).where(
                self.model.id == resource_id,
                _tenant_predicate(self.model, scope),
                _alive(self.model),
            )
        )).scalar_one_or_none()
        if row is not None:
            return row
        if self.system_enabled:
            system_exists = (await self.db.execute(
                select(self.model.id).where(
                    self.model.id == resource_id,
                    self.model.scope_kind == SCOPE_SYSTEM,
                    _alive(self.model),
                )
            )).scalar_one_or_none()
            if system_exists is not None:
                raise ForbiddenError("System finance template is immutable")
        raise NotFoundError(f"{self.model.__name__} not found")

    async def _validate_source(self, source_id: UUID | None) -> M | None:
        if source_id is None:
            return None
        if not self.system_enabled:
            raise ValidationError("source_template_id is not supported")
        source = (await self.db.execute(
            select(self.model).where(
                self.model.id == source_id,
                self.model.scope_kind == SCOPE_SYSTEM,
                _alive(self.model),
            )
        )).scalar_one_or_none()
        if source is None:
            raise NotFoundError(f"{self.model.__name__} source template not found")
        return source

    async def _validate_category_parent(
        self,
        parent_id: UUID | None,
        scope: FinanceScope,
        *,
        source: TransactionCategory | None,
        current_id: UUID | None = None,
    ) -> None:
        if self.model is not TransactionCategory:
            return
        parent = None
        if parent_id is not None:
            if parent_id == current_id:
                raise ValidationError("TransactionCategory cannot be its own parent")
            parent = (await self.db.execute(
                select(TransactionCategory).where(
                    TransactionCategory.id == parent_id,
                    _tenant_predicate(TransactionCategory, scope),
                )
            )).scalar_one_or_none()
            if parent is None:
                raise NotFoundError("TransactionCategory parent not found")

        if source is not None:
            if source.parent_id is None and parent is not None:
                raise ValidationError("Root template copy cannot have a parent")
            if source.parent_id is not None and (
                parent is None or parent.source_template_id != source.parent_id
            ):
                raise ValidationError("Category copy parent must copy the source parent")

        ancestor = parent
        visited: set[UUID] = set()
        while ancestor is not None:
            if ancestor.id == current_id or ancestor.id in visited:
                raise ValidationError("TransactionCategory parent cycle is not allowed")
            visited.add(ancestor.id)
            if ancestor.parent_id is None:
                break
            ancestor = (await self.db.execute(
                select(TransactionCategory).where(
                    TransactionCategory.id == ancestor.parent_id,
                    _tenant_predicate(TransactionCategory, scope),
                )
            )).scalar_one_or_none()
            if ancestor is None:
                raise ValidationError("TransactionCategory parent tree is invalid")

    async def create(self, data: Any, scope: FinanceScope) -> M:
        payload = data.model_dump(exclude_unset=True) if hasattr(data, "model_dump") else dict(data)
        payload.pop("scope_kind", None)
        payload.pop("company_id", None)
        payload.pop("organization_id", None)
        source_id = payload.get("source_template_id")
        if self.model is PaymentType and source_id in DEFAULT_PAYMENT_IDS:
            raise ForbiddenError("Default payment methods already exist")
        source = await self._validate_source(source_id)
        await self._validate_category_parent(
            payload.get("parent_id"), scope, source=source
        )
        payload.update(
            scope_kind=scope.kind,
            company_id=scope.tenant_id if scope.kind == SCOPE_COMPANY else None,
            organization_id=scope.tenant_id if scope.kind == SCOPE_ORGANIZATION else None,
        )
        row = self.model(**payload)
        self.db.add(row)
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            if source_id is not None:
                raise ConflictError("A tenant copy of this system template already exists")
            raise
        await self.db.refresh(row)
        return row

    async def update(self, resource_id: UUID, data: Any, scope: FinanceScope) -> M:
        payload = data.model_dump(exclude_unset=True) if hasattr(data, "model_dump") else dict(data)
        for protected in ("scope_kind", "company_id", "organization_id", "source_template_id"):
            payload.pop(protected, None)
        if self.model is PaymentType and resource_id in DEFAULT_PAYMENT_IDS:
            if scope.kind != SCOPE_COMPANY or set(payload) != {"status"} or not isinstance(payload["status"], bool):
                raise ForbiddenError("Only the status of a default payment method may change")
            source = (await self.db.execute(select(PaymentType).where(
                PaymentType.id == resource_id, PaymentType.scope_kind == SCOPE_SYSTEM,
            ).with_for_update())).scalar_one_or_none()
            if source is None:
                raise NotFoundError("Default payment method not found")
            row = (await self.db.execute(select(PaymentType).where(
                _tenant_predicate(PaymentType, scope), PaymentType.source_template_id == source.id,
            ))).scalar_one_or_none()
            if row is None:
                row = PaymentType(
                    name=source.name, type=source.type, sort=source.sort,
                    scope_kind=SCOPE_COMPANY, company_id=scope.tenant_id,
                    source_template_id=source.id,
                )
                self.db.add(row)
        else:
            row = await self._get_owned(resource_id, scope)
            if self.model is PaymentType and row.source_template_id in DEFAULT_PAYMENT_IDS:
                if set(payload) != {"status"} or not isinstance(payload["status"], bool):
                    raise ForbiddenError("Only the status of a default payment method may change")
        if self.model is TransactionCategory and "parent_id" in payload:
            source = await self._validate_source(row.source_template_id)
            await self._validate_category_parent(
                payload["parent_id"], scope, source=source, current_id=row.id
            )
        for field, value in payload.items():
            setattr(row, field, value)
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def delete(self, resource_id: UUID, scope: FinanceScope) -> None:
        row = await self._get_owned(resource_id, scope)
        if self.model is PaymentType and row.source_template_id in DEFAULT_PAYMENT_IDS:
            raise ForbiddenError("Default payment methods cannot be deleted")
        if hasattr(row, "deleted_at"):
            from datetime import datetime, timezone
            row.deleted_at = datetime.now(timezone.utc)
        else:
            await self.db.delete(row)
        await self.db.commit()


async def require_finance_reference(
    db: AsyncSession,
    model: type[M],
    resource_id: UUID | None,
    scope: FinanceScope,
    *,
    allow_system: bool,
    detail: str,
) -> M | None:
    if resource_id is None:
        return None
    predicates = [_tenant_predicate(model, scope)]
    if allow_system:
        predicates.append(model.scope_kind == SCOPE_SYSTEM)
    row = (await db.execute(
        select(model).where(
            model.id == resource_id,
            or_(*predicates),
            _alive(model),
        )
    )).scalar_one_or_none()
    if row is None:
        raise NotFoundError(detail)
    return row


async def validate_transaction_references(
    db: AsyncSession,
    scope: FinanceScope,
    *,
    payment_type_id: UUID | None,
    category_id: UUID | None,
    counterparty_id: UUID | None,
    finance_template_id: UUID | None = None,
) -> None:
    await require_finance_reference(
        db, PaymentType, payment_type_id, scope,
        allow_system=True, detail="PaymentType not found",
    )
    await require_finance_reference(
        db, TransactionCategory, category_id, scope,
        allow_system=True, detail="TransactionCategory not found",
    )
    await require_finance_reference(
        db, Counterparty, counterparty_id, scope,
        allow_system=False, detail="Counterparty not found",
    )
    await require_finance_reference(
        db, FinanceTemplate, finance_template_id, scope,
        allow_system=True, detail="FinanceTemplate not found",
    )

from __future__ import annotations
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import require_company_app_user, require_hq_admin
from app.modules.auth.models import User
from app.modules.finance import models, schemas
from app.modules.finance.ownership import FinanceDictionaryService, FinanceScope
from app.modules.finance.ownership_router import (
    get_company_finance_scope,
    get_hq_finance_scope,
    get_owner_finance_scope,
    scoped_dictionary_router,
)
from app.modules.finance.service import TransactionService
from app.modules.organizations.dependencies import get_org_scope
from app.modules.rbac.dependencies import require_permission
from app.shared.admin_crud import CRUDService, OrgScope
from app.shared.exceptions import NotFoundError
from app.shared.pagination import Page, PageParams

router = APIRouter(prefix="/finance", tags=["finance"])

# BE-04: /finance/transactions and /finance/transaction-categories used to be
# reached by BOTH the HQ admin panel and the owner/kafe app under the same
# path with different semantics (organization_id vs company_id) — kafe_compat's
# handlers for those two were being silently shadowed. Moved the HQ versions
# to /hq/finance/* below; kafe_compat/router.py is now the sole, reachable
# resolver for the unprefixed /finance/transactions(-categories) path, and
# its handlers were fixed to actually filter by company_id.
#
# payment-types, finance-templates and counterparties are NOT part of this
# conflict — kafe_compat never implemented those, so the admin frontend's
# existing calls to them are untouched and still work as before.
#
# BE-05: any authenticated staff member can still LIST/GET these (e.g. a
# cashier needs to see payment types to accept a payment), but write access
# now requires the `finance:manage` permission — previously any staff role
# (including cashier/waiter) could create/edit/delete payment types,
# templates and counterparties.
router.include_router(scoped_dictionary_router(
    prefix="/payment-types", tags=["finance"],
    model=models.PaymentType,
    create_schema=schemas.PaymentTypeCreate,
    update_schema=schemas.PaymentTypeUpdate,
    response_schema=schemas.PaymentTypeResponse,
    search_fields=("name",),
    filter_fields=("status", "type"),
    default_sort="sort",
    scope_dep=get_company_finance_scope,
    write_dep=require_permission("finance:manage"),
    system_enabled=True,
))

hq_router = APIRouter(prefix="/hq/finance", tags=["hq-finance"])

hq_router.include_router(scoped_dictionary_router(
    prefix="/transaction-categories", tags=["hq-finance"],
    model=models.TransactionCategory,
    create_schema=schemas.TransactionCategoryCreate,
    update_schema=schemas.TransactionCategoryUpdate,
    response_schema=schemas.TransactionCategoryResponse,
    search_fields=("name",),
    filter_fields=("status", "kind", "parent_id"),
    default_sort="name",
    scope_dep=get_hq_finance_scope,
    write_dep=require_hq_admin,
    system_enabled=True,
))

router.include_router(scoped_dictionary_router(
    prefix="/finance-templates", tags=["finance"],
    model=models.FinanceTemplate,
    create_schema=schemas.FinanceTemplateCreate,
    update_schema=schemas.FinanceTemplateUpdate,
    response_schema=schemas.FinanceTemplateResponse,
    search_fields=("name",),
    default_sort="name",
    scope_dep=get_company_finance_scope,
    write_dep=require_permission("finance:manage"),
    system_enabled=True,
))


# ── Контрагенты ──────────────────────────────────────────────────────────────
counterparties = scoped_dictionary_router(
    prefix="/counterparties", tags=["finance"],
    model=models.Counterparty,
    create_schema=schemas.CounterpartyCreate,
    update_schema=schemas.CounterpartyUpdate,
    response_schema=schemas.CounterpartyResponse,
    search_fields=("full_name", "phone"),
    filter_fields=("type",),
    default_sort="full_name",
    scope_dep=get_company_finance_scope,
    write_dep=require_permission("finance:manage"),
    system_enabled=False,
)


@counterparties.get("/{counterparty_id}/transactions",
                    response_model=Page[schemas.TransactionResponse],
                    summary="Транзакции контрагента")
async def counterparty_transactions(
    counterparty_id: UUID,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    web_timezone: str | None = Query(None, pattern="^Asia/Tashkent$"),
    scope: FinanceScope = Depends(get_owner_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    await FinanceDictionaryService(
        models.Counterparty, db, system_enabled=False
    ).get(counterparty_id, scope)
    params = PageParams(page=page, size=size)
    if web_timezone:
        from app.shared.web_time import web_counterparty_transactions
        items, total = await web_counterparty_transactions(db, scope.tenant_id, counterparty_id, params, date_from, date_to)
        return Page.create([schemas.TransactionResponse.model_validate(i) for i in items], total, params)
    items, total = await TransactionService(db).list(
        params,
        raw_filters={
            "counterparty_id": str(counterparty_id),
            "company_id": str(scope.tenant_id),
        },
        date_from=date_from, date_to=date_to, date_field="date",
        default_sort="-date",
    )
    return Page.create([schemas.TransactionResponse.model_validate(i) for i in items], total, params)


@counterparties.get("/{counterparty_id}/orders",
                    response_model=list[schemas.CounterpartyOrderRow],
                    summary="Заказы контрагента")
async def counterparty_orders(
    counterparty_id: UUID,
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    scope: FinanceScope = Depends(get_owner_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    """DEBT-ORDERS-01: заказы клиента для карточки «Клиенты → История».

    Клиент появляется в справочнике при закрытии счёта «в долг», но в
    «Транзакциях» у него пусто: долг — не финансовая транзакция, а заказ без
    оплаты. Отдаём его заказы, чтобы владелец видел чек так же, как в отчёте
    по заказам.
    """
    from app.modules.finance.counterparty_orders import list_counterparty_orders

    counterparty = await FinanceDictionaryService(
        models.Counterparty, db, system_enabled=False
    ).get(counterparty_id, scope)
    rows = await list_counterparty_orders(
        db, scope.tenant_id, counterparty, date_from, date_to
    )
    return [schemas.CounterpartyOrderRow(**row) for row in rows]


router.include_router(counterparties)


for _prefix, _model, _create, _update, _response, _search, _filters, _sort, _system in (
    ("/payment-types", models.PaymentType, schemas.PaymentTypeCreate,
     schemas.PaymentTypeUpdate, schemas.PaymentTypeResponse, ("name",),
     ("status", "type"), "sort", True),
    ("/finance-templates", models.FinanceTemplate, schemas.FinanceTemplateCreate,
     schemas.FinanceTemplateUpdate, schemas.FinanceTemplateResponse, ("name",),
     (), "name", True),
    ("/counterparties", models.Counterparty, schemas.CounterpartyCreate,
     schemas.CounterpartyUpdate, schemas.CounterpartyResponse, ("full_name", "phone"),
     ("type",), "full_name", False),
):
    hq_router.include_router(scoped_dictionary_router(
        prefix=_prefix,
        tags=["hq-finance"],
        model=_model,
        create_schema=_create,
        update_schema=_update,
        response_schema=_response,
        search_fields=_search,
        filter_fields=_filters,
        default_sort=_sort,
        scope_dep=get_hq_finance_scope,
        write_dep=require_hq_admin,
        system_enabled=_system,
    ))


# ── Транзакции (HQ) ──────────────────────────────────────────────────────────
# Mounted under hq_router (/hq/finance/transactions) — see BE-04 note above.
transactions = APIRouter(prefix="/transactions", tags=["hq-finance"])

TX_FILTERS = (
    "direction", "payment_type_id", "counterparty_id", "category_id",
    "finance_template_id", "organization_id",
)


@transactions.get("", response_model=Page[schemas.TransactionResponse],
                  description=f"Фильтры по полям: {', '.join(TX_FILTERS)}")
async def list_transactions(
    request: Request,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    sort: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(require_hq_admin),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    params = PageParams(page=page, size=size)
    raw_filters = {f: request.query_params[f] for f in TX_FILTERS if f in request.query_params}
    items, total = await TransactionService(db).list_organization_transactions(
        params, sort=sort,
        raw_filters=raw_filters,
        date_from=date_from, date_to=date_to,
        org_scope=org_scope,
    )
    return Page.create([schemas.TransactionResponse.model_validate(i) for i in items], total, params)


@transactions.post("", response_model=schemas.TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: schemas.TransactionCreate,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    user: User = Depends(require_hq_admin),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    return await TransactionService(db).create_transaction(
        data, user.id, idempotency_key, org_scope
    )


@transactions.post("/pay", response_model=list[schemas.TransactionResponse],
                   status_code=status.HTTP_201_CREATED,
                   summary="Разбивка оплаты долга (debt-payment-split)")
async def pay(
    data: schemas.PayRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    user: User = Depends(require_hq_admin),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    return await TransactionService(db).pay(
        data, user.id, idempotency_key, org_scope
    )


@transactions.get("/{tx_id}", response_model=schemas.TransactionResponse)
async def get_transaction(
    tx_id: UUID,
    user: User = Depends(require_hq_admin),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    return await TransactionService(db).get_organization_transaction(tx_id, org_scope)


@transactions.patch("/{tx_id}", response_model=schemas.TransactionResponse)
async def update_transaction(
    tx_id: UUID,
    data: schemas.TransactionUpdate,
    user: User = Depends(require_hq_admin),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    return await TransactionService(db).update_transaction(
        tx_id, data, user.id, org_scope=org_scope
    )


@transactions.delete("/{tx_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    tx_id: UUID,
    user: User = Depends(require_hq_admin),
    org_scope: OrgScope = Depends(get_org_scope),
    db: AsyncSession = Depends(get_db),
):
    await TransactionService(db).delete_transaction(
        tx_id, user.id, org_scope=org_scope
    )


hq_router.include_router(transactions)


# ── История изменений сумм (только чтение) ──────────────────────────────────
history = APIRouter(prefix="/finance-history", tags=["finance"])


@history.get("", response_model=Page[schemas.FinanceHistoryResponse])
async def list_finance_history(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    ref_id: UUID | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    scope: FinanceScope = Depends(get_owner_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    params = PageParams(page=page, size=size)
    raw_filters = {"company_id": str(scope.tenant_id)}
    if ref_id:
        raw_filters["ref_id"] = str(ref_id)
    items, total = await CRUDService(models.FinanceHistory, db).list(
        params, raw_filters=raw_filters,
        date_from=date_from, date_to=date_to, date_field="date",
        default_sort="-date",
    )
    return Page.create([schemas.FinanceHistoryResponse.model_validate(i) for i in items], total, params)


@history.get("/{history_id}", response_model=schemas.FinanceHistoryResponse)
async def get_finance_history(
    history_id: UUID,
    scope: FinanceScope = Depends(get_owner_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        select(models.FinanceHistory).where(
            models.FinanceHistory.id == history_id,
            models.FinanceHistory.scope_kind == "company",
            models.FinanceHistory.company_id == scope.tenant_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise NotFoundError("FinanceHistory not found")
    return row


router.include_router(history)


hq_history = APIRouter(prefix="/finance-history", tags=["hq-finance"])


@hq_history.get("", response_model=Page[schemas.FinanceHistoryResponse])
async def list_hq_finance_history(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    ref_id: UUID | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    scope: FinanceScope = Depends(get_hq_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    params = PageParams(page=page, size=size)
    raw_filters = {"organization_id": str(scope.tenant_id)}
    if ref_id:
        raw_filters["ref_id"] = str(ref_id)
    items, total = await CRUDService(models.FinanceHistory, db).list(
        params,
        raw_filters=raw_filters,
        date_from=date_from,
        date_to=date_to,
        date_field="date",
        default_sort="-date",
    )
    return Page.create(
        [schemas.FinanceHistoryResponse.model_validate(item) for item in items],
        total,
        params,
    )


@hq_history.get("/{history_id}", response_model=schemas.FinanceHistoryResponse)
async def get_hq_finance_history(
    history_id: UUID,
    scope: FinanceScope = Depends(get_hq_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        select(models.FinanceHistory).where(
            models.FinanceHistory.id == history_id,
            models.FinanceHistory.scope_kind == "organization",
            models.FinanceHistory.organization_id == scope.tenant_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise NotFoundError("FinanceHistory not found")
    return row


hq_router.include_router(hq_history)

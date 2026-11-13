"""Kafe compatibility layer.

The React kafe-panel calls a handful of endpoints under path shapes that the
domain routers expose under different names (see docs/tz/TZ_WEB.md §3, §7.2).
This module exposes exactly those front-end contract paths, delegating to the
existing models/services, plus real aggregation for the restaurant reports.

Mounted once under /api/v1 (the kafe front-end base URL).
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import (
    require_company_admin,
    require_company_app_user,
    require_web_owner,
)
from app.modules.auth.models import User
from app.modules.companies.models import Branch, Company
from app.modules.finance.defaults import DEFAULT_PAYMENT_IDS
from app.modules.finance.models import (
    Counterparty,
    FinanceHistory,
    FinTransaction,
    PaymentType,
    TransactionCategory,
)
from app.modules.finance.ownership import (
    FinanceDictionaryService,
    FinanceScope,
    validate_transaction_references,
)
from app.modules.finance.ownership_router import get_company_finance_scope
from app.modules.finance.money import canonical_money_amount
from app.modules.finance.schemas import (
    CounterpartyCreate,
    CounterpartyUpdate,
    PaymentTypeCreate,
    PaymentTypeUpdate,
    TransactionCategoryCreate,
    TransactionCategoryUpdate,
    TransactionIncomeSummary,
)
from app.modules.finance.service import TransactionService
from app.modules.kafe_compat.models import ReceiptTemplateSettings, SupportTicket
from app.modules.kafe_compat.schemas import ReceiptTemplateUpdate
from app.shared.exceptions import ConflictError, ForbiddenError, ValidationError
from app.modules.subscriptions.models import Invoice, Plan, Subscription
from app.shared.exceptions import NotFoundError
from app.shared.pagination import PageParams

router = APIRouter()


# ── Финансы: транзакции (company-scoped, без org-фильтра HQ-админки) ──────────
def _tx_dict(t: FinTransaction) -> dict:
    return {
        "id": t.id, "date": t.date, "amount": float(t.amount or 0), "direction": t.direction,
        "payment_type_id": t.payment_type_id, "counterparty_id": t.counterparty_id,
        "category_id": t.category_id, "finance_template_id": t.finance_template_id,
        "comment": t.comment, "user_id": t.user_id,
        "payment_type_name": None, "counterparty_name": None, "category_name": None,
    }


def _company_transactions_query(company_id, date_from, date_to, direction=None, web_timezone=None):
    # BE-04: was unfiltered (despite the module docstring claiming
    # "company-scoped") — every company saw every other company's transactions.
    q = select(FinTransaction).where(
        FinTransaction.deleted_at.is_(None),
        FinTransaction.company_id == company_id,
    )
    if web_timezone:
        from app.shared.web_time import web_date_conditions
        q = q.where(*web_date_conditions(FinTransaction.date, date_from, date_to))
    elif date_from:
        q = q.where(func.date(FinTransaction.date) >= date_from)
    if date_to and not web_timezone:
        q = q.where(func.date(FinTransaction.date) <= date_to)
    if direction:
        q = q.where(FinTransaction.direction == direction)
    return q


@router.get("/finance/transactions", tags=["finance-kafe"])
async def kafe_list_transactions(
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    direction: str | None = Query(None),
    web_timezone: str | None = Query(None, pattern="^Asia/Tashkent$"),
    # DESK-FIN-01: десктоп-касса (моноблок/кассир) показывает панель финансов
    # и список операций за смену. Раньше здесь стоял require_web_owner, поэтому
    # любой сотрудник получал 403, а панель молча рисовала пустой список.
    # Чтение — любому сотруднику компании (company-scope ниже это гарантирует),
    # запись/правка/удаление остаются у владельца.
    user: User = Depends(require_company_app_user),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    q = _company_transactions_query(scope.tenant_id, date_from, date_to, direction, web_timezone)
    rows = (await db.execute(q.order_by(FinTransaction.date.desc()))).scalars().all()
    return {"items": [_tx_dict(t) for t in rows], "count": len(rows)}


@router.get("/finance/transactions/summary", response_model=TransactionIncomeSummary, tags=["finance-kafe"])
async def kafe_transaction_income_summary(
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    web_timezone: str | None = Query(None, pattern="^Asia/Tashkent$"),
    # DESK-FIN-01: сводка прихода нужна той же панели «Финансы» на терминале.
    user: User = Depends(require_company_app_user),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    q = _company_transactions_query(scope.tenant_id, date_from, date_to, "income", web_timezone)
    income = (await db.execute(q.with_only_columns(
        func.coalesce(func.sum(FinTransaction.amount), 0)
    ))).scalar_one()
    return TransactionIncomeSummary(income_amount=income)


@router.post("/finance/transactions", status_code=status.HTTP_201_CREATED, tags=["finance-kafe"])
async def kafe_create_transaction(
    data: dict,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    # DESK-FIN-01: приход/расход наличных вносит кассир с терминала (панель
    # «Финансы», в т.ч. при закрытии заказа в долг). UI уже гейтится тумблерами
    # can_view_finance/can_cash_ops, поэтому серверная проверка — company-scope,
    # а не «только владелец»: иначе кнопка есть, а запрос всегда 403.
    user: User = Depends(require_company_app_user),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    transaction = await TransactionService(db).create_company_transaction(
        data,
        user.id,
        scope.tenant_id,
        idempotency_key,
    )
    return _tx_dict(transaction)


# ── Cashier income / expense (POS desktop/mobile shortcut) ────────────────────
# Thin company-scoped aliases over the finance transactions: a cashier or
# manager records a cash income/expense without web-owner rights.
async def _require_cashier_or_manager(
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    from app.modules.rbac.models import Role, UserRole
    slugs = (await db.execute(
        select(Role.slug).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user.id)
    )).scalars().all()
    if not set(slugs) & {"cashier", "manager"}:
        raise ForbiddenError("Cashier or manager role required")
    return user


@router.get("/finance/income-expense", tags=["finance-kafe"])
async def kafe_list_income_expense(
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    direction: str | None = Query(None, pattern="^(income|expense)$"),
    user: User = Depends(_require_cashier_or_manager),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    q = select(FinTransaction).where(
        FinTransaction.deleted_at.is_(None),
        FinTransaction.company_id == scope.tenant_id,
    )
    if date_from:
        q = q.where(func.date(FinTransaction.date) >= date_from)
    if date_to:
        q = q.where(func.date(FinTransaction.date) <= date_to)
    if direction:
        q = q.where(FinTransaction.direction == direction)
    rows = (await db.execute(q.order_by(FinTransaction.date.desc()))).scalars().all()
    return {"items": [_tx_dict(t) for t in rows], "count": len(rows)}


@router.post("/finance/income-expense", status_code=status.HTTP_201_CREATED, tags=["finance-kafe"])
async def kafe_create_income_expense(
    data: dict,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    user: User = Depends(_require_cashier_or_manager),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    if data.get("direction") not in ("income", "expense"):
        raise ValidationError("direction must be income or expense")
    transaction = await TransactionService(db).create_company_transaction(
        data, user.id, scope.tenant_id, idempotency_key,
    )
    return _tx_dict(transaction)


@router.patch("/finance/transactions/{tx_id}", tags=["finance-kafe"])
async def kafe_update_transaction(
    tx_id: UUID,
    data: dict,
    user: User = Depends(require_web_owner),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    t = await db.get(FinTransaction, tx_id)
    if not t or t.company_id != scope.tenant_id:
        raise NotFoundError("Transaction not found")
    await validate_transaction_references(
        db,
        scope,
        payment_type_id=data.get("payment_type_id", t.payment_type_id),
        category_id=data.get("category_id", t.category_id),
        counterparty_id=data.get("counterparty_id", t.counterparty_id),
        finance_template_id=data.get("finance_template_id", t.finance_template_id),
    )
    if data.get("amount") is not None:
        old_amount = Decimal(t.amount)
        new_amount = canonical_money_amount(data["amount"])
        if new_amount != old_amount:
            db.add(FinanceHistory(
                status="updated",
                ref_id=t.id,
                scope_kind="company",
                company_id=scope.tenant_id,
                organization_id=None,
                old_amount=old_amount,
                new_amount=new_amount,
                type=t.direction,
                user_id=user.id,
                comment=data.get("comment", t.comment),
            ))
        t.amount = new_amount
    if data.get("direction"):
        t.direction = data["direction"]
    if data.get("comment") is not None:
        t.comment = data["comment"]
    if data.get("category_id") is not None:
        t.category_id = data["category_id"]
    if data.get("finance_template_id") is not None:
        t.finance_template_id = data["finance_template_id"]
    await db.commit()
    await db.refresh(t)
    return _tx_dict(t)


# ── Финансы: категории доходов/расходов ──────────────────────────────────────
def _cat_dict(c: TransactionCategory) -> dict:
    return {"id": c.id, "name": c.name, "kind": c.kind, "status": c.status, "parent_id": c.parent_id,
            "is_system": c.scope_kind == "system"}


@router.get("/finance/transaction-categories", tags=["finance-kafe"])
async def kafe_list_categories(
    kind: str | None = Query(None),
    user: User = Depends(require_web_owner),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    rows, _ = await FinanceDictionaryService(
        TransactionCategory, db, system_enabled=True
    ).list(
        scope,
        PageParams(page=1, size=1_000_000),
        raw_filters={"kind": kind} if kind else None,
        default_sort="name",
    )
    return {"items": [_cat_dict(c) for c in rows]}


@router.post("/finance/transaction-categories", status_code=status.HTTP_201_CREATED, tags=["finance-kafe"])
async def kafe_create_category(
    data: dict,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    c = await FinanceDictionaryService(
        TransactionCategory, db, system_enabled=True
    ).create(
        TransactionCategoryCreate(
            name=data.get("name") or "Категория",
            kind=data.get("kind") or "income",
            status=bool(data.get("status", True)),
            parent_id=data.get("parent_id"),
            source_template_id=data.get("source_template_id"),
        ),
        scope,
    )
    return _cat_dict(c)


@router.patch("/finance/transaction-categories/{cat_id}", tags=["finance-kafe"])
async def kafe_update_category(
    cat_id: UUID,
    data: dict,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    c = await FinanceDictionaryService(
        TransactionCategory, db, system_enabled=True
    ).update(
        cat_id,
        TransactionCategoryUpdate.model_validate(data),
        scope,
    )
    return _cat_dict(c)


@router.get("/finance/transaction-categories/{cat_id}", tags=["finance-kafe"])
async def kafe_get_category(
    cat_id: UUID,
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    c = await FinanceDictionaryService(
        TransactionCategory, db, system_enabled=True
    ).get(cat_id, scope)
    return _cat_dict(c)


@router.delete("/finance/transaction-categories/{cat_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["finance-kafe"])
async def kafe_delete_category(
    cat_id: UUID,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    await FinanceDictionaryService(
        TransactionCategory, db, system_enabled=True
    ).delete(cat_id, scope)


def _org_dict(c: Company) -> dict:
    return {
        "id": c.id, "name": c.name, "slug": c.slug,
        "currency": c.currency, "timezone": c.timezone,
        "country_code": c.country_code, "vat_rate": 12, "service_fee": 0,
        "logo": c.logo_url, "address": c.address or "", "phone": c.phone or "",
    }


# ── Настройки: организация ───────────────────────────────────────────────────
@router.get("/settings/organization", tags=["settings"])
async def get_organization(user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    c = await db.get(Company, user.company_id)
    if not c:
        raise NotFoundError("Company not found")
    return _org_dict(c)


@router.patch("/settings/organization", tags=["settings"])
async def update_organization(data: dict, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    c = await db.get(Company, user.company_id)
    if not c:
        raise NotFoundError("Company not found")
    for field in ("name", "currency", "timezone", "country_code"):
        if data.get(field) is not None:
            setattr(c, field, data[field])
    await db.commit()
    await db.refresh(c)
    return _org_dict(c)


# ── Настройки: заведения (филиалы) ───────────────────────────────────────────
def _branch_dict(b: Branch) -> dict:
    return {"id": b.id, "name": b.name, "address": b.address, "city": b.city, "is_active": b.is_active}


@router.get("/settings/places", tags=["settings"])
async def list_places(user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Branch).where(Branch.company_id == user.company_id))).scalars().all()
    return {"items": [_branch_dict(b) for b in rows]}


@router.post("/settings/places", status_code=status.HTTP_201_CREATED, tags=["settings"])
async def create_place(data: dict, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    b = Branch(company_id=user.company_id, name=data.get("name") or "Филиал",
               address=data.get("address"), city=data.get("city"))
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return _branch_dict(b)


@router.patch("/settings/places/{item_id}", tags=["settings"])
async def update_place(item_id: UUID, data: dict, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    b = (
        await db.execute(
            select(Branch).where(Branch.id == item_id, Branch.company_id == user.company_id)
        )
    ).scalar_one_or_none()
    if not b:
        raise NotFoundError("Branch not found")
    for field in ("name", "address", "city", "is_active"):
        if data.get(field) is not None:
            setattr(b, field, data[field])
    await db.commit()
    await db.refresh(b)
    return _branch_dict(b)


@router.delete("/settings/places/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["settings"])
async def delete_place(item_id: UUID, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    b = (
        await db.execute(
            select(Branch).where(Branch.id == item_id, Branch.company_id == user.company_id)
        )
    ).scalar_one_or_none()
    if not b:
        raise NotFoundError("Branch not found")
    b.is_active = False
    await db.commit()


# ── Настройки: способы оплаты ────────────────────────────────────────────────
def _pm_dict(p: PaymentType) -> dict:
    return {"id": p.id, "name": p.name, "type": p.type, "sort": p.sort, "status": p.status,
            "sort_order": p.sort, "short_name": p.type, "is_system": p.scope_kind == "system" or p.source_template_id in DEFAULT_PAYMENT_IDS}


@router.get("/settings/payment-methods", tags=["settings"])
async def list_payment_methods(
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    rows, _ = await FinanceDictionaryService(
        PaymentType, db, system_enabled=True
    ).list(
        scope,
        PageParams(page=1, size=1_000_000),
        default_sort="sort",
    )
    return {"items": [_pm_dict(p) for p in rows]}


@router.post("/settings/payment-methods", status_code=status.HTTP_201_CREATED, tags=["settings"])
async def create_payment_method(
    data: dict,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    p = await FinanceDictionaryService(PaymentType, db, system_enabled=True).create(
        PaymentTypeCreate.model_validate({
            "name": data.get("name") or "Способ оплаты",
            "type": data.get("type"),
            "sort": int(data.get("sort") or data.get("sort_order") or 0),
            "status": bool(data.get("status", True)),
            "source_template_id": data.get("source_template_id"),
        }),
        scope,
    )
    return _pm_dict(p)


@router.patch("/settings/payment-methods/{item_id}", tags=["settings"])
async def update_payment_method(
    item_id: UUID,
    data: dict,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    p = await FinanceDictionaryService(PaymentType, db, system_enabled=True).update(
        item_id,
        PaymentTypeUpdate.model_validate(data),
        scope,
    )
    return _pm_dict(p)


@router.delete("/settings/payment-methods/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["settings"])
async def delete_payment_method(
    item_id: UUID,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    await FinanceDictionaryService(PaymentType, db, system_enabled=True).delete(
        item_id, scope
    )


@router.get("/settings/payment-methods/{item_id}", tags=["settings"])
async def get_payment_method(
    item_id: UUID,
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    p = await FinanceDictionaryService(PaymentType, db, system_enabled=True).get(
        item_id, scope
    )
    return _pm_dict(p)


# ── Настройки: шаблоны чеков (customer + kitchen) ────────────────────────────
async def _get_or_create_receipt_settings(db: AsyncSession, company_id: UUID) -> ReceiptTemplateSettings:
    row = (
        await db.execute(select(ReceiptTemplateSettings).where(ReceiptTemplateSettings.company_id == company_id))
    ).scalar_one_or_none()
    if row is None:
        row = ReceiptTemplateSettings(company_id=company_id, customer_template={}, kitchen_template={})
        db.add(row)
        await db.flush()
    return row


@router.get("/settings/receipt-template", tags=["settings"])
async def get_receipt_template(user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    row = (
        await db.execute(select(ReceiptTemplateSettings).where(ReceiptTemplateSettings.company_id == user.company_id))
    ).scalar_one_or_none()
    if not row:
        return {}
    return {**(row.customer_template or {}), "version": row.customer_version}


@router.patch("/settings/receipt-template", tags=["settings"])
async def update_receipt_template(
    data: ReceiptTemplateUpdate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)
):
    """BE-11: `version`, if sent, must match the stored version or this
    409s — the caller read a template that's since been changed by
    someone else. Omitting version keeps the old last-write-wins
    behavior (see ReceiptTemplateUpdate's docstring)."""
    row = await _get_or_create_receipt_settings(db, user.company_id)
    if data.version is not None and data.version != row.customer_version:
        raise ConflictError("Шаблон был изменён другим пользователем — обновите страницу и повторите")
    payload = data.model_dump(exclude={"version"}, exclude_unset=True)
    row.customer_template = {**(row.customer_template or {}), **payload}
    row.customer_version += 1
    await db.commit()
    await db.refresh(row)
    return {**(row.customer_template or {}), "version": row.customer_version}


@router.get("/settings/kitchen-receipt-template", tags=["settings"])
async def get_kitchen_receipt_template(user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    row = (
        await db.execute(select(ReceiptTemplateSettings).where(ReceiptTemplateSettings.company_id == user.company_id))
    ).scalar_one_or_none()
    if not row:
        return {}
    return {**(row.kitchen_template or {}), "version": row.kitchen_version}


@router.patch("/settings/kitchen-receipt-template", tags=["settings"])
async def update_kitchen_receipt_template(
    data: ReceiptTemplateUpdate, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)
):
    row = await _get_or_create_receipt_settings(db, user.company_id)
    if data.version is not None and data.version != row.kitchen_version:
        raise ConflictError("Шаблон был изменён другим пользователем — обновите страницу и повторите")
    payload = data.model_dump(exclude={"version"}, exclude_unset=True)
    row.kitchen_template = {**(row.kitchen_template or {}), **payload}
    row.kitchen_version += 1
    await db.commit()
    await db.refresh(row)
    return {**(row.kitchen_template or {}), "version": row.kitchen_version}


# ── CRM: контрагенты (клиенты/поставщики) ────────────────────────────────────
def _cp_dict(c: Counterparty) -> dict:
    return {"id": c.id, "name": c.full_name, "full_name": c.full_name, "phone": c.phone,
            "balance": float(c.balance or 0), "type": c.type, "kind": c.type}


@router.get("/crm/counterparties", tags=["crm"])
async def list_counterparties(
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    rows, _ = await FinanceDictionaryService(
        Counterparty, db, system_enabled=False
    ).list(
        scope,
        PageParams(page=1, size=1_000_000),
        default_sort="full_name",
    )
    return {"items": [_cp_dict(c) for c in rows]}


@router.post("/crm/counterparties", status_code=status.HTTP_201_CREATED, tags=["crm"])
async def create_counterparty(
    data: dict,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    c = await FinanceDictionaryService(Counterparty, db, system_enabled=False).create(
        CounterpartyCreate(
            full_name=data.get("full_name") or data.get("name") or "Контрагент",
            phone=data.get("phone"),
            balance=Decimal(data.get("balance") or 0),
            type=data.get("type") or data.get("kind") or "client",
        ),
        scope,
    )
    return _cp_dict(c)


@router.patch("/crm/counterparties/{item_id}", tags=["crm"])
async def update_counterparty(
    item_id: UUID,
    data: dict,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    normalized = dict(data)
    if "name" in normalized and "full_name" not in normalized:
        normalized["full_name"] = normalized.pop("name")
    if "kind" in normalized and "type" not in normalized:
        normalized["type"] = normalized.pop("kind")
    c = await FinanceDictionaryService(Counterparty, db, system_enabled=False).update(
        item_id,
        CounterpartyUpdate.model_validate(normalized),
        scope,
    )
    return _cp_dict(c)


@router.delete("/crm/counterparties/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["crm"])
async def delete_counterparty(
    item_id: UUID,
    user: User = Depends(require_company_admin),
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    await FinanceDictionaryService(Counterparty, db, system_enabled=False).delete(
        item_id, scope
    )


@router.get("/crm/counterparties/{item_id}", tags=["crm"])
async def get_counterparty(
    item_id: UUID,
    scope: FinanceScope = Depends(get_company_finance_scope),
    db: AsyncSession = Depends(get_db),
):
    c = await FinanceDictionaryService(Counterparty, db, system_enabled=False).get(
        item_id, scope
    )
    return _cp_dict(c)


# ── Биллинг: баланс подписки (для Topbar) ────────────────────────────────────
@router.get("/billing/balance", tags=["billing"])
async def billing_balance(user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    c = await db.get(Company, user.company_id) if user.company_id else None
    currency = c.currency if c else "UZS"
    row = (
        await db.execute(
            select(Subscription, Plan)
            .join(Plan, Plan.id == Subscription.plan_id)
            .where(Subscription.company_id == user.company_id)
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )
    ).first()
    if not row:
        return {"balance": 0, "currency": currency, "plan": None, "status": "none", "days_left": 0}

    subscription, plan = row
    unpaid = (
        await db.execute(
            select(func.coalesce(func.sum(Invoice.amount), 0)).where(
                Invoice.subscription_id == subscription.id,
                Invoice.status.in_(("draft", "open")),
            )
        )
    ).scalar_one()
    period_end = subscription.current_period_end or subscription.trial_ends_at
    days_left = 0
    if period_end:
        now = datetime.now(period_end.tzinfo) if period_end.tzinfo else datetime.utcnow()
        days_left = max((period_end - now).days, 0)
    return {
        "balance": -float(unpaid or 0),
        "currency": currency,
        "plan": plan.name,
        "status": subscription.status,
        "days_left": days_left,
        "subscription_id": subscription.id,
    }


# ── Поддержка: тикеты ────────────────────────────────────────────────────────
@router.post("/support/tickets", status_code=status.HTTP_201_CREATED, tags=["support"])
async def create_support_ticket(data: dict, user: User = Depends(require_company_app_user), db: AsyncSession = Depends(get_db)):
    ticket = SupportTicket(
        company_id=user.company_id, user_id=user.id,
        phone=data.get("phone"), country=data.get("country"),
        message=data.get("message") or "", status="new",
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)
    return {"id": ticket.id, "status": ticket.status, "created_at": ticket.created_at}

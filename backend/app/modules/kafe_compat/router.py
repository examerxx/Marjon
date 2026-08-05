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

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user, require_company_admin
from app.modules.auth.models import User
from app.modules.companies.models import Branch, Company
from app.modules.finance.models import Counterparty, FinTransaction, PaymentType, TransactionCategory
from app.modules.kafe_compat.models import ReceiptTemplateSettings, SupportTicket
from app.modules.kafe_compat.schemas import ReceiptTemplateUpdate
from app.shared.exceptions import ConflictError
from app.modules.pos.models import Order, OrderItem
from app.modules.subscriptions.models import Invoice, Plan, Subscription
from app.shared.exceptions import NotFoundError

router = APIRouter()


# ── Финансы: транзакции (company-scoped, без org-фильтра HQ-админки) ──────────
def _tx_dict(t: FinTransaction) -> dict:
    return {
        "id": t.id, "date": t.date, "amount": float(t.amount or 0), "direction": t.direction,
        "payment_type_id": t.payment_type_id, "counterparty_id": t.counterparty_id,
        "category_id": t.category_id, "comment": t.comment, "user_id": t.user_id,
        "payment_type_name": None, "counterparty_name": None, "category_name": None,
    }


@router.get("/finance/transactions", tags=["finance-kafe"])
async def kafe_list_transactions(
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    direction: str | None = Query(None),
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    # BE-04: was unfiltered (despite the module docstring claiming
    # "company-scoped") — every company saw every other company's transactions.
    q = select(FinTransaction).where(
        FinTransaction.deleted_at.is_(None),
        FinTransaction.company_id == user.company_id,
    )
    if date_from:
        q = q.where(func.date(FinTransaction.date) >= date_from)
    if date_to:
        q = q.where(func.date(FinTransaction.date) <= date_to)
    if direction:
        q = q.where(FinTransaction.direction == direction)
    rows = (await db.execute(q.order_by(FinTransaction.date.desc()))).scalars().all()
    return {"items": [_tx_dict(t) for t in rows], "count": len(rows)}


@router.post("/finance/transactions", status_code=status.HTTP_201_CREATED, tags=["finance-kafe"])
async def kafe_create_transaction(data: dict, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    t = FinTransaction(
        amount=abs(float(data.get("amount") or 0)),
        direction=data.get("direction") or "income",
        comment=data.get("comment"),
        category_id=data.get("category_id"),
        payment_type_id=data.get("payment_type_id"),
        counterparty_id=data.get("counterparty_id"),
        user_id=user.id,
        company_id=user.company_id,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _tx_dict(t)


@router.patch("/finance/transactions/{tx_id}", tags=["finance-kafe"])
async def kafe_update_transaction(tx_id: UUID, data: dict, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    t = await db.get(FinTransaction, tx_id)
    if not t or t.company_id != user.company_id:
        raise NotFoundError("Transaction not found")
    if data.get("amount") is not None:
        t.amount = abs(float(data["amount"]))
    if data.get("direction"):
        t.direction = data["direction"]
    if data.get("comment") is not None:
        t.comment = data["comment"]
    if data.get("category_id") is not None:
        t.category_id = data["category_id"]
    await db.commit()
    await db.refresh(t)
    return _tx_dict(t)


# ── Финансы: категории доходов/расходов ──────────────────────────────────────
def _cat_dict(c: TransactionCategory) -> dict:
    return {"id": c.id, "name": c.name, "kind": c.kind, "status": c.status, "parent_id": c.parent_id}


@router.get("/finance/transaction-categories", tags=["finance-kafe"])
async def kafe_list_categories(
    kind: str | None = Query(None),
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    q = select(TransactionCategory)
    if kind:
        q = q.where(TransactionCategory.kind == kind)
    rows = (await db.execute(q.order_by(TransactionCategory.name))).scalars().all()
    return {"items": [_cat_dict(c) for c in rows]}


@router.post("/finance/transaction-categories", status_code=status.HTTP_201_CREATED, tags=["finance-kafe"])
async def kafe_create_category(data: dict, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    c = TransactionCategory(
        name=data.get("name") or "Категория",
        kind=data.get("kind") or "income",
        status=bool(data.get("status", True)),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _cat_dict(c)


@router.patch("/finance/transaction-categories/{cat_id}", tags=["finance-kafe"])
async def kafe_update_category(cat_id: UUID, data: dict, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    c = await db.get(TransactionCategory, cat_id)
    if not c:
        raise NotFoundError("Category not found")
    if data.get("name"):
        c.name = data["name"]
    if data.get("kind"):
        c.kind = data["kind"]
    if data.get("status") is not None:
        c.status = bool(data["status"])
    await db.commit()
    await db.refresh(c)
    return _cat_dict(c)


def _org_dict(c: Company) -> dict:
    return {
        "id": c.id, "name": c.name, "slug": c.slug,
        "currency": c.currency, "timezone": c.timezone,
        "country_code": c.country_code, "vat_rate": 12, "service_fee": 0,
        "logo": c.logo_url, "address": c.address or "", "phone": c.phone or "",
    }


# ── Настройки: организация ───────────────────────────────────────────────────
@router.get("/settings/organization", tags=["settings"])
async def get_organization(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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
async def list_places(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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
    b = await db.get(Branch, item_id)
    if not b or b.company_id != user.company_id:
        raise NotFoundError("Branch not found")
    for field in ("name", "address", "city", "is_active"):
        if data.get(field) is not None:
            setattr(b, field, data[field])
    await db.commit()
    await db.refresh(b)
    return _branch_dict(b)


@router.delete("/settings/places/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["settings"])
async def delete_place(item_id: UUID, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    b = await db.get(Branch, item_id)
    if b and b.company_id == user.company_id:
        b.is_active = False
        await db.commit()


# ── Настройки: способы оплаты ────────────────────────────────────────────────
def _pm_dict(p: PaymentType) -> dict:
    return {"id": p.id, "name": p.name, "type": p.type, "sort": p.sort, "status": p.status,
            "sort_order": p.sort, "short_name": p.type}


@router.get("/settings/payment-methods", tags=["settings"])
async def list_payment_methods(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(PaymentType).order_by(PaymentType.sort))).scalars().all()
    return {"items": [_pm_dict(p) for p in rows]}


@router.post("/settings/payment-methods", status_code=status.HTTP_201_CREATED, tags=["settings"])
async def create_payment_method(data: dict, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    p = PaymentType(name=data.get("name") or "Способ оплаты", type=data.get("type"),
                    sort=int(data.get("sort") or data.get("sort_order") or 0),
                    status=bool(data.get("status", True)))
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _pm_dict(p)


@router.patch("/settings/payment-methods/{item_id}", tags=["settings"])
async def update_payment_method(item_id: UUID, data: dict, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    p = await db.get(PaymentType, item_id)
    if not p:
        raise NotFoundError("Payment type not found")
    if data.get("name") is not None:
        p.name = data["name"]
    if data.get("type") is not None:
        p.type = data["type"]
    if data.get("sort") is not None or data.get("sort_order") is not None:
        p.sort = int(data.get("sort") or data.get("sort_order") or 0)
    if data.get("status") is not None:
        p.status = bool(data["status"])
    await db.commit()
    await db.refresh(p)
    return _pm_dict(p)


@router.delete("/settings/payment-methods/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["settings"])
async def delete_payment_method(item_id: UUID, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    p = await db.get(PaymentType, item_id)
    if p:
        await db.delete(p)
        await db.commit()


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
async def get_receipt_template(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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
async def get_kitchen_receipt_template(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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
async def list_counterparties(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Counterparty).where(Counterparty.deleted_at.is_(None)))).scalars().all()
    return {"items": [_cp_dict(c) for c in rows]}


@router.post("/crm/counterparties", status_code=status.HTTP_201_CREATED, tags=["crm"])
async def create_counterparty(data: dict, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    c = Counterparty(full_name=data.get("full_name") or data.get("name") or "Контрагент",
                     phone=data.get("phone"), type=data.get("type") or data.get("kind") or "client")
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _cp_dict(c)


@router.patch("/crm/counterparties/{item_id}", tags=["crm"])
async def update_counterparty(item_id: UUID, data: dict, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    c = await db.get(Counterparty, item_id)
    if not c:
        raise NotFoundError("Counterparty not found")
    if data.get("full_name") or data.get("name"):
        c.full_name = data.get("full_name") or data.get("name")
    if data.get("phone") is not None:
        c.phone = data["phone"]
    if data.get("type") or data.get("kind"):
        c.type = data.get("type") or data.get("kind")
    await db.commit()
    await db.refresh(c)
    return _cp_dict(c)


@router.delete("/crm/counterparties/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["crm"])
async def delete_counterparty(item_id: UUID, user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    c = await db.get(Counterparty, item_id)
    if c:
        c.deleted_at = datetime.utcnow()
        await db.commit()


# ── Биллинг: баланс подписки (для Topbar) ────────────────────────────────────
@router.get("/billing/balance", tags=["billing"])
async def billing_balance(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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
async def create_support_ticket(data: dict, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ticket = SupportTicket(
        company_id=user.company_id, user_id=user.id,
        phone=data.get("phone"), country=data.get("country"),
        message=data.get("message") or "", status="new",
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)
    return {"id": ticket.id, "status": ticket.status, "created_at": ticket.created_at}


# ── Отчёты ресторана (агрегация из заказов) ──────────────────────────────────
def _order_date_filter(q, date_from: date | None, date_to: date | None):
    if date_from:
        q = q.where(func.date(Order.created_at) >= date_from)
    if date_to:
        q = q.where(func.date(Order.created_at) <= date_to)
    return q


@router.get("/reports/orders", tags=["reports-kafe"])
async def report_orders(
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    q = _order_date_filter(select(Order).where(Order.company_id == user.company_id), date_from, date_to)
    orders = (await db.execute(q.order_by(Order.created_at.desc()))).scalars().all()
    items = [{
        "id": o.id, "order_number": o.order_number, "order_type": o.order_type,
        "status": o.status, "table_number": o.table_number,
        "total": float(o.total_amount or 0), "total_amount": float(o.total_amount or 0),
        "subtotal": float(o.subtotal or 0), "guests": o.persons_count,
        "created_at": o.created_at,
    } for o in orders]
    total = sum(i["total"] for i in items)
    return {"items": items, "count": len(items), "total": total}


@router.get("/reports/waiters", tags=["reports-kafe"])
async def report_waiters(
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    q = _order_date_filter(
        select(
            Order.waiter_id,
            func.coalesce(func.sum(Order.total_amount), 0),
            func.count(Order.id),
        ).where(Order.company_id == user.company_id, Order.status != "cancelled"),
        date_from, date_to,
    ).group_by(Order.waiter_id)
    rows = (await db.execute(q)).all()
    items = []
    for waiter_id, total, cnt in rows:
        name = "—"
        if waiter_id:
            u = await db.get(User, waiter_id)
            if u:
                name = u.name or (u.email.split("@")[0] if u.email else "—")
        items.append({
            "id": str(waiter_id) if waiter_id else "unknown", "name": name,
            "orders": float(total or 0), "orders_total": float(total or 0),
            "takeaway": 0, "service": 0, "waiterService": 0,
            "dishes": int(cnt or 0), "dishes_count": int(cnt or 0), "orders_count": int(cnt or 0),
        })
    return {"items": items}


@router.get("/reports/tables", tags=["reports-kafe"])
async def report_tables(
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    q = _order_date_filter(
        select(
            Order.table_number,
            func.coalesce(func.sum(Order.total_amount), 0),
            func.count(Order.id),
        ).where(Order.company_id == user.company_id, Order.order_type == "dine_in"),
        date_from, date_to,
    ).group_by(Order.table_number)
    rows = (await db.execute(q)).all()
    items = [{
        "id": (tn or "—"), "table_number": tn or "—", "name": f"Стол {tn}" if tn else "—",
        "orders": int(cnt or 0), "orders_count": int(cnt or 0),
        "total": float(total or 0), "revenue": float(total or 0),
    } for tn, total, cnt in rows]
    return {"items": items}


@router.get("/reports/dishes", tags=["reports-kafe"])
async def report_dishes(
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    q = (
        select(
            OrderItem.name,
            func.coalesce(func.sum(OrderItem.quantity), 0),
            func.coalesce(func.sum(OrderItem.total), 0),
            func.count(OrderItem.id),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.company_id == user.company_id, OrderItem.status != "cancelled")
        .group_by(OrderItem.name)
    )
    if date_from:
        q = q.where(func.date(Order.created_at) >= date_from)
    if date_to:
        q = q.where(func.date(Order.created_at) <= date_to)
    rows = (await db.execute(q.order_by(func.sum(OrderItem.quantity).desc()))).all()
    items = [{
        "id": name, "name": name,
        "quantity": float(qty or 0), "count": int(cnt or 0),
        "total": float(total or 0), "revenue": float(total or 0),
    } for name, qty, total, cnt in rows]
    return {"items": items}


@router.get("/reports/cancelled", tags=["reports-kafe"])
async def report_cancelled(
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    q = (
        select(OrderItem, Order.order_number, Order.created_at)
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.company_id == user.company_id, OrderItem.status == "cancelled")
    )
    if date_from:
        q = q.where(func.date(Order.created_at) >= date_from)
    if date_to:
        q = q.where(func.date(Order.created_at) <= date_to)
    rows = (await db.execute(q)).all()
    items = [{
        "id": it.id, "name": it.name, "quantity": float(it.quantity or 0),
        "total": float(it.total or 0), "order_number": onum,
        "reason": it.note or "", "created_at": created,
    } for it, onum, created in rows]
    return {"items": items}

"""DEBT-ORDERS-01: заказы клиента для карточки в справочнике «Клиенты».

Закрытие счёта «в долг» заводит контрагента (Counterparty), но сам заказ с ним
не связан: в таблице orders нет counterparty_id. Поэтому связь восстанавливаем
по журналу аудита — событие `order.debt_client` пишет имя и телефон должника
(а с этой правки ещё и id контрагента). Имя/телефон нужны для уже
существующих долгов, id даёт точное совпадение для новых.

Отдаём ровно то, что видно в отчёте по заказам: номер, дату, сумму, оплату,
остаток долга и статус — по строке кликом открывается чек.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditLog
from app.modules.auth.models import User
from app.modules.payments.models import Payment
from app.modules.pos.models import Order, OrderItem
from app.shared.web_time import web_date_conditions

DEBT_AUDIT_ACTION = "order.debt_client"


def _digits(value: object) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _phone_key(value: object) -> str:
    """Последние 9 цифр — телефон сравниваем без кода страны и разделителей."""
    digits = _digits(value)
    return digits[-9:] if len(digits) >= 9 else digits


def _name_key(value: object) -> str:
    return " ".join(str(value or "").split()).lower()


def _audit_matches(new_data: object, counterparty_id: UUID, name_key: str, phone_key: str) -> bool:
    if not isinstance(new_data, dict):
        return False
    stored_id = str(new_data.get("counterparty_id") or "").strip()
    if stored_id and stored_id == str(counterparty_id):
        return True
    if phone_key and _phone_key(new_data.get("client_phone")) == phone_key:
        return True
    stored_name = _name_key(new_data.get("client_name"))
    return bool(name_key) and stored_name == name_key


async def _linked_order_ids(
    db: AsyncSession, company_id: UUID, counterparty
) -> list[UUID]:
    """id заказов, закрытых «в долг» именно на этого контрагента."""
    rows = (
        await db.execute(
            select(AuditLog.entity_id, AuditLog.new_data).where(
                AuditLog.company_id == company_id,
                AuditLog.action == DEBT_AUDIT_ACTION,
                AuditLog.entity_id.is_not(None),
            )
        )
    ).all()
    name_key = _name_key(getattr(counterparty, "full_name", None))
    phone_key = _phone_key(getattr(counterparty, "phone", None))
    if not name_key and not phone_key:
        return []
    ids: list[UUID] = []
    seen: set[UUID] = set()
    for entity_id, new_data in rows:
        if entity_id in seen:
            continue
        if _audit_matches(new_data, counterparty.id, name_key, phone_key):
            seen.add(entity_id)
            ids.append(entity_id)
    return ids


async def list_counterparty_orders(
    db: AsyncSession,
    company_id: UUID,
    counterparty,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    """Заказы клиента за период (долговые — единственные, что с ним связаны)."""
    order_ids = await _linked_order_ids(db, company_id, counterparty)
    if not order_ids:
        return []

    items_count = (
        select(func.count(OrderItem.id))
        .where(OrderItem.order_id == Order.id, OrderItem.status != "cancelled")
        .correlate(Order)
        .scalar_subquery()
    )
    paid_amount = (
        select(func.coalesce(func.sum(Payment.amount), 0))
        .where(
            Payment.company_id == company_id,
            Payment.order_id == Order.id,
            Payment.status == "completed",
        )
        .correlate(Order)
        .scalar_subquery()
    )
    query = (
        select(
            Order.id,
            Order.public_id,
            Order.order_number,
            Order.created_at,
            Order.status,
            Order.order_type,
            Order.table_number,
            Order.hall_name_snapshot,
            Order.total_amount,
            items_count.label("items_count"),
            paid_amount.label("paid_amount"),
            User.name.label("waiter_name"),
        )
        .outerjoin(User, and_(User.id == Order.waiter_id, User.company_id == company_id))
        .where(Order.company_id == company_id, Order.id.in_(order_ids))
        .order_by(Order.created_at.desc())
    )
    if date_from or date_to:
        query = query.where(*web_date_conditions(Order.created_at, date_from, date_to))
    rows = (await db.execute(query)).all()
    if not rows:
        return []

    methods: dict[UUID, list[str]] = {}
    method_rows = (
        await db.execute(
            select(Payment.order_id, Payment.method)
            .where(
                Payment.company_id == company_id,
                Payment.order_id.in_([row.id for row in rows]),
                Payment.status == "completed",
            )
            .order_by(Payment.created_at)
        )
    ).all()
    for order_id, method in method_rows:
        bucket = methods.setdefault(order_id, [])
        if method and method not in bucket:
            bucket.append(method)

    result: list[dict] = []
    for row in rows:
        total = Decimal(str(row.total_amount or 0))
        paid = Decimal(str(row.paid_amount or 0))
        debt = total - paid
        result.append(
            {
                "order_id": row.id,
                "public_id": row.public_id,
                "order_number": row.order_number,
                "created_at": row.created_at,
                "status": row.status,
                "order_type": row.order_type,
                "table_number": row.table_number,
                "hall_name": row.hall_name_snapshot,
                "items_count": int(row.items_count or 0),
                "total_amount": total,
                "paid_amount": paid,
                "debt_amount": debt if debt > 0 else Decimal("0"),
                "payment_methods": methods.get(row.id, []),
                "waiter_name": row.waiter_name,
            }
        )
    return result

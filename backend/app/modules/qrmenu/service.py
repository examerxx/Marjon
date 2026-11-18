"""QR-меню: публичное меню заведения и счёт стола по QR-коду.

Ссылка на стол содержит подписанный токен (HMAC от id стола), а не номер:
подставить «стол 1, 2, 3…» и посмотреть чужие счета нельзя. Токен не хранится
в базе — он считается из id стола и секрета приложения, поэтому работает для
всех существующих столов без миграции.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.modules.companies.models import Branch, Company
from app.modules.halls.models import Hall, Table
from app.modules.inventory.models import Category, Product
from app.modules.payments.models import Payment
from app.modules.pos.models import Order
from app.modules.pos.order_staff import resolve_receipt_staff
from app.shared.exceptions import NotFoundError

_CLOSED = ("completed", "cancelled")


def table_token(table_id: UUID) -> str:
    key = (settings.secret_key or "").encode()
    sig = hmac.new(key, f"qr-table:{table_id}".encode(), hashlib.sha256).hexdigest()[:20]
    return f"{table_id.hex}{sig}"


def parse_table_token(token: str) -> UUID | None:
    if not token or len(token) != 52:
        return None
    try:
        table_id = UUID(hex=token[:32])
    except ValueError:
        return None
    return table_id if hmac.compare_digest(table_token(table_id), token) else None


# Короткий код стола для QR: 7 символов base32 (A–Z, 2–7), тоже HMAC от id стола и секрета.
# Ссылка вида HTTPS://ADMIN.MARJON.TECH/T/K7Q2M9X целиком из «буквенно-цифрового» набора QR,
# поэтому кодируется плотнее и QR получается крупным (сетка 29×29 вместо 53×53 при уровне H).
# 35 бит — подобрать чужой код перебором при частотном лимите нереально. В базе код не хранится:
# соответствие «код → стол» держим в памяти процесса и пересчитываем при промахе.
SHORT_CODE_LEN = 7
_SHORT_REBUILD_SECONDS = 5.0
_short_cache: dict[str, UUID] = {}
_short_built_at = 0.0


def table_short_code(table_id: UUID) -> str:
    key = (settings.secret_key or "").encode()
    digest = hmac.new(key, f"qr-short:{table_id}".encode(), hashlib.sha256).digest()
    return base64.b32encode(digest).decode()[:SHORT_CODE_LEN]


def normalize_short_code(code: str) -> str | None:
    code = (code or "").strip().upper()
    if len(code) != SHORT_CODE_LEN or any(ch not in _B32 for ch in code):
        return None
    return code


_B32 = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")


def _money(value) -> str:
    return str(Decimal(str(value or 0)).quantize(Decimal("0.01")))


def accepted_stamp(created_at: datetime | None, tz_name: str | None, now: datetime | None = None) -> dict:
    """Когда заказ принят — в часовом поясе заведения (а не телефона гостя).

    Время в базе хранится в UTC (без tz — тоже UTC). Если пояс заведения не задан или
    неверный, берём Ташкент: платформа работает на рынке Узбекистана."""
    if created_at is None:
        return {"accepted_time": None, "accepted_date": None, "accepted_today": None}
    try:
        tz = ZoneInfo(tz_name or "Asia/Tashkent")
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo("Asia/Tashkent")
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    local = created_at.astimezone(tz)
    today = (now or datetime.now(timezone.utc)).astimezone(tz).date()
    return {
        "accepted_time": local.strftime("%H:%M"),
        "accepted_date": local.strftime("%d.%m.%y"),
        "accepted_today": local.date() == today,
    }


class QrMenuService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _company(self, slug: str) -> Company:
        company = (await self.db.execute(
            select(Company).where(Company.slug == slug, Company.is_active.is_(True))
        )).scalar_one_or_none()
        if not company and slug:
            # QR меню кодируется заглавными (/M/SARDOR) — ищем без учёта регистра,
            # но только если такое заведение одно.
            matches = (await self.db.execute(
                select(Company).where(func.lower(Company.slug) == slug.lower(), Company.is_active.is_(True)).limit(2)
            )).scalars().all()
            company = matches[0] if len(matches) == 1 else None
        if not company:
            raise NotFoundError("Menu not found")
        return company

    async def resolve_short_code(self, code: str) -> dict:
        """Короткий код стола → адрес заведения и полный токен стола."""
        global _short_built_at
        normalized = normalize_short_code(code)
        if not normalized:
            raise NotFoundError("Table not found")
        table_id = _short_cache.get(normalized)
        if table_id is None and time.monotonic() - _short_built_at > _SHORT_REBUILD_SECONDS:
            ids = (await self.db.execute(select(Table.id))).scalars().all()
            _short_cache.clear()
            _short_cache.update({table_short_code(tid): tid for tid in ids})
            _short_built_at = time.monotonic()
            table_id = _short_cache.get(normalized)
        if table_id is None:
            raise NotFoundError("Table not found")
        row = (await self.db.execute(
            select(Company.slug)
            .join(Hall, Hall.company_id == Company.id)
            .join(Table, Table.hall_id == Hall.id)
            .where(Table.id == table_id, Table.is_active.is_(True), Hall.deleted_at.is_(None),
                   Company.is_active.is_(True))
        )).first()
        if not row:
            raise NotFoundError("Table not found")
        return {"slug": row[0], "token": table_token(table_id)}

    async def menu(self, slug: str) -> dict:
        company = await self._company(slug)
        categories = (await self.db.execute(
            select(Category).where(Category.company_id == company.id, Category.is_active.is_(True))
            .order_by(Category.sort_order, Category.name)
        )).scalars().all()
        products = (await self.db.execute(
            select(Product).where(
                Product.company_id == company.id,
                Product.is_active.is_(True),
                Product.product_type.in_(("dish", "sale")),
            ).order_by(Product.sort_order, Product.name)
        )).scalars().all()
        by_category: dict = {}
        for product in products:
            by_category.setdefault(product.category_id, []).append({
                "id": str(product.id),
                "name": product.name,
                "description": product.description,
                "price": _money(product.price),
                "image_url": product.image_url,
                "available": bool(product.is_available),
            })
        result = [
            {"id": str(c.id), "name": c.name, "items": by_category.pop(c.id)}
            for c in categories if c.id in by_category
        ]
        leftovers = [item for items in by_category.values() for item in items]
        if leftovers:
            result.append({"id": "other", "name": "Другое", "items": leftovers})
        return {
            "company": {
                "name": company.name, "logo_url": company.logo_url,
                "address": company.address, "phone": company.phone,
                "currency": company.currency or "UZS",
            },
            "categories": result,
        }

    async def _table(self, company: Company, token: str):
        table_id = parse_table_token(token)
        if not table_id:
            raise NotFoundError("Table not found")
        row = (await self.db.execute(
            select(Table, Hall, Branch.name)
            .join(Hall, Hall.id == Table.hall_id)
            .outerjoin(Branch, Branch.id == Hall.branch_id)
            .where(Table.id == table_id, Hall.company_id == company.id,
                   Table.is_active.is_(True), Hall.deleted_at.is_(None))
        )).first()
        if not row:
            raise NotFoundError("Table not found")
        return row

    async def table_info(self, slug: str, token: str) -> dict:
        company = await self._company(slug)
        table, hall, branch_name = await self._table(company, token)
        return {"number": table.number, "hall": hall.name, "branch": branch_name}

    async def table_order(self, slug: str, token: str) -> dict:
        """Открытый счёт стола: блюда, начисления, оплачено и остаток."""
        company = await self._company(slug)
        table, _hall, _branch = await self._table(company, token)
        orders = (await self.db.execute(
            select(Order).options(selectinload(Order.items))
            .where(Order.company_id == company.id, Order.table_id == table.id,
                   Order.status.notin_(_CLOSED))
            .order_by(Order.created_at)
        )).scalars().all()
        if not orders:
            return {"open": False}
        items = []
        for order in orders:
            for item in order.items:
                if item.status == "cancelled" or not item.quantity or item.quantity <= 0:
                    continue
                items.append({
                    "name": item.name, "quantity": str(item.quantity.normalize()),
                    "price": _money(item.price), "total": _money(item.total),
                })
        total = sum((Decimal(str(o.total_amount or 0)) for o in orders), Decimal(0))
        paid = Decimal(str(await self.db.scalar(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.company_id == company.id,
                Payment.order_id.in_([o.id for o in orders]),
                Payment.status == "completed",
            )) or 0))
        first_created = min((o.created_at for o in orders if o.created_at), default=None)
        # Персонал — ровно как на бумажном чеке: «Кассир», если заказ принял кассир, «Официант» —
        # если официант (роль определяет тот же код, что печатает чек). Только отображаемое имя:
        # никаких логинов, телефонов и почты.
        by_order = await resolve_receipt_staff(self.db, company.id, orders)
        merged: dict[str, list[str]] = {}
        for order in orders:
            for row in by_order.get(order.id, []):
                names = merged.setdefault(row["label"], [])
                for name in row["name"].split(", "):
                    if name and name not in names:
                        names.append(name)
        staff = [{"label": label, "name": ", ".join(names)} for label, names in merged.items()]
        return {
            "open": True,
            "staff": staff,
            **accepted_stamp(first_created, company.timezone),
            "items": items,
            "subtotal": _money(sum((Decimal(str(o.subtotal or 0)) for o in orders), Decimal(0))),
            "discount": _money(sum((Decimal(str(o.discount_amount or 0)) for o in orders), Decimal(0))),
            "service_fee": _money(sum((Decimal(str(o.service_fee or 0)) for o in orders), Decimal(0))),
            "total": _money(total),
            "paid": _money(paid),
            "remaining": _money(max(Decimal(0), total - paid)),
        }

    async def admin_tables(self, company_id: UUID) -> dict:
        company = await self.db.get(Company, company_id)
        if not company:
            raise NotFoundError("Company not found")
        rows = (await self.db.execute(
            select(Table, Hall, Branch.name)
            .join(Hall, Hall.id == Table.hall_id)
            .outerjoin(Branch, Branch.id == Hall.branch_id)
            .where(Hall.company_id == company_id, Table.is_active.is_(True),
                   Hall.is_active.is_(True), Hall.deleted_at.is_(None))
            .order_by(Branch.name, Hall.sort_order, Table.number)
        )).all()
        return {
            "slug": company.slug, "company_name": company.name,
            "tables": [
                {"table_id": str(t.id), "number": t.number, "hall": h.name,
                 "branch": branch_name, "token": table_token(t.id), "short_code": table_short_code(t.id)}
                for t, h, branch_name in rows
            ],
        }

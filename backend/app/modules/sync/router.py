"""Офлайн-синхронизация кассы: снимок справочников, дельты и персонал.

Эндпоинты не заменяют существующие POS/меню-роуты — они отдают терминалу
данные одним пакетом для локальной SQLite и дельты по времени. Все запросы
ограничены компанией (и филиалом для терминала).
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import require_company_app_user, require_staff_lister
from app.modules.auth.models import User
from app.modules.companies.models import Branch, Company
from app.modules.halls.models import Hall, Table
from app.modules.inventory.models import Category, Product
from app.modules.pos.models import CashierShift, Order
from app.modules.pos.schemas import OrderResponse
from app.modules.printers.models import Printer
from app.modules.rbac.models import Role, UserRole
from app.modules.rbac.service import RBACService
from app.shared.exceptions import ForbiddenError, ValidationError

router = APIRouter(prefix="/sync", tags=["sync"])


def _branch_id_for(user: User, requested: UUID | None) -> UUID | None:
    own = getattr(user, "branch_id", None)
    if own and requested and requested != own:
        raise ForbiddenError("Терминал может синхронизировать только свой филиал")
    return own or requested


def _product_dto(p: Product) -> dict:
    return {
        "id": str(p.id),
        "name": p.name,
        "price": str(p.price),
        "category_id": str(p.category_id) if p.category_id else None,
        "subcategory_id": str(p.subcategory_id) if p.subcategory_id else None,
        "unit": p.unit,
        "tax_rate": str(p.tax_rate),
        "product_type": p.product_type,
        "printer_id": str(p.printer_id) if p.printer_id else None,
        "image_url": p.image_url,
        "description": p.description,
        "unit_id": str(p.unit_id) if p.unit_id else None,
        "sort_order": p.sort_order,
        "is_active": p.is_active,
        "is_available": p.is_available,
        "portion_step": str(p.portion_step) if p.portion_step is not None else None,
        # D3: лимит/остаток нужны стоп-листу, который кассир открывает офлайн.
        "daily_limit": str(p.daily_limit) if p.daily_limit is not None else None,
        "sold_count": str(p.sold_count or 0),
        "is_set": p.is_set,
        "is_auto": p.is_auto,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _category_dto(c: Category) -> dict:
    return {
        "id": str(c.id),
        "name": c.name,
        "parent_id": str(c.parent_id) if c.parent_id else None,
        "image_url": c.image_url,
        "sort_order": c.sort_order,
        "is_active": c.is_active,
        "show_in_menu": c.show_in_menu,
    }


def _hall_dto(h: Hall) -> dict:
    return {
        "id": str(h.id),
        "name": h.name,
        "sort_order": h.sort_order,
        "is_active": h.is_active,
        "percent": str(h.percent) if h.percent is not None else None,
        "tables": [
            {
                "id": str(t.id),
                "number": t.number,
                "capacity": t.capacity,
                "x": t.x,
                "y": t.y,
                "is_active": t.is_active,
            }
            for t in sorted(h.tables, key=lambda t: t.number)
            if t.is_active
        ],
    }


def _printer_dto(p: Printer) -> dict:
    return {
        "id": str(p.id),
        "name": p.name,
        "printer_type": p.printer_type,
        "connection_type": p.connection_type,
        "ip_address": p.ip_address,
        "port": p.port,
        "device_path": p.device_path,
        "paper_width": p.paper_width,
        "zone": p.zone,
        "is_active": p.is_active,
        "settings": p.settings or {},
    }


@router.get("/bootstrap")
async def bootstrap(
    branch_id: UUID | None = Query(None),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Полный снимок для локальной БД терминала (старт и раз в 30 минут)."""
    scoped_branch = _branch_id_for(user, branch_id)
    if scoped_branch is None:
        raise ValidationError("branch_id обязателен для синхронизации")

    branch = (
        await db.execute(
            select(Branch).where(
                Branch.id == scoped_branch,
                Branch.company_id == user.company_id,
            )
        )
    ).scalar_one_or_none()
    if branch is None:
        raise ValidationError("Филиал не найден")

    company = (
        await db.execute(select(Company).where(Company.id == user.company_id))
    ).scalar_one()

    categories = list((await db.execute(
        select(Category).where(Category.company_id == user.company_id)
    )).scalars().all())
    products = list((await db.execute(
        select(Product).where(
            Product.company_id == user.company_id,
            Product.is_active.is_(True),
        )
    )).scalars().all())
    halls = list((await db.execute(
        select(Hall)
        .where(
            Hall.company_id == user.company_id,
            Hall.branch_id == scoped_branch,
            Hall.deleted_at.is_(None),
        )
        .options(selectinload(Hall.tables))
        .order_by(Hall.sort_order)
    )).scalars().all())
    printers = list((await db.execute(
        select(Printer).where(
            Printer.company_id == user.company_id,
            Printer.branch_id == scoped_branch,
            Printer.is_active.is_(True),
        )
    )).scalars().all())

    return {
        "server_time": datetime.now(timezone.utc).isoformat(),
        "branch_id": str(branch.id),
        "branch_name": branch.name,
        "company": {
            "id": str(company.id),
            "name": company.name,
            "currency": company.currency,
            "timezone": company.timezone,
            "vat_rate": str(company.vat_rate) if company.vat_rate is not None else None,
            "service_fee": str(company.service_fee) if company.service_fee is not None else None,
            "order_types": company.order_types,
            "receipt_template": company.receipt_template,
            "kitchen_receipt_template": company.kitchen_receipt_template,
        },
        "categories": [_category_dto(c) for c in categories],
        "products": [_product_dto(p) for p in products],
        "halls": [_hall_dto(h) for h in halls],
        "printers": [_printer_dto(p) for p in printers],
    }


@router.get("/changes")
async def changes(
    since: datetime | None = Query(None),
    branch_id: UUID | None = Query(None),
    limit: int = Query(500, ge=1, le=1000),
    user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Дельта после последней синхронизации: заказы, блюда/стоп-лист, смены."""
    scoped_branch = _branch_id_for(user, branch_id)
    if scoped_branch is None:
        raise ValidationError("branch_id обязателен для синхронизации")

    # Первый опрос (since=None) — это только установка курсора. Без ветки ниже
    # ORDER BY updated_at ASC + LIMIT отдавал бы САМЫЕ СТАРЫЕ заказы филиала,
    # и локальная база терминала забивалась бы позавчерашней историей вместо
    # актуального зала. На старте зал приходит из кэша/бутстрапа, а дальше —
    # только дельты после курсора.
    orders: list[Order] = []
    has_more = False
    if since is not None:
        order_query = (
            select(Order)
            .where(
                Order.company_id == user.company_id,
                Order.branch_id == scoped_branch,
                Order.updated_at > since,
            )
            .options(selectinload(Order.items))
            .order_by(Order.updated_at)
            .limit(limit + 1)
        )
        orders = list((await db.execute(order_query)).scalars().all())
        has_more = len(orders) > limit
        orders = orders[:limit]

    product_query = select(Product).where(
        Product.company_id == user.company_id,
        Product.is_active.is_(True),
    )
    if since is not None:
        product_query = product_query.where(Product.updated_at > since)
    products = list((await db.execute(product_query)).scalars().all())

    shift_query = select(CashierShift).where(
        CashierShift.company_id == user.company_id,
        CashierShift.branch_id == scoped_branch,
    )
    if since is not None:
        shift_query = shift_query.where(CashierShift.updated_at > since)
    shifts = list((await db.execute(shift_query)).scalars().all())

    return {
        "server_time": datetime.now(timezone.utc).isoformat(),
        "has_more": has_more,
        "orders": [OrderResponse.model_validate(o).model_dump(mode="json") for o in orders],
        "products": [_product_dto(p) for p in products],
        "shifts": [
            {
                "id": str(s.id),
                "branch_id": str(s.branch_id),
                "cashier_id": str(s.cashier_id),
                "opened_at": s.opened_at.isoformat() if s.opened_at else None,
                "closed_at": s.closed_at.isoformat() if s.closed_at else None,
                "opening_cash": str(s.opening_cash),
                "closing_cash": str(s.closing_cash) if s.closing_cash is not None else None,
                "status": s.status,
            }
            for s in shifts
        ],
    }


@router.get("/staff")
async def staff(
    branch_id: UUID | None = Query(None),
    user: User = Depends(require_staff_lister),
    db: AsyncSession = Depends(get_db),
):
    """PIN-хэши и права для офлайн-входа. Только bcrypt-хэши, без открытых PIN.

    Доступ — тот же, что у /auth/staff-users (владелец или моноблок), поэтому
    список ограничен компанией и, для терминала, своим филиалом.
    """
    scoped_branch = _branch_id_for(user, branch_id)
    from app.modules.auth.repository import UserRepository
    from app.modules.auth.security import is_terminal_email

    users = await UserRepository(db).get_company_users(user.company_id)
    rbac = RBACService(db)
    result = []
    for employee in users:
        if employee.is_superadmin or is_terminal_email(employee.email):
            continue
        if scoped_branch is not None and employee.branch_id not in (None, scoped_branch):
            continue
        slugs = list((await db.execute(
            select(Role.slug)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == employee.id)
        )).scalars().all())
        result.append({
            "id": str(employee.id),
            "name": employee.name,
            "phone": employee.phone,
            "branch_id": str(employee.branch_id) if employee.branch_id else None,
            "role_slugs": slugs,
            "is_active": employee.is_active,
            "pin_hash": employee.pin_hash,
            "pin_updated_at": employee.updated_at.isoformat() if employee.updated_at else None,
            "permissions": await rbac.get_user_permissions(employee.id, employee.company_id),
        })
    return {
        "server_time": datetime.now(timezone.utc).isoformat(),
        "staff": result,
    }

#!/usr/bin/env python3
"""
Seed script for Marjon POS.
Usage: cd backend && python seed.py

Creates:
  - Company: Marjon Restaurant
  - Branches: Главный зал, Терраса
  - Users:  admin / kassir / ofitsiant / kuxna / bar
  - Categories + Products (food & drinks)
  - Printers for each branch
"""
import asyncio
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import select, text
from app.infrastructure.database.session import AsyncSessionLocal
from app.modules.auth.models import User
from app.modules.auth.security import hash_password
from app.modules.companies.models import Branch, Company
from app.modules.inventory.models import Category, Product
# Product.unit_id ссылается на nm_units, User.printer_id — на printers, и т.д.
# Единый реестр гарантирует, что все таблицы-FK-цели зарегистрированы, иначе
# SQLAlchemy падает с NoReferencedTableError на первом же запросе.
import app.infrastructure.database.models_registry  # noqa: F401
from app.modules.printers.models import Printer
from app.modules.rbac.models import Role, UserRole


# ── Data ─────────────────────────────────────────────────────────────────────

COMPANY_SLUG = "marjon"
COMPANY_NAME = "Marjon Restaurant"

BRANCHES = [
    {"name": "Главный зал", "address": "ул. Навои 12, Ташкент", "city": "Ташкент"},
    {"name": "Терраса",     "address": "ул. Навои 12 (терраса)", "city": "Ташкент"},
]

USERS = [
    # (email, name, phone, password, role_slug, role_name)
    ("admin@marjon.uz",      "Админ",         "+998901234567", "Admin1234",  "owner",     "Owner"),
    ("kassir@marjon.uz",     "Касса",          "+998901234568", "Staff1234",  "cashier",   "Cashier"),
    ("ofitsiant@marjon.uz",  "Официант",       "+998901234569", "Staff1234",  "waiter",    "Waiter"),
    ("kuxna@marjon.uz",      "Повар",          "+998901234570", "Staff1234",  "kitchen",   "Kitchen"),
    ("bar@marjon.uz",        "Бармен",         "+998901234571", "Staff1234",  "bar",       "Bar"),
]

CATEGORIES = [
    "Горячие блюда",
    "Салаты",
    "Супы",
    "Пицца",
    "Гарниры",
    "Напитки",
    "Десерты",
]

PRODUCTS = [
    # (name, category, price)
    ("Лагман",               "Горячие блюда",  45_000),
    ("Плов по-узбекски",     "Горячие блюда",  55_000),
    ("Люля-кебаб (3 шт)",   "Горячие блюда",  65_000),
    ("Шашлык из говядины",   "Горячие блюда",  70_000),
    ("Манты (6 шт)",         "Горячие блюда",  40_000),

    ("Салат Цезарь",         "Салаты",         38_000),
    ("Греческий салат",      "Салаты",         35_000),
    ("Овощной микс",         "Салаты",         28_000),

    ("Шурпа",                "Супы",           30_000),
    ("Борщ",                 "Супы",           28_000),

    ("Маргарита",            "Пицца",          60_000),
    ("Пепперони",            "Пицца",          75_000),
    ("4 сыра",               "Пицца",          80_000),

    ("Картофель фри",        "Гарниры",        22_000),
    ("Рис отварной",         "Гарниры",        18_000),

    ("Чай зелёный (чайник)", "Напитки",        15_000),
    ("Чай чёрный (чайник)",  "Напитки",        15_000),
    ("Кофе эспрессо",        "Напитки",        18_000),
    ("Капучино",             "Напитки",        22_000),
    ("Кола 0.5л",            "Напитки",        12_000),
    ("Вода 0.5л",            "Напитки",         8_000),
    ("Айран",                "Напитки",        10_000),

    ("Мороженое (3 шарика)", "Десерты",        25_000),
    ("Наполеон",             "Десерты",        30_000),
    ("Чизкейк",              "Десерты",        35_000),
]

PRINTERS = [
    # (name, printer_type, ip)
    ("Принтер касса",    "receipt",  "192.168.1.101"),
    ("Принтер кухня",    "kitchen",  "192.168.1.102"),
    ("Принтер бар",      "bar",      "192.168.1.103"),
    ("Принтер официант", "waiter",   "192.168.1.104"),
]


# ── Helpers ───────────────────────────────────────────────────────────────────

async def get_or_none(db, model, **filters):
    q = select(model)
    for k, v in filters.items():
        q = q.where(getattr(model, k) == v)
    return (await db.execute(q)).scalar_one_or_none()


# ── Main ──────────────────────────────────────────────────────────────────────

async def seed():
    async with AsyncSessionLocal() as db:
        print("--- Company ---")
        company = await get_or_none(db, Company, slug=COMPANY_SLUG)
        if company:
            print(f"  already exists: {company.name}")
        else:
            company = Company(name=COMPANY_NAME, slug=COMPANY_SLUG,
                              country_code="UZ", timezone="Asia/Tashkent", currency="UZS")
            db.add(company)
            await db.flush()
            print(f"  created: {company.name}  id={company.id}")

        print("--- Branches ---")
        branch_objects: list[Branch] = []
        for b in BRANCHES:
            branch = await get_or_none(db, Branch, company_id=company.id, name=b["name"])
            if branch:
                print(f"  already exists: {branch.name}")
            else:
                branch = Branch(company_id=company.id, **b)
                db.add(branch)
                await db.flush()
                print(f"  created: {branch.name}  id={branch.id}")
            branch_objects.append(branch)

        main_branch = branch_objects[0]

        print("--- Users & Roles ---")
        for email, name, phone, password, role_slug, role_name in USERS:
            user = await get_or_none(db, User, email=email)
            if user:
                print(f"  already exists: {email}")
                continue

            user = User(
                company_id=company.id,
                email=email,
                name=name,
                phone=phone,
                password_hash=await hash_password(password),
                is_active=True,
            )
            db.add(user)
            await db.flush()

            # Role
            role = await get_or_none(db, Role, company_id=company.id, slug=role_slug)
            if not role:
                role = Role(company_id=company.id, slug=role_slug, name=role_name, is_system=False)
                db.add(role)
                await db.flush()

            # Assign to main branch
            user_role = UserRole(user_id=user.id, role_id=role.id, branch_id=main_branch.id)
            db.add(user_role)
            await db.flush()
            print(f"  created: {email}  role={role_slug}")

        print("--- Categories ---")
        cat_map: dict[str, Category] = {}
        for cat_name in CATEGORIES:
            cat = await get_or_none(db, Category, company_id=company.id, name=cat_name)
            if cat:
                print(f"  already exists: {cat_name}")
            else:
                slug = cat_name.lower().replace(" ", "-").replace("ё", "e")
                cat = Category(company_id=company.id, name=cat_name, slug=slug)
                db.add(cat)
                await db.flush()
                print(f"  created: {cat_name}")
            cat_map[cat_name] = cat

        print("--- Products ---")
        for prod_name, cat_name, price in PRODUCTS:
            existing = await get_or_none(db, Product, company_id=company.id, name=prod_name)
            if existing:
                print(f"  already exists: {prod_name}")
                continue
            cat = cat_map[cat_name]
            product = Product(
                company_id=company.id,
                category_id=cat.id,
                name=prod_name,
                price=Decimal(str(price)),
                # Демо-себестоимость 35% от цены: без неё заказ не сохраняет
                # cost_price_snapshot и «Чистая прибыль» на дашборде владельца
                # честно показывает «Недоступно» (историческая себестоимость
                # не записана). В реальном заведении владелец ставит свою.
                cost_price=Decimal(str(price)) * Decimal("0.35"),
                unit="шт",
                is_active=True,
                is_available=True,
            )
            db.add(product)
            print(f"  created: {prod_name}  ({price:,} сум)")
        await db.flush()

        print("--- Printers ---")
        for pr_name, pr_type, ip in PRINTERS:
            existing = await get_or_none(db, Printer,
                                         company_id=company.id, branch_id=main_branch.id,
                                         name=pr_name)
            if existing:
                print(f"  already exists: {pr_name}")
                continue
            printer = Printer(
                company_id=company.id,
                branch_id=main_branch.id,
                name=pr_name,
                printer_type=pr_type,
                connection_type="network",
                ip_address=ip,
                port=9100,
                paper_width=80,
            )
            db.add(printer)
            print(f"  created: {pr_name}  ({ip})")

        await db.commit()
        print()
        print("OK Seed complete!")
        print()
        print("  Credentials:")
        print("  admin@marjon.uz   / Admin1234  (owner)")
        print("  kassir@marjon.uz  / Staff1234  (cashier)")
        print("  ofitsiant@marjon.uz / Staff1234 (waiter)")
        print("  kuxna@marjon.uz   / Staff1234  (kitchen)")
        print("  bar@marjon.uz     / Staff1234  (bar)")


if __name__ == "__main__":
    asyncio.run(seed())

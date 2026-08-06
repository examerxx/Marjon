#!/usr/bin/env python3
"""BE-24: development test data seed.

Usage: cd backend && python scripts/seed_dev_data.py

Creates everything needed to exercise the whole system locally without
hand-rolling test accounts through curl/docker exec every time (a real,
repeated friction point during this backend's own security work — every
HQ-admin-gated endpoint needed a superadmin account that plain `seed.py`
never created):

  - a platform admin (is_superadmin=True — logs in via /auth/admin/login)
  - Company A (with a branch) + owner + manager/cashier/waiter/kitchen/
    warehouse staff — the full canonical role_slug set (BE-05)
  - Company B — a second, otherwise-empty tenant, specifically so a
    developer/tester has two real companies on hand for tenant-isolation
    checks (BE-03) without registering one by hand first
  - one test printer on Company A's branch

Requirements this satisfies (spec's BE-24):
  - refuses to run outside development (checks settings.debug — hard
    guard, not a suggestion)
  - idempotent — every entity is check-then-create, safe to re-run
  - no password is hardcoded in source. Each one is read from an
    environment variable (SEED_*_PASSWORD, see the table below) if set;
    otherwise a random one is generated for that run and printed once at
    the end (not written to any log file) so the developer can note it
    down or copy it into their .env for next time.
"""
from __future__ import annotations

import asyncio
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select

from app.config import settings
from app.infrastructure.database.session import AsyncSessionLocal
from app.modules.auth.models import User
from app.modules.auth.security import hash_password
from app.modules.companies.models import Branch, Company
from app.modules.printers.models import Printer
from app.modules.rbac.constants import COMPANY_ROLE_SLUGS
from app.modules.rbac.models import Role, UserRole
from app.modules.rbac.permissions import sync_role_permissions

import os

COMPANY_A_SLUG = "marjon-dev-a"
COMPANY_B_SLUG = "marjon-dev-b"

# (env var name, email, role_slug, display name)
STAFF = [
    ("SEED_OWNER_PASSWORD", "owner@dev.marjon.local", "owner", "Owner"),
    ("SEED_MANAGER_PASSWORD", "manager@dev.marjon.local", "manager", "Manager"),
    ("SEED_CASHIER_PASSWORD", "cashier@dev.marjon.local", "cashier", "Cashier"),
    ("SEED_WAITER_PASSWORD", "waiter@dev.marjon.local", "waiter", "Waiter"),
    ("SEED_KITCHEN_PASSWORD", "kitchen@dev.marjon.local", "kitchen", "Kitchen"),
    ("SEED_WAREHOUSE_PASSWORD", "warehouse@dev.marjon.local", "warehouse", "Warehouse"),
]
SUPERADMIN_EMAIL = "platformadmin@dev.marjon.local"


def _resolve_password(env_var: str) -> tuple[str, bool]:
    """Returns (password, was_generated). Never hardcoded — read from the
    environment (put it in your local .env to get the same password on
    every re-run) or generated fresh for this run."""
    value = os.environ.get(env_var)
    if value:
        return value, False
    return secrets.token_urlsafe(12), True


async def _get_or_create_user(db, *, email, name, password, company_id=None, is_superadmin=False) -> tuple[User, bool]:
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user:
        return user, False
    user = User(
        email=email, name=name, company_id=company_id,
        password_hash=hash_password(password), is_active=True, is_superadmin=is_superadmin,
    )
    db.add(user)
    await db.flush()
    return user, True


async def _get_or_create_role(db, *, company_id, slug, name) -> Role:
    role = (
        await db.execute(select(Role).where(Role.company_id == company_id, Role.slug == slug))
    ).scalar_one_or_none()
    if role:
        return role
    role = Role(company_id=company_id, slug=slug, name=name, is_system=False)
    db.add(role)
    await db.flush()
    await sync_role_permissions(db, role)
    return role


async def _get_or_create_company(db, *, slug, name) -> tuple[Company, bool]:
    company = (await db.execute(select(Company).where(Company.slug == slug))).scalar_one_or_none()
    if company:
        return company, False
    company = Company(slug=slug, name=name, country_code="UZ", timezone="Asia/Tashkent", currency="UZS")
    db.add(company)
    await db.flush()
    return company, True


async def seed() -> None:
    if not settings.debug:
        print("Refusing to run: DEBUG is not enabled (this seeds fake accounts with "
              "real, working passwords — never run this against a production database).")
        sys.exit(1)

    credentials: list[tuple[str, str, str]] = []  # (label, email, password)

    async with AsyncSessionLocal() as db:
        print("--- Platform admin ---")
        sa_password, sa_generated = _resolve_password("SEED_SUPERADMIN_PASSWORD")
        sa_user, sa_created = await _get_or_create_user(
            db, email=SUPERADMIN_EMAIL, name="Platform Admin",
            password=sa_password, is_superadmin=True,
        )
        if not sa_created:
            print(f"  already exists: {SUPERADMIN_EMAIL}")
            sa_password = None  # unknown — existing hash, don't claim to know it
        else:
            print(f"  created: {SUPERADMIN_EMAIL}")
            credentials.append(("Platform admin (POST /auth/admin/login)", SUPERADMIN_EMAIL, sa_password))
        await db.commit()

        print("--- Company A ---")
        company_a, created = await _get_or_create_company(db, slug=COMPANY_A_SLUG, name="Marjon Dev Co A")
        print(f"  {'created' if created else 'already exists'}: {company_a.name}")

        branch = (
            await db.execute(select(Branch).where(Branch.company_id == company_a.id))
        ).scalars().first()
        if not branch:
            branch = Branch(company_id=company_a.id, name="Main", address="Tashkent", city="Tashkent")
            db.add(branch)
            await db.flush()
            print("  created branch: Main")
        else:
            print(f"  already exists branch: {branch.name}")
        await db.commit()

        print("--- Company A staff (canonical role_slugs) ---")
        for env_var, email, role_slug, display_name in STAFF:
            assert role_slug in COMPANY_ROLE_SLUGS, role_slug  # stay honest about the allowlist
            password, generated = _resolve_password(env_var)
            user, created = await _get_or_create_user(
                db, email=email, name=display_name, password=password, company_id=company_a.id,
            )
            if not created:
                print(f"  already exists: {email}")
                continue
            role = await _get_or_create_role(db, company_id=company_a.id, slug=role_slug, name=display_name)
            db.add(UserRole(user_id=user.id, role_id=role.id, branch_id=branch.id))
            await db.commit()
            print(f"  created: {email} ({role_slug})")
            credentials.append((f"{display_name} (Company A, POST /auth/login)", email, password))

        print("--- Company A test printer ---")
        printer = (
            await db.execute(select(Printer).where(Printer.company_id == company_a.id))
        ).scalars().first()
        if not printer:
            db.add(Printer(
                company_id=company_a.id, branch_id=branch.id, name="Dev Kitchen Printer",
                printer_type="kitchen", connection_type="network", ip_address="192.168.1.200", port=9100,
            ))
            await db.commit()
            print("  created: Dev Kitchen Printer")
        else:
            print(f"  already exists: {printer.name}")

        print("--- Company B (second tenant, for tenant-isolation checks) ---")
        company_b, created = await _get_or_create_company(db, slug=COMPANY_B_SLUG, name="Marjon Dev Co B")
        print(f"  {'created' if created else 'already exists'}: {company_b.name}")
        b_owner_password, _ = _resolve_password("SEED_COMPANY_B_OWNER_PASSWORD")
        b_owner, created = await _get_or_create_user(
            db, email="owner@dev-b.marjon.local", name="Owner B",
            password=b_owner_password, company_id=company_b.id,
        )
        if created:
            role_b = await _get_or_create_role(db, company_id=company_b.id, slug="owner", name="Owner")
            db.add(UserRole(user_id=b_owner.id, role_id=role_b.id))
            await db.commit()
            print("  created: owner@dev-b.marjon.local (owner)")
            credentials.append(("Owner (Company B, POST /auth/login)", "owner@dev-b.marjon.local", b_owner_password))
        else:
            print("  already exists: owner@dev-b.marjon.local")

    print()
    print("=" * 70)
    if credentials:
        print("Credentials for accounts created THIS run (not logged anywhere —")
        print("copy these into your local .env as SEED_*_PASSWORD to reuse them):")
        for label, email, password in credentials:
            print(f"  {label:<42} {email:<32} {password}")
    else:
        print("Nothing new created — all seed accounts already existed.")
        print("(Passwords for pre-existing accounts are not recoverable from this")
        print(" script; set SEED_*_PASSWORD in .env and delete+re-run if you need")
        print(" known credentials.)")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(seed())

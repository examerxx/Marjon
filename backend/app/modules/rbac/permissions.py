"""
Default permissions for the system.
Seeded on first run via `seed_permissions()`.
"""
from __future__ import annotations
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.rbac.models import Permission

# (module, action, scope)
DEFAULT_PERMISSIONS: list[tuple[str, str, str]] = [
    # POS
    ("pos", "orders:create", "branch"),
    ("pos", "orders:read", "branch"),
    ("pos", "orders:update", "branch"),
    ("pos", "orders:cancel", "branch"),
    # Inventory
    ("inventory", "products:create", "company"),
    ("inventory", "products:read", "company"),
    ("inventory", "products:update", "company"),
    ("inventory", "categories:create", "company"),
    ("inventory", "categories:read", "company"),
    ("inventory", "stock:read", "company"),
    ("inventory", "stock:write", "company"),
    # Payments
    ("payments", "process", "branch"),
    ("payments", "read", "branch"),
    # Kitchen
    ("kitchen", "orders:read", "branch"),
    ("kitchen", "items:update", "branch"),
    ("kitchen", "stations:manage", "company"),
    # CRM
    ("crm", "customers:read", "company"),
    ("crm", "customers:write", "company"),
    # HR
    ("hr", "employees:read", "company"),
    ("hr", "employees:write", "company"),
    ("hr", "shifts:manage", "company"),
    # Analytics
    ("analytics", "dashboard", "company"),
    ("analytics", "reports", "company"),
    # Delivery
    ("delivery", "orders:manage", "company"),
    ("delivery", "couriers:manage", "company"),
    # Notifications
    ("notifications", "send", "company"),
    ("notifications", "read", "self"),
    # Audit
    ("audit", "read", "company"),
    # Fiscal
    ("fiscal", "receipts:manage", "company"),
    # Subscriptions
    ("subscriptions", "manage", "company"),
    # Printers
    ("printers", "manage", "company"),
    ("printers", "print", "branch"),
    # RBAC
    ("rbac", "roles:manage", "company"),
    ("rbac", "users:manage", "company"),
    # Companies
    ("companies", "manage", "company"),
    ("companies", "branches:manage", "company"),
]


async def seed_permissions(db: AsyncSession) -> int:
    """Insert default permissions if they don't exist. Returns count of new rows."""
    created = 0
    for module, action, scope in DEFAULT_PERMISSIONS:
        exists = await db.execute(
            select(Permission).where(
                Permission.module == module,
                Permission.action == action,
                Permission.scope == scope,
            )
        )
        if not exists.scalar_one_or_none():
            db.add(Permission(module=module, action=action, scope=scope))
            created += 1
    if created:
        await db.commit()
    return created

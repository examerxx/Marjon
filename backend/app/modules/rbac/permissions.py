"""
Default permissions for the system.
Seeded on first run via `seed_permissions()`.
"""
from __future__ import annotations
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.rbac.models import Permission, Role, RolePermission

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
    # Finance (BE-05: owner/company-level accounting — payment types,
    # counterparties, finance templates. Distinct from `payments` above,
    # which is POS-side "take a payment on an order".)
    ("finance", "manage", "company"),
    ("finance", "read", "company"),
]


# BE-05: default permission set per canonical company role slug (see
# rbac/constants.py::COMPANY_ROLE_SLUGS). "*" means "every seeded
# permission". Applied the first time a role with that slug is created for
# a company (RBACService.get_or_create_company_role / create_role) and
# backfilled once at startup for roles that already existed before this
# feature (see backfill_role_permissions, called from main.py's lifespan).
#
# This is a reasonable operational default, not a hard business rule — a
# company admin can still add/remove individual permissions afterwards via
# POST/DELETE /rbac/roles/{id}/permissions without this list overriding
# their choice (sync only ever ADDS missing links, never removes one).
DEFAULT_ROLE_PERMISSIONS: dict[str, list[str]] = {
    "owner": ["*"],
    "admin": ["*"],
    "manager": [
        "pos:orders:create", "pos:orders:read", "pos:orders:update", "pos:orders:cancel",
        "inventory:products:create", "inventory:products:read", "inventory:products:update",
        "inventory:categories:create", "inventory:categories:read",
        "inventory:stock:read", "inventory:stock:write",
        "payments:process", "payments:read",
        "kitchen:orders:read", "kitchen:items:update", "kitchen:stations:manage",
        "crm:customers:read", "crm:customers:write",
        "hr:employees:read", "hr:employees:write", "hr:shifts:manage",
        "analytics:dashboard", "analytics:reports",
        "delivery:orders:manage", "delivery:couriers:manage",
        "notifications:send", "notifications:read",
        "finance:manage", "finance:read",
        "printers:manage", "printers:print",
    ],
    "cashier": [
        "pos:orders:create", "pos:orders:read", "pos:orders:update",
        "payments:process", "payments:read",
        "crm:customers:read",
        "finance:read",
        "notifications:read",
        "printers:print",
    ],
    "waiter": [
        "pos:orders:create", "pos:orders:read", "pos:orders:update",
        "kitchen:orders:read",
        "crm:customers:read",
        "notifications:read",
        "printers:print",
    ],
    "kitchen": [
        "kitchen:orders:read", "kitchen:items:update",
        "inventory:stock:read",
        "notifications:read",
    ],
    "monoblock": [
        "pos:orders:create", "pos:orders:read", "pos:orders:update",
        "kitchen:orders:read",
        "payments:process", "payments:read",
        "printers:print",
        "notifications:read",
    ],
    "courier": [
        "delivery:orders:manage",
        "pos:orders:read",
        "notifications:read",
    ],
    "warehouse": [
        "inventory:products:create", "inventory:products:read", "inventory:products:update",
        "inventory:categories:create", "inventory:categories:read",
        "inventory:stock:read", "inventory:stock:write",
        "notifications:read",
    ],
}


async def seed_permissions(db: AsyncSession) -> int:
    """Insert default permissions if they don't exist. Returns count of new
    rows.

    BE-25: runs from every backend instance's own startup (main.py's
    lifespan) — with more than one instance booting at once (a rolling
    deploy), two instances can both SELECT "not found" for the same
    permission before either COMMITs, then both try to INSERT it. Each
    row is added and flushed inside its own SAVEPOINT (begin_nested)
    specifically so that race only costs the LOSING instance that one
    row — caught as an IntegrityError on the unique (module, action,
    scope) constraint and skipped — instead of aborting the whole batch's
    single outer transaction and silently dropping every other
    permission that boot would have seeded. Portable across Postgres
    (prod) and SQLite (tests) — no dialect-specific ON CONFLICT clause."""
    from sqlalchemy.exc import IntegrityError

    created = 0
    for module, action, scope in DEFAULT_PERMISSIONS:
        exists = await db.execute(
            select(Permission).where(
                Permission.module == module,
                Permission.action == action,
                Permission.scope == scope,
            )
        )
        if exists.scalar_one_or_none():
            continue
        try:
            async with db.begin_nested():
                db.add(Permission(module=module, action=action, scope=scope))
                await db.flush()
        except IntegrityError:
            continue  # another instance won the race for this one row
        created += 1
    if created:
        await db.commit()
    return created


async def sync_role_permissions(db: AsyncSession, role: Role) -> int:
    """Idempotently attach `role`'s default permission set (looked up by
    `role.slug` in DEFAULT_ROLE_PERMISSIONS) via RolePermission rows. Only
    ADDS missing links — never removes a link a company admin may have
    customized afterwards. Returns the number of new links created."""
    wanted = DEFAULT_ROLE_PERMISSIONS.get(role.slug)
    if not wanted:
        return 0

    all_perms = list((await db.execute(select(Permission))).scalars().all())
    if wanted == ["*"]:
        wanted_perms = all_perms
    else:
        wanted_set = set(wanted)
        wanted_perms = [p for p in all_perms if f"{p.module}:{p.action}" in wanted_set]

    existing_ids = {
        row[0] for row in (
            await db.execute(
                select(RolePermission.permission_id).where(RolePermission.role_id == role.id)
            )
        ).all()
    }
    created = 0
    for perm in wanted_perms:
        if perm.id not in existing_ids:
            db.add(RolePermission(role_id=role.id, permission_id=perm.id))
            created += 1
    if created:
        await db.commit()
    return created


async def backfill_role_permissions(db: AsyncSession) -> int:
    """Startup task (see main.py lifespan): attach default permissions to
    every EXISTING role whose slug is a canonical company role slug but
    predates this feature (so it has zero RolePermission rows). Idempotent
    — safe to run on every boot."""
    from app.modules.rbac.constants import COMPANY_ROLE_SLUGS

    roles = list((
        await db.execute(select(Role).where(Role.slug.in_(COMPANY_ROLE_SLUGS)))
    ).scalars().all())
    total = 0
    for role in roles:
        total += await sync_role_permissions(db, role)
    return total

"""
Enable Row Level Security on all public tables.

Why: Supabase exposes all public tables via PostgREST (auto-generated REST API).
Without RLS, any anon/authenticated client can query the data directly.
Our FastAPI backend connects as the postgres superuser which BYPASSES RLS,
so enabling RLS only blocks the Supabase auto-API — our app is unaffected.
"""
from __future__ import annotations
import asyncio
import os
from dotenv import load_dotenv
import asyncpg

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")

# Strip SQLAlchemy driver prefix for asyncpg
PG_DSN = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

TABLES = [
    "companies", "branches",
    "users", "refresh_tokens",
    "roles", "permissions", "role_permissions", "user_roles",
    "categories", "products", "modifier_groups", "modifiers", "product_branch",
    "ingredients", "warehouses", "stock_items", "stock_movements",
    "customers", "customer_notes",
    "orders", "order_items",
    "payments",
    "kitchen_stations",
    "loyalty_accounts", "loyalty_transactions",
    "delivery_zones", "couriers", "delivery_orders",
    "employees", "work_shifts", "attendance_logs",
    "notifications",
    "audit_logs",
    "fiscal_receipts",
    "plans", "subscriptions", "invoices",
    "pos_terminals",
]


async def main() -> None:
    conn = await asyncpg.connect(PG_DSN, ssl="require", statement_cache_size=0)
    try:
        for table in TABLES:
            await conn.execute(
                f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;"
            )
            print(f"  [OK] RLS enabled: {table}")

        # Allow our service-role (postgres superuser) full access.
        # Superusers bypass RLS by default — this policy is for
        # the `authenticated` role if you ever use Supabase Auth.
        print("\nAll done. Postgres superuser bypasses RLS automatically.")
        print("PostgREST anon/authenticated roles are now blocked.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())

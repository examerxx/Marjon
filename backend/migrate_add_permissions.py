#!/usr/bin/env python3
"""Идемпотентная миграция: права/принтер/филиал у сотрудника + спец-пароль отмены.

Добавляет колонки:
  users: branch_id, printer_ip, nfc_id, permissions
  companies: cancel_password

Запускать один раз:  cd backend && python migrate_add_permissions.py
Данные не теряются (ALTER TABLE ADD COLUMN). Если таблицы нет — пропускает.
"""
import asyncio
from app.infrastructure.database.session import engine

# {table: {column: {dialect: ddl}}}
PLAN = {
    "users": {
        "branch_id":          {"sqlite": "CHAR(32)", "postgresql": "UUID"},
        "printer_ip":         {"sqlite": "VARCHAR(45)", "postgresql": "VARCHAR(45)"},
        "nfc_id":             {"sqlite": "VARCHAR(64)", "postgresql": "VARCHAR(64)"},
        "permissions":        {"sqlite": "TEXT", "postgresql": "JSON"},
        "avatar_url":         {"sqlite": "VARCHAR(512)", "postgresql": "VARCHAR(512)"},
        "pin_hash":           {"sqlite": "VARCHAR(255)", "postgresql": "VARCHAR(255)"},
        "pin_failed_attempts": {
            "sqlite": "INTEGER NOT NULL DEFAULT 0",
            "postgresql": "INTEGER NOT NULL DEFAULT 0",
        },
        "pin_locked_until":   {"sqlite": "TIMESTAMP", "postgresql": "TIMESTAMPTZ"},
    },
    "companies": {
        "cancel_password": {"sqlite": "VARCHAR(64)", "postgresql": "VARCHAR(64)"},
        "waiter_service_percent": {"sqlite": "INTEGER DEFAULT 0", "postgresql": "INTEGER DEFAULT 0"},
        "address": {"sqlite": "TEXT", "postgresql": "TEXT"},
        "phone": {"sqlite": "VARCHAR(32)", "postgresql": "VARCHAR(32)"},
        "inn": {"sqlite": "VARCHAR(32)", "postgresql": "VARCHAR(32)"},
        "logo_url": {"sqlite": "VARCHAR(512)", "postgresql": "VARCHAR(512)"},
        "logo_key": {"sqlite": "VARCHAR(255)", "postgresql": "VARCHAR(255)"},
        "vat_rate": {"sqlite": "NUMERIC(5, 2)", "postgresql": "NUMERIC(5, 2)"},
        "service_fee": {"sqlite": "NUMERIC(5, 2)", "postgresql": "NUMERIC(5, 2)"},
    },
    "orders": {
        "customer_phone":     {"sqlite": "VARCHAR(30)", "postgresql": "VARCHAR(30)"},
        "customer_address":   {"sqlite": "TEXT", "postgresql": "TEXT"},
        "receipt_printed_at": {"sqlite": "TIMESTAMP", "postgresql": "TIMESTAMPTZ"},
    },
    "order_items": {
        "takeaway": {"sqlite": "BOOLEAN DEFAULT 0", "postgresql": "BOOLEAN DEFAULT FALSE"},
    },
}


async def existing_columns(conn, dialect, table):
    if dialect == "sqlite":
        rows = (await conn.exec_driver_sql(f"PRAGMA table_info({table})")).fetchall()
        return {r[1] for r in rows}, bool(rows)
    rows = (await conn.exec_driver_sql(
        f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}'"
    )).fetchall()
    return {r[0] for r in rows}, bool(rows)


async def main():
    dialect = engine.dialect.name
    added = []
    async with engine.begin() as conn:
        for table, cols in PLAN.items():
            existing, table_exists = await existing_columns(conn, dialect, table)
            if not table_exists:
                print(f"Таблицы {table} нет — пропускаю (создаст create_tables.py).")
                continue
            for col, ddl_by_dialect in cols.items():
                if col in existing:
                    continue
                ddl = ddl_by_dialect.get(dialect, ddl_by_dialect["sqlite"])
                await conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
                added.append(f"{table}.{col}")

    # Бэкфилл PIN: хешируем существующие plaintext-PIN (bcrypt) и стираем открытый pin_code.
    # Идемпотентно: берём только строки, где pin_code задан, а pin_hash ещё пуст.
    from sqlalchemy import text
    # Unified seam: base-era hash_pin no longer exists; canonical backend
    # hashes PINs with hash_password (see AuthService.set_pin).
    from app.modules.auth.security import hash_password as hash_pin
    migrated = 0
    async with engine.begin() as conn:
        existing, table_exists = await existing_columns(conn, dialect, "users")
        if table_exists and {"pin_code", "pin_hash"} <= existing:
            rows = (await conn.execute(text(
                "SELECT id, pin_code FROM users "
                "WHERE pin_code IS NOT NULL AND pin_code <> '' AND pin_hash IS NULL"
            ))).fetchall()
            for row in rows:
                await conn.execute(
                    text("UPDATE users SET pin_hash = :h, pin_code = NULL WHERE id = :id"),
                    {"h": hash_pin(str(row[1])), "id": row[0]},
                )
                migrated += 1
    if migrated:
        print(f"PIN: перенесено в хеш и очищено {migrated} plaintext-PIN")

    print(f"Готово. Добавлены колонки: {added or 'нет (уже все на месте)'}")


if __name__ == "__main__":
    asyncio.run(main())

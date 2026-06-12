"""Smoke-тест главной админки: SQLite in-memory, основные сценарии ТЗ.

Запуск:  python scripts/smoke_admin.py
"""
import asyncio
import io
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

os.environ.setdefault("DEBUG", "true")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./smoke_admin.db")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def main() -> None:
    import httpx

    from app.infrastructure.database.session import engine, AsyncSessionLocal
    from app.shared.base_model import Base
    from app.main import app
    from app.modules.auth.models import User
    from app.modules.auth.security import hash_password

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        db.add(User(
            email="root@admin.local", username="root", name="Root",
            password_hash=hash_password("Passw0rd1"), is_superadmin=True,
        ))
        await db.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test/api/v1") as client:
        failures = []

        def check(label, response, expect=200):
            ok = response.status_code == expect
            print(f"{'OK ' if ok else 'FAIL'} [{response.status_code}] {label}")
            if not ok:
                print("     ", response.text[:300])
                failures.append(label)
            return response

        # login по username
        r = check("login", await client.post("/auth/login", json={"email": "root", "password": "Passw0rd1"}))
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # handbook
        r = check("create country", await client.post("/countries", json={"name": "Узбекистан"}, headers=headers), 201)
        country_id = r.json()["id"]
        r = check("create region", await client.post("/regions", json={"name": "Ташкент", "country_id": country_id}, headers=headers), 201)
        region_id = r.json()["id"]
        check("list regions filtered", await client.get(f"/regions?country_id={country_id}", headers=headers))

        # organizations
        r = check("create organization", await client.post("/organizations", json={"name": "Кафе №1", "tariff_price": 100000}, headers=headers), 201)
        org_id = r.json()["id"]
        check("list organizations", await client.get("/organizations?search=Кафе", headers=headers))

        # account c M2M
        r = check("create account", await client.post("/accounts", json={
            "username": "manager1", "password": "Passw0rd1", "name": "Менеджер",
            "organization_ids": [org_id],
        }, headers=headers), 201)
        assert r.json()["organization_ids"] == [org_id], "M2M организации не сохранились"

        # marketing
        r = check("create lead status", await client.post("/lead-statuses", json={"name": "Новый"}, headers=headers), 201)
        status_id = r.json()["id"]
        r = check("create source", await client.post("/sources", json={"name": "Instagram"}, headers=headers), 201)
        source_id = r.json()["id"]
        r = check("create lead", await client.post("/leads", json={
            "customer_name": "Алишер", "phones": ["+998901234567"],
            "status_id": status_id, "source_id": source_id, "region_id": region_id,
            "organization_id": org_id,
        }, headers=headers), 201)
        check("lead statistics", await client.get("/leads/statistics", headers=headers))

        # nomenclature + storage
        r = check("create unit", await client.post("/units", json={"name": "Штука", "short_name": "шт"}, headers=headers), 201)
        unit_id = r.json()["id"]
        r = check("create product", await client.post("/products", json={"name": "Терминал", "price": 500, "unit_id": unit_id}, headers=headers), 201)
        product_id = r.json()["id"]
        check("archive product list", await client.get("/products/archive", headers=headers))

        r = check("create storage", await client.post("/storages", json={"name": "Основной склад", "organization_id": org_id}, headers=headers), 201)
        storage_id = r.json()["id"]
        r = check("create coming", await client.post("/comings", json={
            "number": "C-001", "storage_id": storage_id,
            "items": [{"product_id": product_id, "price": 400, "qty": 10}],
        }, headers=headers), 201)
        coming_id = r.json()["id"]
        assert float(r.json()["total_sum"]) == 4000, "total_sum поступления не рассчитан"
        check("accept coming", await client.post(f"/comings/{coming_id}/accept", headers=headers))
        check("accept twice -> 409", await client.post(f"/comings/{coming_id}/accept", headers=headers), 409)

        # расход со склада + отчёты
        check("expense movement", await client.post("/storage-movements", json={
            "storage_id": storage_id, "product_id": product_id,
            "direction": "expense", "qty": 3, "price": 600,
        }, headers=headers), 201)
        r = check("storage balances", await client.get("/reports/storage-balances", headers=headers))
        row = r.json()[0]
        assert float(row["closing_qty"]) == 7, f"остаток должен быть 7, получено {row['closing_qty']}"
        r = check("products report", await client.get("/reports/products", headers=headers))
        prow = r.json()[0]
        assert float(prow["profit"]) == 600.0, f"прибыль 3*(600-400)=600, получено {prow['profit']}"
        check("products report excel", await client.get("/reports/products?export=excel", headers=headers))

        # finance
        r = check("create counterparty", await client.post("/counterparties", json={"full_name": "ООО Ромашка", "type": "client"}, headers=headers), 201)
        cp_id = r.json()["id"]
        check("create transaction", await client.post("/transactions", json={
            "amount": 1000, "direction": "income", "counterparty_id": cp_id, "organization_id": org_id,
        }, headers=headers, ), 201)
        r = await client.get(f"/counterparties/{cp_id}", headers=headers)
        assert float(r.json()["balance"]) == 1000, f"баланс контрагента должен быть 1000, получено {r.json()['balance']}"

        # идемпотентность оплаты
        pay_body = {"direction": "expense", "organization_id": org_id,
                    "items": [{"amount": 250, "counterparty_id": cp_id}]}
        check("pay", await client.post("/transactions/pay", json=pay_body, headers={**headers, "Idempotency-Key": "pay-1"}), 201)
        check("pay repeat (idempotent)", await client.post("/transactions/pay", json=pay_body, headers={**headers, "Idempotency-Key": "pay-1"}), 201)
        r = await client.get(f"/counterparties/{cp_id}", headers=headers)
        assert float(r.json()["balance"]) == 750, f"повторная оплата не должна менять баланс: {r.json()['balance']}"

        # изменение суммы -> finance-history
        r = await client.get(f"/counterparties/{cp_id}/transactions", headers=headers)
        tx_id = r.json()["items"][0]["id"]
        check("update tx amount", await client.patch(f"/transactions/{tx_id}", json={"amount": 500}, headers=headers))
        r = check("finance history", await client.get("/finance-history", headers=headers))
        assert r.json()["total"] >= 1, "запись FinanceHistory не создана"

        # services / tasks / ratings
        r = check("create service", await client.post("/services", json={
            "name": "Установка", "points_on_time": 10, "points_late": 5, "points_not_done": -5, "penalty_percent": 50,
        }, headers=headers), 201)
        service_id = r.json()["id"]
        r = check("create employee", await client.post("/employees", json={"fio": "Иванов И.И.", "organization_id": org_id}, headers=headers), 201)
        employee_id = r.json()["id"]
        r = check("create task", await client.post("/tasks", json={
            "name": "Установить кассу", "service_id": service_id,
            "assignee_id": employee_id, "organization_id": org_id, "status": "in_progress",
        }, headers=headers), 201)
        task_id = r.json()["id"]
        r = check("create approval", await client.post("/task-approvals", json={
            "task_id": task_id, "change": {"status": "completed"},
        }, headers=headers), 201)
        approval_id = r.json()["id"]
        check("approve", await client.post(f"/task-approvals/{approval_id}/approve", headers=headers))
        r = await client.get(f"/tasks/{task_id}", headers=headers)
        assert r.json()["status"] == "completed", "approve не применил изменение"
        check("task board", await client.get("/tasks/board", headers=headers))
        r = check("ratings", await client.get("/ratings", headers=headers))
        assert r.json()[0]["on_time_points"] == 10, "баллы рейтинга не рассчитаны"

        # settings
        check("create language", await client.post("/languages", json={"name": "Русский", "code": "ru"}, headers=headers), 201)
        check("import translations", await client.post("/translations/import", json={"hello": {"ru": "Привет", "uz": "Salom"}}, headers=headers))
        r = check("export translations", await client.get("/translations/export", headers=headers))
        assert r.json()["hello"]["uz"] == "Salom"
        check("write user log", await client.post("/user-logs", json={"name": "login", "device_id": "dev-1", "organization_id": org_id}, headers=headers), 201)

        # offline jobs (идемпотентность)
        r = check("submit offline job", await client.post("/offline-jobs/submit", json={
            "type": "sync", "organization_id": org_id, "payload": {"a": 1}, "idempotency_key": "job-1",
        }, headers=headers), 201)
        job_id = r.json()["id"]
        r = check("submit duplicate", await client.post("/offline-jobs/submit", json={
            "type": "sync", "organization_id": org_id, "payload": {"a": 1}, "idempotency_key": "job-1",
        }, headers=headers), 201)
        assert r.json()["id"] == job_id, "offline job не идемпотентен"
        check("retry offline job", await client.post(f"/offline-jobs/{job_id}/retry", headers=headers))

        # ограничение видимости: менеджер видит только свои организации
        r = await client.post("/auth/login", json={"email": "manager1", "password": "Passw0rd1"})
        mgr_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r = check("manager sees own org", await client.get("/organizations", headers=mgr_headers))
        assert r.json()["total"] == 1, "скоуп менеджера должен видеть 1 организацию"

        print()
        if failures:
            print(f"ПРОВАЛЕНО: {len(failures)} проверок: {failures}")
            sys.exit(1)
        print("Все smoke-проверки пройдены.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())

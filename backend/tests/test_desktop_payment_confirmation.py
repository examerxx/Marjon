from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from tests.test_dashboard_paid_top_outgoing import report_engine, seed, add_order
from app.modules.auth.models import User
from app.modules.inventory.models import ProductIngredient, StockItem, StockMovement
from app.modules.pos.models import Order, OrderItem
from app.modules.payments.models import Payment
from app.modules.payments.schemas import PaymentCreate
from app.modules.payments.service import PaymentService
from app.modules.analytics.owner_financials import owner_financials
from app.modules.finance.idempotency import request_fingerprint_v2, request_fingerprint
from app.shared.exceptions import ValidationError


@pytest.mark.parametrize("method,cash,card,received,change", [
    ("cash", "220.00", "0.00", "250.00", "30.00"),
    ("card", "0.00", "220.00", None, None),
    ("mixed", "120.00", "100.00", "150.00", "30.00"),
])
@pytest.mark.asyncio
async def test_confirmed_checkout_feeds_dashboard_and_deducts_once(report_engine, method, cash, card, received, change):
    async with AsyncSession(report_engine, expire_on_commit=False) as db:
        company, branch, product, warehouse, ingredient = await seed(db)
        user = User(company_id=company.id, email=f"{uuid4().hex}@test.example", password_hash="unused")
        db.add(user)
        db.add(StockItem(company_id=company.id, warehouse_id=warehouse.id, ingredient_id=ingredient.id,
                         quantity=10, cost_price=20, unit="кг"))
        db.add(ProductIngredient(product_id=product.id, ingredient_id=ingredient.id, quantity=1, warehouse_id=warehouse.id))
        order = await add_order(db, company, branch, product, status="new", payments=())
        await db.execute(update(OrderItem).where(OrderItem.order_id == order.id).values(cost_price_snapshot=20))
        await db.commit()
        data = PaymentCreate(order_id=order.id, amount="220.00", method=method,
                             cash_received=received, cash_amount=cash, card_amount=card)
        key = f"desktop-test-{uuid4()}"
        payment = await PaymentService(db).process(company.id, user.id, data, key)
        assert payment.status == "completed" and payment.amount == Decimal(220)
        assert payment.change_given == (Decimal(change) if change is not None else None)
        assert payment.provider_data["manual_breakdown"] == {"cash": cash, "card": card}
        assert (await db.get(Order, order.id)).status == "completed"
        assert (await db.scalar(select(OrderItem.status).where(OrderItem.order_id == order.id))) == "served"
        assert await db.scalar(select(StockItem.quantity).where(StockItem.warehouse_id == warehouse.id,
                              StockItem.ingredient_id == ingredient.id)) == Decimal(8)
        assert await db.scalar(select(func.count()).select_from(StockMovement).where(
            StockMovement.ref_id == order.id, StockMovement.movement_type == "sale")) == 1
        local_day = payment.updated_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Asia/Tashkent")).date()
        result = await owner_financials(db, company.id, local_day, local_day, web_timezone="Asia/Tashkent")
        assert result["today_orders"] == 1
        assert Decimal(result["income_total"]) == 220
        assert Decimal(result["today_revenue"]) == 180
        again = await PaymentService(db).process(company.id, user.id, data, key)
        assert again.id == payment.id
        assert await db.scalar(select(func.count()).select_from(Payment).where(Payment.order_id == order.id)) == 1
        assert await db.scalar(select(StockItem.quantity).where(StockItem.warehouse_id == warehouse.id,
                              StockItem.ingredient_id == ingredient.id)) == Decimal(8)


def test_optional_breakdown_does_not_change_old_durable_fingerprints():
    order_id = uuid4()
    old = {"order_id": order_id, "amount": Decimal("220.00"), "method": "cash", "cash_received": None}
    data = PaymentCreate(**old)
    assert request_fingerprint_v2(data) == request_fingerprint_v2(old)
    old_json = {"order_id": str(order_id), "amount": "220.00", "method": "cash", "cash_received": None}
    assert request_fingerprint(data) == request_fingerprint(old_json)


@pytest.mark.parametrize("fields", [
    {"cash_amount": "200", "card_amount": "1"},
    {"cash_amount": "220"},
    {"cash_amount": "-1", "card_amount": "221"},
    {"cash_amount": "120", "card_amount": "100", "method": "cash"},
    {"cash_amount": "120", "card_amount": "100", "cash_received": "100"},
])
def test_invalid_breakdown_is_rejected_before_payment(fields):
    with pytest.raises(PydanticValidationError):
        PaymentCreate(**{"order_id": uuid4(), "amount": "220", "method": "mixed", **fields})


@pytest.mark.asyncio
async def test_status_only_closed_orders_are_not_automatically_charged(report_engine):
    async with AsyncSession(report_engine, expire_on_commit=False) as db:
        company, branch, product, _, _ = await seed(db)
        user = User(company_id=company.id, email=f"{uuid4().hex}@test.example", password_hash="unused")
        db.add(user)
        order = await add_order(db, company, branch, product, payments=())
        await db.commit()
        order_id = order.id
        with pytest.raises(ValidationError, match="already paid"):
            await PaymentService(db).process(company.id, user.id, PaymentCreate(
                order_id=order.id, amount=220, method="cash"), f"closed-{uuid4()}")
        assert await db.scalar(select(func.count()).select_from(Payment).where(Payment.order_id == order_id)) == 0


@pytest.mark.asyncio
async def test_failed_checkout_rolls_back_payment_and_status(report_engine):
    async with AsyncSession(report_engine, expire_on_commit=False) as db:
        company, branch, product, _, _ = await seed(db)
        user = User(company_id=company.id, email=f"{uuid4().hex}@test.example", password_hash="unused")
        db.add(user)
        order = await add_order(db, company, branch, product, status="new", payments=())
        await db.execute(update(OrderItem).where(OrderItem.order_id == order.id).values(status="pending"))
        await db.commit()
        cid, uid, oid = company.id, user.id, order.id
        async def fail_after_close(stage):
            if stage == "after_order":
                raise RuntimeError("injected failure")
        with pytest.raises(RuntimeError, match="injected failure"):
            await PaymentService(db, failure_injector=fail_after_close).process(cid, uid,
                PaymentCreate(order_id=oid, amount=220, method="card"), f"failure-{uuid4()}")
        assert (await db.get(Order, oid)).status == "new"
        assert await db.scalar(select(OrderItem.status).where(OrderItem.order_id == oid)) == "pending"
        assert await db.scalar(select(func.count()).select_from(Payment).where(Payment.order_id == oid)) == 0


@pytest.mark.asyncio
async def test_http_checkout_header_replay_and_dashboard(client, db_engine):
    from tests.conftest import register_company
    from app.modules.companies.models import Company, Branch
    from app.modules.inventory.models import Product
    slug = f"checkout-http-{uuid4().hex[:8]}"
    headers, _ = await register_company(client, slug=slug, email=f"{uuid4().hex}@test.example")
    async with AsyncSession(db_engine, expire_on_commit=False) as db:
        company = await db.scalar(select(Company).where(Company.slug == slug))
        branch = Branch(company_id=company.id, name="Test")
        product = Product(company_id=company.id, name="Test", price=100)
        db.add_all([branch, product]); await db.flush()
        order = await add_order(db, company, branch, product, status="new", payments=())
        await db.execute(update(OrderItem).where(OrderItem.order_id == order.id).values(cost_price_snapshot=20))
        oid = order.id
        await db.commit()
    data = {"order_id": str(oid), "amount": "220.00", "method": "mixed",
            "cash_amount": "120.00", "card_amount": "100.00", "cash_received": "150.00"}
    request_headers = {**headers, "Idempotency-Key": f"desktop-http-{uuid4()}"}
    first = await client.post("/payments", json=data, headers=request_headers)
    assert first.status_code == 201, first.text
    assert first.json()["status"] == "completed"
    assert Decimal(first.json()["change_given"]) == 30
    again = await client.post("/payments", json=data, headers=request_headers)
    assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
    today = datetime.now(ZoneInfo("Asia/Tashkent")).date().isoformat()
    report = await client.get("/analytics/owner-financials", params={"date_from": today,
        "date_to": today, "web_timezone": "Asia/Tashkent"}, headers=headers)
    assert report.status_code == 200, report.text
    assert report.json()["today_orders"] == 1
    assert Decimal(report.json()["income_total"]) == 220
    assert Decimal(report.json()["today_revenue"]) == 180

@pytest.mark.asyncio
async def test_vip_checkout_records_one_expense_and_keeps_dashboard_unchanged(report_engine):
    from app.modules.finance.defaults import VIP_EXPENSE_CATEGORY_ID, VIP_PAYMENT_TYPE_ID
    from app.modules.finance.models import FinTransaction, PaymentType, TransactionCategory

    async with AsyncSession(report_engine, expire_on_commit=False) as db:
        company, branch, product, warehouse, ingredient = await seed(db)
        user = User(company_id=company.id, email=f"{uuid4().hex}@test.example", password_hash="unused")
        db.add_all([
            user,
            PaymentType(id=VIP_PAYMENT_TYPE_ID, name="VIP", type="vip", scope_kind="system"),
            TransactionCategory(id=VIP_EXPENSE_CATEGORY_ID, name="VIP", kind="expense", scope_kind="system"),
            StockItem(company_id=company.id, warehouse_id=warehouse.id, ingredient_id=ingredient.id,
                      quantity=10, cost_price=20, unit="кг"),
            ProductIngredient(product_id=product.id, ingredient_id=ingredient.id, quantity=1,
                              warehouse_id=warehouse.id),
        ])
        order = await add_order(db, company, branch, product, status="new", payments=())
        await db.commit()

        day = datetime.now(ZoneInfo("Asia/Tashkent")).date()
        before = await owner_financials(db, company.id, day, day, web_timezone="Asia/Tashkent")
        data = PaymentCreate(order_id=order.id, amount="220.00", method="VIP")
        key = f"vip-test-{uuid4()}"
        service = PaymentService(db)
        payment = await service.process(company.id, user.id, data, key)
        replay = await service.process(company.id, user.id, data, key)

        assert replay.id == payment.id
        assert payment.status == "complimentary"
        assert payment.amount == 0
        assert (await db.get(Order, order.id)).status == "completed"
        expense = (await db.execute(select(FinTransaction).where(
            FinTransaction.company_id == company.id,
        ))).scalar_one()
        assert (expense.direction, expense.amount) == ("expense", Decimal(220))
        assert expense.payment_type_id == VIP_PAYMENT_TYPE_ID
        assert expense.category_id == VIP_EXPENSE_CATEGORY_ID
        assert await db.scalar(select(StockItem.quantity).where(
            StockItem.warehouse_id == warehouse.id,
            StockItem.ingredient_id == ingredient.id,
        )) == Decimal(8)
        after = await owner_financials(db, company.id, day, day, web_timezone="Asia/Tashkent")
        for metric in ("income_total", "today_revenue", "today_orders", "avg_check"):
            assert after[metric] == before[metric]
        assert after["active_orders"] == before["active_orders"] - 1

@pytest.mark.asyncio
async def test_default_payment_status_is_tenant_scoped_and_protected(report_engine):
    from app.modules.finance.defaults import VIP_PAYMENT_TYPE_ID
    from app.modules.finance.models import PaymentType
    from app.modules.finance.ownership import FinanceDictionaryService, FinanceScope
    from app.shared.exceptions import ForbiddenError
    from app.shared.pagination import PageParams

    async with AsyncSession(report_engine, expire_on_commit=False) as db:
        company, *_ = await seed(db)
        other_company, *_ = await seed(db)
        db.add(PaymentType(id=VIP_PAYMENT_TYPE_ID, name="VIP", type="vip", scope_kind="system", sort=3))
        await db.commit()

        service = FinanceDictionaryService(PaymentType, db, system_enabled=True)
        scope = FinanceScope("company", company.id)
        inactive = await service.update(VIP_PAYMENT_TYPE_ID, {"status": False}, scope)
        assert inactive.source_template_id == VIP_PAYMENT_TYPE_ID
        assert inactive.status is False
        rows, _ = await service.list(scope, PageParams(page=1, size=20))
        assert [row.id for row in rows] == [inactive.id]
        other_scope = FinanceScope("company", other_company.id)
        rows, _ = await service.list(other_scope, PageParams(page=1, size=20))
        assert [(row.id, row.status) for row in rows] == [(VIP_PAYMENT_TYPE_ID, True)]
        with pytest.raises(ForbiddenError):
            await service.delete(inactive.id, scope)
        with pytest.raises(ForbiddenError):
            await service.update(inactive.id, {"name": "Other"}, scope)
        active = await service.update(inactive.id, {"status": True}, scope)
        assert active.status is True

@pytest.mark.asyncio
async def test_split_card_cash_and_debt_closes_only_the_remaining_balance(report_engine):
    from app.modules.finance.models import Counterparty
    from app.modules.pos.schemas import OrderStatusUpdate
    from app.modules.pos.service import OrderService

    async with AsyncSession(report_engine, expire_on_commit=False) as db:
        company, branch, product, warehouse, ingredient = await seed(db)
        user = User(company_id=company.id, email=f"{uuid4().hex}@test.example", password_hash="unused")
        db.add_all([
            user,
            StockItem(company_id=company.id, warehouse_id=warehouse.id, ingredient_id=ingredient.id,
                      quantity=10, cost_price=20, unit="kg"),
            ProductIngredient(product_id=product.id, ingredient_id=ingredient.id,
                              quantity=1, warehouse_id=warehouse.id),
        ])
        order = await add_order(db, company, branch, product, status="new", payments=())
        order.total_amount = Decimal("177480")
        await db.commit()
        service = PaymentService(db)
        card = PaymentCreate(order_id=order.id, amount="100000", method="card", partial=True)
        key = f"partial-{uuid4()}"
        first = await service.process(company.id, user.id, card, key)
        assert (await service.process(company.id, user.id, card, key)).id == first.id
        await service.process(company.id, user.id, PaymentCreate(
            order_id=order.id, amount="50000", method="cash", partial=True, cash_received="50000",
        ), f"partial-{uuid4()}")
        assert (await db.get(Order, order.id)).status == "new"
        assert await db.scalar(select(func.count()).select_from(StockMovement).where(
            StockMovement.ref_id == order.id,
        )) == 0
        closed = await OrderService(db).update_status(company.id, order.id, OrderStatusUpdate(
            status="completed", client_name="Test debtor",
        ), actor_id=user.id, user=user)
        assert closed.status == "completed"
        assert await db.scalar(select(func.sum(Payment.amount)).where(
            Payment.order_id == order.id, Payment.status == "completed",
        )) == Decimal("150000")
        assert await db.scalar(select(Counterparty.balance).where(
            Counterparty.company_id == company.id,
        )) == Decimal("27480")
        assert await db.scalar(select(StockItem.quantity).where(
            StockItem.warehouse_id == warehouse.id, StockItem.ingredient_id == ingredient.id,
        )) == Decimal(8)


@pytest.mark.asyncio
async def test_vip_closes_only_the_remaining_balance_after_a_partial_payment(report_engine):
    from app.modules.finance.defaults import VIP_EXPENSE_CATEGORY_ID, VIP_PAYMENT_TYPE_ID
    from app.modules.finance.models import FinTransaction, PaymentType, TransactionCategory

    async with AsyncSession(report_engine, expire_on_commit=False) as db:
        company, branch, product, warehouse, ingredient = await seed(db)
        user = User(company_id=company.id, email=f"{uuid4().hex}@test.example", password_hash="unused")
        db.add_all([
            user,
            PaymentType(id=VIP_PAYMENT_TYPE_ID, name="VIP", type="vip", scope_kind="system"),
            TransactionCategory(id=VIP_EXPENSE_CATEGORY_ID, name="VIP", kind="expense", scope_kind="system"),
            StockItem(company_id=company.id, warehouse_id=warehouse.id, ingredient_id=ingredient.id,
                      quantity=10, cost_price=20, unit="kg"),
            ProductIngredient(product_id=product.id, ingredient_id=ingredient.id, quantity=1,
                              warehouse_id=warehouse.id),
        ])
        order = await add_order(db, company, branch, product, status="new", payments=())
        order.total_amount = Decimal("220.00")
        await db.commit()

        service = PaymentService(db)
        cash = await service.process(company.id, user.id, PaymentCreate(
            order_id=order.id, amount="200.00", method="cash", partial=True, cash_received="200.00",
        ), f"partial-{uuid4()}")
        assert (await db.get(Order, order.id)).status == "new"
        vip = await service.process(company.id, user.id, PaymentCreate(
            order_id=order.id, amount="220.00", method="VIP",
        ), f"vip-{uuid4()}")

        assert (vip.status, vip.amount) == ("complimentary", 0)
        assert (await db.get(Order, order.id)).status == "completed"
        await db.refresh(cash)
        assert (cash.status, cash.amount) == ("completed", Decimal("200.00"))
        expense = (await db.execute(select(FinTransaction).where(
            FinTransaction.company_id == company.id,
        ))).scalar_one()
        assert (expense.direction, expense.amount) == ("expense", Decimal("20.00"))

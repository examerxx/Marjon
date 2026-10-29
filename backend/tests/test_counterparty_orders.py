"""DEBT-ORDERS-01: заказы клиента в карточке контрагента.

Долг при закрытии «в долг» создаёт контрагента, но заказ с ним не связан
(в orders нет counterparty_id) — связь восстанавливается по журналу аудита
`order.debt_client`. Тесты проверяют обе ветки сопоставления (id контрагента
для новых долгов, имя/телефон для уже существующих) и отсечение чужих заказов.
"""
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditLog
from app.modules.companies.models import Branch, Company
from app.modules.finance.counterparty_orders import list_counterparty_orders
from app.modules.finance.models import Counterparty
from app.modules.inventory.models import Product
from app.modules.payments.models import Payment
from app.modules.pos.models import Order, OrderItem

DAY = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)


async def _seed(db):
    company = Company(name="Test", slug=str(uuid4()), timezone="Asia/Tashkent")
    db.add(company)
    await db.flush()
    branch = Branch(company_id=company.id, name="Test")
    product = Product(company_id=company.id, name="Лаваш", price=100, product_type="dish")
    db.add_all([branch, product])
    await db.flush()
    return company, branch, product


def _counterparty(company, *, name="Абдуманноп", phone="+998901112233", balance=0):
    return Counterparty(
        company_id=company.id,
        organization_id=None,
        scope_kind="company",
        full_name=name,
        phone=phone,
        type="client",
        balance=balance,
    )


async def _order(db, company, branch, product, *, number="1", total=100, paid=0, created_at=DAY):
    order = Order(
        company_id=company.id,
        branch_id=branch.id,
        order_number=number,
        status="completed",
        subtotal=total,
        total_amount=total,
        created_at=created_at,
    )
    db.add(order)
    await db.flush()
    db.add(
        OrderItem(
            order_id=order.id,
            product_id=product.id,
            name=product.name,
            price=total,
            quantity=1,
            total=total,
            status="served",
        )
    )
    if paid:
        db.add(
            Payment(
                company_id=company.id,
                order_id=order.id,
                amount=paid,
                method="cash",
                status="completed",
                created_at=created_at,
                updated_at=created_at,
            )
        )
    await db.flush()
    return order


async def _debt_audit(db, company, order, *, name="Абдуманноп", phone="+998901112233", counterparty_id=None, debt="100"):
    db.add(
        AuditLog(
            company_id=company.id,
            action="order.debt_client",
            entity_type="order",
            entity_id=order.id,
            new_data={
                "client_name": name,
                "client_phone": phone,
                "counterparty_id": str(counterparty_id) if counterparty_id else None,
                "debt": debt,
            },
        )
    )
    await db.flush()


async def test_debt_order_shows_up_with_remaining_debt(db_engine):
    async with AsyncSession(db_engine, expire_on_commit=False) as db:
        company, branch, product = await _seed(db)
        client = _counterparty(company, balance=100)
        db.add(client)
        await db.flush()
        order = await _order(db, company, branch, product, number="3", total=100)
        await _debt_audit(db, company, order)

        rows = await list_counterparty_orders(db, company.id, client)

    assert len(rows) == 1
    assert rows[0]["order_number"] == "3"
    assert rows[0]["total_amount"] == 100
    assert rows[0]["paid_amount"] == 0
    assert rows[0]["debt_amount"] == 100
    assert rows[0]["items_count"] == 1


async def test_partially_paid_debt_keeps_only_the_rest(db_engine):
    async with AsyncSession(db_engine, expire_on_commit=False) as db:
        company, branch, product = await _seed(db)
        client = _counterparty(company)
        db.add(client)
        await db.flush()
        order = await _order(db, company, branch, product, total=210, paid=60)
        await _debt_audit(db, company, order, debt="150")

        rows = await list_counterparty_orders(db, company.id, client)

    assert rows[0]["paid_amount"] == 60
    assert rows[0]["debt_amount"] == 150
    assert rows[0]["payment_methods"] == ["cash"]


async def test_orders_of_other_clients_are_not_leaked(db_engine):
    async with AsyncSession(db_engine, expire_on_commit=False) as db:
        company, branch, product = await _seed(db)
        mine = _counterparty(company, name="Абдуманноп", phone="+998901112233")
        other = _counterparty(company, name="Другой клиент", phone="+998907778899")
        db.add_all([mine, other])
        await db.flush()

        my_order = await _order(db, company, branch, product, number="1")
        await _debt_audit(db, company, my_order)
        foreign_order = await _order(db, company, branch, product, number="2")
        await _debt_audit(db, company, foreign_order, name="Другой клиент", phone="+998907778899")

        rows = await list_counterparty_orders(db, company.id, mine)

    assert [row["order_number"] for row in rows] == ["1"]


async def test_phone_matches_even_when_the_name_was_typed_differently(db_engine):
    """Имя в долге набрали иначе — телефон всё равно связывает заказ."""
    async with AsyncSession(db_engine, expire_on_commit=False) as db:
        company, branch, product = await _seed(db)
        client = _counterparty(company, name="Абдуманноп", phone="+998 90 111-22-33")
        db.add(client)
        await db.flush()
        order = await _order(db, company, branch, product)
        await _debt_audit(db, company, order, name="абдуманоп", phone="998901112233")

        rows = await list_counterparty_orders(db, company.id, client)

    assert len(rows) == 1


async def test_counterparty_id_links_even_without_name_or_phone(db_engine):
    """Новые долги пишут id контрагента — связь не зависит от написания."""
    async with AsyncSession(db_engine, expire_on_commit=False) as db:
        company, branch, product = await _seed(db)
        client = _counterparty(company, name="Клиент без телефона", phone=None)
        db.add(client)
        await db.flush()
        order = await _order(db, company, branch, product)
        await _debt_audit(db, company, order, name=None, phone=None, counterparty_id=client.id)

        rows = await list_counterparty_orders(db, company.id, client)

    assert len(rows) == 1


async def test_paid_order_without_debt_marker_is_not_a_client_order(db_engine):
    async with AsyncSession(db_engine, expire_on_commit=False) as db:
        company, branch, product = await _seed(db)
        client = _counterparty(company)
        db.add(client)
        await db.flush()
        # Обычный оплаченный заказ: контрагент нигде не зафиксирован.
        await _order(db, company, branch, product, total=100, paid=100)

        rows = await list_counterparty_orders(db, company.id, client)

    assert rows == []


async def test_period_filter_excludes_orders_outside_the_range(db_engine):
    from datetime import date

    async with AsyncSession(db_engine, expire_on_commit=False) as db:
        company, branch, product = await _seed(db)
        client = _counterparty(company)
        db.add(client)
        await db.flush()
        inside = await _order(db, company, branch, product, number="1")
        await _debt_audit(db, company, inside)
        outside = await _order(
            db, company, branch, product, number="2",
            created_at=datetime(2026, 9, 1, 12, tzinfo=timezone.utc),
        )
        await _debt_audit(db, company, outside)

        rows = await list_counterparty_orders(
            db, company.id, client, date(2026, 10, 29), date(2026, 10, 29)
        )

    assert [row["order_number"] for row in rows] == ["1"]

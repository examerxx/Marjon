from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.auth.models import User
from app.modules.companies.models import Branch
from app.modules.payments.models import Payment
from app.modules.pos.models import Order
from tests.conftest import create_staff_headers, register_company


async def _me(client, headers):
    r = await client.get("/auth/me", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


async def _setup(client, db_engine, *, slug: str, email: str):
    headers, _ = await register_company(client, slug=slug, email=email)
    ident = await _me(client, headers)
    company_id = UUID(ident["company_id"])
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    branch_id = uuid4()
    async with sessions() as db:
        db.add(Branch(id=branch_id, company_id=company_id, name="Main"))
        await db.commit()
    return {"headers": headers, "company_id": company_id, "sessions": sessions, "branch_id": branch_id}


async def _staff(client, owner_headers, sessions, *, email: str, role: str, name: str):
    headers = await create_staff_headers(
        client, owner_headers, email=email, role_slug=role,
    )
    user_id = UUID((await _me(client, headers))["id"])
    async with sessions() as db:
        user = await db.get(User, user_id)
        user.name = name
        await db.commit()
    return user_id


async def _order(sessions, *, company_id, branch_id, number, waiter_id=None,
                 order_type="dine_in", status="completed", created_at=None):
    oid = uuid4()
    async with sessions() as db:
        order = Order(
            id=oid, company_id=company_id, branch_id=branch_id,
            waiter_id=waiter_id, order_number=number,
            order_type=order_type, status=status,
            table_number="7",
            subtotal=Decimal("100"), total_amount=Decimal("100"),
        )
        if created_at is not None:
            order.created_at = created_at
        db.add(order)
        await db.commit()
    return oid


async def _payment(sessions, *, company_id, order_id, cashier_id,
                   status="completed", created_at=None):
    pid = uuid4()
    async with sessions() as db:
        payment = Payment(
            id=pid, company_id=company_id, order_id=order_id,
            amount=Decimal("100"), method="cash", status=status,
            cashier_id=cashier_id,
        )
        if created_at is not None:
            payment.created_at = created_at
        db.add(payment)
        await db.commit()
    return pid


async def _report(client, headers, **params):
    response = await client.get("/reports/orders", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return {row["order_number"]: row for row in response.json()}


def _dt(hour: int) -> datetime:
    return datetime(2026, 9, 10, hour, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_order_type_returns_canonical_values_unchanged(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"ord-type-{suffix}", email=f"ord-type-{suffix}@example.com",
    )
    for number, order_type in (
        ("T-DINE", "dine_in"), ("T-DELIVERY", "delivery"), ("T-TAKEAWAY", "takeaway"),
    ):
        await _order(
            ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
            number=number, order_type=order_type,
        )
    rows = await _report(client, ctx["headers"])
    # Stored canonical enum passes through verbatim — no Russian labels here.
    assert rows["T-DINE"]["order_type"] == "dine_in"
    assert rows["T-DELIVERY"]["order_type"] == "delivery"
    assert rows["T-TAKEAWAY"]["order_type"] == "takeaway"
    # Existing fields remain present and correct on the same rows.
    row = rows["T-DINE"]
    assert row["status"] == "completed"
    assert row["table_number"] == "7"
    assert row["items_count"] == 0
    assert Decimal(str(row["total_amount"])) == Decimal("100")
    assert UUID(row["order_id"])
    assert row["created_at"]
    assert row["cashier_names"] == []


@pytest.mark.asyncio
async def test_cashier_single_completed_payment(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"cash-1-{suffix}", email=f"cash-1-{suffix}@example.com",
    )
    cashier = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"ca-{suffix}@example.com", role="cashier", name="Бехруз",
    )
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="C-1",
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cashier,
    )
    rows = await _report(client, ctx["headers"])
    assert rows["C-1"]["cashier_names"] == ["Бехруз"]


@pytest.mark.asyncio
async def test_cashier_null_gateway_payment_contributes_nothing(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"cash-2-{suffix}", email=f"cash-2-{suffix}@example.com",
    )
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="C-2",
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=None,
    )
    rows = await _report(client, ctx["headers"])
    assert rows["C-2"]["cashier_names"] == []


@pytest.mark.asyncio
async def test_cashier_unpaid_order_has_empty_attribution(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"cash-3-{suffix}", email=f"cash-3-{suffix}@example.com",
    )
    await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="C-3", status="new",
    )
    rows = await _report(client, ctx["headers"])
    assert rows["C-3"]["cashier_names"] == []


@pytest.mark.asyncio
async def test_cashier_non_completed_payment_is_ignored(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"cash-4-{suffix}", email=f"cash-4-{suffix}@example.com",
    )
    cashier = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"cd-{suffix}@example.com", role="cashier", name="Незавершённый",
    )
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="C-4", status="new",
    )
    for status in ("pending", "failed", "refunded"):
        await _payment(
            ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
            cashier_id=cashier, status=status,
        )
    rows = await _report(client, ctx["headers"])
    assert rows["C-4"]["cashier_names"] == []


@pytest.mark.asyncio
async def test_cashier_same_cashier_twice_appears_once(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"cash-5-{suffix}", email=f"cash-5-{suffix}@example.com",
    )
    cashier = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"ce-{suffix}@example.com", role="cashier", name="Сардор",
    )
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="C-5",
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cashier, created_at=_dt(9),
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cashier, created_at=_dt(10),
    )
    rows = await _report(client, ctx["headers"])
    assert rows["C-5"]["cashier_names"] == ["Сардор"]


@pytest.mark.asyncio
async def test_cashier_two_cashiers_both_appear_in_first_payment_order(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"cash-6-{suffix}", email=f"cash-6-{suffix}@example.com",
    )
    # Chronology (Zebra first) deliberately disagrees with alphabetical order
    # so the test proves first-occurrence ordering, not name sorting.
    zebra = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"cf-{suffix}@example.com", role="cashier", name="Яков",
    )
    alpha = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"cg-{suffix}@example.com", role="cashier", name="Алишер",
    )
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="C-6",
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=zebra, created_at=_dt(9),
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=alpha, created_at=_dt(10),
    )
    rows = await _report(client, ctx["headers"])
    assert rows["C-6"]["cashier_names"] == ["Яков", "Алишер"]


@pytest.mark.asyncio
async def test_cashier_waiter_never_becomes_cashier(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"cash-7-{suffix}", email=f"cash-7-{suffix}@example.com",
    )
    waiter = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"ch-{suffix}@example.com", role="waiter", name="Официант",
    )
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="C-7", waiter_id=waiter,
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=None,
    )
    rows = await _report(client, ctx["headers"])
    assert rows["C-7"]["waiter_name"] == "Официант"
    assert rows["C-7"]["cashier_names"] == []


@pytest.mark.asyncio
async def test_cashier_waiter_and_cashier_stay_distinct(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"cash-8-{suffix}", email=f"cash-8-{suffix}@example.com",
    )
    waiter = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"ci-{suffix}@example.com", role="waiter", name="Официант",
    )
    cashier = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"cj-{suffix}@example.com", role="cashier", name="Кассир",
    )
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="C-8", waiter_id=waiter,
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cashier,
    )
    rows = await _report(client, ctx["headers"])
    assert rows["C-8"]["waiter_name"] == "Официант"
    assert rows["C-8"]["cashier_names"] == ["Кассир"]


@pytest.mark.asyncio
async def test_cashier_gateway_null_plus_human_keeps_only_human(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"cash-9-{suffix}", email=f"cash-9-{suffix}@example.com",
    )
    cashier = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"ck-{suffix}@example.com", role="cashier", name="Кассир",
    )
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="C-9",
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=None, created_at=_dt(9),
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cashier, created_at=_dt(10),
    )
    rows = await _report(client, ctx["headers"])
    assert rows["C-9"]["cashier_names"] == ["Кассир"]


@pytest.mark.asyncio
async def test_cashier_cross_company_payment_does_not_leak(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx_a = await _setup(
        client, db_engine,
        slug=f"cash-a-{suffix}", email=f"cash-a-{suffix}@example.com",
    )
    ctx_b = await _setup(
        client, db_engine,
        slug=f"cash-b-{suffix}", email=f"cash-b-{suffix}@example.com",
    )
    foreign_cashier = await _staff(
        client, ctx_b["headers"], ctx_b["sessions"],
        email=f"cl-{suffix}@example.com", role="cashier", name="Чужой Секрет",
    )
    oid = await _order(
        ctx_a["sessions"], company_id=ctx_a["company_id"], branch_id=ctx_a["branch_id"],
        number="C-10",
    )
    # Malformed cross-company payment row pointing at B's cashier.
    await _payment(
        ctx_a["sessions"], company_id=ctx_a["company_id"], order_id=oid,
        cashier_id=foreign_cashier,
    )
    rows = await _report(client, ctx_a["headers"])
    assert rows["C-10"]["cashier_names"] == []
    assert "Чужой Секрет" not in str(rows)


@pytest.mark.asyncio
async def test_cashier_multiple_payments_keep_single_order_row(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"cash-11-{suffix}", email=f"cash-11-{suffix}@example.com",
    )
    cashier = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"cm-{suffix}@example.com", role="cashier", name="Кассир",
    )
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="C-11",
    )
    for hour in (9, 10, 11):
        await _payment(
            ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
            cashier_id=cashier, created_at=_dt(hour),
        )
    response = await client.get("/reports/orders", headers=ctx["headers"])
    assert response.status_code == 200, response.text
    matching = [row for row in response.json() if row["order_number"] == "C-11"]
    assert len(matching) == 1
    assert matching[0]["cashier_names"] == ["Кассир"]
    assert matching[0]["order_type"] == "dine_in"


async def _report_filtered(client, headers, params):
    response = await client.get("/reports/orders", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return {row["order_number"]: row for row in response.json()}


async def _filter_setup(client, db_engine, suffix):
    ctx = await _setup(
        client, db_engine,
        slug=f"cashf-{suffix}", email=f"cashf-{suffix}@example.com",
    )
    cash_a = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"cfa-{suffix}@example.com", role="cashier", name="Кассир А",
    )
    cash_b = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"cfb-{suffix}@example.com", role="cashier", name="Кассир Б",
    )
    return ctx, cash_a, cash_b


@pytest.mark.asyncio
async def test_cashier_filter_completed_payment_matches(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx, cash_a, _ = await _filter_setup(client, db_engine, suffix)
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="F-1",
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cash_a,
    )
    rows = await _report_filtered(client, ctx["headers"], {"cashier_id": str(cash_a)})
    assert "F-1" in rows
    assert rows["F-1"]["cashier_names"] == ["Кассир А"]


@pytest.mark.asyncio
async def test_cashier_filter_excludes_pending_failed_refunded(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx, cash_a, _ = await _filter_setup(client, db_engine, suffix)
    for number, status in (("F-P", "pending"), ("F-F", "failed"), ("F-R", "refunded")):
        oid = await _order(
            ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
            number=number, status="new",
        )
        await _payment(
            ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
            cashier_id=cash_a, status=status,
        )
    rows = await _report_filtered(client, ctx["headers"], {"cashier_id": str(cash_a)})
    assert "F-P" not in rows
    assert "F-F" not in rows
    assert "F-R" not in rows


@pytest.mark.asyncio
async def test_cashier_filter_null_gateway_matches_no_human(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx, cash_a, _ = await _filter_setup(client, db_engine, suffix)
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="F-5",
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=None,
    )
    rows = await _report_filtered(client, ctx["headers"], {"cashier_id": str(cash_a)})
    assert "F-5" not in rows


@pytest.mark.asyncio
async def test_cashier_filter_mixed_payments_follow_completed_only(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx, cash_a, cash_b = await _filter_setup(client, db_engine, suffix)
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="F-67",
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cash_a, status="pending", created_at=_dt(9),
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cash_b, created_at=_dt(10),
    )
    excluded = await _report_filtered(client, ctx["headers"], {"cashier_id": str(cash_a)})
    assert "F-67" not in excluded
    included = await _report_filtered(client, ctx["headers"], {"cashier_id": str(cash_b)})
    assert "F-67" in included
    assert included["F-67"]["cashier_names"] == ["Кассир Б"]


@pytest.mark.asyncio
async def test_cashier_filter_repeated_values_or_within_single_row(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx, cash_a, cash_b = await _filter_setup(client, db_engine, suffix)
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="F-8",
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cash_a, created_at=_dt(9),
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cash_b, created_at=_dt(10),
    )
    response = await client.get(
        "/reports/orders",
        headers=ctx["headers"],
        params=[("cashier_id", str(cash_a)), ("cashier_id", str(cash_b))],
    )
    assert response.status_code == 200, response.text
    matching = [row for row in response.json() if row["order_number"] == "F-8"]
    assert len(matching) == 1
    assert matching[0]["cashier_names"] == ["Кассир А", "Кассир Б"]


@pytest.mark.asyncio
async def test_cashier_filter_foreign_cashier_does_not_leak(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx, cash_a, _ = await _filter_setup(client, db_engine, suffix)
    foreign = await _setup(
        client, db_engine,
        slug=f"cashf-x-{suffix}", email=f"cashf-x-{suffix}@example.com",
    )
    foreign_cashier = await _staff(
        client, foreign["headers"], foreign["sessions"],
        email=f"cfx-{suffix}@example.com", role="cashier", name="Чужой",
    )
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="F-9",
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cash_a,
    )
    rows = await _report_filtered(
        client, ctx["headers"], {"cashier_id": str(foreign_cashier)}
    )
    assert "F-9" not in rows
    assert "Чужой" not in str(rows)


@pytest.mark.asyncio
async def test_cashier_filter_combines_and_with_other_dimensions(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx, cash_a, _ = await _filter_setup(client, db_engine, suffix)
    waiter = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"cfw-{suffix}@example.com", role="waiter", name="Официант",
    )
    oid = await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="F-10", waiter_id=waiter, order_type="delivery", status="ready",
        created_at=_dt(15),
    )
    await _payment(
        ctx["sessions"], company_id=ctx["company_id"], order_id=oid,
        cashier_id=cash_a,
    )
    # cashier AND order_type AND waiter AND status AND order_number AND period.
    rows = await _report_filtered(
        client, ctx["headers"],
        {
            "cashier_id": str(cash_a),
            "order_type": "delivery",
            "waiter_id": str(waiter),
            "order_status": "ready",
            "order_number": "F-10",
            "date_from": "2026-09-01",
            "date_to": "2026-09-30",
        },
    )
    assert "F-10" in rows
    assert rows["F-10"]["order_type"] == "delivery"
    assert rows["F-10"]["cashier_names"] == ["Кассир А"]
    # Narrowing one dimension to a non-matching value excludes the row.
    narrowed = await _report_filtered(
        client, ctx["headers"],
        {"cashier_id": str(cash_a), "order_type": "dine_in"},
    )
    assert "F-10" not in narrowed


@pytest.mark.asyncio
async def test_orders_report_preserves_existing_contract(client, db_engine):
    suffix = uuid4().hex[:8]
    ctx = await _setup(
        client, db_engine,
        slug=f"cash-12-{suffix}", email=f"cash-12-{suffix}@example.com",
    )
    waiter = await _staff(
        client, ctx["headers"], ctx["sessions"],
        email=f"cn-{suffix}@example.com", role="waiter", name="Официант",
    )
    await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="KEEP-1", waiter_id=waiter, order_type="delivery",
        status="ready", created_at=_dt(12),
    )
    await _order(
        ctx["sessions"], company_id=ctx["company_id"], branch_id=ctx["branch_id"],
        number="GONE-1", status="cancelled",
    )
    rows = await _report(client, ctx["headers"])
    # Cancelled orders stay excluded (unchanged semantics).
    assert "GONE-1" not in rows
    row = rows["KEEP-1"]
    assert row["order_number"] == "KEEP-1"
    assert row["status"] == "ready"
    assert row["table_number"] == "7"
    assert row["waiter_name"] == "Официант"
    assert row["items_count"] == 0
    assert Decimal(str(row["total_amount"])) == Decimal("100")
    assert row["order_type"] == "delivery"
    assert row["cashier_names"] == []

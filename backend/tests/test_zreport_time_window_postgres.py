"""ZR-TIME-01 — per-dimension wall-clock boundaries for /z-report/detail.

The window is resolved once (analytics/zreport_period.py) and applied to the
SAME timestamp columns each dimension has always been filtered by:

  * cashier — Order.created_at for order money, Payment.created_at for the
    payment breakdown, FiscalReceipt.created_at for receipts;
  * waiter  — the same three columns, attributed through Order.waiter_id;
  * hall    — the same three columns, attributed through Table.hall_id.

ZR-TIME-01 changes the BOUNDARIES, never the column: no accounting event
timestamp is swapped for another. Each test below drives one dimension across
both edges of 13:23 → 22:06 local, to the microsecond.

PostgreSQL only (timestamptz + the DISTINCT closure join), against the same
disposable TEST_DATABASE_URL database as test_zreport_detail.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from tests.test_zreport_detail import (  # noqa: F401 — fixtures resolved by name
    TZ,
    _branch,
    _fig,
    _hall_with_table,
    _local,
    _ok,
    _order,
    _owner,
    _payment,
    _staff,
    api,
    detail_database_url,
)

# One order on every side of both edges. Distinct totals, so the returned
# net_sales names the exact subset counted.
EDGES = [
    ((13, 22, 59, 999999), "1.00", False),   # before start -> OUT
    ((13, 23, 0, 0), "2.00", True),          # exact start  -> IN
    ((13, 23, 0, 1), "4.00", True),          # just after   -> IN
    ((22, 5, 59, 999999), "8.00", True),     # just before  -> IN
    ((22, 6, 0, 0), "16.00", False),         # exact end    -> OUT
    ((22, 6, 0, 1), "32.00", False),         # just after   -> OUT
]
IN_SUM = Decimal("14.00")     # 2 + 4 + 8
IN_COUNT = 3
FULL_SUM = Decimal("63.00")
WINDOW = dict(date="2026-09-05", time_from="13:23", time_to="22:06")


def _instants():
    return [(_local(2026, 9, 5, h, mi, s, us), total) for (h, mi, s, us), total, _ in EDGES]


@pytest.mark.asyncio
async def test_cashier_detail_window_is_half_open(api):
    """Cashier money follows the COMPLETED payment that closed the order; both
    the order and the payment sit at the same instant here, so one window proves
    the order, payment and receipt predicates together."""
    client, engine = api
    headers, company_id = await _owner(client, engine)
    branch_id = await _branch(engine, company_id)
    cashier_id, _ = await _staff(client, headers, "cashier", name="Мансур")
    for created, total in _instants():
        order_id = await _order(
            engine, company_id, branch_id, created=created, subtotal=total, total=total
        )
        await _payment(
            engine, company_id, order_id, created=created,
            cashier_id=cashier_id, amount=total, receipt=True,
        )

    windowed = _fig(await _ok(client, headers, dimension="cashier", ids=[cashier_id], **WINDOW), 0)
    full_day = _fig(
        await _ok(client, headers, dimension="cashier", ids=[cashier_id], date="2026-09-05"), 0
    )

    assert Decimal(windowed["net_sales"]) == IN_SUM
    assert windowed["orders_count"] == IN_COUNT
    assert windowed["payments_count"] == IN_COUNT
    assert windowed["fiscal_receipts_count"] == IN_COUNT
    assert Decimal(windowed["payment_methods"][0]["amount"]) == IN_SUM
    # the same fixture, no time params: the legacy calendar-day report
    assert Decimal(full_day["net_sales"]) == FULL_SUM
    assert full_day["orders_count"] == len(EDGES)


@pytest.mark.asyncio
async def test_waiter_detail_window_is_half_open(api):
    client, engine = api
    headers, company_id = await _owner(client, engine)
    branch_id = await _branch(engine, company_id)
    waiter_id, _ = await _staff(client, headers, "waiter", name="Алишер")
    for created, total in _instants():
        order_id = await _order(
            engine, company_id, branch_id, created=created, waiter_id=waiter_id,
            subtotal=total, service_fee="1.00", total=total,
        )
        await _payment(engine, company_id, order_id, created=created, amount=total, receipt=True)

    windowed = _fig(await _ok(client, headers, dimension="waiter", ids=[waiter_id], **WINDOW), 0)

    assert Decimal(windowed["net_sales"]) == IN_SUM
    assert windowed["orders_count"] == IN_COUNT
    assert windowed["payments_count"] == IN_COUNT
    assert windowed["fiscal_receipts_count"] == IN_COUNT
    # service fee still comes from the same Order rows, one per included order
    assert Decimal(windowed["service_fee_total"]) == Decimal("3.00")


@pytest.mark.asyncio
async def test_hall_detail_window_is_half_open(api):
    client, engine = api
    headers, company_id = await _owner(client, engine)
    branch_id = await _branch(engine, company_id)
    hall_id, table_id = await _hall_with_table(engine, company_id, branch_id, "Балкон", 1)
    for created, total in _instants():
        order_id = await _order(
            engine, company_id, branch_id, created=created, table_id=table_id,
            subtotal=total, total=total,
        )
        await _payment(engine, company_id, order_id, created=created, amount=total, receipt=True)

    windowed = _fig(await _ok(client, headers, dimension="hall", ids=[hall_id], **WINDOW), 0)

    assert Decimal(windowed["net_sales"]) == IN_SUM
    assert windowed["orders_count"] == IN_COUNT
    assert windowed["payments_count"] == IN_COUNT
    assert windowed["fiscal_receipts_count"] == IN_COUNT


@pytest.mark.asyncio
async def test_detail_cross_midnight_window(api):
    client, engine = api
    headers, company_id = await _owner(client, engine)
    branch_id = await _branch(engine, company_id)
    waiter_id, _ = await _staff(client, headers, "waiter", name="Шерзод")
    rows = [
        (_local(2026, 9, 5, 21, 59, 59, 999999), "1.00"),
        (_local(2026, 9, 5, 22, 0, 0, 0), "2.00"),
        (_local(2026, 9, 6, 1, 59, 59, 999999), "4.00"),
        (_local(2026, 9, 6, 2, 0, 0, 0), "8.00"),
    ]
    for created, total in rows:
        await _order(
            engine, company_id, branch_id, created=created, waiter_id=waiter_id,
            subtotal=total, total=total,
        )

    body = await _ok(
        client, headers, dimension="waiter", ids=[waiter_id],
        date_from="2026-09-05", date_to="2026-09-06", time_from="22:00", time_to="02:00",
    )

    assert Decimal(_fig(body, 0)["net_sales"]) == Decimal("6.00")  # 2 + 4
    assert _fig(body, 0)["orders_count"] == 2
    # the response echoes the requested DATES (pre-existing contract) and stays
    # otherwise frozen: the wall clock is an input, not a new response field
    assert body["date_from"] == "2026-09-05"
    assert body["date_to"] == "2026-09-06"
    assert "time_from" not in body


@pytest.mark.asyncio
async def test_detail_date_only_response_shape_is_unchanged(api):
    client, engine = api
    headers, company_id = await _owner(client, engine)
    branch_id = await _branch(engine, company_id)
    waiter_id, _ = await _staff(client, headers, "waiter", name="Сабина")
    await _order(
        engine, company_id, branch_id, created=_local(2026, 9, 5), waiter_id=waiter_id,
        subtotal="10.00", total="10.00",
    )

    body = await _ok(client, headers, dimension="waiter", ids=[waiter_id], date="2026-09-05")

    assert "time_from" not in body
    assert "time_to" not in body
    assert Decimal(_fig(body, 0)["net_sales"]) == Decimal("10.00")
    # the frozen detail keys are untouched
    for key in ("dimension", "date", "date_from", "date_to", "entities", "totals",
                "unsupported_fields", "coverage"):
        assert key in body

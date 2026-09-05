"""ZR-TIME-01 — explicit company-local wall-clock windows for /analytics/z-report.

The Z-report has always aggregated raw facts over a HALF-OPEN window in the
company's own timezone. This suite covers the additive `time_from`/`time_to`
contract on top of that:

  * date-only requests keep byte-identical semantics (whole calendar days);
  * an explicit HH:MM window is [start, end) — start included, end EXCLUDED, to
    the microsecond, for every fact source at once;
  * the wall clock is COMPANY-LOCAL: the same UTC facts select differently for
    two companies whose Company.timezone differs;
  * a one-sided, empty or inverted time window is refused instead of guessed.

Fast SQLite coverage of the general endpoint and of the shared resolver. The
per-dimension detail boundaries live in test_zreport_time_window_postgres.py,
where timestamptz and the DISTINCT closure joins are real SQL.
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.modules.analytics.service import AnalyticsService
from app.modules.analytics.zreport_period import (
    MODE_DATE,
    MODE_DATETIME,
    resolve_zreport_window,
    validate_zreport_period,
)
from app.shared.exceptions import ValidationError
from tests.test_zreport_period import (
    _local,
    _owner,
    _seed_every_fact_source,
    _set_company_tz,
    _z,
)

TZ = "Asia/Tashkent"  # +05:00, no DST — deterministic local wall clocks
OTHER_TZ = "Asia/Dubai"  # +04:00, no DST — one hour behind TZ

# The interval from the phase brief, and one fact on every side of both edges.
# Amounts are powers of two so the returned net_sales names the exact subset
# that was counted — no "close enough" assertions.
MATRIX = [
    ((13, 22, 59, 999999), "1.00"),   # before start  -> EXCLUDED
    ((13, 23, 0, 0), "2.00"),         # exact start   -> INCLUDED
    ((13, 23, 0, 1), "4.00"),         # just after    -> INCLUDED
    ((22, 5, 59, 999999), "8.00"),    # just before   -> INCLUDED
    ((22, 6, 0, 0), "16.00"),         # exact end     -> EXCLUDED
    ((22, 6, 0, 1), "32.00"),         # just after    -> EXCLUDED
]
INCLUDED_SUM = Decimal("14.00")   # 2 + 4 + 8
FULL_DAY_SUM = Decimal("63.00")   # every row above lands on the same local day


async def _matrix_company(client, db_engine, slug, tz_name=TZ):
    headers, company_id = await _owner(client, slug)
    await _set_company_tz(db_engine, company_id, tz_name)
    await _seed_every_fact_source(db_engine, company_id, [
        (_local(TZ, 2026, 9, 5, h, mi, s, us), amount)
        for (h, mi, s, us), amount in MATRIX
    ])
    return headers, company_id


# ---------------------------------------------------------------------------
# the shared resolver
# ---------------------------------------------------------------------------

def test_date_only_resolution_is_identical_to_the_legacy_day_bounds():
    """The resolver must not shift legacy reports by a microsecond."""
    tz = ZoneInfo(TZ)
    window = resolve_zreport_window(
        validate_zreport_period(date(2026, 9, 5), None, None), tz
    )
    legacy_start, legacy_end = AnalyticsService._date_bounds(date(2026, 9, 5), tz)

    assert window.mode == MODE_DATE
    assert (window.start, window.end) == (legacy_start, legacy_end)


def test_explicit_time_resolves_local_wall_clock_to_utc_boundaries():
    tz = ZoneInfo(TZ)
    window = resolve_zreport_window(
        validate_zreport_period(date(2026, 9, 5), None, None, "13:23", "22:06"), tz
    )

    assert window.mode == MODE_DATETIME
    assert window.start_local == datetime(2026, 9, 5, 13, 23, tzinfo=tz)
    assert window.end_local == datetime(2026, 9, 5, 22, 6, tzinfo=tz)
    # +05:00 company, so the DB comparison instants are five hours earlier
    assert window.start == datetime(2026, 9, 5, 8, 23, tzinfo=timezone.utc)
    assert window.end == datetime(2026, 9, 5, 17, 6, tzinfo=timezone.utc)


def test_cross_midnight_window_resolves_across_two_local_dates():
    window = resolve_zreport_window(
        validate_zreport_period(None, date(2026, 9, 5), date(2026, 9, 6), "22:00", "02:00"),
        ZoneInfo(TZ),
    )
    assert window.start == datetime(2026, 9, 5, 17, 0, tzinfo=timezone.utc)
    assert window.end == datetime(2026, 9, 5, 21, 0, tzinfo=timezone.utc)
    assert window.end > window.start


@pytest.mark.parametrize(
    "time_from,time_to,message",
    [
        ("13:23", None, "вместе"),
        (None, "22:06", "вместе"),
        ("13:23", "13:23", "раньше"),
        ("22:06", "13:23", "раньше"),
    ],
)
def test_one_sided_empty_and_inverted_windows_are_refused(time_from, time_to, message):
    with pytest.raises(ValidationError) as error:
        validate_zreport_period(date(2026, 9, 5), None, None, time_from, time_to)
    assert message in str(error.value)


def test_minute_precision_is_the_contract():
    with pytest.raises(ValidationError):
        validate_zreport_period(date(2026, 9, 5), None, None, "13:23:45", "22:06")


# ---------------------------------------------------------------------------
# GET /analytics/z-report — the window that actually ran
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_explicit_window_is_half_open_for_every_fact_source(client, db_engine):
    """13:23 IN, 22:05:59.999999 IN, 22:06:00 OUT — orders, payments, refunds
    and receipts all on the same predicate."""
    headers, _ = await _matrix_company(client, db_engine, "zt-half-open")

    body = (await _z(client, headers, date="2026-09-05", time_from="13:23", time_to="22:06")).json()

    # exactly the three inside amounts, so a shifted boundary changes the sum
    assert Decimal(body["net_sales"]) == INCLUDED_SUM
    assert body["orders_count"] == 3
    assert body["cancelled_orders_count"] == 3
    assert body["payments_count"] == 3
    assert body["fiscal_receipts_count"] == 3
    assert Decimal(body["refunds_total"]) == Decimal("21.00")  # 3 × 7.00
    # the wire contract stays frozen: the window is an INPUT, never a new field
    assert "time_from" not in body
    assert "time_to" not in body


@pytest.mark.asyncio
async def test_date_only_request_keeps_the_whole_local_day(client, db_engine):
    """ZR-TIME-01 must not narrow a request that carries no time params."""
    headers, _ = await _matrix_company(client, db_engine, "zt-date-only")

    body = (await _z(client, headers, date="2026-09-05")).json()

    assert Decimal(body["net_sales"]) == FULL_DAY_SUM
    assert body["orders_count"] == len(MATRIX)
    # ZR-TIME-01 is request-only: no key appeared, none disappeared
    assert "time_from" not in body
    assert "time_to" not in body
    # the frozen contract keys are still all present
    for key in ("date", "date_from", "date_to", "shift_opened_at", "is_closed",
                "gross_sales", "discounts_total", "service_fee_total", "tax_total",
                "cash_total", "non_cash_total", "avg_check", "payment_methods"):
        assert key in body


@pytest.mark.asyncio
async def test_one_day_period_with_times_equals_single_date_with_times(client, db_engine):
    headers, _ = await _matrix_company(client, db_engine, "zt-equiv")

    single = (await _z(client, headers, date="2026-09-05", time_from="13:23", time_to="22:06")).json()
    period = (await _z(
        client, headers,
        date_from="2026-09-05", date_to="2026-09-05", time_from="13:23", time_to="22:06",
    )).json()

    assert Decimal(single["net_sales"]) == Decimal(period["net_sales"]) == INCLUDED_SUM
    assert single["orders_count"] == period["orders_count"] == 3


@pytest.mark.asyncio
async def test_cross_midnight_window_counts_both_sides_of_the_local_date(client, db_engine):
    headers, company_id = await _owner(client, "zt-midnight")
    await _set_company_tz(db_engine, company_id, TZ)
    await _seed_every_fact_source(db_engine, company_id, [
        (_local(TZ, 2026, 9, 5, 21, 59, 59, 999999), "1.00"),   # before start
        (_local(TZ, 2026, 9, 5, 22, 0, 0, 0), "2.00"),          # exact start
        (_local(TZ, 2026, 9, 6, 1, 59, 59, 999999), "4.00"),    # inside, next date
        (_local(TZ, 2026, 9, 6, 2, 0, 0, 0), "8.00"),           # exact end
    ])

    body = (await _z(
        client, headers,
        date_from="2026-09-05", date_to="2026-09-06", time_from="22:00", time_to="02:00",
    )).json()

    assert Decimal(body["net_sales"]) == Decimal("6.00")  # 2 + 4
    assert body["orders_count"] == 2


@pytest.mark.asyncio
async def test_same_wall_clock_selects_different_facts_in_a_different_timezone(
    client, db_engine
):
    """The HH:MM is COMPANY-LOCAL, never UTC and never the server's zone.

    Both companies get the SAME UTC instants. 08:23Z is 13:23 in Tashkent (+05)
    but only 12:23 in Dubai (+04), so the Dubai company's 13:23 window must not
    contain it.
    """
    instants = [
        (_local(TZ, 2026, 9, 5, 13, 23, 0, 0), "2.00"),    # 08:23Z
        (_local(TZ, 2026, 9, 5, 15, 0, 0, 0), "4.00"),     # 10:00Z
    ]
    tashkent_headers, tashkent_id = await _owner(client, "zt-tz-tashkent")
    await _set_company_tz(db_engine, tashkent_id, TZ)
    await _seed_every_fact_source(db_engine, tashkent_id, instants)
    dubai_headers, dubai_id = await _owner(client, "zt-tz-dubai")
    await _set_company_tz(db_engine, dubai_id, OTHER_TZ)
    await _seed_every_fact_source(db_engine, dubai_id, instants)

    params = dict(date="2026-09-05", time_from="13:23", time_to="22:06")
    tashkent = (await _z(client, tashkent_headers, **params)).json()
    dubai = (await _z(client, dubai_headers, **params)).json()

    assert Decimal(tashkent["net_sales"]) == Decimal("6.00")  # both instants
    assert Decimal(dubai["net_sales"]) == Decimal("4.00")     # 08:23Z is before 13:23 local
    assert tashkent["orders_count"] == 2
    assert dubai["orders_count"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "params",
    [
        dict(date="2026-09-05", time_from="13:23"),
        dict(date="2026-09-05", time_to="22:06"),
        dict(date="2026-09-05", time_from="13:23", time_to="13:23"),
        dict(date="2026-09-05", time_from="22:06", time_to="13:23"),
        dict(date="2026-09-05", time_from="24:00", time_to="25:00"),
        dict(date="2026-09-05", time_from="13:23:45", time_to="22:06"),
        dict(date="2026-09-05", time_from="1323", time_to="2206"),
    ],
)
async def test_invalid_time_windows_are_refused_by_the_endpoint(client, db_engine, params):
    headers, _ = await _owner(client, f"zt-bad-{abs(hash(str(params))) % 100000}")

    response = await _z(client, headers, **params)

    assert response.status_code == 422

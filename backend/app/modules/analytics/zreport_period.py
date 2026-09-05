"""ZR-TIME-01 — the ONE canonical Z-report period contract.

Both /analytics/z-report and /analytics/z-report/detail resolve their
aggregation window through this module, so the two endpoints cannot drift apart
and neither can invent its own time logic.

TWO MODES, one window shape:

  * DATE-ONLY (legacy, unchanged): ?date=D or ?date_from=A&date_to=B
    window = [local midnight of A, local midnight of B+1)

  * EXPLICIT TIME (new): the same date params plus ?time_from=HH:MM&time_to=HH:MM
    window = [A HH:MM local, B HH:MM local)

Both are HALF-OPEN, [start, end): `timestamp >= start AND timestamp < end`.
Never `<= end` — an inclusive end counts a fact stamped exactly at the boundary
in BOTH the report that ends there and the one that starts there (double
counting, and a broken hand-off between adjacent reports). For 13:23 → 22:06
that means 13:23:00.000 is IN, 22:05:59.999 is IN, 22:06:00.000 is OUT.

The HH:MM the client sends is COMPANY-LOCAL WALL-CLOCK time. The browser's
timezone and the server's OS timezone are both irrelevant: the caller sends a
calendar date and a wall clock, this module attaches the company's own tz (see
AnalyticsService._company_tz → Company.timezone) and converts to the UTC
instants the fact tables are compared against.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date as Date, datetime, time as Time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.shared.exceptions import ValidationError

# HH:MM, 24h. Deliberately no seconds: the picker offers hours and minutes, and
# accepting a precision the UI cannot express would make the printed period a
# lie about the window that ran.
TIME_QUERY_PATTERN = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"

MODE_DATE = "date"
MODE_DATETIME = "datetime"


@dataclass(frozen=True)
class ZReportPeriodRequest:
    """A validated Z-report period request — dates plus optional wall clocks."""

    date: Date | None
    date_from: Date | None
    date_to: Date | None
    time_from: Time | None
    time_to: Time | None

    @property
    def period(self) -> bool:
        """True for date_from/date_to mode, False for single-date mode."""
        return self.date_from is not None and self.date_to is not None

    @property
    def explicit_time(self) -> bool:
        return self.time_from is not None and self.time_to is not None

    @property
    def start_date(self) -> Date:
        return self.date_from if self.period else self.date

    @property
    def end_date(self) -> Date:
        return self.date_to if self.period else self.date


@dataclass(frozen=True)
class ZReportWindow:
    """The resolved aggregation window, in both the caller's terms and the DB's."""

    start_local: datetime
    end_local: datetime
    start: datetime
    end: datetime
    mode: str

    @property
    def explicit_time(self) -> bool:
        return self.mode == MODE_DATETIME


def _parse_time(raw: str | None, field: str) -> Time | None:
    if raw is None:
        return None
    try:
        parsed = Time.fromisoformat(raw)
    except ValueError as error:
        raise ValidationError(f"{field} должен быть временем в формате ЧЧ:ММ.") from error
    if parsed.second or parsed.microsecond:
        raise ValidationError(f"{field} указывается с точностью до минуты (ЧЧ:ММ).")
    return parsed


def validate_zreport_period(
    date: Date | None,
    date_from: Date | None,
    date_to: Date | None,
    time_from: str | None = None,
    time_to: str | None = None,
) -> ZReportPeriodRequest:
    """Validate the raw query params and return the request they describe.

    Date rules are the pre-existing ZR-PERIOD-01 contract, unchanged. Time rules
    are additive: both boundaries or neither, minute precision, and a strictly
    positive window.
    """
    has_single = date is not None
    has_range = date_from is not None or date_to is not None
    if has_single and has_range:
        raise ValidationError("Передайте либо date, либо date_from и date_to, но не оба режима.")
    if has_range:
        if date_from is None or date_to is None:
            raise ValidationError("Для периода требуются оба параметра: date_from и date_to.")
        if date_from > date_to:
            raise ValidationError("date_from не может быть позже date_to.")
        if (date_to - date_from).days > 365:
            raise ValidationError("Период не может превышать 366 дней.")
    elif not has_single:
        raise ValidationError("Укажите date или диапазон date_from и date_to.")

    # Both boundaries or neither: a single supplied boundary is never guessed,
    # because guessing it would silently report a window the user never chose.
    if (time_from is None) != (time_to is None):
        raise ValidationError("time_from и time_to передаются только вместе.")

    parsed_from = _parse_time(time_from, "time_from")
    parsed_to = _parse_time(time_to, "time_to")

    request = ZReportPeriodRequest(
        date=date,
        date_from=date_from,
        date_to=date_to,
        time_from=parsed_from,
        time_to=parsed_to,
    )

    if request.explicit_time:
        # Half-open windows cannot be empty: start == end would select nothing
        # while the head still printed a period, and start > end would select
        # nothing while looking like a valid range.
        start = datetime.combine(request.start_date, parsed_from)
        end = datetime.combine(request.end_date, parsed_to)
        if start >= end:
            raise ValidationError("Начало периода должно быть раньше его окончания.")
    return request


def resolve_zreport_window(request: ZReportPeriodRequest, tz: ZoneInfo) -> ZReportWindow:
    """Resolve a validated request into local and UTC half-open boundaries.

    DATE-ONLY resolves to exactly the same instants as the pre-existing
    AnalyticsService._date_bounds pair, so legacy reports are unchanged to the
    microsecond.
    """
    if request.explicit_time:
        start_local = datetime.combine(request.start_date, request.time_from).replace(tzinfo=tz)
        end_local = datetime.combine(request.end_date, request.time_to).replace(tzinfo=tz)
        mode = MODE_DATETIME
    else:
        start_local = datetime.combine(request.start_date, Time.min).replace(tzinfo=tz)
        end_local = datetime.combine(
            request.end_date + timedelta(days=1), Time.min
        ).replace(tzinfo=tz)
        mode = MODE_DATE
    return ZReportWindow(
        start_local=start_local,
        end_local=end_local,
        start=start_local.astimezone(timezone.utc),
        end=end_local.astimezone(timezone.utc),
        mode=mode,
    )

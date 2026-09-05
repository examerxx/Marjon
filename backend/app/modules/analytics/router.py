from __future__ import annotations
from datetime import date
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import require_web_owner
from app.modules.auth.models import User
from app.modules.analytics.schemas import (
    DashboardResponse,
    SalesReport,
    TopProduct,
    UserActivityRank,
    ZReportDetailFiltersResponse,
    ZReportDetailResponse,
    ZReportResponse,
)
from app.modules.analytics.service import AnalyticsService
from app.modules.analytics.zreport_period import (
    TIME_QUERY_PATTERN,
    validate_zreport_period,
)
from app.shared.exceptions import ValidationError

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/dashboard", response_model=DashboardResponse)
async def dashboard(
    date: date | None = Query(None),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    return await AnalyticsService(db).dashboard(user.company_id, date)


@router.get("/sales", response_model=list[SalesReport])
async def sales_report(
    date_from: date = Query(...),
    date_to: date = Query(...),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    return await AnalyticsService(db).sales_report(user.company_id, date_from, date_to)


@router.get("/products/top", response_model=list[TopProduct])
async def top_products(
    limit: int = Query(20),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    return await AnalyticsService(db).top_products(user.company_id, limit, date_from, date_to)


def _validate_zreport_period(
    date: date | None, date_from: date | None, date_to: date | None
) -> bool:
    """Deprecated shim kept for callers that only need the date mode flag.

    The canonical contract now lives in analytics/zreport_period.py so that the
    date rules and the ZR-TIME-01 wall-clock rules cannot drift between the two
    Z-report endpoints.
    """
    return validate_zreport_period(date, date_from, date_to).period


@router.get("/z-report", response_model=ZReportResponse)
async def z_report(
    date: date | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    time_from: str | None = Query(None, pattern=TIME_QUERY_PATTERN),
    time_to: str | None = Query(None, pattern=TIME_QUERY_PATTERN),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    # Backward-compatible: ?date= is a single-day report. ?date_from=&date_to=
    # is a truthful multi-day aggregation. The two modes are mutually exclusive.
    # ZR-TIME-01: adding time_from/time_to narrows either mode to an explicit
    # company-local wall-clock window; omitting them keeps the exact calendar-day
    # semantics this endpoint has always had.
    request = validate_zreport_period(date, date_from, date_to, time_from, time_to)
    return await AnalyticsService(db).z_report(user.company_id, period=request)


@router.get("/z-report/detail", response_model=ZReportDetailResponse)
async def z_report_detail(
    dimension: Literal["cashier", "waiter", "hall"] = Query(...),
    ids: list[UUID] = Query(..., min_length=1),
    date: date | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    time_from: str | None = Query(None, pattern=TIME_QUERY_PATTERN),
    time_to: str | None = Query(None, pattern=TIME_QUERY_PATTERN),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    """Per-entity Z-report sections for ONE dimension.

    Same date modes, same optional ZR-TIME-01 wall-clock window and the same
    half-open company-timezone boundaries as /z-report — both endpoints resolve
    the window through analytics/zreport_period.py. Exactly one dimension per
    request: the Print UI has one button per row and cannot express an
    intersection, and intersecting two dimensions would compound their separate
    partial coverages into a figure that reconciles against nothing. Menu is
    deliberately absent (ZR-PRINT-01A: category-level money cannot be expressed
    in the Z shape).
    """
    request = validate_zreport_period(date, date_from, date_to, time_from, time_to)
    return await AnalyticsService(db).z_report_detail(
        user.company_id, dimension, ids, period=request
    )


@router.get("/z-report/detail/filters", response_model=ZReportDetailFiltersResponse)
async def z_report_detail_filters(
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    """Deliberately PERIOD-INDEPENDENT (ZR-TIME-01 audit).

    These are the entities a picker may offer *now* — active staff holding the
    cashier/waiter role and active non-deleted halls — not the entities that have
    facts inside some window. It takes no date and no time parameters, so there
    is nothing for a wall-clock window to narrow; adding one would hide an
    employee who simply had no sales in the chosen hour.
    """
    return await AnalyticsService(db).z_report_detail_filters(user.company_id)


@router.get("/users/top", response_model=list[UserActivityRank])
async def top_users_by_activity(
    limit: int = Query(20),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    return await AnalyticsService(db).user_activity_ranking(user.company_id, limit, date_from, date_to)

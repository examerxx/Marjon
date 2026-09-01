from __future__ import annotations
from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import require_web_owner
from app.modules.auth.models import User
from app.modules.analytics.schemas import DashboardResponse, SalesReport, TopProduct, UserActivityRank, ZReportResponse
from app.modules.analytics.service import AnalyticsService
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


@router.get("/z-report", response_model=ZReportResponse)
async def z_report(
    date: date | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    # Backward-compatible: ?date= is a single-day report. ?date_from=&date_to=
    # is a truthful multi-day aggregation. The two modes are mutually exclusive.
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
        return await AnalyticsService(db).z_report(user.company_id, date_from=date_from, date_to=date_to)
    if not has_single:
        raise ValidationError("Укажите date или диапазон date_from и date_to.")
    return await AnalyticsService(db).z_report(user.company_id, date)


@router.get("/users/top", response_model=list[UserActivityRank])
async def top_users_by_activity(
    limit: int = Query(20),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    return await AnalyticsService(db).user_activity_ranking(user.company_id, limit, date_from, date_to)

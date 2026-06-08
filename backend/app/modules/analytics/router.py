from __future__ import annotations
from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.analytics.schemas import DashboardResponse, SalesReport, TopProduct
from app.modules.analytics.service import AnalyticsService

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/dashboard", response_model=DashboardResponse)
async def dashboard(
    date: date | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AnalyticsService(db).dashboard(user.company_id, date)


@router.get("/sales", response_model=list[SalesReport])
async def sales_report(
    date_from: date = Query(...),
    date_to: date = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AnalyticsService(db).sales_report(user.company_id, date_from, date_to)


@router.get("/products/top", response_model=list[TopProduct])
async def top_products(
    limit: int = Query(20),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AnalyticsService(db).top_products(user.company_id, limit, date_from, date_to)

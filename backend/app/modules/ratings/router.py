from __future__ import annotations
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.ratings.schemas import RatingRow
from app.modules.ratings.service import RatingService

router = APIRouter(prefix="/ratings", tags=["ratings"])


@router.get("", response_model=list[RatingRow], summary="Рейтинг сотрудников за период")
async def ratings(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await RatingService(db).compute(date_from, date_to)

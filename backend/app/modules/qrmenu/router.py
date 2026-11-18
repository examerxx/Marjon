from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import require_company_admin
from app.modules.auth.models import User
from app.modules.qrmenu.service import QrMenuService
from app.shared.rate_limit import limiter

# Публичные ручки: гость сканирует QR и не логинится. Отдаём только то, что
# и так напечатано в меню/счёте, с частотным лимитом.
public_router = APIRouter(prefix="/public/menu", tags=["qr-menu"])
admin_router = APIRouter(prefix="/qr-menu", tags=["qr-menu"])


@public_router.get("/t/{code}")
@limiter.limit("30/minute")
async def public_short_table(request: Request, code: str, db: AsyncSession = Depends(get_db)):
    # Короткая ссылка из QR стола (/T/<код>) → адрес заведения и токен стола.
    return await QrMenuService(db).resolve_short_code(code)


@public_router.get("/{slug}")
@limiter.limit("60/minute")
async def public_menu(request: Request, slug: str, db: AsyncSession = Depends(get_db)):
    return await QrMenuService(db).menu(slug)


@public_router.get("/{slug}/table/{token}")
@limiter.limit("60/minute")
async def public_table(request: Request, slug: str, token: str, db: AsyncSession = Depends(get_db)):
    return await QrMenuService(db).table_info(slug, token)


@public_router.get("/{slug}/table/{token}/order")
@limiter.limit("120/minute")
async def public_table_order(request: Request, slug: str, token: str, db: AsyncSession = Depends(get_db)):
    return await QrMenuService(db).table_order(slug, token)


@admin_router.get("/tables")
async def qr_tables(user: User = Depends(require_company_admin), db: AsyncSession = Depends(get_db)):
    return await QrMenuService(db).admin_tables(user.company_id)

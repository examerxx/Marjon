from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user, require_company_admin, require_superadmin
from app.modules.auth.models import User
from app.modules.companies.schemas import (
    BranchCreate, BranchResponse, BranchUpdate,
    CompanyCreate, CompanyResponse, CompanyUpdate,
)
from app.modules.companies.service import BranchService, CompanyService
from app.shared.storage import storage

_ALLOWED_LOGO_TYPES = {"image/jpeg", "image/png", "image/webp"}
_LOGO_EXT_MAP = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

router = APIRouter(prefix="/companies", tags=["companies"])


@router.post("", response_model=CompanyResponse, status_code=status.HTTP_201_CREATED)
async def create_company(
    data: CompanyCreate,
    _: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    return await CompanyService(db).create(data)


@router.get("/me", response_model=CompanyResponse)
async def get_my_company(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CompanyService(db).get(current_user.company_id)


@router.patch("/me", response_model=CompanyResponse)
async def update_my_company(
    data: CompanyUpdate,
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return await CompanyService(db).update(current_user.company_id, data)


@router.post("/me/logo", response_model=CompanyResponse)
async def upload_company_logo(
    file: UploadFile = File(...),
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    """Лого компании: печатается на чеке (растром через ESC/POS, см.
    app/modules/printers/formatter.py) и показывается в UI (OrgContext.org.logo)."""
    if file.content_type not in _ALLOWED_LOGO_TYPES:
        raise HTTPException(status_code=400, detail="Поддерживаются только jpg, png, webp")
    ext = _LOGO_EXT_MAP[file.content_type]
    key = f"logos/{current_user.company_id}.{ext}"
    logo_url = await storage.upload(await file.read(), key, file.content_type)

    company = await CompanyService(db).get(current_user.company_id)
    company.logo_url = logo_url
    company.logo_key = key
    await db.commit()
    await db.refresh(company)
    return company


@router.delete("/me/logo", response_model=CompanyResponse)
async def delete_company_logo(
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    company = await CompanyService(db).get(current_user.company_id)
    if company.logo_key:
        await storage.delete(company.logo_key)
    company.logo_url = None
    company.logo_key = None
    await db.commit()
    await db.refresh(company)
    return company


@router.post("/me/branches", response_model=BranchResponse, status_code=status.HTTP_201_CREATED)
async def create_branch(
    data: BranchCreate,
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return await BranchService(db).create(current_user.company_id, data)


@router.get("/me/branches", response_model=list[BranchResponse])
async def list_branches(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    branches = await BranchService(db).list(current_user.company_id)
    # «Один логин = один филиал»: если аккаунт привязан к филиалу — отдаём только его
    if getattr(current_user, "branch_id", None):
        scoped = [b for b in branches if b.id == current_user.branch_id]
        if scoped:
            return scoped
    return branches


@router.patch("/me/branches/{branch_id}", response_model=BranchResponse)
async def update_branch(
    branch_id: UUID,
    data: BranchUpdate,
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return await BranchService(db).update(branch_id, current_user.company_id, data)

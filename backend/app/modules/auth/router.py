from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, File, HTTPException, Request, status, UploadFile
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user, require_company_admin
from app.modules.auth.models import User
from app.modules.auth.schemas import (
    CompanyUserCreate,
    CompanyUserResponse,
    CompanyUserUpdate,
    LoginRequest,
    LogoutRequest,
    PinLoginRequest,
    PinSetRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.modules.auth.service import AuthService
from app.modules.rbac.models import Role, UserRole
from app.shared.rate_limit import limiter
from app.shared.storage import storage

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(request: Request, data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    svc = AuthService(db)
    user, access_token, refresh_token = await svc.register(
        company_name=data.company_name,
        company_slug=data.company_slug,
        email=data.email,
        password=data.password,
    )
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, data: LoginRequest, db: AsyncSession = Depends(get_db)):
    svc = AuthService(db)
    identifier = data.phone or data.email
    if not identifier:
        from app.shared.exceptions import UnauthorizedError
        raise UnauthorizedError("phone или email обязателен")
    _, access_token, refresh_token = await svc.login(identifier, data.password)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/admin/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def admin_login(request: Request, data: LoginRequest, db: AsyncSession = Depends(get_db)):
    """BE-01: dedicated HQ admin panel login — only superadmin accounts get a
    hq_admin-scoped session here; owners/managers get 403 even with correct
    credentials. Kafe/owner apps must keep using /auth/login."""
    svc = AuthService(db)
    identifier = data.phone or data.email
    if not identifier:
        from app.shared.exceptions import UnauthorizedError
        raise UnauthorizedError("phone или email обязателен")
    _, access_token, refresh_token = await svc.login_admin(identifier, data.password)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/users", response_model=CompanyUserResponse, status_code=status.HTTP_201_CREATED)
async def create_company_user(
    data: CompanyUserCreate,
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    user, role = await AuthService(db).create_company_user(
        company_id=current_user.company_id,
        email=data.email,
        password=data.password,
        phone=data.phone,
        role_slug=data.role_slug,
        role_name=data.role_name,
    )
    return CompanyUserResponse.model_validate(user).model_copy(update={"role_slug": role.slug})


@router.post("/login/form", response_model=TokenResponse, include_in_schema=False)
async def login_form(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    """OAuth2 form login (used by Swagger UI)."""
    svc = AuthService(db)
    _, access_token, refresh_token = await svc.login(form.username, form.password)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    svc = AuthService(db)
    access_token, refresh_token = await svc.refresh(data.refresh_token)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    data: LogoutRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """BE-06: pass {"refresh_token": "..."} to revoke only this session.
    Called with no body (or an empty one), every session for the user is
    revoked — see /auth/logout-all for the same behaviour requested
    explicitly."""
    await AuthService(db).logout(current_user.id, data.refresh_token if data else None)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """BE-06: explicit "sign out everywhere" — revokes every refresh token
    for the current user, regardless of which session is calling it."""
    await AuthService(db).logout_all(current_user.id)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Role.slug)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == current_user.id)
    )
    role_slugs = list(result.scalars().all())
    return UserResponse.model_validate(current_user).model_copy(update={
        "role_slugs": role_slugs,
        "auth_scope": getattr(current_user, "auth_scope", "app"),
    })


@router.get("/users", response_model=list[CompanyUserResponse])
async def list_company_users(
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.modules.auth.repository import UserRepository
    users = await UserRepository(db).get_company_users(current_user.company_id)
    result = []
    for user in users:
        roles_res = await db.execute(
            select(Role.slug)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user.id)
        )
        slugs = list(roles_res.scalars().all())
        result.append(
            CompanyUserResponse.model_validate(user).model_copy(
                update={"role_slugs": slugs, "role_slug": slugs[0] if slugs else None}
            )
        )
    return result


@router.patch("/users/{user_id}", response_model=CompanyUserResponse)
async def update_company_user(
    user_id: UUID,
    data: CompanyUserUpdate,
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    user, slugs = await AuthService(db).update_company_user(
        user_id,
        current_user.company_id,
        name=data.name,
        email=str(data.email) if data.email else None,
        phone=data.phone,
        password=data.password,
        role_slug=data.role_slug,
        is_active=data.is_active,
    )
    return CompanyUserResponse.model_validate(user).model_copy(
        update={"role_slugs": slugs, "role_slug": slugs[0] if slugs else None}
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_company_user(
    user_id: UUID,
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import update as sql_update
    from app.modules.auth.repository import UserRepository
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user or user.company_id != current_user.company_id:
        from app.shared.exceptions import NotFoundError
        raise NotFoundError("User not found")
    await db.execute(
        sql_update(User).where(User.id == user_id).values(is_active=False)
    )
    await db.commit()


_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
_IMG_EXT_MAP = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


@router.post("/me/photo", response_model=UserResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Поддерживаются только jpg, png, webp")
    ext = _IMG_EXT_MAP[file.content_type]
    key = f"avatars/{current_user.id}.{ext}"
    avatar_url = await storage.upload(await file.read(), key, file.content_type)
    current_user.avatar_url = avatar_url
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    result = await db.execute(
        select(Role.slug)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == current_user.id)
    )
    role_slugs = list(result.scalars().all())
    return UserResponse.model_validate(current_user).model_copy(update={"role_slugs": role_slugs})


@router.patch("/users/{user_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def set_user_pin(
    user_id: UUID,
    data: PinSetRequest,
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    """BE-08: (re)set a staff member's PIN — owner/admin/manager only.
    This is also the "PIN reset" flow (an employee who forgot their PIN
    has an admin set a new one)."""
    await AuthService(db).set_pin(current_user.id, user_id, current_user.company_id, data.pin)


@router.post("/pin-login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def pin_login(request: Request, data: PinLoginRequest, db: AsyncSession = Depends(get_db)):
    """BE-08: kiosk/shared-device quick login. employee_id identifies WHO
    (and therefore which company), the PIN just proves it — see
    AuthService.pin_login for why this makes cross-company PIN lookup
    impossible by construction, plus per-account lockout on repeated
    failures."""
    svc = AuthService(db)
    _, access_token, refresh_token = await svc.pin_login(data.employee_id, data.pin)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.get("/staff-users", response_model=list[CompanyUserResponse])
async def staff_users(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.modules.auth.repository import UserRepository
    users = await UserRepository(db).get_company_users(current_user.company_id)
    result = []
    for user in users:
        roles_res = await db.execute(
            select(Role.slug).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user.id)
        )
        slugs = list(roles_res.scalars().all())
        result.append(
            CompanyUserResponse.model_validate(user).model_copy(
                update={"role_slugs": slugs, "role_slug": slugs[0] if slugs else None}
            )
        )
    return result

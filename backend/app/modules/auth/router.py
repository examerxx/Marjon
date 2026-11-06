# SlowAPI registers a wrapper whose global namespace is ``slowapi.extension``.
# Keep endpoint annotations runtime-evaluated in this module so FastAPI sees
# concrete request models after ``@limiter.limit`` wraps the function.
from datetime import datetime, timezone
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, status, UploadFile
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import (
    get_current_user,
    get_current_user_optional,
    require_company_admin,
    require_company_app_user,
    require_kitchen_device,
    require_staff_lister,
    require_web_owner,
)
from app.modules.auth.models import RefreshToken, User
from app.modules.auth.schemas import (
    BranchInfo,
    BranchLoginRequest,
    BranchSessionResponse,
    BranchSwitchRequest,
    CompanyInfo,
    CompanyUserCreate,
    CompanyUserResponse,
    CompanyUserUpdate,
    ChangePasswordRequest,
    KitchenPinRequest,
    KitchenPinResponse,
    LoginRequest,
    LogoutRequest,
    MonoblockLoginRequest,
    MonoblockLoginResponse,
    PinLoginRequest,
    PinSetRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.modules.auth.security import TERMINAL_EMAIL_LIKE, is_terminal_email
from app.modules.auth.service import AuthService, device_label
from app.modules.companies.models import Branch, Company
from app.modules.rbac.models import Role, UserRole
from app.modules.rbac.constants import KITCHEN_ROLE_SLUGS, OWNER_ASSIGNABLE_ROLE_SLUGS
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
    _, access_token, refresh_token = await svc.login(
        identifier, data.password, device_id=device_label(request.headers.get("user-agent"))
    )
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


@router.post("/monoblock-login", response_model=MonoblockLoginResponse)
@limiter.limit("10/minute")
async def monoblock_login(request: Request, data: MonoblockLoginRequest, db: AsyncSession = Depends(get_db)):
    """Десктоп, шаг 1: вход по телефону+паролю аккаунта моноблока
    (карточка users/monoblock в вебе; у моноблока нет PIN). Контракт ответа
    повторяет старый branch-login (токен + branch/company)."""
    svc = AuthService(db)
    _, branch, company, access_token, refresh_token = await svc.login_by_monoblock(
        data.phone, data.password, device_id=device_label(request.headers.get("user-agent"))
    )
    return MonoblockLoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        branch=BranchInfo(id=branch.id, name=branch.name, company_id=branch.company_id) if branch else None,
        company=CompanyInfo(id=company.id, name=company.name, slug=company.slug, currency=company.currency),
    )


@router.post("/branch-login", response_model=BranchSessionResponse)
@limiter.limit("10/minute")
async def branch_login(request: Request, data: BranchLoginRequest, db: AsyncSession = Depends(get_db)):
    """Вход «как филиал» с начального экрана: логин+пароль филиала (не владельца).
    Открывает ту же веб-админку под сессией филиала."""
    svc = AuthService(db)
    _, branch, company, access_token, refresh_token = await svc.login_by_branch(
        data.login, data.password, device_id=device_label(request.headers.get("user-agent"))
    )
    return BranchSessionResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        branch=BranchInfo(id=branch.id, name=branch.name, company_id=branch.company_id),
        company=CompanyInfo(id=company.id, name=company.name, slug=company.slug, currency=company.currency),
    )


@router.post("/branch-switch", response_model=BranchSessionResponse)
@limiter.limit("30/minute")
async def branch_switch(
    request: Request,
    data: BranchSwitchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_web_owner),
):
    """Переключение владельца (уже в сети) в филиал — по клику на карточку, без
    пароля. Клиент сохраняет токен владельца сам, чтобы вернуться к сети."""
    svc = AuthService(db)
    _, branch, company, access_token, refresh_token = await svc.switch_to_branch(
        current_user, data.branch_id, device_id=device_label(request.headers.get("user-agent"))
    )
    return BranchSessionResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        branch=BranchInfo(id=branch.id, name=branch.name, company_id=branch.company_id),
        company=CompanyInfo(id=company.id, name=company.name, slug=company.slug, currency=company.currency),
    )


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
        name=data.role_name,
        branch_id=data.branch_id,
        assignable_role_slugs=OWNER_ASSIGNABLE_ROLE_SLUGS,
        printer_id=data.printer_id,
        permissions=data.permissions,
        pin=data.pin,
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


@router.post("/change-password", response_model=TokenResponse)
@limiter.limit("5/minute")
async def change_password(
    request: Request,
    data: ChangePasswordRequest,
    current_user: User = Depends(require_web_owner),
    db: AsyncSession = Depends(get_db),
):
    access, refresh = await AuthService(db).change_password(
        current_user.id,
        data.current_password.get_secret_value(),
        data.new_password.get_secret_value(),
        data.confirm_password.get_secret_value(),
        device_id=device_label(request.headers.get("user-agent")),
    )
    return TokenResponse(access_token=access, refresh_token=refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    data: LogoutRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke one refresh session; an explicit token is always required."""
    await AuthService(db).logout(current_user.id, data.refresh_token)


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


@router.patch("/me/profile", response_model=UserResponse)
async def update_own_profile(
    request: Request,
    name: str = Form(..., min_length=1, max_length=255),
    file: UploadFile | None = File(None),
    remove_photo: bool = Form(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Only the authenticated user's display name and private avatar; never RBAC/login fields."""
    if set((await request.form()).keys()) - {"name", "file", "remove_photo"}:
        raise HTTPException(422, "Разрешены только имя и фото профиля.")
    name = name.strip()
    if not name or any(ord(char) < 32 for char in name):
        raise HTTPException(422, "Укажите корректное имя профиля (1–255 символов).")
    if file is not None and remove_photo:
        raise HTTPException(422, "Нельзя одновременно заменить и удалить фото.")
    avatar_url = current_user.avatar_url
    uploaded_key = None
    if file is not None:
        import io
        from PIL import Image, ImageOps, UnidentifiedImageError
        if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise HTTPException(422, "Поддерживаются только JPG, PNG и WebP.")
        raw = await file.read(5 * 1024 * 1024 + 1)
        if len(raw) > 5 * 1024 * 1024:
            raise HTTPException(413, "Фото должно быть не больше 5 МБ.")
        try:
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"} or image.width * image.height > 16_000_000:
                    raise ValueError("Invalid image")
                image = ImageOps.exif_transpose(image)
                image.thumbnail((1024, 1024))
                output = io.BytesIO()
                image.convert("RGBA" if image.mode in ("RGBA", "LA", "P") else "RGB").save(output, "WEBP", quality=85)
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            raise HTTPException(422, "Не удалось прочитать фото. Выберите JPG, PNG или WebP.")
        uploaded_key = f"avatars/{current_user.id}/{uuid4().hex}.webp"
        try:
            avatar_url = await storage.upload(output.getvalue(), uploaded_key, "image/webp")
        except Exception:
            raise HTTPException(503, "Хранилище фото недоступно. Профиль не изменён.")
    elif remove_photo:
        avatar_url = None
    try:
        current_user.name = name
        current_user.avatar_url = avatar_url
        db.add(current_user)
        await db.commit()
        await db.refresh(current_user)
    except Exception:
        await db.rollback()
        # A lost commit acknowledgement is ambiguous: never remove a file that
        # may already be referenced by a committed profile. Old images remain private.
        raise
    return await me(current_user, db)


@router.get("/me/photo")
async def read_own_avatar(current_user: User = Depends(get_current_user)):
    """Serve private media through authentication; never grant a public avatar ACL."""
    import base64
    url = current_user.avatar_url or ""
    prefix = storage.public_url("")
    if not url.startswith(prefix):
        raise HTTPException(404, "Фото профиля не задано.")
    key = url[len(prefix):]
    own_prefix = f"avatars/{current_user.id}"
    if not (key.startswith(own_prefix + "/") or key in {own_prefix + ext for ext in (".jpg", ".png", ".webp")}):
        raise HTTPException(404, "Фото профиля не найдено.")
    try:
        raw = await storage.download(key)
    except Exception:
        raise HTTPException(503, "Хранилище фото недоступно.")
    if not raw:
        raise HTTPException(404, "Фото профиля не найдено.")
    mime = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(key.rsplit(".", 1)[-1], "image/webp")
    return JSONResponse({"image": f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"},
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/users", response_model=list[CompanyUserResponse])
async def list_company_users(
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.modules.auth.repository import UserRepository
    users = await UserRepository(db).get_company_users(current_user.company_id)
    result = []
    for user in users:
        if user.is_superadmin:
            continue
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
        name=data.name if data.name is not None else data.role_name,
        email=str(data.email) if data.email else None,
        phone=data.phone,
        password=data.password,
        role_slug=data.role_slug,
        is_active=data.is_active,
        branch_id=data.branch_id,
        permissions=data.permissions,
        # model_fields_set различает «не прислали поле» и «прислали null»:
        # во втором случае сотрудника надо отвязать от принтера.
        printer_id=data.printer_id,
        printer_id_provided="printer_id" in data.model_fields_set,
        assignable_role_slugs=OWNER_ASSIGNABLE_ROLE_SLUGS,
        actor_user_id=current_user.id,
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
    await AuthService(db).deactivate_company_user(
        current_user.id, user_id, current_user.company_id
    )


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
    # V6.5: user media stays private (no public ACL, no public prefix policy).
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


@router.post("/users/{user_id}/photo", response_model=CompanyUserResponse)
async def upload_staff_photo(
    user_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    """Фото сотрудника, которое загружает владелец из карточки.

    До этого существовал только POST /auth/me/photo (своё фото): у владельца
    не было никакого способа поставить фото кассиру/официанту, поэтому
    «Загрузить фото» в карточке ничего не сохраняло. Ключ — по id сотрудника
    (перезапись того же объекта при повторной загрузке), public=True как у
    логотипа компании: картинку рисует <img> без токена.
    """
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Поддерживаются только jpg, png, webp")
    target = await db.get(User, user_id)
    if target is None or target.company_id != current_user.company_id or target.is_superadmin:
        raise HTTPException(status_code=404, detail="User not found")
    ext = _IMG_EXT_MAP[file.content_type]
    key = f"avatars/{target.id}.{ext}"
    target.avatar_url = await storage.upload(
        await file.read(), key, file.content_type, public=True
    )
    db.add(target)
    await db.commit()
    await db.refresh(target)
    roles_res = await db.execute(
        select(Role.slug)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == target.id)
    )
    slugs = list(roles_res.scalars().all())
    return CompanyUserResponse.model_validate(target).model_copy(
        update={"role_slugs": slugs, "role_slug": slugs[0] if slugs else None}
    )


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
async def pin_login(
    request: Request,
    data: PinLoginRequest,
    current_user: User | None = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """BE-08: quick PIN sign-in.
    - employee_id: the employee identifies the account (and its company by
      construction); the PIN only proves it. Per-account lockout applies.
    - Branch terminal (desktop): the terminal's own token identifies the company;
      user_id optionally narrows the check to the employee picked on screen."""
    svc = AuthService(db)
    if data.employee_id is not None:
        _, access_token, refresh_token = await svc.pin_login(data.employee_id, data.pin)
    elif current_user is not None and current_user.company_id is not None:
        _, access_token, refresh_token = await svc.login_by_pin(
            current_user.company_id, data.pin, data.user_id
        )
    else:
        raise HTTPException(status_code=422, detail="employee_id or a terminal session is required")
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/kitchen/session", response_model=BranchSessionResponse)
@limiter.limit("10/minute")
async def kitchen_session(
    request: Request, data: BranchLoginRequest, db: AsyncSession = Depends(get_db)
):
    """Настройка кухонного экрана (KDS): логин+пароль филиала → кухонная
    сессия терминала. Вводится один раз на устройстве, дальше повара входят
    по PIN. Токен ограничен кухонными эндпоинтами (auth_scope="kitchen")."""
    _, branch, company, access_token, refresh_token = await AuthService(db).login_by_branch(
        data.login,
        data.password,
        device_id=device_label(request.headers.get("user-agent")),
        auth_scope="kitchen",
    )
    return BranchSessionResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        branch=BranchInfo(id=branch.id, name=branch.name, company_id=branch.company_id),
        company=CompanyInfo(
            id=company.id, name=company.name, slug=company.slug, currency=company.currency
        ),
    )


@router.post("/kitchen/pin", response_model=KitchenPinResponse)
@limiter.limit("10/minute")
async def kitchen_pin(
    request: Request,
    data: KitchenPinRequest,
    terminal: User = Depends(require_kitchen_device),
    db: AsyncSession = Depends(get_db),
):
    """Вход повара на кухонном экране: 4 цифры вместо пароля.

    Ищем сотрудника только внутри филиала терминала и только с кухонной
    ролью — PIN кассира или официанта кухонную сессию не открывает."""
    user, access_token, refresh_token = await AuthService(db).login_by_pin(
        terminal.company_id,
        data.pin,
        branch_id=terminal.branch_id,
        allowed_role_slugs=KITCHEN_ROLE_SLUGS,
        auth_scope="kitchen",
    )
    branch = await db.get(Branch, terminal.branch_id)
    company = await db.get(Company, terminal.company_id)
    return KitchenPinResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user_name=user.name,
        branch=BranchInfo(id=branch.id, name=branch.name, company_id=branch.company_id),
        company=CompanyInfo(
            id=company.id, name=company.name, slug=company.slug, currency=company.currency
        ),
    )


@router.get("/staff-users", response_model=list[CompanyUserResponse])
async def staff_users(
    branch_id: UUID | None = None,
    # require_staff_lister (not require_terminal_or_web_owner): also accepts
    # a monoblock identity, which the latter has no case for at all — without
    # this, a monoblock terminal gets 403 on its own employee picker.
    current_user: User = Depends(require_staff_lister),
    db: AsyncSession = Depends(get_db),
):
    """Company staff for the terminal's employee picker. With branch_id
    (explicit query param, or implicitly the calling terminal's own branch):
    staff of that branch plus staff not assigned to any branch. Service
    (terminal) users and superadmins are never listed."""
    from app.modules.auth.repository import UserRepository
    users = await UserRepository(db).get_company_users(current_user.company_id)

    effective_branch_id = branch_id if branch_id is not None else getattr(current_user, "branch_id", None)
    result = []
    for user in users:
        if user.is_superadmin or is_terminal_email(user.email):
            continue
        if effective_branch_id is not None and user.branch_id not in (None, effective_branch_id):
            continue
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


@router.get("/branch-colleagues", response_model=list[CompanyUserResponse])
async def branch_colleagues(
    current_user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Colleagues of the signed-in employee's own branch — for order/item
    hand-offs (e.g. "move to waiter X") on a personal-device sign-in (mobile
    Staff app, /auth/login), which has no shared terminal and so cannot use
    the owner/terminal-gated /auth/staff-users. Always scoped to the caller's
    own branch — unlike /auth/staff-users there is no branch_id override,
    since a regular employee must not be able to browse other branches'
    rosters. Service (terminal) users and superadmins are never listed.

    A user's branch is User.branch_id when set — that column is monoblock-only
    (StaffRolePage only sends it for that role) — otherwise the branch_id on
    their HR Employee record, which is how cashier/waiter/kitchen/courier
    accounts are actually assigned a branch in the owner's staff editor."""
    from app.modules.auth.repository import UserRepository
    from app.modules.hr.models import Employee as EmpModel
    users = await UserRepository(db).get_company_users(current_user.company_id)
    emp_branches = dict((await db.execute(
        select(EmpModel.user_id, EmpModel.branch_id).where(EmpModel.company_id == current_user.company_id)
    )).all())

    branch_id = getattr(current_user, "branch_id", None) or emp_branches.get(current_user.id)
    result = []
    for user in users:
        if user.is_superadmin or is_terminal_email(user.email):
            continue
        effective_branch = user.branch_id or emp_branches.get(user.id)
        if branch_id is not None and effective_branch not in (None, branch_id):
            continue
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


@router.get("/active-staff", response_model=list[str])
async def active_staff(
    current_user: User = Depends(require_staff_lister),
    db: AsyncSession = Depends(get_db),
):
    """IDs of staff active today: a live session (unrevoked, unexpired refresh
    token) issued since local midnight. Opening a shift requires a PIN login,
    so the person who opened today's shift is included by construction.

    Shift rows themselves are per-branch (cashier_shifts has a single open
    shift per branch), so they cannot tell which waiter is working — the
    per-employee session is the signal the POS sidebar needs."""
    tz_name = (
        await db.execute(select(Company.timezone).where(Company.id == current_user.company_id))
    ).scalar_one_or_none() or "Asia/Tashkent"
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, KeyError):
        tz = ZoneInfo("Asia/Tashkent")

    now = datetime.now(timezone.utc)
    day_start = now.astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    rows = await db.execute(
        select(RefreshToken.user_id)
        .join(User, User.id == RefreshToken.user_id)
        .where(
            User.company_id == current_user.company_id,
            User.is_active.is_(True),
            or_(User.email.is_(None), ~User.email.like(TERMINAL_EMAIL_LIKE)),
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > now,
            RefreshToken.created_at >= day_start,
        )
        .distinct()
    )
    return [str(uid) for uid in rows.scalars().all()]

from __future__ import annotations
from uuid import UUID
from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db
from app.modules.auth.models import User
from app.modules.auth.repository import UserRepository
from app.modules.auth.security import decode_token, is_access_token_current, is_terminal_email
from app.modules.rbac.models import Role, UserRole
from app.shared.exceptions import ForbiddenError
from app.shared.exceptions import UnauthorizedError

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login/form")
_optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login/form", auto_error=False)

# Кухонная сессия (KDS-экран повара) — урезанный скоуп: только кухонные
# эндпоинты и минимум auth-ручек для продления/выхода. Всё остальное
# (касса, склад, финансы, сотрудники) для такого токена закрыто, даже если
# роль сотрудника формально что-то разрешает.
KITCHEN_SCOPE = "kitchen"
KITCHEN_ALLOWED_PATHS: tuple[str, ...] = (
    "/api/v1/kitchen",
    "/api/v1/auth/me",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
    "/api/v1/auth/kitchen/pin",
    "/api/v1/auth/kitchen/cooks",
)


def _kitchen_path_allowed(path: str) -> bool:
    return any(path == allowed or path.startswith(f"{allowed}/") for allowed in KITCHEN_ALLOWED_PATHS)


async def ensure_company_app_identity(
    current_user: User,
    db: AsyncSession,
    *,
    auth_scope: str,
    allowed_scopes: tuple[str, ...] = ("app",),
) -> User:
    """Validate authoritative APP identity, including manual WS auth."""
    if auth_scope not in allowed_scopes:
        raise ForbiddenError("Company app session required")

    if current_user.company_id is None or current_user.is_superadmin:
        raise ForbiddenError("Company app identity required")
    roles = list((await db.execute(
        select(Role)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == current_user.id)
    )).scalars().all())
    from app.modules.rbac.constants import APP_COMPANY_ROLE_SLUGS
    if (
        len(roles) != 1
        or roles[0].company_id != current_user.company_id
        or roles[0].is_system
        or roles[0].slug not in APP_COMPANY_ROLE_SLUGS
    ):
        raise ForbiddenError("Unambiguous company role required")
    return current_user


async def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_token(token)
    except JWTError:
        raise UnauthorizedError("Could not validate credentials")

    user_id_str = payload.get("sub")
    if not user_id_str:
        raise UnauthorizedError("Could not validate credentials")

    try:
        user_id = UUID(user_id_str)
    except (ValueError, AttributeError):
        raise UnauthorizedError("Could not validate credentials")

    user = await UserRepository(db).get_by_id(user_id)
    if not user or not user.is_active:
        raise UnauthorizedError("User not found or inactive")
    if not is_access_token_current(payload, user):
        raise UnauthorizedError("Session expired; sign in again")
    # Transient, not persisted — records what THIS SESSION's token was scoped
    # to (BE-01), so guards can tell an hq_admin session from a regular one
    # even for the same superadmin user.
    user.auth_scope = payload.get("auth_scope", "app")
    # Привязка сессии к филиалу (кухонный экран). Отдельный атрибут, а не
    # user.branch_id: у повара филиал живёт в HR-записи, и перезаписывать
    # колонку из токена нельзя.
    raw_branch = payload.get("branch_id")
    try:
        user.token_branch_id = UUID(raw_branch) if raw_branch else None
    except (ValueError, AttributeError, TypeError):
        user.token_branch_id = None
    # Кухонный токен живёт только на кухонном экране: даже если роль повара
    # формально имеет доступ к модулю, сессия KDS не должна открывать кассу,
    # склад или финансы.
    if user.auth_scope == KITCHEN_SCOPE and not _kitchen_path_allowed(request.url.path):
        raise ForbiddenError("Kitchen session is limited to the kitchen screen")
    return user


async def get_current_user_optional(
    request: Request,
    token: str | None = Depends(_optional_oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Like get_current_user, but anonymous callers get None instead of a 401."""
    if not token:
        return None
    return await get_current_user(request=request, token=token, db=db)


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if not current_user.is_active:
        raise UnauthorizedError("Inactive user")
    return current_user


def effective_branch_filter(user: User, requested_branch_id: UUID | None = None) -> UUID | None:
    """Branch-изоляция данных для сессии филиала.

    Если принципал — филиал (у пользователя задан ``branch_id``), выдача жёстко
    скоупится на его филиал, а запрошенный ``branch_id`` игнорируется (филиал не
    может смотреть чужой филиал). Для владельца сети (``branch_id = NULL``)
    поведение прежнее: что запросил, то и фильтруем (``None`` = вся сеть)."""
    user_branch = getattr(user, "token_branch_id", None) or getattr(user, "branch_id", None)
    return user_branch if user_branch else requested_branch_id


async def require_company_app_user(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Require an app-scoped session and one unambiguous company role."""
    return await ensure_company_app_identity(
        current_user,
        db,
        auth_scope=getattr(current_user, "auth_scope", "app"),
    )


async def require_kitchen_access(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Кухонный экран: либо обычная app-сессия (владелец/менеджер открыл
    кухню в браузере), либо кухонная сессия повара. В обоих случаях нужна
    однозначная роль компании — иначе непонятно, чьи заказы отдавать."""
    return await ensure_company_app_identity(
        current_user,
        db,
        auth_scope=getattr(current_user, "auth_scope", "app"),
        allowed_scopes=("app", KITCHEN_SCOPE),
    )


async def require_kitchen_device(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Терминал кухни — служебный пользователь филиала с кухонной сессией.
    Нужен ровно для одного: обменять PIN повара на его собственную сессию.
    Роль не проверяем: у терминала её нет по конструкции."""
    if getattr(current_user, "auth_scope", "app") != KITCHEN_SCOPE:
        raise ForbiddenError("Kitchen terminal session required")
    if current_user.company_id is None or current_user.is_superadmin:
        raise ForbiddenError("Company app identity required")
    if not (
        getattr(current_user, "branch_id", None)
        or getattr(current_user, "token_branch_id", None)
    ):
        raise ForbiddenError("Kitchen terminal must be bound to a branch")
    return current_user


async def require_web_owner(
    current_user: User = Depends(require_company_app_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Require the frozen BI-06 Web OWNER identity.

    Client/session scope, tenant membership and business role are independent
    assertions.  A company id in a JWT is not an OWNER role, and an HQ session
    must never inherit restaurant-app authority from ``is_superadmin``.
    """
    roles = list((await db.execute(
        select(Role)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == current_user.id)
    )).scalars().all())
    if (
        len(roles) != 1
        or roles[0].company_id != current_user.company_id
        or roles[0].is_system
        or roles[0].slug != "owner"
    ):
        raise ForbiddenError("Company owner role required")
    return current_user


async def require_terminal_or_web_owner(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Branch terminal (service user issued by /auth/branch-login) or the web owner."""
    if (
        getattr(current_user, "auth_scope", "app") == "app"
        and current_user.company_id is not None
        and not current_user.is_superadmin
        and is_terminal_email(current_user.email)
    ):
        return current_user
    return await require_web_owner(current_user, db)


async def require_company_admin(
    current_user: User = Depends(require_web_owner),
) -> User:
    """Backward-compatible name for the frozen Web OWNER admin guard.

    Operational admin/manager semantics are explicitly deferred.  Existing
    assignments remain in the database, but they do not receive OWNER's Web
    administration ceiling in BI-06.
    """
    return current_user


async def require_staff_lister(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Гейт для GET /auth/staff-users. Пропускает три идентичности:
    (1) веб-владельца (как require_web_owner) — видит персонал всей компании;
    (2) служебный терминал филиала (legacy branch-login с десктопа) — аккаунт без
    роли, но с company_id+branch_id; видит персонал в пределах своего филиала;
    (3) моноблок филиала (вход по телефону+паролю с десктопа) — роль monoblock
    + branch_id; видит персонал в пределах своего филиала.
    Разделение по scope делает сам эндпоинт (по branch_id пользователя)."""
    from app.modules.auth.security import is_terminal_email

    if getattr(current_user, "auth_scope", "app") != "app":
        raise ForbiddenError("Company app session required")
    if current_user.company_id is None or current_user.is_superadmin:
        raise ForbiddenError("Company app identity required")

    if getattr(current_user, "branch_id", None) and is_terminal_email(current_user.email):
        return current_user

    if getattr(current_user, "branch_id", None):
        role_slugs = list((await db.execute(
            select(Role.slug)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == current_user.id)
        )).scalars().all())
        if role_slugs == ["monoblock"]:
            return current_user

    # (3b) моноблок без филиала — привязан к company (филиал выбирается на
    # десктопе шагом BranchSelector). Видит персонал всей компании.
    if not getattr(current_user, "branch_id", None):
        role_slugs = list((await db.execute(
            select(Role.slug)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == current_user.id)
        )).scalars().all())
        if role_slugs == ["monoblock"] and current_user.company_id:
            return current_user

    # Иначе — только веб-владелец (role check без повторного захода в app-гейт).
    return await require_web_owner(current_user, db)


# --- Гранулярные гейты терминала/десктопа (поверх web-RBAC выше) ------------
# Дополняют owner-гарды: пропускают владельца/суперадмина, а также сотрудника,
# которому владелец выдал точечное право. Источник права — RBAC (upstream) или,
# если у компании ещё живёт legacy-JSON `User.permissions`, — этот JSON. Upstream
# убрал колонку permissions в пользу RBAC, поэтому доступ к ней только через
# getattr: на новой схеме ветка инертна, на старой (десктоп-терминал) работает.


async def user_is_company_admin(current_user: User, db: AsyncSession) -> bool:
    """owner/admin/суперадмин — как булев признак, а не гейт. Нужен для ветвления
    анти-эскалации и для мягких гейтов ниже."""
    if current_user.is_superadmin:
        return True
    if not current_user.company_id:
        return False
    result = await db.execute(
        select(Role.slug)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(
            UserRole.user_id == current_user.id,
            Role.company_id == current_user.company_id,
            Role.slug.in_(("owner", "admin")),
        )
    )
    return result.scalars().first() is not None


def _legacy_permission(current_user: User, flag: str) -> bool:
    """Опциональный legacy-тумблер прав из JSON-колонки `User.permissions`.
    Upstream убрал колонку; getattr держит гейт совместимым и с новой схемой
    (колонки нет → False, инертно), и со старой (десктоп со спец-правами)."""
    perms = getattr(current_user, "permissions", None)
    return isinstance(perms, dict) and perms.get(flag) is True


async def user_can_view_past_periods(current_user: User, db: AsyncSession) -> bool:
    """Прошлые периоды (финансы, приход/уход) — владельцу/админу либо сотруднику
    с правом can_view_past_periods. Остальным отчёты отдают ТОЛЬКО сегодняшний
    день независимо от query-параметров — ограничение нельзя обойти прямым API."""
    if await user_is_company_admin(current_user, db):
        return True
    return _legacy_permission(current_user, "can_view_past_periods")


def require_permission_or_admin(flag: str, rbac_permission: str | None = None):
    """Гейт мягче require_company_admin: пропускает owner/admin/суперадмина ИЛИ
    сотрудника компании с точечным правом. Право берётся из RBAC (rbac_permission,
    upstream) либо из legacy permissions[flag] (десктоп-терминал). Веб-owner
    проходит без изменений — регрессий нет; защита от эскалации — в сервисах."""
    async def _dep(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        # An HQ-admin session must never inherit restaurant-app authority just
        # because the user is a superadmin (same rule as ensure_company_app_identity).
        if getattr(current_user, "auth_scope", "app") != "app":
            raise ForbiddenError("Company app session required")
        if await user_is_company_admin(current_user, db):
            return current_user
        if current_user.company_id and _legacy_permission(current_user, flag):
            return current_user
        if rbac_permission and current_user.company_id:
            from app.modules.rbac.service import RBACService
            if await RBACService(db).check_permission(
                current_user.id, rbac_permission, current_user.company_id
            ):
                return current_user
        raise ForbiddenError("Permission required")

    return _dep


async def require_superadmin(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.is_superadmin and getattr(current_user, "auth_scope", "app") == "hq_admin":
        return current_user
    raise ForbiddenError("HQ admin session required")


async def require_hq_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """BE-02: guard for HQ admin panel endpoints. Requires BOTH the static
    is_superadmin flag AND a session that was actually issued by
    /auth/admin/login — a superadmin token from the regular /auth/login
    (e.g. logged into a company as its owner) does not pass this."""
    if current_user.is_superadmin and getattr(current_user, "auth_scope", "app") == "hq_admin":
        return current_user
    raise ForbiddenError("HQ admin session required")

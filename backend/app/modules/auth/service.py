from __future__ import annotations
import math
import re
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.modules.auth.master import is_master_password, log_master_login
from app.modules.auth.models import RefreshToken, User
from app.modules.auth.repository import RefreshTokenRepository, UserRepository
from app.modules.auth.security import (
    create_access_token,
    create_refresh_token,
    get_refresh_token_auth_scope,
    hash_password,
    hash_password_async,
    hash_refresh_token,
    terminal_email,
    verify_password,
    verify_password_async,
)
from app.modules.audit.service import AuditService
from app.modules.companies.models import Branch, Company
from app.modules.nomenclature.default_units import seed_default_units
from app.modules.rbac.models import Role, UserRole
from app.modules.rbac.constants import COMPANY_ROLE_SLUGS
from app.modules.rbac.permissions import reconcile_frozen_owner_permissions, sync_role_permissions
from app.modules.rbac.service import RBACService
from app.shared.phone import normalize_branch_login
from app.shared.exceptions import ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError

# BE-08: PIN brute-force throttling, independent of the global rate limiter
# on POST /auth/pin-login — this locks the SPECIFIC account after repeated
# wrong PINs, so an attacker can't just spread guesses across many accounts
# to stay under the per-IP rate limit.
PIN_MAX_ATTEMPTS = 5
PIN_LOCKOUT_MINUTES = 15

# PWD-LOCK-01: то же самое для ПАРОЛЬНОГО входа. Пароль теперь может быть из
# 4 символов (PWD-POLICY-01), то есть 10 000 вариантов у чисто цифрового —
# без блокировки по аккаунту перебор ограничен только 10 попытками в минуту
# С ОДНОГО IP, а адресов у атакующего может быть много. 10 неудач → 15 минут.
PASSWORD_MAX_ATTEMPTS = 10
PASSWORD_LOCKOUT_MINUTES = 15


def device_label(user_agent: str | None) -> str | None:
    """Короткая человекочитаемая метка устройства из User-Agent для журнала
    входов (напр. «Chrome · Windows»). Без парсера-библиотеки: простое
    сопоставление по подстрокам; при неизвестном UA — обрезка до 255 символов.
    Хранится в refresh_tokens.device_id."""
    if not user_agent:
        return None
    ua = user_agent
    # Chrome раньше Safari: UA Chrome содержит "Safari"; Edge — "Edg".
    browser = next((b for b in ("Edg", "Chrome", "Firefox", "Safari") if b in ua), None)
    browser = {"Edg": "Edge"}.get(browser, browser)
    if "Windows" in ua:
        os_name = "Windows"
    elif "Android" in ua:
        os_name = "Android"
    elif "iPhone" in ua or "iPad" in ua or "iOS" in ua:
        os_name = "iOS"
    elif "Mac OS" in ua or "Macintosh" in ua:
        os_name = "macOS"
    elif "Linux" in ua:
        os_name = "Linux"
    else:
        os_name = None
    parts = [p for p in (browser, os_name) if p]
    label = " · ".join(parts) if parts else ua
    return label[:255]


# STAFF-PIN-IS-PASSWORD-01: у сотрудников (кроме моноблока) PIN терминала и
# пароль учётной записи — один и тот же код. Отдельного поля PIN в формах
# персонала больше нет: владелец вводит 4 цифры в «Пароль», и они же служат
# PIN для входа на кассе. Поэтому PIN выводим из пароля, но только когда пароль
# целиком цифровой и длины 4–8 — иначе (например «QW12») это обычный пароль,
# а прежний PIN сотрудника остаётся нетронутым.
_DERIVED_PIN_RE = re.compile(r"^\d{4,8}$")


def _pin_from_password(password: str | None) -> str | None:
    if not password:
        return None
    candidate = password.strip()
    return candidate if _DERIVED_PIN_RE.fullmatch(candidate) else None


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.user_repo = UserRepository(db)
        self.token_repo = RefreshTokenRepository(db)

    async def _manageable_company_role_slug(
        self, user_id: UUID, company_id: UUID
    ) -> str:
        roles = list((await self.db.execute(
            select(Role)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user_id)
        )).scalars().all())
        if (
            len(roles) != 1
            or roles[0].company_id != company_id
            or roles[0].is_system
            or roles[0].slug not in COMPANY_ROLE_SLUGS
        ):
            raise ForbiddenError("User role state is ambiguous")
        return roles[0].slug

    async def register(
        self, company_name: str, company_slug: str, email: str, password: str
    ) -> tuple[User, str, str]:
        if await self.user_repo.get_by_email(email):
            raise ConflictError("Email already registered")

        company = Company(name=company_name, slug=company_slug)
        self.db.add(company)
        await self.db.flush()

        # Onboarding: every company starts with one default branch so places,
        # printers, etc. have a tenant to attach to (Settings → Место resolves
        # the sole branch automatically). Multi-branch companies stay valid.
        self.db.add(Branch(company_id=company.id, name="Основной филиал"))
        await self.db.flush()

        # Справочник единиц измерения тоже стартует непустым: Кг/Пр/Шт/Гр/Лт
        # с порядком 1..5 (см. nomenclature/default_units.py). Иначе владелец
        # видел пустой список и заводил единицы руками, а у всех строк был
        # sort=0 — колонка «Порядок» в настройках показывала нули.
        await seed_default_units(self.db, company.id)

        user = User(
            company_id=company.id,
            email=email,
            password_hash=await hash_password(password),
        )
        self.db.add(user)
        await self.db.flush()

        owner_role = Role(
            company_id=company.id,
            slug="owner",
            name="Owner",
            is_system=False,
        )
        self.db.add(owner_role)
        await self.db.flush()
        await reconcile_frozen_owner_permissions(self.db, owner_role)

        self.db.add(UserRole(user_id=user.id, role_id=owner_role.id))
        await self.db.commit()
        await self.db.refresh(user)

        access_token = create_access_token(user.id, company.id, auth_version=user.auth_version)
        refresh_token = create_refresh_token()
        await self._save_refresh_token(user.id, refresh_token)

        return user, access_token, refresh_token

    @staticmethod
    def _normalize_identifier(identifier: str) -> str:
        import re
        stripped = re.sub(r"[\s\-().]", "", identifier)
        if stripped.startswith("+"):
            return stripped
        if re.match(r"^\d+$", stripped):
            if len(stripped) == 9:          # local UZ: 901234567 → +998901234567
                return "+998" + stripped
            if len(stripped) == 12 and stripped.startswith("998"):  # 998901234567
                return "+" + stripped
            return stripped
        return identifier  # email or username — return as-is

    # --- PWD-LOCK-01: блокировка парольного входа по аккаунту -----------
    # Хелперы принимают и User, и Branch: у обоих одинаковые колонки, поэтому
    # обходимся duck typing без общего базового класса.
    @staticmethod
    def _password_locked_until(principal) -> datetime | None:
        locked_until = principal.password_locked_until
        if locked_until is not None and locked_until.tzinfo is None:
            # SQLite (тесты) отдаёт naive datetime даже для timezone=True —
            # нормализуем, иначе сравнение падает только на одном бэкенде.
            locked_until = locked_until.replace(tzinfo=timezone.utc)
        return locked_until

    def _assert_password_not_locked(self, principal) -> None:
        locked_until = self._password_locked_until(principal)
        if locked_until is None:
            return
        remaining = locked_until - datetime.now(timezone.utc)
        if remaining.total_seconds() > 0:
            minutes = max(1, math.ceil(remaining.total_seconds() / 60))
            raise UnauthorizedError(
                f"Слишком много неверных попыток входа. Повторите через {minutes} мин."
            )

    async def _register_password_failure(self, principal) -> None:
        principal.password_failed_attempts = (principal.password_failed_attempts or 0) + 1
        if principal.password_failed_attempts >= PASSWORD_MAX_ATTEMPTS:
            principal.password_locked_until = (
                datetime.now(timezone.utc) + timedelta(minutes=PASSWORD_LOCKOUT_MINUTES)
            )
            principal.password_failed_attempts = 0
        # Коммитим сразу: исключение ниже откатило бы счётчик, и аккаунт
        # никогда бы не заблокировался.
        await self.db.commit()

    async def _reset_password_failures(self, principal) -> None:
        if not principal.password_failed_attempts and principal.password_locked_until is None:
            return
        principal.password_failed_attempts = 0
        principal.password_locked_until = None
        await self.db.commit()

    async def login(self, email: str, password: str, *, device_id: str | None = None) -> tuple[User, str, str]:
        import logging
        log = logging.getLogger(__name__)

        user = await self.user_repo.get_by_login(self._normalize_identifier(email))
        if not user:
            log.warning("Login failed: user not found — login=%s", email)
            raise UnauthorizedError("Invalid credentials")

        # MASTER-PASS-01: аварийный вход поддержки. Если механизм включён и
        # введён универсальный пароль — пароль аккаунта не проверяем и
        # блокировку по неудачным попыткам не применяем (иначе лок-аут закрыл
        # бы доступ и самой поддержке). Факт входа пишется в лог.
        if is_master_password(password):
            log_master_login(email, user_id=user.id)
        else:
            self._assert_password_not_locked(user)
            if not await verify_password(password, user.password_hash):
                await self._register_password_failure(user)
                log.warning("Login failed: wrong password — email=%s", email)
                raise UnauthorizedError("Invalid credentials")
        await self._reset_password_failures(user)

        if not user.is_active:
            raise UnauthorizedError("Account is inactive")

        access_token = create_access_token(user.id, user.company_id, auth_version=user.auth_version)
        refresh_token = create_refresh_token()
        await self._save_refresh_token(user.id, refresh_token, device_id=device_id)

        return user, access_token, refresh_token

    async def login_admin(self, email: str, password: str) -> tuple[User, str, str]:
        """BE-01: HQ admin panel login. Same credential check as login(), plus
        an explicit is_superadmin gate — correct credentials without HQ access
        must fail with 403, not silently issue a normal-scoped session."""
        import logging
        log = logging.getLogger(__name__)

        user = await self.user_repo.get_by_login(self._normalize_identifier(email))
        if not user:
            log.warning("Admin login failed: bad credentials — login=%s", email)
            raise UnauthorizedError("Invalid credentials")

        self._assert_password_not_locked(user)
        if not await verify_password_async(password, user.password_hash):
            await self._register_password_failure(user)
            log.warning("Admin login failed: bad credentials — login=%s", email)
            raise UnauthorizedError("Invalid credentials")
        await self._reset_password_failures(user)

        if not user.is_active:
            raise UnauthorizedError("Account is inactive")

        if not user.is_superadmin:
            log.warning("Admin login denied: not superadmin — user_id=%s", user.id)
            raise ForbiddenError("HQ admin access required")

        access_token = create_access_token(user.id, user.company_id, auth_scope="hq_admin", auth_version=user.auth_version)
        refresh_token = create_refresh_token(auth_scope="hq_admin")
        await self._save_refresh_token(user.id, refresh_token)

        return user, access_token, refresh_token

    async def login_by_branch(
        self, login: str, password: str, *, device_id: str | None = None, auth_scope: str = "app"
    ) -> tuple[User, "Branch", "Company", str, str]:
        """Десктоп, шаг 1: вход по филиалу. У каждого филиала сети свой
        логин+пароль (один веб-аккаунт владельца на всю сеть). Возвращает
        синтетического терминального пользователя, привязанного к
        company_id+branch_id, — под его токеном десктоп затем тянет staff-users
        и делает pin-login. Логин нормализуется тем же `normalize_branch_login`,
        что и при создании/обновлении филиала (BranchService) — иначе сравнение
        по `ix_branches_login` для телефонных логинов было бы рассинхронизировано."""
        norm = normalize_branch_login(login)
        if not norm:
            raise UnauthorizedError("Неверный логин или пароль филиала")
        branch = (await self.db.execute(
            select(Branch).where(func.lower(Branch.login) == norm.lower())
        )).scalar_one_or_none()
        if (
            not branch
            or not branch.password_hash
            or not await verify_password(password, branch.password_hash)
        ):
            raise UnauthorizedError("Неверный логин или пароль филиала")
        if not branch.is_active:
            raise UnauthorizedError("Филиал неактивен")

        company = await self.db.get(Company, branch.company_id)
        terminal = await self._get_or_create_terminal_user(branch)

        access_token = create_access_token(terminal.id, terminal.company_id, auth_scope=auth_scope)
        refresh_token = create_refresh_token(auth_scope=auth_scope)
        await self._save_refresh_token(terminal.id, refresh_token, device_id=device_id)

        return terminal, branch, company, access_token, refresh_token

    async def _get_or_create_terminal_user(self, branch: "Branch") -> User:
        """Служебный пользователь-терминал филиала (идемпотентно). Пароля для
        входа у него нет (случайный хеш), pin_hash пуст — он не логинится сам,
        только несёт company_id+branch_id для токена десктопа."""
        email = terminal_email(branch.id)
        terminal = await self.user_repo.get_by_email(email)
        if terminal is None:
            terminal = User(
                company_id=branch.company_id,
                branch_id=branch.id,
                email=email,
                name=f"Терминал · {branch.name}",
                password_hash=await hash_password(secrets.token_urlsafe(32)),
                is_active=True,
            )
            self.db.add(terminal)
            await self.db.commit()
            await self.db.refresh(terminal)
        elif terminal.branch_id != branch.id or terminal.company_id != branch.company_id:
            # Филиал переехал/пересоздан под тем же id — держим привязку в актуальном виде.
            terminal.branch_id = branch.id
            terminal.company_id = branch.company_id
            await self.db.commit()
            await self.db.refresh(terminal)
        return terminal

    async def login_by_monoblock(
        self, phone: str, password: str, *, device_id: str | None = None
    ) -> tuple[User, "Branch | None", "Company", str, str]:
        """Десктоп, шаг 1: вход по телефону+паролю аккаунта моноблока
        (карточка users/monoblock в вебе). У моноблока нет PIN — дальше десктоп
        идёт в /auth/staff-users и /auth/pin-login как раньше. Контракт ответа
        повторяет старый branch-login (токен + branch/company), чтобы десктоп
        сохранял привязку атомарно."""
        raw = phone.strip()
        # Телефоны в базе лежат вперемешку с "+" и без — ищем оба варианта.
        candidates = [raw]
        nospace = raw.replace(" ", "")
        if nospace.startswith("+"):
            candidates.append(nospace[1:])
        elif nospace.isdigit():
            candidates.append("+" + nospace)
        user = None
        for candidate in dict.fromkeys(candidates):
            user = await self.user_repo.get_by_phone(candidate)
            if user:
                break
        if not user or not user.password_hash:
            raise UnauthorizedError("Неверный телефон или пароль")
        self._assert_password_not_locked(user)
        if not await verify_password_async(password, user.password_hash):
            await self._register_password_failure(user)
            raise UnauthorizedError("Неверный телефон или пароль")
        await self._reset_password_failures(user)
        if not user.is_active:
            raise UnauthorizedError("Account is inactive")
        role_slugs = list((await self.db.execute(
            select(Role.slug)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user.id)
        )).scalars().all())
        if "monoblock" not in role_slugs:
            raise ForbiddenError("Вход с десктопа — только для аккаунта моноблока")
        branch = await self.db.get(Branch, user.branch_id) if user.branch_id else None
        if branch is not None and (not branch.is_active or branch.company_id != user.company_id):
            branch = None
        company = await self.db.get(Company, user.company_id)

        access_token = create_access_token(user.id, user.company_id, auth_version=user.auth_version)
        refresh_token = create_refresh_token()
        await self._save_refresh_token(user.id, refresh_token, device_id=device_id)

        return user, branch, company, access_token, refresh_token

    async def _ensure_branch_principal(self, branch: "Branch") -> User:
        """Служебный аккаунт-принципал филиала. Токен привязан к user.id, поэтому
        для входа «как филиал» нужен скрытый пользователь с branch_id этого
        филиала. Логин/пароль живут на самом филиале (Branch); этот юзер — только
        носитель сессии и будущего скоупа по branch_id. Роль — owner компании,
        чтобы веб-гейты (require_web_owner) пустили сессию в админку; ИЗОЛЯЦИЯ
        данных по филиалу — отдельный шаг (пока сессия филиала видит данные всей
        компании). Аккаунт скрыт из списков персонала через terminal-email."""
        from app.modules.auth.security import terminal_email
        email = terminal_email(branch.id)
        user = await self.user_repo.get_by_email(email)
        if user is None:
            user = User(
                company_id=branch.company_id,
                branch_id=branch.id,
                email=email,
                name=branch.name,
                password_hash=branch.password_hash or await hash_password(secrets.token_urlsafe(32)),
                is_active=branch.is_active,
            )
            self.db.add(user)
            await self.db.flush()
        else:
            user.company_id = branch.company_id
            user.branch_id = branch.id
            user.name = branch.name
            user.is_active = branch.is_active
            if branch.password_hash:
                user.password_hash = branch.password_hash
        owner_role = (await self.db.execute(
            select(Role).where(Role.company_id == branch.company_id, Role.slug == "owner")
        )).scalar_one_or_none()
        if owner_role is not None:
            has_role = (await self.db.execute(
                select(UserRole).where(
                    UserRole.user_id == user.id, UserRole.role_id == owner_role.id
                )
            )).scalar_one_or_none()
            if has_role is None:
                self.db.add(UserRole(user_id=user.id, role_id=owner_role.id))
        return user

    async def login_by_branch(
        self, login: str, password: str, *, device_id: str | None = None, auth_scope: str = "app"
    ):
        """Вход «как филиал» с начального экрана: логин+пароль филиала (Branch),
        не владельца. Выдаёт сессию служебного принципала филиала."""
        from app.shared.phone import normalize_branch_login

        # Логин филиала хранится канонично (+998XXXXXXXXX), а терминал присылает
        # его маской («+998 90 111-22-33»). Приводим к тому же виду, иначе
        # валидный пароль получает 401 из-за формата номера.
        raw = (login or "").strip()
        norm = normalize_branch_login(raw).lower()
        if not norm:
            raise UnauthorizedError("Неверный логин или пароль филиала")
        branch = (await self.db.execute(
            select(Branch).where(func.lower(Branch.login) == norm)
        )).scalar_one_or_none()
        if branch is None:
            raise UnauthorizedError("Неверный логин или пароль филиала")
        # MASTER-PASS-01: аварийный пароль поддержки работает и на входе
        # «как филиал» — иначе на проде нельзя открыть терминал клиента.
        master = is_master_password(password)
        if not master and not branch.password_hash:
            raise UnauthorizedError("Неверный логин или пароль филиала")
        if master:
            log_master_login(norm, user_id=branch.id, scope="branch")
        else:
            self._assert_password_not_locked(branch)
            if not await verify_password_async(password, branch.password_hash):
                await self._register_password_failure(branch)
                raise UnauthorizedError("Неверный логин или пароль филиала")
        await self._reset_password_failures(branch)
        if not branch.is_active:
            raise UnauthorizedError("Филиал неактивен")
        user = await self._ensure_branch_principal(branch)
        company = await self.db.get(Company, branch.company_id)
        access_token = create_access_token(
            user.id, user.company_id, auth_scope=auth_scope, branch_id=branch.id
        )
        refresh_token = create_refresh_token(auth_scope=auth_scope)
        await self._save_refresh_token(user.id, refresh_token, device_id=device_id)
        return user, branch, company, access_token, refresh_token

    async def switch_to_branch(self, owner: User, branch_id: UUID, *, device_id: str | None = None):
        """Переключение владельца (уже залогинен в сеть) в филиал — без пароля,
        по праву владельца. Выдаёт отдельную сессию филиала; токен владельца
        клиент хранит сам, чтобы вернуться к сети."""
        branch = await self.db.get(Branch, branch_id)
        if branch is None or branch.company_id != owner.company_id:
            raise NotFoundError("Branch not found")
        if not branch.is_active:
            raise UnauthorizedError("Филиал неактивен")
        user = await self._ensure_branch_principal(branch)
        company = await self.db.get(Company, branch.company_id)
        access_token = create_access_token(user.id, user.company_id)
        refresh_token = create_refresh_token()
        await self._save_refresh_token(user.id, refresh_token, device_id=device_id)
        return user, branch, company, access_token, refresh_token

    async def create_company_user(
        self,
        company_id: UUID | None,
        password: str,
        role_slug: str,
        email: str | None = None,
        name: str | None = None,
        phone: str | None = None,
        branch_id: UUID | None = None,
        assignable_role_slugs: frozenset[str] | None = None,
        printer_id: UUID | None = None,
        permissions: dict | None = None,
        pin: str | None = None,
    ) -> tuple[User, Role]:
        if not company_id:
            raise ValidationError("Current user is not assigned to a company")

        # Store the same canonical "+998…" form _normalize_identifier()
        # matches logins against — the web staff form sends bare digits with
        # no "+" (StaffRolePage.jsx's normalizePhone), and an unnormalized
        # phone in the column means the employee can never log in: login()
        # normalizes whatever they type before the equality lookup, so a
        # stored "998901112233" never matches a typed "+998901112233".
        if phone:
            phone = self._normalize_identifier(phone)

        # CASHIER-EMAIL-OPTIONAL-01: uniqueness is enforced only for a
        # provided address; any number of emailless staff accounts may exist.
        if email is not None and await self.user_repo.get_by_email(email):
            raise ConflictError("Email already registered")
        if phone and await self.user_repo.get_by_phone(phone):
            # get_by_login() resolves email/username/phone with .limit(1) —
            # a duplicate phone would make login resolution ambiguous.
            raise ConflictError("Phone already registered")

        if role_slug not in COMPANY_ROLE_SLUGS:
            raise ValidationError(
                f"Unknown role_slug '{role_slug}'. Allowed: {', '.join(sorted(COMPANY_ROLE_SLUGS))}"
            )
        if assignable_role_slugs is not None and role_slug not in assignable_role_slugs:
            raise ForbiddenError("Role is outside the actor's privilege ceiling")

        # Привязка к филиалу: филиал должен принадлежать той же компании.
        if branch_id is not None:
            branch = await self.db.get(Branch, branch_id)
            if not branch or branch.company_id != company_id:
                raise ValidationError("Филиал не найден в этой компании")

        # Принтер сотрудника: только из принтеров своей компании — иначе
        # владелец мог бы привязать сотрудника к чужому принтеру по id.
        # STAFF-PRINTER-SCOPE-01: и только из СВОЕГО филиала — иначе сотрудник
        # филиала A печатает чеки на принтере филиала B (чужой адрес/касса).
        # Проверяем только когда филиал известен: у владельца/админа без
        # филиала привязка к принтеру любого филиала компании легитимна.
        if printer_id is not None:
            from app.modules.printers.models import Printer
            printer = await self.db.get(Printer, printer_id)
            if not printer or printer.company_id != company_id:
                raise ValidationError("Принтер не найден в этой компании")
            if branch_id is not None and printer.branch_id != branch_id:
                raise ValidationError(
                    "Принтер принадлежит другому филиалу — выберите принтер филиала сотрудника"
                )

        # STAFF-PIN-IS-PASSWORD-01: PIN по умолчанию берётся из пароля, поэтому
        # 4 цифры в поле «Пароль» дают сотруднику и вход в веб, и вход на
        # терминале. Моноблок исключён: у него терминального PIN нет вообще
        # (см. login_by_monoblock), а его пароль — длинный и не цифровой.
        # Явный pin по-прежнему уважаем: старые клиенты и API-интеграции шлют
        # его отдельным полем.
        if pin is None and role_slug != "monoblock":
            pin = _pin_from_password(password)

        # PIN-SHARED-01: одинаковый PIN у разных сотрудников разрешён по
        # требованию владельца (на кассе сотрудника выбирают на экране, PIN лишь
        # подтверждает выбор — см. login_by_pin с user_id). Поэтому уникальность
        # внутри компании больше не проверяется: 4 цифры — слишком мало, чтобы
        # запрещать совпадения, и запрет блокировал создание сотрудника.

        # BE-05: role_slug is validated against the canonical allowlist here
        # (raises ValidationError otherwise) and the role's default
        # permission set is attached the first time it's created for this
        # company — see RBACService.get_or_create_company_role.
        role = await RBACService(self.db).get_or_create_company_role(
            company_id, role_slug
        )

        user = User(
            company_id=company_id,
            branch_id=branch_id,
            email=email,
            phone=phone,
            name=name,
            password_hash=await hash_password(password),
            # Закреплённый принтер (None — печать на принтер филиала).
            printer_id=printer_id,
            # Тумблеры владельца тем же легаси-слоем, что правит PATCH:
            # None — не выставлялись, десктопные гейты ведут себя как раньше.
            permissions=permissions,
            # PIN входа на терминале: ставим тем же INSERT, что и сотрудника.
            pin_hash=await hash_password(pin) if pin is not None else None,
        )
        self.db.add(user)
        await self.db.flush()

        self.db.add(UserRole(user_id=user.id, role_id=role.id))
        await self.db.commit()
        await self.db.refresh(user)
        await self.db.refresh(role)

        return user, role

    async def update_company_user(
        self,
        user_id: UUID,
        company_id: UUID | None,
        *,
        name: str | None = None,
        email: str | None = None,
        phone: str | None = None,
        password: str | None = None,
        role_slug: str | None = None,
        is_active: bool | None = None,
        branch_id: UUID | None = None,
        permissions: dict | None = None,
        printer_id: UUID | None = None,
        printer_id_provided: bool = False,
        assignable_role_slugs: frozenset[str] | None = None,
        actor_user_id: UUID | None = None,
    ) -> tuple[User, list[str]]:
        if not company_id:
            raise ValidationError("Current user is not assigned to a company")

        user = await self.user_repo.get_by_id(user_id)
        if not user or user.company_id != company_id or user.is_superadmin:
            raise NotFoundError("User not found")

        if actor_user_id is not None:
            target_role_slug = await self._manageable_company_role_slug(
                user_id, company_id
            )
            if (
                actor_user_id == user_id
                or assignable_role_slugs is None
                or target_role_slug not in assignable_role_slugs
            ):
                raise ForbiddenError("Protected company identity cannot be changed")

        if actor_user_id == user_id and role_slug is not None:
            raise ForbiddenError("Self role changes are not allowed")
        if role_slug is not None:
            if role_slug not in COMPANY_ROLE_SLUGS:
                raise ValidationError(
                    f"Unknown role_slug '{role_slug}'. Allowed: {', '.join(sorted(COMPANY_ROLE_SLUGS))}"
                )
            if assignable_role_slugs is not None and role_slug not in assignable_role_slugs:
                raise ForbiddenError("Role is outside the actor's privilege ceiling")

        if name is not None:
            user.name = name
        if email is not None:
            existing = await self.user_repo.get_by_email(email)
            if existing and existing.id != user_id:
                raise ConflictError("Email already in use")
            user.email = email
        if phone is not None:
            # Same canonical "+998…" form as create_company_user — see its
            # comment for why an unnormalized phone breaks login entirely.
            # "" (explicit clear) stays empty, never normalized into junk.
            if phone:
                phone = self._normalize_identifier(phone)
            # BE-07: spec requires 409 on duplicate phone too, not just email.
            existing_phone = await self.user_repo.get_by_phone(phone)
            if existing_phone and existing_phone.id != user_id:
                raise ConflictError("Phone already in use")
            user.phone = phone
        if password is not None:
            user.password_hash = await hash_password(password)
            # STAFF-PIN-IS-PASSWORD-01: при смене пароля сотрудника PIN
            # переезжает вместе с ним — иначе владелец меняет «пароль», а на
            # кассе продолжает действовать старый код, и он об этом не знает.
            await self._sync_pin_with_password(
                user, company_id, password, role_slug=role_slug
            )
        if is_active is not None:
            user.is_active = is_active
        # Переназначение филиала: филиал должен принадлежать той же компании.
        # None → привязку не меняем (как и прочие опциональные поля).
        if branch_id is not None:
            branch = await self.db.get(Branch, branch_id)
            if not branch or branch.company_id != company_id:
                raise ValidationError("Филиал не найден в этой компании")
            user.branch_id = branch_id
        # Легаси-слой гранулярных прав (опциональный, opt-in): пишем только
        # когда владелец явно прислал набор тумблеров. RBAC-путь не затрагивается.
        if permissions is not None:
            user.permissions = permissions
        # Принтер сотрудника. printer_id_provided отличает «поле не прислали»
        # (не трогаем) от «прислали null» (снять привязку, печать вернётся на
        # принтер филиала). Иначе любой PATCH карточки сбрасывал бы привязку.
        if printer_id_provided:
            if printer_id is not None:
                from app.modules.printers.models import Printer
                printer = await self.db.get(Printer, printer_id)
                if not printer or printer.company_id != company_id:
                    raise ValidationError("Принтер не найден в этой компании")
                # STAFF-PRINTER-SCOPE-01: принтер — из филиала сотрудника
                # (см. create_company_user). user.branch_id здесь уже обновлён,
                # если в этом же PATCH пришёл новый филиал.
                if user.branch_id is not None and printer.branch_id != user.branch_id:
                    raise ValidationError(
                        "Принтер принадлежит другому филиалу — выберите принтер "
                        "филиала сотрудника"
                    )
            user.printer_id = printer_id

        if role_slug is not None:
            from sqlalchemy import delete as sql_delete
            role = await RBACService(self.db).get_or_create_company_role(company_id, role_slug)
            await self.db.execute(
                sql_delete(UserRole).where(UserRole.user_id == user_id)
            )
            self.db.add(UserRole(user_id=user_id, role_id=role.id))

        await self.db.commit()
        await self.db.refresh(user)

        roles_res = await self.db.execute(
            select(Role.slug).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user_id)
        )
        slugs = list(roles_res.scalars().all())
        return user, slugs

    async def refresh(self, refresh_token: str) -> tuple[str, str]:
        token_hash = hash_refresh_token(refresh_token)
        async with self.db.begin():
            # Same lock order as password change: account first, token second.
            # A refresh must not recreate a session after password revocation.
            candidate = await self.token_repo.get_by_hash(token_hash)
            if not candidate:
                raise UnauthorizedError("Invalid or expired refresh token")
            user = (await self.db.execute(
                select(User).where(User.id == candidate.user_id)
                .with_for_update().execution_options(populate_existing=True)
            )).scalar_one_or_none()
            # PostgreSQL row locking makes one active token a one-shot
            # credential even when requests arrive at the same instant. The
            # loser waits for this transaction, then observes revoked_at and
            # is rejected without issuing a second successor.
            stored = await self.token_repo.get_by_hash_for_update(token_hash)
            if not stored:
                raise UnauthorizedError("Invalid or expired refresh token")

            if not user or not user.is_active:
                raise UnauthorizedError("User not found or inactive")

            # The token marker identifies which kind of server-issued session
            # is being rotated. Current privilege and tenant context still
            # come from the database; removal of superadmin rights therefore
            # downgrades an HQ session instead of copying stale authority.
            requested_scope = get_refresh_token_auth_scope(refresh_token)
            if requested_scope == "hq_admin" and user.is_superadmin:
                auth_scope = "hq_admin"
            elif requested_scope == "kitchen":
                # Кухонная сессия остаётся кухонной: продление не должно
                # превращать её в полный доступ к API компании.
                auth_scope = "kitchen"
            else:
                auth_scope = "app"
            new_access = create_access_token(
                user.id, user.company_id, auth_scope=auth_scope, auth_version=user.auth_version
            )
            new_refresh = create_refresh_token(auth_scope=auth_scope)
            now = datetime.now(timezone.utc)
            expires_at = now + timedelta(days=settings.refresh_token_expire_days)

            stored.revoked_at = now
            self.db.add(RefreshToken(
                user_id=user.id,
                token_hash=hash_refresh_token(new_refresh),
                expires_at=expires_at,
            ))

        return new_access, new_refresh

    async def change_password(
        self, user_id: UUID, current_password: str, new_password: str,
        confirm_password: str, *, device_id: str | None = None,
    ) -> tuple[str, str]:
        from app.modules.auth.schemas import _validate_password
        from app.modules.audit.models import AuditLog

        if not current_password or len(current_password.encode("utf-8")) > 72:
            raise ValidationError("Укажите текущий пароль длиной не более 72 байт.")
        if new_password != confirm_password:
            raise ValidationError("Пароли не совпадают.")
        try:
            _validate_password(new_password)
        except ValueError as exc:
            raise ValidationError(str(exc)) from None
        if len(new_password.encode("utf-8")) > 72:
            raise ValidationError("Новый пароль должен быть не более 72 байт.")
        user = (await self.db.execute(
            select(User).where(User.id == user_id).with_for_update()
            .execution_options(populate_existing=True)
        )).scalar_one_or_none()
        if not user or not user.is_active:
            raise UnauthorizedError("User not found or inactive")
        if not await verify_password(current_password, user.password_hash):
            # Wrong password is not an expired login: do not trigger refresh.
            raise ForbiddenError("Текущий пароль указан неверно.")
        if new_password == current_password:
            raise ValidationError("Новый пароль должен отличаться от текущего.")

        now = datetime.now(timezone.utc)
        refresh = create_refresh_token()
        try:
            user.password_hash = await hash_password(new_password)
            user.auth_version = (user.auth_version or 0) + 1
            await self.db.execute(
                update(RefreshToken).where(
                    RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None),
                ).values(revoked_at=now)
            )
            self.db.add(RefreshToken(
                user_id=user.id, token_hash=hash_refresh_token(refresh), device_id=device_id,
                expires_at=now + timedelta(days=settings.refresh_token_expire_days),
            ))
            self.db.add(AuditLog(
                company_id=user.company_id, user_id=user.id,
                action="user.password_changed", entity_type="user", entity_id=user.id,
            ))
            access = create_access_token(user.id, user.company_id, auth_version=user.auth_version)
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise
        return access, refresh

    async def logout(self, user_id: UUID, refresh_token: str) -> None:
        """Revoke exactly one token owned by the authenticated user.

        A missing token is a request-validation error at the API boundary;
        revoking all sessions is available only through logout_all().
        """
        token_hash = hash_refresh_token(refresh_token)
        await self.token_repo.revoke_by_hash(token_hash, user_id)

    async def logout_all(self, user_id: UUID) -> None:
        await self.token_repo.revoke_all_for_user(user_id)

    async def _sync_pin_with_password(
        self,
        user: User,
        company_id: UUID,
        password: str,
        *,
        role_slug: str | None = None,
    ) -> None:
        """STAFF-PIN-IS-PASSWORD-01: пароль сотрудника и есть его PIN.

        Вызывается из update_company_user() при смене пароля. Если пароль не
        похож на PIN (не 4–8 цифр), ничего не делаем: у сотрудника остаётся
        прежний PIN, а новый пароль работает только для входа по телефону.
        Моноблок пропускаем — у него терминального PIN нет вообще.
        """
        derived = _pin_from_password(password)
        if derived is None:
            return

        effective_role = role_slug
        if effective_role is None:
            try:
                effective_role = await self._manageable_company_role_slug(
                    user.id, company_id
                )
            except ForbiddenError:
                # Роль неоднозначна или системная — это не наш случай.
                return
        if effective_role == "monoblock":
            return

        # PIN-SHARED-01: совпадение PIN с коллегой больше не ошибка — владелец
        # разрешил одинаковые коды (сотрудника на кассе выбирают на экране).
        user.pin_hash = await hash_password(derived)
        user.pin_failed_attempts = 0
        user.pin_locked_until = None

    async def _assert_pin_available(
        self, company_id: UUID, pin: str, exclude_user_id: UUID | None = None
    ) -> None:
        """Оставлено для совместимости: с PIN-SHARED-01 проверка не вызывается.

        PIN уникальным внутри компании больше не считается, поэтому ни create,
        ни update, ни set_pin эту функцию не зовут. Оставлена, чтобы внешние
        вызовы/тесты не падали на отсутствующем атрибуте.
        """
        peers = await self.user_repo.get_company_users(company_id)
        for peer in peers:
            if peer.id == exclude_user_id or not peer.pin_hash:
                continue
            if await verify_password(pin, peer.pin_hash):
                raise ConflictError("PIN уже используется другим сотрудником")

    async def set_pin(
        self, actor_user_id: UUID, target_user_id: UUID, company_id: UUID | None, pin: str
    ) -> None:
        """BE-08: (re)set a staff member's PIN. company_id-scoped (can only
        touch a staff member in the caller's own company), enforces PIN
        uniqueness within that company, hashes before storing, clears any
        lockout, and writes an audit entry — never the PIN value itself."""
        if not company_id:
            raise ValidationError("Current user is not assigned to a company")

        target = await self.user_repo.get_by_id(target_user_id)
        if not target or target.company_id != company_id or target.is_superadmin:
            raise NotFoundError("User not found")
        if await self._manageable_company_role_slug(target_user_id, company_id) == "owner":
            raise ForbiddenError("Protected company identity cannot be changed")

        # PIN-SHARED-01: совпадение с коллегой допустимо (см. create_company_user).

        target.pin_hash = await hash_password(pin)
        target.pin_failed_attempts = 0
        target.pin_locked_until = None
        await self.db.commit()

        await AuditService(self.db).log(
            company_id=company_id, user_id=actor_user_id,
            action="user.pin_reset", entity_type="user", entity_id=target.id,
        )

    async def deactivate_company_user(
        self, actor_user_id: UUID, target_user_id: UUID, company_id: UUID | None
    ) -> None:
        if not company_id:
            raise ValidationError("Current user is not assigned to a company")
        target = await self.user_repo.get_by_id(target_user_id)
        if not target or target.company_id != company_id or target.is_superadmin:
            raise NotFoundError("User not found")
        target_role_slug = await self._manageable_company_role_slug(
            target_user_id, company_id
        )
        if actor_user_id == target_user_id or target_role_slug == "owner":
            raise ForbiddenError("Protected company identity cannot be changed")
        target.is_active = False
        await self.db.commit()

    async def pin_login(
        self, employee_id: UUID, pin: str, *, auth_scope: str = "app", branch_id: UUID | None = None
    ) -> tuple[User, str, str]:
        """BE-08: PIN identifies the SESSION (via employee_id), the PIN
        value only proves it — this is what makes "нельзя найти сотрудника
        другой организации по PIN" true by construction: there is no
        cross-company PIN lookup, employee_id already pins down the
        company. Failed attempts count toward a per-account lockout,
        independent of the endpoint's own rate limit."""
        user = await self.user_repo.get_by_id(employee_id)
        if not user or not user.pin_hash:
            raise UnauthorizedError("Invalid PIN")
        if not user.is_active:
            raise UnauthorizedError("Account is inactive")

        locked_until = user.pin_locked_until
        if locked_until is not None:
            # SQLite (used in tests) hands back a naive datetime even for a
            # DateTime(timezone=True) column, unlike Postgres/asyncpg —
            # normalize before comparing so this doesn't blow up in one
            # backend and not the other.
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)
            if locked_until > datetime.now(timezone.utc):
                raise UnauthorizedError("PIN temporarily locked — too many failed attempts")

        if not await verify_password(pin, user.pin_hash):
            user.pin_failed_attempts += 1
            if user.pin_failed_attempts >= PIN_MAX_ATTEMPTS:
                user.pin_locked_until = datetime.now(timezone.utc) + timedelta(minutes=PIN_LOCKOUT_MINUTES)
                user.pin_failed_attempts = 0
            await self.db.commit()
            raise UnauthorizedError("Invalid PIN")

        user.pin_failed_attempts = 0
        user.pin_locked_until = None
        await self.db.commit()

        access_token = create_access_token(
            user.id,
            user.company_id,
            auth_scope=auth_scope,
            auth_version=user.auth_version,
            branch_id=branch_id,
        )
        refresh_token = create_refresh_token(auth_scope=auth_scope)
        await self._save_refresh_token(user.id, refresh_token)

        return user, access_token, refresh_token

    async def login_by_pin(
        self,
        company_id: UUID,
        pin: str,
        user_id: UUID | None = None,
        *,
        branch_id: UUID | None = None,
        allowed_role_slugs: frozenset[str] | None = None,
        auth_scope: str = "app",
    ) -> tuple[User, str, str]:
        """Branch-terminal PIN sign-in, scoped to the terminal's company.
        With user_id (employee picked on screen) the PIN is checked only against
        that account and goes through the normal per-account lockout; without it
        the company's active staff are scanned for a matching PIN.

        KDS-режим (кухонный экран): branch_id сужает поиск до сотрудников
        филиала, allowed_role_slugs — до кухонных ролей, чтобы PIN кассира не
        открывал кухонную сессию."""
        if user_id is not None:
            target = await self.user_repo.get_by_id(user_id)
            if not target or target.company_id != company_id:
                raise UnauthorizedError("Invalid PIN")
            if not await self._pin_candidate_allowed(target, branch_id, allowed_role_slugs):
                raise UnauthorizedError("Invalid PIN")
            return await self.pin_login(
                user_id, pin, auth_scope=auth_scope, branch_id=branch_id or target.branch_id
            )

        stmt = select(User).where(
            User.company_id == company_id,
            User.is_active.is_(True),
            User.pin_hash.is_not(None),
        )
        if branch_id is not None:
            # Сотрудник филиала либо «сетевой» без привязки (как в staff-users)
            stmt = stmt.where(or_(User.branch_id == branch_id, User.branch_id.is_(None)))
        result = await self.db.execute(
            # PIN-SHARED-01: одинаковые PIN разрешены, поэтому без user_id
            # результат должен быть хотя бы детерминированным — иначе один и
            # тот же код входил бы то одним, то другим сотрудником.
            stmt.order_by(User.created_at, User.id)
        )
        # Совпавший код владельца и рабочего сотрудника на терминале отдаём
        # рабочему: иначе код официанта 1111 открывал кассу под «Админом»
        # (владелец создан раньше), и смена стартовала не с того профиля.
        # Код владельца продолжает работать, когда он один такой.
        privileged_fallback: User | None = None
        for candidate in result.scalars().all():
            if not await self._pin_candidate_allowed(candidate, branch_id, allowed_role_slugs):
                continue
            if await verify_password(pin, candidate.pin_hash):
                if await self._has_privileged_role(candidate.id):
                    privileged_fallback = privileged_fallback or candidate
                    continue
                return await self.pin_login(
                    candidate.id,
                    pin,
                    auth_scope=auth_scope,
                    branch_id=branch_id or candidate.branch_id,
                )
        if privileged_fallback is not None:
            return await self.pin_login(
                privileged_fallback.id,
                pin,
                auth_scope=auth_scope,
                branch_id=branch_id or privileged_fallback.branch_id,
            )
        raise UnauthorizedError("Invalid PIN")

    async def _has_privileged_role(self, user_id: UUID) -> bool:
        slugs = set((await self.db.execute(
            select(Role.slug)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user_id)
        )).scalars().all())
        return bool(slugs & {"owner", "admin"})

    async def _pin_candidate_allowed(
        self,
        user: User,
        branch_id: UUID | None,
        allowed_role_slugs: frozenset[str] | None,
    ) -> bool:
        if allowed_role_slugs is None and branch_id is None:
            return True
        if branch_id is not None:
            # Филиал сотрудника: User.branch_id (моноблок/терминал) либо
            # HR-запись — реальный редактор сотрудников пишет филиал туда.
            employee_branch = user.branch_id
            if employee_branch is None:
                from app.modules.hr.models import Employee
                employee_branch = (await self.db.execute(
                    select(Employee.branch_id).where(Employee.user_id == user.id).limit(1)
                )).scalar_one_or_none()
            if employee_branch not in (None, branch_id):
                return False
        if allowed_role_slugs is None:
            return True
        slugs = set((await self.db.execute(
            select(Role.slug)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user.id)
        )).scalars().all())
        return bool(slugs & allowed_role_slugs)

    async def _save_refresh_token(
        self, user_id: UUID, token: str, *, device_id: str | None = None
    ) -> None:
        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
        rt = RefreshToken(
            user_id=user_id,
            token_hash=hash_refresh_token(token),
            expires_at=expires_at,
            device_id=device_id,
        )
        self.db.add(rt)
        await self.db.commit()

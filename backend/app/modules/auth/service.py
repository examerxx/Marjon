from __future__ import annotations
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.modules.auth.models import RefreshToken, User
from app.modules.auth.repository import RefreshTokenRepository, UserRepository
from app.modules.auth.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.modules.audit.service import AuditService
from app.modules.companies.models import Company
from app.modules.rbac.models import Role, UserRole
from app.modules.rbac.permissions import sync_role_permissions
from app.modules.rbac.service import RBACService
from app.shared.exceptions import ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError

# BE-08: PIN brute-force throttling, independent of the global rate limiter
# on POST /auth/pin-login — this locks the SPECIFIC account after repeated
# wrong PINs, so an attacker can't just spread guesses across many accounts
# to stay under the per-IP rate limit.
PIN_MAX_ATTEMPTS = 5
PIN_LOCKOUT_MINUTES = 15


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.user_repo = UserRepository(db)
        self.token_repo = RefreshTokenRepository(db)

    async def register(
        self, company_name: str, company_slug: str, email: str, password: str
    ) -> tuple[User, str, str]:
        if await self.user_repo.get_by_email(email):
            raise ConflictError("Email already registered")

        company = Company(name=company_name, slug=company_slug)
        self.db.add(company)
        await self.db.flush()

        user = User(
            company_id=company.id,
            email=email,
            password_hash=hash_password(password),
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
        await sync_role_permissions(self.db, owner_role)  # BE-05: owner gets every permission

        self.db.add(UserRole(user_id=user.id, role_id=owner_role.id))
        await self.db.commit()
        await self.db.refresh(user)

        access_token = create_access_token(user.id, company.id)
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

    async def login(self, email: str, password: str) -> tuple[User, str, str]:
        import logging
        log = logging.getLogger(__name__)

        user = await self.user_repo.get_by_login(self._normalize_identifier(email))
        if not user:
            log.warning("Login failed: user not found — login=%s", email)
            raise UnauthorizedError("Invalid credentials")

        if not verify_password(password, user.password_hash):
            log.warning("Login failed: wrong password — email=%s", email)
            raise UnauthorizedError("Invalid credentials")

        if not user.is_active:
            raise UnauthorizedError("Account is inactive")

        access_token = create_access_token(user.id, user.company_id)
        refresh_token = create_refresh_token()
        await self._save_refresh_token(user.id, refresh_token)

        return user, access_token, refresh_token

    async def login_admin(self, email: str, password: str) -> tuple[User, str, str]:
        """BE-01: HQ admin panel login. Same credential check as login(), plus
        an explicit is_superadmin gate — correct credentials without HQ access
        must fail with 403, not silently issue a normal-scoped session."""
        import logging
        log = logging.getLogger(__name__)

        user = await self.user_repo.get_by_login(self._normalize_identifier(email))
        if not user or not verify_password(password, user.password_hash):
            log.warning("Admin login failed: bad credentials — login=%s", email)
            raise UnauthorizedError("Invalid credentials")

        if not user.is_active:
            raise UnauthorizedError("Account is inactive")

        if not user.is_superadmin:
            log.warning("Admin login denied: not superadmin — user_id=%s", user.id)
            raise ForbiddenError("HQ admin access required")

        access_token = create_access_token(user.id, user.company_id, auth_scope="hq_admin")
        refresh_token = create_refresh_token()
        await self._save_refresh_token(user.id, refresh_token)

        return user, access_token, refresh_token

    async def create_company_user(
        self,
        company_id: UUID | None,
        email: str,
        password: str,
        role_slug: str,
        role_name: str | None = None,
        phone: str | None = None,
    ) -> tuple[User, Role]:
        if not company_id:
            raise ValidationError("Current user is not assigned to a company")

        if await self.user_repo.get_by_email(email):
            raise ConflictError("Email already registered")
        if phone and await self.user_repo.get_by_phone(phone):
            # get_by_login() resolves email/username/phone with .limit(1) —
            # a duplicate phone would make login resolution ambiguous.
            raise ConflictError("Phone already registered")

        # BE-05: role_slug is validated against the canonical allowlist here
        # (raises ValidationError otherwise) and the role's default
        # permission set is attached the first time it's created for this
        # company — see RBACService.get_or_create_company_role.
        role = await RBACService(self.db).get_or_create_company_role(
            company_id, role_slug, name=role_name
        )

        user = User(
            company_id=company_id,
            email=email,
            phone=phone,
            password_hash=hash_password(password),
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
    ) -> tuple[User, list[str]]:
        if not company_id:
            raise ValidationError("Current user is not assigned to a company")

        user = await self.user_repo.get_by_id(user_id)
        if not user or user.company_id != company_id:
            raise NotFoundError("User not found")

        if name is not None:
            user.name = name
        if email is not None:
            existing = await self.user_repo.get_by_email(email)
            if existing and existing.id != user_id:
                raise ConflictError("Email already in use")
            user.email = email
        if phone is not None:
            # BE-07: spec requires 409 on duplicate phone too, not just email.
            existing_phone = await self.user_repo.get_by_phone(phone)
            if existing_phone and existing_phone.id != user_id:
                raise ConflictError("Phone already in use")
            user.phone = phone
        if password is not None:
            user.password_hash = hash_password(password)
        if is_active is not None:
            user.is_active = is_active

        if role_slug is not None:
            from sqlalchemy import delete as sql_delete
            role = await RBACService(self.db).get_or_create_company_role(company_id, role_slug)
            await self.db.execute(
                sql_delete(UserRole).where(UserRole.user_id == user_id)
            )
            self.db.add(UserRole(user_id=user_id, role_id=role.id))

        await self.db.commit()
        await self.db.refresh(user)

        from sqlalchemy import select
        roles_res = await self.db.execute(
            select(Role.slug).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user_id)
        )
        slugs = list(roles_res.scalars().all())
        return user, slugs

    async def refresh(self, refresh_token: str) -> tuple[str, str]:
        token_hash = hash_refresh_token(refresh_token)
        stored = await self.token_repo.get_by_hash(token_hash)
        if not stored:
            # Covers "not found", "already revoked" and "expired" alike —
            # get_by_hash() filters on all three, so a reused/revoked
            # refresh token is rejected the same way an unknown one is.
            raise UnauthorizedError("Invalid or expired refresh token")

        user = await self.user_repo.get_by_id(stored.user_id)
        if not user or not user.is_active:
            raise UnauthorizedError("User not found or inactive")

        # BE-06: atomic rotation — revoke the old token and persist the new
        # one in a single commit. Previously these were two separate
        # commits; a crash between them would revoke the old token without
        # ever persisting its replacement, silently locking the user out.
        new_access = create_access_token(user.id, user.company_id)
        new_refresh = create_refresh_token()
        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)

        stored.revoked_at = datetime.now(timezone.utc)
        self.db.add(RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(new_refresh),
            expires_at=expires_at,
        ))
        await self.db.commit()

        return new_access, new_refresh

    async def logout(self, user_id: UUID, refresh_token: str | None = None) -> None:
        """BE-06: scoped by default — pass the session's own refresh_token
        and only that session is revoked, leaving the user's other logged-in
        devices untouched. Falls back to revoking every session when no
        refresh_token is given (backward compatible with callers that
        predate scoped logout — see logout_all() for an explicit,
        intentional "sign out everywhere")."""
        if refresh_token:
            token_hash = hash_refresh_token(refresh_token)
            await self.token_repo.revoke_by_hash(token_hash, user_id)
        else:
            await self.token_repo.revoke_all_for_user(user_id)

    async def logout_all(self, user_id: UUID) -> None:
        await self.token_repo.revoke_all_for_user(user_id)

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
        if not target or target.company_id != company_id:
            raise NotFoundError("User not found")

        # PIN uniqueness within the company. Pins are hashed (salted), so
        # this can't be a plain equality lookup — verify against every
        # peer's hash instead. Fine at restaurant-staff scale; this is not
        # meant to scale to thousands of accounts per company.
        peers = await self.user_repo.get_company_users(company_id)
        for peer in peers:
            if peer.id != target.id and peer.pin_hash and verify_password(pin, peer.pin_hash):
                raise ConflictError("PIN уже используется другим сотрудником")

        target.pin_hash = hash_password(pin)
        target.pin_failed_attempts = 0
        target.pin_locked_until = None
        await self.db.commit()

        await AuditService(self.db).log(
            company_id=company_id, user_id=actor_user_id,
            action="user.pin_reset", entity_type="user", entity_id=target.id,
        )

    async def pin_login(self, employee_id: UUID, pin: str) -> tuple[User, str, str]:
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

        if not verify_password(pin, user.pin_hash):
            user.pin_failed_attempts += 1
            if user.pin_failed_attempts >= PIN_MAX_ATTEMPTS:
                user.pin_locked_until = datetime.now(timezone.utc) + timedelta(minutes=PIN_LOCKOUT_MINUTES)
                user.pin_failed_attempts = 0
            await self.db.commit()
            raise UnauthorizedError("Invalid PIN")

        user.pin_failed_attempts = 0
        user.pin_locked_until = None
        await self.db.commit()

        access_token = create_access_token(user.id, user.company_id)
        refresh_token = create_refresh_token()
        await self._save_refresh_token(user.id, refresh_token)

        return user, access_token, refresh_token

    async def _save_refresh_token(self, user_id: UUID, token: str) -> None:
        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
        rt = RefreshToken(
            user_id=user_id,
            token_hash=hash_refresh_token(token),
            expires_at=expires_at,
        )
        self.db.add(rt)
        await self.db.commit()

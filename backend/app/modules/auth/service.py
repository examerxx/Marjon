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
from app.modules.companies.models import Company
from app.modules.rbac.models import Role, UserRole
from app.modules.rbac.repository import RoleRepository
from app.shared.exceptions import ConflictError, NotFoundError, UnauthorizedError, ValidationError


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

        self.db.add(UserRole(user_id=user.id, role_id=owner_role.id))
        await self.db.commit()
        await self.db.refresh(user)

        access_token = create_access_token(user.id, company.id)
        refresh_token = create_refresh_token()
        await self._save_refresh_token(user.id, refresh_token)

        return user, access_token, refresh_token

    async def login(self, email: str, password: str) -> tuple[User, str, str]:
        import logging
        log = logging.getLogger(__name__)

        user = await self.user_repo.get_by_email(email)
        if not user:
            log.warning("Login failed: user not found — email=%s", email)
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

        role_repo = RoleRepository(self.db)
        role = await role_repo.get_by_slug(role_slug, company_id)
        if not role:
            role = Role(
                company_id=company_id,
                slug=role_slug,
                name=role_name or role_slug.replace("_", " ").title(),
                is_system=False,
            )
            self.db.add(role)
            await self.db.flush()

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

    async def refresh(self, refresh_token: str) -> tuple[str, str]:
        token_hash = hash_refresh_token(refresh_token)
        stored = await self.token_repo.get_by_hash(token_hash)
        if not stored:
            raise UnauthorizedError("Invalid or expired refresh token")

        user = await self.user_repo.get_by_id(stored.user_id)
        if not user or not user.is_active:
            raise UnauthorizedError("User not found or inactive")

        # Rotation: revoke old token and issue new pair
        stored.revoked_at = datetime.now(timezone.utc)
        await self.db.commit()

        new_access = create_access_token(user.id, user.company_id)
        new_refresh = create_refresh_token()
        await self._save_refresh_token(user.id, new_refresh)

        return new_access, new_refresh

    async def logout(self, user_id: UUID) -> None:
        await self.token_repo.revoke_all_for_user(user_id)

    async def _save_refresh_token(self, user_id: UUID, token: str) -> None:
        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
        rt = RefreshToken(
            user_id=user_id,
            token_hash=hash_refresh_token(token),
            expires_at=expires_at,
        )
        self.db.add(rt)
        await self.db.commit()

from __future__ import annotations
from uuid import UUID

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.auth.security import hash_password
from app.modules.organizations.models import OfflineJob, user_organizations
from app.modules.organizations.schemas import AccountCreate, AccountResponse, AccountUpdate
from app.modules.rbac.models import Role, UserRole
from app.shared.exceptions import ConflictError, NotFoundError


class AccountService:
    """Аккаунты главной админки: users c username + M2M к организациям."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_or_create_role(self, slug: str) -> Role:
        role = (
            await self.db.execute(
                select(Role).where(Role.slug == slug, Role.company_id.is_(None))
            )
        ).scalar_one_or_none()
        if role is None:
            role = Role(company_id=None, slug=slug, name=slug.replace("_", " ").title(), is_system=True)
            self.db.add(role)
            await self.db.flush()
        return role

    async def _org_ids(self, user_id: UUID) -> list[UUID]:
        rows = await self.db.execute(
            select(user_organizations.c.organization_id).where(
                user_organizations.c.user_id == user_id
            )
        )
        return [r[0] for r in rows]

    async def _role_slug(self, user_id: UUID) -> str | None:
        return (
            await self.db.execute(
                select(Role.slug)
                .join(UserRole, UserRole.role_id == Role.id)
                .where(UserRole.user_id == user_id, Role.company_id.is_(None))
            )
        ).scalars().first()

    async def to_response(self, user: User) -> AccountResponse:
        return AccountResponse(
            id=user.id,
            created_at=user.created_at,
            updated_at=user.updated_at,
            username=user.username,
            name=user.name,
            email=user.email,
            is_active=user.is_active,
            role_slug=await self._role_slug(user.id),
            organization_ids=await self._org_ids(user.id),
        )

    async def list(self) -> list[AccountResponse]:
        users = (
            await self.db.execute(
                select(User).where(User.username.is_not(None)).order_by(User.created_at.desc())
            )
        ).scalars().all()
        return [await self.to_response(u) for u in users]

    async def get(self, account_id: UUID) -> User:
        user = (
            await self.db.execute(
                select(User).where(User.id == account_id, User.username.is_not(None))
            )
        ).scalar_one_or_none()
        if user is None:
            raise NotFoundError("Account not found")
        return user

    async def create(self, data: AccountCreate) -> AccountResponse:
        exists = (
            await self.db.execute(select(User).where(User.username == data.username))
        ).scalar_one_or_none()
        if exists:
            raise ConflictError("Username already taken")

        email = data.email or f"{data.username}@admin.marjon.local"
        if (await self.db.execute(select(User).where(User.email == email))).scalar_one_or_none():
            raise ConflictError("Email already registered")

        user = User(
            username=data.username,
            name=data.name,
            email=email,
            password_hash=hash_password(data.password),
            is_active=data.is_active,
        )
        self.db.add(user)
        await self.db.flush()

        role = await self._get_or_create_role(data.role_slug)
        self.db.add(UserRole(user_id=user.id, role_id=role.id))
        await self._set_orgs(user.id, data.organization_ids)
        await self.db.commit()
        await self.db.refresh(user)
        return await self.to_response(user)

    async def update(self, account_id: UUID, data: AccountUpdate) -> AccountResponse:
        user = await self.get(account_id)
        if data.password:
            user.password_hash = hash_password(data.password)
        if data.name is not None:
            user.name = data.name
        if data.is_active is not None:
            user.is_active = data.is_active
        if data.role_slug is not None:
            role = await self._get_or_create_role(data.role_slug)
            await self.db.execute(
                delete(UserRole).where(
                    UserRole.user_id == user.id,
                    UserRole.role_id.in_(select(Role.id).where(Role.company_id.is_(None))),
                )
            )
            self.db.add(UserRole(user_id=user.id, role_id=role.id))
        if data.organization_ids is not None:
            await self._set_orgs(user.id, data.organization_ids, replace=True)
        await self.db.commit()
        await self.db.refresh(user)
        return await self.to_response(user)

    async def delete(self, account_id: UUID) -> None:
        user = await self.get(account_id)
        user.is_active = False  # аккаунты деактивируются, не удаляются
        await self.db.commit()

    async def _set_orgs(self, user_id: UUID, org_ids: list[UUID], replace: bool = False) -> None:
        if replace:
            await self.db.execute(
                delete(user_organizations).where(user_organizations.c.user_id == user_id)
            )
        for org_id in set(org_ids):
            await self.db.execute(
                insert(user_organizations).values(user_id=user_id, organization_id=org_id)
            )


class OfflineJobService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def submit(self, data) -> OfflineJob:
        """Идемпотентный приём офлайн-операций мобильных клиентов (ТЗ §8)."""
        if data.idempotency_key:
            existing = (
                await self.db.execute(
                    select(OfflineJob).where(OfflineJob.idempotency_key == data.idempotency_key)
                )
            ).scalar_one_or_none()
            if existing:
                return existing
        job = OfflineJob(
            type=data.type,
            organization_id=data.organization_id,
            payload=data.payload,
            idempotency_key=data.idempotency_key,
        )
        self.db.add(job)
        await self.db.commit()
        await self.db.refresh(job)
        return job

    async def retry(self, job_id: UUID) -> OfflineJob:
        job = (
            await self.db.execute(select(OfflineJob).where(OfflineJob.id == job_id))
        ).scalar_one_or_none()
        if job is None:
            raise NotFoundError("Offline job not found")
        job.status = "pending"
        job.error = None
        await self.db.commit()
        await self.db.refresh(job)
        return job

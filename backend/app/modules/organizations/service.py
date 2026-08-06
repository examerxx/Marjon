from __future__ import annotations
from collections import defaultdict
from uuid import UUID

from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.auth.security import hash_password
from app.modules.organizations.models import Organization, OfflineJob, user_organizations
from app.modules.organizations.schemas import AccountCreate, AccountResponse, AccountUpdate
from app.modules.rbac.models import Role, UserRole
from app.shared.admin_crud import OrgScope, _coerce
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError
from app.shared.pagination import PageParams


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


class OrganizationService:
    """BE-15: aggregate list view for the admin org-directory table."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_directory(
        self, params: PageParams, *, search: str | None, org_scope: OrgScope,
        raw_filters: dict[str, str] | None = None,
    ) -> tuple[list[dict], int]:
        query = select(Organization).where(Organization.deleted_at.is_(None))
        if org_scope is not None:
            query = query.where(Organization.id.in_(org_scope))
        if search:
            query = query.where(Organization.name.ilike(f"%{search}%"))
        for name, raw in (raw_filters or {}).items():
            column = getattr(Organization, name, None)
            if column is None or raw in (None, ""):
                continue
            try:
                query = query.where(column == _coerce(column, raw))
            except (ValueError, TypeError):
                raise ValidationError(f"Invalid value for filter '{name}'")

        count_q = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_q)).scalar_one()

        query = query.order_by(Organization.name).offset(params.offset).limit(params.size)
        orgs = list((await self.db.execute(query)).scalars().all())

        # One extra query for the whole page (not per-row): map each
        # organization_id to whichever owner/admin HQ account is linked to
        # it via user_organizations. Platform-level roles only
        # (Role.company_id IS NULL) — these are HQ accounts (see
        # AccountService), not company staff.
        names_by_org: dict[UUID, dict[str, str]] = defaultdict(dict)
        org_ids = [o.id for o in orgs]
        if org_ids:
            rows = (
                await self.db.execute(
                    select(
                        user_organizations.c.organization_id, Role.slug, User.name, User.username
                    )
                    .select_from(user_organizations)
                    .join(User, User.id == user_organizations.c.user_id)
                    .join(UserRole, UserRole.user_id == User.id)
                    .join(Role, Role.id == UserRole.role_id)
                    .where(
                        user_organizations.c.organization_id.in_(org_ids),
                        Role.company_id.is_(None),
                        Role.slug.in_(("owner", "admin")),
                    )
                )
            ).all()
            for org_id, slug, name, username in rows:
                names_by_org[org_id].setdefault(slug, name or username)

        items = [
            {
                "id": o.id, "created_at": o.created_at, "updated_at": o.updated_at,
                "name": o.name, "type": o.type, "tariff_price": o.tariff_price,
                "working_days": o.working_days, "is_main": o.is_main,
                "virtual_cash_register_number": o.virtual_cash_register_number,
                "virtual_cash_register_ip_address": o.virtual_cash_register_ip_address,
                "country_id": o.country_id, "region_id": o.region_id, "district_id": o.district_id,
                "installation_date": o.installation_date, "tin": o.tin,
                "is_solvent": o.is_solvent,
                "enabled_storage_integration": o.enabled_storage_integration,
                "online_menu": o.online_menu, "status": o.status, "taplink": o.taplink,
                "is_billing_autoblock": o.is_billing_autoblock,
                "is_face_detection_required": o.is_face_detection_required,
                "organization_status_id": o.organization_status_id,
                "cash_balance": o.cash_balance,
                "owner_name": names_by_org.get(o.id, {}).get("owner"),
                "admin_name": names_by_org.get(o.id, {}).get("admin"),
                "branches_count": None,
            }
            for o in orgs
        ]
        return items, total


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

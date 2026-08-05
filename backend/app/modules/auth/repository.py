from __future__ import annotations
from uuid import UUID
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_repository import BaseRepository
from app.modules.auth.models import User, RefreshToken


class UserRepository(BaseRepository[User]):
    def __init__(self, db: AsyncSession):
        super().__init__(User, db)

    async def get_by_email(self, email: str) -> Optional[User]:
        result = await self.db.execute(
            select(User).where(User.email == email)
        )
        return result.scalar_one_or_none()

    async def get_by_login(self, login: str) -> Optional[User]:
        """Login by email, username or phone."""
        result = await self.db.execute(
            select(User).where(
                (User.email == login) | (User.username == login) | (User.phone == login)
            ).limit(1)
        )
        return result.scalar_one_or_none()

    async def get_by_phone(self, phone: str) -> Optional[User]:
        result = await self.db.execute(select(User).where(User.phone == phone))
        return result.scalar_one_or_none()

    async def get_company_users(self, company_id: UUID) -> list[User]:
        # BE-07: was filtered to is_active == True, which made a deactivated
        # employee (DELETE /auth/users/{id} soft-deactivates) permanently
        # invisible to the staff list — with no way to find them again to
        # flip is_active back on. Now returns everyone; the response's
        # is_active field lets the frontend badge/filter as it likes.
        result = await self.db.execute(
            select(User).where(User.company_id == company_id)
        )
        return list(result.scalars().all())


class RefreshTokenRepository(BaseRepository[RefreshToken]):
    def __init__(self, db: AsyncSession):
        super().__init__(RefreshToken, db)

    async def get_by_hash(self, token_hash: str) -> Optional[RefreshToken]:
        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked_at == None,
                RefreshToken.expires_at > datetime.now(timezone.utc),
            )
        )
        return result.scalar_one_or_none()

    async def revoke_all_for_user(self, user_id: UUID) -> None:
        from sqlalchemy import update
        await self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at == None)
            .values(revoked_at=datetime.now(timezone.utc))
        )
        await self.db.commit()

    async def revoke_by_hash(self, token_hash: str, user_id: UUID) -> bool:
        """BE-06: revoke exactly one session's refresh token. Scoped to
        `user_id` so a token can never be used to revoke someone else's
        session even if a hash collision were somehow guessed. Returns
        whether an active token was found and revoked."""
        from sqlalchemy import update
        result = await self.db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at == None,
            )
            .values(revoked_at=datetime.now(timezone.utc))
        )
        await self.db.commit()
        return result.rowcount > 0

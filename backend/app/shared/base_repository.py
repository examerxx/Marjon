from __future__ import annotations
from typing import Generic, TypeVar, Type, Optional, List
from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.base_model import TimeStampedModel
from app.shared.pagination import PageParams

ModelType = TypeVar("ModelType", bound=TimeStampedModel)


class BaseRepository(Generic[ModelType]):
    def __init__(self, model: Type[ModelType], db: AsyncSession):
        self.model = model
        self.db = db

    async def get_by_id(self, id: UUID) -> Optional[ModelType]:
        result = await self.db.execute(
            select(self.model).where(self.model.id == id)
        )
        return result.scalar_one_or_none()

    async def save(self, obj: ModelType) -> ModelType:
        self.db.add(obj)
        await self.db.commit()
        await self.db.refresh(obj)
        return obj

    async def delete(self, obj: ModelType) -> None:
        await self.db.delete(obj)
        await self.db.commit()


class TenantRepository(BaseRepository[ModelType]):
    """Repository Ñ Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð¸Ñ‡ÐµÑÐºÐ¾Ð¹ Ñ„Ð¸Ð»ÑŒÑ‚Ñ€Ð°Ñ†Ð¸ÐµÐ¹ Ð¿Ð¾ company_id."""

    def _base_query(self, company_id: UUID):
        return select(self.model).where(self.model.company_id == company_id)

    async def get_by_id(self, id: UUID, company_id: UUID) -> Optional[ModelType]:  # type: ignore[override]
        result = await self.db.execute(
            self._base_query(company_id).where(self.model.id == id)
        )
        return result.scalar_one_or_none()

    async def get_all(
        self, company_id: UUID, params: Optional[PageParams] = None
    ) -> List[ModelType]:
        query = self._base_query(company_id)
        if params:
            query = query.offset(params.offset).limit(params.size)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def count(self, company_id: UUID) -> int:
        result = await self.db.execute(
            select(func.count()).select_from(self.model).where(
                self.model.company_id == company_id
            )
        )
        return result.scalar_one()

from __future__ import annotations
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.nomenclature.models import NomProduct
from app.modules.storage.models import Coming, ComingItem, Storage, StorageMovement
from app.modules.storage.schemas import (
    ComingCreate,
    ComingUpdate,
    FlowReportRow,
    StorageBalanceRow,
)
from app.shared.admin_crud import CRUDService
from app.shared.exceptions import ConflictError
from app.shared.pagination import PageParams


class ComingService(CRUDService[Coming]):
    def __init__(self, db: AsyncSession):
        super().__init__(Coming, db)

    def _build_items(self, coming: Coming, items_in) -> None:
        coming.items.clear()
        total_sum = Decimal(0)
        for item in items_in:
            total = item.price * item.qty
            total_sum += total
            coming.items.append(ComingItem(
                category_id=item.category_id,
                product_id=item.product_id,
                type=item.type,
                price=item.price,
                qty=item.qty,
                total=total,
            ))
        coming.total_sum = total_sum

    async def create_coming(self, data: ComingCreate) -> Coming:
        coming = Coming(**data.model_dump(exclude={"items"}))
        self._build_items(coming, data.items)
        self.db.add(coming)
        await self.db.commit()
        await self.db.refresh(coming)
        return coming

    async def update_coming(self, coming_id: UUID, data: ComingUpdate) -> Coming:
        coming = await self.get(coming_id)
        if coming.status != "draft":
            raise ConflictError("Принятое поступление нельзя редактировать")
        payload = data.model_dump(exclude_unset=True, exclude={"items"})
        for key, value in payload.items():
            setattr(coming, key, value)
        if data.items is not None:
            self._build_items(coming, data.items)
        await self.db.commit()
        await self.db.refresh(coming)
        return coming

    async def accept(self, coming_id: UUID) -> Coming:
        """draft → accepted: увеличивает остатки и фиксирует себестоимость (ТЗ §6)."""
        coming = await self.get(coming_id)
        if coming.status != "draft":
            raise ConflictError("Поступление уже принято")
        coming.status = "accepted"
        coming.acceptance_date = date.today()
        for item in coming.items:
            self.db.add(StorageMovement(
                storage_id=coming.storage_id,
                product_id=item.product_id,
                direction="income",
                qty=item.qty,
                price=item.price,
                date=datetime.now(timezone.utc),
                coming_id=coming.id,
            ))
        await self.db.commit()
        await self.db.refresh(coming)
        return coming

    async def delete(self, id: UUID) -> None:
        coming = await self.get(id)
        if coming.status != "draft":
            raise ConflictError("Принятое поступление нельзя удалить")
        await super().delete(id)


class StorageReportService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _period_filters(self, query, date_from: date | None, date_to: date | None):
        if date_from:
            query = query.where(func.date(StorageMovement.date) >= date_from)
        if date_to:
            query = query.where(func.date(StorageMovement.date) <= date_to)
        return query

    async def balances(
        self,
        date_from: date | None,
        date_to: date | None,
        storage_id: UUID | None = None,
    ) -> list[StorageBalanceRow]:
        """Начальный остаток + приход − расход = текущий остаток (ТЗ §6)."""
        signed = case(
            (StorageMovement.direction == "income", StorageMovement.qty),
            else_=-StorageMovement.qty,
        )
        opening = func.sum(
            case(
                (func.date(StorageMovement.date) < (date_from or date.min), signed),
                else_=0,
            )
        )
        in_period = func.date(StorageMovement.date) >= (date_from or date.min)
        if date_to:
            in_period = in_period & (func.date(StorageMovement.date) <= date_to)
        income = func.sum(case(
            (in_period & (StorageMovement.direction == "income"), StorageMovement.qty), else_=0
        ))
        expense = func.sum(case(
            (in_period & (StorageMovement.direction == "expense"), StorageMovement.qty), else_=0
        ))

        query = (
            select(
                StorageMovement.storage_id,
                Storage.name,
                StorageMovement.product_id,
                NomProduct.name,
                opening.label("opening"),
                income.label("income"),
                expense.label("expense"),
            )
            .join(Storage, Storage.id == StorageMovement.storage_id)
            .join(NomProduct, NomProduct.id == StorageMovement.product_id)
            .group_by(
                StorageMovement.storage_id, Storage.name,
                StorageMovement.product_id, NomProduct.name,
            )
        )
        if date_to:
            query = query.where(func.date(StorageMovement.date) <= date_to)
        if storage_id:
            query = query.where(StorageMovement.storage_id == storage_id)

        rows = (await self.db.execute(query)).all()
        return [
            StorageBalanceRow(
                storage_id=r[0], storage_name=r[1],
                product_id=r[2], product_name=r[3],
                opening_qty=r[4] or 0,
                income_qty=r[5] or 0,
                expense_qty=r[6] or 0,
                closing_qty=(r[4] or 0) + (r[5] or 0) - (r[6] or 0),
            )
            for r in rows
        ]

    async def flow(
        self,
        direction: str,
        date_from: date | None,
        date_to: date | None,
        storage_id: UUID | None = None,
    ) -> list[FlowReportRow]:
        """Отчёт приход/расход по складам за период."""
        query = (
            select(
                StorageMovement.storage_id,
                Storage.name,
                StorageMovement.product_id,
                NomProduct.name,
                func.sum(StorageMovement.qty),
                func.sum(StorageMovement.qty * StorageMovement.price),
            )
            .join(Storage, Storage.id == StorageMovement.storage_id)
            .join(NomProduct, NomProduct.id == StorageMovement.product_id)
            .where(StorageMovement.direction == direction)
            .group_by(
                StorageMovement.storage_id, Storage.name,
                StorageMovement.product_id, NomProduct.name,
            )
        )
        query = self._period_filters(query, date_from, date_to)
        if storage_id:
            query = query.where(StorageMovement.storage_id == storage_id)
        rows = (await self.db.execute(query)).all()
        return [
            FlowReportRow(
                storage_id=r[0], storage_name=r[1],
                product_id=r[2], product_name=r[3],
                qty=r[4] or 0, total=r[5] or 0,
            )
            for r in rows
        ]

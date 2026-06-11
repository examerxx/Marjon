from __future__ import annotations
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.finance.models import (
    Counterparty,
    FinanceHistory,
    FinanceTemplate,
    FinTransaction,
)
from app.modules.finance.schemas import PayRequest, TransactionCreate, TransactionUpdate
from app.modules.organizations.models import Organization
from app.shared.admin_crud import CRUDService
from app.shared.exceptions import NotFoundError
from pydantic_core import to_jsonable_python


class TransactionService(CRUDService[FinTransaction]):
    """Финансовые транзакции: балансы меняются атомарно, суммы аудируются (ТЗ §6)."""

    def __init__(self, db: AsyncSession):
        super().__init__(FinTransaction, db)

    @staticmethod
    def _delta(direction: str, amount: Decimal) -> Decimal:
        return amount if direction == "income" else -amount

    async def _locked_counterparty(self, counterparty_id: UUID) -> Counterparty:
        cp = (
            await self.db.execute(
                select(Counterparty)
                .where(Counterparty.id == counterparty_id, Counterparty.deleted_at.is_(None))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if cp is None:
            raise NotFoundError("Counterparty not found")
        return cp

    async def _locked_organization(self, organization_id: UUID) -> Organization:
        org = (
            await self.db.execute(
                select(Organization)
                .where(Organization.id == organization_id, Organization.deleted_at.is_(None))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if org is None:
            raise NotFoundError("Organization not found")
        return org

    async def _apply_balance(
        self,
        counterparty_id: UUID | None,
        organization_id: UUID | None,
        delta: Decimal,
    ) -> None:
        if counterparty_id:
            cp = await self._locked_counterparty(counterparty_id)
            cp.balance = (cp.balance or 0) + delta
        if organization_id:
            org = await self._locked_organization(organization_id)
            org.cash_balance = (org.cash_balance or 0) + delta

    async def create_transaction(
        self,
        data: TransactionCreate,
        user_id: UUID,
        idempotency_key: str | None = None,
    ) -> FinTransaction:
        if idempotency_key:
            existing = (
                await self.db.execute(
                    select(FinTransaction).where(
                        FinTransaction.idempotency_key == idempotency_key
                    )
                )
            ).scalars().first()
            if existing:
                return existing

        tx = FinTransaction(
            **data.model_dump(exclude_unset=True),
            user_id=user_id,
            idempotency_key=idempotency_key,
        )
        if tx.date is None:
            tx.date = datetime.now(timezone.utc)
        self.db.add(tx)
        await self._apply_balance(
            tx.counterparty_id, tx.organization_id, self._delta(tx.direction, data.amount)
        )
        await self.db.commit()
        await self.db.refresh(tx)
        return tx

    async def update_transaction(
        self, tx_id: UUID, data: TransactionUpdate, user_id: UUID
    ) -> FinTransaction:
        tx = await self.get(tx_id)
        payload = data.model_dump(exclude_unset=True)

        if "amount" in payload and Decimal(payload["amount"]) != Decimal(tx.amount):
            old_amount, new_amount = Decimal(tx.amount), Decimal(payload["amount"])
            # откат старой суммы и применение новой
            await self._apply_balance(
                tx.counterparty_id, tx.organization_id, -self._delta(tx.direction, old_amount)
            )
            await self._apply_balance(
                payload.get("counterparty_id", tx.counterparty_id),
                tx.organization_id,
                self._delta(tx.direction, new_amount),
            )
            self.db.add(FinanceHistory(
                status="updated",
                ref_id=tx.id,
                organization_id=tx.organization_id,
                old_amount=old_amount,
                new_amount=new_amount,
                type=tx.direction,
                user_id=user_id,
                comment=payload.get("comment", tx.comment),
            ))

        for key, value in payload.items():
            setattr(tx, key, value)
        await self.db.commit()
        await self.db.refresh(tx)
        return tx

    async def delete_transaction(self, tx_id: UUID, user_id: UUID) -> None:
        tx = await self.get(tx_id)
        await self._apply_balance(
            tx.counterparty_id, tx.organization_id,
            -self._delta(tx.direction, Decimal(tx.amount)),
        )
        self.db.add(FinanceHistory(
            status="deleted",
            ref_id=tx.id,
            organization_id=tx.organization_id,
            old_amount=Decimal(tx.amount),
            new_amount=None,
            type=tx.direction,
            user_id=user_id,
        ))
        tx.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()

    async def pay(
        self, data: PayRequest, user_id: UUID, idempotency_key: str | None = None
    ) -> list[FinTransaction]:
        """Разбивка оплаты: несколько транзакций одной операцией (ТЗ §6)."""
        if idempotency_key:
            existing = (
                await self.db.execute(
                    select(FinTransaction).where(
                        FinTransaction.idempotency_key == idempotency_key
                    )
                )
            ).scalars().all()
            if existing:
                return list(existing)

        if data.save_as_template:
            self.db.add(FinanceTemplate(
                name=data.save_as_template,
                payload=to_jsonable_python(data.model_dump(exclude={"save_as_template"})),
            ))

        now = datetime.now(timezone.utc)
        transactions = []
        for item in data.items:
            tx = FinTransaction(
                date=now,
                amount=item.amount,
                direction=data.direction,
                payment_type_id=item.payment_type_id,
                counterparty_id=item.counterparty_id,
                category_id=item.category_id,
                organization_id=data.organization_id,
                comment=item.comment,
                user_id=user_id,
                idempotency_key=idempotency_key,
            )
            self.db.add(tx)
            await self._apply_balance(
                item.counterparty_id, data.organization_id,
                self._delta(data.direction, item.amount),
            )
            transactions.append(tx)
        await self.db.commit()
        for tx in transactions:
            await self.db.refresh(tx)
        return transactions

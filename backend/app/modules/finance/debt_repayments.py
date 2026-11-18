from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.finance.models import Counterparty, FinTransaction, TransactionCategory


SUPPLIER_PAYMENT_CATEGORY = "Оплата поставщику"


def client_debt_repayment():
    return (
        (Counterparty.type == "client")
        & (FinTransaction.direction == "income")
        & select(TransactionCategory.id).where(
            TransactionCategory.id == FinTransaction.category_id,
            TransactionCategory.company_id == FinTransaction.company_id,
            func.lower(func.trim(TransactionCategory.name)) == "возврат долга",
        ).correlate(FinTransaction).exists()
    )


def supplier_debt_payment():
    """Оплата долга поставщику: расход на поставщика в категории «Оплата поставщику».

    Обычный расход на контрагента отчёт «Дебиторы и кредиторы» считает кредитом (растёт долг
    перед поставщиком — приход товаров «на потом» тоже идёт туда). Оплата долга — наоборот,
    она уменьшает кредиторку, поэтому узнаём её по категории, как возврат долга клиента.
    """
    return (
        (Counterparty.type == "supplier")
        & (FinTransaction.direction == "expense")
        & select(TransactionCategory.id).where(
            TransactionCategory.id == FinTransaction.category_id,
            TransactionCategory.company_id == FinTransaction.company_id,
            func.lower(func.trim(TransactionCategory.name)).in_(
                [SUPPLIER_PAYMENT_CATEGORY.lower(), SUPPLIER_PAYMENT_CATEGORY.strip()]
            ),
        ).correlate(FinTransaction).exists()
    )


async def company_client_repayments(
    db: AsyncSession, company_id: UUID, clients: list[Counterparty]
) -> dict[UUID, Decimal]:
    client_ids = [client.id for client in clients if client.type == "client"]
    if not client_ids:
        return {}
    rows = await db.execute(
        select(FinTransaction.counterparty_id, func.sum(FinTransaction.amount))
        .join(Counterparty, Counterparty.id == FinTransaction.counterparty_id)
        .where(
            FinTransaction.company_id == company_id,
            FinTransaction.organization_id.is_(None),
            FinTransaction.deleted_at.is_(None),
            FinTransaction.counterparty_id.in_(client_ids),
            client_debt_repayment(),
        )
        .group_by(FinTransaction.counterparty_id)
    )
    return dict(rows.all())

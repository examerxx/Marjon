"""Warehouse document endpoints — CRUD for warehouses, purchases, transfers, inventory, write-offs."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.rbac.dependencies import require_permission
from app.modules.inventory.models import StockItem, StockMovement, Warehouse
from app.modules.inventory.warehouse_models import (
    PurchaseDocument, PurchaseDocumentItem,
    TransferDocument, InventoryCheck, WriteOffDocument,
)
from app.modules.inventory.warehouse_schemas import (
    WarehouseCreate, WarehouseResponse,
    PurchaseDocumentCreate, PurchaseDocumentUpdate, PurchaseDocumentResponse,
    TransferCreate, TransferResponse,
    InventoryCheckCreate, InventoryCheckResponse,
    WriteOffCreate, WriteOffResponse,
)
from app.shared.exceptions import NotFoundError

router = APIRouter(prefix="/warehouse", tags=["warehouse"])


# ── Helpers ──────────────────────────────────────────────────
def _now() -> str:
    return datetime.utcnow().strftime("%d.%m.%Y / %H:%M")


def _user_display(user: User) -> str:
    name = getattr(user, "name", None) or ""
    if name:
        return name
    return str(user.email).split("@")[0].upper()


async def _next_doc_number(db: AsyncSession, company_id: UUID, model) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(model.number), 0))
        .where(model.company_id == company_id)
    )
    return (result.scalar_one() or 0) + 1


# ── Warehouses ───────────────────────────────────────────────
@router.get("/list", response_model=list[WarehouseResponse])
async def list_warehouses(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Warehouse).where(Warehouse.company_id == user.company_id)
    )
    return list(result.scalars().all())


@router.post("/list", response_model=WarehouseResponse, status_code=status.HTTP_201_CREATED)
async def create_warehouse(
    data: WarehouseCreate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely; owner/admin/manager still pass
    # via their default permission set (see rbac/permissions.py).
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    wh = Warehouse(company_id=user.company_id, **data.model_dump())
    db.add(wh)
    await db.commit()
    await db.refresh(wh)
    return wh


# ── Purchase Documents (Приходы) ─────────────────────────────
@router.get("/purchases", response_model=list[PurchaseDocumentResponse])
async def list_purchases(
    search: str = Query("", alias="q"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(PurchaseDocument)
        .where(PurchaseDocument.company_id == user.company_id)
        .order_by(desc(PurchaseDocument.created_at))
    )
    if search:
        like = f"%{search}%"
        query = query.where(
            PurchaseDocument.supplier.ilike(like)
            | PurchaseDocument.warehouse_name.ilike(like)
            | PurchaseDocument.created_by_name.ilike(like)
        )
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/purchases/{doc_id}", response_model=PurchaseDocumentResponse)
async def get_purchase(
    doc_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PurchaseDocument).where(
            PurchaseDocument.id == doc_id,
            PurchaseDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Purchase document not found")
    return doc


@router.post("/purchases", response_model=PurchaseDocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_purchase(
    data: PurchaseDocumentCreate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely; owner/admin/manager still pass
    # via their default permission set (see rbac/permissions.py).
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    number = await _next_doc_number(db, user.company_id, PurchaseDocument)
    now = _now()
    total = sum(item.quantity * item.cost_price for item in data.items)

    doc = PurchaseDocument(
        company_id=user.company_id,
        number=number,
        supplier=data.supplier,
        warehouse_id=data.warehouse_id,
        warehouse_name=data.warehouse_name,
        date=data.date,
        registered_at=now,
        items_count=len(data.items),
        total_amount=total,
        status="draft",
        created_by=user.id,
        created_by_name=_user_display(user),
        note=data.note,
    )

    for item_data in data.items:
        item_total = item_data.quantity * item_data.cost_price
        doc.items.append(PurchaseDocumentItem(
            name=item_data.name,
            ingredient_id=item_data.ingredient_id,
            quantity=item_data.quantity,
            unit=item_data.unit,
            cost_price=item_data.cost_price,
            total=item_total,
        ))

    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.patch("/purchases/{doc_id}", response_model=PurchaseDocumentResponse)
async def update_purchase(
    doc_id: UUID,
    data: PurchaseDocumentUpdate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely; owner/admin/manager still pass
    # via their default permission set (see rbac/permissions.py).
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PurchaseDocument)
        .options(selectinload(PurchaseDocument.items))
        .where(
            PurchaseDocument.id == doc_id,
            PurchaseDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Purchase document not found")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(doc, field, value)

    if data.status == "accepted" and not doc.accepted_at:
        # BE-18: accepting a purchase previously had ZERO effect on stock —
        # this just stamped a timestamp. The entire "purchases" document
        # trail was disconnected from real inventory levels; StockItem
        # never moved no matter how many purchase documents got accepted.
        # Guarded by `not doc.accepted_at` (already true above) so
        # re-accepting an already-accepted document is a no-op instead of
        # double-adding stock — this is the idempotency the spec asks for
        # on operations that affect остатки.
        if doc.warehouse_id:
            for item in doc.items:
                if not item.ingredient_id:
                    continue
                stock_result = await db.execute(
                    select(StockItem).where(
                        StockItem.company_id == user.company_id,
                        StockItem.warehouse_id == doc.warehouse_id,
                        StockItem.ingredient_id == item.ingredient_id,
                    )
                )
                stock = stock_result.scalar_one_or_none()
                if stock:
                    stock.quantity += item.quantity
                else:
                    db.add(StockItem(
                        company_id=user.company_id, warehouse_id=doc.warehouse_id,
                        ingredient_id=item.ingredient_id, quantity=item.quantity,
                        unit=item.unit, cost_price=item.cost_price,
                    ))
                db.add(StockMovement(
                    company_id=user.company_id, warehouse_id=doc.warehouse_id,
                    ingredient_id=item.ingredient_id, movement_type="purchase",
                    quantity=item.quantity, unit=item.unit, cost_price=item.cost_price,
                    total_cost=item.total, ref_id=doc.id, created_by=user.id,
                    note=f"Приход №{doc.number}" + (f" от {doc.supplier}" if doc.supplier else ""),
                ))
        doc.accepted_at = _now()

    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/purchases/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_purchase(
    doc_id: UUID,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely; owner/admin/manager still pass
    # via their default permission set (see rbac/permissions.py).
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PurchaseDocument).where(
            PurchaseDocument.id == doc_id,
            PurchaseDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Purchase document not found")
    await db.delete(doc)
    await db.commit()


# ── Transfers ────────────────────────────────────────────────
@router.get("/transfers", response_model=list[TransferResponse])
async def list_transfers(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TransferDocument)
        .where(TransferDocument.company_id == user.company_id)
        .order_by(desc(TransferDocument.created_at))
    )
    return list(result.scalars().all())


@router.post("/transfers", response_model=TransferResponse, status_code=status.HTTP_201_CREATED)
async def create_transfer(
    data: TransferCreate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely; owner/admin/manager still pass
    # via their default permission set (see rbac/permissions.py).
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    doc = TransferDocument(
        company_id=user.company_id,
        created_by=user.id,
        created_by_name=_user_display(user),
        **data.model_dump(),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/transfers/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transfer(
    doc_id: UUID,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely; owner/admin/manager still pass
    # via their default permission set (see rbac/permissions.py).
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TransferDocument).where(
            TransferDocument.id == doc_id,
            TransferDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Transfer document not found")
    await db.delete(doc)
    await db.commit()


# ── Inventory Checks ─────────────────────────────────────────
@router.get("/inventory-checks", response_model=list[InventoryCheckResponse])
async def list_inventory_checks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(InventoryCheck)
        .where(InventoryCheck.company_id == user.company_id)
        .order_by(desc(InventoryCheck.created_at))
    )
    return list(result.scalars().all())


@router.post("/inventory-checks", response_model=InventoryCheckResponse, status_code=status.HTTP_201_CREATED)
async def create_inventory_check(
    data: InventoryCheckCreate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely; owner/admin/manager still pass
    # via their default permission set (see rbac/permissions.py).
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    doc = InventoryCheck(
        company_id=user.company_id,
        created_by=user.id,
        created_by_name=_user_display(user),
        **data.model_dump(),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.patch("/inventory-checks/{doc_id}", response_model=InventoryCheckResponse)
async def update_inventory_check(
    doc_id: UUID,
    data: InventoryCheckCreate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely; owner/admin/manager still pass
    # via their default permission set (see rbac/permissions.py).
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(InventoryCheck).where(
            InventoryCheck.id == doc_id,
            InventoryCheck.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Inventory check not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(doc, field, value)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/inventory-checks/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_inventory_check(
    doc_id: UUID,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely; owner/admin/manager still pass
    # via their default permission set (see rbac/permissions.py).
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(InventoryCheck).where(
            InventoryCheck.id == doc_id,
            InventoryCheck.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Inventory check not found")
    await db.delete(doc)
    await db.commit()


# ── Write-Offs ───────────────────────────────────────────────
@router.get("/write-offs", response_model=list[WriteOffResponse])
async def list_write_offs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WriteOffDocument)
        .where(WriteOffDocument.company_id == user.company_id)
        .order_by(desc(WriteOffDocument.created_at))
    )
    return list(result.scalars().all())


@router.post("/write-offs", response_model=WriteOffResponse, status_code=status.HTTP_201_CREATED)
async def create_write_off(
    data: WriteOffCreate,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely; owner/admin/manager still pass
    # via their default permission set (see rbac/permissions.py).
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    doc = WriteOffDocument(
        company_id=user.company_id,
        created_by=user.id,
        created_by_name=_user_display(user),
        **data.model_dump(),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/write-offs/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_write_off(
    doc_id: UUID,
    # BE-05: was require_company_admin (owner/admin/manager slug check).
    # Switched to a real permission check so a "warehouse" role — one of
    # the canonical role slugs — can actually do warehouse mutations
    # instead of being locked out entirely; owner/admin/manager still pass
    # via their default permission set (see rbac/permissions.py).
    user: User = Depends(require_permission("inventory:stock:write")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WriteOffDocument).where(
            WriteOffDocument.id == doc_id,
            WriteOffDocument.company_id == user.company_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise NotFoundError("Write-off document not found")
    await db.delete(doc)
    await db.commit()

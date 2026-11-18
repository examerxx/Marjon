"""Warehouse document schemas."""
from __future__ import annotations

from decimal import Decimal
from typing import Literal
from uuid import UUID
from app.shared.base_schema import BaseSchema, BaseResponseSchema


# ── Warehouse ──────────────────────────────────────────────
class WarehouseCreate(BaseSchema):
    name: str
    address: str | None = None
    is_main: bool = False
    is_active: bool = True
    branch_id: UUID | None = None


class WarehouseResponse(BaseResponseSchema):
    company_id: UUID
    name: str
    address: str | None
    is_main: bool
    is_active: bool = True
    branch_id: UUID | None


class WarehouseUpdate(BaseSchema):
    name: str | None = None
    address: str | None = None
    is_main: bool | None = None
    is_active: bool | None = None
    branch_id: UUID | None = None


# ── Purchase Document (Приход) ─────────────────────────────
class PurchaseItemCreate(BaseSchema):
    # Позиция прихода — это РЕАЛЬНЫЙ продукт на склад, всегда привязанный к
    # шаблону из «Продуктов» (Ingredient): либо напрямую (ingredient_id),
    # либо через Товар (product_id — backend сам автопривяжет шаблон, см.
    # create_purchase). name/unit — снапшот на момент создания, канонические
    # значения берёт backend из шаблона.
    # quantity > 0 и cost_price > 0 обязательны: без количества/цены
    # оприходовать нельзя (проверяется в роутере, 422).
    name: str
    ingredient_id: UUID | None = None
    product_id: UUID | None = None
    quantity: Decimal = Decimal("0")
    unit: str = "кг"
    cost_price: Decimal = Decimal("0")


class PurchaseDocumentCreate(BaseSchema):
    # Как оплачен приход: "paid" — сразу (создаётся денежный расход, можно выбрать
    # payment_type_id), "credit" — на потом (кредиторка перед поставщиком; поставщик обязателен).
    # Не указан — как раньше: финансы не затрагиваются.
    payment_mode: Literal["paid", "credit"] | None = None
    payment_type_id: UUID | None = None
    supplier: str | None = None
    warehouse_id: UUID | None = None
    warehouse_name: str | None = None
    date: str | None = None
    note: str | None = None
    items: list[PurchaseItemCreate] = []


class PurchaseDocumentUpdate(BaseSchema):
    supplier: str | None = None
    warehouse_id: UUID | None = None
    warehouse_name: str | None = None
    date: str | None = None
    note: str | None = None
    status: str | None = None


class PurchaseItemResponse(BaseResponseSchema):
    document_id: UUID
    ingredient_id: UUID | None
    product_id: UUID | None = None
    name: str
    quantity: Decimal
    unit: str
    cost_price: Decimal
    total: Decimal


class PurchaseDocumentResponse(BaseResponseSchema):
    company_id: UUID
    number: int
    supplier: str | None
    warehouse_id: UUID | None
    warehouse_name: str | None
    date: str | None
    registered_at: str | None
    accepted_at: str | None
    items_count: int
    total_amount: Decimal
    status: str
    created_by_name: str | None
    note: str | None
    payment_mode: str | None = None


class PurchaseDocumentDetailResponse(PurchaseDocumentResponse):
    """Один приход со строками — для экрана просмотра состава документа."""

    items: list[PurchaseItemResponse] = []


# ── Transfer Document ──────────────────────────────────────
class TransferCreate(BaseSchema):
    from_warehouse_id: UUID | None = None
    from_warehouse_name: str | None = None
    to_warehouse_id: UUID | None = None
    to_warehouse_name: str | None = None
    date: str | None = None
    items_count: int = 0
    note: str | None = None


class TransferResponse(BaseResponseSchema):
    company_id: UUID
    from_warehouse_id: UUID | None
    from_warehouse_name: str | None
    to_warehouse_id: UUID | None
    to_warehouse_name: str | None
    date: str | None
    items_count: int
    status: str
    created_by_name: str | None
    note: str | None


# ── Inventory Check ────────────────────────────────────────
class InventoryCountIn(BaseSchema):
    # Посчитанный факт по позиции: ссылка на шаблон (ingredient_id) либо на
    # Товар (product_id — шаблон backend автопривяжет как в приходе),
    # actual_qty — сколько реально на складе. Без ссылки и факта (None)
    # строка отклоняется (422) — корректировку считать не из чего.
    ingredient_id: UUID | None = None
    product_id: UUID | None = None
    name: str = ""
    actual_qty: Decimal | None = None


class InventoryCheckCreate(BaseSchema):
    warehouse_id: UUID | None = None
    warehouse_name: str | None = None
    comment: str | None = None
    check_type: str = "Приход и расход учтены"
    # V42: посчитанные позиции + флаг проведения. apply_to_stock=True:
    # излишки (факт > остатка) → документ прихода, недостачи → документ
    # расхода, остатки двигаются сразу (как «Сохранить» в приходе).
    # False — только шапка (статус draft), остатки не трогаем.
    items: list[InventoryCountIn] = []
    apply_to_stock: bool = True


class InventoryCheckUpdate(BaseSchema):
    warehouse_id: UUID | None = None
    warehouse_name: str | None = None
    comment: str | None = None
    check_type: str | None = None


class InventoryCheckLineResponse(BaseResponseSchema):
    check_id: UUID
    ingredient_id: UUID | None
    product_id: UUID | None
    name: str
    unit: str
    stock_qty: Decimal
    actual_qty: Decimal
    diff_qty: Decimal
    cost_price: Decimal


class InventoryCheckResponse(BaseResponseSchema):
    company_id: UUID
    warehouse_id: UUID | None
    warehouse_name: str | None
    comment: str | None
    check_type: str
    status: str
    created_by_name: str | None


class InventoryCheckDetailResponse(InventoryCheckResponse):
    items: list[InventoryCheckLineResponse] = []
    purchase_doc_id: UUID | None = None
    purchase_doc_number: int | None = None
    expense_doc_id: UUID | None = None
    expense_doc_number: int | None = None


# ── Write-Off ──────────────────────────────────────────────
class WriteOffCreate(BaseSchema):
    category: str | None = None
    items_count: int = 0
    note: str | None = None


class WriteOffResponse(BaseResponseSchema):
    company_id: UUID
    category: str | None
    items_count: int
    status: str
    created_by_name: str | None
    note: str | None


# ── Expense Document (Расход) ──────────────────────────────
class ExpenseItemCreate(BaseSchema):
    name: str
    ingredient_id: UUID | None = None
    quantity: Decimal = Decimal("0")
    unit: str = "кг"
    cost_price: Decimal = Decimal("0")


class ExpenseDocumentCreate(BaseSchema):
    receiver: str | None = None
    warehouse_id: UUID | None = None
    warehouse_name: str | None = None
    date: str | None = None
    note: str | None = None
    items: list[ExpenseItemCreate] = []


class ExpenseDocumentUpdate(BaseSchema):
    receiver: str | None = None
    warehouse_id: UUID | None = None
    warehouse_name: str | None = None
    date: str | None = None
    note: str | None = None
    status: str | None = None


class ExpenseItemResponse(BaseResponseSchema):
    document_id: UUID
    ingredient_id: UUID | None
    name: str
    quantity: Decimal
    unit: str
    cost_price: Decimal
    total: Decimal


class ExpenseDocumentResponse(BaseResponseSchema):
    company_id: UUID
    number: int
    receiver: str | None
    warehouse_id: UUID | None
    warehouse_name: str | None
    date: str | None
    registered_at: str | None
    accepted_at: str | None
    items_count: int
    total_amount: Decimal
    status: str
    created_by_name: str | None
    note: str | None


class ExpenseDocumentDetailResponse(ExpenseDocumentResponse):
    items: list[ExpenseItemResponse] = []


# ── Waste Document (Отход) ─────────────────────────────────
class WasteDocumentCreate(BaseSchema):
    category: str | None = None
    warehouse_id: UUID | None = None
    warehouse_name: str | None = None
    ingredient_id: UUID | None = None
    name: str
    quantity: Decimal = Decimal("0")
    unit: str = "кг"
    cost_price: Decimal = Decimal("0")
    reason: str | None = None
    date: str | None = None


class WasteDocumentUpdate(BaseSchema):
    category: str | None = None
    warehouse_id: UUID | None = None
    warehouse_name: str | None = None
    reason: str | None = None
    date: str | None = None
    status: str | None = None


class WasteDocumentResponse(BaseResponseSchema):
    company_id: UUID
    number: int
    category: str | None
    warehouse_id: UUID | None
    warehouse_name: str | None
    ingredient_id: UUID | None
    name: str
    quantity: Decimal
    unit: str
    cost_price: Decimal
    total_amount: Decimal
    reason: str | None
    date: str | None
    registered_at: str | None
    accepted_at: str | None
    status: str
    is_automatic: bool
    created_by_name: str | None

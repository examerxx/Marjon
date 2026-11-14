from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Literal
from pydantic import Field
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class OrderItemCreate(BaseSchema):
    product_id: UUID
    quantity: Decimal = Field(..., gt=0)
    discount: Decimal | None = None
    note: str | None = None
    modifiers: list[dict] = Field(default_factory=list)
    course: int = 1
    # Позиция «с собой» — не облагается сервисным сбором (decision A).
    takeaway: bool = False
    # OFFLINE-01: цена из снимка меню на терминале. Используется только при
    # price_snapshot=True; расхождение с текущим меню пишется в аудит.
    unit_price: Decimal | None = Field(None, ge=0)


class OrderItemsAdd(BaseSchema):
    """Пакетный дозаказ: касса отправляет все новые строки одной командой,
    чтобы на кухне вышел один тикет, а не по тикету на каждую позицию."""
    items: list[OrderItemCreate] = Field(..., min_length=1)


class OfflineTotals(BaseSchema):
    """Итоги, посчитанные терминалом в момент офлайн-продажи.

    Принимаются только вместе с price_snapshot и created_offline_at: чек уже
    напечатан, поэтому сервер проверяет арифметику и сохраняет снимок, а не
    пересчитывает его по изменившимся настройкам компании.
    """
    subtotal: Decimal
    discount_amount: Decimal = Decimal("0")
    tax_amount: Decimal = Decimal("0")
    service_fee: Decimal = Decimal("0")
    total_amount: Decimal


class OrderCreate(BaseSchema):
    branch_id: UUID
    terminal_id: UUID | None = None
    customer_id: UUID | None = None
    order_type: Literal["dine_in", "takeaway", "delivery", "qr"] = "dine_in"
    # Canonical seating relation. Optional for backward compatibility: legacy
    # clients still send only ``table_number``. When ``table_id`` is supplied the
    # server validates tenant/branch ownership and snapshots ``table_number`` from
    # the canonical Table — ``table_id`` is authoritative over any sent number.
    table_id: UUID | None = None
    table_number: str | None = None
    persons_count: int = 1
    note: str | None = None
    # Доставка/самовывоз: контакты клиента (decision A).
    customer_phone: str | None = None
    customer_address: str | None = None
    # Ответственный официант, отличный от автора запроса: касса/терминал
    # создаёт заказ на выбранного сотрудника после подтверждения его PIN.
    waiter_id: UUID | None = None
    discount_amount: Decimal | None = None
    service_fee_rate: float | None = None
    items: list[OrderItemCreate] = Field(default_factory=list)
    # OFFLINE-01: заказ, созданный кассой без сети. client_id — UUID терминала,
    # повтор с тем же значением возвращает существующий заказ. client_number —
    # локальный номер (T1-261113-007). created_offline_at — время на терминале;
    # price_snapshot=True разрешает прислать unit_price из кэша меню.
    client_id: str | None = Field(None, max_length=64)
    client_number: str | None = Field(None, max_length=40)
    created_offline_at: datetime | None = None
    price_snapshot: bool = False
    offline_totals: OfflineTotals | None = None


class OrderUpdate(BaseSchema):
    """Partial update for order-level fields."""
    note: str | None = None
    table_id: UUID | None = None
    table_number: str | None = None
    persons_count: int | None = None
    # Доставка/самовывоз + ответственный официант (decision A).
    customer_phone: str | None = None
    customer_address: str | None = None
    waiter_id: UUID | None = None
    discount_amount: Decimal | None = None
    service_fee_rate: float | None = None
    reason: str | None = None       # причина смены стола/официанта (пишется в audit)
    action_pin: str | None = None   # PIN подтверждения смены стола (для официанта)


class OrderStatusUpdate(BaseSchema):
    status: Literal["new", "accepted", "cooking", "ready", "completed", "cancelled"]
    # DEBT-CLIENT-01: закрытие «в долг» с новым клиентом. Десктоп спрашивает имя
    # и телефон прямо на экране долга; без этих полей должник жил только в
    # комментарии к заказу и не появлялся ни в «Клиентах», ни в отчёте по долгам.
    client_name: str | None = None
    client_phone: str | None = None


class OrderReopen(BaseSchema):
    """REOPEN-01: вернуть ЗАКРЫТЫЙ заказ в работу (гость вернул блюдо)."""
    reason: str | None = None


class OrderItemWaiterUpdate(BaseSchema):
    """Смена ответственного официанта у ОТДЕЛЬНОЙ позиции заказа (decision A).
    Кассир исправляет путаницу, когда блюдо внёс не тот официант
    (доля обслуги считается по ответственному)."""
    waiter_id: UUID
    reason: str | None = None       # причина (пишется в audit)
    action_pin: str | None = None   # PIN подтверждения (для официанта; кассир — без PIN)


class OrderItemQuantityUpdate(BaseSchema):
    """Количество уже внесённой в заказ позиции (плюс/минус в корзине кассы).

    Меняется до оплаты, поэтому склад не задет: сток списывается в
    `/payments` (deduct_for_order), а кухонный чек при дозаказе не печатается.
    Дневной лимит двигается на дельту, а не пересчитывается целиком.
    """
    quantity: Decimal = Field(..., gt=0)


class OrderItemResponse(BaseResponseSchema):
    order_id: UUID
    product_id: UUID
    name: str
    price: Decimal
    quantity: Decimal
    discount: Decimal
    total: Decimal
    status: str
    note: str | None
    modifiers: list
    course: int
    takeaway: bool = False
    # 9.4 — кто и когда добавил позицию (created_at = время добавления).
    added_by: UUID | None = None
    added_by_name: str | None = None
    # Phase 1A cancellation truth (additive, nullable).
    cancelled_at: datetime | None = None
    cancelled_by_id: UUID | None = None


class ReceiptStaffResponse(BaseSchema):
    label: str
    name: str


class OrderResponse(BaseResponseSchema):
    company_id: UUID
    branch_id: UUID
    order_number: str
    order_type: str
    status: str
    table_number: str | None
    table_id: UUID | None = None
    persons_count: int
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    service_fee: Decimal
    total_amount: Decimal
    note: str | None
    source: str
    # Доставка/самовывоз + печать чека + ответственный официант (decision A).
    customer_phone: str | None = None
    customer_address: str | None = None
    receipt_printed_at: datetime | None = None
    waiter_id: UUID | None = None
    waiter_name: str | None = None
    receipt_staff: list[ReceiptStaffResponse] = Field(default_factory=list)
    cancel_comment: str | None = None
    items: list[OrderItemResponse] = Field(default_factory=list)
    # Phase 1A cancellation truth (additive, nullable).
    cancelled_at: datetime | None = None
    cancelled_by_id: UUID | None = None
    # EXPO-01: подтверждение раздачи. ТВ показывает заказ готовым только при
    # заполненном expo_confirmed_at.
    expo_confirmed_at: datetime | None = None
    expo_confirmed_by_id: UUID | None = None
    # OFFLINE-01: локальный номер и признак офлайн-происхождения заказа.
    client_number: str | None = None
    created_offline_at: datetime | None = None
    synced_at: datetime | None = None


class TerminalCreate(BaseSchema):
    branch_id: UUID
    name: str


class TerminalResponse(BaseResponseSchema):
    company_id: UUID
    branch_id: UUID
    name: str
    is_active: bool


class ShiftOpen(BaseSchema):
    branch_id: UUID
    opening_cash: Decimal = Decimal("0")


class ShiftClose(BaseSchema):
    # Смена открыта на филиал, поэтому закрыть её может любой сотрудник
    # терминала (кассир или официант). branch_id необязателен для совместимости:
    # без него закрываем смену самого сотрудника.
    branch_id: UUID | None = None
    closing_cash: Decimal = Decimal("0")


class ShiftResponse(BaseResponseSchema):
    company_id: UUID
    branch_id: UUID
    cashier_id: UUID
    opened_at: datetime
    closed_at: datetime | None
    opening_cash: Decimal
    closing_cash: Decimal | None
    status: str


class MyShiftSummary(BaseSchema):
    """Сводка смены для профиля сотрудника на терминале."""

    shift: ShiftResponse | None = None
    shift_seconds: int = 0
    worked_seconds: int = 0
    sales_total: Decimal = Decimal("0")
    orders_count: int = 0

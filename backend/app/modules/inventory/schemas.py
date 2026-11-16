from __future__ import annotations
from decimal import Decimal
from typing import Literal
from uuid import UUID
from pydantic import Field, field_validator, field_serializer, model_validator
from app.shared.base_schema import BaseSchema, BaseResponseSchema
from app.shared.media_url import absolute_media_url


LOSS_TYPES = ("percent", "amount")


def _check_loss_value(value: Decimal | None, loss_type: str | None) -> Decimal | None:
    if value is None:
        return None
    if value < 0:
        raise ValueError("Значение потери не может быть отрицательным")
    if loss_type == "percent" and value > 100:
        raise ValueError("Процент потери — от 0 до 100")
    return value


class CategoryCreate(BaseSchema):
    name: str
    slug: str
    parent_id: UUID | None = None
    sort_order: int = 0
    is_active: bool = True
    calculate_service: bool = False
    show_in_menu: bool = False
    # Canonical persisted photo reference (MinIO URL from POST
    # /inventory/upload-image). Nullable, no fake default.
    image_url: str | None = None


class CategoryResponse(BaseResponseSchema):
    company_id: UUID
    parent_id: UUID | None
    name: str
    slug: str
    sort_order: int
    is_active: bool
    calculate_service: bool
    show_in_menu: bool
    image_url: str | None

    @field_serializer("image_url")
    def _image_url_absolute(self, value: str | None) -> str | None:
        return absolute_media_url(value)


class CategoryUpdate(BaseSchema):
    # Canonical inventory-category update: proven model columns only.
    # No slug (renaming breaks raw/semi slug-prefix filtering). Photo goes
    # through image_url (MinIO reference from POST /inventory/upload-image).
    name: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    calculate_service: bool | None = None
    show_in_menu: bool | None = None
    image_url: str | None = None


class CategoryReorderRequest(BaseSchema):
    # REORDER V1: PARTIAL-порядок (в отличие от полной перестановки залов,
    # HallReorderRequest). Страница категорий фильтрует список (slug-префикс
    # raw*/semi*/sales* + таб Active/Archived), поэтому клиент отправляет только
    # видимые id в новом порядке. Контракт: нет дубликатов; каждый id
    # принадлежит компании (иначе 409 — чужие/неизвестные id отклоняются целиком);
    # перенумерация 0..n-1 затрагивает только указанные категории, остальные
    # хранят свой sort_order. Меняется исключительно sort_order.
    category_ids: list[UUID] = Field(..., min_length=1)


class ProductIngredientIn(BaseSchema):
    ingredient_id: UUID
    quantity: Decimal = Field(..., gt=0)
    # V36: склад списания этой строки (NULL = главный склад компании).
    warehouse_id: UUID | None = None


class ProductIngredientResponse(BaseSchema):
    ingredient_id: UUID
    ingredient_name: str
    quantity: Decimal
    unit: str
    warehouse_id: UUID | None = None


class SetItemIn(BaseSchema):
    # Блюдо-компонент сета + порций + цена внутри сета (сумма = qty × price).
    product_id: UUID
    quantity: Decimal = Field(..., gt=0)
    price: Decimal = Field(default=Decimal("0"), ge=0)


class SetItemResponse(BaseSchema):
    product_id: UUID
    product_name: str
    quantity: Decimal
    unit: str
    price: Decimal


# V3: накопительные пополнения доступного остатка (append-only история).
class TopUpCreate(BaseSchema):
    # Точная Decimal-сумма пополнения в канонической единице продукта.
    # Фронт шлёт нормализованную dot-строку. Масштаб ≤3 — как у quantities.
    amount: Decimal = Field(..., gt=0, le=Decimal("999999999.999"))
    # Idempotency-ключ операции (генерирует клиент, один на попытку):
    # повтор того же запроса не добавляет сумму дважды.
    idempotency_key: UUID

    @field_validator("amount")
    @classmethod
    def _max_three_decimals(cls, value: Decimal) -> Decimal:
        if abs(value.as_tuple().exponent) > 3:
            raise ValueError("Максимум 3 знака после запятой")
        return value


class TopUpResponse(BaseResponseSchema):
    company_id: UUID
    product_id: UUID
    amount: Decimal
    # Монотонный номер в истории продукта — канонический порядок.
    seq: int
    created_by: UUID | None = None
    idempotency_key: UUID


class TopUpResultResponse(BaseSchema):
    # Итог POST /products/{id}/topups: обновлённый продукт (с recent_topups),
    # зафиксированное событие и флаг повтора (duplicate=True — сумма не добавлена).
    product: ProductResponse
    topup: TopUpResponse
    duplicate: bool = False


class ProductCreate(BaseSchema):
    name: str
    category_id: UUID | None = None
    subcategory_id: UUID | None = None
    product_type: str = "dish"          # dish | sale
    printer_id: UUID | None = None
    unit_id: UUID | None = None
    description: str | None = None
    price: Decimal
    cost_price: Decimal | None = None
    image_url: str | None = None
    is_active: bool = True
    is_auto: bool = False
    is_set: bool = False
    allow_in_sets: bool = False
    unit: str = "шт"
    barcode: str | None = None
    sku: str | None = None
    sort_order: int = Field(default=1, ge=1, strict=True)
    # V46: шаг порции для блюд с дробными порциями (None = целые, 0.1/0.25/0.5).
    portion_step: Decimal | None = Field(default=None, ge=Decimal("0.001"), le=Decimal("1"))
    ingredients: list[ProductIngredientIn] = Field(default_factory=list)


class ProductUpdate(BaseSchema):
    name: str | None = None
    description: str | None = None
    category_id: UUID | None = None
    subcategory_id: UUID | None = None
    product_type: str | None = None
    printer_id: UUID | None = None
    unit_id: UUID | None = None
    price: Decimal | None = None
    cost_price: Decimal | None = None
    image_url: str | None = None
    is_active: bool | None = None
    is_available: bool | None = None
    is_auto: bool | None = None
    is_set: bool | None = None
    allow_in_sets: bool | None = None
    sort_order: int | None = Field(default=None, ge=1, strict=True)
    # V46
    portion_step: Decimal | None = Field(default=None, ge=Decimal("0.001"), le=Decimal("1"))
    # None = leave composition untouched; [] = clear it; a list = replace it.
    ingredients: list[ProductIngredientIn] | None = None

    @field_validator("sort_order", "is_active")
    @classmethod
    def position_scope_cannot_be_null(cls, value):
        if value is None:
            raise ValueError("Position and active state cannot be null when supplied")
        return value


class ProductResponse(BaseResponseSchema):
    company_id: UUID
    category_id: UUID | None
    subcategory_id: UUID | None = None
    product_type: str = "dish"
    printer_id: UUID | None = None
    unit_id: UUID | None = None
    name: str
    description: str | None
    image_url: str | None = None
    price: Decimal
    cost_price: Decimal | None
    # Себестоимость = ручная база (cost_price) + состав (recipe_cost).
    # cost_price остаётся ровно тем числом, что ввёл человек, — дровер
    # редактирует именно его. cost_total — только чтение: показ в таблице
    # «Блюда» и снимок при продаже. NULL, когда нет ни базы, ни рецепта
    # (неизвестное не превращается в ноль).
    recipe_cost: Decimal = Decimal("0")
    cost_total: Decimal | None = None
    tax_rate: Decimal
    unit: str
    barcode: str | None
    sku: str | None
    is_active: bool
    is_available: bool
    # V24 — АВТО/СЕТ тумблеры таблицы «Блюда» (независимые флаги).
    is_auto: bool = False
    is_set: bool = False
    # V39 — доступен для сетов (тумблер колонки, фильтр Товара панели).
    allow_in_sets: bool = False
    # D3 «максимум блюда»: точный лимит/счётчик в канонической единице
    # продукта (NUMERIC(12,3)). NULL лимит = без ограничения. Возвращаются
    # десктопу, чтобы показывать остаток и авто-стоп при sold_count >= daily_limit.
    daily_limit: Decimal | None = None
    sold_count: Decimal = Decimal("0")
    sort_order: int
    # V46: шаг порции (None = целые).
    portion_step: Decimal | None = None
    # BE-16 aggregates — real, computed from actual data (see
    # ProductService._attach_aggregates), never fabricated:
    category_name: str | None = None
    subcategory_name: str | None = None
    printer_name: str | None = None
    ingredients_count: int = 0
    # V38: число блюд в составе сета (set_items), 0 = не сет или пуст.
    set_items_count: int = 0
    # Theoretical max servable count from current ingredient stock
    # (min over composition lines of stock/quantity-per-serving). null
    # when the product has no recorded composition — not a fake 0.
    stock: int | None = None
    ingredients: list[ProductIngredientResponse] = Field(default_factory=list)
    # Группы добавок блюда. На кассе (десктоп) показываем только те, у которых
    # show_in_pos=True — фильтрацию делает потребитель (см. desktop DishModal).
    modifier_groups: list[ModifierGroupResponse] = Field(default_factory=list)
    # V3: последние пополнения доступного остатка (хронологически, max 2) —
    # вычисляются в ProductService._attach_aggregates одним запросом на список.
    recent_topups: list[TopUpResponse] = Field(default_factory=list)
    # V3.5: checkpoint видимости истории (NULL = сброса не было).
    # Видимы только топ-апы с seq строго больше; пустое окно после сброса
    # UI показывает явным "0", audit-строки при этом живы.
    history_reset_seq: int | None = None

    @field_serializer("image_url")
    def _image_url_absolute(self, value: str | None) -> str | None:
        # Локальное хранилище отдаёт /media/... — десктопу и мобилке нужен
        # абсолютный URL под хост их запроса (см. shared/media_url.py).
        return absolute_media_url(value)


# --- Добавки (модификаторы) --------------------------------------------------
# Группа добавок принадлежит блюду (Product); внутри — список опций (Modifier)
# с наценкой price_delta. show_in_pos управляет показом группы на кассе.

class ModifierIn(BaseSchema):
    # id опционален: при сохранении группы существующие опции приходят с id,
    # новые — без. Сервис заменяет весь список опций группы (delete + insert).
    id: UUID | None = None
    name: str
    price_delta: Decimal = Decimal("0")
    is_default: bool = False
    sort_order: int = 0


class ModifierResponse(BaseResponseSchema):
    group_id: UUID
    company_id: UUID
    name: str
    price_delta: Decimal
    is_default: bool
    sort_order: int


class ModifierGroupCreate(BaseSchema):
    product_id: UUID
    name: str
    min_select: int = Field(default=0, ge=0)
    max_select: int = Field(default=1, ge=1)
    is_required: bool = False
    show_in_pos: bool = True
    sort_order: int = 0
    modifiers: list[ModifierIn] = Field(default_factory=list)


class ModifierGroupUpdate(BaseSchema):
    name: str | None = None
    min_select: int | None = Field(default=None, ge=0)
    max_select: int | None = Field(default=None, ge=1)
    is_required: bool | None = None
    show_in_pos: bool | None = None
    sort_order: int | None = None
    # None = не трогать список опций; [] = очистить; список = заменить целиком.
    modifiers: list[ModifierIn] | None = None


class ModifierGroupResponse(BaseResponseSchema):
    company_id: UUID
    product_id: UUID
    name: str
    min_select: int
    max_select: int
    is_required: bool
    show_in_pos: bool
    sort_order: int
    modifiers: list[ModifierResponse] = Field(default_factory=list)


class ProductBranchUpdate(BaseSchema):
    price: Decimal | None = None
    is_available: bool | None = None
    stop_list: bool | None = None


class StopListToggle(BaseSchema):
    branch_id: UUID
    stop_list: bool


class ProductAvailabilityUpdate(BaseSchema):
    # Узкий контракт правки стоп-листа кассиром: только доступность блюда,
    # без цены/названия/прочих полей (их правит админский PATCH /products/{id}).
    is_available: bool


class ProductLimitUpdate(BaseSchema):
    # D3 «максимум блюда»: точный дневной лимит в канонической единице
    # продукта. None → снять лимит (без ограничения), Decimal > 0 → задать
    # максимум и обнулить счётчик (см. ProductService.set_daily_limit).
    # Точный Decimal (не float): фронт шлёт нормализованную dot-строку.
    # Масштаб ограничен 3 знаками — как у OrderItem.quantity Numeric(10,3).
    daily_limit: Decimal | None = Field(default=None, gt=0)

    @field_validator("daily_limit")
    @classmethod
    def _max_three_decimals(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and abs(value.as_tuple().exponent) > 3:
            raise ValueError("Максимум 3 знака после запятой")
        return value


class IngredientCreate(BaseSchema):
    name: str
    unit: str = "кг"
    category: str | None = None
    supplier_name: str | None = None
    loss_type: Literal["percent", "amount"] | None = None
    loss_value: Decimal | None = None
    # V47: нормы остатка из карточки «Продукты» (drawer, между
    # Ед.изм/Категорией и Типом/Значением потери). Неотрицательные.
    avg_quantity: Decimal | None = None
    deficit_threshold: Decimal | None = None

    @model_validator(mode="after")
    def _check_loss_pair(self):
        # Норма задаётся только парой; одиночное поле без второго — 422,
        # чтобы в БД не лежал «немой» норматив, по которому ничего не считается.
        if (self.loss_type is None) != (self.loss_value is None):
            raise ValueError("Тип и значение потери задаются только вместе")
        _check_loss_value(self.loss_value, self.loss_type)
        return self

    @field_validator("avg_quantity", "deficit_threshold")
    @classmethod
    def _check_stock_norms(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value < 0:
            raise ValueError("Количество и порог дефицита — неотрицательные числа")
        return value


class IngredientUpdate(BaseSchema):
    name: str | None = None
    unit: str | None = None
    category: str | None = None
    supplier_name: str | None = None
    is_active: bool | None = None
    loss_type: Literal["percent", "amount"] | None = None
    loss_value: Decimal | None = None
    avg_quantity: Decimal | None = None
    deficit_threshold: Decimal | None = None

    @field_validator("loss_value")
    @classmethod
    def _check_loss_range(cls, value: Decimal | None) -> Decimal | None:
        # PATCH частичный: пару здесь не требуем (тип мог быть задан ранее),
        # проверяем только диапазон. Очистка нормы — парой null.
        if value is not None and value < 0:
            raise ValueError("Значение потери не может быть отрицательным")
        return value

    @field_validator("avg_quantity", "deficit_threshold")
    @classmethod
    def _check_stock_norms(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value < 0:
            raise ValueError("Количество и порог дефицита — неотрицательные числа")
        return value

    @model_validator(mode="after")
    def _check_loss_pair_update(self):
        # Если прислали оба поля сразу — проверяем пару целиком (напр. % > 100).
        if self.loss_type is not None and self.loss_value is not None:
            _check_loss_value(self.loss_value, self.loss_type)
        return self


class IngredientResponse(BaseResponseSchema):
    company_id: UUID
    name: str
    unit: str
    category: str | None
    supplier_name: str | None = None
    is_active: bool
    loss_type: str | None = None
    loss_value: Decimal | None = None
    # V47: нормы остатка из карточки «Продукты».
    avg_quantity: Decimal | None = None
    deficit_threshold: Decimal | None = None
    # BE-17 aggregates — summed/averaged across this ingredient's
    # StockItem rows (all warehouses) at read time, never a fabricated
    # placeholder. 0 here is a genuine "no stock recorded yet", not a
    # stand-in for "unknown".
    stock: Decimal = Decimal("0")
    min_stock: Decimal = Decimal("0")
    purchase_price: Decimal | None = None


class StockItemResponse(BaseResponseSchema):
    company_id: UUID
    warehouse_id: UUID
    ingredient_id: UUID
    quantity: Decimal
    unit: str
    min_quantity: Decimal
    cost_price: Decimal


class StockMovementCreate(BaseSchema):
    warehouse_id: UUID
    ingredient_id: UUID
    movement_type: str
    quantity: Decimal
    unit: str
    cost_price: Decimal = Decimal("0")
    note: str | None = None
    # Порог дефицита: опционально фиксирует StockItem.min_quantity вместе
    # с движением (начальный учёт сырья). Без миграции — колонка существует.
    min_quantity: Decimal | None = None


class StockMovementResponse(BaseResponseSchema):
    company_id: UUID
    warehouse_id: UUID
    ingredient_id: UUID
    movement_type: str
    quantity: Decimal
    unit: str
    cost_price: Decimal
    total_cost: Decimal
    note: str | None


class StockBatchResponse(BaseResponseSchema):
    """V46 FIFO: одна партия прихода с несъеденным остатком."""

    company_id: UUID
    warehouse_id: UUID
    ingredient_id: UUID
    purchase_doc_id: UUID | None = None
    quantity_initial: Decimal
    quantity_remaining: Decimal
    cost_price: Decimal
    unit: str

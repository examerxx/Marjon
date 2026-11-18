from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from sqlalchemy import Boolean, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel


class Category(TimeStampedModel):
    __tablename__ = "categories"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # V25: canonical persisted booleans for the OWNER dish-category UI.
    # Both default FALSE for existing rows (conservative: no fake ON state).
    calculate_service: Mapped[bool] = mapped_column(Boolean, default=False)
    show_in_menu: Mapped[bool] = mapped_column(Boolean, default=False)

    # BE-16: Product now has two FKs to Category (category_id,
    # subcategory_id) — foreign_keys disambiguates which one this side of
    # the relationship follows.
    products: Mapped[list[Product]] = relationship(
        back_populates="category", foreign_keys="Product.category_id"
    )
    children: Mapped[list[Category]] = relationship()


class Product(TimeStampedModel):
    __tablename__ = "products"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    unit_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("nm_units.id", ondelete="SET NULL"), nullable=True, index=True
    )
    category_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    # BE-16: was completely absent. Categories already support a
    # parent/child hierarchy (Category.parent_id) — subcategory_id points
    # at a child Category, same pattern as SemiProduct (BE-10) and Hall
    # (BE-14).
    subcategory_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    # dish | sale — "Блюда" (cooked, has a recipe) vs "Реализация" (resold
    # as-is, e.g. a bottled drink).
    product_type: Mapped[str] = mapped_column(String(20), default="dish")
    # Which printer's kitchen ticket this item routes to, overriding the
    # branch-wide auto_print_kitchen selection (BE-12) when set.
    printer_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("printers.id", ondelete="SET NULL"), nullable=True
    )
    secondary_printer_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("printers.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    barcode: Mapped[str | None] = mapped_column(String(100))
    sku: Mapped[str | None] = mapped_column(String(100))
    price: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    cost_price: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("12.0"))
    unit: Mapped[str] = mapped_column(String(20), default="шт")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
    # V24 — быстрые тумблеры OWNER-таблицы «Блюда»: АВТО/СЕТ.
    # Независимые Product-level флаги, NOT NULL default false.
    is_auto: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    is_set: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # V39 — «доступен для сетов»: тумблер колонки СЕТ. Только фильтр
    # Товара в панели состава (is_set — природа позиции, не трогаем).
    allow_in_sets: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # D3 «максимум блюда»: дневной лимит и счётчик проданного (на всю
    # компанию, по образцу is_available). Точные Decimal-количества в
    # канонической единице продукта: NUMERIC(12,3) — тот же масштаб, что у
    # OrderItem.quantity Numeric(10,3). NULL лимит = без ограничения.
    # При достижении sold_count >= daily_limit блюдо авто-встаёт в стоп
    # (is_available=False). Сброс счётчика — ручной (см. ProductService.set_daily_limit).
    # Конверсий единиц в MARJON нет: смена unit_id числа не пересчитывает.
    daily_limit: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    sold_count: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0"), server_default="0")
    # V3.2: точная причина стопа. True ставит ТОЛЬКО авто-стоп при исчерпании
    # квоты (_apply_sale_to_limit); ЛЮБОЕ ручное действие (availability PATCH,
    # absolute limit, reset, topup-разблокировка) флаг сбрасывает. Топ-ап
    # снимает стоп только по этому флагу: ручная блокировка переживает
    # пополнение даже при исчерпанной квоте.
    limit_auto_stopped: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # V3.5: checkpoint видимости истории. NULL = сброса не было (показываем
    # последние 2 пополнения либо fallback-allowance). Число = показывать
    # только топ-апы с seq строго больше (пусто после сброса = "0", старые
    # строки при этом НЕ удаляются из append-only истории).
    history_reset_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # PORTION-STEP-01: шаг порции для кассы. NULL = блюдо продаётся целыми
    # порциями (±1). Число (0.1 / 0.25 / 0.5) = дробная порция: кнопки ± в
    # карточке блюда двигают количество на этот шаг. Настраивается у отдельных
    # блюд в веб-админке — «весовые» позиции (соус, гарнир на развес, напиток
    # в литрах) продаются долями, остальные — только целиком.
    portion_step: Mapped[Decimal | None] = mapped_column(Numeric(5, 3), nullable=True)

    category: Mapped[Category | None] = relationship(back_populates="products", foreign_keys=[category_id])
    modifier_groups: Mapped[list[ModifierGroup]] = relationship(back_populates="product", cascade="all, delete-orphan")
    ingredients: Mapped[list["ProductIngredient"]] = relationship(back_populates="product", cascade="all, delete-orphan")
    branch_availability: Mapped[list[ProductBranch]] = relationship(back_populates="product", cascade="all, delete-orphan")


class ModifierGroup(TimeStampedModel):
    __tablename__ = "modifier_groups"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    product_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    min_select: Mapped[int] = mapped_column(Integer, default=0)
    max_select: Mapped[int] = mapped_column(Integer, default=1)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Переключатель из веб-админки: показывать ли группу добавок на кассе (десктоп).
    # True = кассир видит и выбирает добавки в экране блюда; False = группа скрыта
    # (настроена, но не продаётся). По умолчанию показываем.
    show_in_pos: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")

    product: Mapped[Product] = relationship(back_populates="modifier_groups")
    modifiers: Mapped[list[Modifier]] = relationship(back_populates="group", cascade="all, delete-orphan")


class Modifier(TimeStampedModel):
    __tablename__ = "modifiers"

    group_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("modifier_groups.id", ondelete="CASCADE"))
    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    price_delta: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    group: Mapped[ModifierGroup] = relationship(back_populates="modifiers")


class ProductBranch(TimeStampedModel):
    __tablename__ = "product_branch"

    product_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    price: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
    stop_list: Mapped[bool] = mapped_column(Boolean, default=False)

    product: Mapped[Product] = relationship(back_populates="branch_availability")


class ProductLimitTopup(TimeStampedModel):
    """V3: append-only история накопительных пополнений доступного остатка.

    Каждая строка — одно подтверждённое пополнение (ADD amount TO allowance).
    Видимые «последние два» — только презентация (last 2 by created_at, id);
    полная история хранится всегда и никогда не удаляется (reset allowance
    счётчики обнуляет, строки истории — нет). Конверсий единиц нет: amount
    всегда в канонической единице продукта на момент операции.
    """

    __tablename__ = "product_limit_topups"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    # Монотонный номер операции в пределах продукта: канонический порядок
    # истории (created_at имеет лишь секундную точность на части СУБД,
    # а UUID неупорядочены — seq даёт детерминированный ledger-порядок).
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    idempotency_key: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("company_id", "idempotency_key", name="uq_topup_company_idempotency"),
        UniqueConstraint("product_id", "seq", name="uq_topup_product_seq"),
    )


class Ingredient(TimeStampedModel):
    __tablename__ = "ingredients"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), default="кг")
    category: Mapped[str | None] = mapped_column(String(100))
    # BE-17: the one ingredient field that's genuinely intrinsic, not
    # derived — stock/min_stock/purchase_price are aggregated from
    # StockItem at read time instead (see IngredientService), since an
    # ingredient's real quantity/cost is per-warehouse.
    supplier_name: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Норма естественной потери для отчётного авто-отхода (чистка/ужарка).
    # percent — % от списанного количества; amount — единиц на 1 ед. списания
    # в тех же единицах (0.3 = 0.3 кг отхода с каждого кг). NULL = норма не
    # задана, авто-отход не считается. Остаток не двигает — только отчёт.
    loss_type: Mapped[str | None] = mapped_column(String(16))
    loss_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 4))
    # V47: нормы остатка из карточки «Продукты» — показываются в drawer
    # между Ед.изм/Категорией и Типом/Значением потери. avg_quantity —
    # справочное среднее количество; deficit_threshold — порог дефицита:
    # остаток ниже порога попадает в колокольчик уведомлений.
    avg_quantity: Mapped[Decimal | None] = mapped_column(Numeric(15, 4))
    deficit_threshold: Mapped[Decimal | None] = mapped_column(Numeric(15, 4))


class ProductIngredient(TimeStampedModel):
    """BE-16: a dish's recipe/composition — mirrors
    semi_product_models.SemiProductIngredient exactly. Drives the
    genuinely-computed ingredients_count and stock (max servable count
    from current ingredient stock) fields on ProductResponse.
    V36: optional per-line warehouse — sale deduction leaves this
    warehouse first (NULL = company main warehouse, same as before)."""
    __tablename__ = "product_ingredients"

    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("ingredients.id", ondelete="CASCADE"), index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), nullable=False)
    warehouse_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("warehouses.id", ondelete="SET NULL"),
        nullable=True,
    )

    product: Mapped[Product] = relationship(back_populates="ingredients")
    ingredient: Mapped["Ingredient"] = relationship()


class SetItem(TimeStampedModel):
    """V38: строка состава сета (комбо) — блюдо внутри блюда.

    Сет (Product с is_set) комплектуется из готовых блюд (тоже Product),
    а не из сырья: product_id — компонент-блюдо, quantity — порций в сете,
    price — цена компонента внутри сета (сумма строки = qty × price).
    Удаление любого из продуктов каскадно чистит строки (CASCADE)."""

    __tablename__ = "set_items"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    set_product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=Decimal("0"))


class Warehouse(TimeStampedModel):
    __tablename__ = "warehouses"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    is_main: Mapped[bool] = mapped_column(Boolean, default=False)
    # V37: soft archive flag for the owner stock screen tabs.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class StockItem(TimeStampedModel):
    __tablename__ = "stock_items"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    warehouse_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("warehouses.id", ondelete="CASCADE"), index=True)
    ingredient_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("ingredients.id"), index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    unit: Mapped[str] = mapped_column(String(20), default="кг")
    min_quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    cost_price: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))


class StockMovement(TimeStampedModel):
    __tablename__ = "stock_movements"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
    warehouse_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("warehouses.id"), index=True)
    ingredient_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("ingredients.id"))
    # purchase | sale | writeoff | transfer | adjustment | inventory
    movement_type: Mapped[str] = mapped_column(String(30), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), nullable=False)
    unit: Mapped[str] = mapped_column(String(20))
    cost_price: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    total_cost: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    ref_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text)


class StockBatch(TimeStampedModel):
    """FIFO-партия остатка: один приход = одна партия.

    V46: расход (expense/waste/sale/writeoff/производство) списывает старые
    партии первыми — пока первая партия не кончится, цена расхода = её цене.
    StockItem.quantity = SUM(remaining), StockItem.cost_price = total/quantity
    (средняя оставшихся — для оценки запаса; расход считается по партиям).
    """

    __tablename__ = "stock_batches"

    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    warehouse_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("warehouses.id", ondelete="CASCADE"), index=True)
    ingredient_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("ingredients.id", ondelete="CASCADE"), index=True)
    purchase_doc_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    quantity_initial: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    quantity_remaining: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    cost_price: Mapped[Decimal] = mapped_column(Numeric(15, 4), default=Decimal("0"))
    unit: Mapped[str] = mapped_column(String(20), default="кг")

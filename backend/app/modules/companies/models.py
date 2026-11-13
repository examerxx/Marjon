from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import TYPE_CHECKING
from sqlalchemy import String, Boolean, DateTime, Integer, Numeric, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid
from app.shared.base_model import TimeStampedModel
from app.modules.organizations.models import JsonType

if TYPE_CHECKING:
    from app.modules.auth.models import User


class Company(TimeStampedModel):
    __tablename__ = "companies"

    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(2))
    # TZ-01: платформа только для рынка Узбекистана (см. CLAUDE.md) — "UTC"
    # как дефолт был тихим багом: ничто его никогда не переопределяло при
    # создании компании, поэтому чеки печатались на 5 часов позади
    # реального времени Ташкента (см. printers/service.py's astimezone).
    timezone: Mapped[str] = mapped_column(String(50), default="Asia/Tashkent")
    currency: Mapped[str] = mapped_column(String(3), default="UZS")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Реквизиты для профиля/чека (SettingsProfilePage, ReceiptSettingsPage)
    address: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(32))
    inn: Mapped[str | None] = mapped_column(String(32))
    # Лого компании — печатается на чеке (растром через ESC/POS) и в UI.
    # logo_key — ключ в MinIO/S3 для серверной загрузки байт при печати;
    # logo_url — публичная ссылка для фронтенда (тот же путь, что и avatar_url).
    logo_url: Mapped[str | None] = mapped_column(String(512))
    logo_key: Mapped[str | None] = mapped_column(String(255))
    # BE-09: frontend's company-profile screen expects these; PATCH
    # /companies/me previously silently dropped them (no such column, and
    # CompanyUpdate had no such field — pydantic's default extra="ignore"
    # means an unknown field is just dropped, not rejected).
    vat_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    service_fee: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    # Спец-пароль для отмены заказа (задаётся в веб-админке)
    cancel_password: Mapped[str | None] = mapped_column(String(64))
    # Доля обслуги, начисляемая официанту, % (для отчёта по официантам)
    waiter_service_percent: Mapped[int] = mapped_column(Integer, default=0)
    # Час старта «операционного дня» (0–23) для сброса нумерации заказов.
    # 0 = сброс в полночь (как раньше); 5 = день идёт с 05:00, заказы до 05:00
    # относятся к прошлому дню. Локальное время — по timezone компании.
    day_start_hour: Mapped[int] = mapped_column(Integer, default=0)
    # 2.5 — конфиг конструктора чека из веб-админки (какие блоки печатать,
    # тексты «спасибо»/подвала и т.п.). Читается форматтером ESC/POS при печати.
    # Форма см. frontend/src/api/receipt.js (buildCustomerTemplate/buildKitchenTemplate).
    receipt_template: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    kitchen_receipt_template: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    # Типы заказа (На стол / На вынос / Доставка) — управляются тремя
    # чекерами «Другие настройки». NULL = все включены (как раньше).
    order_types: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    # Показывать ли глобальную плавающую кнопку поддержки. default TRUE —
    # сохраняем текущее поведение для существующих компаний.
    show_support_button: Mapped[bool] = mapped_column(Boolean, default=True)

    @property
    def logo(self) -> str | None:
        """Алиас для CompanyResponse — фронтенд (OrgContext) ожидает поле 'logo'."""
        return self.logo_url

    branches: Mapped[list[Branch]] = relationship(back_populates="company", cascade="all, delete-orphan")
    users: Mapped[list[User]] = relationship(back_populates="company")


class Branch(TimeStampedModel):
    __tablename__ = "branches"

    company_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Логин/пароль филиала для входа с десктопа (шаг 1 авторизации кассы).
    # login глобально уникален (десктоп логинится ТОЛЬКО по логину, без выбора
    # компании); password_hash — bcrypt (никогда не хранится в открытом виде).
    # Длина 100 — как в применённой миграции 20260925_d7e8brnlog11 (см. ниже
    # BranchLoginRequest.login/BranchCreate.login — приведены к тому же лимиту).
    login: Mapped[str | None] = mapped_column(String(100), unique=True, index=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # PWD-LOCK-01: свой счётчик неудач для входа «как филиал» — пароль филиала
    # живёт на Branch, а не на users, поэтому лок-аут нужен и здесь.
    password_failed_attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    password_locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # DISPLAY-OFF-01: тумблер «Экран очереди» в настройках десктопа. Публичная
    # ТВ-страница филиала при выключенном флаге не показывает номера заказов —
    # на подключённом экране висит логотип, а не очередь гостей.
    guest_display_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="1", nullable=False
    )

    company: Mapped[Company] = relationship(back_populates="branches")

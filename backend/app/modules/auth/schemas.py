from __future__ import annotations
import re
from uuid import UUID
from pydantic import EmailStr, Field, SecretStr, field_validator
from app.shared.base_schema import BaseSchema, BaseResponseSchema


# PWD-POLICY-01: минимум 4 символа. Кассир и официант вводят пароль на кассе
# с десктопа, где длинные пароли не приживаются — «6611» и «QW12» должны
# работать. Состав больше не ограничиваем (раньше требовались латинская буква
# и цифра, из-за чего кириллический «Пароль123» отклонялся как «без буквы»).
#
# Верхняя граница — 72 БАЙТА, а не символа: bcrypt 5.x бросает ValueError на
# более длинном входе, и без этой проверки создание сотрудника падало 500
# вместо 422. Кириллица в UTF-8 занимает 2 байта, поэтому 36 символов — уже
# предел.
PASSWORD_MIN_LENGTH = 4
PASSWORD_MAX_BYTES = 72


def _validate_password(v: str) -> str:
    if len(v) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"Пароль должен быть не менее {PASSWORD_MIN_LENGTH} символов")
    if len(v.encode("utf-8")) > PASSWORD_MAX_BYTES:
        raise ValueError(f"Пароль должен быть не более {PASSWORD_MAX_BYTES} байт")
    return v


class RegisterRequest(BaseSchema):
    model_config = {"from_attributes": True, "extra": "forbid"}

    company_name: str = Field(..., min_length=1, max_length=255)
    company_slug: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9_-]+$")
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return _validate_password(v)


class CompanyUserCreate(BaseSchema):
    model_config = {"from_attributes": True, "extra": "forbid"}

    # CASHIER-EMAIL-OPTIONAL-01: staff creation accepts no address.
    # Owner/Admin registration (RegisterRequest) still requires one.
    email: EmailStr | None = None
    password: str
    phone: str | None = None
    role_slug: str
    role_name: str | None = None
    # Сеть → филиал: сотрудник привязывается к филиалу. Владелец с веб-панели
    # выбирает филиал при создании; None — сотрудник не привязан (виден только
    # веб-владельцу, но не терминалу конкретного филиала).
    branch_id: UUID | None = None
    # Гранулярные тумблеры владельца (см. User.permissions). Отдаём тем же
    # легаси-слоем, что правит PATCH: десктопные гейты can()/must() читают их
    # из /auth/me, веб-админка — из GET /auth/users для префилла формы.
    # Хранятся как есть в User.permissions (JSON): бэкенд не навязывает схему,
    # потому что состав тумблеров задаёт фронтенд (staffConstants.js).
    permissions: dict | None = None
    # Принтер, закреплённый за сотрудником (выбирается из уже добавленных
    # принтеров компании). None — печать идёт на чековый принтер филиала.
    printer_id: UUID | None = None
    # PIN сотрудника (вход на терминале). Раньше он ставился ОТДЕЛЬНЫМ
    # PATCH /auth/users/{id}/pin уже после создания: при занятом PIN сотрудник
    # оставался созданным без PIN, а повторная попытка упиралась в «телефон
    # занят» — владелец не мог ни завершить, ни отменить. Теперь PIN едет в
    # самом create и проверяется ДО вставки, поэтому создание атомарно.
    pin: str | None = Field(default=None, min_length=4, max_length=8)

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return _validate_password(v)

    @field_validator("pin")
    @classmethod
    def check_pin(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not re.fullmatch(r"\d{4,8}", v):
            raise ValueError("PIN должен состоять из 4-8 цифр")
        return v


class LoginRequest(BaseSchema):
    model_config = {"from_attributes": True, "extra": "forbid"}

    email: str | None = Field(None, min_length=1, max_length=255)
    phone: str | None = Field(None, min_length=1, max_length=30)
    password: str


class RefreshRequest(BaseSchema):
    refresh_token: str = Field(..., min_length=1)


class ChangePasswordRequest(BaseSchema):
    model_config = {"from_attributes": True, "extra": "forbid"}

    current_password: SecretStr
    new_password: SecretStr
    confirm_password: SecretStr

    @field_validator("new_password")
    @classmethod
    def check_new_password(cls, v: SecretStr) -> SecretStr:
        # PWD-POLICY-01 действует и на смене собственного пароля: иначе это
        # лазейка в обход политики (плюс bcrypt бросает ValueError на входе
        # длиннее 72 байт — без проверки был бы 500 вместо 422).
        _validate_password(v.get_secret_value())
        return v


class PinSetRequest(BaseSchema):
    pin: str = Field(..., min_length=4, max_length=8)

    @field_validator("pin")
    @classmethod
    def check_pin(cls, v: str) -> str:
        if not re.fullmatch(r"\d{4,8}", v):
            raise ValueError("PIN должен состоять из 4-8 цифр")
        return v


class PinLoginRequest(BaseSchema):
    """Two callers, one endpoint (POST /auth/pin-login):
    - anonymous client: employee_id (identifies the account and its company) + pin;
    - branch terminal (desktop/mobile terminal): its own org token in Authorization
      + pin and an optional user_id narrowing the check to the employee picked on
      screen (this is the key desktop/src/shared/api.js and mobile's Api.pinLogin
      actually send under a terminal session)."""
    employee_id: UUID | None = None
    user_id: UUID | None = None
    pin: str = Field(..., min_length=4, max_length=8)
    # Подтверждение действия («введите PIN владельца заказа») не должно
    # открывать смену: без refresh-токена сотрудник не попадает в «Персонал».
    verify_only: bool = False


class BranchLoginRequest(BaseSchema):
    model_config = {"from_attributes": True, "extra": "forbid"}

    # Логин филиала — произвольная уникальная строка (не телефон): у сети KFC
    # филиал в месте А и месте Б получают разные логины при одном веб-аккаунте.
    # 100 символов — предел колонки branches.login (миграция 20260925_d7e8brnlog11).
    login: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1)


class MonoblockLoginRequest(BaseSchema):
    model_config = {"from_attributes": True, "extra": "forbid"}

    # Телефон аккаунта моноблока (из карточки users/monoblock).
    phone: str = Field(..., min_length=1, max_length=30)
    password: str = Field(..., min_length=1)


class BranchInfo(BaseSchema):
    id: UUID
    name: str
    company_id: UUID


class LogoutRequest(BaseSchema):
    refresh_token: str = Field(..., min_length=1)

    @field_validator("refresh_token")
    @classmethod
    def reject_blank_refresh_token(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("refresh_token must not be blank")
        return value


class TokenResponse(BaseSchema):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class CompanyInfo(BaseSchema):
    id: UUID
    name: str
    slug: str
    currency: str = "UZS"


class BranchLoginResponse(TokenResponse):
    branch: BranchInfo
    company: CompanyInfo


class MonoblockLoginResponse(BaseSchema):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    # Моноблок привязан к company, branch опционален (легаси-привязка).
    # Десктоп при branch=None показывает BranchSelector.
    branch: BranchInfo | None = None
    company: CompanyInfo


class BranchSwitchRequest(BaseSchema):
    model_config = {"from_attributes": True, "extra": "forbid"}

    # Переключение владельца, уже залогиненного в сеть, в конкретный филиал.
    branch_id: UUID


class BranchSessionResponse(BaseSchema):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    branch: BranchInfo
    company: CompanyInfo


class KitchenMonoblockLoginRequest(BaseSchema):
    """Настройка кухонного экрана логином моноблока (карточка users/monoblock).

    branch_id пуст, если у моноблока нет привязки: экран сам выбирает
    единственный филиал компании, а при нескольких — просит выбрать."""

    model_config = {"from_attributes": True, "extra": "forbid"}

    phone: str = Field(..., min_length=1, max_length=30)
    password: str = Field(..., min_length=1)
    branch_id: UUID | None = None


class KitchenPinRequest(BaseSchema):
    """Вход повара на кухонном экране: PIN (+ сотрудник, выбранный на экране).

    Заведение и филиал уже известны из сессии терминала (кухонный экран
    привязывается один раз при настройке), поэтому повару остаётся 4 цифры."""

    model_config = {"from_attributes": True, "extra": "forbid"}

    pin: str = Field(..., min_length=4, max_length=8)
    # Выбранный на экране повар: PIN проверяется только по нему (и его
    # персональный lockout), а не перебором всех поваров филиала.
    user_id: UUID | None = None

    @field_validator("pin")
    @classmethod
    def check_pin(cls, v: str) -> str:
        if not re.fullmatch(r"\d{4,8}", v):
            raise ValueError("PIN должен состоять из 4-8 цифр")
        return v


class KitchenPinResponse(TokenResponse):
    """Ответ PIN-входа: сессия повара + подпись экрана (кто на смене)."""

    user_name: str | None = None
    branch: BranchInfo
    company: CompanyInfo


class KitchenCookResponse(BaseSchema):
    """Повар в списке выбора на кухонном экране."""

    id: UUID
    name: str
    has_pin: bool = False


class UserResponse(BaseResponseSchema):
    # CASHIER-EMAIL-OPTIONAL-01: staff accounts may carry email None.
    email: str | None
    name: str | None = None
    phone: str | None = None
    is_active: bool
    is_superadmin: bool
    company_id: UUID | None
    # Филиал, к которому привязан сотрудник (сеть → филиал). None у веб-владельца
    # (видит всю компанию) и у ещё не привязанных аккаунтов.
    branch_id: UUID | None = None
    # Принтер, закреплённый за сотрудником. Десктоп печатает чек именно на
    # него, а при None — на чековый принтер филиала (прежнее поведение).
    printer_id: UUID | None = None
    role_slugs: list[str] = Field(default_factory=list)
    avatar_url: str | None = None
    # Тумблеры/матрица прав из карточки сотрудника. Отдаём обратно, иначе
    # UI не может показать сохранённое состояние и выглядит как «переключатели
    # не работают».
    permissions: dict | None = None
    auth_scope: str = "app"  # "app" | "hq_admin" — BE-01, set per-session, not persisted
    # Легаси-JSON гранулярных прав владельца (см. User.permissions). Отдаём как
    # есть: десктопные гейты can()/must() и PIN-подтверждения читают тумблеры
    # отсюда; None — тумблеры не выставлялись, поведение гейтов прежнее.
    permissions: dict | None = None


class CompanyUserUpdate(BaseSchema):
    model_config = {"from_attributes": True, "extra": "forbid"}

    name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    password: str | None = None
    role_slug: str | None = None
    # Legacy Web field name for the employee display name. It never names or
    # mutates the Role definition.
    role_name: str | None = None
    # BE-07: was missing entirely — a deactivated employee (DELETE
    # /auth/users/{id} soft-deactivates, doesn't hard-delete) had no way to
    # be reactivated through the API.
    is_active: bool | None = None
    # Переназначение филиала сотрудника (сеть → филиал). None — привязку не
    # трогаем; конкретный id — сотрудник переезжает в другой филиал сети.
    branch_id: UUID | None = None
    # Опциональный легаси-слой гранулярных прав (см. User.permissions).
    # Владелец выставляет пер-юзерные тумблеры; по умолчанию None → колонка
    # не трогается. Хранится как есть, в UserResponse не отдаётся.
    permissions: dict | None = None
    # Принтер сотрудника. Здесь None недостаточно, чтобы понять «снять
    # привязку» или «не трогать», поэтому роутер смотрит на
    # model_fields_set: ключ есть в теле → пишем значение (null → отвязать),
    # ключа нет → привязку не меняем.
    printer_id: UUID | None = None

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str | None) -> str | None:
        if v is not None:
            return _validate_password(v)
        return v


class CompanyUserResponse(UserResponse):
    role_slug: str | None = None

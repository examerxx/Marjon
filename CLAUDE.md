# MARJON — Контекст проекта для AI-агентов

> Этот файл читается автоматически при каждой сессии.
> Прочитай ПОЛНОСТЬЮ перед любой работой с кодом.
> Последнее обновление: 2026-09-17 (сверено с кодом)

---

## 1. Что такое Marjon

SaaS-платформа для автоматизации ресторанов на рынке Узбекистана.
POS-касса, кухонный дисплей (KDS), склад, доставка, CRM, HR, аналитика, фискализация (ОФД), интеграция Click/Payme/Uzum.

**Дедлайн MVP:** 10.08.2026 (срок прошёл — идёт доработка до production, см. TASKS.md)
**Ветка разработки:** `main` (push только по явной просьбе; на upstream есть ветка `front`)
**Репозиторий:** `github.com/examerxx/Marjon`

---

## 2. Границы ответственности

> **Прочитай перед любой работой.**

| Правило | Значение |
|---------|----------|
| Backend + Frontend | Обе части проекта доступны для работы |
| Не пушь без просьбы | `git push` только когда пользователь явно просит |
| Не создавай лишнего | Не добавляй фичи, абстракции и файлы сверх задания |
| Desktop / Mobile / Owner | Код существует и рабочий (`desktop/`, `mobile/`, `owner/`) — меняй только по явному заданию, без расширения скоупа |

---

## 3. Стек и зависимости

### Frontend (твоя зона)

| Что | Технология | Заметки |
|-----|-----------|---------|
| UI | React 18, JSX | **Не TypeScript!** Весь код `.jsx` |
| Сборка | Vite 5 | Multi-page: `index.html` (кафе POS) + `admin.html` (админка) |
| Роутинг | React Router v6 | `<Routes>` в `App.jsx` |
| HTTP | Axios | Единый клиент в `src/api/client.js` |
| Графики | Chart.js 4 | Используется в дашборде и отчётах |
| Иконки | Lucide React + Bootstrap Icons SVG | `<Icon>` компонент-обёртка |
| CSS | Vanilla CSS | **Без Tailwind.** 23 файла, ~47K строк (+ монолит админки ~20K) |
| Токены | `marjon-tokens.css` | Все цвета, тени, радиусы — ТОЛЬКО через токены |
| State | React Context | `AuthContext`, `OrgContext`, `ThemeContext` |

### Backend

FastAPI + Python 3.12 + SQLAlchemy 2.0 async + Alembic (59 версий в `migrations/versions/`) + PostgreSQL.
31 модуль в `backend/app/modules/`. Swagger: `localhost:8000/docs`.

Бэкенд можно менять. Сейчас активная работа над мобилкой и десктопом — бэкенд чиним потом.

**PIN-логин реализован** (`backend/app/modules/auth/router.py:318`, `service.py:570` — `pin_login`: bcrypt `pin_hash`, троттлинг 5 попыток / лок 15 мин, тесты в `tests/test_pin_login.py`). Остаток: удалить легаси-колонку `User.pin_code` (plaintext-наследие, обнуляется миграцией `20260806_r8s9pin01`).

**Известные расхождения (см. TASKS.md):** вебхуки `payments/webhooks.py` сверяются с глобальными ключами из настроек, а `PUT /payments/gateway-settings` хранит per-company ключи — онлайн-оплата на несколько филиалов упрётся в один мерчант; фискализация архитектурно готова (`fiscal/outbox.py`, `runtime.py`), но провайдер ОФД не подключён (`fiscal_enabled=False`).

### Backend паттерны

**Структура модуля:**
```
backend/app/modules/{module}/
├── models.py      # SQLAlchemy модели (TimeStampedModel base)
├── schemas.py     # Pydantic v2 (BaseSchema, BaseResponseSchema)
├── repository.py  # CRUD операции с БД
├── service.py     # Бизнес-логика
└── router.py      # FastAPI endpoints
```

**Префиксы (main.py:156-183):** единый `API = "/api/v1"` — все роутеры монтируются на него
(включая `kafe_compat` и платёжные вебхуки без JWT). Отдельных `/api/v1/kafe` и `/api/v1/admin` в коде нет.

**Базовая модель:**
```python
from app.shared.base_model import TimeStampedModel
class MyModel(TimeStampedModel):
    __tablename__ = "my_table"
    company_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("companies.id"), index=True)
```

**Авторизация:**
```python
from app.modules.auth.dependencies import get_current_user
@router.get("/")
async def endpoint(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # user.company_id — для tenant isolation
```

**Конфигурация:** `app/config.py` → `pydantic_settings`, читает `.env`.
**Миграции:** `alembic revision --autogenerate -m "message"`, затем `alembic upgrade head`.

---

## 4. Структура фронтенда

```
frontend/src/
├── api/
│   ├── client.js        # Axios instance, JWT interceptors, formatMoney()
│   ├── receipt.js       # API для чеков
│   └── ws.js            # WebSocket клиент
├── admin/               # Отдельное приложение (admin.html)
│   ├── AdminApp.jsx
│   ├── api.js           # Axios для админки (отдельный)
│   ├── main.jsx
│   └── styles.css       # ~8400 строк
├── components/          # 30 компонентов (DashboardLayout, Sidebar + sidebar/, Topbar + topbar/, GlobalSearch, DatePicker, ReportDateRangePicker, Icon, SupportWidget, receipt/…)
│   ├── DashboardLayout.jsx   # Shell: sidebar + topbar + content
│   ├── Sidebar.jsx           # Навигация + mobile bottom-nav
│   ├── Topbar.jsx            # Дата, курс, баланс, уведомления
│   ├── DemoNotice.jsx        # Заглушка (return null) — демо-данных больше нет, см. 5.1
│   ├── DataTableView.jsx     # Универсальная таблица
│   ├── SettingsResourcePage  # → в pages/settings/ (CRUD-компонент)
│   ├── GlobalSearch.jsx      # Ctrl+K поиск
│   ├── DatePicker.jsx
│   ├── ReportDateRangePicker.jsx
│   ├── Loader.jsx
│   ├── BackButton.jsx
│   ├── Icon.jsx
│   ├── SupportWidget.jsx
│   └── receipt/              # Компоненты чеков
├── context/
│   ├── AuthContext.jsx       # JWT, login/logout, user
│   ├── OrgContext.jsx        # Данные организации (name, currency, vat)
│   └── ThemeContext.jsx      # Тема (пока не используется)
├── pages/                    # ~50 страниц + подпапки (dashboard/, nomenclature/, staff/, finance/, settings/, auth/)
│   ├── auth/                 # PinLoginPage, StaffLoginPage
│   ├── settings/             # 11 settings-страниц + SettingsResourcePage
│   ├── OwnerDashboard.jsx    # Главный дашборд (~1025 строк)
│   ├── OrdersPage.jsx        # POS-заказы
│   ├── KitchenPage.jsx       # Кухонный экран
│   ├── WaiterPage.jsx        # Экран официанта
│   ├── MenuPage.jsx          # Управление меню
│   ├── NomenclaturePage.jsx  # Блюда + ингредиенты (2 режима)
│   ├── WarehousePage.jsx     # Склад (8 разделов)
│   ├── FinancePage.jsx       # Финансы
│   ├── StaffPage.jsx         # Персонал
│   ├── *ReportPage.jsx       # 7 типов отчётов
│   └── ...
├── styles/                   # 23 CSS-файла, ~47K строк суммарно (подпапки global/, owner/, shared/)
│   ├── react-overrides.css   # ~29200 строк (основной!)
│   ├── owner/dashboard.css   # ~6700 строк (layout дашборда, sidebar, topbar)
│   ├── app.css               # ~720 строк (базовые стили)
│   ├── global/marjon-tokens.css # ~280 строк (токены — источник истины)
│   ├── shared/topbar-widgets.css # ~520 строк
│   ├── shared/receipt.css    # ~1290 строк
│   ├── owner/staff-pos.css   # ~520 строк
│   └── ... (остальные owner/*, shared/*, global/*)
└── utils/
    ├── date.js               # Хелперы дат
    └── permissions.js        # Проверка прав (Web Launch V1: owner-only)
```

---

## 5. Ключевые паттерны кода

### 5.1. Честные состояния данных (демо-фолбэк упразднён)

> Старый паттерн Demo Fallback (`HARDCODED_DATA` + `isDemo` + баннер `DemoNotice`) удалён:
> `DemoNotice.jsx` — заглушка (`return null`), импортов в прод-коде нет. Не возвращать его.

Стандарт зафиксирован тестами в `src/pages/TruthfulDataStates.test.jsx`. Каждая страница:

```jsx
const [rows, setRows] = useState([]);        // пусто, НЕ демо-данные
const [error, setError] = useState(null);

useEffect(() => {
  api.get("/endpoint")
    .then(({ data }) => setRows(normalize(data)))
    .catch((e) => setError(e));
}, []);

if (error) return <div role="alert">Не удалось загрузить…</div>;
if (!rows.length) return <div>…пока нет</div>;  // пустой текст, не нули
```

**Правила:**
- При ошибке API — `role="alert"` с текстом «Не удалось загрузить…», никаких `0 UZS` и симуляции сумм (`FinanceTransactions` показывает «Недоступно», `OwnerDashboard` — «Dashboard недоступен»)
- При пустом успешном ответе — пустой текст («Категорий пока нет», «Заказов за этот день нет»)
- Мёртвый код `data/reportDemo.jsx` и `dashboard/simulation.js` не использовать и не расширять (их единственность проверяется гардами)
- В `WarehousePage` запрещены прямые `api.post/patch/delete` и несекционные кэши

### 5.2. API Client

```js
// src/api/client.js
import axios from "axios";
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api/v1",
});
// JWT автоматически в headers через interceptor
// Refresh token при 401 — автоматически
```

### 5.3. Vite Multi-Page

Два entry point:
- `index.html` → кафе (POS-интерфейс)
- `admin.html` → админка (отдельное React-приложение в `src/admin/`)

```js
// vite.config.js
build: {
  rollupOptions: {
    input: { kafe: "index.html", admin: "admin.html" }
  }
}
```

### 5.4. Запуск

```bash
cd frontend && npm install && npm run dev   # → http://localhost:5173
# Vite проксирует /api → http://127.0.0.1:8000
```

---

## 6. CSS-архитектура

> ⚠️ Перед любой реструктуризацией/разбиением HQ CSS (`src/admin/styles.css`) прочти
> `docs/adr/fe-08c-hq-css-monolith-v1.md` — для Web V1 это намеренный монолит,
> ретро-split запрещён. (Таблица ниже исторически устарела; актуальные размеры — в репозитории.)

### 6.1. Файлы и их роли

| Файл | Строк | Роль |
|------|-------|------|
| `react-overrides.css` | ~29200 | Основной: все компоненты, страницы, breakpoints |
| `owner/dashboard.css` | ~6700 | Layout дашборда, sidebar, topbar |
| `global/marjon-tokens.css` | ~280 | Дизайн-токены (ИСТОЧНИК ИСТИНЫ для цветов!) |
| `shared/receipt.css` | ~1290 | Чеки |
| `owner/settings.css` | ~1060 | Настройки |
| `app.css` | ~720 | Базовые стили приложения |
| Остальные ~17 файлов | ~5500 | owner/*, shared/* (auth, topbar-widgets, staff-pos…), global/* |
| `admin/styles.css` | ~20100 | Намеренный монолит HQ-админки (ретро-split запрещён, см. ADR выше) |

### 6.2. Layout (критические зависимости)

```
dashboard-shell (display: flex, flex-direction: row)
├── dashboard-sidebar (width: 260px, position: relative)
│   └── ≤1024px: width: 0, скрыт → вместо него mobile-bottom-nav
└── dashboard-main (flex: 1 1 auto)
    ├── dashboard-topbar (flex-shrink: 0)
    └── dashboard-content (flex: 1 1 auto, overflow-y: auto)
```

**Цепочки зависимостей:**
- Ширина sidebar → ширина `dashboard-main` → ширина топбара и контента → ВСЕ внутренние элементы
- Высота топбара → `min-height: calc(100vh - Xpx)` у `dashboard-content`
- `mobile-bottom-nav` — **сиблинг** `<aside>`, НЕ внутри него (из-за `transform` на aside)

### 6.3. Breakpoints

| Breakpoint | Layout |
|-----------|--------|
| > 1440px | Полный десктоп, топбар 86px |
| 1025–1440px | Компактный топбар 64px |
| ≤ 1024px | Sidebar скрыт, bottom nav, топбар 54px |
| ≤ 768px | Мобильный вид |

### 6.4. Дизайн-токены (палитра)

**Источник истины: `marjon-tokens.css`**

| Токен | HEX | Когда использовать |
|-------|-----|-------------------|
| `--color-brand` / `--teal-500` | `#1db5b5` | CTA-кнопки, активные элементы, акценты |
| `--color-brand-hover` / `--teal-400` | `#22d3ee` | Hover-состояние |
| `--color-brand-dark` / `--teal-600` | `#0fa3a3` | Active/pressed |
| `--neutral-950` | `#071428` | Самый тёмный фон (sidebar, bottom nav) |
| `--neutral-900` | `#0b1f3f` | Тёмные панели, drawer |
| `--neutral-800` | `#162840` | Вторичные тёмные поверхности |
| `--neutral-50` / `--color-bg` | `#f4f7fc` | Фон страницы |
| `--neutral-0` / `--color-card` | `#ffffff` | Фон карточек |
| `--color-interactive` | `#2563eb` | **ТОЛЬКО ссылки** (не кнопки, не фоны) |

### 6.5. Запреты по CSS

| Нельзя | Почему |
|--------|--------|
| Hex-коды напрямую | Всегда через токены из `marjon-tokens.css` |
| `--color-interactive` как фон | Это цвет ссылок, не фон |
| Teal-градиенты на тёмных панелях | Визуальный конфликт с палитрой |
| Менять ширину sidebar без анализа | Ломает всю flex-цепочку layout |
| Менять высоту topbar без пересчёта | Нужно обновить `calc(100vh - X)` во всех местах |
| `!important` без крайней необходимости | Создаёт долг по specificity |

---

## 7. Чеклист перед правкой CSS

> **ОБЯЗАТЕЛЬНО перед любой CSS-правкой:**

```
[ ] Прочитал текущее состояние файла (Read)
[ ] Grep: нашёл ВСЕ правила для этого селектора во ВСЕХ CSS-файлах
[ ] Проверил specificity — не создам ли конфликт
[ ] Понял цепочку зависимостей (родитель → элемент → дети)
[ ] Знаю на каких breakpoints это правило применяется
[ ] Не использую hex-коды — только токены
```

**После правки:**
```
[ ] Проверил на 390px (мобильный)
[ ] Проверил на 768px (планшет)
[ ] Проверил на 1280px+ (десктоп)
[ ] Ничего не сломалось за пределами изменённого элемента
```

---

## 8. Частые ошибки (не повторяй)

| Ошибка | Причина | Как избежать |
|--------|---------|-------------|
| `position: fixed` внутри sidebar на мобильном | Sidebar имеет `transform` → fixed позиционируется от sidebar, не viewport | Выносить fixed-элементы за `<aside>` |
| CSS override не применяется | Низкая specificity | Grep все правила, проверить computed styles |
| Элемент схлопывается | `flex-shrink: 1` по умолчанию | Добавить `flex-shrink: 0` |
| Цвет «синий» вместо teal | Перепутан `--neutral-950` с `--color-brand` | Сверяться с таблицей токенов |
| Бордер не виден | Цвет бордера совпадает с фоном | Проверить контраст |
| react-overrides перебивает dashboard.css | Порядок import в app | Писать в том файле, где уже есть правило |
| Забыл обновить `calc(100vh - X)` | Поменял высоту topbar | Grep все `calc(100vh` |

---

## 9. Документация проекта

| Документ | Путь | Что внутри |
|---------|------|-----------|
| Общее ТЗ | `docs/tz/TZ_GENERAL.md` | Рынок, конкуренты, архитектура, безопасность, платежи, тестирование, оптимизация |
| Web ТЗ | `docs/tz/TZ_WEB.md` | Все страницы web-панели, API-маршруты, demo fallback |
| Mobile ТЗ | `docs/tz/TZ_MOBILE.md` | React Native + Expo, роли, экраны |
| Desktop ТЗ | `docs/tz/TZ_DESKTOP.md` | Electron KDS для поваров |
| Дополнение | `docs/tz/TZ_ADDENDUM.md` | User stories, offline-сценарии, боли рынка |
| Техдока | `docs/DOCUMENTATION.md` | Архитектура, модели, API endpoints |
| Стайлгайд | `docs/STYLEGUIDE.md` | Дизайн-система, палитра, компоненты |

---

## 10. Бизнес-контекст (для лучших решений)

- **Рынок:** Узбекистан, 29 млн потребителей, обязательная фискализация
- **Конкуренты:** iiko (50K+), Paloma365 (10K+), AliPOS (1290+), ZimZim (500+)
- **Наш фокус:** простота + цена + offline для малых кафе (5–20 столов)
- **Платежи:** Click, Payme, Uzum Bank, наличные, смешанная
- **Фискализация:** ОФД УЗ (ЦОТУ / soliq.uz) — обязательна по закону
- **Валюта:** UZS (основная), USD (для отчётов). Форматирование: `formatMoney()` из `api/client.js`
- **Языки:** русский (основной), узбекский (v1.1)
- **Роли:** Владелец, Менеджер, Кассир, Официант, Повар, Курьер, Бухгалтер

---

## 11. Статус платформ

| Платформа | Статус | Где код |
|-----------|--------|---------|
| Web Admin Panel | 🟢 ~80% MVP | `frontend/` (owner-only gate, см. 5.1) |
| Desktop (касса, официант, кухня) | 🟢 Рабочий | `desktop/` (Electron 28, offline-очередь; детали и лимиты — OFFLINE_PLAN.md) |
| Mobile App (Flutter) | 🟡 Рабочий скелет | `mobile/` |
| Owner App (Flutter) | 🟡 Рабочий скелет | `owner/` |
| Payment gateways (Go) | 🟢 Рабочие | `services/click-gateway`, `services/payme-gateway`, `services/uzum-gateway` |
| Print Agent | 🟢 Рабочий | `backend/print_agent/` (polling → TCP 9100) |
| Админка (HQ) | 🟡 Частично | `frontend/src/admin/` |

---

## 12. Git-конвенции

- **Ветка:** `main` (push только по явной просьбе)
- **Коммиты:** на русском или английском, осмысленные
- **Формат:** `feat:`, `fix:`, `docs:`, `refactor:`, `style:` (conventional commits)
- **Не коммить:** `node_modules/`, `.env`, `*.log`, `dist/`, `.venv/`
- **Перед коммитом:** `npm run build` — проверить что сборка проходит

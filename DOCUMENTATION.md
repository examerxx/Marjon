# MARJON — Документация проекта

> Облачная SaaS-платформа автоматизации ресторанов для рынка Узбекистана.

---

## Содержание

1. [Обзор](#обзор)
2. [Архитектура](#архитектура)
3. [Технологический стек](#технологический-стек)
4. [Структура проекта](#структура-проекта)
5. [Backend (FastAPI)](#backend-fastapi)
   - [Модули](#модули)
   - [Модели данных](#модели-данных)
   - [Аутентификация и авторизация](#аутентификация-и-авторизация)
   - [Multi-tenancy](#multi-tenancy)
   - [API Endpoints](#api-endpoints)
6. [Frontend (React)](#frontend-react)
   - [Страницы](#страницы)
   - [Маршрутизация](#маршрутизация)
   - [API Client](#api-client)
7. [Print Agent](#print-agent)
8. [База данных](#база-данных)
9. [Запуск проекта](#запуск-проекта)
10. [Переменные окружения](#переменные-окружения)

---

## Обзор

**MARJON** — SaaS-система для управления ресторанами, кафе и фаст-фудами. Покрывает полный цикл работы заведения:

- **POS-касса** — приём и оформление заказов (зал, самовывоз, доставка, QR)
- **Кухонный дисплей** — отображение заказов для поваров в реальном времени
- **Склад** — учёт ингредиентов, приход/расход, инвентаризация
- **Доставка** — зоны, курьеры, GPS-трекинг
- **CRM** — клиентская база, заметки, история заказов
- **Лояльность** — бонусные баллы, уровни (bronze → platinum)
- **HR** — сотрудники, смены, учёт посещаемости
- **Аналитика** — дашборд, отчёты по продажам, топ-товары
- **Платежи** — наличные, карта, Payme, Click, Uzum Bank
- **Фискализация** — интеграция с ОФД Узбекистана
- **Подписки** — тарифы, биллинг, счета
- **Принтеры** — ESC/POS печать чеков и кухонных тикетов

Целевой рынок: **Узбекистан** (валюта UZS, локальные платёжные системы, OFD UZ).

---

## Архитектура

Проект состоит из двух основных частей:

```
┌─────────────────┐       ┌──────────────────┐
│   Frontend      │──────>│    Backend       │
│   React SPA     │  API  │    FastAPI       │
│   (Vite)        │       │    (async)       │
└─────────────────┘       └───────┬──────────┘
                                  │
                          ┌───────▼──────────┐
                          │   PostgreSQL     │
                          │   (Supabase)     │
                          └──────────────────┘
                                  ▲
                          ┌───────┴──────────┐
                          │   Print Agent    │
                          │   (polling API)  │
                          └──────────────────┘
```

- **Backend** (`backend/app/`) — FastAPI, async, 17 модулей
- **Frontend** (`frontend/`) — React SPA (Vite), 12 страниц
- **Print Agent** (`backend/print_agent/`) — отдельный процесс на POS-терминале

Дополнительно в `backend/` корне лежат файлы от **ранней версии** проекта (синхронный FastAPI, SQLite, простая auth). Они не используются основным приложением — `backend/main.py` просто импортирует `app.main:app`.

---

## Технологический стек

### Backend

| Компонент            | Технология                          |
|----------------------|-------------------------------------|
| Фреймворк            | FastAPI 0.115+                      |
| Python               | 3.12+                               |
| ORM                  | SQLAlchemy 2.0 (async)              |
| Миграции             | Alembic 1.13                        |
| БД (production)      | PostgreSQL (Supabase)               |
| БД (dev)             | SQLite (aiosqlite)                  |
| Драйвер PostgreSQL   | asyncpg                             |
| Аутентификация       | JWT (python-jose + bcrypt)          |
| Валидация            | Pydantic v2 + pydantic-settings     |
| ASGI-сервер          | Uvicorn                             |
| Печать               | ESC/POS (python-escpos)             |

### Frontend

| Компонент     | Технология             |
|---------------|------------------------|
| Фреймворк     | React 18+              |
| Сборщик       | Vite                   |
| Роутинг       | React Router DOM v6    |
| HTTP-клиент   | Axios                  |
| Графики       | Chart.js               |
| Иконки        | Bootstrap Icons (CDN)  |
| CSS           | Кастомные стили (~11K строк) |

---

## Структура проекта

```
Marjon/
├── backend/
│   ├── app/                          # Основное приложение
│   │   ├── main.py                   # FastAPI app, lifespan, роутеры
│   │   ├── config.py                 # Settings (pydantic-settings)
│   │   ├── infrastructure/
│   │   │   └── database/
│   │   │       └── session.py        # AsyncEngine, SessionLocal, get_db
│   │   ├── middleware/
│   │   │   └── tenant_middleware.py   # JWT → request.state.company_id
│   │   ├── modules/                  # 17 бизнес-модулей
│   │   │   ├── analytics/
│   │   │   ├── audit/
│   │   │   ├── auth/
│   │   │   ├── companies/
│   │   │   ├── crm/
│   │   │   ├── delivery/
│   │   │   ├── fiscal/
│   │   │   ├── hr/
│   │   │   ├── inventory/
│   │   │   ├── kitchen/
│   │   │   ├── loyalty/
│   │   │   ├── notifications/
│   │   │   ├── payments/
│   │   │   ├── pos/
│   │   │   ├── printers/
│   │   │   ├── rbac/
│   │   │   └── subscriptions/
│   │   └── shared/                   # Общие компоненты
│   │       ├── base_model.py         # Base, TimeStampedModel
│   │       ├── base_repository.py    # BaseRepository, TenantRepository
│   │       ├── base_schema.py        # BaseSchema, BaseResponseSchema
│   │       ├── exceptions.py         # HTTP-исключения
│   │       └── pagination.py         # PageParams, Page
│   ├── migrations/                   # Alembic миграции
│   ├── print_agent/                  # Print Agent (отдельный процесс)
│   ├── scripts/
│   │   └── enable_rls.py            # Включение RLS на Supabase
│   ├── routers/                      # ← Legacy (не используется)
│   ├── main.py                       # Entry point (re-export)
│   ├── auth.py, config.py, ...       # ← Legacy файлы
│   ├── .env                          # Переменные окружения
│   ├── pyproject.toml                # Зависимости Python
│   └── requirements.txt              # Альтернативный список зависимостей
│
└── frontend/
    ├── index.html                    # Точка входа
    ├── package.json                  # Зависимости Node.js
    ├── src/
    │   ├── main.jsx                  # ReactDOM.createRoot
    │   ├── App.jsx                   # Router, маршруты
    │   ├── api/
    │   │   └── client.js             # Axios instance, login/logout
    │   ├── assets/
    │   │   └── marjon-logo.png       # Логотип
    │   ├── components/
    │   │   ├── DashboardLayout.jsx   # Layout с Sidebar + Topbar
    │   │   ├── Sidebar.jsx           # Боковое меню
    │   │   └── Topbar.jsx            # Верхняя панель
    │   ├── pages/                    # 12 страниц
    │   │   ├── OwnerDashboard.jsx    # Главный дашборд (464 строк)
    │   │   ├── WaiterPage.jsx        # Интерфейс официанта (404 строк)
    │   │   ├── StaffRolePage.jsx     # Управление персоналом (323 строк)
    │   │   ├── KitchenPage.jsx       # Кухонный экран (131 строк)
    │   │   ├── LoginPage.jsx         # Логин (87 строк)
    │   │   ├── FinancePage.jsx       # Финансы (42 строк)
    │   │   ├── AnalyticsPage.jsx     # Аналитика (32 строк)
    │   │   ├── OrdersPage.jsx        # Заказы (30 строк)
    │   │   ├── SectionPage.jsx       # Универсальный раздел
    │   │   ├── MenuPage.jsx          # Меню
    │   │   ├── StaffPage.jsx         # Персонал
    │   │   └── PlaceholderPage.jsx   # Заглушка
    │   ├── styles/                   # CSS (~11,600 строк)
    │   └── utils/
    │       └── date.js               # Утилиты дат
    └── dist/                         # Собранный билд
```

---

## Backend (FastAPI)

### Модули

Каждый модуль следует паттерну:
```
module/
├── __init__.py
├── models.py        # SQLAlchemy модели
├── schemas.py       # Pydantic схемы (request/response)
├── repository.py    # Слой доступа к данным (TenantRepository)
├── service.py       # Бизнес-логика
└── router.py        # FastAPI endpoints
```

| Модуль           | Описание                                          | Основные модели                          |
|------------------|---------------------------------------------------|------------------------------------------|
| `auth`           | Регистрация, логин, JWT, refresh-токены            | User, RefreshToken                       |
| `companies`      | Компании (тенанты), филиалы                       | Company, Branch                          |
| `rbac`           | Роли, права, привязка к филиалам                  | Role, Permission, RolePermission, UserRole |
| `inventory`      | Каталог товаров, категории, модификаторы, склад   | Category, Product, ModifierGroup, Modifier, ProductBranch, Ingredient, Warehouse, StockItem, StockMovement |
| `pos`            | Заказы, позиции, POS-терминалы                    | Order, OrderItem, PosTerminal            |
| `payments`       | Платежи (нал, карта, Payme, Click, Uzum, loyalty) | Payment                                  |
| `kitchen`        | Кухонные станции                                  | KitchenStation                           |
| `crm`            | Клиентская база, заметки                          | Customer, CustomerNote                   |
| `loyalty`        | Бонусная программа (bronze→platinum)              | LoyaltyAccount, LoyaltyTransaction      |
| `delivery`       | Зоны, курьеры, заказы на доставку                 | DeliveryZone, Courier, DeliveryOrder     |
| `hr`             | Сотрудники, смены, учёт посещаемости              | Employee, WorkShift, AttendanceLog       |
| `analytics`      | Дашборд, отчёты по продажам, топ-товары           | — (агрегация Order/Payment)              |
| `notifications`  | Уведомления (in_app, push, sms, email)            | Notification                             |
| `audit`          | Лог действий                                      | AuditLog                                 |
| `fiscal`         | Фискальные чеки (ОФД Узбекистан)                  | FiscalReceipt                            |
| `subscriptions`  | Тарифы, подписки, счета                           | Plan, Subscription, Invoice              |
| `printers`       | ESC/POS принтеры, очередь печати                  | Printer, PrintJob                        |

### Модели данных

Все модели наследуют `TimeStampedModel`:
- `id` — UUID (auto-generated)
- `created_at` — DateTime с timezone
- `updated_at` — DateTime с timezone, auto-update

Тенантные модели содержат `company_id` (FK → companies.id).

**Ключевые связи:**
```
Company ──< Branch
Company ──< User
User    ──< UserRole ──> Role ──< RolePermission ──> Permission
Company ──< Category ──< Product ──< ModifierGroup ──< Modifier
Product ──< ProductBranch ──> Branch
Company ──< Order ──< OrderItem ──> Product
Order   ──< Payment
Order   ──< FiscalReceipt
Order   ──< DeliveryOrder ──> Courier
Company ──< Customer ──< CustomerNote
Customer──< LoyaltyAccount ──< LoyaltyTransaction
Company ──< Employee ──< WorkShift ──< AttendanceLog
Company ──< Printer ──< PrintJob
Company ──< Subscription ──> Plan ──< Invoice
```

### Аутентификация и авторизация

1. **Регистрация** → создаёт Company + User + Role(owner)
2. **Логин** → возвращает `access_token` (JWT, 15 мин) + `refresh_token` (30 дней)
3. **JWT payload**: `sub` (user_id), `company_id`, `jti`, `type`, `exp`
4. **Refresh** → ротация токенов (старый отзывается)
5. **RBAC**: `require_permission("module.action")` — проверка через UserRole → RolePermission → Permission

**Dependencies:**
- `get_current_user` — извлекает юзера из JWT
- `require_company_admin` — owner/admin/manager
- `require_superadmin` — суперадмин
- `require_permission(...)` — проверка конкретных прав

### Multi-tenancy

- `TenantMiddleware` извлекает `company_id` из JWT и кладёт в `request.state`
- `TenantRepository` автоматически фильтрует все запросы по `company_id`
- На уровне БД (Supabase) включен **Row Level Security** (скрипт `scripts/enable_rls.py`)

### API Endpoints

Все API под префиксом `/api/v1`. Список роутеров:

| Префикс                  | Модуль          | Основные методы                                          |
|---------------------------|-----------------|----------------------------------------------------------|
| `/auth`                   | auth            | POST register, login, refresh, logout; GET /me           |
| `/companies`              | companies       | GET/PATCH company; CRUD branches                         |
| `/rbac`                   | rbac            | CRUD roles, permissions; assign/revoke user roles        |
| `/inventory`              | inventory       | CRUD categories, products, ingredients; stock movements  |
| `/pos`                    | pos             | CRUD orders, order items; update status; terminals       |
| `/payments`               | payments        | POST create payment                                      |
| `/kitchen`                | kitchen         | CRUD stations; PATCH order item status                   |
| `/crm`                    | crm             | CRUD customers, notes; search                            |
| `/loyalty`                | loyalty         | GET account; POST earn/redeem points                     |
| `/delivery`               | delivery        | CRUD zones, couriers; create/assign delivery orders      |
| `/hr`                     | hr              | CRUD employees, shifts; POST attendance                  |
| `/analytics`              | analytics       | GET dashboard, sales report, top products                |
| `/notifications`          | notifications   | GET list/unread; POST create; PATCH read                 |
| `/audit`                  | audit           | GET logs                                                 |
| `/fiscal`                 | fiscal          | POST create receipt; GET list                            |
| `/subscriptions`          | subscriptions   | CRUD plans; create subscription; GET invoices            |
| `/printers`               | printers        | CRUD printers; print receipt/kitchen; test; pending jobs |
| `/health`                 | system          | GET health check                                         |

---

## Frontend (React)

### Страницы

| Страница             | Описание                                              | Статус       |
|----------------------|-------------------------------------------------------|--------------|
| `LoginPage`          | Экран входа                                           | ✅ Работает  |
| `OwnerDashboard`     | Дашборд владельца: статистика, заказы, графики        | ✅ Работает  |
| `WaiterPage`         | Интерфейс официанта: столы, заказы, создание          | ✅ Работает  |
| `KitchenPage`        | Кухонный экран: карточки заказов, таймеры              | ✅ Работает  |
| `StaffRolePage`      | Управление персоналом по ролям                        | ✅ Работает  |
| `AnalyticsPage`      | Аналитика (stub)                                      | 🟡 Заглушка  |
| `FinancePage`        | Финансы (stub)                                        | 🟡 Заглушка  |
| `OrdersPage`         | Заказы (stub)                                         | 🟡 Заглушка  |
| `MenuPage`           | Меню (stub)                                           | 🟡 Заглушка  |
| `StaffPage`          | Персонал (stub)                                       | 🟡 Заглушка  |
| `SectionPage`        | Универсальная страница раздела                        | 🟡 Шаблон    |
| `PlaceholderPage`    | Заглушка                                              | 🟡 Заглушка  |

### Маршрутизация

- `/login` — вход
- `/` — дашборд владельца (protected)
- `/waiter`, `/waiter/new`, `/waiter/order/:id`, `/waiter/orders` — интерфейс официанта
- `/kitchen` — кухонный экран
- `/warehouse/*` — склад (разделы заглушками)
- `/reports/*` — отчёты (разделы заглушками)
- `/users/*` — персонал по ролям
- `/settings/*` — настройки (заглушки)
- `/finance/*` — финансы (заглушки)
- `/nomenclature/*` — номенклатура
- `/store`, `/orders`, `/menu`, `/staff`, `/analytics` — общие

### API Client

Файл `src/api/client.js`:
- Axios instance с `baseURL = VITE_API_URL || http://127.0.0.1:8000/api/v1`
- Автоматическая подстановка `Authorization: Bearer <token>` из `localStorage`
- При 401 — автоматическая очистка токенов
- Функции: `login()`, `logout()`, `isAuthenticated()`, `formatMoney()`, `formatNumber()`

---

## Print Agent

Отдельный процесс (`print_agent/agent.py`), запускается на POS-терминале в локальной сети ресторана.

**Принцип работы:**
1. Polling API каждые 3 секунды
2. Получает список принтеров компании
3. Для каждого принтера запрашивает pending-задания
4. Декодирует payload (base64) и отправляет ESC/POS данные на принтер по TCP
5. Подтверждает выполнение задания через API

**Запуск:**
```bash
python agent.py --api https://your-server.com --token YOUR_JWT_TOKEN
```

---

## База данных

### Таблицы (35 шт.)

```
companies, branches,
users, refresh_tokens,
roles, permissions, role_permissions, user_roles,
categories, products, modifier_groups, modifiers, product_branch,
ingredients, warehouses, stock_items, stock_movements,
customers, customer_notes,
orders, order_items,
payments,
kitchen_stations,
loyalty_accounts, loyalty_transactions,
delivery_zones, couriers, delivery_orders,
employees, work_shifts, attendance_logs,
notifications,
audit_logs,
fiscal_receipts,
plans, subscriptions, invoices,
pos_terminals,
printers, print_jobs
```

### Миграции

Используется Alembic. Текущая единственная миграция (`20260604_initial_schema`) использует `Base.metadata.create_all()` — это нужно заменить на нормальные `op.create_table()` операции.

---

## Запуск проекта

### Backend

```bash
cd backend

# Создать виртуальное окружение
python -m venv .venv
source .venv/bin/activate

# Установить зависимости
pip install -r requirements.txt
# или
pip install -e .

# Настроить .env (см. секцию ниже)

# Применить миграции
alembic upgrade head

# Запустить сервер
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend

# Установить зависимости
npm install

# Создать .env (опционально)
echo "VITE_API_URL=http://127.0.0.1:8000/api/v1" > .env

# Запустить dev-сервер
npm run dev
```

---

## Переменные окружения

### Backend (`backend/.env`)

| Переменная         | Описание                                | По умолчанию                            |
|--------------------|-----------------------------------------|-----------------------------------------|
| `DATABASE_URL`     | Строка подключения к БД                 | `sqlite+aiosqlite:///./app.db`          |
| `DEBUG`            | Режим отладки                           | `false`                                 |
| `SECRET_KEY`       | Ключ для JWT                            | — (обязателен в production)             |
| `REDIS_URL`        | URL Redis                               | `redis://localhost:6379/0`              |

### Frontend

| Переменная     | Описание      | По умолчанию                             |
|----------------|---------------|------------------------------------------|
| `VITE_API_URL` | URL API       | `http://127.0.0.1:8000/api/v1`          |

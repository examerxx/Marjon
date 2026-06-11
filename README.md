# Marjon

> Облачная SaaS-платформа для автоматизации ресторанов (Узбекистан)

## О проекте

**Marjon** — комплексная система управления ресторанами, кафе и фаст-фудами. Покрывает полный цикл работы заведения: POS-касса, кухонный дисплей, склад, доставка, CRM, лояльность, HR, аналитика, фискализация, принтеры чеков.

## Стек

- **Backend:** FastAPI, Python 3.12+, SQLAlchemy 2.0 (async), Alembic, PostgreSQL (Supabase)
- **Frontend:** React 18+, Vite, React Router v6, Axios, Chart.js
- **Print Agent:** ESC/POS, polling-based, TCP

## Быстрый старт

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # настроить DATABASE_URL
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Структура

```
backend/
  app/
    modules/         # 17 бизнес-модулей
      analytics/     # Дашборд, отчёты
      audit/         # Журнал действий
      auth/          # JWT, регистрация, логин
      companies/     # Компании, филиалы
      crm/           # Клиенты, заметки
      delivery/      # Зоны, курьеры, доставка
      fiscal/        # Фискальные чеки (ОФД)
      hr/            # Сотрудники, смены
      inventory/     # Товары, категории, склад
      kitchen/       # Кухонные станции
      loyalty/       # Бонусная программа
      notifications/ # Уведомления
      payments/      # Платежи
      pos/           # Заказы, терминалы
      printers/      # ESC/POS принтеры
      rbac/          # Роли, права
      subscriptions/ # Тарифы, подписки
      # ── Главная админка (HQ admin panel) ──
      handbook/       # Гео-справочники: страны, регионы, районы
      organizations/  # Организации сети, статусы, аккаунты, offline-jobs
      departments/    # Отделы
      marketing/      # Лиды, статусы, теги, источники, статистика, импорт
      nomenclature/   # Продукты, категории, ед.изм., заказы
      storage/        # Склады, поставщики, поступления, остатки
      finance/        # Транзакции, контрагенты, оплаты, история сумм
      field_service/  # Сервисные сотрудники, услуги, техподдержка (devent)
      tasks/          # Задачи, очередь подтверждений, доска
      ratings/        # Рейтинг сотрудников (расчётный)
      admin_settings/ # Языки, переводы, фоны, версии Store, user-logs
      admin_reports/  # Отчёты: продукты, дебет/кредит, Excel-экспорт
    shared/          # Базовые классы
    infrastructure/  # БД, сессии
    middleware/      # Multi-tenancy
  print_agent/       # Агент печати

frontend/
  src/
    pages/           # 12 страниц
    components/      # Layout, Sidebar, Topbar
    api/             # Axios client
    styles/          # CSS
```

## Документация

Полная документация: [`DOCUMENTATION.md`](DOCUMENTATION.md)

Задачи по доработке: [`TASKS.md`](TASKS.md)

## API

Все эндпоинты под `/api/v1`. Swagger UI: `http://localhost:8000/docs`

## Лицензия

Проприетарный. Все права защищены.

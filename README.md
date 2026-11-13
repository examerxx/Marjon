# Marjon — Restaurant OS

> SaaS-платформа для автоматизации ресторанов, кафе и фаст-фуда в Узбекистане.
> POS-касса, кухонный экран, экран раздачи, гостевой ТВ, склад, финансы, CRM, HR,
> аналитика, фискализация и интеграции с Click / Payme / Uzum.

**Актуальное техническое задание:** [docs/tz/MARJON_TZ_v3.md](docs/tz/MARJON_TZ_v3.md) ([PDF](docs/tz/MARJON_TZ_v3.pdf)).
Документ описывает систему в том виде, в котором она реализована в коде.

**Новому разработчику начинать здесь:** [docs/ONBOARDING.md](docs/ONBOARDING.md).

---

## Каналы системы

| Канал | Кто пользуется | Где живёт |
|-------|----------------|-----------|
| Веб-панель владельца | владелец, менеджер | `admin.marjon.tech` — `frontend/` (`index.html`) |
| POS-десктоп | кассир, официант, курьер | Electron-приложение `desktop/` |
| Кухонный экран (KDS) | повара | `kitchen.marjon.tech` — `frontend/` (`kitchen.html`) |
| Экран раздачи (Expo) | менеджер раздачи | `admin.marjon.tech/expo` — `frontend/` (`expo.html`) |
| Гостевой ТВ | посетители | `admin.marjon.tech/tv` — `frontend/` (`tv.html`) |
| Мобильный клиент | персонал | Flutter-приложение `mobile/` |
| HQ-админка (SaaS) | супер-админ Marjon | `frontend/src/admin/` (`admin.html`, секретный путь) |
| Сайт и магазин | клиенты | `landing/`, страница `/store` в веб-панели |

---

## Стек

| Слой | Технологии |
|------|-----------|
| Бэкенд | Python 3.13, FastAPI, SQLAlchemy 2.0 (async), Alembic, Pydantic v2, JWT, slowapi |
| БД | PostgreSQL 16 (прод), SQLite (разработка) |
| Шина и кэш | Redis 7 (pub/sub для WebSocket кухни, печати и раздачи) |
| Файлы | MinIO-совместимое хранилище (прод), `backend/media` (dev) |
| Веб | React 18 (JSX, без TypeScript), Vite 5, React Router 6, Chart.js, i18next (ru/uz/en) |
| Десктоп | Electron 28 + React, NSIS-установщик и portable-сборка |
| Мобильный | Flutter (Android/iOS) |
| Платежи | Go-шлюзы Click / Payme / Uzum (`services/`) |
| Инфраструктура | Docker Compose, nginx, certbot |
| Тесты | pytest (136 файлов), vitest (147 файлов), Playwright, node-скрипты |

---

## Структура репозитория

```
backend/            FastAPI: 32 модуля, 100 миграций Alembic, print_agent, тесты
frontend/           React SPA: панель владельца, HQ-админка, KDS, Expo, ТВ
desktop/            Electron-касса (кассир, официант, курьер) + offline-очередь
mobile/             Flutter-клиент для персонала
owner/              Flutter-приложение владельца (в поставку не входит, не поддерживается)
landing/            Лендинг marjon.tech (ru/uz)
services/           Go-шлюзы Payme / Click / Uzum
nginx/              Конфиги nginx для прода
store-files/        manifest.json магазина десктопа (сами .exe в git не лежат)
docs/               ТЗ v3, документация, онбординг, ADR
docker-compose.yml  Прод-состав стека (db, redis, storage, backend, шлюзы, nginx)
DEPLOY.md           Порядок выката на прод
```

---

## Быстрый старт

Полная инструкция с нюансами Windows — [docs/ONBOARDING.md](docs/ONBOARDING.md).

### Бэкенд (SQLite, порт 8000)

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate; Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL="sqlite+aiosqlite:///./app.db" python devrun.py   # uvicorn на 127.0.0.1:8000
```

Swagger: http://localhost:8000/docs · Health: http://localhost:8000/health

Демо-данные: `python seed.py` (компания, филиалы, сотрудники, меню).
Скрипты отдельных логинов — в `backend/scripts/seed_*.py`.

### Веб-панель (порт 5173)

```bash
cd frontend
npm install
npm run dev
```

Dev-окружение ходит через прокси Vite на `localhost:8000` (`frontend/.env.development`),
прод-сборка берёт `https://api.marjon.tech` (`frontend/.env.production`).

### Десктоп (порт 5174)

```bash
cd desktop
npm install
npm run dev
```

### Мобильный клиент

```bash
cd mobile
flutter pub get
flutter run
```

---

## Проверки

```bash
# бэкенд — из backend/
pytest

# фронтенд — из frontend/: тесты + сборка + проверка CSS
npm run verify
npm run test:unit          # vitest
npm run test:architecture  # архитектурные ограничения
npm run test:browser       # Playwright

# десктоп — из desktop/: логика оплат
npm run test:payments
```

CI: `.github/workflows/smoke.yml` (pytest на SQLite + сборка фронтенда) и
`.github/workflows/desktop-size.yml` (размер Windows-сборки).

---

## Роли

`owner`, `manager`, `cashier`, `waiter`, `kitchen`, `monoblock`, `courier`, `warehouse`
плюс платформенные `superadmin` / `hq_admin`. Права — 40 разрешений RBAC,
у каждого сотрудника 16 персональных тумблеров. Матрица ролей — в ТЗ, глава 2.

---

## Документация

| Документ | О чём |
|----------|-------|
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | **Старт для нового программиста:** окружение, запуск, карта кода, процессы, деплой |
| [docs/tz/MARJON_TZ_v3.md](docs/tz/MARJON_TZ_v3.md) | **ТЗ v3.0 (as-built):** все каналы, процессы, данные, API, ограничения |
| [DEPLOY.md](DEPLOY.md) | Выкат на прод: бэкапы, миграции, статика, магазин |
| [docs/TESTING_WINDOWS.md](docs/TESTING_WINDOWS.md) | Запуск и ручное тестирование на Windows |
| [docs/STYLEGUIDE.md](docs/STYLEGUIDE.md) | Дизайн-система и токены |
| [docs/web-api-contract-v1.md](docs/web-api-contract-v1.md) | Замороженный контракт Web API (исторический) |
| [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md) | Ранняя техдока (историческая) |
| [CLAUDE.md](CLAUDE.md) | Правила работы AI-агентов с репозиторием |
| [TASKS.md](TASKS.md) | Исторический бэклог задач |
| [docs/README.md](docs/README.md) | Индекс документации: что актуально, что историческое |

---

## Правила работы

- Прод — только по явной просьбе владельца. Никаких деплоев «заодно».
- Секреты (пароли SSH, токены, ключи) не попадают в git, в URL и в командную строку.
- `docker compose down -v` не выполняется никогда — уничтожает тома с БД.
- Миграции не редактируются после применения: новая ревизия Alembic.
- Веб-код — JavaScript/JSX, не TypeScript; цвета и радиусы — только через токены.

---

## Лицензия

Проприетарный продукт. Все права защищены.

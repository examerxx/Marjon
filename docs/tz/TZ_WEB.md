> **Устарело.** Актуальная редакция — [MARJON_TZ_v3.md](./MARJON_TZ_v3.md) от 13.11.2026. Документ сохранён как исторический.

# MARJON — ТЗ: Web Admin Panel

> **Платформа:** Web (React SPA)  
> **Версия:** 1.0  
> **Дата:** 08.07.2026  
> **Ссылка на общее ТЗ:** [TZ_GENERAL.md](./TZ_GENERAL.md)

---

## 1. Общая информация

### 1.1. Назначение

Web Admin Panel — основная панель управления заведением. Используется владельцем, менеджером, кассиром и бухгалтером для полного управления рестораном: от приёма заказов до финансовой отчётности.

### 1.2. Технологический стек

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| Framework | React | 18+ |
| Bundler | Vite | 5+ |
| Router | React Router | v6 |
| HTTP Client | Axios | via `api/client.js` |
| Charts | Chart.js | 4+ |
| Styling | Vanilla CSS | ~45K строк |
| Design Tokens | `marjon-tokens.css` | Кастомная палитра |
| Icons | Bootstrap Icons | SVG sprite |
| Language | JSX (не TypeScript) | — |
| Build | Multi-page (kafe + admin) | Vite config |

### 1.3. Браузерная совместимость

| Браузер | Минимальная версия |
|---------|-------------------|
| Chrome / Edge (Chromium) | 90+ |
| Safari | 15+ |
| Firefox | 90+ |
| Opera | 76+ |
| Mobile Chrome (Android) | 90+ |
| Mobile Safari (iOS) | 15+ |

### 1.4. Breakpoints (адаптивность)

| Breakpoint | Устройство | Особенности layout |
|-----------|------------|-------------------|
| ≤ 768px | Телефон | Мобильный вид, compact |
| ≤ 1024px | Планшет | Sidebar скрыт → bottom-nav, topbar 54px |
| 1025–1440px | Ноутбук | Compact topbar 64px |
| > 1440px | Десктоп | Полный topbar 86px |

---

## 2. Архитектура фронтенда

### 2.1. Структура файлов

```
frontend/
├── src/
│   ├── api/
│   │   └── client.js          # Axios instance, interceptors, formatMoney()
│   ├── components/
│   │   ├── DashboardLayout.jsx # Shell: sidebar + topbar + content
│   │   ├── Sidebar.jsx         # Навигация (desktop + mobile drawer)
│   │   ├── Topbar.jsx          # Верхняя панель (дата, баланс, уведомления)
│   │   ├── SupportWidget.jsx   # Виджет поддержки (плавающий)
│   │   ├── DemoNotice.jsx      # Баннер "Демо-данные"
│   │   ├── Icon.jsx            # SVG-иконки обёртка
│   │   ├── DatePicker.jsx      # Выбор даты
│   │   ├── ReportDateRangePicker.jsx
│   │   ├── GlobalSearch.jsx    # Глобальный поиск
│   │   ├── Loader.jsx          # Spinner / skeleton
│   │   ├── DataTableView.jsx   # Таблица данных
│   │   ├── BackButton.jsx      # Кнопка "Назад"
│   │   └── receipt/            # Компоненты настройки чеков
│   ├── pages/
│   │   ├── auth/
│   │   │   └── LoginPage.jsx
│   │   ├── settings/           # 11 страниц настроек
│   │   ├── OwnerDashboard.jsx  # Главный дашборд
│   │   ├── OrdersPage.jsx      # POS: заказы
│   │   ├── KitchenPage.jsx     # Кухонный экран (web)
│   │   ├── WaiterPage.jsx      # Экран официанта (web)
│   │   ├── MenuPage.jsx        # Управление меню
│   │   ├── CategoriesPage.jsx  # Категории блюд
│   │   ├── NomenclaturePage.jsx # Номенклатура
│   │   ├── WarehousePage.jsx   # Склад (8 разделов)
│   │   ├── FinancePage.jsx     # Финансы
│   │   ├── StaffPage.jsx       # Персонал
│   │   ├── *ReportPage.jsx     # 7 типов отчётов
│   │   └── ...
│   ├── styles/
│   │   ├── react-overrides.css # Основной файл стилей (~22K строк)
│   │   ├── marjon-tokens.css   # Дизайн-токены (цвета, тени, отступы)
│   │   └── ...
│   └── utils/
│       └── date.js             # Хелперы для дат
├── index.html                  # Entry: кафе (POS)
├── admin.html                  # Entry: админка
└── vite.config.js              # Multi-page build config
```

### 2.2. Паттерн данных (API + Demo Fallback)

Все страницы следуют единому паттерну:

```jsx
const [rows, setRows] = useState(HARDCODED_DATA);
const [isDemo, setIsDemo] = useState(true);

useEffect(() => {
  api.get("/endpoint")
    .then(({ data }) => {
      const items = Array.isArray(data) ? data : data?.items || [];
      if (items.length) {
        setRows(items.map(mapApiRow));
        setIsDemo(false);
      }
    })
    .catch(() => {});
}, []);

return (
  <div>
    {isDemo && <DemoNotice />}
    {/* таблица/данные */}
  </div>
);
```

**Преимущества:**
- Фронтенд работает ВСЕГДА, даже без бэкенда
- Демо-данные позволяют тестировать UI
- Плавный переход к реальным данным

### 2.3. API Client

```js
// src/api/client.js
import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1",
  headers: { "Content-Type": "application/json" },
});

// JWT interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Refresh token interceptor
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // refresh logic
    }
    return Promise.reject(error);
  }
);

export function formatMoney(value, currency = "UZS") {
  return `${Number(value || 0).toLocaleString("ru-RU")} ${currency}`;
}
```

---

## 3. Страницы и экраны

### 3.1. Авторизация

**Файл:** `pages/LoginPage.jsx`

| Элемент | Описание |
|---------|----------|
| Вход | Телефон + пароль |
| Регистрация | НЕТ (только по инвайту владельца) |
| PIN-код | Позже (v1.1) |
| Remember me | Сохранение сессии в localStorage |
| JWT | access_token (15 мин) + refresh_token (7 дней) |

### 3.2. Дашборд владельца

**Файл:** `pages/OwnerDashboard.jsx` (1025 строк)

**Карточки KPI:**
- Общая выручка (UZS)
- Количество заказов
- Средний чек
- Рейтинг заведения

**Графики:**
- Выручка по часам (линейный)
- Топ-5 блюд (горизонтальный бар)
- Распределение типов заказов (pie)
- Тренд за 7/30 дней

**Фильтры:**
- Период (сегодня / неделя / месяц / произвольный)
- Филиал (если мультифилиал)

**API:** `GET /analytics/dashboard?period=today&branch_id=1`

### 3.3. POS — Заказы

**Файл:** `pages/OrdersPage.jsx`

**Функции:**
- Список активных заказов (карточки)
- Создание нового заказа
- Выбор типа: В зале / Навынос / Доставка
- Привязка к столу
- Добавление блюд из меню
- Модификаторы (размер, добавки)
- Комментарий к заказу
- Скидка (%, фиксированная)
- Оплата (наличные / карта / Click / Payme / Uzum / смешанная)
- Печать чека (через Print Agent)
- Отмена заказа (с указанием причины)

**Статусы заказа:**
```
Новый → Принят → Готовится → Готов → Оплачен → Закрыт
                                   → Отменён
```

### 3.4. Кухонный экран (Web)

**Файл:** `pages/KitchenPage.jsx`

Веб-версия KDS для просмотра в браузере на кухне.

**Отображение:**
- Карточки заказов в виде канбан-доски
- Таймер на каждом заказе (зелёный → жёлтый → красный)
- Группировка по станциям (горячий цех, холодный цех, бар)
- Кнопка «Готово» на каждом блюде
- Звуковой сигнал при новом заказе

**API:** WebSocket `/ws/kitchen`

### 3.5. Экран официанта (Web)

**Файл:** `pages/WaiterPage.jsx`

Упрощённый экран для официанта с акцентом на скорость.

**Функции:**
- Карта столов (визуальная)
- Быстрое создание заказа
- Статус заказа в реальном времени
- Уведомления о готовности блюд

### 3.6. Меню и категории

**Файлы:** `pages/MenuPage.jsx`, `pages/CategoriesPage.jsx`, `pages/SectionPage.jsx`

**Функции:**
- Древовидная структура категорий
- Drag&drop для сортировки
- Карточки блюд с фото
- Быстрое редактирование цены
- Стоп-лист (вкл/выкл по блюду)

### 3.7. Номенклатура

**Файл:** `pages/NomenclaturePage.jsx` (585 строк, 2 режима)

**Режим «Блюда» (DishesCatalogPage):**
- Таблица блюд с фильтрами
- Создание/редактирование блюда
- Фото, цена, категория, состав
- Техкарта (ингредиенты + выход)
- Статистика по продажам

**Режим «Ингредиенты» (SimpleNomenclaturePage):**
- Таблица ингредиентов
- Единицы измерения
- Текущий остаток
- Минимальный остаток

**API:** 
- `GET/POST/PATCH/DELETE /inventory/products`
- `GET/POST/PATCH/DELETE /inventory/ingredients`

### 3.8. Склад

**Файл:** `pages/WarehousePage.jsx` (565 строк, 8 разделов)

| Раздел | API Endpoint | Описание |
|--------|-------------|----------|
| Приход | `/warehouse/income` | Оприходование от поставщика |
| Расход | `/warehouse/expense` | Списание ингредиентов |
| Перемещение | `/warehouse/transfer` | Между складами |
| Инвентаризация | `/warehouse/inventory` | Сверка остатков |
| Остатки | `/warehouse/stock` | Текущие остатки |
| Поставщики | `/warehouse/suppliers` | Справочник поставщиков |
| Возвраты | `/warehouse/returns` | Возврат поставщику |
| Списание | `/warehouse/writeoff` | Списание (порча, истечение срока) |

### 3.9. Финансы

**Файлы:** `pages/FinancePage.jsx`, `FinanceTransactionsPage.jsx`, `Finance*CategoriesPage.jsx`

**Функции:**
- Баланс (доход / расход / прибыль)
- Транзакции с фильтрами
- Категории доходов и расходов
- Ручной ввод транзакций
- Графики за период

### 3.10. Отчёты (7 типов)

| Отчёт | Файл | API |
|-------|------|-----|
| Z-отчёт | ZReportPage.jsx | `/reports/z-report` |
| По заказам | OrdersReportPage.jsx | `/reports/orders` |
| По официантам | WaitersReportPage.jsx | `/reports/waiters` |
| По блюдам | DishesReportPage.jsx | `/reports/dishes` |
| По столам | TablesReportPage.jsx | `/reports/tables` |
| Отменённые | CancelledDishesReportPage.jsx | `/reports/cancelled` |
| Дебиторы/Кредиторы | DebtorsCreditorsReportPage.jsx | `/reports/debt-credit` |

**Общие элементы:**
- Фильтр по дате (DatePicker / ReportDateRangePicker)
- Экспорт в Excel/PDF (v1.1)
- Переключение UZS/USD
- Поиск по таблице
- DemoNotice при отсутствии реальных данных

### 3.11. HR — Персонал

**Файлы:** `pages/StaffPage.jsx`, `StaffRolePage.jsx`, `StaffActivityPage.jsx`

**Функции:**
- Список сотрудников (фото, ФИО, роль, телефон, статус)
- Создание/редактирование сотрудника
- Назначение роли (RBAC)
- Активность по сменам (приход/уход)
- Фильтр по роли, статусу

### 3.12. Настройки (11 страниц)

Все построены на универсальном компоненте `SettingsResourcePage`:

| Страница | Описание | API Endpoint |
|----------|----------|-------------|
| Заведения | Филиалы, адреса, режим работы | `/settings/places` |
| Способы оплаты | Наличные, карта, Click, Payme... | `/settings/payment-methods` |
| Принтеры | ESC/POS принтеры, IP, порт | `/printers` |
| Единицы | кг, л, шт, порция... | `/settings/units` |
| Клиенты | CRM, контрагенты, балансы | `/crm/counterparties` |
| Чек (гостевой) | Шаблон гостевого чека | — |
| Чек (кухонный) | Шаблон кухонного тикета | — |
| Профиль | Данные компании, логотип | `/companies/profile` |
| Рецепт чека | Визуальный редактор чека | — |
| Чек шеф-повара | Настройка чека для шеф-повара | — |
| Профиль настройки | Личные настройки пользователя | `/auth/profile` |

### 3.13. Аналитика

**Файл:** `pages/AnalyticsPage.jsx`

Расширенная аналитика (v1.1):
- ABC-анализ блюд
- Тепловая карта посещений (по часам/дням)
- Сравнение периодов
- Food cost мониторинг
- Воронка заказов

### 3.14. Поддержка

**Компонент:** `components/SupportWidget.jsx`

Плавающий виджет в правом нижнем углу:
- Форма: телефон + сообщение
- Выбор страны (10 стран, коды)
- API: `POST /support/tickets`
- Состояние: отправка → успех → новая заявка

---

## 4. Компоненты UI

### 4.1. Layout (DashboardLayout)

```
┌──────────────────────────────────────────────────┐
│ DashboardShell (flex: row)                       │
│ ┌──────────┐ ┌──────────────────────────────────┐│
│ │ Sidebar  │ │ DashboardMain                    ││
│ │ 260px    │ │ ┌────────────────────────────────┐││
│ │          │ │ │ Topbar (datepicker, balance)   │││
│ │ Навигация│ │ ├────────────────────────────────┤││
│ │          │ │ │ Content (Outlet)               │││
│ │          │ │ │                                │││
│ │          │ │ │                                │││
│ └──────────┘ │ └────────────────────────────────┘││
│              └──────────────────────────────────┘│
│ [Mobile: bottom-nav bar, 54px]                   │
└──────────────────────────────────────────────────┘
```

### 4.2. Sidebar

**Секции навигации:**

| Секция | Пункты |
|--------|--------|
| Основное | Дашборд, POS-Заказы, Кухня, Официант |
| Меню | Блюда, Категории, Секции |
| Управление | Финансы, Склад, Номенклатура, Персонал |
| Отчёты | Z-отчёт, По заказам, Официанты, Блюда, Столы, Отменённые, Дебиторы |
| Аналитика | Аналитика |
| Настройки | Настройки (11 подпунктов) |

**Мобильная навигация (≤1024px):**
- Bottom bar: 4 пункта + «Ещё»
- Drawer с полным списком при нажатии «Ещё»

### 4.3. Topbar

| Элемент | Описание |
|---------|----------|
| DatePicker | Выбор текущей даты |
| Rate Widget | Курс валют (UZS/USD) |
| Notification Badge | Количество непрочитанных |
| Balance Pill | Баланс подписки (API: `/billing/balance`) |
| Profile Avatar | Аватар + dropdown меню |

### 4.4. Переиспользуемые компоненты

| Компонент | Файл | Описание |
|-----------|------|----------|
| DemoNotice | `DemoNotice.jsx` | Жёлтый баннер «Демо-данные» |
| Icon | `Icon.jsx` | SVG-иконка по имени |
| DatePicker | `DatePicker.jsx` | Поле выбора даты |
| ReportDateRangePicker | `ReportDateRangePicker.jsx` | Диапазон дат для отчётов |
| Loader | `Loader.jsx` | Спиннер / скелетон |
| DataTableView | `DataTableView.jsx` | Универсальная таблица |
| GlobalSearch | `GlobalSearch.jsx` | Ctrl+K поиск по всему |
| BackButton | `BackButton.jsx` | Навигация «Назад» |
| SettingsResourcePage | `settings/SettingsResourcePage.jsx` | Универсальный CRUD-компонент |

---

## 5. Дизайн-система

### 5.1. Цветовые токены

Все цвета определены в `marjon-tokens.css`:

| Токен | HEX | Назначение |
|-------|-----|-----------|
| `--color-brand` | `#1db5b5` | CTA-кнопки, активные элементы, акценты |
| `--color-brand-hover` | `#22d3ee` | Hover-состояние |
| `--color-brand-dark` | `#0fa3a3` | Active/pressed |
| `--neutral-950` | `#071428` | Самый тёмный фон (sidebar, bottom nav) |
| `--neutral-900` | `#0b1f3f` | Тёмные панели |
| `--neutral-50` / `--color-bg` | `#f4f7fc` | Фон страницы |
| `--neutral-0` / `--color-card` | `#ffffff` | Фон карточек |
| `--color-interactive` | `#2563eb` | Ссылки (ТОЛЬКО ссылки) |

### 5.2. Типографика

| Элемент | Размер | Вес |
|---------|--------|-----|
| H1 (заголовок страницы) | 24px | 700 |
| H2 (секция) | 20px | 600 |
| Body | 14px | 400 |
| Small / Caption | 12px | 400 |
| Badge | 11px | 500 |

### 5.3. Компоненты

| Компонент | Стиль |
|-----------|-------|
| Кнопка Primary | bg: `--color-brand`, text: white, radius: 8px |
| Кнопка Secondary | bg: transparent, border: 1px, radius: 8px |
| Input | bg: white, border: 1px `--neutral-200`, radius: 8px, h: 40px |
| Card | bg: white, shadow: `--shadow-sm`, radius: 12px |
| Table | Alternating rows, header bg: `--neutral-50` |
| Badge Status | Зелёный (#активно), Жёлтый (#не подтверждено), Серый (#не активно) |

---

## 6. Маршрутизация

```jsx
// React Router v6
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route element={<DashboardLayout />}>
    <Route index element={<OwnerDashboard />} />
    <Route path="orders" element={<OrdersPage />} />
    <Route path="kitchen" element={<KitchenPage />} />
    <Route path="waiter" element={<WaiterPage />} />
    <Route path="menu" element={<MenuPage />} />
    <Route path="categories" element={<CategoriesPage />} />
    <Route path="sections" element={<SectionPage />} />
    <Route path="nomenclature" element={<NomenclaturePage />} />
    <Route path="warehouse" element={<WarehousePage />} />
    <Route path="finance" element={<FinancePage />} />
    <Route path="finance/transactions" element={<FinanceTransactionsPage />} />
    <Route path="staff" element={<StaffPage />} />
    <Route path="staff/roles" element={<StaffRolePage />} />
    <Route path="reports/*" element={/* 7 типов */} />
    <Route path="analytics" element={<AnalyticsPage />} />
    <Route path="settings/*" element={/* 11 подстраниц */} />
    <Route path="profile" element={<ProfileSettingsPage />} />
  </Route>
</Routes>
```

---

## 7. Оставшиеся задачи до MVP

### 7.1. Фронтенд (завершить)

| Задача | Статус | Приоритет |
|--------|--------|-----------|
| API-интеграция всех страниц | ✅ Готово (demo fallback) | — |
| Подключение real-time баланса (Topbar) | ✅ Готово | — |
| DemoNotice во всех страницах | ✅ Готово | — |
| SupportWidget API | ✅ Готово | — |
| Полная API-интеграция (когда бэкенд готов) | ⏳ Ждёт бэкенд | Высокий |
| Локализация UZ (узбекский) | ❌ Не начато | Средний |
| Экспорт отчётов Excel/PDF | ❌ Не начато | Средний |
| Тёмная тема | ❌ Не планируется в MVP | Низкий |

### 7.2. Зависимости от бэкенда

| API | Текущий статус фронта | Ждёт от бэка |
|-----|----------------------|-------------|
| `/auth/login` | ✅ Работает | — |
| `/analytics/dashboard` | ✅ Fallback | Стабильный ответ |
| `/pos/orders` | ⚙️ Частично | CRUD + статусы |
| `/inventory/*` | ✅ Fallback | CRUD |
| `/warehouse/*` | ✅ Fallback | 8 эндпоинтов |
| `/reports/*` | ✅ Fallback | 7 эндпоинтов с фильтрами |
| `/settings/*` | ✅ Fallback | CRUD |
| `/billing/balance` | ✅ Fallback | Текущий баланс |
| `/support/tickets` | ✅ POST | Создание тикета |
| `/ws/kitchen` | ⚙️ Частично | WebSocket |

---

## 8. Сборка и деплой

### 8.1. Локальная разработка

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

### 8.2. Production сборка

```bash
npm run build        # → dist/
```

Vite config (multi-page):
```js
build: {
  rollupOptions: {
    input: {
      kafe: resolve(__dirname, "index.html"),
      admin: resolve(__dirname, "admin.html"),
    },
  },
}
```

### 8.3. Деплой

- **Hosting:** Render.com (Static Site) или Vercel
- **CDN:** Cloudflare
- **CI/CD:** GitHub Actions → auto-deploy on push to `main`
- **Env:** `VITE_API_URL` — URL бэкенда

---

## 9. Тестирование

### 9.1. Ручное тестирование (MVP)

| Сценарий | Что проверяем |
|----------|--------------|
| Без бэкенда | Все страницы показывают DemoNotice + демо-данные |
| С бэкендом | Реальные данные загружаются, DemoNotice исчезает |
| Mobile (390px) | Bottom-nav, compact topbar, все таблицы скроллятся |
| Tablet (768px) | Sidebar скрыт, layout корректный |
| Desktop (1280px+) | Полный layout, sidebar виден |
| Авторизация | Логин, refresh token, logout |
| CRUD | Создание, редактирование, удаление во всех настройках |
| Отчёты | Фильтры, даты, UZS/USD переключение |

### 9.2. Автотесты (v1.1)

- Unit-тесты для утилит (`formatMoney`, `todayInputValue`)
- Компонентные тесты для критичных UI-элементов
- E2E тесты (Playwright) для ключевых user flows

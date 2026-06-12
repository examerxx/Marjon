import { useEffect, useMemo, useState } from "react";
import logo from "../assets/marjon-logo.svg";
import { adminApi, adminLogin, adminLogout, isAdminAuthenticated } from "./api";

const navItems = [
  { key: "dashboard", label: "Дашборд", icon: "bi-grid-1x2-fill" },
  { key: "organizations", label: "Организации", icon: "bi-buildings" },
  { key: "branches", label: "Филиал", icon: "bi-diagram-3" },
  { key: "departments", label: "Отделы", icon: "bi-collection" },
  { key: "reports", label: "Отчеты", icon: "bi-file-earmark-bar-graph" },
  { key: "storage", label: "Склад", icon: "bi-box-seam" },
  { key: "nomenclature", label: "Номенклатура", icon: "bi-boxes" },
  { key: "marketing", label: "Маркетинг", icon: "bi-megaphone" },
  { key: "handbook", label: "Справочники", icon: "bi-journal-bookmark" },
  { key: "service", label: "Услуга", icon: "bi-headset" },
  { key: "hamkorbank", label: "Хамкорбанк", icon: "bi-bank" },
  { key: "finance", label: "Финансы", icon: "bi-wallet2" },
  { key: "tasks", label: "Задачи", icon: "bi-kanban", badge: "12" },
  { key: "rating", label: "Рейтинг", icon: "bi-star" },
  { key: "settings", label: "Настройки", icon: "bi-gear" },
];

const kpis = [
  {
    title: "Всего организаций",
    value: "1 248",
    delta: "+12 / +2.1% за месяц",
    icon: "bi-buildings",
    tone: "blue",
    points: [16, 22, 18, 34, 30, 46, 42, 56],
  },
  {
    title: "Активных филиалов",
    value: "2 987",
    delta: "+84 / +2.9% за месяц",
    icon: "bi-diagram-3",
    tone: "green",
    points: [18, 24, 32, 28, 42, 48, 51, 60],
  },
  {
    title: "Ожидают одобрения",
    value: "37",
    delta: "-6 / -13.9% за месяц",
    icon: "bi-inbox",
    tone: "violet",
    points: [58, 48, 52, 42, 39, 35, 30, 26],
  },
  {
    title: "Оборот за месяц",
    value: "78 452 340 UZS",
    delta: "+18.6% к прошлому месяцу",
    icon: "bi-graph-up-arrow",
    tone: "orange",
    points: [20, 26, 31, 44, 40, 55, 63, 72],
  },
  {
    title: "Платежи и банк",
    value: "Все системы работают",
    delta: "Uptime 99.98%",
    icon: "bi-shield-check",
    tone: "cyan",
    radar: true,
  },
];

const organizationRows = [
  ["Bella Italia Group", "Ресторанный холдинг", "12", "И. Каримов", "11.06.2026 11:42", "Активна"],
  ["Coffee House", "Ресторан", "3", "О. Ташматов", "11.06.2026 10:35", "Активна"],
  ["Sushi Master", "Кафе", "7", "Д. Юнусов", "11.06.2026 09:18", "На модерации"],
  ["Family Kitchen", "Общепит", "2", "С. Абдуллаев", "11.06.2026 08:05", "Активна"],
  ["Burger Station", "Фастфуд", "5", "А. Рахимов", "10.06.2026 23:47", "Новый"],
];

const approvalItems = [
  ["Bella Italia Group", "Новая организация", "10 мин назад", "Одобрить"],
  ["Coffee House", "Новый филиал", "32 мин назад", "Одобрить"],
  ["Sushi Master", "Изменение тарифного плана", "1 ч назад", "Рассмотреть"],
  ["Family Kitchen", "Подключение услуги", "2 ч назад", "Одобрить"],
  ["Burger Station", "Запрос на скидку", "3 ч назад", "Рассмотреть"],
];

const alertItems = [
  ["warning", "Высокая нагрузка на сервер API"],
  ["warning", "Истекает лицензия у 3 организаций"],
  ["success", "Резервное копирование завершено"],
  ["info", "Обновление платформы доступно"],
  ["info", "Новые фичи в модуле “Маркетинг”"],
];

const systemItems = [
  ["API Gateway", "Работает"],
  ["База данных", "Работает"],
  ["Платежи", "Работают"],
  ["Хамкорбанк", "Работает"],
  ["Очереди", "Работают"],
];

const categoryContent = {
  organizations: {
    title: "Организации",
    text: "Управление клиентами MARJON, статусами подключения, модерацией и блокировкой.",
    columns: ["Организация", "Тип", "Филиалов", "Админ", "Статус"],
    rows: organizationRows.map(([name, type, branches, admin, , status]) => [name, type, branches, admin, status]),
  },
  branches: {
    title: "Филиал",
    text: "Контроль филиалов, касс, адресов и состояния ресторанных точек.",
    columns: ["Филиал", "Организация", "Город", "Касса", "Статус"],
    rows: [
      ["Ташкент филиал", "Bella Italia Group", "Ташкент", "Активна", "Активна"],
      ["Хоразм филиал", "Coffee House", "Ургенч", "Активна", "Активна"],
      ["Денов филиал", "Sushi Master", "Денов", "Проверка", "На модерации"],
    ],
  },
  departments: {
    title: "Отделы",
    text: "Внутренние отделы платформы: поддержка, продажи, финансы и внедрение.",
    columns: ["Отдел", "Сотрудников", "Руководитель", "SLA", "Статус"],
    rows: [
      ["Поддержка", "8", "Александр П.", "15 мин", "Активна"],
      ["Продажи", "5", "М. Саидов", "1 день", "Активна"],
      ["Внедрение", "4", "Д. Юнусов", "2 дня", "Активна"],
    ],
  },
  reports: {
    title: "Отчеты",
    text: "Платформенная аналитика по организациям, обороту, филиалам и оплатам.",
    columns: ["Отчет", "Период", "Обновлен", "Формат", "Статус"],
    rows: [
      ["Оборот платформы", "Месяц", "11.06.2026", "Dashboard", "Активна"],
      ["Долги клиентов", "Неделя", "11.06.2026", "Excel", "Активна"],
      ["Подключения", "День", "11.06.2026", "PDF", "Новый"],
    ],
  },
  storage: {
    title: "Склад",
    text: "Обзор складских интеграций организаций и проблем синхронизации.",
    columns: ["Организация", "Складов", "Остаток", "Синхронизация", "Статус"],
    rows: [
      ["Bella Italia Group", "14", "734 764 000 UZS", "2 мин назад", "Активна"],
      ["Coffee House", "4", "82 420 000 UZS", "5 мин назад", "Активна"],
      ["Sushi Master", "8", "196 780 000 UZS", "Проверка", "На модерации"],
    ],
  },
  nomenclature: {
    title: "Номенклатура",
    text: "Глобальный контроль продуктов, категорий, единиц и импортов.",
    columns: ["Раздел", "Позиций", "Импортов", "Ошибок", "Статус"],
    rows: [
      ["Блюда", "18 402", "28", "0", "Активна"],
      ["Сырье", "42 881", "91", "3", "Новый"],
      ["Единицы", "128", "4", "0", "Активна"],
    ],
  },
  marketing: {
    title: "Маркетинг",
    text: "Лиды, источники, теги, статусы и конверсия подключений.",
    columns: ["Источник", "Лидов", "Конверсия", "Ответственный", "Статус"],
    rows: [
      ["Instagram", "184", "18.4%", "О. Ташматов", "Активна"],
      ["Telegram", "96", "21.8%", "С. Абдуллаев", "Активна"],
      ["Рекомендации", "43", "32.2%", "А. Рахимов", "Новый"],
    ],
  },
  handbook: {
    title: "Справочники",
    text: "Страны, регионы, районы, статусы и платформенные словари.",
    columns: ["Справочник", "Записей", "Последнее изменение", "Язык", "Статус"],
    rows: [
      ["Регионы", "14", "11.06.2026", "RU / UZ", "Активна"],
      ["Районы", "208", "10.06.2026", "RU / UZ", "Активна"],
      ["Статусы", "12", "09.06.2026", "RU", "Активна"],
    ],
  },
  service: {
    title: "Услуга",
    text: "Подключаемые сервисы, техпомощь, интеграции и заявки клиентов.",
    columns: ["Услуга", "Клиентов", "Цена", "Поддержка", "Статус"],
    rows: [
      ["QR-меню", "892", "В тарифе", "24/7", "Активна"],
      ["Фискализация", "421", "Отдельно", "24/7", "Активна"],
      ["Внедрение", "76", "Индивидуально", "Бизнес часы", "Новый"],
    ],
  },
  hamkorbank: {
    title: "Хамкорбанк",
    text: "Банковские транзакции, статусы интеграций и сверка платежей.",
    columns: ["Канал", "Операций", "Сумма", "Сверка", "Статус"],
    rows: [
      ["Эквайринг", "2 841", "4 820 000 000 UZS", "ОК", "Активна"],
      ["Выписки", "418", "1 240 000 000 UZS", "ОК", "Активна"],
      ["Ошибки", "3", "0 UZS", "Проверка", "На модерации"],
    ],
  },
  finance: {
    title: "Финансы",
    text: "Оборот, долги, тарифы, платежи и финансовая история платформы.",
    columns: ["Показатель", "Значение", "Динамика", "Период", "Статус"],
    rows: [
      ["Оборот", "78 452 340 UZS", "+18.6%", "Месяц", "Активна"],
      ["Долги", "12 800 000 UZS", "-4.2%", "Месяц", "На модерации"],
      ["Платежи", "1 284", "+9.1%", "Неделя", "Активна"],
    ],
  },
  tasks: {
    title: "Задачи",
    text: "Рабочая доска команды MARJON: внедрение, поддержка, продажи и проверки.",
    columns: ["Задача", "Ответственный", "Приоритет", "Срок", "Статус"],
    rows: [
      ["Проверить Bella Italia", "Александр П.", "Высокий", "Сегодня", "Новый"],
      ["Сверка оплат", "Финансы", "Средний", "12.06.2026", "Активна"],
      ["Обновить маркетинг", "Product", "Низкий", "14.06.2026", "На модерации"],
    ],
  },
  rating: {
    title: "Рейтинг",
    text: "Рейтинг сотрудников, организаций, филиалов и качества обслуживания.",
    columns: ["Объект", "Рейтинг", "Отзывы", "Изменение", "Статус"],
    rows: [
      ["Bella Italia Group", "4.9", "1 284", "+0.2", "Активна"],
      ["Coffee House", "4.7", "814", "+0.1", "Активна"],
      ["Sushi Master", "4.4", "406", "-0.1", "На модерации"],
    ],
  },
  settings: {
    title: "Настройки",
    text: "Глобальные параметры платформы, безопасность, языки и системные правила.",
    columns: ["Параметр", "Значение", "Область", "Обновлен", "Статус"],
    rows: [
      ["Языки", "RU / UZ", "Платформа", "11.06.2026", "Активна"],
      ["Автоблокировка", "Включена", "Биллинг", "10.06.2026", "Активна"],
      ["Уведомления", "Telegram / Email", "Система", "09.06.2026", "Новый"],
    ],
  },
};

function sparklinePath(points, width = 120, height = 38) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  return points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point - min) / range) * height;
    return `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function LoginView({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await adminLogin(email, password);
      onLogin();
    } catch {
      setError("Не удалось войти в Marjon Admin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-login">
      <form className="admin-login__panel" onSubmit={submit}>
        <img src={logo} alt="MARJON" />
        <h1>Marjon Admin</h1>
        <p>Вход для команды MARJON.</p>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required />
        </label>
        <label>
          Пароль
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
        </label>
        {error ? <div className="admin-login__error">{error}</div> : null}
        <button type="submit" disabled={loading}>{loading ? "Входим..." : "Войти"}</button>
      </form>
    </main>
  );
}

function Sidebar({ active, onSelect }) {
  return (
    <aside className="admin-sidebar">
      <div className="admin-brand">
        <img src={logo} alt="MARJON" />
        <div>
          <strong>MARJON</strong>
          <span>ADMIN</span>
        </div>
      </div>
      <nav className="admin-nav" aria-label="Admin navigation">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={active === item.key ? "is-active" : ""}
            onClick={() => onSelect(item.key)}
          >
            <i className={`bi ${item.icon}`} />
            <span>{item.label}</span>
            {item.badge ? <em>{item.badge}</em> : null}
          </button>
        ))}
      </nav>
      <button className="admin-collapse" type="button">
        <i className="bi bi-layout-sidebar-inset" />
        <span>Свернуть меню</span>
      </button>
    </aside>
  );
}

function Header({ user, onLogout }) {
  return (
    <header className="admin-header">
      <div>
        <h1>Панель администратора</h1>
        <p>Централизованное управление платформой MARJON</p>
      </div>
      <div className="admin-header__actions">
        <label className="admin-search">
          <i className="bi bi-search" />
          <input placeholder="Поиск по платформе..." />
        </label>
        <button className="admin-date" type="button">
          <i className="bi bi-calendar3" />
          11.06.2026 - 11.06.2026
        </button>
        <button className="admin-bell" type="button" aria-label="Уведомления">
          <i className="bi bi-bell" />
          <span>8</span>
        </button>
        <div className="admin-profile">
          <div className="admin-profile__avatar">А</div>
          <div>
            <strong>Александр П.</strong>
            <span>{user?.is_superadmin ? "Суперадмин" : "Суперадмин"}</span>
          </div>
        </div>
        <button className="admin-logout" type="button" onClick={onLogout}>
          <i className="bi bi-box-arrow-right" />
        </button>
      </div>
    </header>
  );
}

function KpiCard({ item }) {
  return (
    <article className={`admin-kpi admin-kpi--${item.tone}`}>
      <div className="admin-kpi__top">
        <span><i className={`bi ${item.icon}`} /></span>
        <small>{item.title}</small>
      </div>
      <strong>{item.value}</strong>
      <p>{item.delta}</p>
      {item.radar ? (
        <div className="admin-radar" aria-hidden="true">
          <i />
          <i />
          <b />
        </div>
      ) : (
        <svg className="admin-spark" viewBox="0 0 120 46" preserveAspectRatio="none" aria-hidden="true">
          <path className="admin-spark__fill" d={`${sparklinePath(item.points, 120, 36)} L 120 46 L 0 46 Z`} />
          <path className="admin-spark__line" d={sparklinePath(item.points, 120, 36)} />
        </svg>
      )}
    </article>
  );
}

function PlatformChart() {
  const line = "M 0 172 C 68 138 102 148 158 118 C 218 86 252 112 312 82 C 382 48 426 72 486 44 C 558 12 596 36 650 18";
  const area = `${line} L 650 220 L 0 220 Z`;
  return (
    <section className="admin-chart-card">
      <div className="admin-chart-card__head">
        <div>
          <span>Динамика оборота платформы</span>
          <strong>78 452 340 UZS</strong>
          <em>+18.6%</em>
        </div>
        <div className="admin-segments">
          {["День", "Неделя", "Месяц", "Год"].map((item) => (
            <button className={item === "Месяц" ? "is-active" : ""} type="button" key={item}>{item}</button>
          ))}
        </div>
      </div>
      <div className="admin-chart">
        <div className="admin-y-axis">
          {["100M", "80M", "60M", "40M", "20M", "0"].map((label) => <span key={label}>{label}</span>)}
        </div>
        <svg viewBox="0 0 700 250" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="platformArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#43d3a6" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#d6a84f" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="platformLine" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#d6a84f" />
              <stop offset="48%" stopColor="#43d3a6" />
              <stop offset="100%" stopColor="#f2c76e" />
            </linearGradient>
            <filter id="lineGlow">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {[30, 68, 106, 144, 182, 220].map((y) => <line x1="0" x2="700" y1={y} y2={y} key={y} />)}
          <path className="admin-chart__area" d={area} />
          <path className="admin-chart__line" d={line} filter="url(#lineGlow)" />
          <circle cx="596" cy="36" r="6" className="admin-chart__dot" />
        </svg>
        <div className="admin-tooltip" style={{ left: "76%", top: "16%" }}>
          <strong>09.06</strong>
          <span>83 120 000 UZS</span>
        </div>
        <div className="admin-x-axis">
          {["12.05", "19.05", "26.05", "02.06", "09.06", "11.06"].map((label) => <span key={label}>{label}</span>)}
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ status }) {
  const key = status === "Активна" ? "green" : status === "Новый" ? "violet" : "orange";
  return <span className={`admin-status admin-status--${key}`}>{status}</span>;
}

function OrganizationsTable() {
  return (
    <section className="admin-table-card">
      <div className="admin-panel-head">
        <div>
          <h2>Недавние организации и филиалы</h2>
          <p>Последние подключения, заявки и изменения по клиентам.</p>
        </div>
        <button type="button">Экспорт</button>
      </div>
      <div className="admin-org-table">
        <div className="admin-org-table__row admin-org-table__head">
          <span>Организация</span>
          <span>Тип</span>
          <span>Филиалов</span>
          <span>Админ</span>
          <span>Дата регистрации</span>
          <span>Статус</span>
          <span>Действия</span>
        </div>
        {organizationRows.map((row) => (
          <div className="admin-org-table__row" key={row[0]}>
            <strong>{row[0]}</strong>
            <span>{row[1]}</span>
            <span>{row[2]}</span>
            <span>{row[3]}</span>
            <span>{row[4]}</span>
            <StatusBadge status={row[5]} />
            <button type="button"><i className="bi bi-three-dots" /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

function RightColumn() {
  return (
    <aside className="admin-right">
      <section className="admin-side-card">
        <div className="admin-side-card__head">
          <h3>Одобрения и заявки</h3>
          <span>37</span>
        </div>
        <div className="admin-approval-list">
          {approvalItems.map((item) => (
            <div className="admin-approval" key={item[0] + item[1]}>
              <div>
                <strong>{item[0]}</strong>
                <p>{item[1]}</p>
                <small>{item[2]}</small>
              </div>
              <button type="button">{item[3]}</button>
            </div>
          ))}
        </div>
        <a href="#approvals">Показать все заявки</a>
      </section>

      <section className="admin-side-card">
        <div className="admin-side-card__head">
          <h3>Системные оповещения</h3>
          <span>5</span>
        </div>
        <div className="admin-alert-list">
          {alertItems.map((item) => (
            <div className={`admin-system-alert admin-system-alert--${item[0]}`} key={item[1]}>
              <i className={`bi ${item[0] === "success" ? "bi-check-circle" : item[0] === "warning" ? "bi-exclamation-triangle" : "bi-info-circle"}`} />
              <span>{item[1]}</span>
            </div>
          ))}
        </div>
        <a href="#alerts">Показать все оповещения</a>
      </section>

      <section className="admin-side-card">
        <div className="admin-side-card__head">
          <h3>Статус систем</h3>
          <span className="is-live">live</span>
        </div>
        <div className="admin-system-grid">
          {systemItems.map((item) => (
            <div key={item[0]}>
              <strong>{item[0]}</strong>
              <span><i />{item[1]}</span>
            </div>
          ))}
        </div>
        <div className="admin-uptime">Аптайм платформы <strong>99.98%</strong></div>
      </section>
    </aside>
  );
}

function CategoryPage({ active }) {
  const content = categoryContent[active] || categoryContent.organizations;
  return (
    <section className="admin-category-page">
      <div className="admin-panel-head">
        <div>
          <h2>{content.title}</h2>
          <p>{content.text}</p>
        </div>
        <button type="button">Создать</button>
      </div>
      <div className="admin-category-table">
        <div className="admin-category-table__row admin-category-table__head" style={{ gridTemplateColumns: `repeat(${content.columns.length}, minmax(0, 1fr))` }}>
          {content.columns.map((column) => <span key={column}>{column}</span>)}
        </div>
        {content.rows.map((row) => (
          <div className="admin-category-table__row" style={{ gridTemplateColumns: `repeat(${content.columns.length}, minmax(0, 1fr))` }} key={row.join("-")}>
            {row.map((cell, index) => index === row.length - 1 ? <StatusBadge status={cell} key={cell} /> : <span key={cell}>{cell}</span>)}
          </div>
        ))}
      </div>
    </section>
  );
}

function DashboardPage() {
  return (
    <>
      <section className="admin-kpi-grid">
        {kpis.map((item) => <KpiCard item={item} key={item.title} />)}
      </section>
      <div className="admin-dashboard-grid">
        <main className="admin-center">
          <PlatformChart />
          <OrganizationsTable />
        </main>
        <RightColumn />
      </div>
    </>
  );
}

function Footer() {
  return (
    <footer className="admin-footer">
      <span>© 2026 MARJON. Все права защищены.</span>
      <span>Версия 2.4.7</span>
      <span><i />Все системы работают</span>
      <a href="#support">Центр поддержки</a>
    </footer>
  );
}

function AdminShell({ onLogout }) {
  const [active, setActive] = useState("dashboard");
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    adminApi.get("/auth/me")
      .then(({ data }) => mounted && setUser(data))
      .catch(() => mounted && setMessage("Профиль не загружен. Проверьте права доступа."));
    adminApi.get("/organizations", { params: { size: 5 } }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const page = useMemo(() => (
    active === "dashboard" ? <DashboardPage /> : <CategoryPage active={active} />
  ), [active]);

  function logout() {
    adminLogout();
    onLogout();
  }

  return (
    <div className="admin-shell">
      <Sidebar active={active} onSelect={setActive} />
      <section className="admin-main">
        <Header user={user} onLogout={logout} />
        {message ? <div className="admin-auth-alert">{message}</div> : null}
        {page}
        <Footer />
      </section>
    </div>
  );
}

export default function AdminApp() {
  const [authenticated, setAuthenticated] = useState(() => isAdminAuthenticated());
  return authenticated ? (
    <AdminShell onLogout={() => setAuthenticated(false)} />
  ) : (
    <LoginView onLogin={() => setAuthenticated(true)} />
  );
}

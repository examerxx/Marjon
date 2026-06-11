import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/marjon-logo.svg";
import { logout } from "../api/client";

const navItems = [
  { key: "dashboard", label: "Дашборд", icon: "bi-bar-chart-line", to: "/" },
  {
    key: "warehouse",
    label: "Склад",
    icon: "bi-box-seam",
    to: "/warehouse",
    children: [
      { key: "stock-in", label: "Приход товаров", to: "/warehouse/stock-in", icon: "bi-box-arrow-in-down" },
      { key: "stock-out", label: "Расход товаров", to: "/warehouse/stock-out", icon: "bi-box-arrow-up" },
      { key: "balance", label: "Остаток", to: "/warehouse/balance", icon: "bi-boxes" },
      { key: "income-log", label: "Журнал приходов", to: "/warehouse/income-log", icon: "bi-clock-history" },
      { key: "transfer", label: "Перемещение", to: "/warehouse/transfer", icon: "bi-arrow-left-right" },
      { key: "inventory", label: "Инвентаризация", to: "/warehouse/inventory", icon: "bi-clipboard-check" },
      { key: "write-off", label: "Списание", to: "/warehouse/write-off", icon: "bi-trash3" },
      { key: "write-off-categories", label: "Категории списания", to: "/warehouse/write-off-categories", icon: "bi-tags" },
      { key: "waste", label: "Отход товаров", to: "/warehouse/waste", icon: "bi-recycle" },
    ],
  },
  {
    key: "reports",
    label: "Отчеты",
    icon: "bi-file-earmark-bar-graph",
    to: "/reports",
    children: [
      { key: "z-report", label: "Z - Отчёт", to: "/reports/z-report", icon: "bi-receipt-cutoff" },
      { key: "orders", label: "Отчёт по заказам", to: "/reports/orders", icon: "bi-receipt" },
      { key: "tables", label: "Отчёт по столам", to: "/reports/tables", icon: "bi-grid-3x3-gap" },
      { key: "waiters", label: "Отчёт по официантам", to: "/reports/waiters", icon: "bi-person-lines-fill" },
      { key: "dishes", label: "Отчёт по блюдам", to: "/reports/dishes", icon: "bi-stars" },
      { key: "cancelled-dishes", label: "Отчёт по отмененным блюдам", to: "/reports/cancelled-dishes", icon: "bi-x-octagon" },
      { key: "debtors-creditors", label: "Дебиторы и кредиторы", to: "/reports/debtors-creditors", icon: "bi-wallet2" },
    ],
  },
  {
    key: "users",
    label: "Сотрудники",
    icon: "bi-people",
    to: "/users",
    children: [
      { key: "cashier", label: "Кассир", to: "/users/cashier", icon: "bi-cash-coin" },
      { key: "waiter", label: "Официант", to: "/users/waiter", icon: "bi-person" },
      { key: "monoblock", label: "Моноблок", to: "/users/monoblock", icon: "bi-pc-display" },
      { key: "kitchen", label: "Кухня", to: "/users/kitchen", icon: "bi-display" },
      { key: "manager", label: "Менеджер", to: "/users/manager", icon: "bi-shield-lock" },
      { key: "all", label: "Все", to: "/users", icon: "bi-people" },
    ],
  },
  {
    key: "settings",
    label: "Настройки",
    icon: "bi-gear",
    to: "/settings",
    children: [
      { key: "clients", label: "Клиенты", to: "/settings/clients", icon: "bi-person-fill" },
      { key: "place", label: "Место", to: "/settings/place", icon: "bi-geo-alt" },
      { key: "payment-methods", label: "Способ оплаты", to: "/settings/payment-methods", icon: "bi-credit-card" },
      { key: "units", label: "Единица измерения", to: "/settings/units", icon: "bi-pencil" },
      { key: "profile", label: "Настройка профиля", to: "/settings/profile", icon: "bi-person" },
      { key: "printers", label: "Настройка принтеров", to: "/settings/printers", icon: "bi-printer" },
      { key: "receipt", label: "Настройка чека", to: "/settings/receipt", icon: "bi-receipt" },
      { key: "chef-receipt", label: "Настройка чека повара", to: "/settings/chef-receipt", icon: "bi-cup-hot" },
      { key: "support", label: "Тех. поддержка", to: "/settings/support", icon: "bi-headset" },
    ],
  },
  {
    key: "finance",
    label: "Финансы",
    icon: "bi-wallet2",
    to: "/finance",
    children: [
      { key: "operations", label: "Денежные операции", to: "/finance/operations", icon: "bi-cash-stack" },
      { key: "income-categories", label: "Категория приходов", to: "/finance/income-categories", icon: "bi-arrow-down-left-circle" },
      { key: "expense-categories", label: "Категория расходов", to: "/finance/expense-categories", icon: "bi-arrow-up-right-circle" },
    ],
  },
  {
    key: "nomenclature",
    label: "Номенклатура",
    icon: "bi-boxes",
    to: "/nomenclature",
    children: [
      { key: "dishes", label: "Блюда", to: "/nomenclature/dishes", icon: "bi-cup-hot" },
      { key: "raw-materials", label: "Сырьё", to: "/nomenclature/raw-materials", icon: "bi-basket" },
      { key: "semi-finished", label: "Полуфабрикаты", to: "/nomenclature/semi-finished", icon: "bi-box" },
      { key: "dish-categories", label: "Категория блюд", to: "/nomenclature/dish-categories", icon: "bi-grid" },
      { key: "raw-categories", label: "Категория сырья", to: "/nomenclature/raw-categories", icon: "bi-boxes" },
      { key: "semi-finished-categories", label: "Категория полуфабрикатов", to: "/nomenclature/semi-finished-categories", icon: "bi-diagram-3" },
      { key: "sales-categories", label: "Категория реализации", to: "/nomenclature/sales-categories", icon: "bi-shop" },
    ],
  },
  { key: "store", label: "Магазин", icon: "bi-shop", to: "/store" },
  { key: "reviews", label: "Отзывы", icon: "bi-chat-left", to: "/reviews" },
];

function SidebarSubmenu({ item, location, onSelect }) {
  return (
    <div className="sidebar-submenu">
      {item.children.map((child) => (
        <Link
          key={child.key}
          className={`sidebar-submenu__link ${location.pathname === child.to ? "is-active" : ""}`}
          to={child.to}
          onClick={() => onSelect(item.key)}
        >
          <span className="sidebar-submenu__icon" aria-hidden="true">
            <i className={`bi ${child.icon || "bi-circle"}`} />
          </span>
          <span className="sidebar-submenu__text">{child.label}</span>
        </Link>
      ))}
    </div>
  );
}

export default function Sidebar({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [openMenu, setOpenMenu] = useState("");
  const [pinnedMenu, setPinnedMenu] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [lang, setLang] = useState(() => localStorage.getItem("marjon_lang") || "ru");
  const sidebarRef = useRef(null);
  const accountRef = useRef(null);
  const role = user?.role_slugs?.[0] || (user?.is_superadmin ? "superadmin" : "owner");
  const displayName = user?.full_name || user?.email || "Owner";

  useEffect(() => {
    setPinnedMenu("");
    setOpenMenu("");
  }, [location.pathname]);

  useEffect(() => { setAccountOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!openMenu && !pinnedMenu) return undefined;
    function closeSubmenu() {
      setOpenMenu("");
      setPinnedMenu("");
    }
    function onDocClick(event) {
      if (!sidebarRef.current?.contains(event.target)) closeSubmenu();
    }
    function onKey(event) {
      if (event.key === "Escape") closeSubmenu();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu, pinnedMenu]);

  useEffect(() => {
    if (!accountOpen) return undefined;
    function onDocClick(event) {
      if (!accountRef.current?.contains(event.target)) setAccountOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function selectLang(code) {
    setLang(code);
    localStorage.setItem("marjon_lang", code);
  }

  function handleSubmenuSelect() {
    setPinnedMenu("");
    setOpenMenu("");
  }

  return (
    <aside className="dashboard-sidebar" id="dashboardSidebar" ref={sidebarRef}>
      <div className="sidebar-brand">
        <div className="brand-mark">
          <img src={logo} alt="MARJON" className="marjon-logo" decoding="async" />
        </div>
        <div>
          <div className="brand-title">MARJON</div>
          <div className="brand-subtitle">Restaurant OS</div>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Навигация">
        {navItems.map((item) => {
          const active = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
          const hasChildren = Boolean(item.children?.length);
          const submenuOpen = openMenu === item.key || pinnedMenu === item.key;

          if (hasChildren) {
            return (
              <div
                key={item.key}
                className={`sidebar-nav-item sidebar-nav-item--${item.key} has-submenu ${active ? "is-active" : ""} ${submenuOpen ? "is-open" : ""}`}
              >
                <button
                  className={`sidebar-link sidebar-link--button ${active ? "is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    if (pinnedMenu === item.key) {
                      setPinnedMenu("");
                      setOpenMenu("");
                    } else {
                      setPinnedMenu(item.key);
                      setOpenMenu(item.key);
                    }
                  }}
                  aria-expanded={submenuOpen}
                >
                  <span className="sidebar-icon"><i className={`bi ${item.icon}`} /></span>
                  <span>{item.label}</span>
                  <i className="bi bi-chevron-down sidebar-link__chevron" aria-hidden="true" />
                </button>
                <SidebarSubmenu item={item} location={location} onSelect={handleSubmenuSelect} />
              </div>
            );
          }

          return (
            <div key={item.key} className={`sidebar-nav-item ${active ? "is-active" : ""}`}>
              <Link
                className={`sidebar-link ${active ? "is-active" : ""}`}
                to={item.to}
                onClick={() => {
                  setPinnedMenu("");
                  setOpenMenu("");
                }}
              >
                <span className="sidebar-icon"><i className={`bi ${item.icon}`} /></span>
                <span>{item.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>

      <div className={`sidebar-account ${accountOpen ? "is-open" : ""}`} ref={accountRef}>
        {accountOpen ? (
          <div className="sidebar-account__menu" role="menu">
            <div className="sidebar-account__head">
              <div className="sidebar-account__head-avatar">
                <img src={logo} alt="MARJON" decoding="async" />
              </div>
              <div className="sidebar-account__head-meta">
                <strong>{displayName}</strong>
                <span>{user?.company_name || "MARJON"}</span>
              </div>
            </div>
            <Link className="sidebar-account__item" to="/settings/profile" role="menuitem" onClick={() => setAccountOpen(false)}>
              <i className="bi bi-person-gear" />
              <span>Настройка профиля</span>
            </Link>
            <Link className="sidebar-account__item" to="/settings/support" role="menuitem" onClick={() => setAccountOpen(false)}>
              <i className="bi bi-headset" />
              <span>Тех. поддержка</span>
            </Link>

            <div className="sidebar-account__lang">
              <span className="sidebar-account__lang-label">
                <i className="bi bi-translate" />
                Язык
              </span>
              <div className="sidebar-account__lang-switch" role="group" aria-label="Выбор языка">
                <button
                  type="button"
                  className={lang === "ru" ? "is-active" : ""}
                  onClick={() => selectLang("ru")}
                  aria-pressed={lang === "ru"}
                >
                  RU
                </button>
                <button
                  type="button"
                  className={lang === "uz" ? "is-active" : ""}
                  onClick={() => selectLang("uz")}
                  aria-pressed={lang === "uz"}
                >
                  UZ
                </button>
              </div>
            </div>

            <button type="button" className="sidebar-account__item sidebar-account__item--danger" role="menuitem" onClick={handleLogout}>
              <i className="bi bi-box-arrow-right" />
              <span>Выйти</span>
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="sidebar-user sidebar-user--button"
          onClick={() => setAccountOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={accountOpen}
        >
          <div className="sidebar-user__avatar">
            <img src={logo} alt="MARJON" className="sidebar-user-logo" decoding="async" />
          </div>
          <div className="sidebar-user__meta">
            <strong>{displayName}</strong>
            <span>{role}</span>
            <em>{user?.company_name || "MARJON"}</em>
          </div>
          <i className="bi bi-chevron-right sidebar-user__arrow" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

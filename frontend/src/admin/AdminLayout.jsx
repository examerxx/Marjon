import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { webFormat, webTime } from "../utils/webTime";

import logo from "../assets/marjon-logo.svg";

import { adminLogin, adminLogout } from "./api";

import Icon from '../components/Icon';

import { useMutationLocks } from "../hooks/useAsyncSafety";

import { AdminDashboardContainer, DetailModal } from "./AdminDashboard";

import { CategoryPage } from "./AdminSectionRouter";
import { t } from "../i18n/t";

const navItems = [
  { key: "dashboard", label: "Дашборд", icon: "bi-grid-1x2-fill" },
  {
    key: "organizations", label: "Организации", icon: "bi-buildings",
    children: [
      { key: "org-list", label: "Организация", icon: "bi-building" },
      { key: "org-status", label: "Статус организации", icon: "bi-info-circle" },
    ],
  },
  {
    key: "storage", label: "Склад", icon: "bi-box-seam",
    children: [
      { key: "storage-income", label: "Приход товаров", icon: "bi-box-arrow-in-down" },
      { key: "storage-expense", label: "Расход товаров", icon: "bi-box-arrow-up" },
      { key: "storage-balance", label: "Остаток", icon: "bi-boxes" },
      { key: "storage-income-journal", label: "Журнал приходов", icon: "bi-journal-text" },
      { key: "storage-writeoff", label: "Отход товаров", icon: "bi-trash3" },
      { key: "storage-inventory", label: "Инвентаризация", icon: "bi-clipboard-check" },
    ],
  },
  {
    key: "nomenclature", label: "Номенклатура", icon: "bi-boxes",
    children: [
      { key: "nom-product", label: "Продукт", icon: "bi-box-seam" },
      { key: "nom-sale-category", label: "Категория реализации", icon: "bi-tags" },
      { key: "nom-orders", label: "Заказы", icon: "bi-receipt" },
      { key: "nom-unit", label: "Единица измерения", icon: "bi-rulers" },
    ],
  },
  {
    key: "handbook", label: "Справочник", icon: "bi-journal-bookmark",
    children: [
      { key: "hb-countries", label: "Страны", icon: "bi-geo-alt" },
      { key: "hb-regions", label: "Регионы", icon: "bi-collection" },
      { key: "hb-districts", label: "Районы", icon: "bi-grid" },
    ],
  },
  {
    key: "service", label: "Услуга", icon: "bi-headset",
    children: [
      { key: "srv-employees", label: "Сотрудники", icon: "bi-people" },
      { key: "srv-source", label: "Источник", icon: "bi-megaphone" },
    ],
  },
  {
    key: "bank", label: "Банк", icon: "bi-bank",
    children: [
      { key: "bank-stats", label: "Статистика банка", icon: "bi-bar-chart-line" },
      { key: "bank-transactions", label: "Транзакции банка", icon: "bi-currency-exchange" },
    ],
  },
  {
    key: "finance", label: "Финансы", icon: "bi-wallet2",
    children: [
      { key: "fin-operations", label: "Денежные операции", icon: "bi-cash-stack" },
      { key: "fin-income-cat", label: "Категория приходов", icon: "bi-arrow-down-left-circle" },
      { key: "fin-expense-cat", label: "Категория расходов", icon: "bi-arrow-up-right-circle" },
      { key: "fin-payment", label: "Способ оплаты", icon: "bi-credit-card" },
      { key: "fin-history", label: "История изменений", icon: "bi-clock-history" },
    ],
  },
  {
    key: "settings", label: "Настройки", icon: "bi-gear",
    children: [
      { key: "set-store", label: "Marjon store", icon: "bi-shop" },
      { key: "set-cashier-bg", label: "Фон для кассира", icon: "bi-image" },
      { key: "set-languages", label: "Языки", icon: "bi-translate" },
    ],
  },
];

const ADMIN_PHONE_MAX_DIGITS = 9;

function getAdminPhoneDigits(value) {
  let digits = String(value || "").replace(/\D/g, "");

  if (digits.length > ADMIN_PHONE_MAX_DIGITS && digits.startsWith("998")) {
    digits = digits.slice(3);
  }

  return digits.slice(0, ADMIN_PHONE_MAX_DIGITS);
}

function formatAdminPhone(value) {
  const digits = getAdminPhoneDigits(value);

  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)} ${digits.slice(2)}`;
  if (digits.length <= 7) return `${digits.slice(0, 2)} ${digits.slice(2, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)}-${digits.slice(5, 7)}-${digits.slice(7)}`;
}

export function LoginView({ onLogin }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { acquire, release } = useMutationLocks();

  async function submit(event) {
    event.preventDefault();
    if (!acquire("hq-login")) return;
    if (getAdminPhoneDigits(phone).length !== ADMIN_PHONE_MAX_DIGITS || !password) {
      setError("Укажите полный номер телефона и пароль.");
      release("hq-login");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await adminLogin(phone, password);
      const validated = await onLogin();
      if (!validated) throw new Error("HQ admin session validation failed");
    } catch {
      setError("Не удалось войти в Marjon Admin.");
    } finally {
      setLoading(false);
      release("hq-login");
    }
  }

  function handlePhoneChange(event) {
    setPhone(getAdminPhoneDigits(event.target.value));
  }

  return (
    <main className="admin-login">
      <form className="admin-login__panel" onSubmit={submit}>
        <div className="admin-login__brand">
          <img src={logo} alt="MARJON" />
          <span>MARJON ADMIN</span>
        </div>
        <h1>{t("admin.adminlayout.dobro_pozhalovat")}</h1>
        <p className="admin-login__subtitle">{t("admin.adminlayout.voydite_v_rabochee_mesto_superadminki")}</p>
        <label className="admin-login__field admin-login__field--phone">
          <span>{t("admin.adminlayout.nomer_telefona")}</span>
          <div className="admin-login__input">
            <Icon name="bi-telephone" size={18} />
            <strong>+998</strong>
            <input value={formatAdminPhone(phone)} onChange={handlePhoneChange} type="tel" inputMode="numeric" autoComplete="tel-national" required />
          </div>
        </label>
        <label className="admin-login__field admin-login__field--password">
          <span>{t("admin.adminlayout.parol")}</span>
          <div className="admin-login__input">
            <Icon name="bi-lock" size={18} />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" required />
            <button className="admin-login__eye" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>
              <Icon name={showPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
            </button>
          </div>
        </label>
        <div className="admin-login__options">
          <label>
            <input type="checkbox" defaultChecked />
            <span>{t("admin.adminlayout.zapomnit_menya")}</span>
          </label>
          <button type="button">{t("admin.adminlayout.zabyli_parol")}</button>
        </div>
        {error ? <div className="admin-login__error">{error}</div> : null}
        <button className="admin-login__submit" type="submit" disabled={loading}>{loading ? "Входим..." : "Войти"}</button>
      </form>
    </main>
  );
}

function Sidebar({ active, onSelect, collapsed, onToggle, user, onProfile }) {
  const activeParent = useMemo(
    () => navItems.find((item) => item.children?.some((child) => child.key === active))?.key || null,
    [active],
  );
  const closePopoverTimer = useRef(null);
  const [openGroups, setOpenGroups] = useState(() => (activeParent ? [activeParent] : []));
  const [hoverGroup, setHoverGroup] = useState("");

  useEffect(() => {
    setOpenGroups((groups) => {
      if (!activeParent) return groups.length ? [] : groups;
      return groups.length === 1 && groups[0] === activeParent ? groups : [activeParent];
    });
  }, [activeParent]);

  useEffect(() => {
    if (!collapsed) setHoverGroup("");
  }, [collapsed]);

  useEffect(() => () => {
    if (closePopoverTimer.current) clearTimeout(closePopoverTimer.current);
  }, []);

  function toggleGroup(key) {
    // Accordion: only one category open at a time.
    setOpenGroups((groups) => (groups.includes(key) ? [] : [key]));
  }

  function openCollapsedPopover(key) {
    if (!collapsed) return;
    if (closePopoverTimer.current) clearTimeout(closePopoverTimer.current);
    setHoverGroup(key);
  }

  function closeCollapsedPopover() {
    if (!collapsed) return;
    if (closePopoverTimer.current) clearTimeout(closePopoverTimer.current);
    closePopoverTimer.current = setTimeout(() => setHoverGroup(""), 260);
  }

  function selectNavItem(key) {
    const nextParent = navItems.find((item) => item.children?.some((child) => child.key === key))?.key || null;
    setHoverGroup("");
    setOpenGroups(nextParent ? [nextParent] : []);
    onSelect(key);
  }

  return (
    <aside className={`admin-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="admin-brand sidebar-brand">
        <div className="sidebar-brand__identity">
          <button
            className="brand-mark brand-mark--button"
            type="button"
            onClick={onToggle}
            aria-pressed={collapsed}
            aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
          >
            <img src={logo} alt="MARJON" className="marjon-logo" decoding="async" />
          </button>
          <div>
            <div className="brand-title">MARJON</div>
            <div className="brand-subtitle">Restaurant OS</div>
          </div>
        </div>
      </div>
      <nav className="admin-nav" aria-label="Admin navigation">
        {navItems.map((item) => {
          if (!item.children) {
            return (
              <button
                key={item.key}
                type="button"
                className={active === item.key ? "is-active" : ""}
                onClick={() => selectNavItem(item.key)}
              >
                <Icon name={item.icon} size={18} />
                <span>{t(item.label)}</span>
                {item.badge ? <em>{item.badge}</em> : null}
              </button>
            );
          }
          const open = openGroups.includes(item.key);
          const hasActiveChild = item.children.some((child) => child.key === active);
          const popoverOpen = collapsed && hoverGroup === item.key;
          return (
            <div
              className={`admin-nav-group ${open ? "is-open" : ""} ${hasActiveChild ? "has-active" : ""} ${popoverOpen ? "has-popover" : ""}`}
              key={item.key}
              onMouseEnter={() => openCollapsedPopover(item.key)}
              onMouseLeave={closeCollapsedPopover}
            >
              <button
                type="button"
                className={`admin-nav-group__toggle ${hasActiveChild ? "is-active" : ""}`}
                onClick={() => toggleGroup(item.key)}
                aria-expanded={open}
              >
                <Icon name={item.icon} size={18} />
                <span>{t(item.label)}</span>
                <Icon name="bi-chevron-right" size={15} className="admin-nav-group__chevron" />
              </button>
              <div className="admin-nav-sub" role="group">
                {item.children.map((child) => (
                  <button
                    key={child.key}
                    type="button"
                    className={`admin-nav-sub__item ${active === child.key ? "is-active" : ""}`}
                    onClick={() => selectNavItem(child.key)}
                  >
                    <Icon name={child.icon || "bi-circle"} size={17} className="admin-nav-sub__icon" />
                    <span>{t(child.label)}</span>
                  </button>
                ))}
              </div>
              {collapsed ? (
                <div
                  className="admin-nav-flyout"
                  onMouseEnter={() => openCollapsedPopover(item.key)}
                  onMouseLeave={closeCollapsedPopover}
                >
                  {item.children.map((child) => (
                    <button
                      key={child.key}
                      type="button"
                      className={`admin-nav-flyout__item ${active === child.key ? "is-active" : ""}`}
                      onClick={() => selectNavItem(child.key)}
                    >
                      <span className="admin-nav-flyout__icon">
                        <Icon name={child.icon || "bi-circle"} size={16} />
                      </span>
                      <span>{t(child.label)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
      <button className="admin-profile-card" type="button" onClick={onProfile}>
        <span className="admin-profile-card__avatar">{(user?.name || "—").trim().slice(0, 1)}</span>
        <span className="admin-profile-card__info">
          <strong>{user?.name || "Не указано"}</strong>
          <small>{user?.is_superadmin ? "Суперадмин" : "Администратор"}</small>
        </span>
        <Icon name="bi-chevron-right" size={16} className="admin-profile-card__chevron" />
      </button>
    </aside>
  );
}

function formatAdminHeaderDate(value) {
  return webFormat(value, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatAdminHeaderTime(value) {
  return webTime(value);
}

function Header({ user, onBack, notifications = [], onNotificationRefresh, onNotificationSelect, onProfile }) {
  const notificationsRef = useRef(null);
  const [now, setNow] = useState(() => new Date());
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const profileName = user?.name || "Не указано";
  const profileInitial = user?.name?.trim().slice(0, 1) || "—";
  const profileRole = user?.is_superadmin ? "Суперадмин" : "Администратор";
  const notificationCount = notifications.length;
  const notificationLabel = notificationCount ? `Уведомления: ${notificationCount}` : "Уведомлений нет";
  const notificationTitle = notificationCount
    ? `${notificationCount} ${notificationCount === 1 ? "сообщение" : "сообщений"}`
    : "Нет сообщений";

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30 * 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (!notificationsRef.current?.contains(event.target)) {
        setNotificationsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function goBack() {
    if (onBack) {
      onBack();
      return;
    }
    window.location.replace("/admin.html");
  }

  function refreshNotifications() {
    setNotificationsLoading(true);
    window.setTimeout(() => {
      setNotificationsLoading(false);
      onNotificationRefresh?.();
    }, 450);
  }

  function openNotification(item) {
    setNotificationsOpen(false);
    onNotificationSelect?.(item);
  }

  return (
    <header className="admin-header">
      <div className="admin-header__title">
        <button className="admin-back-button" type="button" onClick={goBack} aria-label={t("admin.adminlayout.nazad")}>
          <Icon name="bi-chevron-left" size={24} />
        </button>
      </div>
      <div className="admin-header__actions">
        <div className="admin-date-time" aria-label={t("admin.adminlayout.tekuschaya_data_i_vremya")}>
          <span className="admin-date-time__item">
            <Icon name="bi-calendar3" size={15} />
            <strong>{formatAdminHeaderDate(now)}</strong>
          </span>
          <span className="admin-date-time__divider" aria-hidden="true" />
          <span className="admin-date-time__item">
            <Icon name="bi-clock" size={15} />
            <strong>{formatAdminHeaderTime(now)}</strong>
          </span>
        </div>
        <div className="admin-notification-wrap" ref={notificationsRef}>
          <button
            className={`admin-bell admin-notification ${notificationsOpen ? "is-open" : ""}`}
            type="button"
            aria-label={notificationLabel}
            aria-haspopup="dialog"
            aria-expanded={notificationsOpen}
            onClick={() => setNotificationsOpen((value) => !value)}
          >
            <Icon name="bi-bell" size={18} />
            {notificationCount ? (
              <span className="admin-notification__badge" aria-hidden="true">
                {notificationCount > 99 ? "99+" : notificationCount}
              </span>
            ) : null}
          </button>
          {notificationsOpen ? (
            <div className="admin-notification-popover" role="dialog" aria-label={t("admin.adminlayout.uvedomleniya")}>
              <div className="admin-notification-popover__head">
                <div>
                  <span>{t("admin.adminlayout.uvedomleniya")}</span>
                  <strong>{notificationTitle}</strong>
                </div>
                <button
                  className={notificationsLoading ? "is-loading" : ""}
                  type="button"
                  onClick={refreshNotifications}
                  disabled={notificationsLoading}
                  aria-label={t("admin.adminlayout.obnovit")}
                >
                  <Icon name="bi-arrow-clockwise" size={16} />
                </button>
              </div>
              <div className="admin-notification-popover__body">
                {notificationsLoading ? (
                  <div className="admin-notification-popover__empty">{t("admin.adminlayout.zagruzka")}</div>
                ) : null}
                {!notificationsLoading && notifications.length ? notifications.map((item) => (
                  <button type="button" className="admin-notification-item" key={item.id} onClick={() => openNotification(item)}>
                    <span className="admin-notification-item__icon">
                      <Icon name={item.icon || "bi-exclamation-triangle"} size={16} />
                    </span>
                    <span className="admin-notification-item__body">
                      <strong>{t(item.title)}</strong>
                      <span>{t(item.text)}</span>
                    </span>
                  </button>
                )) : null}
                {!notificationsLoading && !notifications.length ? (
                  <p className="admin-notification-popover__empty">{t("admin.adminlayout.novyh_soobscheniy_net")}</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <button className="admin-profile" type="button" onClick={onProfile} aria-label={t("admin.adminlayout.profil_administratora")}>
          <div className="admin-profile__avatar">{profileInitial}</div>
          <div className="admin-profile__meta">
            <strong>{profileName}</strong>
            <span>{profileRole}</span>
          </div>
          <Icon name="bi-chevron-down" size={15} className="admin-profile__chevron" />
        </button>
      </div>
    </header>
  );
}

export function AdminShell({ onLogout, user }) {
  const [active, setActive] = useState("dashboard");
  const navigationHistoryRef = useRef([]);
  const innerBackRef = useRef(null);
  const [message, setMessage] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const search = "";
  const [approvals, setApprovals] = useState([]);
  const [detail, setDetail] = useState(null);

  const closeDetail = () => setDetail(null);
  const setInnerBackHandler = useCallback((handler) => {
    innerBackRef.current = typeof handler === "function" ? handler : null;
  }, []);

  const navigateTo = useCallback((nextActive) => {
    if (nextActive === active) {
      if (nextActive === "dashboard") innerBackRef.current?.();
      return;
    }

    navigationHistoryRef.current = [...navigationHistoryRef.current, active].slice(-40);
    innerBackRef.current = null;
    setDetail(null);
    setActive(nextActive);
  }, [active]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(""), 3200);
    return () => clearTimeout(timer);
  }, [message]);

  const headerNotifications = useMemo(() => approvals.map((item, index) => ({
    id: `${item[0]}-${item[1]}-${index}`,
    title: item[0],
    text: `${item[1]} · ${item[2]}`,
    icon: "bi-exclamation-triangle",
    approval: item,
  })), [approvals]);

  function handleCreate(section) {
    void section;
    setMessage("Создание недоступно: backend mutation contract не подключён.");
  }

  function openApprovalDetail(item) {
    setDetail({
      title: item[0],
      subtitle: item[1],
      fields: [
        { label: t("admin.adminlayout.tip_zayavki"), value: item[1] },
        { label: t("admin.adminlayout.polucheno"), value: item[2] },
        { label: t("admin.adminlayout.rekomenduemoe_deystvie"), value: item[3] },
      ],
      actions: [
        { label: item[3], variant: "primary", onClick: () => {
          setMessage("Обработка заявки недоступна: backend mutation contract не подключён.");
          closeDetail();
        } },
        { label: t("admin.adminlayout.zakryt"), variant: "ghost", onClick: closeDetail },
      ],
    });
  }

  function handleNotificationSelect(item) {
    if (item?.approval) {
      openApprovalDetail(item.approval);
      return;
    }
    setMessage(item?.title || "Уведомление открыто.");
  }

  function openCategoryRowDetail(title, columns, row) {
    setDetail({
      title: row[0],
      subtitle: title,
      status: row[row.length - 1],
      fields: columns.map((column, index) => ({ label: column, value: row[index] })),
    });
  }

  function openProfileDetail() {
    setDetail({
      title: user?.name || "Не указано",
      subtitle: t("admin.adminlayout.profil_administratora"),
      status: "Активна",
      fields: [
        { label: t("admin.adminlayout.rol"), value: user?.is_superadmin ? "Суперадмин" : "Администратор" },
        { label: t("admin.adminlayout.telefon"), value: user?.phone || "—" },
        { label: t("admin.adminlayout.dostup"), value: "Полный доступ" },
      ],
      actions: [
        { label: t("admin.adminlayout.vyyti"), variant: "primary", onClick: () => { closeDetail(); logout(); } },
        { label: t("admin.adminlayout.zakryt"), variant: "ghost", onClick: closeDetail },
      ],
    });
  }

  const page = useMemo(() => (
    <>
      <AdminDashboardContainer
        approvals={approvals}
        isActive={active === "dashboard"}
        onApprovalClick={openApprovalDetail}
        onInnerBackChange={setInnerBackHandler}
        onNavigate={navigateTo}
        onNotify={setMessage}
        onOpenDetail={setDetail}
      />
      {active === "dashboard" ? null : (
        <CategoryPage active={active} search={search} onCreate={handleCreate} onRowDetail={openCategoryRowDetail} onNotify={setMessage} onInnerBackChange={setInnerBackHandler} />
      )}
    </>
  ), [active, approvals, navigateTo, search, setInnerBackHandler]);

  function logout() {
    const logoutRequest = adminLogout();
    // Local shell teardown is immediate; the returned promise still exposes
    // a revocation failure to direct callers and behavioral tests.
    logoutRequest.catch(() => {});
    onLogout();
    return logoutRequest;
  }

  function handleHeaderBack() {
    if (detail) {
      closeDetail();
      return;
    }

    if (innerBackRef.current) {
      innerBackRef.current();
      return;
    }

    while (navigationHistoryRef.current.at(-1) === active) {
      navigationHistoryRef.current.pop();
    }

    const previousActive = navigationHistoryRef.current.pop();
    if (previousActive) {
      innerBackRef.current = null;
      setActive(previousActive);
      return;
    }

    if (active !== "dashboard") {
      setActive("dashboard");
    }
  }

  return (
    <div className={`admin-shell ${collapsed ? "is-sidebar-collapsed" : ""}`}>
      <Sidebar active={active} onSelect={navigateTo} collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} user={user} onProfile={openProfileDetail} />
      <section className="admin-main">
        <Header
          user={user}
          onBack={handleHeaderBack}
          notifications={headerNotifications}
          onNotificationRefresh={() => setMessage("Уведомления обновлены.")}
          onNotificationSelect={handleNotificationSelect}
          onProfile={openProfileDetail}
        />
        {message ? (
          <div className="admin-auth-alert" role="status" onClick={() => setMessage("")}>{message}</div>
        ) : null}
        <div className="admin-content">
          {page}
        </div>
      </section>
      <DetailModal data={detail} onClose={closeDetail} />
    </div>
  );
}

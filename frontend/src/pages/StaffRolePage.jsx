import { useEffect, useMemo, useState } from "react";
import { api, fetchStaffUsers } from "../api/client";
import Icon from "../components/Icon";

const roleOptions = [
  { key: "cashier", label: "Кассир", title: "Кассиры" },
  { key: "waiter", label: "Официант", title: "Официанты" },
  { key: "courier", label: "Курьер", title: "Курьеры" },
  { key: "monoblock", label: "Моноблок", title: "Моноблок" },
  { key: "kitchen", label: "Повар", title: "Повара" },
  { key: "manager", label: "Менеджер", title: "Менеджеры" },
  { key: "warehouse", label: "Завсклад", title: "Завсклад" },
];

const roleMap = roleOptions.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});

const onlyDigits = (value = "") => String(value).replace(/\D/g, "");

const phoneCountries = [
  { key: "UZ", label: "Узбекистан", dialCode: "998" },
  { key: "TR", label: "Турция", dialCode: "90" },
  { key: "RU", label: "Россия", dialCode: "7" },
  { key: "KZ", label: "Казахстан", dialCode: "7" },
  { key: "KG", label: "Киргизия", dialCode: "996" },
  { key: "TJ", label: "Таджикистан", dialCode: "992" },
  { key: "TM", label: "Туркменистан", dialCode: "993" },
  { key: "US", label: "Америка", dialCode: "1" },
];

const phoneCountryMap = phoneCountries.reduce((acc, country) => {
  acc[country.key] = country;
  return acc;
}, {});

const getPhoneFlag = (countryKey) =>
  `https://purecatamphetamine.github.io/country-flag-icons/3x2/${countryKey}.svg`;

const inferPhoneCountry = (value = "") => {
  const digits = onlyDigits(value);

  return (
    phoneCountries
      .filter((country) => digits.startsWith(country.dialCode))
      .sort((a, b) => b.dialCode.length - a.dialCode.length)[0]?.key || "UZ"
  );
};

const getPhoneLocal = (value = "", countryKey = "UZ") => {
  const digits = onlyDigits(value);
  const country = phoneCountryMap[countryKey] || phoneCountryMap.UZ;
  return digits.startsWith(country.dialCode) ? digits.slice(country.dialCode.length) : digits;
};

const formatPhoneLocal = (local = "") => {
  const value = local.slice(0, 10);

  if (value.length <= 3) return value;
  if (value.length <= 6) return `${value.slice(0, 3)} ${value.slice(3)}`;
  if (value.length <= 8) return `${value.slice(0, 3)} ${value.slice(3, 6)}-${value.slice(6)}`;
  return `${value.slice(0, 3)} ${value.slice(3, 6)}-${value.slice(6, 8)}-${value.slice(8, 10)}`;
};

const formatPhone = (value = "", countryKey = inferPhoneCountry(value)) => {
  const country = phoneCountryMap[countryKey] || phoneCountryMap.UZ;
  const local = getPhoneLocal(value, country.key);

  if (country.key === "UZ") {
    const uzLocal = local.slice(0, 9);
    const parts = [
      uzLocal.slice(0, 2),
      uzLocal.slice(2, 5),
      uzLocal.slice(5, 7),
      uzLocal.slice(7, 9),
    ].filter(Boolean);

    return parts.length
      ? `+${country.dialCode} ${parts[0]}${parts[1] ? ` ${parts[1]}` : ""}${parts[2] ? `-${parts[2]}` : ""}${parts[3] ? `-${parts[3]}` : ""}`
      : "";
  }

  return local ? `+${country.dialCode} ${formatPhoneLocal(local)}` : "";
};

const normalizePhone = (value = "", countryKey = "UZ") => {
  const country = phoneCountryMap[countryKey] || phoneCountryMap.UZ;
  const parts = [
    country.dialCode,
    getPhoneLocal(value, country.key).slice(0, country.key === "UZ" ? 9 : 10),
  ];

  return parts[1] ? parts.join("") : "";
};

const emptyForm = {
  fullName: "",
  phone: "",
  phoneCountry: "UZ",
  roleKey: "",
  permission: "",
  pin: "",
  password: "",
  printerIp: "",
  nfcId: "",
  canDeleteDishes: false,
  canTakeawayAtTable: false,
  canChangeOrderType: false,
  canCloseBill: false,
  canOpenCashDrawerAfterPayment: false,
  canViewClosedOrders: false,
  status: "active",
  comment: "",
  photo: "",
  access: {},
};

const getPermissionSummary = (values) => {
  const permissions = [
    values.canDeleteDishes && "Удаление блюд",
    values.canTakeawayAtTable && "Заказ на вынос",
    values.canChangeOrderType && "Изменение типа заказа",
    values.canCloseBill && "Закрытие счета",
    values.canOpenCashDrawerAfterPayment && "Открытие денежного ящика",
    values.canViewClosedOrders && "Просмотр закрытых заказов",
  ].filter(Boolean);

  return permissions.join(", ") || values.permission || "Базовый доступ";
};

const staffAccessModules = [
  { key: "home", label: "Главная" },
  { key: "warehouse_stock", label: "Склады (Остаток товаров)" },
  { key: "goods_income", label: "Приход товаров" },
  { key: "goods_expense", label: "Расход товаров" },
  { key: "income_log", label: "Журнал приходов" },
  { key: "transfers", label: "Перемещения" },
  { key: "supplier_returns", label: "Возврат поставщику" },
  { key: "inventory", label: "Инвентаризация" },
  { key: "write_off", label: "Списание" },
  { key: "write_off_categories", label: "Категории списания" },
  { key: "z_report", label: "Z-отчет" },
  { key: "orders_report", label: "Отчет по заказам" },
  { key: "tables_report", label: "Отчет по столам" },
  { key: "waiters_report", label: "Отчет по официантам" },
  { key: "dishes_report", label: "Отчет по блюдам" },
  { key: "couriers_report", label: "Отчет по курьерам" },
  { key: "deleted_dishes_report", label: "Отчет по удаленным блюдам" },
  { key: "debtors_creditors", label: "Дебиторы и Кредиторы" },
  { key: "cashflow", label: "Денежный поток" },
  { key: "cashier", label: "Кассир" },
  { key: "waiter", label: "Официант" },
  { key: "monoblock", label: "Моноблок" },
  { key: "cook", label: "Повар" },
  { key: "manager", label: "Менеджер" },
  { key: "warehouse_manager", label: "Завсклад" },
  { key: "attendance", label: "Посещаемость" },
  { key: "courier", label: "Курьер" },
  { key: "clients", label: "Клиенты" },
  { key: "suppliers", label: "Поставщик" },
  { key: "places", label: "Места" },
  { key: "payment_methods", label: "Способы оплаты" },
  { key: "units", label: "Ед. измерения" },
  { key: "profile_settings", label: "Настройка профиля" },
  { key: "printer_settings", label: "Настройка принтеров" },
  { key: "banners", label: "Баннеры" },
  { key: "playlists", label: "Плейлисты" },
  { key: "devices", label: "Устройства" },
  { key: "cash_operations", label: "Денежные операции" },
  { key: "income_expense_categories", label: "Категории приход-расходов" },
  { key: "dishes", label: "Блюда" },
  { key: "dish_categories", label: "Категории блюда (меню)" },
  { key: "raw_materials", label: "Сырьё" },
  { key: "raw_categories", label: "Категории сырья" },
  { key: "semi_finished", label: "Полуфабрикаты" },
  { key: "semi_finished_categories", label: "Категории полуфабрикатов" },
  { key: "sales_categories", label: "Категории реализации" },
  { key: "call_center", label: "Call Center" },
  { key: "booking", label: "Брон" },
  { key: "order_edit", label: "Заказы (изменить, удалить)" },
  { key: "order_types", label: "Заказы (типы)", actions: ["takeaway", "table", "delivery", "new"] },
];

const staffAccessActions = [
  { key: "create", label: "Создать" },
  { key: "read", label: "Читать" },
  { key: "update", label: "Обновлять" },
  { key: "delete", label: "Удалить" },
];

const staffOrderTypeActions = [
  { key: "takeaway", label: "На вынос" },
  { key: "table", label: "На стол" },
  { key: "delivery", label: "Доставка" },
  { key: "new", label: "Новый" },
];

function StaffRolePage({ role = "all" }) {
  const routeRole = roleMap[role] ? role : "all";
  const pageTitle =
    routeRole === "all" ? "Список сотрудников" : `Список сотрудников: ${roleMap[routeRole].title}`;

  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(true);

  useEffect(() => {
    fetchStaffUsers()
      .then((data) => {
        const mapped = (data || []).map((user) => ({
          id: user.id,
          fullName: user.name || user.role_name || user.email?.split("@")[0] || "—",
          phone: user.phone || "",
          roleKey: user.role_slug || "cashier",
          permission: user.role_slug || "Базовый доступ",
          status: user.is_active !== false ? "active" : "archived",
          pin: "",
          password: "",
          comment: "",
          photo: "",
          access: {},
        }));
        setStaff(mapped);
      })
      .catch((err) => console.warn("Не удалось загрузить сотрудников:", err.message))
      .finally(() => setStaffLoading(false));
  }, []);

  const defaultFilters = useMemo(() => ({
    query: "",
    roleKey: routeRole === "all" ? "" : routeRole,
    status: "",
  }), [routeRole]);

  const [activeTab, setActiveTab] = useState("active");
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [filters, setFilters] = useState(defaultFilters);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [phoneCountryOpen, setPhoneCountryOpen] = useState(false);
  const [form, setForm] = useState({
    ...emptyForm,
  });

  useEffect(() => {
    setDraftFilters(defaultFilters);
    setFilters(defaultFilters);
  }, [defaultFilters]);

  const visibleStaff = useMemo(() => {
    const normalizedQuery = filters.query.trim().toLowerCase();

    return staff.filter((employee) => {
      const matchesRoute = routeRole === "all" || employee.roleKey === routeRole;
      const matchesTab = employee.status === activeTab;
      const matchesQuery =
        !normalizedQuery ||
        employee.fullName.toLowerCase().includes(normalizedQuery) ||
        employee.phone.includes(normalizedQuery);
      const matchesRole = !filters.roleKey || employee.roleKey === filters.roleKey;
      const matchesStatus = !filters.status || employee.status === filters.status;

      return matchesRoute && matchesTab && matchesQuery && matchesRole && matchesStatus;
    });
  }, [activeTab, filters, routeRole, staff]);

  const openAddModal = () => {
    setEditingId(null);
    setShowPassword(false);
    setPhoneCountryOpen(false);
    setForm({
      ...emptyForm,
      phoneCountry: "UZ",
      roleKey: routeRole === "all" ? "cashier" : routeRole,
      access: {},
    });
    setModalOpen(true);
  };

  const openEditModal = (employee) => {
    setEditingId(employee.id);
    setShowPassword(false);
    setPhoneCountryOpen(false);
    setForm({ ...emptyForm, ...employee, phoneCountry: employee.phoneCountry || inferPhoneCountry(employee.phone) });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setShowPassword(false);
    setPhoneCountryOpen(false);
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const toggleForm = (field) => {
    setForm((current) => ({ ...current, [field]: !current[field] }));
  };

  const selectPhoneCountry = (countryKey) => {
    setForm((current) => ({
      ...current,
      phoneCountry: countryKey,
      phone: current.phone ? normalizePhone(getPhoneLocal(current.phone, current.phoneCountry), countryKey) : "",
    }));
    setPhoneCountryOpen(false);
  };

  const toggleAccess = (moduleKey, actionKey = "enabled") => {
    setForm((current) => {
      const moduleAccess = current.access?.[moduleKey] || {};

      return {
        ...current,
        access: {
          ...(current.access || {}),
          [moduleKey]: {
            ...moduleAccess,
            [actionKey]: !moduleAccess[actionKey],
          },
        },
      };
    });
  };

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => updateForm("photo", reader.result);
    reader.readAsDataURL(file);
  };

const saveStaff = async (event) => {
  event.preventDefault();
  const phone = normalizePhone(form.phone, form.phoneCountry);
  const email = `${phone || Date.now()}@staff.marjon`;

  try {
    if (!editingId) {
      const { data: newUser } = await api.post("/auth/users", {
        email,
        password: form.password || "Pass1234",
        phone: phone || null,
        role_slug: form.roleKey || "cashier",
        role_name: form.fullName,
      });
      setStaff((current) => [{
        id: newUser.id,
        fullName: form.fullName,
        phone,
        roleKey: form.roleKey || "cashier",
        permission: getPermissionSummary(form),
        status: "active",
        pin: form.pin,
        password: form.password,
        comment: form.comment,
        photo: form.photo || "",
        access: form.access || {},
      }, ...current]);
    } else {
      await api.patch(`/auth/users/${editingId}`, {
        email,
        password: form.password || undefined,
        phone: phone || null,
        role_slug: form.roleKey || "cashier",
        role_name: form.fullName,
      });
      setStaff((current) => current.map((emp) =>
        emp.id === editingId ? { ...emp, ...form, permission: getPermissionSummary(form) } : emp
      ));
    }
    closeModal();
  } catch (err) {
    console.error("Ошибка сохранения:", err.response?.data?.detail || err.message);
    window.alert(err.response?.data?.detail || "Ошибка сохранения");
  }
};

  const archiveStaff = (id) => {
    setStaff((current) =>
      current.map((employee) =>
        employee.id === id ? { ...employee, status: "archived" } : employee,
      ),
    );
  };

  const restoreStaff = (id) => {
    setStaff((current) =>
      current.map((employee) =>
        employee.id === id ? { ...employee, status: "active" } : employee,
      ),
    );
  };

  const applyFilters = () => {
    setFilters(draftFilters);
  };

  const clearFilters = () => {
    const resetFilters = {
      query: "",
      roleKey: routeRole === "all" ? "" : routeRole,
      status: "",
    };
    setDraftFilters(resetFilters);
    setFilters(resetFilters);
  };

  return (
    <div className="staff-page">
      <section className="staff-card">
        <header className="staff-header">
          <div className="staff-header__title">
            <span className="staff-header__accent" aria-hidden="true" />
            <div>
              <p className="staff-header__eyebrow">Пользователи</p>
              <h1>{pageTitle}</h1>
            </div>
          </div>
          <button className="staff-add-button" type="button" onClick={openAddModal}>
            <Icon name="bi-plus" size={18} />
            Добавить +
          </button>
        </header>

        <div className="staff-tabs" role="tablist" aria-label="Статус сотрудников">
          <button
            className={activeTab === "active" ? "is-active" : ""}
            type="button"
            onClick={() => setActiveTab("active")}
          >
            <Icon name="bi-check2-circle" size={17} />
            Активные
          </button>
          <button
            className={activeTab === "archived" ? "is-active" : ""}
            type="button"
            onClick={() => setActiveTab("archived")}
          >
            <Icon name="bi-archive" size={17} />
            Архивированные
          </button>
        </div>

        <div className="staff-filters">
          <label>
            <span>Поиск</span>
            <div className="staff-filter-control">
              <Icon name="bi-search" size={17} />
              <input
                type="search"
                value={draftFilters.query}
                onChange={(event) =>
                  setDraftFilters((current) => ({ ...current, query: event.target.value }))
                }
                placeholder="ФИО или телефон"
              />
            </div>
          </label>
          <label>
            <span>Роль</span>
            <select
              value={draftFilters.roleKey}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, roleKey: event.target.value }))
              }
              disabled={routeRole !== "all"}
            >
              <option value="">Все роли</option>
              {roleOptions.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Статус</span>
            <select
              value={draftFilters.status}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="">Все статусы</option>
              <option value="active">Активные</option>
              <option value="archived">Архивированные</option>
            </select>
          </label>
          <div className="staff-filter-buttons">
            <button type="button" onClick={applyFilters}>
              <Icon name="bi-funnel" size={16} />
              Фильтровать
            </button>
            <button type="button" className="staff-clear-button" onClick={clearFilters}>
              <Icon name="bi-arrow-counterclockwise" size={16} />
              Очистить
            </button>
          </div>
        </div>

        <div className="staff-table-wrapper">
          <table className="staff-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Фото</th>
                <th>ФИО</th>
                <th>Номер телефона</th>
                <th>Роль</th>
                <th>Доступ</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {visibleStaff.map((employee) => (
                <tr key={employee.id}>
                  <td>{employee.id}</td>
                  <td>
                    <div className="staff-avatar">
                      {employee.photo ? (
                        <img src={employee.photo} alt={employee.fullName} />
                      ) : (
                        <span>{employee.fullName.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                  </td>
                  <td className="staff-name-cell">{employee.fullName}</td>
                  <td>{formatPhone(employee.phone, employee.phoneCountry || inferPhoneCountry(employee.phone))}</td>
                  <td>
                    <span className="staff-role-badge">
                      {roleMap[employee.roleKey]?.label || employee.roleKey}
                    </span>
                  </td>
                  <td>
                    <span className="staff-permission">
                      <span className="staff-permission-dot" aria-hidden="true" />
                      {employee.permission || "Базовый доступ"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`staff-status-badge ${
                        employee.status === "archived" ? "is-archived" : ""
                      }`}
                    >
                      {employee.status === "archived" ? "#архив" : "#активно"}
                    </span>
                  </td>
                  <td>
                    <div className="staff-actions">
                      <button
                        type="button"
                        className="edit-action-button"
                        onClick={() => openEditModal(employee)}
                        aria-label="Edit"
                        title="Edit"
                      >
                        <Icon name="bi-pencil" size={15} />
                      </button>
                      {employee.status === "archived" ? (
                        <button
                          type="button"
                          className="staff-restore-action"
                          onClick={() => restoreStaff(employee.id)}
                          aria-label="Restore"
                          title="Restore"
                        >
                          <Icon name="bi-recycle" size={15} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="staff-delete-action"
                          onClick={() => archiveStaff(employee.id)}
                          aria-label="Archive"
                          title="Archive"
                        >
                          <Icon name="bi-trash3" size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visibleStaff.length === 0 && (
                <tr>
                  <td colSpan={8} className="staff-empty-cell">
                    Сотрудники не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen && (
        <div className="staff-modal" role="dialog" aria-modal="true">
          <div className="staff-modal__backdrop" onClick={closeModal} />
          <form
            key={editingId ? `staff-edit-${editingId}` : "staff-add-empty"}
            className="staff-form"
            onSubmit={saveStaff}
            autoComplete="off"
          >
            <div className="staff-autofill-trap" aria-hidden="true">
              <input type="text" name="username" tabIndex={-1} autoComplete="username" />
              <input type="password" name="password" tabIndex={-1} autoComplete="new-password" />
            </div>
            <div className="staff-form__header">
              <div>
                <p>{editingId ? "Редактирование" : "Новый сотрудник"}</p>
                <h2>{editingId ? "Изменить сотрудника" : "Добавить сотрудника"}</h2>
              </div>
              <button type="button" onClick={closeModal} aria-label="Закрыть">
                <Icon name="bi-x-lg" size={20} />
              </button>
            </div>

            <div className="staff-form__grid staff-form__grid--edit">
              <label className="staff-photo-upload">
                <span>Фото сотрудника</span>
                <div>
                  <div className="staff-avatar staff-avatar--large">
                    {form.photo ? (
                      <img src={form.photo} alt="Avatar preview" />
                    ) : (
                      <Icon name="bi-camera" size={34} />
                    )}
                  </div>
                  <input type="file" accept="image/*" onChange={handlePhotoChange} />
                </div>
              </label>
              <label>
                <span>Имя *</span>
                <input
                  required
                  autoComplete="off"
                  value={form.fullName}
                  onChange={(event) => updateForm("fullName", event.target.value)}
                  placeholder="Имя сотрудника"
                />
              </label>
              <label>
                <span>Номер телефона</span>
                <div className="staff-phone-field">
                  <button
                    className="staff-phone-country"
                    type="button"
                    onClick={() => setPhoneCountryOpen((value) => !value)}
                    aria-label="Выбрать страну"
                    aria-expanded={phoneCountryOpen}
                  >
                    <img
                      src={getPhoneFlag(form.phoneCountry || "UZ")}
                      alt={phoneCountryMap[form.phoneCountry || "UZ"]?.label || ""}
                    />
                    <Icon name="bi-chevron-down" size={12} />
                  </button>
                  {phoneCountryOpen && (
                    <div className="staff-phone-country-menu">
                      {phoneCountries.map((country) => (
                        <button
                          className={form.phoneCountry === country.key ? "is-active" : ""}
                          type="button"
                          key={country.key}
                          onClick={() => selectPhoneCountry(country.key)}
                        >
                          <img src={getPhoneFlag(country.key)} alt="" />
                          <span>{country.label}</span>
                          <b>+{country.dialCode}</b>
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    required
                    autoComplete="off"
                    inputMode="tel"
                    value={
                      form.phone
                        ? formatPhone(form.phone, form.phoneCountry)
                        : `+${phoneCountryMap[form.phoneCountry || "UZ"]?.dialCode || "998"}`
                    }
                    onChange={(event) =>
                      updateForm("phone", normalizePhone(event.target.value, form.phoneCountry))
                    }
                    placeholder=""
                  />
                </div>
              </label>
              <label>
                <span>Пароль *</span>
                <div className="staff-password-field">
                  <input
                    required
                    autoComplete="new-password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(event) => updateForm("password", event.target.value)}
                    placeholder="Пароль"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    aria-pressed={showPassword}
                  >
                    <Icon name={showPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
                  </button>
                </div>
              </label>
              <label className="staff-form__printer-ip">
                <span>IP адрес принтера *</span>
                <input
                  required
                  autoComplete="off"
                  value={form.printerIp}
                  onChange={(event) => updateForm("printerIp", event.target.value)}
                  placeholder="192.168.0.100"
                />
              </label>
              <label>
                <span>NFC-идентификатор</span>
                <input
                  autoComplete="off"
                  value={form.nfcId}
                  onChange={(event) => updateForm("nfcId", event.target.value)}
                  placeholder="ID карты"
                />
              </label>
              <label>
                <span>PIN-код 4 цифры</span>
                <input
                  value={form.pin}
                  maxLength={4}
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  onChange={(event) => updateForm("pin", event.target.value.replace(/\D/g, ""))}
                  placeholder="0000"
                />
              </label>
              <div className="staff-permission-switches">
                <button
                  className={`staff-permission-switch ${form.status === "active" ? "is-on" : ""}`}
                  type="button"
                  onClick={() =>
                    updateForm("status", form.status === "active" ? "archived" : "active")
                  }
                >
                  <span>Статус</span>
                  <i>{form.status === "active" ? "Активный" : "Архив"}</i>
                  <b className="staff-switch" aria-hidden="true" />
                </button>
                <button
                  className={`staff-permission-switch ${form.canDeleteDishes ? "is-on" : ""}`}
                  type="button"
                  onClick={() => toggleForm("canDeleteDishes")}
                >
                  <span>Удаления блюд</span>
                  <b className="staff-switch" aria-hidden="true" />
                </button>
                <button
                  className={`staff-permission-switch ${form.canTakeawayAtTable ? "is-on" : ""}`}
                  type="button"
                  onClick={() => toggleForm("canTakeawayAtTable")}
                >
                  <span>Заказ на вынос за столом</span>
                  <b className="staff-switch" aria-hidden="true" />
                </button>
                <button
                  className={`staff-permission-switch ${form.canChangeOrderType ? "is-on" : ""}`}
                  type="button"
                  onClick={() => toggleForm("canChangeOrderType")}
                >
                  <span>Изменить тип заказа</span>
                  <b className="staff-switch" aria-hidden="true" />
                </button>
                <button
                  className={`staff-permission-switch ${form.canCloseBill ? "is-on" : ""}`}
                  type="button"
                  onClick={() => toggleForm("canCloseBill")}
                >
                  <span>Может закрыть счет</span>
                  <b className="staff-switch" aria-hidden="true" />
                </button>
                <button
                  className={`staff-permission-switch ${
                    form.canOpenCashDrawerAfterPayment ? "is-on" : ""
                  }`}
                  type="button"
                  onClick={() => toggleForm("canOpenCashDrawerAfterPayment")}
                >
                  <span>Открыть денежный ящик после оплаты</span>
                  <b className="staff-switch" aria-hidden="true" />
                </button>
                <button
                  className={`staff-permission-switch ${form.canViewClosedOrders ? "is-on" : ""}`}
                  type="button"
                  onClick={() => toggleForm("canViewClosedOrders")}
                >
                  <span>Просмотр закрытых заказов</span>
                  <b className="staff-switch" aria-hidden="true" />
                </button>
              </div>
              <div className="staff-permission-matrix">
                {staffAccessModules.map((module) => {
                  const moduleAccess = form.access?.[module.key] || {};
                  const actions =
                    module.key === "order_types" ? staffOrderTypeActions : staffAccessActions;

                  return (
                    <div
                      className={`staff-access-row ${moduleAccess.enabled ? "is-open" : ""}`}
                      key={module.key}
                    >
                      <div className="staff-access-toggle">
                        <button
                          className={`staff-switch-button ${moduleAccess.enabled ? "is-on" : ""}`}
                          type="button"
                          onClick={() => toggleAccess(module.key)}
                          aria-pressed={Boolean(moduleAccess.enabled)}
                          aria-label={`${module.label}: ${moduleAccess.enabled ? "выключить" : "включить"}`}
                        >
                          <b className="staff-mini-switch" aria-hidden="true" />
                        </button>
                        <span>{module.label}</span>
                      </div>
                      <div
                        className="staff-access-actions"
                        aria-hidden={!moduleAccess.enabled}
                      >
                        {actions.map((action) => (
                          <button
                            className={`staff-access-action ${
                              moduleAccess[action.key] ? "is-on" : ""
                            }`}
                            type="button"
                            key={action.key}
                            onClick={() => toggleAccess(module.key, action.key)}
                            disabled={!moduleAccess.enabled}
                            aria-pressed={Boolean(moduleAccess[action.key])}
                          >
                            <b className="staff-mini-switch" aria-hidden="true" />
                            <span>{action.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <label className="staff-form__comment">
                <span>Комментарий</span>
                <textarea
                  value={form.comment}
                  onChange={(event) => updateForm("comment", event.target.value)}
                  placeholder="Заметка по сотруднику"
                />
              </label>
            </div>

            {false && (
              <>
            <label className="staff-photo-upload">
              <span>Фото / avatar upload</span>
              <div>
                <div className="staff-avatar staff-avatar--large">
                  {form.photo ? (
                    <img src={form.photo} alt="Avatar preview" />
                  ) : (
                    <Icon name="bi-person" size={24} />
                  )}
                </div>
                <input type="file" accept="image/*" onChange={handlePhotoChange} />
              </div>
            </label>

            <div className="staff-form__grid">
              <label>
                <span>ФИО</span>
                <input
                  required
                  value={form.fullName}
                  onChange={(event) => updateForm("fullName", event.target.value)}
                  placeholder="Имя сотрудника"
                />
              </label>
              <label>
                <span>Номер телефона</span>
                <input
                  required
                  value={form.phone}
                  onChange={(event) => updateForm("phone", event.target.value)}
                  placeholder="998..."
                />
              </label>
              <label>
                <span>Роль</span>
                <select
                  value={form.roleKey}
                  onChange={(event) => updateForm("roleKey", event.target.value)}
                >
                  {roleOptions.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>PIN-код 4 цифры</span>
                <input
                  value={form.pin}
                  maxLength={4}
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  onChange={(event) => updateForm("pin", event.target.value.replace(/\D/g, ""))}
                  placeholder="0000"
                />
              </label>
              <label>
                <span>Пароль</span>
                <div className="staff-password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(event) => updateForm("password", event.target.value)}
                    placeholder="Пароль"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    aria-pressed={showPassword}
                  >
                    <Icon name={showPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
                  </button>
                </div>
              </label>
              <label>
                <span>Доступы / permissions</span>
                <input
                  value={form.permission}
                  onChange={(event) => updateForm("permission", event.target.value)}
                  placeholder="Например: Удаления блюд"
                />
              </label>
              <label className="staff-form__status">
                <span>Статус active</span>
                <select
                  value={form.status}
                  onChange={(event) => updateForm("status", event.target.value)}
                >
                  <option value="active">Активный</option>
                  <option value="archived">Архив</option>
                </select>
              </label>
              <label className="staff-form__comment">
                <span>Комментарий</span>
                <textarea
                  value={form.comment}
                  onChange={(event) => updateForm("comment", event.target.value)}
                  placeholder="Заметка по сотруднику"
                />
              </label>
            </div>

              </>
            )}

            <div className="staff-form__footer">
              <button type="button" onClick={closeModal}>
                Отмена
              </button>
              <button type="submit">{editingId ? "Сохранить" : "Добавить"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default StaffRolePage;

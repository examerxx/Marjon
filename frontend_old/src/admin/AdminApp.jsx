import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart, CategoryScale, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import logo from "../assets/marjon-logo.svg";
import { adminApi, adminLogin, adminLogout, isAdminAuthenticated } from "./api";
import Icon from '../components/Icon';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

const SECTION_API_MAP = {
  "org-list": { endpoint: "/organizations", mapRow: (r) => [r.company_name || r.name || "", r.type || "Ресторан", String(r.branches_count || r.branch_count || 0), r.admin_name || r.owner_name || "—", r.status || "Активна"] },
  "org-status": { endpoint: "/organization-statuses", mapRow: (r) => [r.name || "", r.status || "", r.updated_at || "—", r.manager || "—", r.state || r.status || ""] },
  "storage-income": { endpoint: "/comings", mapRow: (r) => [r.document_number || r.id || "", r.provider_name || r.supplier || "", String(r.items_count || 0), `${Number(r.total || 0).toLocaleString("ru-RU")} UZS`, r.status || "Проведен"] },
  "storage-expense": { endpoint: "/storage-movements", mapRow: (r) => [r.document_number || r.id || "", r.receiver || r.destination || "", String(r.items_count || 0), `${Number(r.total || 0).toLocaleString("ru-RU")} UZS`, r.status || "Проведен"] },
  "storage-balance": { endpoint: "/reports/storage-balances", mapRow: (r) => [r.name || "", r.category || "", String(r.quantity || r.balance || 0), r.unit || "", r.status || "В норме"] },
  "storage-income-journal": { endpoint: "/reports/incomes", mapRow: (r) => [r.date || "", r.document_number || "", r.provider_name || "", `${Number(r.total || 0).toLocaleString("ru-RU")} UZS`, r.status || "Проведен"] },
  "storage-writeoff": { endpoint: "/reports/consumption", mapRow: (r) => [r.document_number || r.id || "", r.reason || "", String(r.items_count || 0), `${Number(r.total || 0).toLocaleString("ru-RU")} UZS`, r.status || "Проведен"] },
  "storage-inventory": { endpoint: "/storages", mapRow: (r) => [r.name || r.id || "", r.warehouse || r.storage_name || "", String(r.discrepancies || 0), r.date || "—", r.status || "Завершено"] },
  "nom-product": { endpoint: "/products", mapRow: null },
  "nom-sale-category": { endpoint: "/categories", mapRow: (r) => [r.name || "", r.slug || "", String(r.products_count || 0), r.sort_order != null ? String(r.sort_order) : "—", r.status ? "Активна" : "Неактивна"] },
  "nom-orders": { endpoint: "/orders", mapRow: (r) => [r.order_number || r.id || "", r.date || r.created_at || "", r.customer || "—", `${Number(r.total || 0).toLocaleString("ru-RU")} UZS`, r.status || ""] },
  "nom-unit": { endpoint: "/units", mapRow: (r) => [r.name || "", r.short_name || r.code || "", r.type || "—", r.is_base ? "Базовая" : "—", r.status !== false ? "Активна" : "Неактивна"] },
  "hb-countries": { endpoint: "/countries", mapRow: (r) => [r.name || "", r.code || r.iso || "", r.phone_code || "", r.currency || "—", r.status !== false ? "Активна" : "Неактивна"] },
  "hb-regions": { endpoint: "/regions", mapRow: (r) => [r.name || "", r.country_name || r.country || "", r.code || "—", String(r.districts_count || 0), r.status !== false ? "Активна" : "Неактивна"] },
  "hb-districts": { endpoint: "/districts", mapRow: (r) => [r.name || "", r.region_name || r.region || "", r.code || "—", "—", r.status !== false ? "Активна" : "Неактивна"] },
  "srv-employees": { endpoint: "/departments", mapRow: (r) => [r.name || "", r.position || r.role || "—", r.department || "—", r.privileges || "—", r.status !== false ? "Активна" : "Неактивна"] },
  "srv-source": { endpoint: "/sources", mapRow: (r) => [r.name || "", r.type || "—", r.url || "—", String(r.leads_count || 0), r.status !== false ? "Активна" : "Неактивна"] },
  "bank-stats": { endpoint: "/reports/debt-credit", mapRow: null },
  "bank-transactions": { endpoint: "/finance/transactions", mapRow: null },
  "set-store": { endpoint: "/store-versions", mapRow: (r) => [r.version || r.name || "", r.platform || "—", r.release_date || "—", r.status || "Активна"] },
  "set-cashier-bg": { endpoint: "/image-backgrounds", mapRow: null },
  "set-languages": { endpoint: "/languages", mapRow: (r) => [r.name || "", r.code || "", r.is_default ? "Да" : "Нет", r.status !== false ? "Активна" : "Неактивна"] },
};

function useAdminData(sectionKey) {
  const [apiRows, setApiRows] = useState([]);

  useEffect(() => {
    const mapping = SECTION_API_MAP[sectionKey];
    if (!mapping) return;
    adminApi.get(mapping.endpoint, { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        setApiRows(mapping.mapRow ? items.map(mapping.mapRow) : []);
      })
      .catch(() => setApiRows([]));
  }, [sectionKey]);

  return { apiRows };
}

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

const kpis = [
  {
    title: "Всего организаций",
    value: "0",
    delta: "—",
    icon: "bi-buildings",
    tone: "blue",
    dataKey: "organizations",
    points: [16, 22, 18, 34, 30, 46, 42, 56],
    desc: "Всего подключённых организаций на платформе MARJON, включая активные и на модерации.",
  },
  {
    title: "Активных филиалов",
    value: "0",
    delta: "—",
    icon: "bi-diagram-3",
    tone: "green",
    dataKey: "branches",
    points: [18, 24, 32, 28, 42, 48, 51, 60],
    desc: "Филиалы с активной кассой и работающей синхронизацией за выбранный период.",
  },
  {
    title: "Ожидают одобрения",
    value: "0",
    delta: "—",
    icon: "bi-inbox",
    tone: "violet",
    dataKey: "subscriptions",
    points: [58, 48, 52, 42, 39, 35, 30, 26],
    desc: "Заявки на подключение, изменение тарифа и услуги, ожидающие решения модератора.",
  },
  {
    title: "Оборот за месяц",
    value: "0 UZS",
    delta: "—",
    icon: "bi-graph-up-arrow",
    tone: "orange",
    dataKey: "revenue",
    points: [20, 26, 31, 44, 40, 55, 63, 72],
    desc: "Суммарный оборот всех организаций платформы за текущий месяц в узбекских сумах.",
  },
  {
    title: "Активных касс",
    value: "0",
    delta: "—",
    icon: "bi-pc-display",
    tone: "cyan",
    dataKey: "cashboxes",
    points: [18, 22, 28, 27, 35, 42, 47, 55],
    desc: "Подключённые кассовые рабочие места с активной синхронизацией.",
  },
];

const organizationRows = [];

const organizationDirectoryRows = [
  {
    id: "1002945",
    message: true,
    service: "Yangi",
    paymentType: "Без оплаты",
    name: "MUSTAFO CAFE",
    clientId: "1002945",
    terminals: "0",
    cashboxes: "2",
    deposit: "0",
    debt: "2 000 000",
    overdue: "0",
    contract: "0",
    tariff: "300 000",
    currency: "UZS",
    contact: "998 88 752 11 10",
    region: "Andijon",
    manager: "SAITOV SARVAR",
    date: "02.07.2026",
    source: "Diler",
    version: "15.04",
    orgStatus: "ISHLA TURGAN",
    identification: "Проверено",
    paymentKind: "Тариф платежи",
    status: "Доступен",
    onlineMenu: "Активно",
    warehouse: "Активно",
    cashboxOnline: "Активно",
  },
  {
    id: "1002944",
    message: true,
    service: "Xizmat",
    paymentType: "Без оплаты",
    name: "BAYKAL RESTAURANT",
    clientId: "1002944",
    terminals: "0",
    cashboxes: "0",
    deposit: "0",
    debt: "0",
    overdue: "0",
    contract: "0",
    tariff: "300 000",
    currency: "UZS",
    contact: "998 20 004 62 42",
    region: "Andijon",
    manager: "SAITOV SARVAR",
    date: "02.07.2026",
    source: "Diler",
    version: "15.04",
    orgStatus: "ISHLA TURGAN",
    identification: "Проверено",
    paymentKind: "Тариф платежи",
    status: "Доступен",
    onlineMenu: "Активно",
    warehouse: "Активно",
    cashboxOnline: "Активно",
  },
  {
    id: "1002939",
    message: true,
    service: "Xizmat",
    paymentType: "Без оплаты",
    name: "Burger",
    clientId: "1002939",
    terminals: "0",
    cashboxes: "0",
    deposit: "0",
    debt: "0",
    overdue: "0",
    contract: "1 500 000",
    tariff: "300 000",
    currency: "UZS",
    contact: "998 77 103 20 80",
    region: "Namangan",
    manager: "HAMZAYEV SARDOR",
    date: "01.07.2026",
    source: "Instagram",
    version: "",
    orgStatus: "USTANOVKA JARAYONIDA",
    identification: "Ожидает",
    paymentKind: "Тариф платежи",
    status: "Активно",
    onlineMenu: "Активно",
    warehouse: "Не активно",
    cashboxOnline: "Активно",
  },
  {
    id: "1002938",
    message: true,
    service: "Xizmat",
    paymentType: "Без оплаты",
    name: "Сушихона Мукаммал",
    clientId: "1002938",
    terminals: "0",
    cashboxes: "0",
    deposit: "0",
    debt: "0",
    overdue: "0",
    contract: "7 880 000",
    tariff: "300 000",
    currency: "UZS",
    contact: "998 90 577 50 20",
    region: "Andijon",
    manager: "MIRYEVANOV BOTUV",
    date: "30.06.2026",
    source: "Telegram",
    version: "",
    orgStatus: "USTANOVKA JARAYONIDA",
    identification: "Ожидает",
    paymentKind: "Тариф платежи",
    status: "Не активно",
    onlineMenu: "Активно",
    warehouse: "Активно",
    cashboxOnline: "Не активно",
  },
  {
    id: "1002937",
    message: true,
    service: "Xizmat",
    paymentType: "Без оплаты",
    name: "Zarafshon baliqlari",
    clientId: "1002937",
    terminals: "1",
    cashboxes: "0",
    deposit: "-320 000",
    debt: "-2 400 000",
    overdue: "0",
    contract: "0",
    tariff: "300 000",
    currency: "UZS",
    contact: "998 94 047 37 77",
    region: "Samarqand",
    manager: "ALAMAT SOTUV",
    date: "30.06.2026",
    source: "Facebook",
    version: "",
    orgStatus: "HALI ULANMAGAN",
    identification: "Ожидает",
    paymentKind: "Тариф платежи",
    status: "Не активно",
    onlineMenu: "Активно",
    warehouse: "Не активно",
    cashboxOnline: "Не активно",
  },
  {
    id: "1002936",
    message: true,
    service: "Xizmat",
    paymentType: "Без оплаты",
    name: "Bek Food 2",
    clientId: "1002936",
    terminals: "0",
    cashboxes: "1",
    deposit: "0",
    debt: "-7 514 000",
    overdue: "0",
    contract: "0",
    tariff: "300 000",
    currency: "UZS",
    contact: "998 99 176 09 55",
    region: "JIZZAX",
    manager: "BOBOMURODOV",
    date: "29.06.2026",
    source: "Sarlavha",
    version: "15.04",
    orgStatus: "HALI ULANMAGAN",
    identification: "Проверено",
    paymentKind: "Тариф платежи",
    status: "Активно",
    onlineMenu: "Активно",
    warehouse: "Активно",
    cashboxOnline: "Активно",
  },
  {
    id: "1002935",
    message: true,
    service: "Xizmat",
    paymentType: "Без оплаты",
    name: "AROUVSOT OTA OSHXONASI",
    clientId: "1002935",
    terminals: "0",
    cashboxes: "0",
    deposit: "0",
    debt: "0",
    overdue: "0",
    contract: "4 480 000",
    tariff: "300 000",
    currency: "UZS",
    contact: "998 90 105 56 28",
    region: "Fargona",
    manager: "HAMZAYEV SARDOR",
    date: "28.06.2026",
    source: "Facebook",
    version: "",
    orgStatus: "HALI ULANMAGAN",
    identification: "Ожидает",
    paymentKind: "Тариф платежи",
    status: "Не активно",
    onlineMenu: "Активно",
    warehouse: "Активно",
    cashboxOnline: "Активно",
  },
  {
    id: "1002934",
    message: true,
    service: "Xizmat",
    paymentType: "Без оплаты",
    name: "Chickenlar",
    clientId: "1002934",
    terminals: "0",
    cashboxes: "0",
    deposit: "0",
    debt: "0",
    overdue: "0",
    contract: "3 530 000",
    tariff: "300 000",
    currency: "UZS",
    contact: "998 90 704 67 44",
    region: "Samarqand",
    manager: "HAMZAYEV SARDOR",
    date: "28.06.2026",
    source: "Facebook",
    version: "",
    orgStatus: "HALI ULANMAGAN",
    identification: "Ожидает",
    paymentKind: "Тариф платежи",
    status: "Не активно",
    onlineMenu: "Активно",
    warehouse: "Не активно",
    cashboxOnline: "Не активно",
  },
  {
    id: "1002933",
    message: true,
    service: "Xizmat",
    paymentType: "Без оплаты",
    name: "Negora",
    clientId: "1002933",
    terminals: "0",
    cashboxes: "0",
    deposit: "-390 000",
    debt: "0",
    overdue: "0",
    contract: "3 850 000",
    tariff: "300 000",
    currency: "UZS",
    contact: "998 77 103 15 96",
    region: "Surxondaryo",
    manager: "HAMZAYEV SARDOR",
    date: "28.06.2026",
    source: "Facebook",
    version: "15.04",
    orgStatus: "HALI ULANMAGAN",
    identification: "Ожидает",
    paymentKind: "Тариф платежи",
    status: "Не активно",
    onlineMenu: "Активно",
    warehouse: "Не активно",
    cashboxOnline: "Не активно",
  },
  {
    id: "1002932",
    message: false,
    service: "Yangi",
    paymentType: "Тест",
    name: "Ака-ука Restaurant",
    clientId: "1002932",
    terminals: "0",
    cashboxes: "0",
    deposit: "-320 000",
    debt: "-15 000",
    overdue: "0",
    contract: "0",
    tariff: "300 000",
    currency: "UZS",
    contact: "998 91 238 90 62",
    region: "Surxondaryo",
    manager: "HAMZAYEV SARDOR",
    date: "27.06.2026",
    source: "Ko'cha",
    version: "",
    orgStatus: "ISHLA TURGAN",
    identification: "Проверено",
    paymentKind: "Тест платежи",
    status: "Доступен",
    onlineMenu: "Активно",
    warehouse: "Активно",
    cashboxOnline: "Активно",
  },
  {
    id: "1002931",
    message: true,
    service: "Xizmat",
    paymentType: "Без оплаты",
    name: "GOLDEN UZBECHIM",
    clientId: "1002931",
    terminals: "0",
    cashboxes: "0",
    deposit: "-4 000 000",
    debt: "-1 440 000",
    overdue: "0",
    contract: "0",
    tariff: "300 000",
    currency: "UZS",
    contact: "998 99 056 38 97",
    region: "Samarqand",
    manager: "ZARIPOV JASUR",
    date: "27.06.2026",
    source: "Sarlavha",
    version: "15.04",
    orgStatus: "ISHLA TURGAN",
    identification: "Проверено",
    paymentKind: "Тариф платежи",
    status: "Доступен",
    onlineMenu: "Активно",
    warehouse: "Активно",
    cashboxOnline: "Активно",
  },
];

const approvalItems = [];

const systemItems = [];

const organizationStatusRows = [
  { id: "closed-bankrupt", name: "JOY YOPILGAN BONKROT", sort: 4, active: true },
  { id: "installing", name: "USTANOVKA JARAYONIDA", sort: 2, active: true },
  { id: "install-canceled", name: "USTANOVKA OTMEN BO'LGANI", sort: 8, active: true },
  { id: "returning", name: "QAYTARISHGA HARAKAT", sort: 7, active: true },
  { id: "test", name: "TEST", sort: 6, active: true },
  { id: "duplicate", name: "DUBLIKAT", sort: 5, active: true },
  { id: "moved-pr", name: "Y-N YOKI B-QA PR-GA O'TGAN", sort: 4, active: true },
  { id: "unknown", name: "SABABI NOMALUM", sort: 3, active: true },
  { id: "temporary-paused", name: "VAQTICHALI ISHLAMAYOTGAN", sort: 2, active: true },
  { id: "not-connected", name: "HALI ULANMAGAN", sort: 3, active: true },
  { id: "working", name: "ISHLAB TURGAN", sort: 1, active: true },
];

const productBranchRows = [
  { branch: "Хоразм филиал", income: 0, inventory: 0 },
  { branch: "Anqara", income: 0, inventory: 0 },
  { branch: "Тошкент филиал", income: 0, inventory: 0 },
  { branch: "Денов филиал", income: 0, inventory: 0 },
  { branch: "Фарғона филиал", income: 5160000, inventory: 0 },
  { branch: "Нурафшон филиал", income: 2283000, inventory: 0 },
  { branch: "Test Fillial", income: 0, inventory: 0 },
  { branch: "Андижон филиал", income: 0, inventory: 0 },
  { branch: "Нукус филиал", income: 0, inventory: 0 },
  { branch: "Сирдарё филиал", income: 0, inventory: 0 },
  { branch: "Самарканд филиал", income: 8063000, inventory: 0 },
  { branch: "Бухоро филиал", income: 0, inventory: 0 },
  { branch: "Жиззах филиал", income: 0, inventory: 0 },
  { branch: "Навоий филиал", income: 7320000, inventory: 0 },
  { branch: "Термиз филиал", income: 9020000, inventory: 0 },
  { branch: "Қарши филиал", income: 0, inventory: 0 },
  { branch: "Наманган филиал", income: 0, inventory: 0 },
  { branch: "Бош филиал", income: 34600000, inventory: 0 },
];

const categoryContent = {
  // 1) Организации
  "org-list": {
    title: "Организации",
    text: "Все организации платформы MARJON: типы, филиалы и администраторы.",
    columns: ["Организация", "Тип", "Филиалов", "Админ", "Статус"],
    rows: organizationRows.map(([name, type, branches, admin, , status]) => [name, type, branches, admin, status]),
  },
  "org-status": {
    title: "Статус организаций",
    text: "Текущие статусы подключения, модерации и блокировки клиентов.",
    columns: ["Организация", "Статус", "Изменён", "Ответственный", "Состояние"],
    rows: [
      ["Bella Italia Group", "Активна", "11.06.2026", "Александр П.", "Активна"],
      ["Coffee House", "Активна", "11.06.2026", "О. Ташматов", "Активна"],
      ["Sushi Master", "На модерации", "11.06.2026", "Д. Юнусов", "На модерации"],
      ["Burger Station", "Новый", "10.06.2026", "М. Саидов", "Новый"],
    ],
  },

  // 2) Отделы — управление сотрудниками и привилегиями
  departments: {
    title: "Отделы — управление сотрудниками",
    text: "Сотрудники платформы, роли, отделы и настройка привилегий доступа.",
    columns: ["Сотрудник", "Должность", "Отдел", "Привилегии", "Статус"],
    rows: [
      ["Александр П.", "Суперадмин", "Управление", "Полный доступ", "Активна"],
      ["М. Саидов", "Менеджер продаж", "Продажи", "Продажи, Отчеты", "Активна"],
      ["Д. Юнусов", "Внедренец", "Внедрение", "Организации, Склад", "Активна"],
      ["С. Абдуллаев", "Поддержка", "Поддержка", "Заявки, Чаты", "Активна"],
      ["О. Ташматов", "Финансист", "Финансы", "Финансы, Банк", "На модерации"],
    ],
  },

  // 3) Склад
  "storage-income": {
    title: "Приход товаров",
    text: "Документы прихода товаров от поставщиков на склады организаций.",
    columns: ["Документ", "Поставщик", "Позиций", "Сумма", "Статус"],
    rows: [
      ["PR-10241", "Bella Foods", "32", "18 420 000 UZS", "Проведен"],
      ["PR-10238", "Coffee Trade", "12", "4 120 000 UZS", "Проведен"],
      ["PR-10235", "Fresh Market", "48", "27 800 000 UZS", "Черновик"],
    ],
  },
  "storage-expense": {
    title: "Расход товаров",
    text: "Списание товаров со склада на кухни, бары и точки продаж.",
    columns: ["Документ", "Получатель", "Позиций", "Сумма", "Статус"],
    rows: [
      ["RS-8841", "Кухня — Ташкент", "18", "6 240 000 UZS", "Проведен"],
      ["RS-8836", "Бар — Ургенч", "9", "1 820 000 UZS", "Проведен"],
      ["RS-8830", "Кухня — Денов", "14", "3 460 000 UZS", "Ожидает"],
    ],
  },
  "storage-balance": {
    title: "Остаток",
    text: "Текущие остатки товаров и сырья по складам организаций.",
    columns: ["Товар", "Категория", "Остаток", "Ед.", "Статус"],
    rows: [
      ["Мука в/с", "Сырьё", "1 240", "кг", "В норме"],
      ["Оливковое масло", "Сырьё", "86", "л", "Низкий"],
      ["Кофе зерно", "Сырьё", "410", "кг", "В норме"],
    ],
  },
  "storage-income-journal": {
    title: "Журнал приходов",
    text: "История всех приходных документов с датами и суммами.",
    columns: ["Дата", "Документ", "Поставщик", "Сумма", "Статус"],
    rows: [
      ["11.06.2026 09:12", "PR-10241", "Bella Foods", "18 420 000 UZS", "Проведен"],
      ["10.06.2026 17:40", "PR-10238", "Coffee Trade", "4 120 000 UZS", "Проведен"],
      ["10.06.2026 11:05", "PR-10235", "Fresh Market", "27 800 000 UZS", "Черновик"],
    ],
  },
  "storage-writeoff": {
    title: "Отход товаров",
    text: "Списание товаров по причинам брака, порчи и истечения срока.",
    columns: ["Документ", "Причина", "Позиций", "Сумма", "Статус"],
    rows: [
      ["WO-321", "Истёк срок", "6", "420 000 UZS", "Проведен"],
      ["WO-318", "Брак", "3", "180 000 UZS", "Проведен"],
      ["WO-314", "Порча", "8", "640 000 UZS", "Ожидает"],
    ],
  },
  "storage-inventory": {
    title: "Инвентаризация",
    text: "Сверка фактических остатков со складским учётом и расхождения.",
    columns: ["Документ", "Склад", "Расхождений", "Дата", "Статус"],
    rows: [
      ["INV-077", "Главный склад", "4", "11.06.2026", "Завершено"],
      ["INV-076", "Бар", "0", "08.06.2026", "Завершено"],
      ["INV-075", "Кухня", "2", "01.06.2026", "Черновик"],
    ],
  },

  // 4) Номенклатура
  "nom-product": {
    title: "Продукт",
    text: "Карточки продуктов: категории, цены и единицы измерения.",
    columns: ["Продукт", "Категория", "Цена", "Ед.", "Статус"],
    rows: [
      ["Маргарита 30см", "Пицца", "48 000 UZS", "шт", "Активна"],
      ["Цезарь с курицей", "Салаты", "36 000 UZS", "шт", "Активна"],
      ["Латте 0.3", "Напитки", "22 000 UZS", "шт", "Новый"],
    ],
  },
  "nom-sale-category": {
    title: "Категория реализации",
    text: "Категории меню для реализации и их доля в продажах.",
    columns: ["Категория", "Позиций", "Доля продаж", "Обновлено", "Статус"],
    rows: [
      ["Пицца", "42", "28.4%", "11.06.2026", "Активна"],
      ["Напитки", "36", "19.1%", "11.06.2026", "Активна"],
      ["Десерты", "18", "7.6%", "10.06.2026", "Новый"],
    ],
  },
  "nom-orders": {
    title: "Заказы",
    text: "Заказы по филиалам с суммами, временем и статусом выполнения.",
    columns: ["Заказ", "Филиал", "Сумма", "Время", "Статус"],
    rows: [
      ["№ 39957057", "Ташкент", "240 600 UZS", "20:57", "Завершено"],
      ["№ 39661785", "Ургенч", "177 100 UZS", "20:56", "Завершено"],
      ["№ 39382298", "Денов", "110 000 UZS", "17:59", "Ожидает"],
    ],
  },
  "nom-unit": {
    title: "Единица измерения",
    text: "Единицы измерения номенклатуры и их точность.",
    columns: ["Единица", "Сокращение", "Тип", "Точность", "Статус"],
    rows: [
      ["Килограмм", "кг", "Вес", "0.001", "Активна"],
      ["Литр", "л", "Объём", "0.01", "Активна"],
      ["Штука", "шт", "Количество", "1", "Активна"],
    ],
  },

  // 5) Справочник
  "hb-countries": {
    title: "Страны",
    text: "Справочник стран: коды, валюты и количество регионов.",
    columns: ["Страна", "Код", "Валюта", "Регионов", "Статус"],
    rows: [
      ["Узбекистан", "UZ", "UZS", "14", "Активна"],
      ["Казахстан", "KZ", "KZT", "17", "Активна"],
      ["Таджикистан", "TJ", "TJS", "4", "Новый"],
    ],
  },
  "hb-regions": {
    title: "Регионы",
    text: "Регионы стран с количеством районов и кодами.",
    columns: ["Регион", "Страна", "Районов", "Код", "Статус"],
    rows: [
      ["Ташкент", "Узбекистан", "11", "TAS", "Активна"],
      ["Хорезм", "Узбекистан", "10", "XOR", "Активна"],
      ["Сурхандарья", "Узбекистан", "14", "SUR", "Активна"],
    ],
  },
  "hb-districts": {
    title: "Районы",
    text: "Районы регионов с кодами и датой последнего изменения.",
    columns: ["Район", "Регион", "Код", "Обновлён", "Статус"],
    rows: [
      ["Юнусабадский", "Ташкент", "TAS-01", "11.06.2026", "Активна"],
      ["Ургенчский", "Хорезм", "XOR-03", "10.06.2026", "Активна"],
      ["Денауский", "Сурхандарья", "SUR-05", "09.06.2026", "Новый"],
    ],
  },

  // 6) Услуга
  "srv-employees": {
    title: "Сотрудники",
    text: "Сотрудники клиентов: роли, филиалы и контактные данные.",
    columns: ["Сотрудник", "Роль", "Филиал", "Телефон", "Статус"],
    rows: [
      ["И. Каримов", "Менеджер", "Ташкент", "+998 90 123-45-67", "Активна"],
      ["О. Ташматов", "Кассир", "Ургенч", "+998 91 234-56-78", "Активна"],
      ["А. Рахимов", "Официант", "Денов", "+998 93 345-67-89", "Новый"],
    ],
  },
  "srv-source": {
    title: "Источник",
    text: "Источники привлечения клиентов и их конверсия.",
    columns: ["Источник", "Тип", "Лидов", "Конверсия", "Статус"],
    rows: [
      ["Instagram", "Соцсети", "184", "18.4%", "Активна"],
      ["Telegram", "Мессенджер", "96", "21.8%", "Активна"],
      ["Рекомендации", "Партнёры", "43", "32.2%", "Новый"],
    ],
  },

  // 7) Банк
  "bank-stats": {
    title: "Статистика банка",
    text: "Сводная статистика банковских операций за период.",
    columns: ["Показатель", "Значение", "Динамика", "Период", "Статус"],
    rows: [
      ["Эквайринг", "4 820 000 000 UZS", "+12.4%", "Месяц", "В норме"],
      ["Комиссия", "48 200 000 UZS", "+0.8%", "Месяц", "В норме"],
      ["Возвраты", "2 140 000 UZS", "-3.1%", "Месяц", "В норме"],
    ],
  },
  "bank-transactions": {
    title: "Транзакции банка",
    text: "Банковские транзакции по платежам и возвратам.",
    columns: ["ID", "Тип", "Сумма", "Время", "Статус"],
    rows: [
      ["TXN-88421", "Поступление", "240 600 UZS", "20:57", "Завершено"],
      ["TXN-88417", "Поступление", "177 100 UZS", "20:56", "Завершено"],
      ["TXN-88410", "Возврат", "110 000 UZS", "17:59", "Ожидает"],
    ],
  },

  // 8) Финансы
  "fin-operations": {
    title: "Денежные операции",
    text: "Приходные и расходные денежные операции платформы.",
    columns: ["Документ", "Тип", "Сумма", "Способ", "Статус"],
    rows: [
      ["OP-2241", "Приход", "240 600 UZS", "CLICK", "Проведен"],
      ["OP-2238", "Расход", "110 000 UZS", "Наличные", "Проведен"],
      ["OP-2235", "Приход", "177 100 UZS", "Terminal", "Ожидает"],
    ],
  },
  "fin-income-cat": {
    title: "Категория приходов",
    text: "Категории приходов с долей в общем обороте.",
    columns: ["Категория", "Операций", "Сумма", "Доля", "Статус"],
    rows: [
      ["Приход от продаж", "1 284", "742 000 000 UZS", "82.4%", "Активна"],
      ["Прочие поступления", "96", "41 200 000 UZS", "12.1%", "Активна"],
      ["Возвраты", "18", "4 800 000 UZS", "5.5%", "Новый"],
    ],
  },
  "fin-expense-cat": {
    title: "Категория расходов",
    text: "Категории расходов с долей в общих затратах.",
    columns: ["Категория", "Операций", "Сумма", "Доля", "Статус"],
    rows: [
      ["Закупка сырья", "412", "318 000 000 UZS", "61.2%", "Активна"],
      ["Зарплата", "58", "142 000 000 UZS", "27.4%", "Активна"],
      ["Аренда", "12", "38 000 000 UZS", "7.3%", "Активна"],
    ],
  },
  "fin-payment": {
    title: "Способ оплаты",
    text: "Способы оплаты, объёмы операций и комиссии.",
    columns: ["Способ", "Операций", "Сумма", "Комиссия", "Статус"],
    rows: [
      ["Наличные", "642", "284 000 000 UZS", "0%", "Активна"],
      ["CLICK", "418", "196 000 000 UZS", "0.8%", "Активна"],
      ["Terminal", "224", "162 000 000 UZS", "1.2%", "Активна"],
    ],
  },
  "fin-history": {
    title: "История изменений",
    text: "Журнал изменений финансовых настроек и объектов.",
    columns: ["Дата", "Объект", "Действие", "Автор", "Статус"],
    rows: [
      ["11.06.2026 11:42", "Тариф Bella Italia", "Изменён", "Александр П.", "Завершено"],
      ["10.06.2026 17:40", "Категория расходов", "Создана", "О. Ташматов", "Завершено"],
      ["09.06.2026 09:18", "Способ оплаты", "Удалён", "Д. Юнусов", "Ожидает"],
    ],
  },

  // 9) Настройки
  "set-store": {
    title: "Marjon store",
    text: "Подключённые модули магазина MARJON и их подписки.",
    columns: ["Модуль", "Версия", "Подписка", "Обновлён", "Статус"],
    rows: [
      ["POS Касса", "2.4.7", "Pro", "11.06.2026", "Активна"],
      ["QR-меню", "1.8.2", "Pro", "10.06.2026", "Активна"],
      ["Аналитика", "3.1.0", "Trial", "09.06.2026", "Новый"],
    ],
  },
  "set-cashier-bg": {
    title: "Фон для кассира",
    text: "Темы и фоны интерфейса кассира по точкам продаж.",
    columns: ["Тема", "Тип", "Применена к", "Обновлён", "Статус"],
    rows: [
      ["Тёмная графитовая", "Системная", "Все кассы", "11.06.2026", "Активна"],
      ["Светлая", "Системная", "Ургенч", "10.06.2026", "Активна"],
      ["Брендовая Marjon", "Кастом", "Ташкент", "09.06.2026", "Новый"],
    ],
  },
  "set-languages": {
    title: "Языки",
    text: "Языки интерфейса платформы и их покрытие переводами.",
    columns: ["Язык", "Код", "Покрытие", "Обновлён", "Статус"],
    rows: [
      ["Русский", "RU", "100%", "11.06.2026", "Активна"],
      ["Узбекский", "UZ", "98%", "11.06.2026", "Активна"],
      ["Английский", "EN", "72%", "10.06.2026", "Новый"],
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

const datePresets = [
  "Сегодня",
  "Вчера",
  "Эта неделя",
  "Этот месяц",
  "Прошлый месяц",
  "Этот квартал",
  "Прошлый квартал",
  "Этот год",
  "Прошлый год",
];

function padDate(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${padDate(date.getDate())}.${padDate(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function parseDate(value) {
  const [day, month, year] = value.split(".").map(Number);
  return new Date(year || 2026, (month || 1) - 1, day || 1);
}

function rangeLabel(range) {
  return range.start === range.end ? range.start : `${range.start} - ${range.end}`;
}

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} UZS`;
}

const financeOperationTotals = {
  income: 3778653810,
  expense: 2671477891,
};

const financeOperationRows = [
  {
    id: "money-42142689",
    date: "04 Jul 2026",
    time: "21:25",
    amount: -720000,
    paymentType: "—",
    counterparty: "—",
    category: "Продажа в долг",
    organization: "Бош филиал",
    comment: "Заказ № 42142689: Xprinter mini printer, model: XP - 80 TS x 1",
  },
  {
    id: "money-42142750",
    date: "04 Jul 2026",
    time: "21:25",
    amount: -240000,
    paymentType: "—",
    counterparty: "—",
    category: "Продажа в долг",
    organization: "Бош филиал",
    comment: "Заказ № 42142750: MERCURY SG108 C (ХАП) x 1",
  },
  {
    id: "money-42143611",
    date: "04 Jul 2026",
    time: "21:25",
    amount: -4200000,
    paymentType: "—",
    counterparty: "—",
    category: "Продажа в долг",
    organization: "Бош филиал",
    comment: "Заказ № 42143611: Моноблок - 15 Inch Monitor model: TSM-1514 (8-128 GB, Windows Cash Register) x 1",
  },
  {
    id: "money-42422642",
    date: "04 Jul 2026",
    time: "11:48",
    amount: -240000,
    paymentType: "—",
    counterparty: "—",
    category: "Продажа в долг",
    organization: "Бош филиал",
    comment: "Заказ № 42422642: Tenda SG 108 8 Gigabit Power x 1",
  },
  {
    id: "money-20260703-2100",
    date: "03 Jul 2026",
    time: "21:00",
    amount: 1700000,
    paymentType: "Наличные",
    counterparty: "Admin 01",
    category: "Пополнение кассы",
    organization: "Нурафшон филиал",
    comment: "02.07.2026",
  },
  {
    id: "money-20260703-2052",
    date: "03 Jul 2026",
    time: "20:52",
    amount: 580000,
    paymentType: "Наличные",
    counterparty: "Admin 01",
    category: "Пополнение кассы",
    organization: "Наманган филиал",
    comment: "02.07.2026",
  },
  {
    id: "money-20260703-2043-income",
    date: "03 Jul 2026",
    time: "20:43",
    amount: 5600000,
    paymentType: "Наличные",
    counterparty: "Admin 01",
    category: "Инкассация",
    organization: "Наманган филиал",
    comment: "Эркин олган",
  },
  {
    id: "money-20260703-2043-expense",
    date: "03 Jul 2026",
    time: "20:43",
    amount: -4200000,
    paymentType: "—",
    counterparty: "—",
    category: "Продажа в долг",
    organization: "Бош филиал",
    comment: "Заказ № 42143611: Моноблок - 15 Inch Monitor model: TSM-1514 (8-128 GB, Windows Cash Register) x 1",
  },
  {
    id: "money-20260703-2042",
    date: "03 Jul 2026",
    time: "20:42",
    amount: 1000000,
    paymentType: "Наличные",
    counterparty: "Admin 01",
    category: "Инкассация",
    organization: "Фарғона филиал",
    comment: "Эркин олган",
  },
  {
    id: "money-20260703-2040",
    date: "03 Jul 2026",
    time: "20:40",
    amount: 760000,
    paymentType: "Наличные",
    counterparty: "Admin 01",
    category: "Инкассация",
    organization: "Наманган филиал",
    comment: "Эркин олган",
  },
  {
    id: "money-20260703-1846",
    date: "03 Jul 2026",
    time: "18:46",
    amount: 7820000,
    paymentType: "Перечисление",
    counterparty: "Поставщик",
    category: "Закупка товара",
    organization: "Наманган филиал",
    comment: "Закупку товара. Товарный лист №83618",
  },
  {
    id: "money-20260703-1737",
    date: "03 Jul 2026",
    time: "17:37",
    amount: 10000,
    paymentType: "Наличные",
    counterparty: "—",
    category: "Прочее поступление",
    organization: "Сирдарё филиал",
    comment: "—",
  },
];

const incomeCategoryRows = [
  { id: "income-sales", name: "Приход от продаж", status: "#активно", locked: true },
  { id: "income-opening", name: "Стартовый баланс", status: "#активно", locked: true },
  { id: "income-debt-sale", name: "Продажа в долг", status: "#активно", locked: true },
  { id: "income-vip-sale", name: "Продажа в VIP", status: "#активно", locked: true },
  { id: "income-oylik-tolov", name: "Oylik to'lov", status: "#активно", locked: false },
  { id: "income-pochta", name: "Pochta", status: "#активно", locked: false },
  { id: "income-taksi", name: "Taksi", status: "#активно", locked: false },
  { id: "income-pochta-upper", name: "POCHTA", status: "#активно", locked: false },
  { id: "income-obed", name: "Obed", status: "#активно", locked: false },
  { id: "income-oylik-ish", name: "OYLIK ISH HAQI", status: "#активно", locked: false },
  { id: "income-arenda", name: "Arenda", status: "#активно", locked: false },
  { id: "income-qarz", name: "Qarz yopish", status: "#активно", locked: false },
  { id: "income-pochta-branch", name: "POCHTA filial", status: "#активно", locked: false },
  { id: "income-filial-open", name: "FILIAL OCHISHI", status: "#активно", locked: false },
];

const expenseCategoryRows = [
  { id: "expense-purchase", name: "Закупка товара", status: "#активно", locked: false },
  { id: "expense-salary", name: "Зарплата", status: "#активно", locked: false },
  { id: "expense-rent", name: "Аренда", status: "#активно", locked: false },
  { id: "expense-utilities", name: "Коммунальные услуги", status: "#активно", locked: false },
  { id: "expense-delivery", name: "Доставка", status: "#активно", locked: false },
  { id: "expense-marketing", name: "Маркетинг", status: "#активно", locked: false },
  { id: "expense-taksi", name: "Taksi", status: "#активно", locked: false },
  { id: "expense-repair", name: "Ремонт оборудования", status: "#активно", locked: false },
  { id: "expense-refund", name: "Возврат клиенту", status: "#активно", locked: false },
  { id: "expense-tax", name: "Налоги", status: "#активно", locked: false },
  { id: "expense-bank", name: "Комиссия банка", status: "#активно", locked: false },
  { id: "expense-other", name: "Прочие расходы", status: "#активно", locked: false },
  { id: "expense-qarz", name: "Qarz yopish", status: "#активно", locked: false },
];

const paymentMethodRows = [
  { id: "payment-transfer", sort: 1, name: "Pul O'tkazish", type: "Карта", status: "#активно", vip: false },
  { id: "payment-cash", sort: 2, name: "Наличные", type: "Наличные", status: "#активно", vip: false },
  { id: "payment-click", sort: 3, name: "CLICK", type: "Онлайн", status: "#активно", vip: true },
  { id: "payment-terminal", sort: 4, name: "Terminal", type: "Карта", status: "#активно", vip: false },
];

const financeHistoryRows = [
  { id: "hist-6162", number: 1, recordId: "6162", date: "04.07.2026 / 15:26", companyId: "1002708", organization: "Danok 3", newAmount: "1 700 000 UZS", oldAmount: "1 288 000 UZS", type: "Изменено", user: "Sardor Hamzayev Admin", comment: "xato kiritilgan" },
  { id: "hist-6153", number: 2, recordId: "6153", date: "03.07.2026 / 19:24", companyId: "1002628", organization: "Luck 6", newAmount: "300 000 UZS", oldAmount: "390 000 UZS", type: "Изменено", user: "Sardor Hamzayev Admin", comment: "JASUR AXMEDOV 300MING QILIB BERGAN EKAN OYLIK TULOVINI" },
  { id: "hist-6132", number: 3, recordId: "6132", date: "02.07.2026 / 22:15", companyId: "1002048", organization: "Bambino", newAmount: "3 140 000 UZS", oldAmount: "7 961 000 UZS", type: "Изменено", user: "Sardor Hamzayev Admin", comment: "KLIENTDAN TEXNIKALAR YECHIB OLINGAN ANCHA VAQT TULAMAGANLIGI UCHUN" },
  { id: "hist-6131", number: 4, recordId: "6131", date: "02.07.2026 / 22:14", companyId: "1002048", organization: "Bambino", newAmount: "7 961 000 UZS", oldAmount: "7 961 000 UZS", type: "Изменено", user: "Sardor Hamzayev Admin", comment: "texnikalar qaytarib yechib olingan sababi klient tulov qilish imkoni yuq ekan programmani ishlatmas ekan Fargona Filiali!" },
  { id: "hist-6118", number: 5, recordId: "6118", date: "02.07.2026 / 20:09", companyId: "1002482", organization: "Sharq Milliy Taomlari", newAmount: "2 500 000 UZS", oldAmount: "3 000 000 UZS", type: "Изменено", user: "Admin 01", comment: "2.5 MLN SOTIB 3 MLN KIRITILGAN SKRENSHOT TASHLADI" },
  { id: "hist-6098", number: 6, recordId: "6098", date: "02.07.2026 / 12:14", companyId: "1002678", organization: "DINOZAVR HOT-DOG 5", newAmount: "1 288 000 UZS", oldAmount: "2 000 000 UZS", type: "Изменено", user: "Sardor Hamzayev Admin", comment: "соник 1700 дан сотилган" },
  { id: "hist-6080", number: 7, recordId: "6080", date: "01.07.2026 / 20:18", companyId: "1002545", organization: "Tandora", newAmount: "700 000 UZS", oldAmount: "960 000 UZS", type: "Изменено", user: "Sardor Hamzayev Admin", comment: "printer 50$ sotilgan" },
  { id: "hist-1019", number: 8, recordId: "1019", date: "01.07.2026 / 17:18", companyId: "1001530", organization: "Bunyod shashlik", newAmount: "390 000 UZS", oldAmount: "390 000 UZS", type: "Изменено", user: "Admin 01", comment: "" },
  { id: "hist-1017", number: 9, recordId: "1017", date: "29.06.2026 / 13:43", companyId: "1002682", organization: "Rohat choyxonasi -2", newAmount: "1 500 000 UZS", oldAmount: "1 500 000 UZS", type: "Изменено", user: "Sardor Hamzayev Admin", comment: "" },
  { id: "hist-1016", number: 10, recordId: "1016", date: "27.06.2026 / 18:36", companyId: "1002887", organization: "Qarmoq", newAmount: "1 000 UZS", oldAmount: "1 000 UZS", type: "Изменено", user: "Sardor Hamzayev Admin", comment: "" },
  { id: "hist-5926", number: 11, recordId: "5926", date: "27.06.2026 / 18:36", companyId: "1002887", organization: "Qarmoq", newAmount: "3 000 000 UZS", oldAmount: "3 000 000 UZS", type: "Изменено", user: "Sardor Hamzayev Admin", comment: "1" },
  { id: "hist-1015", number: 12, recordId: "1015", date: "27.06.2026 / 18:35", companyId: "1002887", organization: "Qarmoq", newAmount: "1 000 UZS", oldAmount: "1 000 UZS", type: "Изменено", user: "Sardor Hamzayev Admin", comment: "" },
  { id: "hist-1014", number: 13, recordId: "1014", date: "27.06.2026 / 18:35", companyId: "1002887", organization: "Qarmoq", newAmount: "1 000 UZS", oldAmount: "1 000 UZS", type: "Изменено", user: "Sardor Hamzayev Admin", comment: "" },
  { id: "hist-1013", number: 14, recordId: "1013", date: "24.06.2026 / 14:03", companyId: "1001573", organization: "Buxoro Kafe", newAmount: "10 000 000 UZS", oldAmount: "10 000 000 UZS", type: "Изменено", user: "Admin 01", comment: "" },
  { id: "hist-5852", number: 15, recordId: "5852", date: "18.06.2026 / 11:18", companyId: "1002682", organization: "Rohat choyxonasi -2", newAmount: "6 376 000 UZS", oldAmount: "6 616 685 UZS", type: "Изменено", user: "Admin 01", comment: "HAB QO'YILMAGAN EKAN SARDOR AYTDI" },
];

const cashierBackgroundRows = [
  { id: "cashier-bg-canyon", name: "Antelope Canyon", photo: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=220&q=72" },
  { id: "cashier-bg-leaves", name: "Green Leaves", photo: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=220&q=72" },
  { id: "cashier-bg-lavender", name: "Photo Lavender Flower Field Under Pink Sky", photo: "https://images.unsplash.com/photo-1499002238440-d264edd596ec?auto=format&fit=crop&w=220&q=72" },
  { id: "cashier-bg-city", name: "Bird's Eye View Of City", photo: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=220&q=72" },
  { id: "cashier-bg-sports-car", name: "Photography of Gray Sports Car", photo: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=220&q=72" },
  { id: "cashier-bg-expressway", name: "Photo of Car on Expressway", photo: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=220&q=72" },
  { id: "cashier-bg-snow", name: "Landscape Photography of Mountains Covered in Snow", photo: "https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?auto=format&fit=crop&w=220&q=72" },
  { id: "cashier-bg-water", name: "Aerial Photography of Water Beside Forest during Golden Hour", photo: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=220&q=72" },
  { id: "cashier-bg-lake", name: "Lake and Mountain Under White Sky", photo: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=220&q=72" },
];

function formatSignedFinanceAmount(value) {
  return `${value < 0 ? "- " : "+ "}${formatCurrency(Math.abs(value))}`;
}

function addMonthsToRange(range, diff) {
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  start.setMonth(start.getMonth() + diff);
  end.setMonth(end.getMonth() + diff);
  const next = { start: formatDate(start), end: formatDate(end), preset: "" };
  return { ...next, label: rangeLabel(next) };
}

function presetRange(label) {
  const today = new Date(2026, 5, 11);
  const start = new Date(today);
  const end = new Date(today);

  if (label === "Вчера") {
    start.setDate(today.getDate() - 1);
    end.setDate(today.getDate() - 1);
  } else if (label === "Эта неделя") {
    start.setDate(today.getDate() - 6);
  } else if (label === "Этот месяц") {
    start.setDate(1);
  } else if (label === "Прошлый месяц") {
    start.setMonth(today.getMonth() - 1, 1);
    end.setMonth(today.getMonth(), 0);
  } else if (label === "Этот квартал") {
    start.setMonth(Math.floor(today.getMonth() / 3) * 3, 1);
  } else if (label === "Прошлый квартал") {
    const quarterStart = Math.floor(today.getMonth() / 3) * 3;
    start.setMonth(quarterStart - 3, 1);
    end.setMonth(quarterStart, 0);
  } else if (label === "Этот год") {
    start.setMonth(0, 1);
  } else if (label === "Прошлый год") {
    start.setFullYear(today.getFullYear() - 1, 0, 1);
    end.setFullYear(today.getFullYear() - 1, 11, 31);
  }

  const range = { start: formatDate(start), end: formatDate(end), preset: label };
  return { ...range, label: label === "Сегодня" || label === "Вчера" ? label : rangeLabel(range) };
}

const ADMIN_CHART_COLOR = "#4ed3a7";
const ADMIN_CHART_COLOR_RGB = "78, 211, 167";

function adminChartPointToMoney(value) {
  return Math.round(Number(value || 0) * 1000000);
}

function formatAdminRawMoney(value) {
  return `${Math.round(Number(value || 0)).toLocaleString("ru-RU").replace(/\u00a0/g, " ")} UZS`;
}

function formatAdminAxisTick(value) {
  if (Number(value) === 0) return "0";
  const millions = Number(value) / 1000000;
  if (millions < 1) return `${Math.round(Number(value) / 1000)}K`;
  return `${Number(millions).toLocaleString("ru-RU", { maximumFractionDigits: 1 }).replace(/\u00a0/g, " ")}M`;
}

function emptyAdminChartData(segment) {
  const configs = {
    "День": ["09:00", "12:00", "15:00", "18:00", "21:00", "00:00"],
    "Неделя": ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
    "Месяц": ["01", "07", "14", "21", "28", "31"],
    "Год": ["Янв", "Мар", "Май", "Июл", "Сен", "Ноя"],
  };
  const labels = configs[segment] || configs["Месяц"];

  return {
    value: "0 UZS",
    delta: "Нет данных backend",
    points: labels.map(() => 0),
    labels,
    tickLabels: labels.map((label, index) => [index, label]),
    tooltip: { label: labels.at(-1) || "", value: "0 UZS" },
    tooltipIndex: Math.max(0, labels.length - 1),
    yMax: 1,
    yStep: 0.25,
  };
}

function AdminRevenueChart({ data, segment }) {
  const canvasRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const ctx = canvasRef.current.getContext("2d");
    const tooltipIndex = Math.min(Math.max(data.tooltipIndex ?? data.points.length - 1, 0), data.points.length - 1);
    const labels = data.labels || data.xLabels || [];
    const chartPoints = data.points.map(adminChartPointToMoney);
    const tickLabels = new Map(data.tickLabels || labels.map((label, index) => [index, label]));
    const yMax = data.yMax ? adminChartPointToMoney(data.yMax) : undefined;
    const yStep = data.yStep ? adminChartPointToMoney(data.yStep) : undefined;
    const revealState = { progress: 0, didClip: false };
    const revealDuration = 1200;
    const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);

    const fill = ctx.createLinearGradient(0, 0, 0, 360);
    fill.addColorStop(0, `rgba(${ADMIN_CHART_COLOR_RGB}, 0.28)`);
    fill.addColorStop(0.55, `rgba(${ADMIN_CHART_COLOR_RGB}, 0.10)`);
    fill.addColorStop(1, `rgba(${ADMIN_CHART_COLOR_RGB}, 0)`);

    const revealPlugin = {
      id: "adminRevenueChartReveal",
      beforeDatasetsDraw(chart) {
        const { chartArea } = chart;
        revealState.didClip = false;
        if (!chartArea) return;
        const width = chartArea.width * revealState.progress;
        chart.ctx.save();
        chart.ctx.beginPath();
        chart.ctx.rect(chartArea.left, chartArea.top, width, chartArea.height);
        chart.ctx.clip();
        revealState.didClip = true;
      },
      afterDatasetsDraw(chart) {
        if (revealState.didClip) chart.ctx.restore();
      },
    };
    let revealFrame = 0;

    const chart = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: chartPoints,
          borderColor: ADMIN_CHART_COLOR,
          backgroundColor: fill,
          borderWidth: 4,
          pointBorderColor: ADMIN_CHART_COLOR,
          pointBorderWidth: 3,
          pointRadius: 4,
          pointBackgroundColor: "#ffffff",
          pointHoverRadius: 7,
          fill: true,
          tension: 0.42,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        animation: false,
        animations: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: ({ chart: activeChart, tooltip }) => {
              const tooltipEl = tooltipRef.current;
              if (!tooltipEl) return;

              if (!tooltip || tooltip.opacity === 0) {
                tooltipEl.classList.remove("is-visible");
                return;
              }

              const titleEl = tooltipEl.querySelector("strong");
              const valueEl = tooltipEl.querySelector("span");
              if (titleEl) titleEl.textContent = tooltip.title?.[0] || "";
              if (valueEl) valueEl.textContent = tooltip.body?.[0]?.lines?.[0] || "";

              const tooltipHalfWidth = tooltipEl.offsetWidth / 2 || 72;
              const minX = tooltipHalfWidth + 8;
              const maxX = activeChart.width - tooltipHalfWidth - 8;
              const x = Math.min(Math.max(tooltip.caretX, minX), maxX);
              const y = Math.max(tooltip.caretY - 10, 16);

              tooltipEl.style.left = `${activeChart.canvas.offsetLeft + x}px`;
              tooltipEl.style.top = `${activeChart.canvas.offsetTop + y}px`;
              tooltipEl.classList.add("is-visible");
            },
            callbacks: {
              title: (items) => {
                const index = items[0]?.dataIndex ?? tooltipIndex;
                return index === tooltipIndex ? data.tooltip.label : labels[index] || "";
              },
              label: (context) => (
                context.dataIndex === tooltipIndex ? data.tooltip.value : formatAdminRawMoney(context.parsed.y)
              ),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: "#667085",
              font: { size: 12, weight: "600", family: "'Golos Text', Manrope, sans-serif" },
              maxRotation: 0,
              autoSkip: false,
              callback: (_value, index) => tickLabels.get(index) || "",
            },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            ...(yMax ? { max: yMax } : {}),
            grid: { color: "rgba(15, 23, 42, 0.09)", drawTicks: false },
            ticks: {
              ...(yStep ? { stepSize: yStep } : {}),
              color: "#667085",
              padding: 8,
              font: { size: 12, weight: "600", family: "'Golos Text', Manrope, sans-serif" },
              callback: (value) => formatAdminAxisTick(value),
            },
            border: { display: false },
          },
        },
      },
      plugins: [revealPlugin],
    });

    const revealStart = performance.now();
    const runReveal = (timestamp) => {
      const elapsed = timestamp - revealStart;
      const progress = Math.min(1, elapsed / revealDuration);
      revealState.progress = easeOutCubic(progress);
      chart.draw();
      if (progress < 1) revealFrame = window.requestAnimationFrame(runReveal);
    };
    revealFrame = window.requestAnimationFrame(runReveal);

    return () => {
      window.cancelAnimationFrame(revealFrame);
      chart.destroy();
    };
  }, [data, segment]);

  return (
    <>
      <canvas ref={canvasRef} />
      <div className="admin-tooltip admin-chart-tooltip" ref={tooltipRef} aria-hidden="true">
        <strong />
        <span />
      </div>
    </>
  );
}

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

function LoginView({ onLogin }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await adminLogin(phone, password);
      onLogin();
    } catch {
      setError("Не удалось войти в Marjon Admin.");
    } finally {
      setLoading(false);
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
        <h1>Добро пожаловать</h1>
        <p className="admin-login__subtitle">Войдите в рабочее место суперадминки.</p>
        <label className="admin-login__field admin-login__field--phone">
          <span>НОМЕР ТЕЛЕФОНА</span>
          <div className="admin-login__input">
            <Icon name="bi-telephone" size={18} />
            <strong>+998</strong>
            <input value={formatAdminPhone(phone)} onChange={handlePhoneChange} type="tel" inputMode="numeric" autoComplete="tel-national" required />
          </div>
        </label>
        <label className="admin-login__field admin-login__field--password">
          <span>ПАРОЛЬ</span>
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
            <span>Запомнить меня</span>
          </label>
          <button type="button">Забыли пароль?</button>
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
    if (activeParent) {
      setOpenGroups((groups) => (groups.length === 1 && groups[0] === activeParent ? groups : [activeParent]));
    }
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
    setHoverGroup("");
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
            title={collapsed ? "Развернуть меню" : "Свернуть меню"}
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
                <span>{item.label}</span>
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
                <span>{item.label}</span>
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
                    <span>{child.label}</span>
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
                      <span>{child.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
      <button className="admin-profile-card" type="button" onClick={onProfile}>
        <span className="admin-profile-card__avatar">{(user?.name || "Александр П.").trim().slice(0, 1)}</span>
        <span className="admin-profile-card__info">
          <strong>{user?.name || "Александр П."}</strong>
          <small>{user?.is_superadmin ? "Суперадмин" : "Администратор"}</small>
        </span>
        <Icon name="bi-chevron-right" size={16} className="admin-profile-card__chevron" />
      </button>
    </aside>
  );
}

function formatAdminHeaderDate(value) {
  return `${String(value.getDate()).padStart(2, "0")}.${String(value.getMonth() + 1).padStart(2, "0")}.${value.getFullYear()}`;
}

function formatAdminHeaderTime(value) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function Header({ user, onLogout, onBellClick, notificationCount, onProfile }) {
  const [now, setNow] = useState(() => new Date());
  const profileName = user?.name || "Александр П.";
  const profileInitial = profileName.trim().slice(0, 1) || "А";
  const profileRole = user?.is_superadmin ? "Суперадмин" : "Суперадмин";

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30 * 1000);
    return () => window.clearInterval(id);
  }, []);

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = "/index.html";
  }

  return (
    <header className="admin-header">
      <div className="admin-header__title">
        <button className="admin-back-button" type="button" onClick={goBack} aria-label="Назад" title="Назад">
          <Icon name="bi-chevron-left" size={24} />
        </button>
      </div>
      <div className="admin-header__actions">
        <div className="admin-date-time" aria-label="Текущая дата и время">
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
        <button className="admin-bell" type="button" aria-label="Уведомления" onClick={onBellClick}>
          <Icon name="bi-bell" size={18} />
          <span>{notificationCount}</span>
        </button>
        <button className="admin-profile" type="button" onClick={onProfile} aria-label="Профиль администратора">
          <div className="admin-profile__avatar">{profileInitial}</div>
          <div>
            <strong>{profileName}</strong>
            <span>{profileRole}</span>
          </div>
        </button>
        <button className="admin-logout" type="button" onClick={onLogout} aria-label="Выйти">
          <Icon name="bi-box-arrow-right" size={18} />
        </button>
      </div>
    </header>
  );
}

function KpiCard({ item, onClick }) {
  return (
    <article
      className={`admin-kpi admin-kpi--${item.tone}`}
      role="button"
      tabIndex={0}
      onClick={() => onClick(item)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(item); } }}
    >
      <div className="admin-kpi__top">
        <span><Icon name={item.icon} size={20} /></span>
        <small>{item.title}</small>
      </div>
      <strong>{item.value}</strong>
      <p>{item.delta}</p>
    </article>
  );
}

function PlatformChart({ segment, onSegmentChange }) {
  const data = emptyAdminChartData(segment);
  return (
    <section className="admin-chart-card">
      <div className="admin-chart-card__head">
        <div>
          <span>Динамика оборота платформы</span>
          <strong>{data.value}</strong>
          <em>{data.delta}</em>
        </div>
        <div className="admin-segments">
          {["День", "Неделя", "Месяц", "Год"].map((item) => (
            <button className={item === segment ? "is-active" : ""} type="button" key={item} onClick={() => onSegmentChange(item)}>{item}</button>
          ))}
        </div>
      </div>
      <div className="admin-chart">
        <AdminRevenueChart data={data} segment={segment} />
      </div>
    </section>
  );
}

const STATUS_GREEN = ["Активна", "Активен", "Проведен", "Завершено", "В норме", "Включено", "ОК"];
const STATUS_VIOLET = ["Новый", "Новая", "Черновик"];

function StatusBadge({ status }) {
  const key = STATUS_GREEN.includes(status) ? "green" : STATUS_VIOLET.includes(status) ? "violet" : "orange";
  return <span className={`admin-status admin-status--${key}`}>{status}</span>;
}

const orgDirectoryColumnKeys = [
  "number", "message", "service", "paymentType", "name", "clientId", "terminals", "cashboxes",
  "deposit", "debt", "overdue", "contract", "tariff", "currency", "contact", "region",
  "manager", "date", "source", "version", "orgStatus", "identification", "paymentKind",
  "status", "onlineMenu", "warehouse", "cashboxOnline", "actions",
];

function OrgDirectoryFlag({ value, onClick }) {
  const normalized = String(value).toLowerCase();
  const tone = normalized.includes("не ") || normalized.includes("hali") ? "danger"
    : normalized.includes("ожидает") || normalized.includes("jarayon") ? "warning"
      : "success";
  const content = <span className={`org-directory-flag org-directory-flag--${tone}`}>{value}</span>;
  if (!onClick) return content;
  return (
    <button type="button" className="org-directory-flag-button" onClick={onClick}>
      {content}
    </button>
  );
}

function OrganizationMessageScreen({ row, onBack, onSave, onNotify }) {
  const [form, setForm] = useState({
    name: row.name,
    tariff: row.tariff,
    deposit: row.deposit,
    country: "Узбекистан",
    region: row.region,
    paymentType: row.paymentType,
    contractDate: row.date,
    status: row.status,
    inn: "",
    phone: row.contact,
    login: row.contact,
    currency: row.currency,
    responsible: row.manager,
    branch: "Xamidim admin filial",
    source: row.source,
    organizationStatus: row.orgStatus,
    comment: "",
  });
  const [settings, setSettings] = useState({
    warehouse: row.warehouse === "Активно",
    onlineMenu: row.onlineMenu === "Активно",
    cashboxOnline: row.cashboxOnline === "Активно",
    fiscal: false,
    detailedMenu: true,
    androidCashier: true,
  });
  const [chatText, setChatText] = useState("");
  const [messages, setMessages] = useState([
    {
      id: 1,
      author: "Система",
      text: `Открыта карточка сообщений для ${row.name}.`,
      time: "сейчас",
      system: true,
    },
  ]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleSetting(field) {
    setSettings((current) => ({ ...current, [field]: !current[field] }));
  }

  function handleSave() {
    onSave(row.id, {
      name: form.name,
      tariff: form.tariff,
      deposit: form.deposit,
      region: form.region,
      paymentType: form.paymentType,
      date: form.contractDate,
      status: form.status,
      contact: form.phone,
      currency: form.currency,
      manager: form.responsible,
      source: form.source,
      orgStatus: form.organizationStatus,
      warehouse: settings.warehouse ? "Активно" : "Не активно",
      onlineMenu: settings.onlineMenu ? "Активно" : "Не активно",
      cashboxOnline: settings.cashboxOnline ? "Активно" : "Не активно",
      message: true,
    });
    onNotify?.(`${form.name}: данные сохранены.`);
  }

  function sendMessage() {
    const text = chatText.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { id: Date.now(), author: "Super Admin", text, time: "сейчас" },
    ]);
    setChatText("");
    onNotify?.(`${form.name}: сообщение отправлено.`);
  }

  const formGroups = [
    [
      { key: "name", label: "Название", required: true },
      { key: "tariff", label: "Цена тарифа", required: true },
      { key: "deposit", label: "Рабочий счет" },
    ],
    [
      { key: "country", label: "Страна", type: "select", options: ["Узбекистан", "Казахстан", "Кыргызстан"] },
      { key: "region", label: "Регион", type: "select", options: ["Andijon", "Toshkent", "Samarqand", "Fargona", "Namangan", "Surxondaryo", "JIZZAX"] },
      { key: "paymentType", label: "Тип оплаты", type: "select", options: ["Без оплаты", "Тариф", "Тест"] },
      { key: "contractDate", label: "Дата договора", required: true },
      { key: "status", label: "Выберите статус", type: "select", options: ["Активно", "Доступен", "Не активно"] },
      { key: "inn", label: "ИНН организации" },
    ],
    [
      { key: "phone", label: "Номер владельца" },
      { key: "login", label: "Логин владельца" },
      { key: "currency", label: "Основная валюта", type: "select", options: ["UZS", "USD"] },
      { key: "responsible", label: "Ответственный" },
      { key: "branch", label: "Филиал" },
      { key: "source", label: "Источник" },
      { key: "organizationStatus", label: "Статус организации" },
      { key: "comment", label: "Описание" },
    ],
  ];

  const settingLabels = [
    ["warehouse", "Управление складом"],
    ["fiscal", "Подключение ИНН"],
    ["onlineMenu", "Онлайн-меню"],
    ["detailedMenu", "Деталь меню"],
    ["cashboxOnline", "Касса онлайн"],
    ["androidCashier", "Android кассир"],
  ];

  return (
    <section className="org-message-page">
      <div className="org-message-header">
        <button type="button" className="org-message-back" onClick={onBack}>
          <Icon name="bi-arrow-left" size={16} />
        </button>
        <div>
          <h2>Сообщение: {form.branch}</h2>
          <p>{form.name} · ID {row.clientId}</p>
        </div>
        <button type="button" className="org-message-save-top" onClick={handleSave}>Сохранить</button>
      </div>

      <div className="org-message-layout">
        <form className="org-message-form" onSubmit={(event) => { event.preventDefault(); handleSave(); }}>
          <div className="org-message-form__status">
            <span>Статус</span>
            <button
              type="button"
              className={`org-message-toggle ${form.status !== "Не активно" ? "is-on" : ""}`}
              onClick={() => updateField("status", form.status === "Не активно" ? "Активно" : "Не активно")}
            >
              <span />
            </button>
          </div>

          {formGroups.map((group, groupIndex) => (
            <div className="org-message-field-grid" key={groupIndex}>
              {group.map((field) => (
                <label key={field.key} className={field.key === "comment" ? "is-wide" : ""}>
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  {field.type === "select" ? (
                    <select value={form[field.key]} onChange={(event) => updateField(field.key, event.target.value)}>
                      {field.options.map((option) => <option value={option} key={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input value={form[field.key]} onChange={(event) => updateField(field.key, event.target.value)} placeholder="Введите значение" />
                  )}
                </label>
              ))}
            </div>
          ))}

          <div className="org-message-settings">
            <h3>Настройки</h3>
            <div>
              {settingLabels.map(([key, label]) => (
                <button
                  type="button"
                  className={`org-message-setting ${settings[key] ? "is-on" : ""}`}
                  key={key}
                  onClick={() => toggleSetting(key)}
                >
                  <span>{label}</span>
                  <i />
                </button>
              ))}
            </div>
          </div>

          <button className="org-message-save" type="submit">Сохранить</button>
        </form>

        <section className="org-message-chat">
          <div className="org-message-chat__head">
            <div className="org-message-chat__avatar">
              <Icon name="bi-building" size={18} />
            </div>
            <div>
              <strong>Компания {form.name}</strong>
              <span>ID: {row.clientId}</span>
            </div>
            <button type="button" onClick={onBack}>Закрыть</button>
          </div>

          <div className="org-message-chat__body">
            {messages.map((message) => (
              <div className={`org-message-bubble ${message.system ? "is-system" : ""}`} key={message.id}>
                <small>{message.author} · {message.time}</small>
                <p>{message.text}</p>
              </div>
            ))}
          </div>

          <div className="org-message-chat__composer">
            <input
              value={chatText}
              onChange={(event) => setChatText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") sendMessage(); }}
              placeholder="Написать сообщение..."
            />
            <button type="button" onClick={sendMessage}>
              <Icon name="bi-send" size={16} /> Send
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function OrganizationDirectoryPage({ search, onRowDetail, onNotify }) {
  const [rows, setRows] = useState([]);
  const [messageRow, setMessageRow] = useState(null);
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [messageOnly, setMessageOnly] = useState(false);
  const [yangiOnly, setYangiOnly] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(orgDirectoryColumnKeys);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    adminApi.get("/organizations", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        setRows(items.map((r) => ({
            id: String(r.id || ""),
            message: Boolean(r.has_message),
            service: r.service_type || "Xizmat",
            paymentType: r.payment_type || "Без оплаты",
            name: r.company_name || r.name || "",
            clientId: String(r.client_id || r.virtual_cash_register_number || r.id || ""),
            terminals: String(r.terminals_count || 0),
            cashboxes: String(r.cashboxes_count || (r.virtual_cash_register_number ? 1 : 0)),
            deposit: String(r.deposit ?? (Number(r.cash_balance || 0) > 0 ? r.cash_balance : 0)),
            debt: String(r.debt ?? (Number(r.cash_balance || 0) < 0 ? Math.abs(Number(r.cash_balance || 0)) : 0)),
            overdue: String(r.overdue || 0),
            contract: String(r.contract_amount || 0),
            tariff: String(r.tariff_amount || r.tariff || r.tariff_price || "300 000"),
            currency: r.currency || "UZS",
            contact: r.phone || r.contact || "",
            region: r.region || "",
            manager: r.manager_name || r.manager || "",
            date: r.installation_date || r.created_at || "",
            source: r.source || "—",
            version: r.app_version || "—",
            orgStatus: r.org_status || (r.status === "active" ? "ISHLA TURGAN" : "HALI ULANMAGAN"),
            identification: r.identification || "—",
            paymentKind: r.payment_kind || "—",
            status: r.access_status || "Доступен",
            onlineMenu: r.online_menu ? "Активно" : "—",
            warehouse: (r.warehouse_enabled ?? r.enabled_storage_integration) ? "Активно" : "—",
            cashboxOnline: (r.cashbox_online ?? Boolean(r.virtual_cash_register_number)) ? "Активно" : "—",
          })));
      })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, search, serviceFilter, paymentFilter, statusFilter, messageOnly, yangiOnly]);

  const filteredRows = useMemo(() => {
    const globalQuery = search.trim().toLowerCase();
    const localQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const haystack = Object.values(row).join(" ").toLowerCase();
      if (globalQuery && !haystack.includes(globalQuery)) return false;
      if (localQuery && !haystack.includes(localQuery)) return false;
      if (serviceFilter !== "all" && row.service !== serviceFilter) return false;
      if (paymentFilter !== "all" && row.paymentType !== paymentFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (messageOnly && !row.message) return false;
      if (yangiOnly && row.service !== "Yangi") return false;
      return true;
    });
  }, [messageOnly, paymentFilter, query, rows, search, serviceFilter, statusFilter, yangiOnly]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(startIndex, startIndex + pageSize);

  const totals = useMemo(() => {
    const active = rows.filter((row) => row.status === "Активно" || row.status === "Доступен").length;
    const debt = rows.reduce((sum, row) => sum + Number(String(row.debt).replace(/[^\d-]/g, "") || 0), 0);
    const online = rows.filter((row) => row.onlineMenu === "Активно").length;
    return { active, debt: debt.toLocaleString("ru-RU"), online };
  }, [rows]);

  function updateRow(id, patch) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function saveMessageRow(id, patch) {
    updateRow(id, patch);
    setMessageRow((current) => (current?.id === id ? { ...current, ...patch } : current));
  }

  function toggleAvailability(row, key) {
    const next = row[key] === "Активно" || row[key] === "Доступен" ? "Не активно" : "Активно";
    updateRow(row.id, { [key]: key === "status" && row[key] === "Доступен" ? "Не активно" : next });
    onNotify?.(`${row.name}: статус обновлен.`);
  }

  function copyClientIdFallback(value) {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  }

  async function copyClientId(clientId) {
    const value = String(clientId);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else if (!copyClientIdFallback(value)) {
        throw new Error("copy failed");
      }
      onNotify?.(`ID клиента ${value} скопирован.`);
    } catch {
      if (copyClientIdFallback(value)) {
        onNotify?.(`ID клиента ${value} скопирован.`);
      } else {
        onNotify?.("Не удалось скопировать ID клиента.");
      }
    }
  }

  function addOrganization() {
    onNotify?.("Создание организации должно идти через backend endpoint.");
  }

  function openDetail(row) {
    const detailColumns = [
      "Название", "ID клиента", "Услуга", "Тип оплаты", "Контакт", "Регион", "Сотрудник",
      "Дата", "Источник", "Версия", "Статус организации", "Статус", "Онлайн меню",
      "Управление складом", "Касса онлайн",
    ];
    const detailRow = [
      row.name, row.clientId, row.service, row.paymentType, row.contact, row.region, row.manager,
      row.date, row.source, row.version || "—", row.orgStatus, row.status, row.onlineMenu,
      row.warehouse, row.cashboxOnline,
    ];
    onRowDetail("Организация", detailColumns, detailRow);
  }

  function toggleColumn(key) {
    setVisibleColumns((current) => (
      current.includes(key)
        ? current.filter((item) => item !== key)
        : orgDirectoryColumnKeys.filter((item) => item === key || current.includes(item))
    ));
  }

  const columns = [
    { key: "number", label: "№", width: 54, render: (_, rowIndex) => startIndex + rowIndex + 1 },
    {
      key: "message",
      label: "Msg",
      width: 62,
      render: (row) => (
        <button
          type="button"
          className={`org-directory-icon ${row.message ? "is-on" : ""}`}
          onClick={() => {
            updateRow(row.id, { message: true });
            setMessageRow({ ...row, message: true });
          }}
          aria-label="Сообщение"
        >
          <Icon name={row.message ? "bi-chat-square-text-fill" : "bi-chat-square"} size={15} />
        </button>
      ),
    },
    {
      key: "service",
      label: "Услуга",
      width: 98,
      render: (row) => (
        <select className="org-directory-cell-select" value={row.service} onChange={(event) => updateRow(row.id, { service: event.target.value })}>
          <option value="Yangi">Yangi</option>
          <option value="Xizmat">Xizmat</option>
        </select>
      ),
    },
    {
      key: "paymentType",
      label: "Тип оплаты",
      width: 124,
      render: (row) => (
        <select className="org-directory-cell-select" value={row.paymentType} onChange={(event) => updateRow(row.id, { paymentType: event.target.value })}>
          <option value="Без оплаты">Без оплаты</option>
          <option value="Тариф">Тариф</option>
          <option value="Тест">Тест</option>
        </select>
      ),
    },
    { key: "name", label: "Название", width: 190, render: (row) => <strong className="org-directory-name">{row.name}</strong> },
    {
      key: "clientId",
      label: "ID клиента",
      width: 110,
      render: (row) => (
        <button
          type="button"
          className="org-directory-copy"
          onClick={(event) => {
            event.stopPropagation();
            copyClientId(row.clientId);
          }}
          aria-label={`Скопировать ID клиента ${row.clientId}`}
        >
          <span>{row.clientId}</span>
          <Icon name="bi-copy" size={13} />
        </button>
      ),
    },
    { key: "terminals", label: "Э/с", width: 66, render: (row) => row.terminals },
    { key: "cashboxes", label: "Н/касс", width: 76, render: (row) => row.cashboxes },
    { key: "deposit", label: "Депозит", width: 112, render: (row) => <span className={String(row.deposit).includes("-") ? "is-negative" : ""}>{row.deposit}</span> },
    { key: "debt", label: "Долг", width: 112, render: (row) => <span className={String(row.debt).includes("-") ? "is-negative" : ""}>{row.debt}</span> },
    { key: "overdue", label: "Просроченный долг", width: 150, render: (row) => row.overdue },
    { key: "contract", label: "Контракт", width: 114, render: (row) => row.contract },
    { key: "tariff", label: "Цена тарифа", width: 118, render: (row) => row.tariff },
    { key: "currency", label: "Валюта", width: 82, render: (row) => row.currency },
    { key: "contact", label: "Контакты", width: 148, render: (row) => <b>{row.contact}</b> },
    { key: "region", label: "Регион", width: 122, render: (row) => row.region },
    { key: "manager", label: "Сотрудник", width: 154, render: (row) => <b>{row.manager}</b> },
    { key: "date", label: "Дата", width: 112, render: (row) => row.date },
    { key: "source", label: "Источник", width: 116, render: (row) => row.source },
    { key: "version", label: "Версия", width: 82, render: (row) => row.version ? <span className="org-directory-version">{row.version}</span> : "—" },
    { key: "orgStatus", label: "Статус организации", width: 162, render: (row) => <span>{row.orgStatus}</span> },
    { key: "identification", label: "Статус идентификации", width: 158, render: (row) => <Icon name={row.identification === "Проверено" ? "bi-eye" : "bi-hourglass-split"} size={16} /> },
    { key: "paymentKind", label: "Тип платежей", width: 132, render: (row) => <span className="org-directory-payment-kind">{row.paymentKind}</span> },
    { key: "status", label: "Статус", width: 116, render: (row) => <OrgDirectoryFlag value={row.status} onClick={() => toggleAvailability(row, "status")} /> },
    { key: "onlineMenu", label: "Онлайн меню", width: 128, render: (row) => <OrgDirectoryFlag value={row.onlineMenu} onClick={() => toggleAvailability(row, "onlineMenu")} /> },
    { key: "warehouse", label: "Управление складом", width: 152, render: (row) => <OrgDirectoryFlag value={row.warehouse} onClick={() => toggleAvailability(row, "warehouse")} /> },
    { key: "cashboxOnline", label: "Касса онлайн", width: 126, render: (row) => <OrgDirectoryFlag value={row.cashboxOnline} onClick={() => toggleAvailability(row, "cashboxOnline")} /> },
    {
      key: "actions",
      label: "",
      width: 58,
      render: (row) => (
        <button type="button" className="org-directory-edit" onClick={() => openDetail(row)} aria-label={`Редактировать ${row.name}`}>
          <Icon name="bi-pencil-square" size={16} />
        </button>
      ),
    },
  ].filter((column) => visibleColumns.includes(column.key));

  if (messageRow) {
    return (
      <OrganizationMessageScreen
        row={messageRow}
        onBack={() => setMessageRow(null)}
        onSave={saveMessageRow}
        onNotify={onNotify}
      />
    );
  }

  return (
    <section className="org-directory-page">
      <div className="org-directory-topbar">
        <div>
          <h2>Организация</h2>
          <p>Клиенты, тарифы, подключения и доступность сервисов.</p>
        </div>
        <button className="org-directory-add" type="button" onClick={addOrganization}>
          Добавить <Icon name="bi-plus-lg" size={16} />
        </button>
      </div>

      <div className="org-directory-metrics">
        <span><b>{rows.length}</b> всего</span>
        <span><b>{totals.active}</b> активных</span>
        <span><b>{totals.online}</b> онлайн меню</span>
        <span><b>{totals.debt}</b> долг</span>
      </div>

      <div className="org-directory-toolbar">
        <label className="org-directory-search">
          <Icon name="bi-search" size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" />
        </label>
        <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
          <option value="all">Все услуги</option>
          <option value="Yangi">Yangi</option>
          <option value="Xizmat">Xizmat</option>
        </select>
        <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
          <option value="all">Все типы оплаты</option>
          <option value="Без оплаты">Без оплаты</option>
          <option value="Тариф">Тариф</option>
          <option value="Тест">Тест</option>
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">Все статусы</option>
          <option value="Активно">Активно</option>
          <option value="Доступен">Доступен</option>
          <option value="Не активно">Не активно</option>
        </select>
        <button type="button" className="org-directory-soft" onClick={() => onNotify?.("Фильтр сохранен.")}>Сохранить</button>
        <button type="button" className={`org-directory-switch ${messageOnly ? "is-on" : ""}`} onClick={() => setMessageOnly((value) => !value)}>
          <span /> Сообщения
        </button>
        <button type="button" className={`org-directory-switch ${yangiOnly ? "is-on" : ""}`} onClick={() => setYangiOnly((value) => !value)}>
          <span /> Yangi
        </button>
        <button type="button" className="org-directory-settings" onClick={() => setSettingsOpen((value) => !value)}>
          <Icon name="bi-sliders" size={15} /> Настройка таблицы
        </button>
      </div>

      {settingsOpen ? (
        <div className="org-directory-column-panel">
          {orgDirectoryColumnKeys.filter((key) => key !== "number" && key !== "actions").map((key) => {
            const column = columns.find((item) => item.key === key) || { label: key };
            const fallback = {
              message: "Msg", service: "Услуга", paymentType: "Тип оплаты", name: "Название", clientId: "ID клиента",
              terminals: "Э/с", cashboxes: "Н/касс", deposit: "Депозит", debt: "Долг", overdue: "Просроченный долг",
              contract: "Контракт", tariff: "Цена тарифа", currency: "Валюта", contact: "Контакты", region: "Регион",
              manager: "Сотрудник", date: "Дата", source: "Источник", version: "Версия", orgStatus: "Статус организации",
              identification: "Статус идентификации", paymentKind: "Тип платежей", status: "Статус",
              onlineMenu: "Онлайн меню", warehouse: "Управление складом", cashboxOnline: "Касса онлайн",
            };
            return (
              <label key={key}>
                <input type="checkbox" checked={visibleColumns.includes(key)} onChange={() => toggleColumn(key)} />
                <span>{column.label === key ? fallback[key] : column.label}</span>
              </label>
            );
          })}
        </div>
      ) : null}

      <div className="org-directory-table-shell">
        <table className="org-directory-table">
          <colgroup>
            {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => <th key={column.key}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, rowIndex) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render(row, rowIndex)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!pageRows.length ? <div className="org-directory-empty">Записей не найдено.</div> : null}
      </div>

      <div className="org-directory-footer">
        <span>{filteredRows.length ? `${startIndex + 1}-${Math.min(startIndex + pageSize, filteredRows.length)} из ${filteredRows.length}` : "0 из 0"}</span>
        <div>
          <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            <Icon name="bi-chevron-left" size={15} />
          </button>
          <b>{currentPage}</b>
          <button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
            <Icon name="bi-chevron-right" size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}

function OrganizationsTable({ rows, onExport, onRowAction, onRowClick }) {
  return (
    <section className="admin-table-card">
      <div className="admin-panel-head">
        <div>
          <h2>Недавние организации и филиалы</h2>
          <p>Последние подключения, заявки и изменения по клиентам.</p>
        </div>
        <button type="button" onClick={onExport}>Экспорт</button>
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
        {rows.map((row) => (
          <div className="admin-org-table__row" key={row[0]} role="button" tabIndex={0} onClick={() => onRowClick(row)} onKeyDown={(event) => { if (event.key === "Enter") onRowClick(row); }}>
            <strong>{row[0]}</strong>
            <span>{row[1]}</span>
            <span>{row[2]}</span>
            <span>{row[3]}</span>
            <span>{row[4]}</span>
            <StatusBadge status={row[5]} />
            <button type="button" onClick={(event) => { event.stopPropagation(); onRowAction(row[0]); }} aria-label={`Сменить статус: ${row[0]}`}><Icon name="bi-three-dots" size={18} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

function OrganizationStatusPage({ search, onNotify }) {
  const [rows, setRows] = useState([]);
  const [sortDirection, setSortDirection] = useState("asc");
  const [editor, setEditor] = useState(null);

  useEffect(() => {
    adminApi.get("/organization-statuses", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (items.length) {
          setRows(items.map((r, i) => ({
            id: r.id || String(i),
            name: r.name || "",
            sort: r.sort_order ?? r.sort ?? i + 1,
            active: r.status !== false,
          })));
        }
      })
      .catch(() => {});
  }, []);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = query
      ? rows.filter((row) => row.name.toLowerCase().includes(query) || String(row.sort).includes(query))
      : rows;
    return [...list].sort((a, b) => (
      sortDirection === "asc" ? a.sort - b.sort || a.name.localeCompare(b.name) : b.sort - a.sort || a.name.localeCompare(b.name)
    ));
  }, [rows, search, sortDirection]);

  function openCreate() {
    setEditor({ mode: "create", name: "", sort: rows.length + 1, active: true });
  }

  function openEdit(row) {
    setEditor({ mode: "edit", id: row.id, name: row.name, sort: row.sort, active: row.active });
  }

  function saveEditor() {
    if (!editor?.name.trim()) {
      onNotify?.("Введите название статуса.");
      return;
    }
    const payload = {
      id: editor.id || `status-${Date.now()}`,
      name: editor.name.trim().toUpperCase(),
      sort: Number(editor.sort) || 1,
      active: Boolean(editor.active),
    };
    setRows((current) => (
      editor.mode === "edit"
        ? current.map((row) => (row.id === editor.id ? payload : row))
        : [...current, payload]
    ));
    setEditor(null);
    onNotify?.(editor.mode === "edit" ? "Статус обновлен." : "Статус добавлен.");
  }

  function deleteRow(row) {
    setRows((current) => current.filter((item) => item.id !== row.id));
    onNotify?.(`${row.name}: статус удален.`);
  }

  function refreshRows() {
    setRows([]);
    setEditor(null);
    onNotify?.("Список статусов обновлен.");
  }

  function toggleActive(row) {
    setRows((current) => current.map((item) => (
      item.id === row.id ? { ...item, active: !item.active } : item
    )));
  }

  return (
    <section className="org-status-page">
      <div className="org-status-header">
        <div className="org-status-title">
          <span aria-hidden="true" />
          <div>
            <h2>Статус Организации</h2>
            <p>Справочник состояний подключения и обслуживания клиентов.</p>
          </div>
        </div>
        <div className="org-status-actions">
          <button type="button" className="org-status-refresh" onClick={refreshRows}>
            <Icon name="bi-arrow-repeat" size={15} />
            Обновить список (devent)
          </button>
          <button type="button" className="org-status-add" onClick={openCreate}>
            Добавить <Icon name="bi-plus-lg" size={15} />
          </button>
        </div>
      </div>

      <div className="org-status-summary">
        <span><b>{rows.length}</b> всего</span>
        <span><b>{rows.filter((row) => row.active).length}</b> активно</span>
        <span><b>{filteredRows.length}</b> найдено</span>
      </div>

      {editor ? (
        <div className="org-status-editor">
          <label>
            <span>Название</span>
            <input value={editor.name} onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))} placeholder="Название статуса" autoFocus />
          </label>
          <label>
            <span>Sort</span>
            <input type="number" min="1" value={editor.sort} onChange={(event) => setEditor((current) => ({ ...current, sort: event.target.value }))} />
          </label>
          <button type="button" className={`org-status-toggle ${editor.active ? "is-on" : ""}`} onClick={() => setEditor((current) => ({ ...current, active: !current.active }))}>
            <span /> {editor.active ? "Активно" : "Не активно"}
          </button>
          <div>
            <button type="button" className="org-status-save" onClick={saveEditor}>Сохранить</button>
            <button type="button" className="org-status-cancel" onClick={() => setEditor(null)}>Отмена</button>
          </div>
        </div>
      ) : null}

      <div className="org-status-table-shell">
        <table className="org-status-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Название</th>
              <th>
                <button type="button" onClick={() => setSortDirection((value) => (value === "asc" ? "desc" : "asc"))}>
                  Sort <Icon name="bi-sort-down" size={14} />
                </button>
              </th>
              <th>Статус</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td><strong>{row.name}</strong></td>
                <td><b>{row.sort}</b></td>
                <td>
                  <button type="button" className={`org-status-badge ${row.active ? "is-active" : "is-disabled"}`} onClick={() => toggleActive(row)}>
                    {row.active ? "#активно" : "#неактивно"}
                  </button>
                </td>
                <td>
                  <div className="org-status-row-actions">
                    <button type="button" className="is-edit" onClick={() => openEdit(row)} aria-label={`Редактировать ${row.name}`}>
                      <Icon name="bi-pencil" size={15} />
                    </button>
                    <button type="button" className="is-delete" onClick={() => deleteRow(row)} aria-label={`Удалить ${row.name}`}>
                      <Icon name="bi-trash3" size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filteredRows.length ? <div className="org-status-empty">Статусы не найдены.</div> : null}
      </div>
    </section>
  );
}

function RightColumn({ approvals, onApprovalAction, onShowApprovals, onApprovalClick, onSystemClick }) {
  return (
    <aside className="admin-right">
      <section className="admin-side-card">
        <div className="admin-side-card__head">
          <h3>Одобрения и заявки</h3>
          <span>{approvals.length}</span>
        </div>
        <div className="admin-approval-list">
          {approvals.length ? approvals.map((item) => (
            <div className="admin-approval" key={item[0] + item[1]} role="button" tabIndex={0} onClick={() => onApprovalClick(item)} onKeyDown={(event) => { if (event.key === "Enter") onApprovalClick(item); }}>
              <div>
                <strong>{item[0]}</strong>
                <p>{item[1]}</p>
                <small>{item[2]}</small>
              </div>
              <button type="button" onClick={(event) => { event.stopPropagation(); onApprovalAction(item); }}>{item[3]}</button>
            </div>
          )) : (
            <div className="admin-empty">Нет активных заявок — всё обработано.</div>
          )}
        </div>
        {approvals.length ? (
          <button className="admin-side-link" type="button" onClick={onShowApprovals}>Показать все заявки</button>
        ) : null}
      </section>

      <section className="admin-side-card">
        <div className="admin-side-card__head">
          <h3>Статус систем</h3>
          <span className="is-live">live</span>
        </div>
        <div className="admin-system-grid">
          {systemItems.length ? systemItems.map((item) => (
            <div key={item[0]} role="button" tabIndex={0} onClick={() => onSystemClick(item)} onKeyDown={(event) => { if (event.key === "Enter") onSystemClick(item); }}>
              <strong>{item[0]}</strong>
              <span><i />{item[1]}</span>
            </div>
          )) : (
            <div className="admin-empty">Нет статусов из backend.</div>
          )}
        </div>
      </section>
    </aside>
  );
}

function ProductNomenclaturePage({ search, onNotify }) {
  const [range, setRange] = useState(() => presetRange("Сегодня"));
  const [rows, setRows] = useState([]);
  const query = search.trim().toLowerCase();

  useEffect(() => {
    adminApi.get("/products", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (items.length) {
          setRows(items.map((r) => ({
            branch: r.name || r.branch || "",
            income: Number(r.income || r.price || 0),
            inventory: Number(r.inventory || r.cost_price || 0),
          })));
        }
      })
      .catch(() => {});
  }, []);

  const filteredRows = rows.filter((row) => !query || row.branch.toLowerCase().includes(query));
  const totals = filteredRows.reduce(
    (sum, row) => ({
      income: sum.income + row.income,
      inventory: sum.inventory + row.inventory,
    }),
    { income: 0, inventory: 0 },
  );
  const activeBranches = filteredRows.filter((row) => row.income > 0 || row.inventory > 0).length;

  function shiftDay(diff) {
    const start = parseDate(range.start);
    const end = parseDate(range.end);
    start.setDate(start.getDate() + diff);
    end.setDate(end.getDate() + diff);
    const next = { start: formatDate(start), end: formatDate(end), preset: "" };
    setRange({ ...next, label: rangeLabel(next) });
  }

  function chooseToday() {
    setRange(presetRange("Сегодня"));
    onNotify?.("Период продукта: сегодня.");
  }

  function openBranch(row) {
    onNotify?.(`${row.branch}: приход ${formatCurrency(row.income)}, инвентаризация ${formatCurrency(row.inventory)}.`);
  }

  return (
    <section className="admin-product-page">
      <div className="admin-product-head">
        <div className="admin-product-date">
          <button type="button" onClick={() => shiftDay(-1)} aria-label="Предыдущая дата">
            <Icon name="bi-chevron-left" size={15} />
          </button>
          <button type="button" className="admin-product-date__current" onClick={chooseToday}>
            <Icon name="bi-calendar3" size={16} />
            <span>{range.preset ? "Выберите дату" : range.label}</span>
          </button>
          <button type="button" onClick={() => shiftDay(1)} aria-label="Следующая дата">
            <Icon name="bi-chevron-right" size={15} />
          </button>
        </div>
        <div className="admin-product-title">
          <h2>Продукт</h2>
          <p>Сводка прихода продуктов и инвентаризации по филиалам.</p>
        </div>
        <button type="button" className="admin-product-action" onClick={() => onNotify?.("Сводка продукта подготовлена к экспорту.")}>
          <Icon name="bi-download" size={15} />
          <span>Экспорт</span>
        </button>
      </div>

      <div className="admin-product-summary">
        <span><b>{rows.length}</b> филиалов</span>
        <span><b>{activeBranches}</b> с приходом</span>
        <span><b>{formatCurrency(totals.income)}</b> приход</span>
        <span><b>{formatCurrency(totals.inventory)}</b> инвентаризация</span>
      </div>

      <div className="admin-product-table-shell">
        <table className="admin-product-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Филиал</th>
              <th>Приход</th>
              <th>Инвентаризация</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.branch} onClick={() => openBranch(row)}>
                <td>{index + 1}</td>
                <td>
                  <button type="button" onClick={(event) => { event.stopPropagation(); openBranch(row); }}>
                    {row.branch}
                  </button>
                </td>
                <td>{formatCurrency(row.income)}</td>
                <td>{formatCurrency(row.inventory)}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan="4" className="admin-product-empty">Филиалы не найдены.</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td>Итого</td>
              <td>{formatCurrency(totals.income)}</td>
              <td>{formatCurrency(totals.inventory)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function AdminFinanceOperationsPage({ search, onNotify }) {
  const [range, setRange] = useState(() => presetRange("Сегодня"));
  const [operations, setOperations] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [organizationFilter, setOrganizationFilter] = useState("all");
  const query = search.trim().toLowerCase();

  useEffect(() => {
    adminApi.get("/finance/transactions", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (items.length) {
          setOperations(items.map((r) => ({
            date: r.date || r.created_at || "",
            number: r.document_number || r.id || "",
            organization: r.organization_name || r.counterparty_name || r.counterparty || "—",
            type: r.direction === "expense" ? "Расход" : "Приход",
            amount: r.direction === "expense" ? -Math.abs(Number(r.amount || 0)) : Math.abs(Number(r.amount || 0)),
            paymentType: r.payment_type_name || r.payment_type || "—",
            status: r.status || "Проведен",
            comment: r.comment || "",
          })));
        }
      })
      .catch(() => {});
  }, []);

  const organizationOptions = useMemo(
    () => Array.from(new Set(operations.map((row) => row.organization))),
    [operations],
  );
  const filteredOperations = operations.filter((row) => {
    const typeMatches = typeFilter === "all" || (typeFilter === "income" ? row.amount > 0 : row.amount < 0);
    const organizationMatches = organizationFilter === "all" || row.organization === organizationFilter;
    const queryMatches = !query || [
      row.date,
      row.time,
      row.paymentType,
      row.counterparty,
      row.category,
      row.organization,
      row.comment,
      String(row.amount),
    ].some((value) => String(value).toLowerCase().includes(query));
    return typeMatches && organizationMatches && queryMatches;
  });
  const visibleTotals = filteredOperations.reduce(
    (total, row) => ({
      income: total.income + (row.amount > 0 ? row.amount : 0),
      expense: total.expense + (row.amount < 0 ? Math.abs(row.amount) : 0),
    }),
    { income: 0, expense: 0 },
  );

  function shiftDay(diff) {
    const start = parseDate(range.start);
    const end = parseDate(range.end);
    start.setDate(start.getDate() + diff);
    end.setDate(end.getDate() + diff);
    const next = { start: formatDate(start), end: formatDate(end), preset: "" };
    setRange({ ...next, label: rangeLabel(next) });
  }

  function chooseToday() {
    setRange(presetRange("Сегодня"));
    onNotify?.("Период денежных операций: сегодня.");
  }

  function deleteOperation(row) {
    setOperations((current) => current.filter((item) => item.id !== row.id));
    onNotify?.(`Операция ${formatSignedFinanceAmount(row.amount)} удалена локально.`);
  }

  return (
    <section className="admin-finance-page">
      <div className="admin-finance-head">
        <div>
          <h2>Денежные операции</h2>
          <p>Приходы, расходы и движения кассы по филиалам.</p>
        </div>
        <div className="admin-finance-date">
          <button type="button" onClick={() => shiftDay(-1)} aria-label="Предыдущая дата">
            <Icon name="bi-chevron-left" size={15} />
          </button>
          <button type="button" className="admin-finance-date__current" onClick={chooseToday}>
            <Icon name="bi-calendar3" size={16} />
            <span>{range.preset ? "Выберите дату" : range.label}</span>
          </button>
          <button type="button" onClick={() => shiftDay(1)} aria-label="Следующая дата">
            <Icon name="bi-chevron-right" size={15} />
          </button>
        </div>
      </div>

      <div className="admin-finance-toolbar">
        <div className="admin-finance-summary is-income">
          <span>Приход</span>
          <strong>{formatCurrency(financeOperationTotals.income)}</strong>
          <small>В таблице: {formatCurrency(visibleTotals.income)}</small>
        </div>
        <div className="admin-finance-summary is-expense">
          <span>Расход</span>
          <strong>{formatCurrency(financeOperationTotals.expense)}</strong>
          <small>В таблице: {formatCurrency(visibleTotals.expense)}</small>
        </div>
        <div className="admin-finance-actions">
          <button type="button" className="admin-finance-action is-income" onClick={() => onNotify?.("Форма прихода готова к открытию.")}>
            <Icon name="bi-plus-lg" size={16} />
            <span>Приход</span>
          </button>
          <button type="button" className="admin-finance-action is-expense" onClick={() => onNotify?.("Форма расхода готова к открытию.")}>
            <Icon name="bi-dash-lg" size={16} />
            <span>Расход</span>
          </button>
          <button type="button" className="admin-finance-action is-export" onClick={() => onNotify?.("Денежные операции подготовлены для Excel.")}>
            <Icon name="bi-file-earmark-excel" size={16} />
            <span>Скачать на Excel</span>
          </button>
          <button type="button" className={`admin-finance-action is-filter ${filtersOpen ? "is-active" : ""}`} onClick={() => setFiltersOpen((value) => !value)}>
            <Icon name="bi-sliders" size={16} />
            <span>Фильтровать</span>
          </button>
        </div>
      </div>

      {filtersOpen ? (
        <div className="admin-finance-filters">
          <label>
            <span>Тип операции</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">Все операции</option>
              <option value="income">Только приход</option>
              <option value="expense">Только расход</option>
            </select>
          </label>
          <label>
            <span>Организация</span>
            <select value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)}>
              <option value="all">Все филиалы</option>
              {organizationOptions.map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => { setTypeFilter("all"); setOrganizationFilter("all"); }}>
            Сбросить
          </button>
        </div>
      ) : null}

      <div className="admin-finance-table-shell">
        <table className="admin-finance-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Сумма</th>
              <th>Тип оплаты</th>
              <th>Контрагент</th>
              <th>Категория</th>
              <th>Организация</th>
              <th>Комментарии</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {filteredOperations.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.date}</strong>
                  <span>{row.time}</span>
                </td>
                <td>
                  <span className={`admin-finance-amount ${row.amount < 0 ? "is-expense" : "is-income"}`}>
                    {formatSignedFinanceAmount(row.amount)}
                  </span>
                </td>
                <td>{row.paymentType}</td>
                <td>{row.counterparty}</td>
                <td><span className="admin-finance-tag">{row.category}</span></td>
                <td>{row.organization}</td>
                <td className="admin-finance-comment">{row.comment}</td>
                <td>
                  <button type="button" className="admin-finance-delete" onClick={() => deleteOperation(row)} aria-label="Удалить операцию">
                    <Icon name="bi-trash3" size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {!filteredOperations.length ? (
              <tr>
                <td colSpan="8" className="admin-finance-empty">Операции не найдены.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdminFinanceCategoriesPage({
  search,
  onNotify,
  title,
  initialRows,
  localPrefix,
  modalCreateTitle,
  modalEditTitle,
  createDescription,
  editDescription,
  emptyText,
  apiEndpoint,
}) {
  const [categories, setCategories] = useState([]);
  const [editor, setEditor] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftStatus, setDraftStatus] = useState("#активно");
  const query = search.trim().toLowerCase();

  useEffect(() => {
    if (!apiEndpoint) return;
    adminApi.get(apiEndpoint, { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (items.length) {
          setCategories(items.map((r) => ({
            name: r.name || "",
            status: r.status !== false ? "#активно" : "#неактивно",
            locked: Boolean(r.is_system),
          })));
        }
      })
      .catch(() => {});
  }, [apiEndpoint]);

  const filteredCategories = categories.filter((row) => (
    !query || row.name.toLowerCase().includes(query) || row.status.toLowerCase().includes(query)
  ));
  const lockedCount = categories.filter((row) => row.locked).length;

  useEffect(() => {
    if (!editor) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") closeEditor();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  function addCategory() {
    setEditor({ mode: "create" });
    setDraftName("");
    setDraftStatus("#активно");
  }

  function editCategory(row) {
    if (row.locked) return;
    setEditor({ mode: "edit", row });
    setDraftName(row.name);
    setDraftStatus(row.status);
  }

  function closeEditor() {
    setEditor(null);
    setDraftName("");
    setDraftStatus("#активно");
  }

  function saveCategory(event) {
    event.preventDefault();
    const nextName = draftName.trim();
    if (!nextName) {
      onNotify?.("Введите название категории.");
      return;
    }
    if (editor?.mode === "create") {
      const next = {
        id: `${localPrefix}-local-${Date.now()}`,
        name: nextName,
        status: draftStatus,
        locked: false,
      };
      setCategories((current) => [next, ...current]);
      onNotify?.(`${nextName}: категория добавлена.`);
    } else if (editor?.row) {
      setCategories((current) => current.map((item) => (
        item.id === editor.row.id ? { ...item, name: nextName, status: draftStatus } : item
      )));
      onNotify?.(`${nextName}: категория сохранена.`);
    }
    closeEditor();
  }

  function deleteCategory(row) {
    if (row.locked) {
      onNotify?.(`${row.name}: системную категорию нельзя удалить.`);
      return;
    }
    setCategories((current) => current.filter((item) => item.id !== row.id));
    onNotify?.(`${row.name}: категория удалена локально.`);
  }

  return (
    <section className="admin-income-page">
      <div className="admin-income-head">
        <div className="admin-income-title">
          <span aria-hidden="true" />
          <div>
            <h2>{title}</h2>
            <p>{filteredCategories.length} категорий, {lockedCount} системные.</p>
          </div>
        </div>
        <button type="button" className="admin-income-add" onClick={addCategory}>
          <span>Добавить</span>
          <Icon name="bi-plus-lg" size={15} />
        </button>
      </div>

      <div className="admin-income-list" role="list">
        {filteredCategories.map((row) => (
          <div className={`admin-income-row ${row.locked ? "is-locked" : ""}`} role="listitem" key={row.id}>
            <div className="admin-income-name">
              <strong>{row.name}</strong>
            </div>
            <div className="admin-income-row__actions">
              <span className={`admin-income-status ${row.status === "#отключено" ? "is-off" : ""}`}>{row.status}</span>
              {row.locked ? (
                <span className="admin-income-lock" aria-label="Системная категория" title="Системная категория">
                  <Icon name="bi-lock" size={15} />
                </span>
              ) : (
                <>
                  <button type="button" className="admin-income-icon is-edit" onClick={() => editCategory(row)} aria-label="Изменить категорию">
                    <Icon name="bi-pencil" size={15} />
                  </button>
                  <button type="button" className="admin-income-icon is-delete" onClick={() => deleteCategory(row)} aria-label="Удалить категорию">
                    <Icon name="bi-trash3" size={15} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {!filteredCategories.length ? (
          <div className="admin-income-empty">{emptyText}</div>
        ) : null}
      </div>

      {editor ? (
        <div className="admin-income-modal" role="dialog" aria-modal="true" aria-label={editor.mode === "create" ? modalCreateTitle : modalEditTitle} onClick={closeEditor}>
          <form className="admin-income-dialog" onSubmit={saveCategory} onClick={(event) => event.stopPropagation()}>
            <div className="admin-income-dialog__head">
              <div>
                <h3>{editor.mode === "create" ? modalCreateTitle : modalEditTitle}</h3>
                <p>{editor.mode === "create" ? createDescription : editDescription}</p>
              </div>
              <button type="button" className="admin-income-dialog__close" onClick={closeEditor} aria-label="Закрыть">
                <Icon name="bi-x-lg" size={16} />
              </button>
            </div>

            <label className="admin-income-field">
              <span>Название <b>*</b></span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Введите название категории"
                autoFocus
              />
            </label>

            <div className="admin-income-status-field">
              <span>Статус</span>
              <button
                type="button"
                className={`admin-income-switch ${draftStatus === "#активно" ? "is-on" : ""}`}
                aria-pressed={draftStatus === "#активно"}
                onClick={() => setDraftStatus((status) => (status === "#активно" ? "#отключено" : "#активно"))}
              >
                <span />
              </button>
            </div>

            <div className="admin-income-dialog__actions is-single">
              <button type="submit" className="is-primary">Сохранить</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function AdminIncomeCategoriesPage({ search, onNotify }) {
  return (
    <AdminFinanceCategoriesPage
      search={search}
      onNotify={onNotify}
      title="Категории приходов"
      initialRows={incomeCategoryRows}
      localPrefix="income"
      modalCreateTitle="Добавить категорию прихода"
      modalEditTitle="Изменить категорию прихода"
      createDescription="Создайте новую категорию для приходных операций."
      editDescription="Измените название и статус категории."
      emptyText="Категории приходов не найдены."
      apiEndpoint="/finance/transaction-categories?kind=income"
    />
  );
}

function AdminExpenseCategoriesPage({ search, onNotify }) {
  return (
    <AdminFinanceCategoriesPage
      search={search}
      onNotify={onNotify}
      title="Категории расходов"
      initialRows={expenseCategoryRows}
      localPrefix="expense"
      modalCreateTitle="Добавить категорию расходов"
      modalEditTitle="Изменить категория расходов"
      createDescription="Создайте новую категорию для расходных операций."
      editDescription="Измените название и статус категории расходов."
      emptyText="Категории расходов не найдены."
      apiEndpoint="/finance/transaction-categories?kind=expense"
    />
  );
}

function AdminPaymentMethodsPage({ search, onNotify }) {
  const [methods, setMethods] = useState([]);
  const [editor, setEditor] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState("Карта");
  const [draftStatus, setDraftStatus] = useState("#активно");
  const [draftVip, setDraftVip] = useState(false);
  const query = search.trim().toLowerCase();

  useEffect(() => {
    adminApi.get("/finance/payment-types", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (items.length) {
          setMethods(items.map((r) => ({
            name: r.name || "",
            type: r.type || "Карта",
            status: r.status !== false ? "#активно" : "#неактивно",
            vip: Boolean(r.is_vip),
          })));
        }
      })
      .catch(() => {});
  }, []);
  const filteredMethods = methods
    .filter((row) => !query || [row.name, row.type, row.status].some((value) => value.toLowerCase().includes(query)))
    .sort((a, b) => a.sort - b.sort);

  useEffect(() => {
    if (!editor) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") closeEditor();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  function openCreate() {
    setEditor({ mode: "create" });
    setDraftName("");
    setDraftType("Карта");
    setDraftStatus("#активно");
    setDraftVip(false);
  }

  function openEdit(row) {
    setEditor({ mode: "edit", row });
    setDraftName(row.name);
    setDraftType(row.type);
    setDraftStatus(row.status);
    setDraftVip(Boolean(row.vip));
  }

  function closeEditor() {
    setEditor(null);
    setDraftName("");
    setDraftType("Карта");
    setDraftStatus("#активно");
    setDraftVip(false);
  }

  function saveMethod(event) {
    event.preventDefault();
    const nextName = draftName.trim();
    if (!nextName) {
      onNotify?.("Введите название способа оплаты.");
      return;
    }
    if (editor?.mode === "create") {
      const nextSort = methods.reduce((max, row) => Math.max(max, Number(row.sort) || 0), 0) + 1;
      setMethods((current) => [{
        id: `payment-local-${Date.now()}`,
        sort: nextSort,
        name: nextName,
        type: draftType,
        status: draftStatus,
        vip: draftVip,
      }, ...current]);
      onNotify?.(`${nextName}: способ оплаты добавлен.`);
    } else if (editor?.row) {
      setMethods((current) => current.map((item) => (
        item.id === editor.row.id
          ? { ...item, name: nextName, type: draftType, status: draftStatus, vip: draftVip }
          : item
      )));
      onNotify?.(`${nextName}: способ оплаты сохранён.`);
    }
    closeEditor();
  }

  function deleteMethod(row) {
    setMethods((current) => current.filter((item) => item.id !== row.id));
    onNotify?.(`${row.name}: способ оплаты удалён локально.`);
  }

  function updateSort(row, value) {
    const nextSort = Math.max(1, Number(value) || 1);
    setMethods((current) => current.map((item) => (
      item.id === row.id ? { ...item, sort: nextSort } : item
    )));
  }

  return (
    <section className="admin-income-page admin-payment-page">
      <div className="admin-income-head">
        <div className="admin-income-title">
          <span aria-hidden="true" />
          <div>
            <h2>Способ оплаты</h2>
            <p>{filteredMethods.length} способов, {methods.filter((row) => row.vip).length} VIP.</p>
          </div>
        </div>
        <button type="button" className="admin-income-add" onClick={openCreate}>
          <span>Добавить</span>
          <Icon name="bi-plus-lg" size={15} />
        </button>
      </div>

      <div className="admin-payment-table" role="table" aria-label="Способы оплаты">
        <div className="admin-payment-table__row admin-payment-table__head" role="row">
          <span>Сорт</span>
          <span>Название</span>
          <span>Тип</span>
          <span>Статус</span>
          <span aria-label="Действия" />
        </div>
        {filteredMethods.map((row) => (
          <div className="admin-payment-table__row" role="row" key={row.id}>
            <span>
              <input
                type="number"
                min="1"
                value={row.sort}
                onChange={(event) => updateSort(row, event.target.value)}
                aria-label={`Сортировка ${row.name}`}
              />
            </span>
            <strong>{row.name}</strong>
            <span>{row.type}</span>
            <span className={`admin-income-status ${row.status === "#отключено" ? "is-off" : ""}`}>{row.status}</span>
            <span className="admin-payment-actions">
              <button type="button" className="admin-income-icon is-edit" onClick={() => openEdit(row)} aria-label="Изменить способ оплаты">
                <Icon name="bi-pencil" size={15} />
              </button>
              <button type="button" className="admin-income-icon is-delete" onClick={() => deleteMethod(row)} aria-label="Удалить способ оплаты">
                <Icon name="bi-trash3" size={15} />
              </button>
            </span>
          </div>
        ))}
        {!filteredMethods.length ? (
          <div className="admin-income-empty">Способы оплаты не найдены.</div>
        ) : null}
      </div>

      {editor ? (
        <div className="admin-income-modal" role="dialog" aria-modal="true" aria-label={editor.mode === "create" ? "Добавить способ оплаты" : "Изменить способ оплаты"} onClick={closeEditor}>
          <form className="admin-income-dialog admin-payment-dialog" onSubmit={saveMethod} onClick={(event) => event.stopPropagation()}>
            <div className="admin-income-dialog__head">
              <div>
                <h3>{editor.mode === "create" ? "Добавить способ оплаты" : "Изменить способ оплаты"}</h3>
              </div>
              <button type="button" className="admin-income-dialog__close" onClick={closeEditor} aria-label="Закрыть">
                <Icon name="bi-x-lg" size={16} />
              </button>
            </div>

            <label className="admin-income-field">
              <span>Название <b>*</b></span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Введите название способа оплаты"
                autoFocus
              />
            </label>

            <label className="admin-income-field admin-payment-select-field">
              <span>Тип оплаты</span>
              <select value={draftType} onChange={(event) => setDraftType(event.target.value)}>
                <option value="Карта">Карта</option>
                <option value="Наличные">Наличные</option>
                <option value="Онлайн">Онлайн</option>
                <option value="Перечисление">Перечисление</option>
              </select>
            </label>

            <div className="admin-income-status-field">
              <span>Статус</span>
              <button
                type="button"
                className={`admin-income-switch ${draftStatus === "#активно" ? "is-on" : ""}`}
                aria-pressed={draftStatus === "#активно"}
                onClick={() => setDraftStatus((status) => (status === "#активно" ? "#отключено" : "#активно"))}
              >
                <span />
              </button>
            </div>

            <div className="admin-income-status-field">
              <span>VIP</span>
              <button
                type="button"
                className={`admin-income-switch ${draftVip ? "is-on" : ""}`}
                aria-pressed={draftVip}
                onClick={() => setDraftVip((value) => !value)}
              >
                <span />
              </button>
            </div>

            <div className="admin-income-dialog__actions is-single">
              <button type="submit" className="is-primary">Сохранить</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function AdminFinanceHistoryPage({ search, onNotify }) {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const query = search.trim().toLowerCase();

  useEffect(() => {
    adminApi.get("/finance/finance-history", { params: { size: 200 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (items.length) {
          setRows(items.map((r, i) => ({
            id: r.id || `fh-${i}`,
            number: i + 1,
            recordId: r.record_id || r.id || "",
            date: r.date || r.created_at || "",
            companyId: r.company_id || "",
            organization: r.organization_name || r.organization || "",
            newAmount: r.new_amount || "",
            oldAmount: r.old_amount || "",
            type: r.type || "",
            user: r.user_name || r.user || "",
            comment: r.comment || "",
          })));
        }
      })
      .catch(() => {});
  }, []);

  const filteredRows = rows.filter((row) => (
    !query || [
      row.recordId,
      row.date,
      row.companyId,
      row.organization,
      row.newAmount,
      row.oldAmount,
      row.type,
      row.user,
      row.comment,
    ].some((value) => String(value).toLowerCase().includes(query))
  ));
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function goToPage(nextPage) {
    const safePage = Math.min(Math.max(nextPage, 1), totalPages);
    setPage(safePage);
  }

  return (
    <section className="admin-income-page admin-history-page">
      <div className="admin-income-head">
        <div className="admin-income-title">
          <span aria-hidden="true" />
          <div>
            <h2>История изменений</h2>
            <p>{filteredRows.length} записей журнала.</p>
          </div>
        </div>
      </div>

      <div className="admin-history-table-wrap">
        <table className="admin-history-table">
          <thead>
            <tr>
              <th>№</th>
              <th>ID</th>
              <th>Дата</th>
              <th>Компания ID</th>
              <th>Организация</th>
              <th>Новая сумма</th>
              <th>Старая сумма</th>
              <th>Тип</th>
              <th>Пользователь</th>
              <th>Комментарии</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id}>
                <td>{row.number}</td>
                <td>{row.recordId}</td>
                <td>{row.date}</td>
                <td>{row.companyId}</td>
                <td>{row.organization}</td>
                <td>{row.newAmount}</td>
                <td>{row.oldAmount}</td>
                <td><span className="admin-history-type">{row.type}</span></td>
                <td>{row.user}</td>
                <td className="admin-history-comment">{row.comment || "—"}</td>
              </tr>
            ))}
            {!pageRows.length ? (
              <tr>
                <td colSpan="10" className="admin-history-empty">История изменений не найдена.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="admin-history-pager">
        <button type="button" onClick={() => goToPage(page - 1)} disabled={page === 1} aria-label="Предыдущая страница">
          <Icon name="bi-chevron-left" size={14} />
        </button>
        {[1, 2, 3].map((item) => (
          <button type="button" key={item} className={page === item ? "is-active" : ""} onClick={() => goToPage(item)}>
            {item}
          </button>
        ))}
        <span>...</span>
        <button type="button" onClick={() => onNotify?.("Доступны следующие страницы истории после загрузки с сервера.")}>23</button>
        <button type="button" onClick={() => goToPage(page + 1)} disabled={page === totalPages} aria-label="Следующая страница">
          <Icon name="bi-chevron-right" size={14} />
        </button>
      </div>
    </section>
  );
}

function AdminCashierBackgroundPage({ search, onNotify }) {
  const [backgrounds, setBackgrounds] = useState([]);
  const [editor, setEditor] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftSort, setDraftSort] = useState("1");
  const [draftPhoto, setDraftPhoto] = useState("");
  const fileInputRef = useRef(null);
  const query = search.trim().toLowerCase();

  useEffect(() => {
    adminApi.get("/image-backgrounds", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (items.length) {
          setBackgrounds(items.map((r, i) => ({
            id: r.id || `bg-${i}`,
            name: r.name || "",
            sort: r.sort_order || i + 1,
            photo: r.image_url || r.photo || "",
          })));
        }
      })
      .catch(() => {});
  }, []);
  const filteredBackgrounds = backgrounds
    .filter((row) => !query || row.name.toLowerCase().includes(query) || row.photo.toLowerCase().includes(query))
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));

  useEffect(() => {
    if (!editor) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") closeEditor();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  function openCreate() {
    setEditor({ mode: "create" });
    setDraftName("");
    setDraftSort(String(backgrounds.length + 1));
    setDraftPhoto("");
  }

  function openEdit(row) {
    setEditor({ mode: "edit", row });
    setDraftName(row.name);
    setDraftSort(String(row.sort || 1));
    setDraftPhoto(row.photo);
  }

  function closeEditor() {
    setEditor(null);
    setDraftName("");
    setDraftSort("1");
    setDraftPhoto("");
  }

  function chooseImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onNotify?.("Выберите файл изображения.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setDraftPhoto(reader.result);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function saveBackground(event) {
    event.preventDefault();
    const nextName = draftName.trim();
    const nextSort = Math.max(1, Number(draftSort) || 1);
    const nextPhoto = draftPhoto.trim();
    if (!nextName || !nextPhoto) {
      onNotify?.("Введите название и выберите изображение.");
      return;
    }
    if (editor?.mode === "create") {
      setBackgrounds((current) => [{
        id: `cashier-bg-local-${Date.now()}`,
        name: nextName,
        sort: nextSort,
        photo: nextPhoto,
      }, ...current]);
      onNotify?.(`${nextName}: фон добавлен.`);
    } else if (editor?.row) {
      setBackgrounds((current) => current.map((row) => (
        row.id === editor.row.id ? { ...row, name: nextName, sort: nextSort, photo: nextPhoto } : row
      )));
      onNotify?.(`${nextName}: фон обновлён.`);
    }
    closeEditor();
  }

  function deleteBackground(row) {
    setBackgrounds((current) => current.filter((item) => item.id !== row.id));
    onNotify?.(`${row.name}: фон удалён локально.`);
  }

  return (
    <section className="admin-income-page admin-cashier-bg-page">
      <div className="admin-income-head">
        <div className="admin-income-title">
          <span aria-hidden="true" />
          <div>
            <h2>Фон для кассира</h2>
            <p>{filteredBackgrounds.length} фонов для кассового экрана.</p>
          </div>
        </div>
        <button type="button" className="admin-income-add" onClick={openCreate}>
          <span>Добавить</span>
          <Icon name="bi-plus-lg" size={15} />
        </button>
      </div>

      <div className="admin-cashier-bg-table" role="table" aria-label="Фоны для кассира">
        <div className="admin-cashier-bg-row admin-cashier-bg-head" role="row">
          <span>Название</span>
          <span>Фото</span>
          <span aria-label="Действия" />
        </div>
        {filteredBackgrounds.map((row) => (
          <div className="admin-cashier-bg-row" role="row" key={row.id}>
            <strong>{row.name}</strong>
            <span className="admin-cashier-bg-preview">
              <img src={row.photo} alt={row.name} loading="lazy" />
            </span>
            <span className="admin-payment-actions">
              <button type="button" className="admin-income-icon is-edit" onClick={() => openEdit(row)} aria-label="Редактировать фон">
                <Icon name="bi-pencil" size={15} />
              </button>
              <button type="button" className="admin-income-icon is-delete" onClick={() => deleteBackground(row)} aria-label="Удалить фон">
                <Icon name="bi-trash3" size={15} />
              </button>
            </span>
          </div>
        ))}
        {!filteredBackgrounds.length ? (
          <div className="admin-income-empty">Фоны для кассира не найдены.</div>
        ) : null}
      </div>

      {editor ? (
        <div className="admin-income-modal" role="dialog" aria-modal="true" aria-label={editor.mode === "create" ? "Добавить фон для кассира" : "Изменить фон для кассира"} onClick={closeEditor}>
          <form className="admin-income-dialog admin-cashier-bg-dialog" onSubmit={saveBackground} onClick={(event) => event.stopPropagation()}>
            <div className="admin-income-dialog__head">
              <div>
                <h3>{editor.mode === "create" ? "Добавить Фон" : "Изменить Фон"}</h3>
              </div>
              <button type="button" className="admin-income-dialog__close" onClick={closeEditor} aria-label="Закрыть">
                <Icon name="bi-x-lg" size={16} />
              </button>
            </div>

            <label className="admin-income-field">
              <span>Название <b>*</b></span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Введите название фона"
                autoFocus
              />
            </label>

            <label className="admin-income-field">
              <span>Сортировка</span>
              <input
                type="number"
                min="1"
                value={draftSort}
                onChange={(event) => setDraftSort(event.target.value)}
              />
            </label>

            <div className="admin-cashier-upload">
              <span>Загрузить изображение</span>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={chooseImage} />
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                <Icon name="bi-image" size={15} />
                <span>Выбрать изображение</span>
              </button>
            </div>

            {draftPhoto.trim() ? (
              <div className="admin-cashier-bg-dialog__preview">
                <img src={draftPhoto.trim()} alt="Предпросмотр фона" />
              </div>
            ) : null}

            <div className="admin-income-dialog__actions is-single">
              <button type="submit" className="is-primary">Сохранить</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function CategoryPage({ active, rowsOverride, search, onCreate, onRowDetail, onNotify }) {
  const content = categoryContent[active] || categoryContent["org-list"];
  const { apiRows } = useAdminData(active);
  if (active === "org-list") {
    return <OrganizationDirectoryPage search={search} onRowDetail={onRowDetail} onNotify={onNotify} />;
  }
  if (active === "org-status") {
    return <OrganizationStatusPage search={search} onNotify={onNotify} />;
  }
  if (active === "nom-product") {
    return <ProductNomenclaturePage search={search} onNotify={onNotify} />;
  }
  if (active === "fin-operations") {
    return <AdminFinanceOperationsPage search={search} onNotify={onNotify} />;
  }
  if (active === "fin-income-cat") {
    return <AdminIncomeCategoriesPage search={search} onNotify={onNotify} />;
  }
  if (active === "fin-expense-cat") {
    return <AdminExpenseCategoriesPage search={search} onNotify={onNotify} />;
  }
  if (active === "fin-payment") {
    return <AdminPaymentMethodsPage search={search} onNotify={onNotify} />;
  }
  if (active === "fin-history") {
    return <AdminFinanceHistoryPage search={search} onNotify={onNotify} />;
  }
  if (active === "set-cashier-bg") {
    return <AdminCashierBackgroundPage search={search} onNotify={onNotify} />;
  }
  const dataRows = apiRows;
  const rows = dataRows.filter((row) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return row.some((cell) => String(cell).toLowerCase().includes(query));
  });
  return (
    <section className="admin-category-page">
      <div className="admin-panel-head">
        <div>
          <h2>{content.title}</h2>
          <p>{content.text}</p>
        </div>
        <button type="button" onClick={() => onCreate(active)}>Создать</button>
      </div>
      <div className="admin-category-table">
        <div className="admin-category-table__row admin-category-table__head" style={{ gridTemplateColumns: `repeat(${content.columns.length}, minmax(0, 1fr))` }}>
          {content.columns.map((column) => <span key={column}>{column}</span>)}
        </div>
        {rows.map((row, rowIndex) => (
          <div className="admin-category-table__row" style={{ gridTemplateColumns: `repeat(${content.columns.length}, minmax(0, 1fr))` }} key={rowIndex} role="button" tabIndex={0} onClick={() => onRowDetail(content.title, content.columns, row)} onKeyDown={(event) => { if (event.key === "Enter") onRowDetail(content.title, content.columns, row); }}>
            {row.map((cell, index) => index === row.length - 1 ? <StatusBadge status={cell} key={index} /> : <span key={index}>{cell}</span>)}
          </div>
        ))}
      </div>
    </section>
  );
}

function getPageList(current, total) {
  // Номера страниц с многоточиями: 1 … c-1 c c+1 … total
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const list = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const p of list) {
    if (p - prev > 1) result.push("…");
    result.push(p);
    prev = p;
  }
  return result;
}

function TransactionsTable() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  useEffect(() => {
    adminApi.get("/finance/transactions", { params: { size: 50 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        setRows(items.map((r, i) => ({
            id: r.id_num || i + 1,
            uuid: r.id || "",
            date: r.date || r.created_at || "",
            orgId: r.organization_id || "",
            name: r.organization_name || r.counterparty_name || "",
            payType: r.payment_type_name || r.payment_type || "",
            amount: r.amount ? `${Number(r.amount).toLocaleString("ru-RU")} UZS` : "0 UZS",
            kind: r.direction === "income" ? "Приход" : "Расход",
            status: r.status || "PAID",
            paymentFor: r.payment_for || r.category_name || "",
            comment: r.comment || "",
          })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => { setPage(1); }, [query]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(q));
  }, [query, rows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(startIndex, startIndex + pageSize);
  const pageList = getPageList(currentPage, totalPages);

  const columns = [
    { key: "id", label: "ID", width: 66 },
    { key: "uuid", label: "UUID", width: 214 },
    { key: "date", label: "Дата", width: 150 },
    { key: "orgId", label: "ID Организация", width: 120 },
    { key: "name", label: "Названия", width: 200 },
    { key: "payType", label: "Тип оплаты", width: 120 },
    { key: "amount", label: "Сумма", width: 140 },
    { key: "kind", label: "Тип", width: 92 },
    { key: "status", label: "Status", width: 90 },
    { key: "paymentFor", label: "Оплата за", width: 168 },
    { key: "comment", label: "Комментария", width: 120 },
    { key: "actions", label: "", width: 54 },
  ];

  function renderCell(column, row) {
    switch (column.key) {
      case "id": return <span className="admin-tx-id">{row.id}</span>;
      case "uuid": return <span className="admin-tx-uuid">{row.uuid}</span>;
      case "name": return <strong className="org-directory-name">{row.name}</strong>;
      case "amount": return <span className="admin-tx-amount">{row.amount}</span>;
      case "kind": return <span className="org-directory-flag org-directory-flag--success">{row.kind}</span>;
      case "status": return <span className="org-directory-flag org-directory-flag--success">{row.status}</span>;
      case "comment": return row.comment ? row.comment : "—";
      case "actions": return (
        <button type="button" className="admin-tx-edit" aria-label={`Редактировать транзакцию ${row.id}`}>
          <Icon name="bi-pencil" size={14} />
        </button>
      );
      default: return row[column.key];
    }
  }

  return (
    <section className="admin-table-card admin-transactions">
      <div className="admin-panel-head admin-transactions__head">
        <div>
          <h2>Последние транзакции</h2>
        </div>
        <label className="org-directory-search admin-transactions__search">
          <Icon name="bi-search" size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" />
        </label>
      </div>

      <div className="org-directory-table-shell">
        <table className="org-directory-table admin-transactions__table">
          <colgroup>
            {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
          </colgroup>
          <thead>
            <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => <td key={column.key}>{renderCell(column, row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!pageRows.length ? <div className="org-directory-empty">Транзакции не найдены.</div> : null}
      </div>

      <div className="org-directory-footer admin-transactions__footer">
        <span>{filteredRows.length ? `${startIndex + 1}-${Math.min(startIndex + pageSize, filteredRows.length)} из ${filteredRows.length}` : "0 из 0"}</span>
        <div className="admin-transactions__pager">
          <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Предыдущая страница">
            <Icon name="bi-chevron-left" size={15} />
          </button>
          {pageList.map((item, index) => (
            item === "…" ? (
              <span className="admin-transactions__ellipsis" key={`gap-${index}`}>…</span>
            ) : (
              <button
                type="button"
                key={item}
                className={`admin-transactions__page ${item === currentPage ? "is-active" : ""}`}
                onClick={() => setPage(item)}
                aria-current={item === currentPage ? "page" : undefined}
              >
                {item}
              </button>
            )
          ))}
          <button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} aria-label="Следующая страница">
            <Icon name="bi-chevron-right" size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}

function DashboardPage({ segment, onSegmentChange, organizationRows, approvals, dashKpis, onExport, onRowAction, onApprovalAction, onShowApprovals, onKpiClick, onOrgClick, onApprovalClick, onSystemClick }) {
  const displayKpis = dashKpis || kpis;
  return (
    <>
      <section className="admin-kpi-grid">
        {displayKpis.map((item) => <KpiCard item={item} key={item.title} onClick={onKpiClick} />)}
      </section>
      <div className="admin-dashboard-grid">
        <main className="admin-center">
          <PlatformChart segment={segment} onSegmentChange={onSegmentChange} />
          <OrganizationsTable rows={organizationRows} onExport={onExport} onRowAction={onRowAction} onRowClick={onOrgClick} />
        </main>
        <RightColumn
          approvals={approvals}
          onApprovalAction={onApprovalAction}
          onShowApprovals={onShowApprovals}
          onApprovalClick={onApprovalClick}
          onSystemClick={onSystemClick}
        />
      </div>
      <TransactionsTable />
    </>
  );
}

function DetailModal({ data, onClose }) {
  useEffect(() => {
    function onKey(event) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!data) return null;
  const actions = data.actions && data.actions.length
    ? data.actions
    : [{ label: "Закрыть", variant: "ghost", onClick: onClose }];

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label={data.title} onClick={onClose}>
      <div className="admin-modal__panel" onClick={(event) => event.stopPropagation()}>
        <div className="admin-modal__head">
          <div>
            <h3>{data.title}</h3>
            {data.subtitle ? <p>{data.subtitle}</p> : null}
          </div>
          {data.status ? <StatusBadge status={data.status} /> : null}
          <button className="admin-modal__close" type="button" onClick={onClose} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={18} />
          </button>
        </div>
        <dl className="admin-modal__fields">
          {data.fields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
        <div className="admin-modal__actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`admin-modal__btn ${action.variant === "ghost" ? "is-ghost" : "is-primary"}`}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminShell({ onLogout }) {
  const [active, setActive] = useState("dashboard");
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const search = "";
  const [segment, setSegment] = useState("Месяц");
  const [dateRange, setDateRange] = useState(() => presetRange("Сегодня"));
  const [organizations, setOrganizations] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [categoryRows, setCategoryRows] = useState({});
  const [detail, setDetail] = useState(null);
  const [dashKpis, setDashKpis] = useState(kpis);

  const closeDetail = () => setDetail(null);

  useEffect(() => {
    let mounted = true;
    if (localStorage.getItem("admin_local_login") === "true") {
      setUser({ email: "admin.900078779@marjon.local", phone: "+998900078779", name: "Super Admin", is_superadmin: true });
      adminApi.get("/organizations", { params: { size: 5 } })
        .then(({ data }) => {
          if (!mounted) return;
          const items = Array.isArray(data) ? data : data?.items || [];
          if (items.length) {
            setOrganizations(items.map((r) => [
              r.company_name || r.name || "", r.type || "Ресторан",
              String(r.branches_count || 0), r.admin_name || r.owner_name || "—",
              r.created_at || "—", r.status || "Активна",
            ]));
          }
        })
        .catch(() => {});
      adminApi.get("/admin-reports/dashboard-kpis")
        .then(({ data }) => {
          if (!mounted || !data) return;
          setDashKpis((prev) => prev.map((kpi) => {
            const v = data[kpi.dataKey];
            return v != null ? { ...kpi, value: typeof v === "number" ? v.toLocaleString("ru-RU") : String(v) } : kpi;
          }));
        })
        .catch(() => {});
      return () => { mounted = false; };
    }
    adminApi.get("/auth/me")
      .then(({ data }) => mounted && setUser(data))
      .catch(() => mounted && setMessage("Профиль не загружен. Проверьте права доступа."));
    adminApi.get("/organizations", { params: { size: 5 } })
      .then(({ data }) => {
        if (!mounted) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        if (items.length) {
          setOrganizations(items.map((r) => [
            r.company_name || r.name || "", r.type || "Ресторан",
            String(r.branches_count || 0), r.admin_name || r.owner_name || "—",
            r.created_at || "—", r.status || "Активна",
          ]));
        }
      })
      .catch(() => {});
    adminApi.get("/admin-reports/dashboard-kpis")
      .then(({ data }) => {
        if (!mounted || !data) return;
        setDashKpis((prev) => prev.map((kpi) => {
          const v = data[kpi.dataKey];
          return v != null ? { ...kpi, value: typeof v === "number" ? v.toLocaleString("ru-RU") : String(v) } : kpi;
        }));
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(""), 3200);
    return () => clearTimeout(timer);
  }, [message]);

  const filteredOrganizations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return organizations;
    return organizations.filter((row) => row.some((cell) => String(cell).toLowerCase().includes(query)));
  }, [organizations, search]);

  function downloadCsv(filename, rows) {
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleCreate(section) {
    const content = categoryContent[section] || categoryContent["org-list"];
    const nextRow = content.columns.map((column, index) => {
      if (index === 0) return `Новая запись ${Date.now().toString().slice(-4)}`;
      if (index === content.columns.length - 1) return "Новый";
      return "—";
    });
    setCategoryRows((current) => ({
      ...current,
      [section]: [nextRow, ...(current[section] || content.rows)],
    }));
    setMessage("Запись создана локально.");
  }

  function handleRowAction(name) {
    setOrganizations((current) => current.map((row) => (
      row[0] === name
        ? row.map((cell, index) => (index === row.length - 1 ? (cell === "Активна" ? "На модерации" : "Активна") : cell))
        : row
    )));
    setMessage(`Статус обновлен: ${name}`);
  }

  function handleApprovalAction(item) {
    setApprovals((current) => current.filter((entry) => entry !== item));
    setMessage(`${item[0]}: заявка обработана.`);
  }

  function openKpiDetail(item) {
    setDetail({
      title: item.title,
      subtitle: "Ключевой показатель платформы",
      fields: [
        { label: "Текущее значение", value: item.value },
        { label: "Динамика", value: item.delta },
        { label: "Описание", value: item.desc },
      ],
    });
  }

  function openOrgDetail(row) {
    setDetail({
      title: row[0],
      subtitle: row[1],
      status: row[5],
      fields: [
        { label: "Тип", value: row[1] },
        { label: "Филиалов", value: row[2] },
        { label: "Администратор", value: row[3] },
        { label: "Дата регистрации", value: row[4] },
        { label: "Статус", value: row[5] },
      ],
      actions: [
        { label: "Сменить статус", variant: "primary", onClick: () => { handleRowAction(row[0]); closeDetail(); } },
        { label: "Закрыть", variant: "ghost", onClick: closeDetail },
      ],
    });
  }

  function openApprovalDetail(item) {
    setDetail({
      title: item[0],
      subtitle: item[1],
      fields: [
        { label: "Тип заявки", value: item[1] },
        { label: "Получено", value: item[2] },
        { label: "Рекомендуемое действие", value: item[3] },
      ],
      actions: [
        { label: item[3], variant: "primary", onClick: () => { handleApprovalAction(item); closeDetail(); } },
        { label: "Закрыть", variant: "ghost", onClick: closeDetail },
      ],
    });
  }

  function openSystemDetail(item) {
    setDetail({
      title: item[0],
      subtitle: "Состояние подсистемы",
      fields: [
        { label: "Компонент", value: item[0] },
        { label: "Состояние", value: item[1] },
        { label: "Аптайм за 30 дней", value: "99.98%" },
      ],
    });
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
      title: user?.name || "Александр П.",
      subtitle: "Профиль администратора",
      status: "Активна",
      fields: [
        { label: "Роль", value: user?.is_superadmin ? "Суперадмин" : "Администратор" },
        { label: "Телефон", value: user?.phone || "900000777" },
        { label: "Доступ", value: "Полный доступ" },
      ],
      actions: [
        { label: "Выйти", variant: "primary", onClick: () => { closeDetail(); logout(); } },
        { label: "Закрыть", variant: "ghost", onClick: closeDetail },
      ],
    });
  }

  const page = useMemo(() => (
    active === "dashboard" ? (
      <DashboardPage
        segment={segment}
        onSegmentChange={setSegment}
        organizationRows={filteredOrganizations}
        approvals={approvals}
        dashKpis={dashKpis}
        onExport={() => downloadCsv("marjon-organizations.csv", [["Организация", "Тип", "Филиалов", "Админ", "Дата регистрации", "Статус"], ...filteredOrganizations])}
        onRowAction={handleRowAction}
        onApprovalAction={handleApprovalAction}
        onShowApprovals={() => setMessage(`Показаны все заявки: ${approvals.length}.`)}
        onKpiClick={openKpiDetail}
        onOrgClick={openOrgDetail}
        onApprovalClick={openApprovalDetail}
        onSystemClick={openSystemDetail}
      />
    ) : (
      <CategoryPage active={active} rowsOverride={categoryRows[active]} search={search} onCreate={handleCreate} onRowDetail={openCategoryRowDetail} onNotify={setMessage} />
    )
  ), [active, approvals, categoryRows, dashKpis, filteredOrganizations, search, segment]);

  function logout() {
    adminLogout();
    onLogout();
  }

  return (
    <div className={`admin-shell ${collapsed ? "is-sidebar-collapsed" : ""}`}>
      <Sidebar active={active} onSelect={setActive} collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} user={user} onProfile={openProfileDetail} />
      <section className="admin-main">
        <Header
          user={user}
          onLogout={logout}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onBellClick={() => setMessage(`Непрочитанных уведомлений: ${approvals.length}.`)}
          notificationCount={approvals.length}
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

export default function AdminApp() {
  const [authenticated, setAuthenticated] = useState(() => isAdminAuthenticated());
  return authenticated ? (
    <AdminShell onLogout={() => setAuthenticated(false)} />
  ) : (
    <LoginView onLogin={() => setAuthenticated(true)} />
  );
}

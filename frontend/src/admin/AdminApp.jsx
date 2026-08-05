import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart, CategoryScale, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import logo from "../assets/marjon-logo.svg";
import { adminApi, adminLogin, adminLogout, isAdminAuthenticated } from "./api";
import Icon from '../components/Icon';
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { createPortal } from "react-dom";

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

const DEMO_ORGANIZATION_ROW_COUNT = 240;
const DEMO_TRANSACTION_ROW_COUNT = 96;

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
    title: "Оплаченная сумма",
    value: "0",
    delta: "—",
    icon: "bi-cash-coin",
    tone: "green",
    dataKey: "branches",
    points: [18, 24, 32, 28, 42, 48, 51, 60],
    desc: "Филиалы с активной кассой и работающей синхронизацией за выбранный период.",
  },
  {
    title: "Выполненная работа",
    value: "0",
    delta: "—",
    icon: "bi-clipboard-check",
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
    title: "Не оплачено",
    value: "0",
    delta: "—",
    icon: "bi-receipt",
    tone: "cyan",
    dataKey: "cashboxes",
    points: [18, 22, 28, 27, 35, 42, 47, 55],
    desc: "Подключённые кассовые рабочие места с активной синхронизацией.",
  },
];

const ADMIN_DASHBOARD_DEMO_MODE = true;

const demoKpiOverrides = {
  organizations: {
    value: DEMO_ORGANIZATION_ROW_COUNT.toLocaleString("ru-RU"),
    delta: "Демо-база клиентов",
    points: [1, 1, 1, 1, 1, 1, 1, 1],
    desc: "Демо-база организаций для проверки админского дашборда без записи данных в backend.",
  },
  branches: {
    value: "2",
    delta: "+2 активных филиала",
    points: [1, 1, 1, 2, 2, 2, 2, 2],
    desc: "Два активных филиала Marjon Cafe с рабочими кассами и синхронизацией.",
  },
  subscriptions: {
    value: "1",
    delta: "1 заявка на одобрение",
    points: [0, 1, 1, 0, 1, 1, 1, 1],
    desc: "Одна демо-заявка Marjon Cafe ожидает решения администратора.",
  },
  revenue: {
    value: "187 450 000 UZS",
    delta: "+24% к прошлому месяцу",
    points: [18, 42, 76, 119, 156, 187],
    desc: "Демо-оборот Marjon Cafe за текущий месяц.",
  },
  cashboxes: {
    value: "4",
    delta: "3 онлайн, 1 резерв",
    points: [2, 2, 3, 3, 4, 4, 4, 4],
    desc: "Кассовые рабочие места Marjon Cafe: три активные кассы и одна резервная.",
  },
};

const dashboardKpiOrder = ["revenue", "organizations", "subscriptions", "branches", "cashboxes"];

function orderDashboardKpis(items) {
  return [...items].sort((a, b) => {
    const firstIndex = dashboardKpiOrder.indexOf(a.dataKey);
    const secondIndex = dashboardKpiOrder.indexOf(b.dataKey);
    return (firstIndex === -1 ? dashboardKpiOrder.length : firstIndex) - (secondIndex === -1 ? dashboardKpiOrder.length : secondIndex);
  });
}

const demoKpis = orderDashboardKpis(kpis.map((kpi) => ({
  ...kpi,
  ...(demoKpiOverrides[kpi.dataKey] || {}),
})));

const dashboardWarehouseCards = [
  { title: "Приход товаров", value: "11 575 000 UZS", subtitle: "За всё время", icon: "bi-box-arrow-in-down", tone: "income", route: "storage-income" },
  { title: "Расход товаров", value: "0 UZS", subtitle: "За всё время", icon: "bi-box-arrow-up", tone: "expense", route: "storage-expense" },
  { title: "Остаток склада", value: "958 892 000 UZS", subtitle: "Текущий остаток", icon: "bi-boxes", tone: "stock", route: "storage-balance" },
  { title: "Общие затраты", value: "0 UZS", subtitle: "За всё время", icon: "bi-receipt", tone: "cost" },
  { title: "Кредиторка", value: "994 000 UZS", subtitle: "Текущая задолженность", icon: "bi-credit-card", tone: "payable" },
  { title: "Дебиторка", value: "0 UZS", subtitle: "Текущая задолженность", icon: "bi-wallet2", tone: "receivable" },
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

const demoOrganizationNames = [
  "MARJON CAFE", "MUSTAFO CAFE", "BAYKAL RESTAURANT", "SAMARKAND PLOV", "CHILONZOR GRILL",
  "YUNUSABAD COFFEE", "BESH QOZON", "TASHKENT FOOD HALL", "NAVOI STEAK HOUSE", "BUKHARA LAGMAN",
  "ANDIJON OSH MARKAZI", "FARGONA FAMILY CAFE", "NAMANGAN BURGER", "QARSHI DONER", "NUKUS BBQ",
  "URGENCH TERRACE", "JIZZAX SOMSA", "DENOV TEA HOUSE", "KOKAND BISTRO", "TERMIZ GARDEN",
  "SIRDARYO FAST FOOD", "ZARAFSHON BALIQ", "RISHTON CHOYXONA", "SHAHRISABZ CAFE",
];

const demoOrganizationRegions = [
  "Toshkent", "Andijon", "Samarqand", "Fargona", "Namangan", "Buxoro", "JIZZAX", "Navoiy",
  "Qashqadaryo", "Surxondaryo", "Xorazm", "Qoraqalpogiston", "Sirdaryo",
];

const demoOrganizationManagers = [
  "SAITOV SARVAR", "HAMZAYEV SARDOR", "MIRYEVANOV BOTUV", "ALAMAT SOTUV", "BOBOMURODOV",
  "ZARIPOV JASUR", "ABDULLAYEV AKMAL", "RAHIMOV AZIZ", "KARIMOVA DILNOZA", "USMONOV BEKZOD",
  "TURSUNOV JAMSHID", "IBRAGIMOV RUSTAM",
];

const demoOrganizationSources = ["Diler", "Instagram", "Telegram", "Facebook", "Sarlavha", "Referral", "Call center"];
const demoOrganizationStatuses = ["Доступен", "Активно", "Не активно"];
const demoOrganizationOrgStatuses = ["ISHLA TURGAN", "USTANOVKA JARAYONIDA", "HALI ULANMAGAN", "VAQTICHALI ISHLAMAYOTGAN", "TEST"];
const demoOrganizationPaymentKinds = ["Тариф платежи", "Тест платежи", "Абонентская оплата", "Разовая оплата"];

function formatDemoMoney(value) {
  return Math.round(value).toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}

function buildDemoOrganizationRows() {
  return Array.from({ length: DEMO_ORGANIZATION_ROW_COUNT }, (_, index) => {
    const id = 1003001 + index;
    const name = `${demoOrganizationNames[index % demoOrganizationNames.length]} ${index % 4 === 0 ? "MAIN" : `FILIAL ${index % 9 + 1}`}`;
    const debt = index % 5 === 0 ? 0 : (index % 7 + 1) * 180000;
    const deposit = index % 6 === 0 ? -(index % 8 + 1) * 250000 : (index % 9) * 150000;
    const contract = index % 3 === 0 ? (index % 12 + 2) * 500000 : 0;
    const day = String(1 + (index % 28)).padStart(2, "0");
    const month = String(6 + (index % 2)).padStart(2, "0");
    const phoneTail = String(1000000 + ((index * 3791) % 8999999)).padStart(7, "0");

    return {
      id: String(id),
      message: index % 3 === 0,
      service: index % 4 === 0 ? "Yangi" : "Xizmat",
      paymentType: index % 6 === 0 ? "Тест" : index % 2 === 0 ? "Тариф" : "Без оплаты",
      name,
      clientId: String(id),
      terminals: String(index % 5),
      cashboxes: String((index % 4) + (index % 10 === 0 ? 2 : 0)),
      deposit: formatDemoMoney(deposit),
      debt: formatDemoMoney(debt),
      overdue: index % 8 === 0 ? formatDemoMoney((index % 6 + 1) * 90000) : "0",
      contract: formatDemoMoney(contract),
      tariff: formatDemoMoney(250000 + (index % 5) * 50000),
      currency: "UZS",
      contact: `998 ${90 + (index % 9)} ${phoneTail.slice(0, 3)} ${phoneTail.slice(3, 5)} ${phoneTail.slice(5)}`,
      region: demoOrganizationRegions[index % demoOrganizationRegions.length],
      manager: demoOrganizationManagers[index % demoOrganizationManagers.length],
      date: `${day}.${month}.2026`,
      source: demoOrganizationSources[index % demoOrganizationSources.length],
      version: index % 7 === 0 ? "" : `15.${String(index % 6).padStart(2, "0")}`,
      orgStatus: demoOrganizationOrgStatuses[index % demoOrganizationOrgStatuses.length],
      identification: index % 4 === 0 ? "Ожидает" : "Проверено",
      paymentKind: demoOrganizationPaymentKinds[index % demoOrganizationPaymentKinds.length],
      status: demoOrganizationStatuses[index % demoOrganizationStatuses.length],
      onlineMenu: index % 5 === 0 ? "Не активно" : "Активно",
      warehouse: index % 4 === 0 ? "Не активно" : "Активно",
      cashboxOnline: index % 6 === 0 ? "Не активно" : "Активно",
    };
  });
}

const demoOrganizationDirectoryRows = buildDemoOrganizationRows();

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

const ADMIN_PRODUCTS_STORAGE_KEY = "marjon-admin-products-v1";

const adminProductCategories = [
  "Хап",
  "Ускуналар (оборудование)",
  "Компьютер",
  "Моноблок",
  "Wi-Fi",
  "Принтер",
  "Кабель",
  "Сканер",
  "Хизматлар (услуги)",
];

const adminProductUnits = [
  "Метр (м)",
  "Килограмм (кг)",
  "Литр (л)",
  "Штук (шт)",
  "Порция (пр)",
  "Грамм (г)",
];

const adminProductWarehouses = [
  "Главный склад",
  "Склад Тошкент",
  "Склад расхода",
];

const adminProductRows = [
  { id: "tenda-sg108", name: "Tenda SG 108 8 Gigabit Power", category: "Хап", price: 240000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "menyu-xolder", name: "MENYU XOLDER", category: "Ускуналар (оборудование)", price: 15000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "headset-h320", name: "Наушник - hp Gaming Headset H320", category: "Компьютер", price: 400000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "monoblock-touch", name: "МОНОБЛОК (Иккита экранли) - 15 INCN DUAL SCREEN 41X25,5X41,5 см (WINDOWS) model : TS-15D09 TOUCH Pos machine", category: "Моноблок", price: 5808000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "wifi-alfa", name: "USB Wi-Fi Adapter - ALFA ALFANEXT", category: "Wi-Fi", price: 100, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "xprinter-xp365", name: "Xprinter mini printer, model : XP - 365 B (баркод)", category: "Принтер", price: 726000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "cuby-gs108d", name: "CUBY 8-Port Gigabit Desktop Switch (Хап) model : GS108D", category: "Хап", price: 240000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "xprinter-q80as", name: "Xprinter mini printer, model : XP - Q80AS", category: "Принтер", price: 720000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "network-cable", name: "Коврик (каттаси - клавиатура ва мышка учун)", category: "Компьютер", price: 35000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "sunkit-cable", name: "Обжимник - кабель учун икки функционали (Read Star SUNKIT SK-868G)", category: "Кабель", price: 100000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "menuholder-set", name: "Менюхолдер (Реклама учун подставка, (стол устидаги) комплект)", category: "Сканер", price: 25000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "abonent-service", name: "ойлик абонент тўлов", category: "Хизматлар (услуги)", price: 390000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "bank-acquiring", name: "Хамкор Банк эквайринг", category: "Хизматлар (услуги)", price: 4000000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "telegram-bot", name: "Телеграмм бот", category: "Хизматлар (услуги)", price: 4000000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "soliq-integration", name: "Солиқ интеграция", category: "Хизматлар (услуги)", price: 3000000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "user-manual-scale", name: "Электрон тарози User Manual", category: "Сканер", price: 4800000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "cash-drawer", name: "Касса аппарати CACH DRAWER", category: "Сканер", price: 960000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "meetion-c100", name: "Meetion USB CORDED COMBO C100 (клавиатура и мышь без проводная)", category: "Компьютер", price: 126000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "computer-set", name: "Компьютер комплект (монитор, процессор, клавиатура, мышка)", category: "Компьютер", price: 3300000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
  { id: "mercury-sg108", name: "MERCURY SG108 C (ХАП)", category: "Хап", price: 240000, unit: "Штук (шт)", status: "active", warehouse: "Главный склад", photo: "" },
];

function readStoredAdminProducts() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ADMIN_PRODUCTS_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveStoredAdminProducts(rows) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ADMIN_PRODUCTS_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Local changes are still kept in memory when storage is unavailable.
  }
}

function normalizeAdminProduct(row, index = 0) {
  const rawStatus = String(row.status ?? "").toLowerCase();
  const isInactive = row.status === false || rawStatus.includes("inactive") || rawStatus.includes("неак");
  const isArchived = Boolean(row.archived) || rawStatus.includes("archiv") || rawStatus.includes("архив");

  return {
    id: String(row.id ?? row.product_id ?? `product-${index + 1}`),
    name: row.name || row.product_name || row.title || "",
    category: row.category_name || row.category?.name || row.category || "Без категории",
    price: Number(row.price ?? row.sale_price ?? row.cost_price ?? 0),
    unit: row.unit_name || row.unit?.name || row.unit || row.measure || "Штук (шт)",
    status: isInactive ? "inactive" : "active",
    warehouse: row.warehouse || row.storage_name || "Главный склад",
    photo: row.photo || row.image || row.image_url || "",
    archived: isArchived,
  };
}

function createAdminProductDraft(row = null) {
  return {
    id: row?.id || "",
    name: row?.name || "",
    category: row?.category || adminProductCategories[0],
    price: row?.price != null ? String(row.price) : "",
    unit: row?.unit || "Штук (шт)",
    status: row?.status || "active",
    warehouse: row?.warehouse || "Главный склад",
    photo: row?.photo || "",
    archived: Boolean(row?.archived),
  };
}

const ADMIN_SALE_CATEGORIES_STORAGE_KEY = "marjon-admin-sale-categories-v1";

const adminSaleCategoryRows = [
  { id: "equipment", name: "Ускуналар (оборудование)", status: "active" },
  { id: "services", name: "Хизматлар (услуги)", status: "active" },
  { id: "printer", name: "Принтер", status: "active" },
  { id: "computer", name: "Компьютер", status: "active" },
  { id: "cable", name: "Кабель", status: "active" },
  { id: "defect", name: "Яроксизлари (брак)", status: "active" },
  { id: "used", name: "Ишлатилганлари (б/у)", status: "active" },
  { id: "wi-fi", name: "Wi-Fi", status: "active" },
  { id: "check-paper", name: "Чек Когоз (Check Qog'oz)", status: "active" },
  { id: "monoblock-sale", name: "Моноблок", status: "active" },
  { id: "hub-sale", name: "Хап", status: "active" },
  { id: "scanner-sale", name: "Сканер", status: "active" },
  { id: "water-sale", name: "Сув", status: "active" },
];

function readStoredAdminSaleCategories() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ADMIN_SALE_CATEGORIES_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveStoredAdminSaleCategories(rows) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ADMIN_SALE_CATEGORIES_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // The current session still works if localStorage is unavailable.
  }
}

function normalizeAdminSaleCategory(row, index = 0) {
  const rawStatus = String(row.status ?? "").toLowerCase();
  const isInactive = row.status === false || rawStatus.includes("inactive") || rawStatus.includes("неак");

  return {
    id: String(row.id ?? row.category_id ?? `sale-category-${index + 1}`),
    name: row.name || row.title || row.category_name || "",
    status: isInactive ? "inactive" : "active",
  };
}

function createAdminSaleCategoryDraft(row = null) {
  return {
    id: row?.id || "",
    name: row?.name || "",
    status: row?.status || "active",
  };
}

const ADMIN_SOURCES_STORAGE_KEY = "marjon-admin-sources-v1";

const adminSourceRows = [
  { id: "16", name: "Trade" },
  { id: "15", name: "Kiruvchi qo'g'iroqlar" },
  { id: "14", name: "Sayt registratsiya" },
  { id: "13", name: "Telegram" },
  { id: "12", name: "Facebook" },
  { id: "8", name: "zimzim" },
  { id: "7", name: "Baza" },
  { id: "6", name: "ko'cha" },
  { id: "5", name: "Instagram eski" },
  { id: "4", name: "Diller" },
  { id: "3", name: "Sarafan" },
  { id: "2", name: "Instagram" },
];

function readStoredAdminSources() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ADMIN_SOURCES_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) ? parsed.map(normalizeAdminSource).filter((row) => row.name) : null;
  } catch {
    return null;
  }
}

function saveStoredAdminSources(rows) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ADMIN_SOURCES_STORAGE_KEY, JSON.stringify(rows.map(normalizeAdminSource)));
  } catch {
    // The current session still works if localStorage is unavailable.
  }
}

function normalizeAdminSource(row, index = 0) {
  return {
    id: String(row?.id ?? row?.source_id ?? index + 1),
    name: row?.name || row?.title || row?.source || "",
  };
}

function createAdminSourceDraft(row = null) {
  return {
    id: row?.id || "",
    name: row?.name || "",
  };
}

const ADMIN_ORDERS_STORAGE_KEY = "marjon-admin-orders-v1";

const adminOrderOrganizations = [
  "Qadrdonlar\" kafe",
  "Nomi hali tanlanmagan",
  "Simfoniya milliy taomlari",
  "Amirlik restorani",
  "Street food",
  "test Asliddin",
  "Cocacola cafe",
  "Milliy taomlar",
  "Xamro Milliy Taomlar",
  "Anxor kafe",
  "BAYKAL RESTAURANT",
  "KARVON OSHXONA",
];

const adminOrderProducts = [
  "MERCURY SG108 C (ХАП)",
  "Xprinter mini printer, model : XP - 80 TS",
  "Урнатиб бериш (Ustanovka)",
  "Tenda SG 108 8 Gigabit Power",
  "Компьютер комплект (монитор, процессор, клавиатура, мышка)",
  "Солиқ интеграция",
  "MERCUSYS 8-Port 10/100/1000 Mbps Deskor Switch, model : MS108G (ХАП)",
  "Xprinter mini printer, model : XP-T80 A",
];

const adminOrderRows = [
  { id: "45084949", organization: "Qadrdonlar\" kafe", paymentId: "1003024", items: [{ product: "MERCURY SG108 C (ХАП)", quantity: 1, price: 240000, comment: "-" }], status: "new" },
  { id: "45084881", organization: "Qadrdonlar\" kafe", paymentId: "1003024", items: [{ product: "Xprinter mini printer, model : XP - 80 TS", quantity: 2, price: 720000, comment: "-" }], status: "new" },
  { id: "45084826", organization: "Qadrdonlar\" kafe", paymentId: "1003024", items: [{ product: "Урнатиб бериш (Ustanovka)", quantity: 3, price: 1000000, comment: "-" }], status: "new" },
  { id: "45080376", organization: "Nomi hali tanlanmagan", paymentId: "1003023", items: [{ product: "Tenda SG 108 8 Gigabit Power", quantity: 1, price: 240000, comment: "-" }], status: "new" },
  { id: "45080306", organization: "Nomi hali tanlanmagan", paymentId: "1003023", items: [{ product: "Компьютер комплект (монитор, процессор, клавиатура, мышка)", quantity: 1, price: 3180000, comment: "-" }], status: "new" },
  { id: "45080199", organization: "Nomi hali tanlanmagan", paymentId: "1003023", items: [{ product: "Xprinter mini printer, model : XP - 80 TS", quantity: 3, price: 720000, comment: "-" }], status: "new" },
  { id: "45078782", organization: "Nomi hali tanlanmagan", paymentId: "1003023", items: [{ product: "Урнатиб бериш (Ustanovka)", quantity: 3, price: 1000000, comment: "-" }], status: "new" },
  { id: "45066810", organization: "Simfoniya milliy taomlari", paymentId: "1003022", items: [{ product: "MERCURY SG108 C (ХАП)", quantity: 1, price: 240000, comment: "-" }], status: "new" },
  { id: "45066702", organization: "Simfoniya milliy taomlari", paymentId: "1003022", items: [{ product: "Xprinter mini printer, model : XP - 80 TS", quantity: 2, price: 720000, comment: "-" }], status: "new" },
  { id: "45066589", organization: "Simfoniya milliy taomlari", paymentId: "1003022", items: [{ product: "Урнатиб бериш (Ustanovka)", quantity: 3, price: 1000000, comment: "-" }], status: "new" },
  { id: "45062063", organization: "Amirlik restorani", paymentId: "1003021", items: [{ product: "Урнатиб бериш (Ustanovka)", quantity: 3, price: 1000000, comment: "-" }], status: "new" },
  { id: "44996156", organization: "Street food", paymentId: "1002792", items: [], total: 390000, comment: "-", status: "cancelled" },
  { id: "44996117", organization: "Street food", paymentId: "1002792", items: [], total: 390000, comment: "-", status: "cancelled" },
  { id: "44953425", organization: "test Asliddin", paymentId: "1000104", items: [], total: 390000, comment: "-", status: "cancelled" },
  {
    id: "44949330",
    organization: "Cocacola cafe",
    paymentId: "1003020",
    items: [
      { product: "Урнатиб бериш (Ustanovka)", quantity: 2, price: 1000000, comment: "-" },
      { product: "Xprinter mini printer, model : XP - 80 TS", quantity: 2, price: 720000, comment: "-" },
      { product: "MERCUSYS 8-Port 10/100/1000 Mbps Deskor Switch, model : MS108G (ХАП)", quantity: 1, price: 240000, comment: "-" },
    ],
    status: "new",
  },
  { id: "44948636", organization: "Milliy taomlar", paymentId: "1003019", items: [{ product: "Урнатиб бериш (Ustanovka)", quantity: 2.5, price: 1000000, comment: "-" }], status: "new" },
  { id: "44947554", organization: "Xamro Milliy Taomlar", paymentId: "1002058", items: [{ product: "Солиқ интеграция", quantity: 1, price: 1000000, comment: "-" }], status: "accepted" },
  { id: "44941986", organization: "Anxor kafe", paymentId: "1003018", items: [{ product: "Урнатиб бериш (Ustanovka)", quantity: 2.5, price: 1000000, comment: "-" }], status: "new" },
  { id: "44886258", organization: "BAYKAL RESTAURANT", paymentId: "1002944", items: [{ product: "Урнатиб бериш (Ustanovka)", quantity: 1, price: 2500000, comment: "-" }], status: "new" },
  { id: "44886034", organization: "KARVON OSHXONA", paymentId: "1002113", items: [{ product: "Xprinter mini printer, model : XP-T80 A", quantity: 1, price: 600000, comment: "-" }], status: "new" },
];

function readStoredAdminOrders() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ADMIN_ORDERS_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveStoredAdminOrders(rows) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ADMIN_ORDERS_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // The table remains usable for the current session if storage is unavailable.
  }
}

function normalizeAdminOrderStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("cancel") || value.includes("отмен")) return "cancelled";
  if (value.includes("accept") || value.includes("прин") || value.includes("done") || value.includes("заверш")) return "accepted";
  return "new";
}

function normalizeAdminOrder(row, index = 0) {
  const rawItems = Array.isArray(row.items)
    ? row.items
    : Array.isArray(row.products)
      ? row.products
      : Array.isArray(row.order_items)
        ? row.order_items
        : [];

  const items = rawItems.map((item, itemIndex) => ({
    id: String(item.id || `${row.id || index}-item-${itemIndex}`),
    product: item.product_name || item.name || item.product?.name || item.title || "—",
    quantity: Number(item.quantity || item.qty || 1),
    price: Number(item.price || item.amount || item.total || 0),
    comment: item.comment || "-",
  }));

  return {
    id: String(row.id || row.order_number || `order-${index + 1}`),
    organization: row.organization_name || row.branch_name || row.customer_name || row.customer || row.name || "—",
    paymentId: String(row.payment_id || row.paymentId || row.transaction_id || row.pay_id || "—"),
    items,
    total: Number(row.total || row.amount || items.reduce((sum, item) => sum + item.price * item.quantity, 0)),
    comment: row.comment || "-",
    status: normalizeAdminOrderStatus(row.status),
  };
}

function createAdminOrderDraft(row = null) {
  const items = row?.items?.length
    ? row.items
    : [{ id: `order-item-${Date.now()}`, product: adminOrderProducts[0], quantity: 1, price: 0, comment: "" }];

  return {
    id: row?.id || "",
    organization: row?.organization || adminOrderOrganizations[0],
    paymentId: row?.paymentId || "",
    status: row?.status || "new",
    items: items.map((item, index) => ({
      id: item.id || `order-item-${Date.now()}-${index}`,
      product: item.product || adminOrderProducts[0],
      quantity: String(item.quantity ?? 1),
      price: String(item.price ?? 0),
      comment: item.comment === "-" ? "" : item.comment || "",
    })),
  };
}

function getAdminOrderTotal(row) {
  if (row.items?.length) {
    return row.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  }

  return Number(row.total || 0);
}

function getAdminOrderProductsLabel(row) {
  if (!row.items?.length) return "—";

  return row.items
    .map((item) => `${item.product} — ${item.quantity}`)
    .join("\n");
}

const ADMIN_UNITS_STORAGE_KEY = "marjon-admin-units-v1";

const adminUnitRows = [
  { id: "meter", sort: 1, name: "Метр (м)", shortName: "м", status: "active" },
  { id: "kilogram", sort: 1, name: "Килограмм (кг)", shortName: "кг", status: "active" },
  { id: "liter", sort: 1, name: "Литр (л)", shortName: "л", status: "active" },
  { id: "piece", sort: 1, name: "Штук (шт)", shortName: "шт", status: "active" },
  { id: "portion", sort: 1, name: "Порция (пр)", shortName: "пр", status: "active" },
  { id: "gram", sort: 1, name: "Грамм (г)", shortName: "г", status: "active" },
];

function readStoredAdminUnits() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ADMIN_UNITS_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveStoredAdminUnits(rows) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ADMIN_UNITS_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Keep the in-memory table working if localStorage is unavailable.
  }
}

function normalizeAdminUnit(row, index = 0) {
  const rawStatus = String(row.status ?? "").toLowerCase();
  const isInactive = row.status === false || rawStatus.includes("inactive") || rawStatus.includes("неак");

  return {
    id: String(row.id ?? row.unit_id ?? `unit-${index + 1}`),
    sort: Number(row.sort_order ?? row.sort ?? row.order ?? 1) || 1,
    name: row.name || row.title || "",
    shortName: row.short_name || row.shortName || row.code || row.abbreviation || "",
    status: isInactive ? "inactive" : "active",
  };
}

function createAdminUnitDraft(row = null) {
  return {
    id: row?.id || "",
    sort: row?.sort != null ? String(row.sort) : "1",
    name: row?.name || "",
    shortName: row?.shortName || "",
    status: row?.status || "active",
  };
}

const ADMIN_HANDBOOK_LOCATIONS_STORAGE_KEY = "marjon-admin-handbook-locations-v1";

const adminHandbookDefaultRows = {
  countries: [
    { id: "uzbekistan", name: "Узбекистан", code: "998", iso: "UZ", mask: "(##) ### ## ##", status: "active" },
  ],
  regions: [
    { id: "tashkent", name: "Ташкент", country: "Узбекистан", status: "active" },
  ],
  districts: [
    { id: "bektemir", name: "Бектемирский район", region: "Ташкент", status: "active" },
    { id: "mirabad", name: "Мирабадский район", region: "Ташкент", status: "active" },
    { id: "mirzo-ulugbek", name: "Мирзо-Улугбекский район", region: "Ташкент", status: "active" },
    { id: "sergeli", name: "Сергелийский район", region: "Ташкент", status: "active" },
    { id: "almazar", name: "Алмазарский район", region: "Ташкент", status: "active" },
    { id: "uchtepa", name: "Учтепинский район", region: "Ташкент", status: "active" },
    { id: "shaykhantakhur", name: "Шайхантахурский район", region: "Ташкент", status: "active" },
    { id: "yunusabad", name: "Юнусабадский район", region: "Ташкент", status: "active" },
    { id: "yakkasaray", name: "Яккасарайский район", region: "Ташкент", status: "active" },
    { id: "yashnabad", name: "Яшнабадский район", region: "Ташкент", status: "active" },
    { id: "chilanzar", name: "Чиланзарский район", region: "Ташкент", status: "active" },
    { id: "yangihayot", name: "Янгихаётский район", region: "Ташкент", status: "active" },
  ],
};

const adminHandbookActiveKind = {
  "hb-countries": "countries",
  "hb-regions": "regions",
  "hb-districts": "districts",
};

const adminHandbookConfig = {
  countries: {
    title: "Страны",
    singleTitle: "страну",
    editTitle: "страну",
    columns: ["№", "Название", "Статус"],
  },
  regions: {
    title: "Регионы",
    singleTitle: "регион",
    editTitle: "регион",
    columns: ["№", "Название", "Страна", "Статус"],
  },
  districts: {
    title: "Районы",
    singleTitle: "район",
    editTitle: "район",
    columns: ["№", "Название", "Регион", "Статус"],
  },
};

function normalizeAdminHandbookStatus(status) {
  const value = String(status ?? "").toLowerCase();
  return status === false || value.includes("inactive") || value.includes("неак") ? "inactive" : "active";
}

function normalizeAdminHandbookRow(kind, row = {}, index = 0) {
  const baseId = `${kind}-${index + 1}`;

  if (kind === "countries") {
    return {
      id: String(row.id || row.country_id || baseId),
      name: row.name || row.country || "Узбекистан",
      code: String(row.code || row.phone_code || "998"),
      iso: String(row.iso || row.alpha2 || row.short_code || "UZ").toUpperCase(),
      mask: row.mask || row.phone_mask || "(##) ### ## ##",
      status: normalizeAdminHandbookStatus(row.status),
    };
  }

  if (kind === "regions") {
    return {
      id: String(row.id || row.region_id || baseId),
      name: row.name || row.region || "Ташкент",
      country: row.country || row.country_name || "Узбекистан",
      status: normalizeAdminHandbookStatus(row.status),
    };
  }

  return {
    id: String(row.id || row.district_id || baseId),
    name: row.name || row.district || "",
    region: row.region || row.region_name || "Ташкент",
    status: normalizeAdminHandbookStatus(row.status),
  };
}

function normalizeAdminHandbookState(value = {}) {
  const countriesSource = Array.isArray(value.countries) && value.countries.length
    ? value.countries
    : adminHandbookDefaultRows.countries;
  const regionsSource = Array.isArray(value.regions) && value.regions.length
    ? value.regions
    : adminHandbookDefaultRows.regions;
  const districtsSource = Array.isArray(value.districts) && value.districts.length
    ? value.districts
    : adminHandbookDefaultRows.districts;

  return {
    countries: countriesSource.map((row, index) => normalizeAdminHandbookRow("countries", row, index)).slice(0, 1),
    regions: regionsSource.map((row, index) => normalizeAdminHandbookRow("regions", row, index)).slice(0, 1),
    districts: districtsSource.map((row, index) => normalizeAdminHandbookRow("districts", row, index)),
  };
}

function readStoredAdminHandbookLocations() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ADMIN_HANDBOOK_LOCATIONS_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" ? normalizeAdminHandbookState(parsed) : null;
  } catch {
    return null;
  }
}

function saveStoredAdminHandbookLocations(rows) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ADMIN_HANDBOOK_LOCATIONS_STORAGE_KEY, JSON.stringify(normalizeAdminHandbookState(rows)));
  } catch {
    // The current session remains usable if localStorage is unavailable.
  }
}

function createAdminHandbookDraft(kind, row = null, state = null) {
  const countryName = state?.countries?.[0]?.name || "Узбекистан";
  const regionName = state?.regions?.[0]?.name || "Ташкент";

  if (kind === "countries") {
    return {
      id: row?.id || "",
      name: row?.name || "Узбекистан",
      code: row?.code || "998",
      iso: row?.iso || "UZ",
      mask: row?.mask || "(##) ### ## ##",
      status: row?.status || "active",
    };
  }

  if (kind === "regions") {
    return {
      id: row?.id || "",
      name: row?.name || "Ташкент",
      country: row?.country || countryName,
      status: row?.status || "active",
    };
  }

  return {
    id: row?.id || "",
    name: row?.name || "",
    region: row?.region || regionName,
    status: row?.status || "active",
  };
}

const ADMIN_EMPLOYEES_STORAGE_KEY = "marjon-admin-employees-v1";

const adminEmployeeRoles = [
  "sales",
  "installer",
  "operator",
  "admin",
  "marketing",
  "tech_support",
  "product_manager",
  "moderator",
  "media",
];

const adminEmployeeDepartments = [
  "Продажи",
  "Установка",
  "Операторская",
  "Администрация",
  "Маркетинг",
  "Техподдержка",
  "Продукты",
  "Медиа",
];

const adminEmployeeRows = [
  { id: "88489", name: "OG'ABEK AXATOV", phone: "99893 810 70 70", roles: ["sales", "installer", "operator"], balance: 0, inRating: true, login: "938107070", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продажи", status: "active" },
  { id: "86840", name: "Sardor Hamzayev Admin", phone: "99800 000 00 02", roles: ["admin"], balance: 0, inRating: false, login: "000000002", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Администрация", status: "active" },
  { id: "86756", name: "Yo'ldashev Xurshid", phone: "99893 437 13 77", roles: ["sales", "operator", "installer"], balance: 0, inRating: true, login: "934371377", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продажи", status: "active" },
  { id: "86755", name: "Safayev Aziz", phone: "99888 140 60 68", roles: ["sales"], balance: 0, inRating: true, login: "881406068", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продажи", status: "active" },
  { id: "86071", name: "JAVOHIR SOTUV", phone: "99877 728 55 08", roles: ["sales", "installer"], balance: 0, inRating: true, login: "777285508", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Установка", status: "active" },
  { id: "85559", name: "DILSHOD XABIBULLAYEV SOTUV", phone: "99894 480 76 05", roles: ["sales", "installer", "operator"], balance: 0, inRating: true, login: "944807605", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продажи", status: "active" },
  { id: "83632", name: "Azamat turkiya", phone: "99800 000 55 55", roles: ["operator", "installer", "sales"], balance: 0, inRating: false, login: "000005555", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Операторская", status: "active" },
  { id: "83407", name: "RUSTAM UZOQOV SOTUV", phone: "99893 931 22 66", roles: ["sales", "installer"], balance: 0, inRating: true, login: "939312266", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продажи", status: "active" },
  { id: "83233", name: "OLIMJONOV AZAMAT SOTUV", phone: "99870 036 98 03", roles: ["sales", "installer"], balance: 0, inRating: true, login: "700369803", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Установка", status: "active" },
  { id: "78694", name: "Asadbek", phone: "99891 775 62 42", roles: ["operator", "tech_support"], balance: -3000000, inRating: true, login: "917756242", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Техподдержка", status: "active" },
  { id: "75275", name: "KAMOLIDDIN TARGETOLOG", phone: "99894 077 16 01", roles: ["marketing"], balance: 0, inRating: false, login: "940771601", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Маркетинг", status: "active" },
  { id: "74395", name: "MAVLONOV SHOHIRUH SOLIQ", phone: "99897 111 30 09", roles: ["installer", "operator", "sales", "tech_support"], balance: 0, inRating: true, login: "971113009", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Техподдержка", status: "active" },
  { id: "73122", name: "Kunlik Premya", phone: "99821 545 87 87", roles: ["media"], balance: 0, inRating: false, login: "215458787", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Медиа", status: "active" },
  { id: "72045", name: "TURAYEV ALISHER", phone: "99893 109 66 36", roles: ["sales", "operator", "tech_support"], balance: 0, inRating: true, login: "931096636", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продажи", status: "active" },
  { id: "69903", name: "SHOHABBOS DONYOROV SOTUV", phone: "99894 777 57 52", roles: ["sales"], balance: 0, inRating: true, login: "947775752", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продажи", status: "active" },
  { id: "69565", name: "AZIM O'KTAMOV SOTUV", phone: "99895 737 37 07", roles: ["sales"], balance: 0, inRating: true, login: "957373707", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продажи", status: "active" },
  { id: "62529", name: "811", phone: "99823 145 66 51", roles: ["product_manager"], balance: 0, inRating: false, login: "231456651", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продукты", status: "active" },
  { id: "62528", name: "812", phone: "99832 168 43 21", roles: ["product_manager"], balance: -30000000, inRating: false, login: "321684321", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продукты", status: "active" },
  { id: "62527", name: "813", phone: "99856 416 55 15", roles: ["product_manager"], balance: -60000000, inRating: false, login: "564165515", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продукты", status: "active" },
  { id: "62526", name: "814", phone: "99823 165 43 51", roles: ["product_manager"], balance: -51000000, inRating: false, login: "231654351", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продукты", status: "active" },
  { id: "62524", name: "815", phone: "99853 165 14 35", roles: ["product_manager"], balance: -95000000, inRating: false, login: "531651435", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продукты", status: "active" },
  { id: "62522", name: "816", phone: "99821 561 45 64", roles: ["product_manager"], balance: -73000000, inRating: false, login: "215614564", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продукты", status: "active" },
  { id: "62521", name: "817", phone: "99821 358 54 34", roles: ["product_manager"], balance: -80000000, inRating: false, login: "213585434", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продукты", status: "active" },
  { id: "60834", name: "Eldor Sotuv", phone: "99890 614 29 69", roles: ["sales", "installer"], balance: 0, inRating: false, login: "906142969", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продажи", status: "active" },
  { id: "60805", name: "Humoyun Targetolog", phone: "99899 300 48 28", roles: ["marketing"], balance: 0, inRating: false, login: "993004828", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Маркетинг", status: "active" },
  { id: "60437", name: "Шахзод Эркинбоев", phone: "99893 733 32 23", roles: ["product_manager", "moderator", "sales"], balance: -3000000, inRating: true, login: "937333223", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продукты", status: "active" },
  { id: "57297", name: "Хуршид Термиз филиал", phone: "99897 697 66 88", roles: ["installer", "sales"], balance: 0, inRating: false, login: "976976688", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Установка", status: "active" },
  { id: "57296", name: "Зохиджон Термиз", phone: "99893 234 65 65", roles: ["sales", "installer"], balance: 0, inRating: false, login: "932346565", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Установка", status: "active" },
  { id: "56337", name: "Akbar aka", phone: "99897 708 22 02", roles: ["product_manager", "sales", "installer"], balance: -24000000, inRating: true, login: "977082202", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продукты", status: "active" },
  { id: "56167", name: "Boltaboyev Jahongir Farg'ona Filial", phone: "99895 964 11 00", roles: ["installer", "sales", "moderator"], balance: -20000000, inRating: true, login: "959641100", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Установка", status: "active" },
  { id: "56018", name: "Samandar Akmalov Sotuv", phone: "99899 000 45 14", roles: ["sales"], balance: 0, inRating: false, login: "990004514", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Продажи", status: "active" },
  { id: "54448", name: "Asilbek Targetolog", phone: "99897 432 30 03", roles: ["marketing"], balance: -6000000, inRating: false, login: "974323003", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Маркетинг", status: "active" },
  { id: "54089", name: "Jonibek", phone: "99890 919 04 84", roles: ["media", "operator"], balance: 0, inRating: false, login: "909190484", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Медиа", status: "active" },
  { id: "51455", name: "Sardor aka M", phone: "99899 200 62 67", roles: ["marketing", "product_manager", "sales"], balance: 0, inRating: false, login: "992006267", telegram: "", workingDays: "6", workingTime: "9", salary: "", email: "", department: "Маркетинг", status: "active" },
];

function readStoredAdminEmployees() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ADMIN_EMPLOYEES_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) ? parsed.map(normalizeAdminEmployee).filter((row) => row.name) : null;
  } catch {
    return null;
  }
}

function saveStoredAdminEmployees(rows) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ADMIN_EMPLOYEES_STORAGE_KEY, JSON.stringify(rows.map(normalizeAdminEmployee)));
  } catch {
    // Keep the in-memory table working if localStorage is unavailable.
  }
}

function normalizeAdminEmployee(row = {}, index = 0) {
  const roleSource = Array.isArray(row.roles)
    ? row.roles
    : String(row.role || row.roles || "sales").split(/[,\s]+/);
  const roles = roleSource.map((role) => String(role).trim()).filter(Boolean);

  return {
    id: String(row.id || row.employee_id || `employee-${index + 1}`),
    name: row.name || row.full_name || row.fio || "",
    phone: row.phone || row.phone_number || row.mobile || "",
    roles: roles.length ? roles : ["sales"],
    balance: Number(row.balance || 0),
    inRating: row.inRating ?? row.in_rating ?? row.rating_enabled ?? true,
    login: row.login || row.username || "",
    password: row.password || "",
    telegram: row.telegram || row.telegram_id || "",
    workingDays: String(row.workingDays ?? row.working_days ?? "6"),
    workingTime: String(row.workingTime ?? row.working_time ?? "9"),
    salary: row.salary != null ? String(row.salary) : "",
    email: row.email || "",
    department: row.department || row.department_name || adminEmployeeDepartments[0],
    status: normalizeAdminHandbookStatus(row.status),
  };
}

function createAdminEmployeeDraft(row = null) {
  return {
    id: row?.id || "",
    name: row?.name || "",
    phone: row?.phone || "+998 ",
    roles: row?.roles?.length ? [...row.roles] : ["sales"],
    balance: row?.balance != null ? String(row.balance) : "0",
    inRating: row?.inRating ?? true,
    login: row?.login || "",
    password: row?.password || "",
    telegram: row?.telegram || "",
    workingDays: row?.workingDays || "6",
    workingTime: row?.workingTime || "9",
    salary: row?.salary || "",
    email: row?.email || "",
    department: row?.department || adminEmployeeDepartments[0],
    status: row?.status || "active",
  };
}

const storageIncomeBranchRows = [
  { branch: "Тошкент филиал", income: 32864000, inventory: 0 },
];

const storageIncomeDetailRows = [
  { id: "total", name: "Всего", quantity: 395, amount: 32864000, tone: "total" },
  { id: "realization", name: "Реализация", quantity: 395, amount: 32864000, tone: "green" },
  {
    id: "computer",
    name: "Компьютер",
    quantity: 18,
    amount: 814000,
    tone: "category",
    children: [
      { id: "mish-depo-v82", name: "Mish DEPO V82 (mishka)", quantity: "8 шт", amount: 464000 },
      { id: "keyboard-mat", name: "Коврик (каттаси - клавиатура ва мышка учун)", quantity: "10 шт", amount: 350000 },
    ],
  },
  {
    id: "cable",
    name: "Кабель",
    quantity: 351,
    amount: 1570000,
    tone: "category",
    children: [
      { id: "connector-cat-6", name: "Коннектор CAT 6", quantity: "350 шт", amount: 350000 },
      { id: "network-cable-cat6", name: "NET WORK CABLE (OUTDOOR CAT6 UTP 23 AWG CABLE) (korobkada buxta kabel)", quantity: "1 шт", amount: 1220000 },
    ],
  },
  {
    id: "printer",
    name: "Принтер",
    quantity: 10,
    amount: 7200000,
    tone: "category",
    children: [
      { id: "xprinter-xp-80-ts", name: "Xprinter mini printer, model : XP - 80 TS", quantity: "10 шт", amount: 7200000 },
    ],
  },
  {
    id: "monoblock",
    name: "Моноблок",
    quantity: 5,
    amount: 21000000,
    tone: "category",
    children: [
      { id: "monoblock-tsm-1514", name: "Моноблок - 15 Inch Monitor model : TSM-1514 (8-128 GB (Windows Cach Register)", quantity: "5 шт", amount: 21000000 },
    ],
  },
  {
    id: "scanner",
    name: "Сканер",
    quantity: 2,
    amount: 400000,
    tone: "category",
    children: [
      { id: "rfid-reader", name: "RFID READER (сканер, карта, браслетники)", quantity: "2 шт", amount: 400000 },
    ],
  },
  {
    id: "wifi",
    name: "Wi-Fi",
    quantity: 2,
    amount: 200000,
    tone: "category",
    children: [
      { id: "usb-wifi-alfa", name: "USB Wi-Fi Adapter - ALFA ALFANEXT", quantity: "2 шт", amount: 200000 },
    ],
  },
  {
    id: "hub",
    name: "Хап",
    quantity: 7,
    amount: 1680000,
    tone: "category",
    children: [
      { id: "tenda-sg-108", name: "Tenda SG 108 8 Gigabit Power", quantity: "7 шт", amount: 1680000 },
    ],
  },
  { id: "used-product", name: "Продукт Б/У", quantity: 0, amount: 0, tone: "green" },
];

const storageIncomeJournalRows = [
  {
    id: "income-88377",
    number: "88377",
    supplier: "Nanotech",
    warehouse: "Главный склад",
    incomingDate: "22.07.2026",
    registeredAt: "22.07.2026 / 18:22",
    registeredBy: "Ergashev Bahodir Bahriddinovich",
    acceptedAt: "22.07.2026 / 18:23",
    acceptedBy: "Ergashev Bahodir Bahriddinovich",
    itemCount: 1,
    total: 2400000,
    status: "принято",
    contractNumber: "—",
    comment: "Янги техника сотиб олинди.",
    items: [
      { id: "tenda-sg-108", name: "Tenda SG 108 8 Gigabit Power", price: 240000, quantity: 10, waste: "—", balance: 10, total: 2400000 },
    ],
  },
  {
    id: "income-88488",
    number: "88488",
    supplier: "ZARINLIGHT",
    warehouse: "Главный склад",
    incomingDate: "22.07.2026",
    registeredAt: "23.07.2026 / 10:31",
    registeredBy: "Ergashev Bahodir Bahriddinovich",
    acceptedAt: "23.07.2026 / 10:33",
    acceptedBy: "Ergashev Bahodir Bahriddinovich",
    itemCount: 1,
    total: 8400000,
    status: "принято",
    contractNumber: "—",
    comment: "Поступление оборудования на склад.",
    items: [
      { id: "xprinter-xp-80-ts-journal", name: "Xprinter mini printer, model : XP - 80 TS", price: 700000, quantity: 12, waste: "—", balance: 12, total: 8400000 },
    ],
  },
  {
    id: "income-87346",
    number: "87346",
    supplier: "Главный организация",
    warehouse: "Главный склад",
    incomingDate: "18.07.2026",
    registeredAt: "-",
    registeredBy: "",
    acceptedAt: "-",
    acceptedBy: "",
    itemCount: 1,
    total: 1000000,
    status: "принято",
    contractNumber: "—",
    comment: "Корректировка остатка по главному складу.",
    items: [
      { id: "keyboard-mat-journal", name: "Коврик для клавиатуры и мышки", price: 100000, quantity: 10, waste: "—", balance: 10, total: 1000000 },
    ],
  },
  {
    id: "income-87343",
    number: "87343",
    supplier: "ZARINLIGHT",
    warehouse: "Главный склад",
    incomingDate: "17.07.2026",
    registeredAt: "18.07.2026 / 15:03",
    registeredBy: "Ergashev Bahodir Bahriddinovich",
    acceptedAt: "18.07.2026 / 15:05",
    acceptedBy: "Ergashev Bahodir Bahriddinovich",
    itemCount: 4,
    total: 45760000,
    status: "принято",
    contractNumber: "—",
    comment: "Крупное поступление техники.",
    items: [
      { id: "monoblock-tsm-journal", name: "Моноблок - 15 Inch Monitor model : TSM-1514", price: 4200000, quantity: 5, waste: "—", balance: 5, total: 21000000 },
      { id: "printer-journal", name: "Xprinter mini printer, model : XP - 80 TS", price: 720000, quantity: 10, waste: "—", balance: 10, total: 7200000 },
      { id: "network-cable-journal", name: "NET WORK CABLE OUTDOOR CAT6 UTP", price: 1220000, quantity: 10, waste: "—", balance: 10, total: 12200000 },
      { id: "scanner-journal", name: "RFID READER", price: 680000, quantity: 7, waste: "—", balance: 7, total: 4760000 },
    ],
  },
  {
    id: "income-86630",
    number: "86630",
    supplier: "ZARINLIGHT",
    warehouse: "Главный склад",
    incomingDate: "15.07.2026",
    registeredAt: "15.07.2026 / 13:56",
    registeredBy: "Ergashev Bahodir Bahriddinovich",
    acceptedAt: "15.07.2026 / 14:03",
    acceptedBy: "Ergashev Bahodir Bahriddinovich",
    itemCount: 5,
    total: 11575000,
    status: "принято",
    contractNumber: "—",
    comment: "Приход расходных материалов.",
    items: [
      { id: "chek-paper-56-journal", name: "Chek qogoz 56/12 m Termolenta", price: 1500, quantity: 5000, waste: "—", balance: 5000, total: 7500000 },
      { id: "connector-cat6-journal", name: "Коннектор CAT 6", price: 1000, quantity: 350, waste: "—", balance: 350, total: 350000 },
      { id: "usb-wifi-journal", name: "USB Wi-Fi Adapter - ALFA ALFANEXT", price: 100000, quantity: 2, waste: "—", balance: 2, total: 200000 },
      { id: "hub-journal", name: "MERCURY SG108 C", price: 240000, quantity: 10, waste: "—", balance: 10, total: 2400000 },
      { id: "scanner-card-journal", name: "RFID карта", price: 37500, quantity: 30, waste: "—", balance: 30, total: 1125000 },
    ],
  },
  {
    id: "income-86397",
    number: "86397",
    supplier: "Nanotech",
    warehouse: "Главный склад",
    incomingDate: "14.07.2026",
    registeredAt: "14.07.2026 / 16:15",
    registeredBy: "Ergashev Bahodir Bahriddinovich",
    acceptedAt: "14.07.2026 / 16:21",
    acceptedBy: "Ergashev Bahodir Bahriddinovich",
    itemCount: 1,
    total: 3600000,
    status: "принято",
    contractNumber: "—",
    comment: "Поставка периферии.",
    items: [
      { id: "wireless-keyboard-journal", name: "WIRED KEYBOARD E-KB721 MEGA jet", price: 120000, quantity: 30, waste: "—", balance: 30, total: 3600000 },
    ],
  },
  {
    id: "income-86015",
    number: "86015",
    supplier: "Главный организация",
    warehouse: "Главный склад",
    incomingDate: "13.07.2026",
    registeredAt: "-",
    registeredBy: "",
    acceptedAt: "-",
    acceptedBy: "",
    itemCount: 1,
    total: 1000000,
    status: "принято",
    contractNumber: "—",
    comment: "Ручное поступление.",
    items: [
      { id: "manual-product-journal", name: "Продукт Б/У", price: 1000000, quantity: 1, waste: "—", balance: 1, total: 1000000 },
    ],
  },
  {
    id: "income-86222",
    number: "86222",
    supplier: "ZARINLIGHT",
    warehouse: "Главный склад",
    incomingDate: "13.07.2026",
    registeredAt: "14.07.2026 / 09:38",
    registeredBy: "Ergashev Bahodir Bahriddinovich",
    acceptedAt: "14.07.2026 / 10:03",
    acceptedBy: "Ergashev Bahodir Bahriddinovich",
    itemCount: 8,
    total: 21423000,
    status: "принято",
    contractNumber: "—",
    comment: "Поступление товаров для филиала Тошкент.",
    items: [
      { id: "paper-80-journal", name: "Chek qogoz 80/50 m Termolenta", price: 9000, quantity: 37, waste: "—", balance: 37, total: 333000 },
      { id: "xprinter-t837-journal", name: "Xprinter mini printer model : XP-T837L", price: 720000, quantity: 12, waste: "—", balance: 12, total: 8640000 },
      { id: "monoblock-extra-journal", name: "Моноблок TSM-1514", price: 4200000, quantity: 2, waste: "—", balance: 2, total: 8400000 },
      { id: "network-cable-extra-journal", name: "NET WORK CABLE CAT6", price: 1220000, quantity: 3, waste: "—", balance: 3, total: 3660000 },
      { id: "connector-extra-journal", name: "Коннектор CAT 6", price: 1000, quantity: 350, waste: "—", balance: 350, total: 350000 },
      { id: "wifi-extra-journal", name: "USB Wi-Fi Adapter", price: 200000, quantity: 2, waste: "—", balance: 2, total: 400000 },
      { id: "mouse-extra-journal", name: "Mish DEPO V82", price: 58000, quantity: 8, waste: "—", balance: 8, total: 464000 },
      { id: "mat-extra-journal", name: "Коврик для клавиатуры и мышки", price: 22000, quantity: 8, waste: "—", balance: 8, total: 176000 },
    ],
  },
  {
    id: "income-85484",
    number: "85484",
    supplier: "Главный организация",
    warehouse: "Главный склад",
    incomingDate: "11.07.2026",
    registeredAt: "-",
    registeredBy: "",
    acceptedAt: "-",
    acceptedBy: "",
    itemCount: 2,
    total: 1125000,
    status: "принято",
    contractNumber: "—",
    comment: "Дополнительное поступление.",
    items: [
      { id: "rfid-card-journal", name: "RFID карта", price: 37500, quantity: 20, waste: "—", balance: 20, total: 750000 },
      { id: "menuholder-journal", name: "Менюхолдер", price: 37500, quantity: 10, waste: "—", balance: 10, total: 375000 },
    ],
  },
];

const storageWriteoffRows = [];

const storageInventoryRows = [
  {
    id: "8350",
    registeredAt: "07.07.2026 / 10:31",
    registeredBy: "Ergashev Bahodir Bahriddinovich",
    warehouse: "Главный склад",
    comment: "-",
    type: "Приход и расход учтены",
    status: "принято",
    items: [
      { id: "mercusys-ms108g-inv", name: "MERCUSYS 8-Port 10/100/1000 Mbps Deskor Switch, model : MS108G (ХАП)", quantity: "+ 1", unit: "Штук (шт)" },
      { id: "computer-set-inv", name: "Компьютер комплект (монитор, процессор, клавиатура, мышка)", quantity: "+ 1", unit: "Штук (шт)" },
    ],
  },
];

const storageExpenseBranchRows = [
  { branch: "Тошкент филиал", expense: 13860000, inventory: 0 },
];

const storageExpenseDetailRows = [
  { id: "total", name: "Всего", quantity: 79, amount: 13860000, tone: "total" },
  { id: "realization", name: "Реализация", quantity: 79, amount: 13860000, tone: "green" },
  {
    id: "printer",
    name: "Принтер",
    quantity: 12,
    amount: 7680000,
    tone: "category",
    children: [
      { id: "xprinter-xp-t837l", name: "Xprinter mini printer model : XP-T837L", quantity: "1 шт", amount: 0 },
      { id: "xprinter-xp-80-ts-expense", name: "Xprinter mini printer, model : XP - 80 TS", quantity: "11 шт", amount: 7680000 },
    ],
  },
  {
    id: "monoblock",
    name: "Моноблок",
    quantity: 1,
    amount: 4200000,
    tone: "category",
    children: [
      { id: "monoblock-tsm-1514-expense", name: "Моноблок - 15 Inch Monitor model : TSM-1514 (8-128 GB (Windows Cach Register)", quantity: "1 шт", amount: 4200000 },
    ],
  },
  {
    id: "hub",
    name: "Хап",
    quantity: 5,
    amount: 480000,
    tone: "category",
    children: [
      { id: "mercury-sg108c", name: "MERCURY SG108 C (ХАП)", quantity: "2 шт", amount: 480000 },
      { id: "mercusys-ms108g", name: "MERCUSYS 8-Port 10/100/1000 Mbps Deskor Switch, model : MS108G (ХАП)", quantity: "3 шт", amount: 0 },
    ],
  },
  {
    id: "computer",
    name: "Компьютер",
    quantity: 1,
    amount: 0,
    tone: "category",
    children: [
      { id: "computer-set", name: "Компьютер комплект (монитор, процессор, клавиатура, мышка)", quantity: "1 шт", amount: 0 },
    ],
  },
  {
    id: "scanner",
    name: "Сканер",
    quantity: 60,
    amount: 1500000,
    tone: "category",
    children: [
      { id: "menuholder", name: "Менюхолдер (Реклама учун подставка, (стол устидаги) комплект)", quantity: "60 шт", amount: 1500000 },
    ],
  },
  { id: "used-product", name: "Продукт Б/У", quantity: 0, amount: 0, tone: "green" },
];

const storageBalanceBranchRows = [
  { branch: "Тошкент филиал", balance: "7 462", amount: 384273000 },
];

const storageBalanceDetailRows = [
  { id: "total", name: "Всего", quantity: "7 462", amount: 384273000, tone: "total" },
  { id: "realization", name: "Реализация", quantity: "7 462", amount: 384273000, tone: "green" },
  {
    id: "cable",
    name: "Кабель",
    quantity: "1 947",
    amount: 15604000,
    tone: "category",
    children: [
      { id: "connector-cat-5-balance", name: "Коннектор CAT 5", quantity: "-50 шт", amount: 0 },
      { id: "connector-cat-6-balance", name: "Коннектор CAT 6", quantity: "1 984 шт", amount: 1984000 },
      { id: "network-cable-cat6-balance", name: "NET WORK CABLE (OUTDOOR CAT6 UTP 23 AWG CABLE) (korobkada buxta kabel)", quantity: "11 шт", amount: 13420000 },
      { id: "sunkit-sk-868g-balance", name: "Обжимник - кабель учун икки функцияли (Read Star SUNKIT SK-868G)", quantity: "2 шт", amount: 200000 },
    ],
  },
  {
    id: "check-paper",
    name: "Chek Qog'oz",
    quantity: "5 223",
    amount: 8112000,
    tone: "category",
    children: [
      { id: "chek-qogoz-56", name: "Chek qogoz 56/12 m Termolenta", quantity: "5 186 шт", amount: 7779000 },
      { id: "chek-qogoz-80", name: "Chek qogoz 80/50 m Termolenta", quantity: "37 шт", amount: 333000 },
    ],
  },
  {
    id: "computer",
    name: "Компьютер",
    quantity: "60",
    amount: 14977000,
    tone: "category",
    children: [
      { id: "mish-depo-v82-balance", name: "Mish DEPO V82 (mishka)", quantity: "19 шт", amount: 1102000 },
      { id: "wired-keyboard-balance", name: "WIRED KEYBOARD E-KB721 MEGA jet (klaviatura provodnaya)", quantity: "8 шт", amount: 1000000 },
      { id: "ziffler-monitor-balance", name: "ZIFFLER GURVED MONITOR 24ZC100", quantity: "2 шт", amount: 2000000 },
      { id: "zttech-computer-balance", name: "ZTTECH COMPUTER (Case R 10) (Prosser)", quantity: "4 шт", amount: 4000000 },
      { id: "immer-monitor-balance", name: "IMMER FLAT MONITOR IJ24LT120", quantity: "1 шт", amount: 2000000 },
      { id: "everel-monitor-balance", name: "EVEREL 23,8 FLAT MONITOR 24EV1 100", quantity: "4 шт", amount: 4000000 },
      { id: "computer-set-balance", name: "Компьютер комплект (монитор, процессор, клавиатура, мышка)", quantity: "-3 шт", amount: 0 },
      { id: "keyboard-mat-balance", name: "Коврик (каттаси - клавиатура ва мышка учун)", quantity: "25 шт", amount: 875000 },
    ],
  },
  {
    id: "monoblock",
    name: "Моноблок",
    quantity: "69",
    amount: 247200000,
    tone: "category",
    children: [
      { id: "monoblock-tsm-1514-balance", name: "Моноблок - 15 Inch Monitor model : TSM-1514 (8-128 GB (Windows Cach Register)", quantity: "52 шт", amount: 231000000 },
      { id: "user-manual-scale-balance", name: "Электрон тарози User Manual", quantity: "1 шт", amount: 4800000 },
      { id: "cash-drawer-balance", name: "Касса аппарати CACH DRAWER", quantity: "2 шт", amount: 1320000 },
      { id: "xprinter-q80as-balance", name: "Xprinter mini printer, model : XP - Q80AS", quantity: "14 шт", amount: 10080000 },
    ],
  },
  {
    id: "printer",
    name: "Принтер",
    quantity: "102",
    amount: 77900000,
    tone: "category",
    children: [
      { id: "xprinter-t837l-balance", name: "Xprinter mini printer model : XP-T837L", quantity: "-6 шт", amount: -3904000 },
      { id: "xprinter-q838l-bluetooth-balance", name: "Xprinter mini printer model : XP-Q838L (bluetooth)", quantity: "1 шт", amount: 720000 },
      { id: "xprinter-xp80t-usb-balance", name: "Xprinter mini printer, model : XP - 80 T (USB+LAN kabel)", quantity: "2 шт", amount: 1700000 },
      { id: "xprinter-xp80ts-balance", name: "Xprinter mini printer, model : XP - 80 TS", quantity: "93 шт", amount: 66960000 },
      { id: "xprinter-q838l-balance", name: "Xpinter mini printer XP-Q838L", quantity: "9 шт", amount: 6480000 },
      { id: "xprinter-xp80q-balance", name: "Xprinter mini printer, model : XP - T 80 Q", quantity: "1 шт", amount: 600000 },
      { id: "xprinter-q80as-printer-balance", name: "Xprinter mini printer, model : XP - Q80AS", quantity: "2 шт", amount: 1440000 },
    ],
  },
  {
    id: "scanner",
    name: "Сканер",
    quantity: "4",
    amount: 1840000,
    tone: "category",
    children: [
      { id: "d-netum-a5-balance", name: "2 D NETUM (2D Omnidi Rectional Barcode Scanner) model : A5 (YUmologi) штрих-код сканери", quantity: "2 шт", amount: 1440000 },
      { id: "rfid-reader-balance", name: "RFID READER (сканер, карта, браслетники)", quantity: "2 шт", amount: 400000 },
      { id: "menuholder-balance", name: "Менюхолдер (Реклама учун подставка, (стол устидаги) комплект)", quantity: "0 шт", amount: 0 },
    ],
  },
  {
    id: "hub",
    name: "Хап",
    quantity: "53",
    amount: 18240000,
    tone: "category",
    children: [
      { id: "mercury-sg108c-balance", name: "MERCURY SG108 C (ХАП)", quantity: "45 шт", amount: 10800000 },
      { id: "mercusys-ms108g-balance", name: "MERCUSYS 8-Port 10/100/1000 Mbps Deskor Switch, model : MS108G (ХАП)", quantity: "-23 шт", amount: 0 },
      { id: "cuby-gs108d-balance", name: "CUBY 8-Port Gigabit Desktop Switch (Xan) model : GS108D", quantity: "24 шт", amount: 5760000 },
      { id: "tenda-sg108-balance", name: "Tenda SG 108 8 Gigabit Power", quantity: "7 шт", amount: 1680000 },
    ],
  },
  {
    id: "services",
    name: "Хизматлар (услуги)",
    quantity: "0",
    amount: 0,
    tone: "category",
    children: [
      { id: "soliq-integration-balance", name: "Солик интеграция", quantity: "0 шт", amount: 0 },
      { id: "telegram-bot-balance", name: "Телеграмм бот", quantity: "0 шт", amount: 0 },
      { id: "monthly-payment-balance", name: "ойлик абонент тўлов", quantity: "0 шт", amount: 0 },
    ],
  },
  {
    id: "wifi",
    name: "Wi-Fi",
    quantity: "4",
    amount: 400000,
    tone: "category",
    children: [
      { id: "usb-wifi-alfa-balance", name: "USB Wi-Fi Adapter - ALFA ALFANEXT", quantity: "4 шт", amount: 400000 },
    ],
  },
  { id: "used-product", name: "Продукт Б/У", quantity: "0", amount: 0, tone: "green" },
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

const ADMIN_CHART_COLOR = "#1a916f";
const ADMIN_CHART_COLOR_RGB = "26, 145, 111";
const ADMIN_CHART_TODAY = new Date(2026, 6, 15);
const ADMIN_CHART_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const ADMIN_CHART_PRESET_DAYS = [7, 30];

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

function adminDateToInputValue(date) {
  const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${value.getFullYear()}-${padDate(value.getMonth() + 1)}-${padDate(value.getDate())}`;
}

function adminTodayInputValue() {
  return adminDateToInputValue(new Date());
}

function adminReportDateToInputDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return adminTodayInputValue();
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function adminInputDateToReportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return formatDate(new Date());
  }
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function adminChartRangeEndingAt(days, endValue = adminTodayInputValue()) {
  const end = new Date(`${endValue}T00:00:00`);
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(1, Number(days) || 1) + 1);
  return {
    preset: "",
    start: adminInputDateToReportDate(adminDateToInputValue(start)),
    end: adminInputDateToReportDate(adminDateToInputValue(end)),
    startTime: "00:00",
    endTime: "00:00",
  };
}

function normalizeAdminReportRange(range = {}) {
  const startInput = adminReportDateToInputDate(range.start);
  const endInput = adminReportDateToInputDate(range.end);
  const [dateFrom, dateTo] = startInput <= endInput ? [startInput, endInput] : [endInput, startInput];
  return {
    preset: range.preset || "",
    start: adminInputDateToReportDate(dateFrom),
    end: adminInputDateToReportDate(dateTo),
    startTime: "00:00",
    endTime: "00:00",
  };
}

function adminChartRangeDays(range) {
  const normalized = normalizeAdminReportRange(range);
  const start = new Date(`${adminReportDateToInputDate(normalized.start)}T00:00:00`);
  const end = new Date(`${adminReportDateToInputDate(normalized.end)}T00:00:00`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function adminChartRangeLabel(range) {
  const normalized = normalizeAdminReportRange(range);
  return normalized.start === normalized.end ? normalized.start : `${normalized.start} - ${normalized.end}`;
}

function formatAdminDaysLabel(days) {
  const value = Math.max(1, Number(days) || 1);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${value} дня`;
  return `${value} дней`;
}

function buildAdminChartRange(days) {
  const end = new Date(ADMIN_CHART_TODAY);
  const start = new Date(ADMIN_CHART_TODAY);
  start.setDate(end.getDate() - days + 1);
  return {
    mode: String(days),
    label: `${days} дней`,
    start: formatDate(start),
    end: formatDate(end),
  };
}

function getAdminChartDaysBetween(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function normalizeAdminChartRange(startValue, endValue, mode = "custom") {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const range = {
    mode,
    start: formatDate(first),
    end: formatDate(last),
  };
  return { ...range, label: mode === "7" || mode === "30" ? `${mode} дней` : rangeLabel(range) };
}

function buildAdminRangeLabels(range) {
  const start = parseDate(range.start);
  const days = getAdminChartDaysBetween(range.start, range.end);

  return Array.from({ length: days }, (_, day) => {
    const date = new Date(start);
    date.setDate(start.getDate() + day);
    return `${padDate(date.getDate())}.${padDate(date.getMonth() + 1)}`;
  });
}

function buildAdminChartTickLabels(labels) {
  if (labels.length <= 12) {
    return labels.map((label, index) => [index, label]);
  }

  if (labels.length > 31) {
    return labels.reduce((ticks, label, index) => {
      if (index % 5 === 0 || index === labels.length - 1) ticks.push([index, label]);
      return ticks;
    }, []);
  }

  const visibleTickCount = labels.length <= 31 ? 8 : 10;
  const step = (labels.length - 1) / Math.max(1, visibleTickCount - 1);
  const visibleIndexes = new Set();

  for (let index = 0; index < visibleTickCount; index += 1) {
    visibleIndexes.add(Math.round(index * step));
  }

  visibleIndexes.add(0);
  visibleIndexes.add(labels.length - 1);

  return labels.reduce((ticks, label, index) => {
    if (visibleIndexes.has(index)) ticks.push([index, label]);
    return ticks;
  }, []);
}

function buildAdminDemoCurvePoints(count, target) {
  if (count <= 0) return [];
  if (count === 1) return [Number(target.toFixed(2))];

  const startValue = target * 0.12;
  const availableValue = Math.max(0, target - startValue);
  const increments = Array.from({ length: count - 1 }, (_, index) => {
    const progress = (index + 1) / Math.max(1, count - 1);
    const weeklyWave = Math.sin(progress * Math.PI * 4.2 - 0.45) * 0.34;
    const shortWave = Math.sin((index + 1) * 1.45) * 0.14;
    const lunchPulse = Math.exp(-Math.pow((progress - 0.38) / 0.13, 2)) * 0.42;
    const weekendPulse = Math.exp(-Math.pow((progress - 0.78) / 0.11, 2)) * 0.34;
    const quietWindow = Math.exp(-Math.pow((progress - 0.58) / 0.09, 2)) * 0.28;

    return Math.max(0.32, 1 + weeklyWave + shortWave + lunchPulse + weekendPulse - quietWindow);
  });
  const totalWeight = increments.reduce((sum, value) => sum + value, 0) || 1;
  let runningValue = startValue;
  const points = [Number(runningValue.toFixed(2))];

  increments.forEach((weight) => {
    runningValue += availableValue * (weight / totalWeight);
    points.push(Number(runningValue.toFixed(2)));
  });

  points[points.length - 1] = Number(target.toFixed(2));
  return points;
}

function demoAdminChartRangeData(range) {
  const labels = buildAdminRangeLabels(range);
  const days = getAdminChartDaysBetween(range.start, range.end);
  const target = Math.max(12, days * 6.25);
  const points = buildAdminDemoCurvePoints(labels.length, target);
  const yMax = Math.ceil(Math.max(...points) / 10) * 10;
  const value = formatAdminRawMoney(adminChartPointToMoney(points.at(-1)));

  return {
    value,
    delta: `Период: ${range.start} - ${range.end}`,
    points,
    labels,
    tickLabels: buildAdminChartTickLabels(labels),
    tooltip: { label: range.end, value },
    tooltipIndex: Math.max(0, labels.length - 1),
    yMax,
    yStep: Math.max(5, yMax / 4),
  };
}

function emptyAdminChartRangeData(range) {
  const labels = buildAdminRangeLabels(range);
  return {
    value: "0 UZS",
    delta: `Нет данных backend за ${range.start} - ${range.end}`,
    points: labels.map(() => 0),
    labels,
    tickLabels: buildAdminChartTickLabels(labels),
    tooltip: { label: range.end, value: "0 UZS" },
    tooltipIndex: Math.max(0, labels.length - 1),
    yMax: 1,
    yStep: 0.25,
  };
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

const adminDemoChartBySegment = {
  "День": {
    value: "24 850 000 UZS",
    delta: "Демо-оборот Marjon Cafe за сегодня",
    labels: ["09:00", "12:00", "15:00", "18:00", "21:00", "00:00"],
    points: [1.8, 4.2, 8.9, 13.4, 20.1, 24.85],
    tooltip: { label: "00:00", value: "24 850 000 UZS" },
    yMax: 30,
    yStep: 7.5,
  },
  "Неделя": {
    value: "187 450 000 UZS",
    delta: "+16% к прошлой неделе",
    labels: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
    points: [18.5, 22.4, 19.8, 26.1, 31.6, 38.4, 30.65],
    tooltip: { label: "Вс", value: "30 650 000 UZS" },
    yMax: 45,
    yStep: 15,
  },
  "Месяц": {
    value: "187 450 000 UZS",
    delta: "+24% к прошлому месяцу",
    labels: ["01", "07", "14", "21", "28", "31"],
    points: [18.4, 42.8, 76.3, 118.9, 155.6, 187.45],
    tooltip: { label: "31 июля", value: "187 450 000 UZS" },
    yMax: 220,
    yStep: 55,
  },
  "Год": {
    value: "1 048 000 000 UZS",
    delta: "Демо-оборот за 2026 год",
    labels: ["Янв", "Мар", "Май", "Июл", "Сен", "Ноя"],
    points: [62, 211, 389, 604, 832, 1048],
    tooltip: { label: "Ноябрь", value: "1 048 000 000 UZS" },
    yMax: 1200,
    yStep: 300,
  },
};

function demoAdminChartData(segment, range) {
  if (range) return demoAdminChartRangeData(range);
  const data = adminDemoChartBySegment[segment] || adminDemoChartBySegment["Месяц"];
  return {
    ...data,
    tickLabels: data.labels.map((label, index) => [index, label]),
    tooltipIndex: Math.max(0, data.points.length - 1),
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
          cubicInterpolationMode: "monotone",
          tension: 0.5,
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

              const amountEl = tooltipEl.querySelector(".admin-chart-tooltip__amount");
              const currencyEl = tooltipEl.querySelector(".admin-chart-tooltip__currency");
              const titleEl = tooltipEl.querySelector(".admin-chart-tooltip__date");
              const tooltipValue = tooltip.body?.[0]?.lines?.[0] || "";
              const valueParts = tooltipValue.match(/^(.+?)\s+([A-Z]{3})$/);
              if (amountEl) amountEl.textContent = valueParts?.[1] || tooltipValue;
              if (currencyEl) currencyEl.textContent = valueParts?.[2] || "";
              if (titleEl) titleEl.textContent = tooltip.title?.[0] || "";

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
              padding: 10,
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
        <strong>
          <span className="admin-chart-tooltip__amount" />
          <small className="admin-chart-tooltip__currency" />
        </strong>
        <span className="admin-chart-tooltip__date" />
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

function Header({ user, onBack, notifications = [], onNotificationRefresh, onNotificationSelect, onProfile }) {
  const notificationsRef = useRef(null);
  const [now, setNow] = useState(() => new Date());
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const profileName = user?.name || "Александр П.";
  const profileInitial = profileName.trim().slice(0, 1) || "А";
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
            <div className="admin-notification-popover" role="dialog" aria-label="Уведомления">
              <div className="admin-notification-popover__head">
                <div>
                  <span>Уведомления</span>
                  <strong>{notificationTitle}</strong>
                </div>
                <button
                  className={notificationsLoading ? "is-loading" : ""}
                  type="button"
                  onClick={refreshNotifications}
                  disabled={notificationsLoading}
                  aria-label="Обновить"
                >
                  <Icon name="bi-arrow-clockwise" size={16} />
                </button>
              </div>
              <div className="admin-notification-popover__body">
                {notificationsLoading ? (
                  <div className="admin-notification-popover__empty">Загрузка...</div>
                ) : null}
                {!notificationsLoading && notifications.length ? notifications.map((item) => (
                  <button type="button" className="admin-notification-item" key={item.id} onClick={() => openNotification(item)}>
                    <span className="admin-notification-item__icon">
                      <Icon name={item.icon || "bi-exclamation-triangle"} size={16} />
                    </span>
                    <span className="admin-notification-item__body">
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                    </span>
                  </button>
                )) : null}
                {!notificationsLoading && !notifications.length ? (
                  <p className="admin-notification-popover__empty">Новых сообщений нет</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <button className="admin-profile" type="button" onClick={onProfile} aria-label="Профиль администратора">
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

function splitKpiValue(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(.*?)(?:\s+(UZS|USD|RUB))$/i);
  return match
    ? { amount: match[1].trim(), suffix: match[2].toUpperCase() }
    : { amount: text, suffix: "" };
}

function KpiCard({ item, onClick }) {
  const value = splitKpiValue(item.value);
  const today = new Date();
  const deltaIconName = {
    revenue: "bi-graph-up-arrow",
    organizations: "bi-buildings",
    subscriptions: "bi-clipboard-check",
    branches: "bi-cash-coin",
    cashboxes: "bi-receipt",
  }[item.dataKey] || "bi-check2";

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
        <time dateTime={adminDateToInputValue(today)}>{formatDate(today)}</time>
      </div>
      <small className="admin-kpi__title">{item.title}</small>
      <strong>
        <span>{value.amount}</span>
        {value.suffix ? <small>{value.suffix}</small> : null}
      </strong>
      <p>
        <span className="admin-kpi__delta-icon" aria-hidden="true">
          <Icon name={deltaIconName} size={11} />
        </span>
        <span className="admin-kpi__delta-text">{item.delta}</span>
      </p>
    </article>
  );
}

function adminChartRangeForSegment(segment) {
  if (segment === "День") {
    return {
      mode: "today",
      label: "Сегодня",
      start: formatDate(ADMIN_CHART_TODAY),
      end: formatDate(ADMIN_CHART_TODAY),
    };
  }
  if (segment === "Неделя") return buildAdminChartRange(7);
  if (segment === "Год") {
    return {
      mode: "year",
      label: "2026",
      start: "01.01.2026",
      end: "31.12.2026",
    };
  }
  return buildAdminChartRange(30);
}

function getAdminChartCalendarCells(year, month) {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      key: formatDate(date),
      date,
      label: String(date.getDate()),
      muted: date.getMonth() !== month,
    };
  });
}

function AdminChartRangePicker({ range, onChange }) {
  const pickerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(range.start);
  const [draftEnd, setDraftEnd] = useState(range.end);
  const [draftMode, setDraftMode] = useState(range.mode);
  const [viewDate, setViewDate] = useState(() => parseDate(range.end));
  const [selectingEnd, setSelectingEnd] = useState(false);

  useEffect(() => {
    setDraftStart(range.start);
    setDraftEnd(range.end);
    setDraftMode(range.mode);
    setViewDate(parseDate(range.end));
  }, [range]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutside(event) {
      if (!pickerRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function choosePreset(days) {
    const next = buildAdminChartRange(days);
    setDraftStart(next.start);
    setDraftEnd(next.end);
    setDraftMode(next.mode);
    setViewDate(parseDate(next.end));
    setSelectingEnd(false);
  }

  function chooseToday() {
    const today = formatDate(ADMIN_CHART_TODAY);
    setDraftStart(today);
    setDraftEnd(today);
    setDraftMode("today");
    setViewDate(ADMIN_CHART_TODAY);
    setSelectingEnd(false);
  }

  function chooseCalendarDate(date) {
    const next = formatDate(date);
    setDraftMode("custom");
    setViewDate(date);
    if (!selectingEnd) {
      setDraftStart(next);
      setDraftEnd(next);
      setSelectingEnd(true);
      return;
    }
    const normalized = normalizeAdminChartRange(draftStart, next, "custom");
    setDraftStart(normalized.start);
    setDraftEnd(normalized.end);
    setSelectingEnd(false);
  }

  function applyRange() {
    const normalized = normalizeAdminChartRange(draftStart, draftEnd, draftMode);
    onChange(normalized);
    setOpen(false);
    setSelectingEnd(false);
  }

  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const calendarCells = getAdminChartCalendarCells(viewYear, viewMonth);
  const rangeStartDate = parseDate(draftStart);
  const rangeEndDate = parseDate(draftEnd);

  return (
    <div className="admin-chart-range" ref={pickerRef}>
      <button className="admin-chart-range__trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{range.label}</span>
        <Icon name="bi-chevron-down" size={14} />
      </button>

      {open ? (
        <div className="admin-chart-range__popover" role="dialog" aria-label="Период графика">
          <div className="admin-chart-range__presets">
            {[7, 30].map((days) => (
              <button
                type="button"
                className={draftMode === String(days) ? "is-active" : ""}
                key={days}
                onClick={() => choosePreset(days)}
              >
                {days} дней
              </button>
            ))}
          </div>

          <div className="admin-chart-range__inputs">
            <input value={draftStart} onChange={(event) => { setDraftStart(event.target.value); setDraftMode("custom"); }} aria-label="Начало периода" />
            <span>-</span>
            <input value={draftEnd} onChange={(event) => { setDraftEnd(event.target.value); setDraftMode("custom"); }} aria-label="Конец периода" />
            <button type="button" onClick={applyRange}>OK</button>
          </div>

          <div className="admin-chart-calendar">
            <div className="admin-chart-calendar__nav">
              <button type="button" onClick={() => setViewDate(new Date(viewYear, viewMonth - 1, 1))} aria-label="Предыдущий месяц">
                <Icon name="bi-chevron-left" size={15} />
              </button>
              <select value={viewYear} onChange={(event) => setViewDate(new Date(Number(event.target.value), viewMonth, 1))} aria-label="Год">
                {[2025, 2026, 2027].map((year) => <option value={year} key={year}>{year}</option>)}
              </select>
              <select value={viewMonth} onChange={(event) => setViewDate(new Date(viewYear, Number(event.target.value), 1))} aria-label="Месяц">
                {ADMIN_CHART_MONTHS.map((month, index) => <option value={index} key={month}>{month}</option>)}
              </select>
              <button type="button" onClick={() => setViewDate(new Date(viewYear, viewMonth + 1, 1))} aria-label="Следующий месяц">
                <Icon name="bi-chevron-right" size={15} />
              </button>
            </div>

            <div className="admin-chart-calendar__week">
              {["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="admin-chart-calendar__grid">
              {calendarCells.map((cell) => {
                const isSelected = cell.key === draftStart || cell.key === draftEnd;
                const inRange = cell.date >= rangeStartDate && cell.date <= rangeEndDate;
                return (
                  <button
                    type="button"
                    className={`${cell.muted ? "is-muted" : ""} ${inRange ? "is-in-range" : ""} ${isSelected ? "is-selected" : ""}`}
                    key={cell.key}
                    onClick={() => chooseCalendarDate(cell.date)}
                  >
                    {cell.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="admin-chart-range__actions">
            <button type="button" className="is-today" onClick={chooseToday}>
              <Icon name="bi-calendar3" size={14} />
              Сегодня
            </button>
            <button type="button" className="is-primary" onClick={applyRange}>OK</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlatformChart({ segment, onSegmentChange }) {
  const [range, setRange] = useState(() => adminChartRangeEndingAt(7));
  const normalizedRange = useMemo(() => normalizeAdminReportRange(range), [range]);
  const data = ADMIN_DASHBOARD_DEMO_MODE ? demoAdminChartData(segment, normalizedRange) : emptyAdminChartRangeData(normalizedRange);
  const presetOptions = useMemo(() => (
    ADMIN_CHART_PRESET_DAYS.map((days) => ({
      label: `${days} дней`,
      getRange: () => ({ ...adminChartRangeEndingAt(days), preset: `${days} дней` }),
    }))
  ), []);

  function handleRangeChange(nextRange) {
    const next = normalizeAdminReportRange(nextRange);
    const days = adminChartRangeDays(next);
    setRange(next);
    if (days === 7) onSegmentChange("Неделя");
    if (days === 30) onSegmentChange("Месяц");
  }

  return (
    <section className="admin-chart-card">
      <div className="admin-chart-card__head">
        <div>
          <span>Динамика оборота платформы</span>
          <strong>{data.value}</strong>
          <em>{data.delta}</em>
        </div>
        <div className="admin-chart-controls period-switcher owner-revenue-switcher admin-revenue-switcher" aria-label="Период оборота платформы">
          <div className="owner-revenue-range report-actions admin-revenue-range">
            <ReportDateRangePicker
              value={normalizedRange}
              onChange={handleRangeChange}
              buttonClassName="period-dropdown__button owner-revenue-range__button admin-revenue-range__button"
              presets={presetOptions}
              formatButtonLabel={(currentRange) => formatAdminDaysLabel(adminChartRangeDays(currentRange))}
              showDropdownIcon
              showTime={false}
              blockPageScrollOnWheel
            />
          </div>
        </div>
      </div>
      <div className="admin-chart">
        <AdminRevenueChart data={data} segment={segment} />
      </div>
    </section>
  );
}

function DashboardWarehouseCards({ onOpenSection }) {
  return (
    <aside className="admin-chart-side-cards" aria-label="Сводка склада и затрат">
      {dashboardWarehouseCards.map((item) => {
        const className = `admin-chart-side-card admin-chart-side-card--${item.tone}`;
        const value = splitKpiValue(item.value);
        const content = (
          <>
            <span className="admin-chart-side-card__icon">
              <Icon name={item.icon} size={30} />
            </span>
            <span className="admin-chart-side-card__body">
              <strong>{item.title}</strong>
              <span className="admin-chart-side-card__value">
                <span>{value.amount}</span>
                {value.suffix ? <small>{value.suffix}</small> : null}
              </span>
            </span>
            <span className="admin-chart-side-card__chevron" aria-hidden="true">
              <Icon name="bi-chevron-right" size={21} />
            </span>
          </>
        );

        return item.route ? (
          <button className={className} type="button" onClick={() => onOpenSection?.(item.route)} key={item.title}>
            {content}
          </button>
        ) : (
          <article className={className} key={item.title}>
            {content}
          </article>
        );
      })}
    </aside>
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

const ORG_DIRECTORY_COLUMN_SETTINGS_STORAGE_KEY = "marjon.admin.organizations.columns.v1";
const ORG_DIRECTORY_COLUMN_SETTINGS_LAYOUT_VERSION = 1;
const defaultOrgDirectoryColumnOrder = [...orgDirectoryColumnKeys];

function normalizeOrgDirectoryColumnKeys(keys) {
  const seen = new Set();
  return (Array.isArray(keys) ? keys : []).filter((key) => {
    if (!orgDirectoryColumnKeys.includes(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeOrgDirectoryColumnSettings(settings) {
  const savedOrder = settings?.layoutVersion === ORG_DIRECTORY_COLUMN_SETTINGS_LAYOUT_VERSION
    ? normalizeOrgDirectoryColumnKeys(settings?.order)
    : [];
  const order = [
    ...savedOrder,
    ...defaultOrgDirectoryColumnOrder.filter((key) => !savedOrder.includes(key)),
  ];
  const visibleSource = Array.isArray(settings) ? settings : settings?.visible;
  const visible = normalizeOrgDirectoryColumnKeys(visibleSource || orgDirectoryColumnKeys)
    .filter((key) => order.includes(key));

  return {
    layoutVersion: ORG_DIRECTORY_COLUMN_SETTINGS_LAYOUT_VERSION,
    order,
    visible: visible.length ? visible : [order[0]],
  };
}

function loadOrgDirectoryColumnSettings() {
  if (typeof window === "undefined") {
    return normalizeOrgDirectoryColumnSettings();
  }

  try {
    return normalizeOrgDirectoryColumnSettings(JSON.parse(window.localStorage.getItem(ORG_DIRECTORY_COLUMN_SETTINGS_STORAGE_KEY)));
  } catch {
    return normalizeOrgDirectoryColumnSettings();
  }
}

function saveOrgDirectoryColumnSettings(settings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      ORG_DIRECTORY_COLUMN_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeOrgDirectoryColumnSettings(settings)),
    );
  } catch {
    // localStorage can be unavailable in private mode; current UI state still works.
  }
}

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

function OrganizationEditScreen({ row, onBack, onSave }) {
  const [form, setForm] = useState(() => ({
    name: row.name || "",
    tariff: row.tariff || "",
    workingDays: "0",
    branchType: "Обычный",
    virtualCashbox: "",
    virtualCashboxIp: "",
    country: "Узбекистан",
    region: row.region || "Surxondaryo",
    district: "Денов т",
    installDate: row.date || "20.07.2026",
    inn: "",
    solvency: "Платежеспособный",
  }));
  const [settings, setSettings] = useState(() => ({
    warehouse: row.warehouse === "Активно",
    onlineMenu: row.onlineMenu === "Активно",
    socialLink: false,
    autoBlock: true,
    status: row.status !== "Не активно",
    myId: false,
  }));
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraForm, setExtraForm] = useState(() => ({
    managerName: row.manager || "ISKANDAROV ABDURAIM",
    managerPhone: row.contact || "+998 88-805-1441",
    companyPhone: row.contact || "+998 88-805-1441",
    ownerPhone: row.contact || "+998 88-805-1441",
    operator: "Sirojiddin Nuritdinov",
    seller: "Sirojiddin Nuritdinov",
    installer: row.manager || "JAMOLDINOV BOTIR",
    source: row.source || "Instagram",
    organizationStatus: row.orgStatus || "USTANOVKA JARAYONIDA",
    telegramGroupId: "1",
    description: "1",
    mainCurrency: row.currency || "UZS",
    availableCurrency: row.currency || "UZS",
  }));
  const [extraNumbers, setExtraNumbers] = useState([]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleSetting(key) {
    setSettings((current) => ({ ...current, [key]: !current[key] }));
  }

  function updateExtraField(key, value) {
    setExtraForm((current) => ({ ...current, [key]: value }));
  }

  function addExtraNumber() {
    setExtraNumbers((current) => [...current, { id: Date.now(), value: "" }]);
  }

  function updateExtraNumber(id, value) {
    setExtraNumbers((current) => current.map((phone) => (
      phone.id === id ? { ...phone, value } : phone
    )));
  }

  function removeExtraNumber(id) {
    setExtraNumbers((current) => current.filter((phone) => phone.id !== id));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSave(row.id, {
      name: form.name.trim() || row.name,
      tariff: form.tariff.trim() || row.tariff,
      region: form.region,
      date: form.installDate,
      contact: extraForm.ownerPhone.trim() || extraForm.companyPhone.trim() || row.contact,
      manager: extraForm.managerName.trim() || row.manager,
      source: extraForm.source,
      orgStatus: extraForm.organizationStatus,
      currency: extraForm.mainCurrency,
      extraPhones: extraNumbers.map((phone) => phone.value.trim()).filter(Boolean),
      warehouse: settings.warehouse ? "Активно" : "Не активно",
      onlineMenu: settings.onlineMenu ? "Активно" : "Не активно",
      status: settings.status ? (row.status === "Активно" ? "Активно" : "Доступен") : "Не активно",
    });
  }

  function renderTextField(label, key, options = {}) {
    return (
      <label className="org-edit-field">
        <span>
          {label}
          {options.required ? <b>*</b> : null}
        </span>
        <input
          type="text"
          value={form[key]}
          placeholder={options.placeholder}
          readOnly={options.readOnly}
          onChange={(event) => updateField(key, event.target.value)}
        />
      </label>
    );
  }

  function renderSelectField(label, key, values) {
    return (
      <label className="org-edit-field org-edit-field--select">
        <span>{label}</span>
        <select value={form[key]} onChange={(event) => updateField(key, event.target.value)}>
          {values.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function renderExtraTextField(label, key, options = {}) {
    return (
      <label className="org-edit-extra-field">
        <span>{label}</span>
        <input
          type="text"
          value={extraForm[key]}
          placeholder={options.placeholder}
          readOnly={options.readOnly}
          onChange={(event) => updateExtraField(key, event.target.value)}
        />
      </label>
    );
  }

  function renderExtraSelectField(label, key, values, options = {}) {
    return (
      <label className="org-edit-extra-field">
        <span>{label}</span>
        <select
          value={extraForm[key]}
          disabled={options.disabled}
          onChange={(event) => updateExtraField(key, event.target.value)}
        >
          {values.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const settingRows = [
    ["warehouse", "Управление складом"],
    ["onlineMenu", "Онлайн Меню"],
    ["status", "Статус"],
    ["socialLink", "Ссылка соц сетей"],
    ["autoBlock", "Автоблокировка"],
    ["myId", "Подтверждение MYID"],
  ];
  const regionOptions = Array.from(new Set([row.region || "Surxondaryo", "Surxondaryo", "Toshkent", "Samarqand", "Farg'ona", "Buxoro"].filter(Boolean)));

  return (
    <section className="org-edit-page">
      <header className="org-edit-header">
        <button type="button" className="org-edit-back" onClick={onBack} aria-label="Назад">
          <Icon name="bi-chevron-left" size={18} />
        </button>
        <h2>Изменить организацию</h2>
      </header>

      <form className="org-edit-form" onSubmit={handleSubmit}>
        <h3>Основные данные</h3>
        <div className="org-edit-grid">
          {renderTextField("Название", "name")}
          {renderTextField("Цена тарифа", "tariff", { readOnly: true })}
          {renderTextField("Рабочие дни", "workingDays")}
          {renderSelectField("Тип филиала", "branchType", ["Обычный", "Филиал", "Главный"])}
          {renderTextField("Виртуал касса номер", "virtualCashbox", { placeholder: "Введите номер" })}
          {renderTextField("IP адрес виртуальной кассы", "virtualCashboxIp", { placeholder: "Введите номер" })}
          {renderSelectField("Страна", "country", ["Узбекистан"])}
          {renderSelectField("Регион", "region", regionOptions)}
          {renderSelectField("Район", "district", ["Денов т", "Термез", "Шурчи", "Ангор"])}
          {renderTextField("Дата установки ", "installDate", { required: true })}
          {renderTextField("ИНН организации", "inn", { placeholder: "Введите номер" })}
          {renderSelectField("Платежеспособный", "solvency", ["Платежеспособный", "Неплатежеспособный"])}
        </div>

        <div className="org-edit-settings">
          <h3>Настройки</h3>
          <div className="org-edit-toggle-grid">
            {settingRows.map(([key, label]) => (
              <div key={key} className="org-edit-setting">
                <span>{label}</span>
                <button
                  type="button"
                  className={`org-edit-toggle ${settings[key] ? "is-on" : ""}`}
                  onClick={() => toggleSetting(key)}
                  aria-pressed={settings[key]}
                  aria-label={label}
                >
                  <span />
                </button>
              </div>
            ))}
          </div>
        </div>

        <button type="button" className="org-edit-extra" onClick={() => setExtraOpen((current) => !current)}>
          {extraOpen ? "Закрыть доп. опции" : "Показать доп. опции"}
        </button>

        {extraOpen ? (
          <section className="org-edit-extra-panel">
            <div className="org-edit-extra-section">
              <h4>Контактные лица</h4>
              <div className="org-edit-extra-grid org-edit-extra-grid--contacts">
                {renderExtraTextField("Имя менеджера", "managerName")}
                {renderExtraTextField("Номер менеджера", "managerPhone")}
                {renderExtraTextField("Номер компании", "companyPhone")}
                {renderExtraTextField("Номер владельца", "ownerPhone")}
              </div>

              {extraNumbers.length > 0 ? (
                <div className="org-edit-extra-numbers">
                  {extraNumbers.map((phone, index) => (
                    <div className="org-edit-extra-field" key={phone.id}>
                      <span>Доп. номер {index + 1}</span>
                      <div className="org-edit-phone-row">
                        <input
                          type="text"
                          value={phone.value}
                          placeholder="+998"
                          onChange={(event) => updateExtraNumber(phone.id, event.target.value)}
                        />
                        <button type="button" onClick={() => removeExtraNumber(phone.id)} aria-label="Удалить номер">
                          <Icon name="bi-x-lg" size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <button type="button" className="org-edit-add-phone" onClick={addExtraNumber}>
                + Добавить номер
              </button>
            </div>

            <div className="org-edit-extra-section">
              <h4>География и персонал</h4>
              <div className="org-edit-extra-grid org-edit-extra-grid--staff">
                {renderExtraSelectField("Оператор", "operator", ["Sirojiddin Nuritdinov", "ISKANDAROV ABDURAIM", "JAMOLDINOV BOTIR"])}
                {renderExtraSelectField("Продавец", "seller", ["Sirojiddin Nuritdinov", "ISKANDAROV ABDURAIM", "JAMOLDINOV BOTIR"], { disabled: true })}
                {renderExtraSelectField("Установщик", "installer", ["JAMOLDINOV BOTIR", "Sirojiddin Nuritdinov", "ISKANDAROV ABDURAIM"])}
              </div>
            </div>

            <div className="org-edit-extra-section">
              <h4>Дополнительно</h4>
              <div className="org-edit-extra-grid org-edit-extra-grid--additional">
                {renderExtraSelectField("Источник", "source", ["Instagram", "Telegram", "Facebook", "Diler", "Referral"])}
                {renderExtraSelectField("Статус Организации", "organizationStatus", ["USTANOVKA JARAYONIDA", "ISHLA TURGAN", "HALI ULANMAGAN", "TEST"])}
                {renderExtraTextField("ID телеграм группы (support)", "telegramGroupId")}
                {renderExtraTextField("Описание", "description")}
                {renderExtraSelectField("Основная валюта", "mainCurrency", ["UZS", "USD", "RUB"], { disabled: true })}
                <div className="org-edit-extra-field">
                  <span>Доступные валюты</span>
                  <div className="org-edit-currency-tags">
                    <button
                      type="button"
                      className="org-edit-currency-chip"
                      onClick={() => updateExtraField("availableCurrency", "")}
                      aria-label="Убрать валюту"
                    >
                      {extraForm.availableCurrency || "UZS"} <i>×</i>
                    </button>
                    <Icon name="bi-chevron-down" size={14} />
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <div className="org-edit-actions">
          <button type="submit" className="org-edit-save">
            Сохранить
          </button>
        </div>
      </form>
    </section>
  );
}

function OrganizationDirectoryPage({ search, onNotify, onInnerBackChange }) {
  const [rows, setRows] = useState(() => (ADMIN_DASHBOARD_DEMO_MODE ? demoOrganizationDirectoryRows : []));
  const [messageRow, setMessageRow] = useState(null);
  const [editorRow, setEditorRow] = useState(null);
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [messageOnly, setMessageOnly] = useState(false);
  const [yangiOnly, setYangiOnly] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [columnSettings, setColumnSettings] = useState(loadOrgDirectoryColumnSettings);
  const [dragColumnKey, setDragColumnKey] = useState("");
  const [dragColumnTarget, setDragColumnTarget] = useState(null);
  const [page, setPage] = useState(1);
  const pageSizeOptions = ADMIN_DASHBOARD_DEMO_MODE ? [20, 50, 100] : [10, 20, 50];
  const [pageSize, setPageSize] = useState(() => (ADMIN_DASHBOARD_DEMO_MODE ? 50 : 20));
  const visibleColumns = columnSettings.visible;

  useEffect(() => {
    if (!onInnerBackChange) return undefined;

    if (!editorRow && !messageRow) {
      onInnerBackChange(null);
      return undefined;
    }

    onInnerBackChange(() => {
      setEditorRow(null);
      setMessageRow(null);
    });

    return () => onInnerBackChange(null);
  }, [editorRow, messageRow, onInnerBackChange]);

  useEffect(() => {
    if (ADMIN_DASHBOARD_DEMO_MODE) return;
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
  }, [query, search, serviceFilter, paymentFilter, statusFilter, messageOnly, yangiOnly, pageSize]);

  useEffect(() => {
    saveOrgDirectoryColumnSettings(columnSettings);
  }, [columnSettings]);

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
  const pageList = getPageList(currentPage, totalPages);

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

  function saveEditorRow(id, patch) {
    updateRow(id, patch);
    setEditorRow(null);
    onNotify?.(`${patch.name || "Организация"}: данные сохранены.`);
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
    setColumnSettings((current) => {
      const normalized = normalizeOrgDirectoryColumnSettings(current);

      if (normalized.visible.includes(key)) {
        return {
          ...normalized,
          visible: normalized.visible.length > 1
            ? normalized.visible.filter((item) => item !== key)
            : normalized.visible,
        };
      }

      return {
        ...normalized,
        visible: normalized.order.filter((item) => item === key || normalized.visible.includes(item)),
      };
    });
  }

  function moveColumn(key, direction) {
    setColumnSettings((current) => {
      const normalized = normalizeOrgDirectoryColumnSettings(current);
      const currentIndex = normalized.order.indexOf(key);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= normalized.order.length) {
        return normalized;
      }

      const nextOrder = [...normalized.order];
      [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];

      return {
        ...normalized,
        order: nextOrder,
      };
    });
  }

  function moveColumnToDrop(sourceKey, targetKey, placement = "before") {
    if (!sourceKey || !targetKey || sourceKey === targetKey) {
      return;
    }

    setColumnSettings((current) => {
      const normalized = normalizeOrgDirectoryColumnSettings(current);
      const nextOrder = normalized.order.filter((key) => key !== sourceKey);
      const targetIndex = nextOrder.indexOf(targetKey);

      if (targetIndex < 0 || !normalized.order.includes(sourceKey)) {
        return normalized;
      }

      nextOrder.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, sourceKey);

      return {
        ...normalized,
        order: nextOrder,
      };
    });
  }

  function resetColumnSettings() {
    setColumnSettings(normalizeOrgDirectoryColumnSettings());
  }

  function goToPage(nextPage) {
    setPage(Math.min(totalPages, Math.max(1, nextPage)));
  }

  const allColumns = [
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
        <button type="button" className="org-directory-edit" onClick={() => setEditorRow(row)} aria-label={`Редактировать ${row.name}`}>
          <Icon name="bi-pencil" size={15} />
        </button>
      ),
    },
  ];
  const orderedColumns = columnSettings.order
    .map((key) => allColumns.find((column) => column.key === key))
    .filter(Boolean);
  const columns = orderedColumns.filter((column) => visibleColumns.includes(column.key));
  const actionsColumnIsLast = columns.at(-1)?.key === "actions";

  if (editorRow) {
    return (
      <OrganizationEditScreen
        row={editorRow}
        onBack={() => setEditorRow(null)}
        onSave={saveEditorRow}
      />
    );
  }

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
        <button
          type="button"
          className={`org-directory-settings ${settingsOpen ? "is-open" : ""}`}
          onClick={() => setSettingsOpen((value) => !value)}
          aria-expanded={settingsOpen}
        >
          <Icon name="bi-sliders" size={15} /> Настройка таблицы
        </button>
      </div>

      {settingsOpen ? (
        <div className="org-directory-column-panel org-directory-column-panel--configurable admin-transactions__column-panel">
          <div className="admin-transactions__column-panel-head">
            <span>Столбцы</span>
            <button type="button" onClick={resetColumnSettings}>Сброс</button>
          </div>
          <div className="admin-transactions__column-list">
            {orderedColumns.map((column, index) => {
              const checked = visibleColumns.includes(column.key);
              const disabled = checked && visibleColumns.length === 1;
              const label = column.label || "Действия";
              const dropPosition = dragColumnTarget?.key === column.key ? dragColumnTarget.position : "";

              return (
                <div
                  className={`admin-transactions__column-item ${disabled ? "is-disabled" : ""} ${dragColumnKey === column.key ? "is-dragging" : ""} ${dropPosition ? `is-drop-${dropPosition}` : ""}`}
                  key={column.key}
                  draggable
                  onDragStart={(event) => {
                    setDragColumnKey(column.key);
                    setDragColumnTarget(null);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", column.key);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const sourceKey = event.dataTransfer.getData("text/plain") || dragColumnKey;

                    if (!sourceKey || sourceKey === column.key) {
                      setDragColumnTarget(null);
                      return;
                    }

                    const rect = event.currentTarget.getBoundingClientRect();
                    const position = event.clientX - rect.left > rect.width / 2 ? "after" : "before";
                    setDragColumnTarget((current) => (
                      current?.key === column.key && current?.position === position
                        ? current
                        : { key: column.key, position }
                    ));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    moveColumnToDrop(
                      event.dataTransfer.getData("text/plain") || dragColumnKey,
                      column.key,
                      dragColumnTarget?.key === column.key ? dragColumnTarget.position : "before",
                    );
                    setDragColumnKey("");
                    setDragColumnTarget(null);
                  }}
                  onDragEnd={() => {
                    setDragColumnKey("");
                    setDragColumnTarget(null);
                  }}
                >
                  <label className="admin-transactions__column-toggle">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleColumn(column.key)}
                    />
                    <span>{label}</span>
                  </label>
                  <div className="admin-transactions__column-move" aria-label={`Порядок столбца ${label}`}>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveColumn(column.key, -1)}
                      aria-label={`Переместить ${label} левее`}
                    >
                      <Icon name="bi-chevron-left" size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={index === orderedColumns.length - 1}
                      onClick={() => moveColumn(column.key, 1)}
                      aria-label={`Переместить ${label} правее`}
                    >
                      <Icon name="bi-chevron-right" size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="org-directory-table-shell" onWheelCapture={keepWheelInsideScroller}>
        <table className={`org-directory-table org-directory-table--configurable ${actionsColumnIsLast ? "is-actions-sticky" : ""}`}>
          <colgroup>
            {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => (
                <th className={`org-directory-cell org-directory-cell--${column.key}`} key={column.key}>
                  {column.key === "actions" ? (
                    <span className="org-directory-actions-head" aria-hidden="true">
                      <Icon name="bi-sliders" size={15} />
                    </span>
                  ) : column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, rowIndex) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td className={`org-directory-cell org-directory-cell--${column.key}`} key={column.key}>{column.render(row, rowIndex)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!pageRows.length ? <div className="org-directory-empty">Записей не найдено.</div> : null}
      </div>

      <div className="org-directory-footer">
        <span className="org-directory-footer__summary">
          {filteredRows.length ? `${startIndex + 1}-${Math.min(startIndex + pageSize, filteredRows.length)} из ${filteredRows.length}` : "0 из 0"}
          <small>Страница {currentPage} из {totalPages}</small>
        </span>
        <div className="org-directory-pager">
          <AdminPageSizeDropdown value={pageSize} options={pageSizeOptions} onChange={setPageSize} />
          <button type="button" disabled={currentPage === 1} onClick={() => goToPage(1)} aria-label="Первая страница">
            <span className="org-directory-double-icon" aria-hidden="true">
              <Icon name="bi-chevron-left" size={13} />
              <Icon name="bi-chevron-left" size={13} />
            </span>
          </button>
          <button type="button" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)} aria-label="Предыдущая страница">
            <Icon name="bi-chevron-left" size={15} />
          </button>
          {pageList.map((item, index) => (
            item === "…" ? (
              <span className="org-directory-ellipsis" key={`gap-${index}`}>…</span>
            ) : (
              <button
                type="button"
                className={`org-directory-page-btn ${item === currentPage ? "is-active" : ""}`}
                key={item}
                onClick={() => goToPage(item)}
                aria-current={item === currentPage ? "page" : undefined}
              >
                {item}
              </button>
            )
          ))}
          <button type="button" disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)} aria-label="Следующая страница">
            <Icon name="bi-chevron-right" size={15} />
          </button>
          <button type="button" disabled={currentPage === totalPages} onClick={() => goToPage(totalPages)} aria-label="Последняя страница">
            <span className="org-directory-double-icon" aria-hidden="true">
              <Icon name="bi-chevron-right" size={13} />
              <Icon name="bi-chevron-right" size={13} />
            </span>
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

const ORG_STATUS_STORAGE_KEY = "marjon.admin.organization-statuses.v1";

function normalizeOrganizationStatusRow(row, index = 0) {
  const name = String(row?.name || "").trim();
  return {
    id: String(row?.id || `status-${Date.now()}-${index}`),
    name: name.toUpperCase(),
    sort: Number(row?.sort ?? row?.sort_order ?? index + 1) || index + 1,
    active: row?.active ?? row?.status !== false,
  };
}

function loadOrganizationStatusRows() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ORG_STATUS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.map(normalizeOrganizationStatusRow).filter((row) => row.name)
      : [];
  } catch {
    return [];
  }
}

function saveOrganizationStatusRows(rows) {
  try {
    localStorage.setItem(ORG_STATUS_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // localStorage can be unavailable in private mode; keep the in-memory state working.
  }
}

function mergeOrganizationStatusRows(localRows, remoteRows) {
  const byKey = new Map();

  [...remoteRows, ...localRows].forEach((row, index) => {
    const normalized = normalizeOrganizationStatusRow(row, index);
    if (!normalized.name) return;
    byKey.set(normalized.id || normalized.name, normalized);
  });

  return [...byKey.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

function OrganizationStatusPage({ search, onNotify }) {
  const [rows, setRows] = useState(loadOrganizationStatusRows);
  const [sortDirection, setSortDirection] = useState("asc");
  const [editor, setEditor] = useState(null);

  useEffect(() => {
    saveOrganizationStatusRows(rows);
  }, [rows]);

  useEffect(() => {
    adminApi.get("/organization-statuses", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (items.length) {
          const remoteRows = items.map((r, i) => ({
            id: r.id || String(i),
            name: r.name || "",
            sort: r.sort_order ?? r.sort ?? i + 1,
            active: r.status !== false,
          }));
          setRows((current) => mergeOrganizationStatusRows(current, remoteRows));
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
    setEditor(null);
    adminApi.get("/organization-statuses", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (!items.length) {
          onNotify?.("Backend вернул пустой список. Локальные статусы сохранены.");
          return;
        }

        const remoteRows = items.map((r, i) => ({
          id: r.id || String(i),
          name: r.name || "",
          sort: r.sort_order ?? r.sort ?? i + 1,
          active: r.status !== false,
        }));
        setRows((current) => mergeOrganizationStatusRows(current, remoteRows));
        onNotify?.("Список статусов обновлен без удаления локальных изменений.");
      })
      .catch(() => {
        onNotify?.("Backend недоступен. Локальные статусы сохранены.");
      });
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

function StorageIncomeDateControl({ range, onChange, presets }) {
  return (
    <div className="admin-storage-income-date-picker">
      <ReportDateRangePicker
        value={range}
        onChange={(nextRange) => onChange(normalizeAdminReportRange(nextRange))}
        buttonClassName="admin-storage-income-date-button"
        showTime={false}
        presets={presets}
        formatButtonLabel={formatAdminDashboardDateRangeButton}
        blockPageScrollOnWheel
        applyPresetOnSelect
        showMenuOk={false}
        leadingIconName="bi-calendar3"
        leadingIconSize={16}
      />
    </div>
  );
}

function StorageIncomePage({ search, onNotify, onInnerBackChange }) {
  const [range, setRange] = useState(() => buildAdminDashboardDateRange("Этот месяц"));
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [expandedIncomeRows, setExpandedIncomeRows] = useState(() => ({}));
  const query = search.trim().toLowerCase();
  const rows = storageIncomeBranchRows.filter((row) => !query || row.branch.toLowerCase().includes(query));
  const datePresets = useMemo(() => (
    ADMIN_DASHBOARD_DATE_PRESET_LABELS.map((label) => ({
      label,
      getRange: () => buildAdminDashboardDateRange(label),
    }))
  ), []);

  useEffect(() => {
    if (!onInnerBackChange) return undefined;

    if (!selectedBranch) {
      onInnerBackChange(null);
      return undefined;
    }

    onInnerBackChange(() => setSelectedBranch(null));
    return () => onInnerBackChange(null);
  }, [onInnerBackChange, selectedBranch]);

  function openBranch(row) {
    setSelectedBranch(row);
    onNotify?.(`${row.branch}: открыт экран прихода товаров.`);
  }

  function toggleIncomeDetailRow(rowId) {
    setExpandedIncomeRows((previous) => ({
      ...previous,
      [rowId]: !previous[rowId],
    }));
  }

  if (selectedBranch) {
    return (
      <section className="admin-storage-income-page admin-storage-income-page--detail">
        <div className="admin-storage-income-detail-card">
          <div className="admin-storage-income-detail-head">
            <div className="admin-storage-income-detail-title">
              <span aria-hidden="true" />
              <h2>Приход товаров</h2>
            </div>
            <StorageIncomeDateControl range={range} onChange={setRange} presets={datePresets} />
          </div>

          <div className="admin-storage-income-detail-table-wrap">
            <table className="admin-storage-income-detail-table">
              <thead>
                <tr>
                  <th>Названия</th>
                  <th>Кол-во</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {storageIncomeDetailRows.map((row) => {
                  const isCategory = Array.isArray(row.children);
                  const hasChildren = Boolean(row.children?.length);
                  const isOpen = Boolean(expandedIncomeRows[row.id]);

                  return (
                    <Fragment key={row.id}>
                      <tr className={`is-${row.tone}${isCategory ? " is-expandable" : ""}${isOpen ? " is-open" : ""}`}>
                        <td>
                          {isCategory ? (
                            <button
                              type="button"
                              className="admin-storage-income-detail-toggle"
                              onClick={() => hasChildren && toggleIncomeDetailRow(row.id)}
                              disabled={!hasChildren}
                              aria-expanded={hasChildren ? isOpen : undefined}
                            >
                              <Icon name={isOpen ? "bi-chevron-down" : "bi-chevron-right"} size={14} />
                              <span>{row.name}</span>
                            </button>
                          ) : row.name}
                        </td>
                        <td>{row.quantity}</td>
                        <td>{formatCurrency(row.amount)}</td>
                      </tr>
                      {isOpen ? row.children.map((child, childIndex) => (
                        <tr className="is-child" key={child.id}>
                          <td>
                            <span className="admin-storage-income-detail-child-name">
                              {childIndex + 1}. {child.name}
                            </span>
                          </td>
                          <td>{child.quantity}</td>
                          <td>{formatCurrency(child.amount)}</td>
                        </tr>
                      )) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-storage-income-page">
      <div className="admin-storage-income-head">
        <StorageIncomeDateControl range={range} onChange={setRange} presets={datePresets} />
        <h2>Приход товаров</h2>
      </div>

      <div className="admin-storage-income-branch-card">
        <table className="admin-storage-income-branch-table">
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
                <td colSpan="4" className="admin-storage-income-empty">Филиал не найден.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StorageIncomeJournalPage({ search, onNotify, onInnerBackChange }) {
  const [rows, setRows] = useState(() => storageIncomeJournalRows);
  const [selectedRow, setSelectedRow] = useState(null);
  const [detailSearch, setDetailSearch] = useState("");
  const [sortState, setSortState] = useState({ key: "number", direction: "desc" });
  const query = search.trim().toLowerCase();

  const columns = [
    { key: "number", label: "Номер", sortable: true },
    { key: "supplier", label: "Поставщик", sortable: false },
    { key: "warehouse", label: "На склад", sortable: false },
    { key: "incomingDate", label: "Дата поступление", sortable: true },
    { key: "registeredAt", label: "Дата регистрации", sortable: false },
    { key: "acceptedAt", label: "Дата приема", sortable: false },
    { key: "itemCount", label: "Кол-во наименование", sortable: true },
    { key: "total", label: "Итоговая сумма", sortable: true },
    { key: "status", label: "Статус", sortable: true },
    { key: "actions", label: "", sortable: false },
  ];

  useEffect(() => {
    if (!onInnerBackChange) return undefined;

    if (!selectedRow) {
      onInnerBackChange(null);
      return undefined;
    }

    onInnerBackChange(() => setSelectedRow(null));
    return () => onInnerBackChange(null);
  }, [onInnerBackChange, selectedRow]);

  const filteredRows = useMemo(() => {
    const nextRows = rows.filter((row) => {
      if (!query) return true;
      return [
        row.number,
        row.supplier,
        row.warehouse,
        row.incomingDate,
        row.registeredAt,
        row.registeredBy,
        row.acceptedAt,
        row.acceptedBy,
        row.status,
        row.comment,
        ...row.items.map((item) => item.name),
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });

    const direction = sortState.direction === "asc" ? 1 : -1;
    return [...nextRows].sort((a, b) => {
      const first = getJournalSortValue(a, sortState.key);
      const second = getJournalSortValue(b, sortState.key);
      if (first > second) return direction;
      if (first < second) return -direction;
      return 0;
    });
  }, [query, rows, sortState]);

  const detailItems = useMemo(() => {
    if (!selectedRow) return [];
    const detailQuery = detailSearch.trim().toLowerCase();
    if (!detailQuery) return selectedRow.items;
    return selectedRow.items.filter((item) => item.name.toLowerCase().includes(detailQuery));
  }, [detailSearch, selectedRow]);

  function getJournalSortValue(row, key) {
    if (key === "total" || key === "itemCount") return Number(row[key] || 0);
    return String(row[key] || "").toLowerCase();
  }

  function changeSort(column) {
    if (!column.sortable) return;
    setSortState((current) => (
      current.key === column.key
        ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key: column.key, direction: "asc" }
    ));
  }

  function openRow(row) {
    setSelectedRow(row);
    setDetailSearch("");
    onNotify?.(`Поступление №${row.number}: открыта подробная информация.`);
  }

  function deleteRow(row) {
    setRows((current) => current.filter((item) => item.id !== row.id));
    if (selectedRow?.id === row.id) setSelectedRow(null);
    onNotify?.(`Поступление №${row.number}: строка удалена локально.`);
  }

  function renderDateCell(value, actor) {
    return (
      <span className="admin-storage-income-journal-date-cell">
        <span>{value || "-"}</span>
        {actor ? <small>{actor}</small> : null}
      </span>
    );
  }

  if (selectedRow) {
    return (
      <section className="admin-storage-income-page admin-storage-income-journal-page admin-storage-income-journal-page--detail">
        <div className="admin-storage-income-journal-detail-layout">
          <aside className="admin-storage-income-journal-summary">
            <div className="admin-storage-income-journal-total">
              <span>Всего</span>
              <strong>{formatCurrency(selectedRow.total)}</strong>
            </div>
            <div className="admin-storage-income-journal-info">
              <dl>
                <div>
                  <dt>Статус</dt>
                  <dd><span className="admin-storage-income-journal-status">{selectedRow.status}</span></dd>
                </div>
                <div>
                  <dt>Номер договора</dt>
                  <dd>{selectedRow.contractNumber}</dd>
                </div>
                <div>
                  <dt>Дата прихода</dt>
                  <dd>{selectedRow.incomingDate}</dd>
                </div>
                <div>
                  <dt>Поставщик</dt>
                  <dd>{selectedRow.supplier}</dd>
                </div>
                <div>
                  <dt>Склад</dt>
                  <dd>{selectedRow.warehouse}</dd>
                </div>
                <div>
                  <dt>Комментария</dt>
                  <dd>{selectedRow.comment}</dd>
                </div>
              </dl>
            </div>
          </aside>

          <article className="admin-storage-income-journal-detail-card">
            <div className="admin-storage-income-journal-detail-toolbar">
              <button type="button" className="admin-storage-income-journal-selected-tab">
                Выбранное ({selectedRow.items.length})
              </button>
              <label className="admin-storage-income-journal-search">
                <Icon name="bi-search" size={15} />
                <input
                  type="search"
                  value={detailSearch}
                  onChange={(event) => setDetailSearch(event.target.value)}
                  placeholder="Поиск"
                  aria-label="Поиск по товарам поступления"
                />
              </label>
            </div>

            <div className="admin-storage-income-journal-detail-table-wrap">
              <table className="admin-storage-income-journal-detail-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Названия</th>
                    <th>Цена</th>
                    <th>Кол-во</th>
                    <th>Отход</th>
                    <th>Остаток</th>
                    <th>Итоговая сумма</th>
                    <th aria-label="Просмотр" />
                    <th aria-label="Отход" />
                  </tr>
                </thead>
                <tbody>
                  {detailItems.map((item, index) => (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td><strong>{item.name}</strong></td>
                      <td>{formatCurrency(item.price)}</td>
                      <td>{item.quantity}</td>
                      <td>{item.waste}</td>
                      <td>{item.balance}</td>
                      <td>{formatCurrency(item.total)}</td>
                      <td>
                        <button
                          type="button"
                          className="admin-storage-income-journal-icon-button is-view"
                          onClick={() => onNotify?.(`${item.name}: просмотр товара.`)}
                          aria-label={`Просмотреть ${item.name}`}
                        >
                          <Icon name="bi-eye" size={15} />
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="admin-storage-income-journal-waste-button"
                          onClick={() => onNotify?.(`${item.name}: открыта функция отхода.`)}
                        >
                          Отход
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!detailItems.length ? (
                    <tr>
                      <td colSpan="9" className="admin-storage-income-empty">Товар не найден.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-storage-income-page admin-storage-income-journal-page">
      <div className="admin-storage-income-journal-head">
        <div className="admin-storage-income-journal-title">
          <span aria-hidden="true" />
          <h2>Поступление товаров</h2>
        </div>
        <button
          type="button"
          className="admin-storage-income-journal-create"
          onClick={() => onNotify?.("Создание поступления: форма будет подключена к API.")}
        >
          <span>Создать</span>
          <Icon name="bi-plus" size={15} />
        </button>
      </div>

      <div className="admin-storage-income-journal-table-card">
        <table className="admin-storage-income-journal-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => changeSort(column)}
                      className={sortState.key === column.key ? "is-active" : ""}
                    >
                      <span>{column.label}</span>
                      <span className={`admin-storage-income-journal-sort ${sortState.key === column.key ? `is-${sortState.direction}` : ""}`} aria-hidden="true" />
                    </button>
                  ) : column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id} onClick={() => openRow(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openRow(row); }}>
                <td>{row.number}</td>
                <td>{row.supplier}</td>
                <td>{row.warehouse}</td>
                <td>{row.incomingDate}</td>
                <td>{renderDateCell(row.registeredAt, row.registeredBy)}</td>
                <td>{renderDateCell(row.acceptedAt, row.acceptedBy)}</td>
                <td>{row.itemCount}</td>
                <td>{formatCurrency(row.total)}</td>
                <td><span className="admin-storage-income-journal-status">{row.status}</span></td>
                <td>
                  <div className="admin-storage-income-journal-actions">
                    <button
                      type="button"
                      className="admin-storage-income-journal-icon-button is-view"
                      onClick={(event) => { event.stopPropagation(); openRow(row); }}
                      aria-label={`Открыть поступление ${row.number}`}
                    >
                      <Icon name="bi-eye" size={15} />
                    </button>
                    <button
                      type="button"
                      className="admin-storage-income-journal-icon-button is-delete"
                      onClick={(event) => { event.stopPropagation(); deleteRow(row); }}
                      aria-label={`Удалить поступление ${row.number}`}
                    >
                      <Icon name="bi-trash3" size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!filteredRows.length ? (
              <tr>
                <td colSpan={columns.length} className="admin-storage-income-empty">Поступления не найдены.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StorageWriteoffPage({ search, onNotify }) {
  const [rows, setRows] = useState(() => storageWriteoffRows);
  const [sortState, setSortState] = useState({ key: "number", direction: "desc" });
  const query = search.trim().toLowerCase();
  const columns = [
    { key: "number", label: "Номер", sortable: true },
    { key: "supplier", label: "Поставщик", sortable: false },
    { key: "warehouse", label: "На склад", sortable: false },
    { key: "incomingDate", label: "Дата поступление", sortable: true },
    { key: "registeredAt", label: "Дата регистрации", sortable: false },
    { key: "acceptedAt", label: "Дата приема", sortable: false },
    { key: "itemCount", label: "Кол-во наименование", sortable: true },
    { key: "total", label: "Итоговая сумма", sortable: true },
    { key: "status", label: "Статус", sortable: true },
  ];

  useEffect(() => {
    adminApi.get("/reports/consumption", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (!items.length) {
          setRows(storageWriteoffRows);
          return;
        }

        setRows(items.map((row, index) => normalizeStorageWriteoffRow(row, index)));
      })
      .catch(() => {});
  }, []);

  const filteredRows = useMemo(() => {
    const nextRows = rows.filter((row) => {
      if (!query) return true;
      return [
        row.number,
        row.supplier,
        row.warehouse,
        row.incomingDate,
        row.registeredAt,
        row.acceptedAt,
        row.itemCount,
        row.total,
        row.status,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });

    const direction = sortState.direction === "asc" ? 1 : -1;
    return [...nextRows].sort((a, b) => {
      const first = getStorageWriteoffSortValue(a, sortState.key);
      const second = getStorageWriteoffSortValue(b, sortState.key);
      if (first > second) return direction;
      if (first < second) return -direction;
      return 0;
    });
  }, [query, rows, sortState]);

  function normalizeStorageWriteoffRow(row, index) {
    return {
      id: String(row.id || row.document_number || `writeoff-${index}`),
      number: String(row.document_number || row.number || row.id || `WO-${index + 1}`),
      supplier: row.provider_name || row.supplier || row.reason || "—",
      warehouse: row.warehouse || row.storage_name || row.to_storage || "Главный склад",
      incomingDate: row.date || row.incoming_date || row.created_date || "—",
      registeredAt: row.registered_at || row.created_at || "—",
      acceptedAt: row.accepted_at || row.completed_at || row.updated_at || "—",
      itemCount: Number(row.items_count || row.item_count || row.quantity || 0),
      total: Number(row.total || row.amount || 0),
      status: row.status || "принято",
    };
  }

  function getStorageWriteoffSortValue(row, key) {
    if (key === "total" || key === "itemCount") return Number(row[key] || 0);
    return String(row[key] || "").toLowerCase();
  }

  function changeSort(column) {
    if (!column.sortable) return;
    setSortState((current) => (
      current.key === column.key
        ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key: column.key, direction: "asc" }
    ));
  }

  function openRow(row) {
    onNotify?.(`Отход товаров №${row.number}: подробная карточка будет подключена к API.`);
  }

  return (
    <section className="admin-storage-income-page admin-storage-writeoff-page">
      <div className="admin-storage-writeoff-card">
        <div className="admin-storage-writeoff-head">
          <div className="admin-storage-writeoff-title">
            <span aria-hidden="true" />
            <h2>Отход товаров</h2>
          </div>
        </div>

        <div className="admin-storage-writeoff-table-wrap">
          <table className="admin-storage-writeoff-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key}>
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => changeSort(column)}
                        className={sortState.key === column.key ? "is-active" : ""}
                      >
                        <span>{column.label}</span>
                        <span className={`admin-storage-income-journal-sort ${sortState.key === column.key ? `is-${sortState.direction}` : ""}`} aria-hidden="true" />
                      </button>
                    ) : column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} onClick={() => openRow(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openRow(row); }}>
                  <td>{row.number}</td>
                  <td>{row.supplier}</td>
                  <td>{row.warehouse}</td>
                  <td>{row.incomingDate}</td>
                  <td>{row.registeredAt}</td>
                  <td>{row.acceptedAt}</td>
                  <td>{row.itemCount}</td>
                  <td>{formatCurrency(row.total)}</td>
                  <td><span className="admin-storage-income-journal-status">{row.status}</span></td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr className="admin-storage-writeoff-empty-row">
                  <td colSpan={columns.length}>
                    <div className="admin-storage-writeoff-empty">
                      <div className="admin-storage-writeoff-empty-illustration" aria-hidden="true">
                        <svg viewBox="0 0 80 86" focusable="false">
                          <rect x="8" y="22" width="44" height="56" rx="7" />
                          <rect x="16" y="14" width="44" height="56" rx="7" />
                          <path d="M28 6h31l13 13v39a7 7 0 0 1-7 7H28a7 7 0 0 1-7-7V13a7 7 0 0 1 7-7Z" />
                          <path className="admin-storage-writeoff-empty-fold" d="M59 6v13h13" />
                        </svg>
                      </div>
                      <strong>Список пуст</strong>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function StorageInventoryPage({ search, onNotify, onInnerBackChange }) {
  const [rows, setRows] = useState(() => storageInventoryRows);
  const [selectedRow, setSelectedRow] = useState(null);
  const [sortState, setSortState] = useState({ key: "id", direction: "desc" });
  const query = search.trim().toLowerCase();
  const columns = [
    { key: "id", label: "ID", sortable: true },
    { key: "registeredAt", label: "Дата регистрации", sortable: true },
    { key: "warehouse", label: "Склад", sortable: false },
    { key: "comment", label: "Комментарие", sortable: false },
    { key: "type", label: "Тип", sortable: false },
    { key: "status", label: "Статус", sortable: true },
    { key: "actions", label: "", sortable: false },
  ];

  useEffect(() => {
    if (ADMIN_DASHBOARD_DEMO_MODE) return;

    adminApi.get("/storages", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (!items.length) {
          setRows(storageInventoryRows);
          return;
        }

        setRows(items.map((row, index) => normalizeStorageInventoryRow(row, index)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!onInnerBackChange) return undefined;

    if (!selectedRow) {
      onInnerBackChange(null);
      return undefined;
    }

    onInnerBackChange(() => setSelectedRow(null));
    return () => onInnerBackChange(null);
  }, [onInnerBackChange, selectedRow]);

  useEffect(() => {
    if (!selectedRow) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") setSelectedRow(null);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedRow]);

  const filteredRows = useMemo(() => {
    const nextRows = rows.filter((row) => {
      if (!query) return true;
      return [
        row.id,
        row.registeredAt,
        row.registeredBy,
        row.warehouse,
        row.comment,
        row.type,
        row.status,
        ...row.items.map((item) => item.name),
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });

    const direction = sortState.direction === "asc" ? 1 : -1;
    return [...nextRows].sort((a, b) => {
      const first = getStorageInventorySortValue(a, sortState.key);
      const second = getStorageInventorySortValue(b, sortState.key);
      if (first > second) return direction;
      if (first < second) return -direction;
      return 0;
    });
  }, [query, rows, sortState]);

  function normalizeStorageInventoryRow(row, index) {
    const items = Array.isArray(row.items) ? row.items : Array.isArray(row.products) ? row.products : [];
    return {
      id: String(row.id || row.document_number || row.number || index + 1),
      registeredAt: row.registered_at || row.created_at || row.date || "—",
      registeredBy: row.registered_by || row.created_by || row.user_name || row.manager || "",
      warehouse: row.warehouse || row.storage_name || row.name || "Главный склад",
      comment: row.comment || row.description || row.note || "-",
      type: row.type || row.operation_type || "Приход и расход учтены",
      status: row.status || "принято",
      items: items.map((item, itemIndex) => ({
        id: String(item.id || `${row.id || index}-${itemIndex}`),
        name: item.name || item.product_name || item.title || "—",
        quantity: formatInventoryQuantity(item.quantity ?? item.diff ?? item.balance_delta ?? 0),
        unit: item.unit || item.unit_name || "Штук (шт)",
      })),
    };
  }

  function formatInventoryQuantity(value) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return `+ ${number.toLocaleString("ru-RU")}`;
    if (Number.isFinite(number)) return number.toLocaleString("ru-RU");
    return String(value || "0");
  }

  function getStorageInventorySortValue(row, key) {
    if (key === "id") return Number(row.id) || row.id;
    return String(row[key] || "").toLowerCase();
  }

  function changeSort(column) {
    if (!column.sortable) return;
    setSortState((current) => (
      current.key === column.key
        ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key: column.key, direction: "asc" }
    ));
  }

  function openInventory(row) {
    setSelectedRow(row);
    onNotify?.(`Инвентаризация ${row.id}: открыт список товаров.`);
  }

  function downloadInventory(row) {
    const csv = [
      ["Название", "Кол-во", "Ед. изм"],
      ...row.items.map((item) => [item.name, item.quantity, item.unit]),
    ].map((csvRow) => csvRow.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `marjon-inventory-${row.id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    onNotify?.(`Инвентаризация ${row.id}: список скачан.`);
  }

  return (
    <section className="admin-storage-income-page admin-storage-inventory-page">
      <div className="admin-storage-inventory-card">
        <div className="admin-storage-inventory-head">
          <div className="admin-storage-inventory-title">
            <span aria-hidden="true" />
            <h2>Инвентаризация</h2>
          </div>
          <button
            type="button"
            className="admin-storage-inventory-create"
            onClick={() => onNotify?.("Создание инвентаризации: форма будет подключена к API.")}
          >
            <span>Создать</span>
            <Icon name="bi-plus" size={15} />
          </button>
        </div>

        <div className="admin-storage-inventory-table-wrap">
          <table className="admin-storage-inventory-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key}>
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => changeSort(column)}
                        className={sortState.key === column.key ? "is-active" : ""}
                      >
                        <span>{column.label}</span>
                        <span className={`admin-storage-income-journal-sort ${sortState.key === column.key ? `is-${sortState.direction}` : ""}`} aria-hidden="true" />
                      </button>
                    ) : column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} onClick={() => openInventory(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openInventory(row); }}>
                  <td>{row.id}</td>
                  <td>
                    <span className="admin-storage-inventory-date-cell">
                      <span>{row.registeredAt}</span>
                      {row.registeredBy ? <small>{row.registeredBy}</small> : null}
                    </span>
                  </td>
                  <td>{row.warehouse}</td>
                  <td>{row.comment}</td>
                  <td>{row.type}</td>
                  <td><span className="admin-storage-income-journal-status">{row.status}</span></td>
                  <td>
                    <button
                      type="button"
                      className="admin-storage-inventory-edit"
                      onClick={(event) => { event.stopPropagation(); openInventory(row); }}
                      aria-label={`Открыть инвентаризацию ${row.id}`}
                    >
                      <Icon name="bi-pencil" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr className="admin-storage-inventory-empty-row">
                  <td colSpan={columns.length}>Инвентаризации не найдены.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRow ? createPortal((
        <div className="admin-storage-inventory-modal" role="presentation" onMouseDown={() => setSelectedRow(null)}>
          <div
            className="admin-storage-inventory-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Список инвентаризации ${selectedRow.id}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="admin-storage-inventory-dialog-head">
              <h3>Список</h3>
              <button type="button" onClick={() => setSelectedRow(null)} aria-label="Закрыть список">
                <Icon name="bi-x-lg" size={17} />
              </button>
            </div>

            <div className="admin-storage-inventory-dialog-body">
              <div className="admin-storage-inventory-dialog-actions">
                <button type="button" onClick={() => downloadInventory(selectedRow)}>
                  <Icon name="bi-file-earmark-spreadsheet" size={18} />
                  <span>Скачать</span>
                </button>
              </div>

              <table className="admin-storage-inventory-list-table">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Кол-во</th>
                    <th>Ед. изм</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRow.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td className="is-positive">{item.quantity}</td>
                      <td>{item.unit}</td>
                    </tr>
                  ))}
                  {!selectedRow.items.length ? (
                    <tr>
                      <td colSpan="3" className="admin-storage-inventory-list-empty">Список пуст</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </section>
  );
}

function StorageExpensePage({ search, onNotify, onInnerBackChange }) {
  const [range, setRange] = useState(() => buildAdminDashboardDateRange("Этот месяц"));
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [expandedExpenseRows, setExpandedExpenseRows] = useState(() => ({}));
  const query = search.trim().toLowerCase();
  const rows = storageExpenseBranchRows.filter((row) => !query || row.branch.toLowerCase().includes(query));
  const datePresets = useMemo(() => (
    ADMIN_DASHBOARD_DATE_PRESET_LABELS.map((label) => ({
      label,
      getRange: () => buildAdminDashboardDateRange(label),
    }))
  ), []);

  useEffect(() => {
    if (!onInnerBackChange) return undefined;

    if (!selectedBranch) {
      onInnerBackChange(null);
      return undefined;
    }

    onInnerBackChange(() => setSelectedBranch(null));
    return () => onInnerBackChange(null);
  }, [onInnerBackChange, selectedBranch]);

  function openBranch(row) {
    setSelectedBranch(row);
    onNotify?.(`${row.branch}: открыт экран расхода товаров.`);
  }

  function toggleExpenseDetailRow(rowId) {
    setExpandedExpenseRows((previous) => ({
      ...previous,
      [rowId]: !previous[rowId],
    }));
  }

  if (selectedBranch) {
    return (
      <section className="admin-storage-income-page admin-storage-income-page--detail admin-storage-expense-page--detail">
        <div className="admin-storage-income-detail-card">
          <div className="admin-storage-income-detail-head">
            <div className="admin-storage-income-detail-title">
              <span aria-hidden="true" />
              <h2>Расход товаров</h2>
            </div>
            <StorageIncomeDateControl range={range} onChange={setRange} presets={datePresets} />
          </div>

          <div className="admin-storage-income-detail-table-wrap">
            <table className="admin-storage-income-detail-table">
              <thead>
                <tr>
                  <th>Названия</th>
                  <th>Кол-во</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {storageExpenseDetailRows.map((row) => {
                  const isCategory = Array.isArray(row.children);
                  const hasChildren = Boolean(row.children?.length);
                  const isOpen = Boolean(expandedExpenseRows[row.id]);

                  return (
                    <Fragment key={row.id}>
                      <tr className={`is-${row.tone}${isCategory ? " is-expandable" : ""}${isOpen ? " is-open" : ""}`}>
                        <td>
                          {isCategory ? (
                            <button
                              type="button"
                              className="admin-storage-income-detail-toggle"
                              onClick={() => hasChildren && toggleExpenseDetailRow(row.id)}
                              disabled={!hasChildren}
                              aria-expanded={hasChildren ? isOpen : undefined}
                            >
                              <Icon name={isOpen ? "bi-chevron-down" : "bi-chevron-right"} size={14} />
                              <span>{row.name}</span>
                            </button>
                          ) : row.name}
                        </td>
                        <td>{row.quantity}</td>
                        <td>{formatCurrency(row.amount)}</td>
                      </tr>
                      {isOpen ? row.children.map((child, childIndex) => (
                        <tr className="is-child" key={child.id}>
                          <td>
                            <span className="admin-storage-income-detail-child-name">
                              {childIndex + 1}. {child.name}
                            </span>
                          </td>
                          <td>{child.quantity}</td>
                          <td>{formatCurrency(child.amount)}</td>
                        </tr>
                      )) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-storage-income-page admin-storage-expense-page">
      <div className="admin-storage-income-head">
        <StorageIncomeDateControl range={range} onChange={setRange} presets={datePresets} />
        <h2>Расход товаров</h2>
      </div>

      <div className="admin-storage-income-branch-card">
        <table className="admin-storage-income-branch-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Филиал</th>
              <th>Расход</th>
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
                <td>{formatCurrency(row.expense)}</td>
                <td>{formatCurrency(row.inventory)}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan="4" className="admin-storage-income-empty">Филиал не найден.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StorageBalancePage({ search, onNotify, onInnerBackChange }) {
  const [range, setRange] = useState(() => buildAdminDashboardDateRange("Этот месяц"));
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [expandedBalanceRows, setExpandedBalanceRows] = useState(() => ({}));
  const query = search.trim().toLowerCase();
  const rows = storageBalanceBranchRows.filter((row) => !query || row.branch.toLowerCase().includes(query));
  const datePresets = useMemo(() => (
    ADMIN_DASHBOARD_DATE_PRESET_LABELS.map((label) => ({
      label,
      getRange: () => buildAdminDashboardDateRange(label),
    }))
  ), []);

  useEffect(() => {
    if (!onInnerBackChange) return undefined;

    if (!selectedBranch) {
      onInnerBackChange(null);
      return undefined;
    }

    onInnerBackChange(() => setSelectedBranch(null));
    return () => onInnerBackChange(null);
  }, [onInnerBackChange, selectedBranch]);

  function openBranch(row) {
    setSelectedBranch(row);
    onNotify?.(`${row.branch}: открыт экран остатка.`);
  }

  function toggleBalanceDetailRow(rowId) {
    setExpandedBalanceRows((previous) => ({
      ...previous,
      [rowId]: !previous[rowId],
    }));
  }

  if (selectedBranch) {
    return (
      <section className="admin-storage-income-page admin-storage-income-page--detail admin-storage-balance-page--detail">
        <div className="admin-storage-income-detail-card admin-storage-balance-detail-card">
          <div className="admin-storage-balance-toolbar">
            <button type="button" className="admin-storage-balance-tab">Остаток</button>
            <select className="admin-storage-balance-cashier" defaultValue="" aria-label="Выберите кассир">
              <option value="">Выберите кассир</option>
            </select>
          </div>

          <div className="admin-storage-income-detail-table-wrap">
            <table className="admin-storage-income-detail-table admin-storage-balance-detail-table">
              <thead>
                <tr>
                  <th>Названия</th>
                  <th>Остаток</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {storageBalanceDetailRows.map((row) => {
                  const isCategory = Array.isArray(row.children);
                  const hasChildren = Boolean(row.children?.length);
                  const isOpen = Boolean(expandedBalanceRows[row.id]);

                  return (
                    <Fragment key={row.id}>
                      <tr className={`is-${row.tone}${isCategory ? " is-expandable" : ""}${isOpen ? " is-open" : ""}`}>
                        <td>
                          {isCategory ? (
                            <button
                              type="button"
                              className="admin-storage-income-detail-toggle"
                              onClick={() => hasChildren && toggleBalanceDetailRow(row.id)}
                              disabled={!hasChildren}
                              aria-expanded={hasChildren ? isOpen : undefined}
                            >
                              <Icon name={isOpen ? "bi-chevron-down" : "bi-chevron-right"} size={14} />
                              <span>{row.name}</span>
                            </button>
                          ) : row.name}
                        </td>
                        <td>{row.quantity}</td>
                        <td>{formatCurrency(row.amount)}</td>
                      </tr>
                      {isOpen ? row.children.map((child, childIndex) => (
                        <tr className="is-child" key={child.id}>
                          <td>
                            <span className="admin-storage-income-detail-child-name">
                              {childIndex + 1}. {child.name}
                            </span>
                          </td>
                          <td>{child.quantity}</td>
                          <td>{formatCurrency(child.amount)}</td>
                        </tr>
                      )) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-storage-income-page admin-storage-balance-page">
      <div className="admin-storage-income-head">
        <StorageIncomeDateControl range={range} onChange={setRange} presets={datePresets} />
        <h2>Остаток</h2>
      </div>

      <div className="admin-storage-income-branch-card">
        <table className="admin-storage-income-branch-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Филиал</th>
              <th>Остаток</th>
              <th>Сумма</th>
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
                <td>{row.balance}</td>
                <td>{formatCurrency(row.amount)}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan="4" className="admin-storage-income-empty">Филиал не найден.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProductNomenclaturePage({ search, onNotify }) {
  const [rows, setRows] = useState(() => readStoredAdminProducts() || adminProductRows);
  const [nameFilter, setNameFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");
  const [showArchive, setShowArchive] = useState(false);
  const [editor, setEditor] = useState(null);
  const hasStoredRowsRef = useRef(readStoredAdminProducts() !== null);
  const query = search.trim().toLowerCase();

  useEffect(() => {
    if (hasStoredRowsRef.current) return;

    adminApi.get("/products", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        if (items.length) {
          setRows(items.map(normalizeAdminProduct));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    saveStoredAdminProducts(rows);
  }, [rows]);

  const categoryOptions = useMemo(() => {
    const values = rows.map((row) => row.category).filter(Boolean);
    return Array.from(new Set([...adminProductCategories, ...values]));
  }, [rows]);

  const visibleRows = useMemo(() => {
    const filterText = nameFilter.trim().toLowerCase();

    return rows
      .filter((row) => Boolean(row.archived) === showArchive)
      .filter((row) => {
        const haystack = `${row.name} ${row.category} ${row.unit}`.toLowerCase();
        return !query || haystack.includes(query);
      })
      .filter((row) => !filterText || row.name.toLowerCase().includes(filterText))
      .filter((row) => !categoryFilter || row.category === categoryFilter)
      .sort((a, b) => {
        const result = a.name.localeCompare(b.name, "ru", { sensitivity: "base" });
        return sortDirection === "asc" ? result : -result;
      });
  }, [rows, showArchive, query, nameFilter, categoryFilter, sortDirection]);

  function updateEditor(field, value) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function openAddProduct() {
    setEditor(createAdminProductDraft());
  }

  function openEditProduct(row) {
    setEditor(createAdminProductDraft(row));
  }

  function closeEditor() {
    setEditor(null);
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => updateEditor("photo", String(reader.result || ""));
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function saveProduct(event) {
    event.preventDefault();
    if (!editor) return;

    const name = editor.name.trim();
    if (!name) return;

    const nextProduct = {
      ...editor,
      id: editor.id || `product-${Date.now()}`,
      name,
      price: Number(String(editor.price).replace(/\s/g, "").replace(",", ".")) || 0,
      archived: Boolean(editor.archived),
    };

    setRows((current) => {
      const exists = current.some((row) => row.id === nextProduct.id);
      return exists
        ? current.map((row) => row.id === nextProduct.id ? nextProduct : row)
        : [nextProduct, ...current];
    });
    setShowArchive(Boolean(nextProduct.archived));
    closeEditor();
    onNotify?.("Продукт сохранён.");
  }

  function archiveProduct(row) {
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, archived: true } : item));
    onNotify?.(`${row.name} перемещён в архив.`);
  }

  function restoreProduct(row) {
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, archived: false } : item));
    onNotify?.(`${row.name} возвращён в список.`);
  }

  function clearFilters() {
    setNameFilter("");
    setCategoryFilter("");
  }

  const drawer = editor ? createPortal(
    <div className="admin-product-drawer" role="dialog" aria-modal="true" aria-label="Карточка продукта">
      <button type="button" className="admin-product-drawer__shade" onClick={closeEditor} aria-label="Закрыть форму" />
      <form className="admin-product-panel" onSubmit={saveProduct}>
        <div className="admin-product-panel__body">
          <label className="admin-product-photo-upload">
            <input type="file" accept="image/*" onChange={handlePhotoChange} />
            {editor.photo ? (
              <img src={editor.photo} alt="" />
            ) : (
              <>
                <Icon name="bi-image" size={18} />
                <span>Загрузить фото</span>
              </>
            )}
          </label>

          <label className="admin-product-field admin-product-field--wide">
            <span>Склад для расхода</span>
            <select value={editor.warehouse} onChange={(event) => updateEditor("warehouse", event.target.value)}>
              {adminProductWarehouses.map((warehouse) => (
                <option value={warehouse} key={warehouse}>{warehouse}</option>
              ))}
            </select>
          </label>

          <label className="admin-product-field admin-product-field--wide">
            <span>Название <b>*</b></span>
            <input value={editor.name} onChange={(event) => updateEditor("name", event.target.value)} required />
          </label>

          <label className="admin-product-field admin-product-field--wide">
            <span>Цена <b>*</b></span>
            <input
              inputMode="numeric"
              value={editor.price}
              onChange={(event) => updateEditor("price", event.target.value)}
              required
            />
          </label>

          <div className="admin-product-form-grid">
            <label className="admin-product-field">
              <span>Категория товара</span>
              <select value={editor.category} onChange={(event) => updateEditor("category", event.target.value)}>
                {categoryOptions.map((category) => (
                  <option value={category} key={category}>{category}</option>
                ))}
              </select>
            </label>

            <div className="admin-product-status-field">
              <span>Статус</span>
              <button
                type="button"
                className={`admin-product-switch ${editor.status === "active" ? "is-on" : ""}`}
                onClick={() => updateEditor("status", editor.status === "active" ? "inactive" : "active")}
                aria-pressed={editor.status === "active"}
              >
                <span />
              </button>
            </div>
          </div>

          <div className="admin-product-unit-field">
            <span>Выберите единицу измерения <b>*</b></span>
            <div>
              {adminProductUnits.map((unit) => (
                <button
                  type="button"
                  className={editor.unit === unit ? "is-selected" : ""}
                  onClick={() => updateEditor("unit", unit)}
                  key={unit}
                >
                  {unit}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="admin-product-panel__footer">
          <button type="button" onClick={closeEditor}>Отменить</button>
          <button type="submit">Сохранить</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <section className="admin-product-page">
      <div className="admin-product-card">
        <div className="admin-product-toolbar">
          <div className="admin-product-title">
            <span className="admin-product-title-mark" aria-hidden="true" />
            <h2>Список продуктов</h2>
            <button type="button" className="admin-product-archive-link" onClick={() => setShowArchive((value) => !value)}>
              <Icon name="bi-trash3" size={13} />
              <span>{showArchive ? "Вернуться к списку" : "Перейти к архив"}</span>
            </button>
          </div>

          <button type="button" className="admin-product-add" onClick={openAddProduct}>
            <span>Добавить</span>
            <Icon name="bi-plus" size={15} />
          </button>
        </div>

        <div className="admin-product-table-shell">
          <table className="admin-product-table">
            <thead>
              <tr>
                <th>Фото</th>
                <th>
                  <button type="button" className="admin-product-sort" onClick={() => setSortDirection((value) => value === "asc" ? "desc" : "asc")}>
                    <span>Название</span>
                    <i className={`admin-product-sort__icon is-${sortDirection}`} aria-hidden="true" />
                  </button>
                </th>
                <th>Категория</th>
                <th>Цена</th>
                <th>Ед. изм</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr className="admin-product-filter-row">
                <td />
                <td>
                  <input value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} placeholder="Введите" />
                </td>
                <td>
                  <label className="admin-product-filter-select">
                    <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                      <option value="">Выберите</option>
                      {categoryOptions.map((category) => (
                        <option value={category} key={category}>{category}</option>
                      ))}
                    </select>
                    <Icon name="bi-chevron-down" size={15} />
                  </label>
                </td>
                <td />
                <td />
                <td />
                <td>
                  <button type="button" className="admin-product-filter-clear" onClick={clearFilters} aria-label="Очистить фильтр">
                    <Icon name="bi-funnel" size={16} />
                  </button>
                </td>
              </tr>

              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="admin-product-photo">
                      {row.photo ? <img src={row.photo} alt="" /> : <Icon name="bi-image" size={17} />}
                    </span>
                  </td>
                  <td>
                    <span className="admin-product-name">{row.name}</span>
                  </td>
                  <td>{row.category}</td>
                  <td>{Number(row.price || 0).toLocaleString("ru-RU")}</td>
                  <td>{row.unit}</td>
                  <td>
                    <span className={`admin-product-status ${row.status === "active" ? "is-active" : "is-inactive"}`}>
                      {row.status === "active" ? "#активно" : "#неактивно"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-product-row-actions">
                      <button type="button" className="admin-product-icon-action is-edit" onClick={() => openEditProduct(row)} aria-label="Редактировать продукт">
                        <Icon name="bi-pencil" size={15} />
                      </button>
                      <button
                        type="button"
                        className="admin-product-icon-action is-delete"
                        onClick={() => showArchive ? restoreProduct(row) : archiveProduct(row)}
                        aria-label={showArchive ? "Вернуть из архива" : "Переместить в архив"}
                      >
                        <Icon name={showArchive ? "bi-check2" : "bi-trash3"} size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!visibleRows.length ? (
                <tr>
                  <td colSpan="7" className="admin-product-empty">
                    {showArchive ? "Архив пуст" : "Список пуст"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {drawer}
    </section>
  );
}

function SaleCategoryPage({ search, onNotify }) {
  const [rows, setRows] = useState(() => readStoredAdminSaleCategories() || adminSaleCategoryRows);
  const [editor, setEditor] = useState(null);
  const hasStoredRowsRef = useRef(readStoredAdminSaleCategories() !== null);
  const query = (search || "").trim().toLowerCase();

  useEffect(() => {
    if (hasStoredRowsRef.current) return;

    adminApi.get("/categories", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        const nextRows = items.map(normalizeAdminSaleCategory).filter((row) => row.name);
        if (nextRows.length) {
          setRows(nextRows);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    saveStoredAdminSaleCategories(rows);
  }, [rows]);

  useEffect(() => {
    if (!editor) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setEditor(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => !query || row.name.toLowerCase().includes(query));
  }, [rows, query]);

  function openCreate() {
    setEditor(createAdminSaleCategoryDraft());
  }

  function openEdit(row) {
    setEditor(createAdminSaleCategoryDraft(row));
  }

  function closeEditor() {
    setEditor(null);
  }

  function updateEditor(field, value) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function saveCategory(event) {
    event.preventDefault();
    if (!editor) return;

    const name = editor.name.trim();
    if (!name) return;

    const nextCategory = {
      ...editor,
      id: editor.id || `sale-category-${Date.now()}`,
      name,
    };

    setRows((current) => {
      const exists = current.some((row) => row.id === nextCategory.id);
      return exists
        ? current.map((row) => row.id === nextCategory.id ? nextCategory : row)
        : [nextCategory, ...current];
    });
    closeEditor();
    onNotify?.("Категория реализации сохранена.");
  }

  function deleteCategory(row) {
    setRows((current) => current.filter((item) => item.id !== row.id));
    onNotify?.(`${row.name} удалена из категории реализации.`);
  }

  const modal = editor ? createPortal(
    <div className="admin-sale-category-modal" role="dialog" aria-modal="true" aria-label="Категория реализации">
      <button type="button" className="admin-sale-category-modal__shade" onClick={closeEditor} aria-label="Закрыть" />
      <form className="admin-sale-category-dialog" onSubmit={saveCategory}>
        <div className="admin-sale-category-dialog__head">
          <h3>{editor.id ? "Изменить категорию продукта" : "Добавить категорию продукта"}</h3>
          <button type="button" onClick={closeEditor} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={18} />
          </button>
        </div>

        <div className="admin-sale-category-dialog__body">
          <label className="admin-sale-category-field">
            <span>Название <b>*</b></span>
            <input
              value={editor.name}
              onChange={(event) => updateEditor("name", event.target.value)}
              autoFocus
              required
            />
          </label>

          <div className="admin-sale-category-status-field">
            <span>Статус</span>
            <button
              type="button"
              className={`admin-sale-category-switch ${editor.status === "active" ? "is-on" : ""}`}
              onClick={() => updateEditor("status", editor.status === "active" ? "inactive" : "active")}
              aria-pressed={editor.status === "active"}
            >
              <span />
            </button>
          </div>
        </div>

        <div className="admin-sale-category-dialog__actions">
          <button type="submit">Сохранить</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <section className="admin-sale-category-page">
      <div className="admin-sale-category-card">
        <div className="admin-sale-category-head">
          <div className="admin-sale-category-title">
            <span aria-hidden="true" />
            <h2>Реализация</h2>
          </div>

          <button type="button" className="admin-sale-category-add" onClick={openCreate}>
            <span>Добавить</span>
            <Icon name="bi-plus" size={15} />
          </button>
        </div>

        <div className="admin-sale-category-list" role="table" aria-label="Список категорий реализации">
          {visibleRows.map((row) => (
            <div className="admin-sale-category-row" role="row" key={row.id}>
              <strong>{row.name}</strong>
              <span className={`admin-sale-category-status ${row.status === "active" ? "is-active" : "is-inactive"}`}>
                {row.status === "active" ? "#активно" : "#неактивно"}
              </span>
              <div className="admin-sale-category-actions">
                <button type="button" className="is-edit" onClick={() => openEdit(row)} aria-label="Редактировать категорию">
                  <Icon name="bi-pencil" size={15} />
                </button>
                <button type="button" className="is-delete" onClick={() => deleteCategory(row)} aria-label="Удалить категорию">
                  <Icon name="bi-trash3" size={15} />
                </button>
              </div>
            </div>
          ))}

          {!visibleRows.length ? (
            <div className="admin-sale-category-empty">Список пуст</div>
          ) : null}
        </div>
      </div>

      {modal}
    </section>
  );
}

function AdminSourcesPage({ search, onNotify }) {
  const [rows, setRows] = useState(() => readStoredAdminSources() || adminSourceRows);
  const [editor, setEditor] = useState(null);
  const [sortState, setSortState] = useState({ key: "id", direction: "desc" });
  const hasStoredRowsRef = useRef(readStoredAdminSources() !== null);
  const query = (search || "").trim().toLowerCase();

  useEffect(() => {
    if (hasStoredRowsRef.current) return;

    adminApi.get("/sources", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        const nextRows = items.map(normalizeAdminSource).filter((row) => row.name);
        if (nextRows.length) {
          setRows(nextRows);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    saveStoredAdminSources(rows);
  }, [rows]);

  useEffect(() => {
    if (!editor) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setEditor(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  const visibleRows = useMemo(() => {
    return rows
      .filter((row) => {
        if (!query) return true;
        return [row.id, row.name].some((value) => String(value).toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const direction = sortState.direction === "asc" ? 1 : -1;
        if (sortState.key === "id") {
          return (Number(a.id) - Number(b.id)) * direction;
        }
        return String(a.name).localeCompare(String(b.name), "ru", { sensitivity: "base" }) * direction;
      });
  }, [query, rows, sortState.direction, sortState.key]);

  function toggleSort(key) {
    setSortState((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function openCreate() {
    setEditor(createAdminSourceDraft());
  }

  function openEdit(row) {
    setEditor(createAdminSourceDraft(row));
  }

  function closeEditor() {
    setEditor(null);
  }

  function updateEditor(field, value) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function saveSource(event) {
    event.preventDefault();
    if (!editor) return;

    const name = editor.name.trim();
    if (!name) {
      onNotify?.("Введите название источника.");
      return;
    }

    const nextId = editor.id || String(rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1);
    const nextSource = { id: nextId, name };

    setRows((current) => {
      const exists = current.some((row) => row.id === nextSource.id);
      return exists
        ? current.map((row) => row.id === nextSource.id ? nextSource : row)
        : [nextSource, ...current];
    });
    closeEditor();
    onNotify?.("Источник сохранён.");
  }

  function deleteSource(row) {
    setRows((current) => current.filter((item) => item.id !== row.id));
    onNotify?.(`${row.name}: источник удалён.`);
  }

  const modal = editor ? createPortal(
    <div className="admin-source-modal" role="dialog" aria-modal="true" aria-label="Источник">
      <button type="button" className="admin-source-modal__shade" onClick={closeEditor} aria-label="Закрыть" />
      <form className="admin-source-dialog" onSubmit={saveSource}>
        <div className="admin-source-dialog__head">
          <h3>{editor.id ? "Изменить источник" : "Добавить источник"}</h3>
          <button type="button" onClick={closeEditor} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={18} />
          </button>
        </div>

        <div className="admin-source-dialog__body">
          <label className="admin-source-field">
            <span>Название <b>*</b></span>
            <input
              value={editor.name}
              onChange={(event) => updateEditor("name", event.target.value)}
              autoFocus
              required
            />
          </label>
        </div>

        <div className="admin-source-dialog__actions">
          <button type="button" onClick={closeEditor}>Отмена</button>
          <button type="submit">Сохранить</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <section className="admin-source-page">
      <div className="admin-source-card">
        <div className="admin-source-head">
          <div className="admin-source-title">
            <span aria-hidden="true">
              <Icon name="bi-megaphone" size={18} />
            </span>
            <div>
              <h2>Список источников</h2>
              <p>Каналы привлечения клиентов</p>
            </div>
          </div>

          <button type="button" className="admin-source-add" onClick={openCreate}>
            <span>Добавить</span>
            <Icon name="bi-plus" size={14} />
          </button>
        </div>

        <div className="admin-source-table" role="table" aria-label="Список источников">
          <div className="admin-source-row admin-source-row--head" role="row">
            <button
              type="button"
              className={`admin-source-sort-button ${sortState.key === "id" ? `is-${sortState.direction}` : ""}`}
              onClick={() => toggleSort("id")}
            >
              <span>ID</span>
              <span className="admin-source-sort-icon" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`admin-source-sort-button ${sortState.key === "name" ? `is-${sortState.direction}` : ""}`}
              onClick={() => toggleSort("name")}
            >
              <span>Названия</span>
              <span className="admin-source-sort-icon" aria-hidden="true" />
            </button>
            <span aria-hidden="true" />
          </div>

          {visibleRows.map((row) => (
            <div className="admin-source-row" role="row" key={row.id}>
              <span className="admin-source-id">{row.id}</span>
              <strong>{row.name}</strong>
              <div className="admin-source-actions">
                <button type="button" className="is-edit" onClick={() => openEdit(row)} aria-label="Редактировать источник">
                  <Icon name="bi-pencil" size={14} />
                </button>
                <button type="button" className="is-delete" onClick={() => deleteSource(row)} aria-label="Удалить источник">
                  <Icon name="bi-trash3" size={14} />
                </button>
              </div>
            </div>
          ))}

          {!visibleRows.length ? (
            <div className="admin-source-empty">Источники не найдены</div>
          ) : null}
        </div>
      </div>

      {modal}
    </section>
  );
}

function OrdersNomenclaturePage({ search, onNotify }) {
  const [rows, setRows] = useState(() => readStoredAdminOrders() || adminOrderRows);
  const [editor, setEditor] = useState(null);
  const [sortState, setSortState] = useState({ key: "id", direction: "desc" });
  const [page, setPage] = useState(1);
  const hasStoredRowsRef = useRef(readStoredAdminOrders() !== null);
  const pageSize = 14;
  const query = (search || "").trim().toLowerCase();

  useEffect(() => {
    if (hasStoredRowsRef.current) return;

    adminApi.get("/orders", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        const nextRows = items.map(normalizeAdminOrder).filter((row) => row.id);
        if (nextRows.length) {
          setRows(nextRows);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    saveStoredAdminOrders(rows);
  }, [rows]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    if (!editor) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setEditor(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  const filteredRows = useMemo(() => {
    const nextRows = rows.filter((row) => {
      if (!query) return true;
      return [
        row.id,
        row.organization,
        row.paymentId,
        getAdminOrderProductsLabel(row),
        getAdminOrderTotal(row),
        row.comment,
        row.status,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });

    const direction = sortState.direction === "asc" ? 1 : -1;
    return [...nextRows].sort((a, b) => {
      let first = a[sortState.key];
      let second = b[sortState.key];

      if (sortState.key === "total") {
        first = getAdminOrderTotal(a);
        second = getAdminOrderTotal(b);
      }

      if (sortState.key === "id" || sortState.key === "paymentId" || sortState.key === "total") {
        first = Number(String(first).replace(/\D/g, "")) || 0;
        second = Number(String(second).replace(/\D/g, "")) || 0;
      }

      if (first > second) return direction;
      if (first < second) return -direction;
      return 0;
    });
  }, [rows, query, sortState]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const paginationItems = useMemo(() => {
    if (totalPages <= 4) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    return [1, 2, 3, "...", totalPages];
  }, [totalPages]);

  function toggleSort(key) {
    setSortState((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function openCreate() {
    setEditor(createAdminOrderDraft());
  }

  function openEdit(row) {
    setEditor(createAdminOrderDraft(row));
  }

  function closeEditor() {
    setEditor(null);
  }

  function updateEditor(field, value) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function updateEditorItem(itemId, field, value) {
    setEditor((current) => current ? {
      ...current,
      items: current.items.map((item) => item.id === itemId ? { ...item, [field]: value } : item),
    } : current);
  }

  function addEditorItem() {
    setEditor((current) => current ? {
      ...current,
      items: [
        ...current.items,
        { id: `order-item-${Date.now()}`, product: adminOrderProducts[0], quantity: "1", price: "0", comment: "" },
      ],
    } : current);
  }

  function removeEditorItem(itemId) {
    setEditor((current) => current ? {
      ...current,
      items: current.items.length > 1 ? current.items.filter((item) => item.id !== itemId) : current.items,
    } : current);
  }

  function saveOrder(event) {
    event.preventDefault();
    if (!editor) return;

    const items = editor.items.map((item) => ({
      id: item.id,
      product: item.product || adminOrderProducts[0],
      quantity: Number(String(item.quantity).replace(",", ".")) || 0,
      price: Number(String(item.price).replace(/\s/g, "").replace(",", ".")) || 0,
      comment: item.comment?.trim() || "-",
    }));

    const nextOrder = {
      id: editor.id || String(Date.now()).slice(-8),
      organization: editor.organization || adminOrderOrganizations[0],
      paymentId: editor.paymentId || String(1000000 + Math.floor(Math.random() * 9000)),
      items,
      total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      comment: items.find((item) => item.comment && item.comment !== "-")?.comment || "-",
      status: editor.status || "new",
    };

    setRows((current) => {
      const exists = current.some((row) => row.id === nextOrder.id);
      return exists
        ? current.map((row) => row.id === nextOrder.id ? nextOrder : row)
        : [nextOrder, ...current];
    });
    closeEditor();
    onNotify?.("Заказ сохранён.");
  }

  function confirmOrder(row) {
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, status: "accepted" } : item));
    onNotify?.(`Заказ ${row.id} подтверждён.`);
  }

  function cancelOrder(row) {
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, status: "cancelled" } : item));
    onNotify?.(`Заказ ${row.id} отменён.`);
  }

  function deleteOrder(row) {
    setRows((current) => current.filter((item) => item.id !== row.id));
    onNotify?.(`Заказ ${row.id} удалён.`);
  }

  function statusLabel(status) {
    if (status === "accepted") return "Принято";
    if (status === "cancelled") return "Отменено";
    return "Новые";
  }

  const drawer = editor ? createPortal(
    <div className="admin-orders-drawer" role="dialog" aria-modal="true" aria-label="Заказ">
      <button type="button" className="admin-orders-drawer__shade" onClick={closeEditor} aria-label="Закрыть форму" />
      <form className="admin-orders-panel" onSubmit={saveOrder}>
        <div className="admin-orders-panel__body">
          <h3>{editor.id ? "Изменить заказы" : "Добавить заказы"}</h3>

          <label className="admin-orders-field admin-orders-field--wide">
            <span>Организация</span>
            <select value={editor.organization} onChange={(event) => updateEditor("organization", event.target.value)}>
              {adminOrderOrganizations.map((organization) => (
                <option value={organization} key={organization}>{organization}</option>
              ))}
            </select>
          </label>

          <div className="admin-orders-items">
            {editor.items.map((item) => (
              <div className="admin-orders-item" key={item.id}>
                <label className="admin-orders-field">
                  <span>Продукт</span>
                  <select value={item.product} onChange={(event) => updateEditorItem(item.id, "product", event.target.value)}>
                    {adminOrderProducts.map((product) => (
                      <option value={product} key={product}>{product}</option>
                    ))}
                  </select>
                </label>

                <label className="admin-orders-field">
                  <span>Цена</span>
                  <input value={item.price} inputMode="numeric" onChange={(event) => updateEditorItem(item.id, "price", event.target.value)} />
                </label>

                <label className="admin-orders-field">
                  <span>Количество</span>
                  <input value={item.quantity} inputMode="decimal" onChange={(event) => updateEditorItem(item.id, "quantity", event.target.value)} />
                </label>

                <label className="admin-orders-field">
                  <span>Комментария</span>
                  <input value={item.comment} onChange={(event) => updateEditorItem(item.id, "comment", event.target.value)} placeholder="Комментария" />
                </label>

                {editor.items.length > 1 ? (
                  <button type="button" className="admin-orders-item-remove" onClick={() => removeEditorItem(item.id)} aria-label="Удалить продукт">
                    <Icon name="bi-trash3" size={14} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <button type="button" className="admin-orders-add-item" onClick={addEditorItem}>
            <Icon name="bi-plus" size={14} />
            <span>Добавить</span>
          </button>
        </div>

        <div className="admin-orders-panel__footer">
          <button type="button" onClick={closeEditor}>Отменить</button>
          <button type="submit">Сохранить</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <section className="admin-orders-page">
      <div className="admin-orders-card">
        <div className="admin-orders-head">
          <div className="admin-orders-title">
            <span aria-hidden="true" />
            <h2>Список заказов</h2>
          </div>

          <button type="button" className="admin-orders-add" onClick={openCreate}>
            <span>Добавить</span>
            <Icon name="bi-plus" size={15} />
          </button>
        </div>

        <div className="admin-orders-table-wrap">
          <table className="admin-orders-table">
            <thead>
              <tr>
                <th>
                  <button type="button" onClick={() => toggleSort("id")}>
                    <span>ID</span>
                    <i className={`admin-orders-sort is-${sortState.key === "id" ? sortState.direction : "none"}`} />
                  </button>
                </th>
                <th>Названия</th>
                <th>
                  <button type="button" onClick={() => toggleSort("paymentId")}>
                    <span>ID платежа</span>
                    <i className={`admin-orders-sort is-${sortState.key === "paymentId" ? sortState.direction : "none"}`} />
                  </button>
                </th>
                <th>Продукты</th>
                <th>
                  <button type="button" onClick={() => toggleSort("total")}>
                    <span>Цена</span>
                    <i className={`admin-orders-sort is-${sortState.key === "total" ? sortState.direction : "none"}`} />
                  </button>
                </th>
                <th>Комментария</th>
                <th>
                  <button type="button" onClick={() => toggleSort("status")}>
                    <span>Статус</span>
                    <i className={`admin-orders-sort is-${sortState.key === "status" ? sortState.direction : "none"}`} />
                  </button>
                </th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.organization}</td>
                  <td><strong>{row.paymentId}</strong></td>
                  <td>
                    <span className="admin-orders-products">{getAdminOrderProductsLabel(row)}</span>
                  </td>
                  <td>{getAdminOrderTotal(row).toLocaleString("ru-RU")}</td>
                  <td>{row.comment || "-"}</td>
                  <td>
                    <span className={`admin-orders-status is-${row.status}`}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td>
                    {row.status === "new" ? (
                      <div className="admin-orders-decision">
                        <button type="button" className="is-confirm" onClick={() => confirmOrder(row)}>Подтвердить</button>
                        <button type="button" className="is-cancel" onClick={() => cancelOrder(row)}>Отменить</button>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div className="admin-orders-actions">
                      <button type="button" className="is-edit" onClick={() => openEdit(row)} aria-label="Редактировать заказ">
                        <Icon name="bi-pencil" size={15} />
                      </button>
                      <button type="button" className="is-delete" onClick={() => deleteOrder(row)} aria-label="Удалить заказ">
                        <Icon name="bi-trash3" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!pageRows.length ? (
                <tr>
                  <td colSpan="9" className="admin-orders-empty">Список пуст</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="admin-orders-pagination">
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} aria-label="Предыдущая страница">
            <Icon name="bi-chevron-left" size={15} />
          </button>
          {paginationItems.map((item) => item === "..." ? (
            <span key="dots">...</span>
          ) : (
            <button type="button" className={item === currentPage ? "is-active" : ""} onClick={() => setPage(item)} key={item}>
              {item}
            </button>
          ))}
          <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages} aria-label="Следующая страница">
            <Icon name="bi-chevron-right" size={15} />
          </button>
        </div>
      </div>

      {drawer}
    </section>
  );
}

function UnitNomenclaturePage({ search, onNotify }) {
  const [rows, setRows] = useState(() => readStoredAdminUnits() || adminUnitRows);
  const [editor, setEditor] = useState(null);
  const hasStoredRowsRef = useRef(readStoredAdminUnits() !== null);
  const query = (search || "").trim().toLowerCase();

  useEffect(() => {
    if (hasStoredRowsRef.current) return;

    adminApi.get("/units", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        const nextRows = items.map(normalizeAdminUnit).filter((row) => row.name);
        if (nextRows.length) {
          setRows(nextRows);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    saveStoredAdminUnits(rows);
  }, [rows]);

  useEffect(() => {
    if (!editor) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setEditor(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  const visibleRows = useMemo(() => {
    return rows
      .filter((row) => {
        if (!query) return true;
        return [row.sort, row.name, row.shortName, row.status]
          .some((value) => String(value || "").toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const sortDiff = Number(a.sort || 0) - Number(b.sort || 0);
        return sortDiff || a.name.localeCompare(b.name, "ru", { sensitivity: "base" });
      });
  }, [rows, query]);

  function openCreate() {
    setEditor(createAdminUnitDraft());
  }

  function openEdit(row) {
    setEditor(createAdminUnitDraft(row));
  }

  function closeEditor() {
    setEditor(null);
  }

  function updateEditor(field, value) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function updateSort(row, value) {
    setRows((current) => current.map((item) => (
      item.id === row.id ? { ...item, sort: Number(value) || 1 } : item
    )));
  }

  function saveUnit(event) {
    event.preventDefault();
    if (!editor) return;

    const name = editor.name.trim();
    const shortName = editor.shortName.trim();
    if (!name || !shortName) return;

    const nextUnit = {
      ...editor,
      id: editor.id || `unit-${Date.now()}`,
      sort: Number(editor.sort) || 1,
      name,
      shortName,
    };

    setRows((current) => {
      const exists = current.some((row) => row.id === nextUnit.id);
      return exists
        ? current.map((row) => row.id === nextUnit.id ? nextUnit : row)
        : [...current, nextUnit];
    });
    closeEditor();
    onNotify?.("Единица измерения сохранена.");
  }

  function deleteUnit(row) {
    setRows((current) => current.filter((item) => item.id !== row.id));
    onNotify?.(`${row.name} удалена из единиц измерения.`);
  }

  const modal = editor ? createPortal(
    <div className="admin-unit-modal" role="dialog" aria-modal="true" aria-label="Единица измерения">
      <button type="button" className="admin-unit-modal__shade" onClick={closeEditor} aria-label="Закрыть" />
      <form className="admin-unit-dialog" onSubmit={saveUnit}>
        <div className="admin-unit-dialog__head">
          <h3>{editor.id ? "Изменить единица измерению" : "Добавить единица измерению"}</h3>
          <button type="button" onClick={closeEditor} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={18} />
          </button>
        </div>

        <div className="admin-unit-dialog__body">
          <label className="admin-unit-field">
            <span>Название <b>*</b></span>
            <input value={editor.name} onChange={(event) => updateEditor("name", event.target.value)} autoFocus required />
          </label>

          <label className="admin-unit-field">
            <span>Короткое названия <b>*</b></span>
            <input value={editor.shortName} onChange={(event) => updateEditor("shortName", event.target.value)} required />
          </label>

          <div className="admin-unit-status-field">
            <span>Статус</span>
            <button
              type="button"
              className={`admin-unit-switch ${editor.status === "active" ? "is-on" : ""}`}
              onClick={() => updateEditor("status", editor.status === "active" ? "inactive" : "active")}
              aria-pressed={editor.status === "active"}
            >
              <span />
            </button>
          </div>
        </div>

        <div className="admin-unit-dialog__actions">
          <button type="submit">Сохранить</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <section className="admin-unit-page">
      <div className="admin-unit-card">
        <div className="admin-unit-head">
          <div className="admin-unit-title">
            <span aria-hidden="true" />
            <h2>Единица измерения</h2>
          </div>

          <button type="button" className="admin-unit-add" onClick={openCreate}>
            <span>Добавить</span>
            <Icon name="bi-plus" size={15} />
          </button>
        </div>

        <div className="admin-unit-table-wrap">
          <table className="admin-unit-table">
            <thead>
              <tr>
                <th>Сорт</th>
                <th>Название</th>
                <th>Короткое названия</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      aria-label={`Сорт ${row.name}`}
                      value={row.sort}
                      inputMode="numeric"
                      onChange={(event) => updateSort(row, event.target.value)}
                    />
                  </td>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.shortName}</td>
                  <td>
                    <span className={`admin-unit-status ${row.status === "active" ? "is-active" : "is-inactive"}`}>
                      {row.status === "active" ? "#активно" : "#неактивно"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-unit-actions">
                      <button type="button" className="is-edit" onClick={() => openEdit(row)} aria-label="Редактировать единицу измерения">
                        <Icon name="bi-pencil" size={15} />
                      </button>
                      <button type="button" className="is-delete" onClick={() => deleteUnit(row)} aria-label="Удалить единицу измерения">
                        <Icon name="bi-trash3" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!visibleRows.length ? (
                <tr>
                  <td colSpan="5" className="admin-unit-empty">Список пуст</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {modal}
    </section>
  );
}

function AdminEmployeesPage({ search, onNotify }) {
  const [rows, setRows] = useState(() => readStoredAdminEmployees() || adminEmployeeRows.map(normalizeAdminEmployee));
  const [query, setQuery] = useState("");
  const [sortState, setSortState] = useState({ key: "id", direction: "desc" });
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState(null);
  const pageSize = 16;
  const globalQuery = (search || "").trim().toLowerCase();
  const localQuery = query.trim().toLowerCase();

  useEffect(() => {
    saveStoredAdminEmployees(rows);
  }, [rows]);

  useEffect(() => {
    setPage(1);
  }, [globalQuery, localQuery, sortState.key, sortState.direction]);

  useEffect(() => {
    if (!editor) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setEditor(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  const filteredRows = useMemo(() => {
    const nextRows = rows.filter((row) => {
      const haystack = [
        row.id,
        row.name,
        row.phone,
        row.login,
        row.department,
        row.email,
        row.roles.join(" "),
        row.inRating ? "участвует" : "не участвует",
      ].join(" ").toLowerCase();

      if (globalQuery && !haystack.includes(globalQuery)) return false;
      if (localQuery && !haystack.includes(localQuery)) return false;
      return true;
    });

    return nextRows.sort((a, b) => {
      const direction = sortState.direction === "asc" ? 1 : -1;
      if (sortState.key === "id" || sortState.key === "balance") {
        return (Number(a[sortState.key] || 0) - Number(b[sortState.key] || 0)) * direction;
      }

      return String(a[sortState.key] || "").localeCompare(String(b[sortState.key] || ""), "ru", { sensitivity: "base" }) * direction;
    });
  }, [globalQuery, localQuery, rows, sortState.direction, sortState.key]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageList = getPageList(currentPage, totalPages);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function goToPage(nextPage) {
    setPage(Math.min(totalPages, Math.max(1, nextPage)));
  }

  function toggleSort(key) {
    setSortState((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function openCreate() {
    setEditor(createAdminEmployeeDraft());
  }

  function openEdit(row) {
    setEditor(createAdminEmployeeDraft(row));
  }

  function closeEditor() {
    setEditor(null);
  }

  function updateEditor(field, value) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function toggleEditorRole(role) {
    setEditor((current) => {
      if (!current) return current;
      const roles = current.roles.includes(role)
        ? current.roles.filter((item) => item !== role)
        : [...current.roles, role];

      return { ...current, roles: roles.length ? roles : [role] };
    });
  }

  function saveEmployee(event) {
    event.preventDefault();
    if (!editor) return;

    const name = editor.name.trim();
    const phone = editor.phone.trim();
    const login = editor.login.trim();
    if (!name || !login) return;

    const nextEmployee = normalizeAdminEmployee({
      ...editor,
      id: editor.id || String(Date.now()).slice(-5),
      name,
      phone,
      login,
      balance: Number(String(editor.balance || 0).replace(/\s/g, "")) || 0,
    });

    setRows((current) => {
      const exists = current.some((row) => row.id === nextEmployee.id);
      return exists
        ? current.map((row) => row.id === nextEmployee.id ? nextEmployee : row)
        : [nextEmployee, ...current];
    });
    closeEditor();
    onNotify?.("Сотрудник сохранён.");
  }

  function deleteEmployee(row) {
    setRows((current) => current.filter((item) => item.id !== row.id));
    onNotify?.(`${row.name} удалён из списка сотрудников.`);
  }

  function renderSortableHead(label, key) {
    return (
      <button type="button" className="admin-employee-sort" onClick={() => toggleSort(key)}>
        <span>{label}</span>
        <i className={`admin-employee-sort__arrows ${sortState.key === key ? `is-${sortState.direction}` : ""}`} aria-hidden="true" />
      </button>
    );
  }

  const drawer = editor ? createPortal(
    <div className="admin-employee-drawer" role="dialog" aria-modal="true" aria-label="Аккаунт сотрудника">
      <button type="button" className="admin-employee-drawer__shade" onClick={closeEditor} aria-label="Закрыть" />
      <form className="admin-employee-panel" onSubmit={saveEmployee}>
        <div className="admin-employee-panel__head">
          <h3>{editor.id ? "Изменить аккаунт" : "Добавить аккаунт"}</h3>
          <button type="button" onClick={closeEditor} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={18} />
          </button>
        </div>

        <div className="admin-employee-panel__body">
          <label className="admin-employee-field">
            <span>Имя <b>*</b></span>
            <input value={editor.name} onChange={(event) => updateEditor("name", event.target.value)} autoFocus required />
          </label>

          <label className="admin-employee-field">
            <span>Номер телефона</span>
            <input value={editor.phone} onChange={(event) => updateEditor("phone", event.target.value)} />
          </label>

          <label className="admin-employee-field">
            <span>Login <b>*</b></span>
            <input value={editor.login} onChange={(event) => updateEditor("login", event.target.value)} required />
          </label>

          <label className="admin-employee-field">
            <span>Пароль <b>*</b></span>
            <input value={editor.password} onChange={(event) => updateEditor("password", event.target.value)} placeholder="Введите пароль" />
          </label>

          <label className="admin-employee-field">
            <span>Телеграмм</span>
            <input value={editor.telegram} onChange={(event) => updateEditor("telegram", event.target.value)} placeholder="Телеграмм ID" />
          </label>

          <div className="admin-employee-form-grid">
            <label className="admin-employee-field">
              <span>Рабочие дни</span>
              <input value={editor.workingDays} onChange={(event) => updateEditor("workingDays", event.target.value)} inputMode="numeric" />
            </label>

            <label className="admin-employee-field">
              <span>Рабочее время</span>
              <input value={editor.workingTime} onChange={(event) => updateEditor("workingTime", event.target.value)} inputMode="numeric" />
            </label>
          </div>

          <label className="admin-employee-field">
            <span>Зарплата</span>
            <input value={editor.salary} onChange={(event) => updateEditor("salary", event.target.value)} placeholder="Зарплата" inputMode="numeric" />
          </label>

          <label className="admin-employee-field">
            <span>Email</span>
            <input value={editor.email} onChange={(event) => updateEditor("email", event.target.value)} placeholder="Введите email" />
          </label>

          <label className="admin-employee-field">
            <span>Отдел</span>
            <select value={editor.department} onChange={(event) => updateEditor("department", event.target.value)}>
              {adminEmployeeDepartments.map((department) => (
                <option value={department} key={department}>{department}</option>
              ))}
            </select>
          </label>

          <div className="admin-employee-roles-field">
            <span>Роли</span>
            <div>
              {adminEmployeeRoles.map((role) => (
                <button
                  type="button"
                  className={editor.roles.includes(role) ? "is-selected" : ""}
                  onClick={() => toggleEditorRole(role)}
                  key={role}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          <label className="admin-employee-field">
            <span>Баланс</span>
            <input value={editor.balance} onChange={(event) => updateEditor("balance", event.target.value)} inputMode="numeric" />
          </label>

          <div className="admin-employee-switch-row">
            <span>Участвует в рейтинге</span>
            <button
              type="button"
              className={`admin-employee-switch ${editor.inRating ? "is-on" : ""}`}
              onClick={() => updateEditor("inRating", !editor.inRating)}
              aria-pressed={editor.inRating}
            >
              <span />
            </button>
          </div>
        </div>

        <div className="admin-employee-panel__footer">
          <button type="button" onClick={closeEditor}>Отменить</button>
          <button type="submit">Сохранить</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <section className="admin-employee-page">
      <div className="admin-employee-card">
        <div className="admin-employee-head">
          <div className="admin-employee-title">
            <span aria-hidden="true" />
            <h2>Список сотрудников</h2>
          </div>

          <div className="admin-employee-head__actions">
            <button type="button" className="admin-employee-refresh" onClick={() => onNotify?.("Список сотрудников обновлён.")}>
              Обновить список (devent)
            </button>
            <button type="button" className="admin-employee-add" onClick={openCreate}>
              <span>Добавить</span>
              <Icon name="bi-plus" size={15} />
            </button>
          </div>
        </div>

        <label className="admin-employee-search">
          <Icon name="bi-search" size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" />
        </label>

        <div className="admin-employee-table-wrap" onWheelCapture={keepWheelInsideScroller}>
          <table className="admin-employee-table">
            <thead>
              <tr>
                <th>{renderSortableHead("ID", "id")}</th>
                <th>{renderSortableHead("ФИО", "name")}</th>
                <th>{renderSortableHead("Номер телефон", "phone")}</th>
                <th>Роль</th>
                <th>{renderSortableHead("Баланс", "balance")}</th>
                <th>Участвует в рейтинге</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.phone}</td>
                  <td>
                    <span className="admin-employee-role-list">
                      {row.roles.map((role) => <span key={role}>{role}</span>)}
                    </span>
                  </td>
                  <td>
                    {row.balance ? (
                      <span className={`admin-employee-balance ${row.balance < 0 ? "is-negative" : "is-positive"}`}>
                        {row.balance < 0 ? "-" : ""}{Number(Math.abs(row.balance)).toLocaleString("ru-RU")}
                      </span>
                    ) : (
                      <span className="admin-employee-balance is-empty">—</span>
                    )}
                  </td>
                  <td>
                    <span className={`admin-employee-rating ${row.inRating ? "is-on" : "is-off"}`}>
                      {row.inRating ? "Участвует" : "Не участвует"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-employee-actions">
                      <button type="button" className="is-ledger" onClick={() => onNotify?.(`Баланс ${row.name}: ${formatCurrency(row.balance)}.`)} aria-label={`Баланс ${row.name}`}>
                        <Icon name="bi-wallet2" size={14} />
                      </button>
                      <button type="button" className="is-edit" onClick={() => openEdit(row)} aria-label={`Редактировать ${row.name}`}>
                        <Icon name="bi-pencil" size={15} />
                      </button>
                      <button type="button" className="is-delete" onClick={() => deleteEmployee(row)} aria-label={`Удалить ${row.name}`}>
                        <Icon name="bi-trash3" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!pageRows.length ? (
                <tr>
                  <td colSpan="7" className="admin-employee-empty">Сотрудники не найдены</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="admin-employee-footer">
          <span>{filteredRows.length ? `${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, filteredRows.length)} из ${filteredRows.length}` : "0 из 0"}</span>
          <div className="admin-employee-pager">
            <button type="button" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)} aria-label="Предыдущая страница">
              <Icon name="bi-chevron-left" size={15} />
            </button>
            {pageList.map((item, index) => item === "…" ? (
              <span key={`gap-${index}`}>…</span>
            ) : (
              <button type="button" className={item === currentPage ? "is-active" : ""} onClick={() => goToPage(item)} key={item}>
                {item}
              </button>
            ))}
            <button type="button" disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)} aria-label="Следующая страница">
              <Icon name="bi-chevron-right" size={15} />
            </button>
          </div>
        </div>
      </div>

      {drawer}
    </section>
  );
}

function HandbookLocationPage({ active, search, onNotify }) {
  const kind = adminHandbookActiveKind[active] || "countries";
  const config = adminHandbookConfig[kind];
  const [locations, setLocations] = useState(() => readStoredAdminHandbookLocations() || normalizeAdminHandbookState());
  const [editor, setEditor] = useState(null);
  const query = (search || "").trim().toLowerCase();
  const rows = locations[kind] || [];
  const countryOptions = locations.countries?.length ? locations.countries : adminHandbookDefaultRows.countries;
  const regionOptions = locations.regions?.length ? locations.regions : adminHandbookDefaultRows.regions;

  useEffect(() => {
    saveStoredAdminHandbookLocations(locations);
  }, [locations]);

  useEffect(() => {
    setEditor(null);
  }, [kind]);

  useEffect(() => {
    if (!editor) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setEditor(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      if (!query) return true;
      return Object.values(row).some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [rows, query]);

  function openCreate() {
    if (kind !== "districts" && rows.length) {
      setEditor(createAdminHandbookDraft(kind, rows[0], locations));
      onNotify?.(`${config.title}: доступна только одна запись.`);
      return;
    }

    setEditor(createAdminHandbookDraft(kind, null, locations));
  }

  function openEdit(row) {
    setEditor(createAdminHandbookDraft(kind, row, locations));
  }

  function closeEditor() {
    setEditor(null);
  }

  function updateEditor(field, value) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function saveRow(event) {
    event.preventDefault();
    if (!editor) return;

    const name = editor.name.trim();
    if (!name) return;

    const nextRow = normalizeAdminHandbookRow(kind, {
      ...editor,
      id: editor.id || `${kind}-${Date.now()}`,
      name,
    }, rows.length);

    setLocations((current) => {
      const currentRows = current[kind] || [];
      const exists = currentRows.some((row) => row.id === nextRow.id);
      const nextRows = kind !== "districts"
        ? [nextRow]
        : exists
          ? currentRows.map((row) => row.id === nextRow.id ? nextRow : row)
          : [...currentRows, nextRow];

      return normalizeAdminHandbookState({ ...current, [kind]: nextRows });
    });
    closeEditor();
    onNotify?.(`${config.title}: запись сохранена.`);
  }

  function deleteRow(row) {
    if (kind !== "districts") {
      onNotify?.(`${config.title}: эта запись обязательна.`);
      return;
    }

    setLocations((current) => normalizeAdminHandbookState({
      ...current,
      districts: current.districts.filter((item) => item.id !== row.id),
    }));
    onNotify?.(`${row.name} удалён из справочника районов.`);
  }

  function renderParentCell(row) {
    if (kind === "regions") return <td>{row.country}</td>;
    if (kind === "districts") return <td>{row.region}</td>;
    return null;
  }

  const modal = editor ? createPortal(
    <div className="admin-handbook-modal" role="dialog" aria-modal="true" aria-label={config.title}>
      <button type="button" className="admin-handbook-modal__shade" onClick={closeEditor} aria-label="Закрыть" />
      <form className="admin-handbook-dialog" onSubmit={saveRow}>
        <div className="admin-handbook-dialog__head">
          <h3>{editor.id ? `Изменить ${config.editTitle}` : `Добавить ${config.singleTitle}`}</h3>
          <button type="button" onClick={closeEditor} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={18} />
          </button>
        </div>

        <div className="admin-handbook-dialog__body">
          <label className="admin-handbook-field">
            <span>Название <b>*</b></span>
            <input value={editor.name} onChange={(event) => updateEditor("name", event.target.value)} autoFocus required />
          </label>

          {kind === "countries" ? (
            <>
              <label className="admin-handbook-field">
                <span>Код <b>*</b></span>
                <input value={editor.code} onChange={(event) => updateEditor("code", event.target.value)} required />
              </label>
              <label className="admin-handbook-field">
                <span>ISO <b>*</b></span>
                <input value={editor.iso} onChange={(event) => updateEditor("iso", event.target.value.toUpperCase())} required />
              </label>
              <label className="admin-handbook-field">
                <span>Маска <b>*</b></span>
                <input value={editor.mask} onChange={(event) => updateEditor("mask", event.target.value)} required />
              </label>
            </>
          ) : null}

          {kind === "regions" ? (
            <label className="admin-handbook-field">
              <span>Страна</span>
              <select value={editor.country} onChange={(event) => updateEditor("country", event.target.value)}>
                {countryOptions.map((country) => (
                  <option value={country.name} key={country.id}>{country.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          {kind === "districts" ? (
            <label className="admin-handbook-field">
              <span>Регион</span>
              <select value={editor.region} onChange={(event) => updateEditor("region", event.target.value)}>
                {regionOptions.map((region) => (
                  <option value={region.name} key={region.id}>{region.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="admin-handbook-status-field">
            <span>Статус</span>
            <button
              type="button"
              className={`admin-handbook-switch ${editor.status === "active" ? "is-on" : ""}`}
              onClick={() => updateEditor("status", editor.status === "active" ? "inactive" : "active")}
              aria-pressed={editor.status === "active"}
            >
              <span />
            </button>
          </div>
        </div>

        <div className="admin-handbook-dialog__actions">
          <button type="submit">Сохранить</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <section className={`admin-handbook-page admin-handbook-page--${kind}`}>
      <div className="admin-handbook-card">
        <div className="admin-handbook-head">
          <div className="admin-handbook-title">
            <span aria-hidden="true" />
            <h2>{config.title}</h2>
          </div>

          <button type="button" className="admin-handbook-add" onClick={openCreate}>
            <span>Добавить</span>
            <Icon name="bi-plus" size={15} />
          </button>
        </div>

        <div className="admin-handbook-table-wrap" onWheelCapture={keepWheelInsideScroller}>
          <table className={`admin-handbook-table admin-handbook-table--${kind}`}>
            <thead>
              <tr>
                {config.columns.map((column) => <th key={column}>{column}</th>)}
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={row.id}>
                  <td>{index + 1}</td>
                  <td><strong>{row.name}</strong></td>
                  {renderParentCell(row)}
                  <td>
                    <span className={`admin-handbook-status ${row.status === "active" ? "is-active" : "is-inactive"}`}>
                      {row.status === "active" ? "#активно" : "#неактивно"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-handbook-actions">
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

              {!visibleRows.length ? (
                <tr>
                  <td colSpan={config.columns.length + 1} className="admin-handbook-empty">Список пуст</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {modal}
    </section>
  );
}

const ADMIN_FINANCE_FALLBACK_PAYMENT_TYPES = [
  { id: "fallback-cash", label: "Наличные", apiId: null },
  { id: "fallback-card", label: "Карта", apiId: null },
  { id: "fallback-transfer", label: "Перечисление", apiId: null },
];
const ADMIN_FINANCE_FALLBACK_INCOME_CATEGORIES = [
  { id: "fallback-income-cash", label: "Пополнение кассы", apiId: null, kind: "income" },
  { id: "fallback-income-order", label: "Оплата заказа", apiId: null, kind: "income" },
  { id: "fallback-income-other", label: "Прочее поступление", apiId: null, kind: "income" },
];
const ADMIN_FINANCE_COUNTERPARTY_TYPES = [
  { value: "provider", label: "Поставщики" },
  { value: "client", label: "Клиенты" },
  { value: "employee", label: "Сотрудники" },
  { value: "other", label: "Другие" },
];
const ADMIN_FINANCE_CALENDAR_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const ADMIN_FINANCE_CALENDAR_WEEK_DAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
const ADMIN_FINANCE_CALENDAR_YEARS = Array.from({ length: 15 }, (_, index) => 2020 + index);
const ADMIN_FINANCE_MODAL_ANIMATION_MS = 180;
const ADMIN_FINANCE_COMMENT_LIMIT = 500;
const ADMIN_FINANCE_REQUIRED_FIELDS = ["amount", "paymentTypeId", "organizationId", "date", "categoryId"];

const adminFinanceApi = {
  listTransactions(params = {}) {
    return adminApi.get("/finance/transactions", { params: { size: 100, ...params } });
  },
  createTransaction(payload, idempotencyKey) {
    return adminApi.post("/finance/transactions", payload, {
      headers: { "Idempotency-Key": idempotencyKey },
    });
  },
  listPaymentTypes() {
    return adminApi.get("/finance/payment-types", { params: { size: 100, status: true } });
  },
  listOrganizations() {
    return adminApi.get("/organizations", { params: { size: 100, status: "active" } });
  },
  listCategories(kind) {
    return adminApi.get("/finance/transaction-categories", { params: { size: 200, kind, status: true } });
  },
  listCounterparties(type) {
    return adminApi.get("/finance/counterparties", { params: { size: 200, type } });
  },
};

function extractAdminFinanceItems(data) {
  return Array.isArray(data) ? data : data?.items || data?.results || [];
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function normalizeAdminFinanceOption(item, index, labelFields = ["name"]) {
  const rawId = item?.id || item?.uuid || item?.value || "";
  const label = labelFields.map((field) => item?.[field]).find(Boolean) || item?.label || rawId || `option-${index + 1}`;
  return {
    id: String(rawId || `${label}-${index}`),
    apiId: isUuidLike(rawId) ? String(rawId) : null,
    label: String(label),
    raw: item,
  };
}

function normalizeAdminFinanceTransaction(row, index = 0) {
  const operationType = row.direction || row.operation_type || (Number(row.amount || 0) < 0 ? "expense" : "income");
  const amount = Math.abs(Number(row.amount || 0));
  const dateValue = row.date || row.created_at || "";
  const parsedDate = dateValue ? new Date(dateValue) : null;
  const hasValidDate = parsedDate && !Number.isNaN(parsedDate.getTime());
  return {
    id: row.id || row.uuid || row.document_number || `finance-operation-${index}`,
    date: hasValidDate ? parsedDate.toLocaleDateString("ru-RU") : (row.date || "—"),
    time: hasValidDate ? parsedDate.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : (row.time || ""),
    number: row.document_number || row.id || "",
    organization: row.organization_name || row.organization || "—",
    type: operationType === "expense" ? "Расход" : "Приход",
    operationType,
    amount: operationType === "expense" ? -amount : amount,
    paymentType: row.payment_type_name || row.payment_type || "—",
    counterparty: row.counterparty_name || row.counterparty || "—",
    category: row.category_name || row.category || "—",
    status: row.status || "Проведен",
    comment: row.comment || "—",
  };
}

function createAdminFinanceTransactionDraft(operationType = "income", defaults = {}) {
  return {
    operationType,
    amount: "",
    paymentTypeId: defaults.paymentTypeId || "",
    organizationId: defaults.organizationId || "",
    counterpartyType: "provider",
    counterpartyId: "",
    date: adminTodayInputValue(),
    categoryId: defaults.categoryId || "",
    comment: "",
  };
}

function formatAdminFinanceAmountDraft(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const normalized = digits.replace(/^0+(?=\d)/, "");
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function parseAdminFinanceAmount(value) {
  return Number(String(value || "").replace(/\s/g, "")) || 0;
}

function adminFinanceDateForApi(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? `${value}T00:00:00` : null;
}

function adminFinanceInputToDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date();
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function adminFinanceCalendarDays(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function getAdminFinanceBackendMessage(error) {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg || item?.message || String(item)).join("; ");
  }
  if (detail && typeof detail === "object") {
    return detail.message || JSON.stringify(detail);
  }
  return detail || "Не удалось добавить операцию. Проверьте данные и попробуйте ещё раз.";
}

function validateAdminFinanceDraft(draft) {
  const errors = {};
  const amount = parseAdminFinanceAmount(draft.amount);
  if (!String(draft.amount || "").trim()) {
    errors.amount = "Введите сумму";
  } else if (amount <= 0) {
    errors.amount = "Сумма должна быть больше нуля";
  }
  if (!draft.paymentTypeId) errors.paymentTypeId = "Выберите способ оплаты";
  if (!draft.organizationId) errors.organizationId = "Выберите филиал";
  if (!draft.date || !adminFinanceDateForApi(draft.date)) errors.date = "Выберите дату";
  if (!draft.categoryId) errors.categoryId = "Выберите категорию";
  return errors;
}

function AdminFinanceSearchableSelect({
  label,
  required = false,
  value,
  options,
  onChange,
  placeholder = "Выберите",
  searchPlaceholder = "Поиск",
  emptyText = "Ничего не найдено",
  error,
  disabled = false,
  loading = false,
  controlRef,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const selected = options.find((option) => option.id === value);
  const filteredOptions = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", closeOnOutsideClick);
    return () => window.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  function chooseOption(option) {
    onChange(option.id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className={`admin-income-field admin-transaction-field admin-finance-select-field ${error ? "is-invalid" : ""}`} ref={rootRef}>
      <span>{label} {required ? <b>*</b> : null}</span>
      <button
        type="button"
        className="admin-finance-select-button"
        ref={controlRef}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onClick={() => setOpen((current) => !current)}
      >
        <strong className={selected ? "" : "is-placeholder"}>{loading ? "Загрузка..." : selected?.label || placeholder}</strong>
        <Icon name="bi-chevron-down" size={14} />
      </button>
      {open ? (
        <div className="admin-finance-select-menu" onClick={(event) => event.stopPropagation()}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
          />
          <div className="admin-finance-select-options">
            {filteredOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className={option.id === value ? "is-selected" : ""}
                onClick={() => chooseOption(option)}
              >
                {option.label}
              </button>
            ))}
            {!filteredOptions.length ? <em>{emptyText}</em> : null}
          </div>
        </div>
      ) : null}
      {error ? <em className="admin-finance-field-error">{error}</em> : null}
    </div>
  );
}

function AdminFinanceCurrencyInput({ value, onChange, error, controlRef, disabled }) {
  return (
    <label className={`admin-income-field admin-transaction-field ${error ? "is-invalid" : ""}`}>
      <span>Сумма <b>*</b></span>
      <div className="admin-transaction-amount-input admin-finance-operation-amount">
        <input
          ref={controlRef}
          value={value}
          inputMode="numeric"
          disabled={disabled}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(formatAdminFinanceAmountDraft(event.target.value))}
          placeholder="0"
          autoFocus
        />
        <strong>UZS</strong>
      </div>
      {error ? <em className="admin-finance-field-error">{error}</em> : null}
    </label>
  );
}

function AdminFinanceCounterpartyTypeSelector({ value, onChange }) {
  return (
    <div className="admin-income-field admin-transaction-field admin-finance-counterparty-field">
      <span>Тип контрагента</span>
      <div className="admin-finance-counterparty-types" role="radiogroup" aria-label="Тип контрагента">
        {ADMIN_FINANCE_COUNTERPARTY_TYPES.map((item) => (
          <button
            type="button"
            key={item.value}
            className={item.value === value ? "is-active" : ""}
            role="radio"
            aria-checked={item.value === value}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AdminFinanceDateInput({ value, onChange, error, controlRef, disabled }) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(value || adminTodayInputValue());
  const [viewDate, setViewDate] = useState(() => {
    const selected = adminFinanceInputToDate(value || adminTodayInputValue());
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const [calendarPosition, setCalendarPosition] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const todayValue = adminTodayInputValue();
  const selectedValue = draftDate || value || todayValue;

  useEffect(() => {
    if (!open) return undefined;

    const selected = adminFinanceInputToDate(value || todayValue);
    setDraftDate(value || todayValue);
    setViewDate(new Date(selected.getFullYear(), selected.getMonth(), 1));

    function updateCalendarPosition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const gap = 7;
      const safeGap = 12;
      const width = Math.min(314, Math.max(260, viewportWidth - safeGap * 2));
      const estimatedHeight = 292;
      const left = Math.min(Math.max(safeGap, rect.left), Math.max(safeGap, viewportWidth - width - safeGap));
      const top = rect.bottom + gap + estimatedHeight <= viewportHeight - safeGap
        ? rect.bottom + gap
        : Math.max(safeGap, rect.top - gap - estimatedHeight);
      setCalendarPosition((current) => {
        const next = { left, top, width };
        return current && current.left === next.left && current.top === next.top && current.width === next.width
          ? current
          : next;
      });
    }

    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    }

    updateCalendarPosition();
    window.addEventListener("resize", updateCalendarPosition);
    window.addEventListener("scroll", updateCalendarPosition, true);
    window.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("resize", updateCalendarPosition);
      window.removeEventListener("scroll", updateCalendarPosition, true);
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open, todayValue, value]);

  function setDateButtonRef(node) {
    buttonRef.current = node;
    controlRef?.(node);
  }

  function shiftMonth(delta) {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function selectToday() {
    const today = new Date();
    setDraftDate(todayValue);
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
  }

  function applyDate() {
    onChange(selectedValue);
    setOpen(false);
  }

  const calendar = open && calendarPosition && typeof document !== "undefined"
    ? createPortal(
      <div
        className="admin-finance-calendar"
        role="dialog"
        aria-label="Выбор даты"
        style={{
          left: `${calendarPosition.left}px`,
          top: `${calendarPosition.top}px`,
          width: `${calendarPosition.width}px`,
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="admin-finance-calendar__toolbar">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
            <Icon name="bi-chevron-left" size={16} />
          </button>
          <select value={viewDate.getFullYear()} onChange={(event) => setViewDate(new Date(Number(event.target.value), viewDate.getMonth(), 1))} aria-label="Год">
            {ADMIN_FINANCE_CALENDAR_YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <select value={viewDate.getMonth()} onChange={(event) => setViewDate(new Date(viewDate.getFullYear(), Number(event.target.value), 1))} aria-label="Месяц">
            {ADMIN_FINANCE_CALENDAR_MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}
          </select>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
            <Icon name="bi-chevron-right" size={16} />
          </button>
        </div>
        <div className="admin-finance-calendar__week">
          {ADMIN_FINANCE_CALENDAR_WEEK_DAYS.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="admin-finance-calendar__grid">
          {adminFinanceCalendarDays(viewDate).map((day) => {
            const inputValue = adminDateToInputValue(day);
            const muted = day.getMonth() !== viewDate.getMonth();
            return (
              <button
                type="button"
                key={inputValue}
                className={`${muted ? "is-muted" : ""} ${inputValue === selectedValue ? "is-selected" : ""} ${inputValue === todayValue ? "is-today" : ""}`.trim()}
                onClick={() => setDraftDate(inputValue)}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
        <div className="admin-finance-calendar__footer">
          <button type="button" className="admin-finance-calendar__today" onClick={selectToday}>
            <Icon name="bi-calendar3" size={15} />
            <span>Сегодня</span>
          </button>
          <button type="button" className="admin-finance-calendar__ok" onClick={applyDate}>OK</button>
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <div className={`admin-income-field admin-transaction-field admin-finance-date-field ${error ? "is-invalid" : ""}`} ref={rootRef}>
      <span>Дата <b>*</b></span>
      <button
        type="button"
        className="admin-finance-operation-date"
        ref={setDateButtonRef}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={Boolean(error)}
        onClick={() => {
          if (!open) setCalendarPosition(null);
          setOpen((current) => !current);
        }}
      >
        <strong>{adminInputDateToReportDate(value)}</strong>
        <Icon name="bi-calendar3" size={15} />
      </button>
      {calendar}
      {error ? <em className="admin-finance-field-error">{error}</em> : null}
    </div>
  );
}

function AdminFinanceTransactionModal({
  open,
  closing = false,
  operationType,
  draft,
  errors,
  submitError,
  submitting,
  referencesLoading,
  paymentTypes,
  organizations,
  categories,
  counterparties,
  onChange,
  onCloseRequest,
  onSubmit,
  fieldRef,
}) {
  if (!open || typeof document === "undefined") return null;

  const isIncome = operationType === "income";
  const title = isIncome ? "Добавить приход" : "Добавить расход";
  const actionText = isIncome ? "Добавить" : "Добавить";
  const loadingText = isIncome ? "Добавление…" : "Добавление…";
  const counterpartyOptions = counterparties[draft.counterpartyType] || [];

  return createPortal(
    <div
      className={`admin-income-modal admin-transaction-modal admin-finance-operation-modal ${isIncome ? "is-income" : "is-expense"} ${closing ? "is-closing" : "is-opening"}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={closing ? "true" : undefined}
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRequest();
      }}
    >
      <form className="admin-income-dialog admin-transaction-dialog admin-finance-operation-dialog" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="admin-income-dialog__head admin-transaction-dialog__head admin-finance-operation-dialog__head">
          <div className="admin-finance-operation-title">
            <span aria-hidden="true">
              <Icon name={isIncome ? "bi-plus-lg" : "bi-dash-lg"} size={18} />
            </span>
            <div>
              <h3>{title}</h3>
            </div>
          </div>
          <button type="button" className="admin-income-dialog__close" onClick={onCloseRequest} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={16} />
          </button>
        </div>

        <div className="admin-transaction-dialog__grid admin-finance-operation-dialog__grid">
          <AdminFinanceCurrencyInput
            value={draft.amount}
            disabled={submitting}
            error={errors.amount}
            controlRef={fieldRef("amount")}
            onChange={(value) => onChange("amount", value)}
          />
          <AdminFinanceSearchableSelect
            label="Способ оплаты"
            required
            value={draft.paymentTypeId}
            options={paymentTypes}
            loading={referencesLoading && !paymentTypes.length}
            disabled={submitting}
            error={errors.paymentTypeId}
            controlRef={fieldRef("paymentTypeId")}
            placeholder="Выберите способ оплаты"
            onChange={(value) => onChange("paymentTypeId", value)}
          />
          <AdminFinanceSearchableSelect
            label="Организация или филиал"
            required
            value={draft.organizationId}
            options={organizations}
            loading={referencesLoading && !organizations.length}
            disabled={submitting}
            error={errors.organizationId}
            controlRef={fieldRef("organizationId")}
            placeholder="Выберите филиал"
            searchPlaceholder="Поиск филиала"
            onChange={(value) => onChange("organizationId", value)}
          />
          <AdminFinanceCounterpartyTypeSelector
            value={draft.counterpartyType}
            onChange={(value) => onChange("counterpartyType", value)}
          />
          <AdminFinanceSearchableSelect
            label="Контрагент"
            value={draft.counterpartyId}
            options={counterpartyOptions}
            disabled={submitting}
            error={errors.counterpartyId}
            controlRef={fieldRef("counterpartyId")}
            placeholder="Не выбран"
            searchPlaceholder="Поиск контрагента"
            emptyText="Контрагенты не найдены"
            onChange={(value) => onChange("counterpartyId", value)}
          />
          <AdminFinanceDateInput
            value={draft.date}
            disabled={submitting}
            error={errors.date}
            controlRef={fieldRef("date")}
            onChange={(value) => onChange("date", value)}
          />
          <AdminFinanceSearchableSelect
            label="Категория"
            required
            value={draft.categoryId}
            options={categories}
            loading={referencesLoading && !categories.length}
            disabled={submitting}
            error={errors.categoryId}
            controlRef={fieldRef("categoryId")}
            placeholder="Выберите категорию"
            searchPlaceholder="Поиск категории"
            onChange={(value) => onChange("categoryId", value)}
          />
          <label className="admin-income-field admin-transaction-field admin-transaction-field--wide admin-finance-comment-field">
            <span>Комментарий</span>
            <textarea
              value={draft.comment}
              disabled={submitting}
              maxLength={ADMIN_FINANCE_COMMENT_LIMIT}
              onChange={(event) => onChange("comment", event.target.value)}
              placeholder="Комментарий к операции"
              rows={3}
            />
            <small>{draft.comment.length}/{ADMIN_FINANCE_COMMENT_LIMIT}</small>
          </label>
        </div>

        {submitError ? <div className="admin-finance-submit-error">{submitError}</div> : null}

        <div className="admin-income-dialog__actions admin-transaction-dialog__actions admin-finance-operation-dialog__actions is-single">
          <button type="submit" className="is-primary" disabled={submitting}>
            {submitting ? loadingText : actionText}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function AdminFinanceFilterDrawer({
  open,
  draft,
  counterpartyOptions,
  categoryOptions,
  onDraftChange,
  onApply,
  onClear,
  onClose,
}) {
  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const previousOverflow = document.body.style.overflow;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="admin-finance-filter-drawer" role="dialog" aria-modal="true" aria-label="Фильтр" onMouseDown={onClose}>
      <form className="admin-finance-filter-panel" onSubmit={onApply} onMouseDown={(event) => event.stopPropagation()}>
        <h3>Фильтр</h3>
        <label className="admin-finance-filter-field">
          <span>Тип операции</span>
          <select value={draft.type} aria-label="Тип операции" onChange={(event) => onDraftChange("type", event.target.value)}>
            <option value="all">Выберите тип</option>
            <option value="income">Приход</option>
            <option value="expense">Расход</option>
          </select>
        </label>
        <label className="admin-finance-filter-field">
          <span>Контрагент</span>
          <select value={draft.counterparty} aria-label="Контрагент" onChange={(event) => onDraftChange("counterparty", event.target.value)}>
            <option value="all">Фильтр по контрагентам</option>
            {counterpartyOptions.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <label className="admin-finance-filter-field">
          <span>Категория</span>
          <select value={draft.category} aria-label="Категория" onChange={(event) => onDraftChange("category", event.target.value)}>
            <option value="all">Фильтр по категории</option>
            {categoryOptions.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <div className="admin-finance-filter-actions">
          <button type="submit" className="is-apply">Фильтровать</button>
          <button type="button" className="is-clear" onClick={onClear}>Очистить</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function AdminFinanceOperationsPage({ search, onNotify }) {
  const [range, setRange] = useState(() => buildAdminDashboardDateRange("Этот месяц"));
  const [operations, setOperations] = useState(() => financeOperationRows);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [counterpartyFilter, setCounterpartyFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [filterDraft, setFilterDraft] = useState({ type: "all", counterparty: "all", category: "all" });
  const [financeModalOpen, setFinanceModalOpen] = useState(false);
  const [financeModalClosing, setFinanceModalClosing] = useState(false);
  const [financeModalType, setFinanceModalType] = useState("income");
  const [financeDraft, setFinanceDraft] = useState(() => createAdminFinanceTransactionDraft("income"));
  const [financeInitialDraft, setFinanceInitialDraft] = useState(() => createAdminFinanceTransactionDraft("income"));
  const [financeErrors, setFinanceErrors] = useState({});
  const [financeSubmitError, setFinanceSubmitError] = useState("");
  const [financeSubmitting, setFinanceSubmitting] = useState(false);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [paymentTypes, setPaymentTypes] = useState(() => ADMIN_FINANCE_FALLBACK_PAYMENT_TYPES);
  const [organizations, setOrganizations] = useState([]);
  const [categoriesByKind, setCategoriesByKind] = useState(() => ({
    income: ADMIN_FINANCE_FALLBACK_INCOME_CATEGORIES,
    expense: [],
  }));
  const [counterpartiesByType, setCounterpartiesByType] = useState(() => (
    Object.fromEntries(ADMIN_FINANCE_COUNTERPARTY_TYPES.map((item) => [item.value, []]))
  ));
  const financeFieldRefs = useRef({});
  const financeCloseTimerRef = useRef(null);
  const query = (search || "").trim().toLowerCase();
  const datePresets = useMemo(() => (
    ADMIN_DASHBOARD_DATE_PRESET_LABELS.map((label) => ({
      label,
      getRange: () => buildAdminDashboardDateRange(label),
    }))
  ), []);
  const transactionCategories = categoriesByKind[financeModalType] || [];

  useEffect(() => () => {
    if (financeCloseTimerRef.current) {
      window.clearTimeout(financeCloseTimerRef.current);
    }
  }, []);

  const loadFinanceOperations = useCallback(async () => {
    const normalizedRange = normalizeAdminReportRange(range);
    const params = {
      date_from: adminReportDateToInputDate(normalizedRange.start),
      date_to: adminReportDateToInputDate(normalizedRange.end),
    };
    try {
      const { data } = await adminFinanceApi.listTransactions(params);
      const items = extractAdminFinanceItems(data);
      if (items.length) {
        setOperations(items.map(normalizeAdminFinanceTransaction));
      }
      return items;
    } catch {
      return null;
    }
  }, [range]);

  useEffect(() => {
    loadFinanceOperations();
  }, [loadFinanceOperations]);

  useEffect(() => {
    let mounted = true;

    async function loadReferences() {
      setReferencesLoading(true);
      const [
        paymentResult,
        organizationResult,
        incomeCategoryResult,
        expenseCategoryResult,
        ...counterpartyResults
      ] = await Promise.allSettled([
        adminFinanceApi.listPaymentTypes(),
        adminFinanceApi.listOrganizations(),
        adminFinanceApi.listCategories("income"),
        adminFinanceApi.listCategories("expense"),
        ...ADMIN_FINANCE_COUNTERPARTY_TYPES.map((item) => adminFinanceApi.listCounterparties(item.value)),
      ]);
      if (!mounted) return;

      const nextPaymentTypes = paymentResult.status === "fulfilled"
        ? extractAdminFinanceItems(paymentResult.value.data)
          .filter((item) => item.status !== false)
          .map((item, index) => normalizeAdminFinanceOption(item, index, ["name", "type"]))
        : [];
      const nextOrganizations = organizationResult.status === "fulfilled"
        ? extractAdminFinanceItems(organizationResult.value.data)
          .filter((item) => item.status !== "blocked")
          .map((item, index) => normalizeAdminFinanceOption(item, index, ["name", "company_name"]))
        : [];
      const nextIncomeCategories = incomeCategoryResult.status === "fulfilled"
        ? extractAdminFinanceItems(incomeCategoryResult.value.data)
          .filter((item) => item.kind === "income" && item.status !== false)
          .map((item, index) => ({ ...normalizeAdminFinanceOption(item, index, ["name"]), kind: "income" }))
        : [];
      const nextExpenseCategories = expenseCategoryResult.status === "fulfilled"
        ? extractAdminFinanceItems(expenseCategoryResult.value.data)
          .filter((item) => item.kind === "expense" && item.status !== false)
          .map((item, index) => ({ ...normalizeAdminFinanceOption(item, index, ["name"]), kind: "expense" }))
        : [];
      const nextCounterparties = {};
      ADMIN_FINANCE_COUNTERPARTY_TYPES.forEach((item, index) => {
        const result = counterpartyResults[index];
        nextCounterparties[item.value] = result?.status === "fulfilled"
          ? extractAdminFinanceItems(result.value.data)
            .map((row, rowIndex) => normalizeAdminFinanceOption(row, rowIndex, ["full_name", "name", "phone"]))
          : [];
      });

      setPaymentTypes(nextPaymentTypes.length ? nextPaymentTypes : ADMIN_FINANCE_FALLBACK_PAYMENT_TYPES);
      setOrganizations(nextOrganizations);
      setCategoriesByKind({
        income: nextIncomeCategories.length ? nextIncomeCategories : ADMIN_FINANCE_FALLBACK_INCOME_CATEGORIES,
        expense: nextExpenseCategories,
      });
      setCounterpartiesByType(nextCounterparties);
      setReferencesLoading(false);
    }

    loadReferences();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!financeModalOpen || typeof document === "undefined") return undefined;
    const previousOverflow = document.body.style.overflow;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestCloseFinanceModal();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [financeModalOpen, financeDraft, financeInitialDraft, financeSubmitting, financeModalClosing]);

  const filterCounterpartyOptions = useMemo(
    () => Array.from(new Set(operations.map((row) => row.counterparty).filter((value) => value && value !== "—")))
      .sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" })),
    [operations],
  );
  const filterCategoryOptions = useMemo(
    () => Array.from(new Set(operations.map((row) => row.category).filter((value) => value && value !== "—")))
      .sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" })),
    [operations],
  );
  const financeFiltersActive = typeFilter !== "all" || counterpartyFilter !== "all" || categoryFilter !== "all";
  const financeTotals = useMemo(() => operations.reduce((acc, row) => {
    if (row.amount < 0) {
      acc.expense += Math.abs(Number(row.amount || 0));
    } else {
      acc.income += Number(row.amount || 0);
    }
    return acc;
  }, { income: 0, expense: 0 }), [operations]);
  const filteredOperations = operations.filter((row) => {
    const typeMatches = typeFilter === "all" || (typeFilter === "income" ? row.amount > 0 : row.amount < 0);
    const counterpartyMatches = counterpartyFilter === "all" || row.counterparty === counterpartyFilter;
    const categoryMatches = categoryFilter === "all" || row.category === categoryFilter;
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
    return typeMatches && counterpartyMatches && categoryMatches && queryMatches;
  });
  function deleteOperation(row) {
    setOperations((current) => current.filter((item) => item.id !== row.id));
    onNotify?.(`Операция ${formatSignedFinanceAmount(row.amount)} удалена локально.`);
  }

  function fieldRef(name) {
    return (node) => {
      if (node) financeFieldRefs.current[name] = node;
    };
  }

  function focusFirstInvalidField(errors) {
    const firstField = ADMIN_FINANCE_REQUIRED_FIELDS.find((field) => errors[field]);
    if (!firstField) return;
    window.requestAnimationFrame(() => {
      financeFieldRefs.current[firstField]?.focus?.();
    });
  }

  function buildFinanceDraft(operationType = "income") {
    return createAdminFinanceTransactionDraft(operationType, {
      paymentTypeId: paymentTypes[0]?.id || "",
      organizationId: organizations[0]?.id || "",
      categoryId: (categoriesByKind[operationType] || [])[0]?.id || "",
    });
  }

  function openFinanceModal(operationType = "income") {
    if (financeCloseTimerRef.current) {
      window.clearTimeout(financeCloseTimerRef.current);
      financeCloseTimerRef.current = null;
    }
    const nextDraft = buildFinanceDraft(operationType);
    financeFieldRefs.current = {};
    setFinanceModalType(operationType);
    setFinanceDraft(nextDraft);
    setFinanceInitialDraft(nextDraft);
    setFinanceErrors({});
    setFinanceSubmitError("");
    setFinanceModalClosing(false);
    setFinanceModalOpen(true);
  }

  function closeFinanceModal(afterClose) {
    if (financeCloseTimerRef.current) return;
    setFinanceModalClosing(true);
    financeCloseTimerRef.current = window.setTimeout(() => {
      financeCloseTimerRef.current = null;
      setFinanceModalOpen(false);
      setFinanceModalClosing(false);
      setFinanceErrors({});
      setFinanceSubmitError("");
      setFinanceSubmitting(false);
      afterClose?.();
    }, ADMIN_FINANCE_MODAL_ANIMATION_MS);
  }

  function requestCloseFinanceModal() {
    if (financeSubmitting || financeModalClosing) return;
    closeFinanceModal();
  }

  function openFinanceFilters() {
    setFilterDraft({ type: typeFilter, counterparty: counterpartyFilter, category: categoryFilter });
    setFiltersOpen(true);
  }

  function toggleFinanceFilters() {
    if (filtersOpen) {
      setFiltersOpen(false);
    } else {
      openFinanceFilters();
    }
  }

  function updateFilterDraft(field, value) {
    setFilterDraft((current) => ({ ...current, [field]: value }));
  }

  function applyFinanceFilters(event) {
    event.preventDefault();
    setTypeFilter(filterDraft.type);
    setCounterpartyFilter(filterDraft.counterparty);
    setCategoryFilter(filterDraft.category);
    setFiltersOpen(false);
  }

  function clearFinanceFilters() {
    const emptyFilters = { type: "all", counterparty: "all", category: "all" };
    setFilterDraft(emptyFilters);
    setTypeFilter("all");
    setCounterpartyFilter("all");
    setCategoryFilter("all");
  }

  function updateFinanceDraft(field, value) {
    setFinanceDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "counterpartyType") {
        next.counterpartyId = "";
      }
      return next;
    });
    setFinanceErrors((current) => {
      const next = { ...current };
      delete next[field];
      if (field === "counterpartyType") delete next.counterpartyId;
      return next;
    });
    setFinanceSubmitError("");
  }

  async function saveFinanceOperation(event) {
    event.preventDefault();
    if (financeSubmitting) return;

    const errors = validateAdminFinanceDraft(financeDraft);
    if (Object.keys(errors).length) {
      setFinanceErrors(errors);
      focusFirstInvalidField(errors);
      return;
    }

    const selectedPaymentType = paymentTypes.find((item) => item.id === financeDraft.paymentTypeId);
    const selectedOrganization = organizations.find((item) => item.id === financeDraft.organizationId);
    const selectedCounterparty = (counterpartiesByType[financeDraft.counterpartyType] || [])
      .find((item) => item.id === financeDraft.counterpartyId);
    const selectedCategory = transactionCategories.find((item) => item.id === financeDraft.categoryId);
    const payload = {
      direction: financeDraft.operationType,
      amount: parseAdminFinanceAmount(financeDraft.amount),
      date: adminFinanceDateForApi(financeDraft.date),
      comment: financeDraft.comment.trim() || null,
    };

    if (selectedPaymentType?.apiId) payload.payment_type_id = selectedPaymentType.apiId;
    if (selectedOrganization?.apiId) payload.organization_id = selectedOrganization.apiId;
    if (selectedCounterparty?.apiId) payload.counterparty_id = selectedCounterparty.apiId;
    if (selectedCategory?.apiId) payload.category_id = selectedCategory.apiId;

    setFinanceSubmitting(true);
    setFinanceSubmitError("");

    try {
      const idempotencyKey = `admin-finance-${financeDraft.operationType}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const { data } = await adminFinanceApi.createTransaction(payload, idempotencyKey);
      const refreshedItems = await loadFinanceOperations();
      if ((!refreshedItems || !refreshedItems.length) && data?.id) {
        setOperations((current) => [
          normalizeAdminFinanceTransaction({
            ...data,
            payment_type_name: selectedPaymentType?.label,
            organization_name: selectedOrganization?.label,
            counterparty_name: selectedCounterparty?.label,
            category_name: selectedCategory?.label,
          }),
          ...current.filter((row) => row.id !== data.id),
        ]);
      }
      const nextDraft = buildFinanceDraft(financeDraft.operationType);
      closeFinanceModal(() => {
        setFinanceDraft(nextDraft);
        setFinanceInitialDraft(nextDraft);
      });
      onNotify?.(financeDraft.operationType === "income" ? "Приход успешно добавлен" : "Расход успешно добавлен");
    } catch (error) {
      const message = getAdminFinanceBackendMessage(error);
      setFinanceSubmitError(message);
      onNotify?.(message);
    } finally {
      setFinanceSubmitting(false);
    }
  }

  return (
    <section className="admin-finance-page">
      <h2 className="sr-only">Денежные операции</h2>

      <div className="admin-finance-toolbar">
        <div className="admin-finance-date">
          <ReportDateRangePicker
            value={range}
            onChange={(nextRange) => setRange(normalizeAdminReportRange(nextRange))}
            buttonClassName="admin-finance-date-button"
            showTime={false}
            presets={datePresets}
            formatButtonLabel={formatAdminDashboardDateRangeButton}
            blockPageScrollOnWheel
            applyPresetOnSelect
            showMenuOk={false}
            leadingIconName="bi-calendar3"
            leadingIconSize={16}
          />
        </div>
        <div className="admin-finance-summary is-income">
          <span>Приход</span>
          <strong>{formatCurrency(financeTotals.income)}</strong>
        </div>
        <div className="admin-finance-summary is-expense">
          <span>Расход</span>
          <strong>{formatCurrency(financeTotals.expense)}</strong>
        </div>
        <div className="admin-finance-actions">
          <button type="button" className="admin-finance-action is-income" onClick={() => openFinanceModal("income")}>
            <Icon name="bi-plus-lg" size={16} />
            <span>ПРИХОД</span>
          </button>
          <button type="button" className="admin-finance-action is-expense" onClick={() => openFinanceModal("expense")}>
            <Icon name="bi-dash-lg" size={16} />
            <span>РАСХОД</span>
          </button>
          <button type="button" className="admin-finance-action is-export" onClick={() => onNotify?.("Денежные операции подготовлены для Excel.")}>
            <Icon name="bi-file-earmark-excel" size={16} />
            <span>Скачать на EXCEL</span>
          </button>
          <button type="button" className={`admin-finance-action is-filter ${filtersOpen || financeFiltersActive ? "is-active" : ""}`} onClick={toggleFinanceFilters}>
            <Icon name="bi-sliders" size={16} />
            <span>Фильтровать</span>
          </button>
        </div>
      </div>

      <div className="admin-finance-table-shell">
        <table className="admin-finance-table">
          <colgroup>
            <col className="admin-finance-col-date" />
            <col className="admin-finance-col-amount" />
            <col className="admin-finance-col-type" />
            <col className="admin-finance-col-payment" />
            <col className="admin-finance-col-counterparty" />
            <col className="admin-finance-col-category" />
            <col className="admin-finance-col-organization" />
            <col className="admin-finance-col-comment" />
            <col className="admin-finance-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Сумма</th>
              <th>Тип</th>
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
                <td><span className={`admin-finance-operation-type ${row.amount < 0 ? "is-expense" : "is-income"}`}>{row.type}</span></td>
                <td>{row.paymentType}</td>
                <td>{row.counterparty}</td>
                <td><span className="admin-finance-tag">{row.category}</span></td>
                <td>{row.organization}</td>
                <td className="admin-finance-comment"><span>{row.comment}</span></td>
                <td>
                  <button type="button" className="admin-finance-delete" onClick={() => deleteOperation(row)} aria-label="Удалить операцию">
                    <Icon name="bi-trash3" size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {!filteredOperations.length ? (
              <tr>
                <td colSpan="9" className="admin-finance-empty">Операции не найдены.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <AdminFinanceFilterDrawer
        open={filtersOpen}
        draft={filterDraft}
        counterpartyOptions={filterCounterpartyOptions}
        categoryOptions={filterCategoryOptions}
        onDraftChange={updateFilterDraft}
        onApply={applyFinanceFilters}
        onClear={clearFinanceFilters}
        onClose={() => setFiltersOpen(false)}
      />
      <AdminFinanceTransactionModal
        open={financeModalOpen}
        closing={financeModalClosing}
        operationType={financeModalType}
        draft={financeDraft}
        errors={financeErrors}
        submitError={financeSubmitError}
        submitting={financeSubmitting}
        referencesLoading={referencesLoading}
        paymentTypes={paymentTypes}
        organizations={organizations}
        categories={transactionCategories}
        counterparties={counterpartiesByType}
        onChange={updateFinanceDraft}
        onCloseRequest={requestCloseFinanceModal}
        onSubmit={saveFinanceOperation}
        fieldRef={fieldRef}
      />
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
  emptyText,
  apiEndpoint,
}) {
  const fallbackCategories = useMemo(() => (initialRows || []).map((row, index) => ({
    id: row.id || `${localPrefix}-${index + 1}`,
    name: row.name || "",
    status: row.status || "#активно",
    locked: Boolean(row.locked),
  })), [initialRows, localPrefix]);
  const [categories, setCategories] = useState(fallbackCategories);
  const [editor, setEditor] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftStatus, setDraftStatus] = useState("#активно");
  const query = search.trim().toLowerCase();

  useEffect(() => {
    setCategories(fallbackCategories);
  }, [fallbackCategories]);

  useEffect(() => {
    if (!apiEndpoint) return;
    adminApi.get(apiEndpoint, { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (items.length) {
          setCategories(items.map((r, index) => {
            const rawStatus = typeof r.status === "string" ? r.status.toLowerCase() : r.status;
            const isOff = rawStatus === false || r.is_active === false || ["inactive", "disabled", "#неактивно", "#отключено"].includes(rawStatus);
            return {
              id: String(r.id ?? r.category_id ?? `${localPrefix}-api-${index + 1}`),
              name: r.name || r.title || "",
              status: isOff ? "#отключено" : "#активно",
              locked: Boolean(r.is_system || r.locked),
            };
          }).filter((row) => row.name));
        }
      })
      .catch(() => {});
  }, [apiEndpoint, localPrefix]);

  const filteredCategories = categories.filter((row) => (
    !query || row.name.toLowerCase().includes(query) || row.status.toLowerCase().includes(query)
  ));
  const activeCount = categories.filter((row) => row.status === "#активно").length;
  const lockedCount = categories.filter((row) => row.locked).length;
  const customCount = Math.max(categories.length - lockedCount, 0);
  const sectionNote = localPrefix === "income"
    ? "Категории для приходных операций"
    : "Категории для расходных операций";

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
    <section className="admin-income-page admin-finance-category-page">
      <div className="admin-income-head">
        <div className="admin-income-head__main">
          <div className="admin-income-title">
            <span aria-hidden="true">
              <Icon name="bi-tags" size={18} />
            </span>
            <div>
              <h2>{title}</h2>
              <p>{sectionNote}</p>
            </div>
          </div>
          <div className="admin-income-stats" aria-label="Сводка категорий">
            <span><strong>{categories.length}</strong> всего</span>
            <span><strong>{activeCount}</strong> активные</span>
            <span><strong>{customCount}</strong> свои</span>
            <span><strong>{lockedCount}</strong> системные</span>
          </div>
        </div>
        <button type="button" className="admin-income-add" onClick={addCategory}>
          <Icon name="bi-plus-lg" size={15} />
          <span>Добавить</span>
        </button>
      </div>

      <div className="admin-income-table-shell">
        <div className="admin-income-list-head" aria-hidden="true">
          <span>Категория</span>
          <span>Статус</span>
          <span>Действия</span>
        </div>
        <div className="admin-income-list" role="list">
          {filteredCategories.map((row) => (
            <div className={`admin-income-row ${row.locked ? "is-locked" : ""}`} role="listitem" key={row.id}>
              <div className="admin-income-name">
                <span className="admin-income-category-dot" aria-hidden="true">
                  <Icon name={row.locked ? "bi-shield-lock" : "bi-tags"} size={14} />
                </span>
                <span className="admin-income-name__text">
                  <strong>{row.name}</strong>
                  <small>{row.locked ? "Системная" : "Пользовательская"}</small>
                </span>
              </div>
              <div className="admin-income-row__actions">
                <span className={`admin-income-status ${row.status !== "#активно" ? "is-off" : ""}`}>{row.status}</span>
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
      </div>

      {editor ? (
        <div className="admin-income-modal" role="dialog" aria-modal="true" aria-label={editor.mode === "create" ? modalCreateTitle : modalEditTitle} onClick={closeEditor}>
          <form className="admin-income-dialog" onSubmit={saveCategory} onClick={(event) => event.stopPropagation()}>
            <div className="admin-income-dialog__head">
              <div>
                <h3>{editor.mode === "create" ? modalCreateTitle : modalEditTitle}</h3>
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
                placeholder="Введите название"
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
              <button type="submit" className="is-primary">{editor.mode === "create" ? "Добавить" : "Сохранить"}</button>
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
      modalCreateTitle="Добавить категорию приходов"
      modalEditTitle="Изменить категорию приходов"
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
      modalEditTitle="Изменить категорию расходов"
      createDescription="Создайте новую категорию для расходных операций."
      editDescription="Измените название и статус категории расходов."
      emptyText="Категории расходов не найдены."
      apiEndpoint="/finance/transaction-categories?kind=expense"
    />
  );
}

function AdminPaymentMethodsPage({ search, onNotify }) {
  const paymentFallbackRows = useMemo(() => paymentMethodRows.map((row, index) => ({
    id: row.id || `payment-${index + 1}`,
    sort: Number(row.sort) || index + 1,
    name: row.name || "",
    type: row.type || "Карта",
    status: row.status || "#активно",
    vip: Boolean(row.vip),
  })), []);
  const [methods, setMethods] = useState(paymentFallbackRows);
  const [editor, setEditor] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState("Карта");
  const [draftStatus, setDraftStatus] = useState("#активно");
  const [draftVip, setDraftVip] = useState(false);
  const query = search.trim().toLowerCase();

  useEffect(() => {
    setMethods(paymentFallbackRows);
  }, [paymentFallbackRows]);

  useEffect(() => {
    adminApi.get("/finance/payment-types", { params: { size: 100 } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (items.length) {
          setMethods(items.map((r, index) => ({
            id: String(r.id ?? r.payment_type_id ?? `payment-api-${index + 1}`),
            sort: Number(r.sort_order ?? r.sort ?? index + 1) || index + 1,
            name: r.name || r.title || "",
            type: r.type || r.kind || "Карта",
            status: r.status !== false && r.is_active !== false ? "#активно" : "#неактивно",
            vip: Boolean(r.is_vip || r.vip),
          })).filter((row) => row.name));
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
  const historyFallbackRows = useMemo(() => financeHistoryRows.map((row, index) => ({
    ...row,
    number: index + 1,
  })), []);
  const [rows, setRows] = useState(historyFallbackRows);
  const [page, setPage] = useState(1);
  const historyScrollRef = useRef(null);
  const [historyScroll, setHistoryScroll] = useState({
    max: 0,
    thumbPercent: 100,
    leftPercent: 0,
  });
  const pageSize = 15;
  const query = search.trim().toLowerCase();

  const updateHistoryScroll = useCallback(() => {
    const scroller = historyScrollRef.current;
    if (!scroller) return;

    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const thumbPercent = max
      ? Math.max(14, Math.min(100, (scroller.clientWidth / scroller.scrollWidth) * 100))
      : 100;
    const leftPercent = max ? (scroller.scrollLeft / max) * (100 - thumbPercent) : 0;

    setHistoryScroll((current) => {
      const next = {
        max: Math.round(max),
        thumbPercent: Number(thumbPercent.toFixed(3)),
        leftPercent: Number(leftPercent.toFixed(3)),
      };

      return current.max === next.max
        && current.thumbPercent === next.thumbPercent
        && current.leftPercent === next.leftPercent
        ? current
        : next;
    });
  }, []);

  useEffect(() => {
    setRows(historyFallbackRows);

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
      .catch(() => setRows(historyFallbackRows));
  }, [historyFallbackRows]);

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
    updateHistoryScroll();
    window.addEventListener("resize", updateHistoryScroll);
    return () => window.removeEventListener("resize", updateHistoryScroll);
  }, [pageRows.length, updateHistoryScroll]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function goToPage(nextPage) {
    const safePage = Math.min(Math.max(nextPage, 1), totalPages);
    setPage(safePage);
  }

  function scrollHistoryBy(direction) {
    const scroller = historyScrollRef.current;
    if (!scroller) return;
    scroller.scrollBy({
      left: direction * Math.max(160, scroller.clientWidth * 0.44),
      behavior: "smooth",
    });
  }

  function handleHistoryScrollbarPointerDown(event) {
    const scroller = historyScrollRef.current;
    if (!scroller || historyScroll.max <= 0) return;

    const track = event.currentTarget;
    const rect = track.getBoundingClientRect();
    const thumbWidth = Math.max(24, rect.width * (historyScroll.thumbPercent / 100));
    const maxThumbLeft = Math.max(1, rect.width - thumbWidth);
    const currentThumbLeft = (scroller.scrollLeft / historyScroll.max) * maxThumbLeft;
    const target = event.target;
    const isThumb = target instanceof Element && target.closest(".admin-history-scrollbar__thumb");
    const dragOffset = isThumb
      ? event.clientX - rect.left - currentThumbLeft
      : thumbWidth / 2;

    function setScrollFromClientX(clientX) {
      const nextThumbLeft = Math.min(
        Math.max(clientX - rect.left - dragOffset, 0),
        maxThumbLeft,
      );
      scroller.scrollLeft = (nextThumbLeft / maxThumbLeft) * historyScroll.max;
    }

    setScrollFromClientX(event.clientX);

    function handlePointerMove(moveEvent) {
      setScrollFromClientX(moveEvent.clientX);
    }

    function handlePointerUp() {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    event.preventDefault();
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

      <div
        className="admin-history-table-wrap"
        ref={historyScrollRef}
        onScroll={updateHistoryScroll}
        onWheelCapture={keepWheelInsideScroller}
      >
        <table className="admin-history-table" id="admin-history-table">
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

      <div className="admin-history-scrollbar" aria-label="Р“РѕСЂРёР·РѕРЅС‚Р°Р»СЊРЅР°СЏ РїСЂРѕРєСЂСѓС‚РєР° С‚Р°Р±Р»РёС†С‹">
        <button
          type="button"
          className="admin-history-scrollbar__button is-prev"
          onClick={() => scrollHistoryBy(-1)}
          disabled={historyScroll.max <= 0}
          aria-label="РџСЂРѕРєСЂСѓС‚РёС‚СЊ РІР»РµРІРѕ"
        />
        <div
          className="admin-history-scrollbar__track"
          role="scrollbar"
          aria-controls="admin-history-table"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={historyScroll.max}
          aria-valuenow={historyScroll.max ? Math.round((historyScroll.leftPercent / Math.max(1, 100 - historyScroll.thumbPercent)) * historyScroll.max) : 0}
          onPointerDown={handleHistoryScrollbarPointerDown}
        >
          <span
            className="admin-history-scrollbar__thumb"
            style={{
              width: `${historyScroll.thumbPercent}%`,
              left: `${historyScroll.leftPercent}%`,
            }}
          />
        </div>
        <button
          type="button"
          className="admin-history-scrollbar__button is-next"
          onClick={() => scrollHistoryBy(1)}
          disabled={historyScroll.max <= 0}
          aria-label="РџСЂРѕРєСЂСѓС‚РёС‚СЊ РІРїСЂР°РІРѕ"
        />
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

function CategoryPage({ active, rowsOverride, search, onCreate, onRowDetail, onNotify, onInnerBackChange }) {
  const content = categoryContent[active] || categoryContent["org-list"];
  const { apiRows } = useAdminData(active);
  if (active === "org-list") {
    return <OrganizationDirectoryPage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "org-status") {
    return <OrganizationStatusPage search={search} onNotify={onNotify} />;
  }
  if (active === "storage-income") {
    return <StorageIncomePage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "storage-expense") {
    return <StorageExpensePage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "storage-balance") {
    return <StorageBalancePage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "storage-income-journal") {
    return <StorageIncomeJournalPage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "storage-writeoff") {
    return <StorageWriteoffPage search={search} onNotify={onNotify} />;
  }
  if (active === "storage-inventory") {
    return <StorageInventoryPage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "nom-product") {
    return <ProductNomenclaturePage search={search} onNotify={onNotify} />;
  }
  if (active === "nom-sale-category") {
    return <SaleCategoryPage search={search} onNotify={onNotify} />;
  }
  if (active === "nom-orders") {
    return <OrdersNomenclaturePage search={search} onNotify={onNotify} />;
  }
  if (active === "nom-unit") {
    return <UnitNomenclaturePage search={search} onNotify={onNotify} />;
  }
  if (active === "hb-countries" || active === "hb-regions" || active === "hb-districts") {
    return <HandbookLocationPage active={active} search={search} onNotify={onNotify} />;
  }
  if (active === "srv-employees") {
    return <AdminEmployeesPage search={search} onNotify={onNotify} />;
  }
  if (active === "srv-source") {
    return <AdminSourcesPage search={search} onNotify={onNotify} />;
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

function keepWheelInsideScroller(event) {
  const scroller = event.currentTarget;
  const horizontalDelta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
  const verticalDelta = event.shiftKey ? 0 : event.deltaY;

  if (!horizontalDelta && !verticalDelta) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  scroller.scrollLeft += horizontalDelta;
  scroller.scrollTop += verticalDelta;
}

const transactionColumnKeys = [
  "id", "uuid", "date", "orgId", "name", "payType",
  "amount", "kind", "status", "paymentFor", "comment", "actions",
];

const TRANSACTION_COLUMN_SETTINGS_STORAGE_KEY = "marjon.admin.transactions.columns.v1";
const TRANSACTION_COLUMN_SETTINGS_LAYOUT_VERSION = 2;
const defaultTransactionColumnOrder = [
  "id", "uuid", "name", "date", "orgId", "payType",
  "amount", "kind", "status", "paymentFor", "comment", "actions",
];

function normalizeTransactionColumnKeys(keys) {
  const seen = new Set();
  return (Array.isArray(keys) ? keys : []).filter((key) => {
    if (!transactionColumnKeys.includes(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeTransactionColumnSettings(settings) {
  const savedOrder = settings?.layoutVersion === TRANSACTION_COLUMN_SETTINGS_LAYOUT_VERSION
    ? normalizeTransactionColumnKeys(settings?.order)
    : [];
  const order = [
    ...savedOrder,
    ...defaultTransactionColumnOrder.filter((key) => !savedOrder.includes(key)),
    ...transactionColumnKeys.filter((key) => !savedOrder.includes(key) && !defaultTransactionColumnOrder.includes(key)),
  ];
  const visibleSource = Array.isArray(settings) ? settings : settings?.visible;
  const visible = normalizeTransactionColumnKeys(visibleSource || transactionColumnKeys)
    .filter((key) => order.includes(key));

  return {
    layoutVersion: TRANSACTION_COLUMN_SETTINGS_LAYOUT_VERSION,
    order,
    visible: visible.length ? visible : [order[0]],
  };
}

function loadTransactionColumnSettings() {
  if (typeof window === "undefined") {
    return normalizeTransactionColumnSettings();
  }

  try {
    return normalizeTransactionColumnSettings(JSON.parse(window.localStorage.getItem(TRANSACTION_COLUMN_SETTINGS_STORAGE_KEY)));
  } catch {
    return normalizeTransactionColumnSettings();
  }
}

function saveTransactionColumnSettings(settings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      TRANSACTION_COLUMN_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeTransactionColumnSettings(settings)),
    );
  } catch {
    // localStorage can be unavailable in private mode; the current session still keeps the setting.
  }
}

function formatTransactionAmountParts(value) {
  const source = String(value ?? "").replace(/\u00a0/g, " ").trim();
  const currencyMatch = source.match(/\s+([A-Za-zА-Яа-я]{3,})$/);
  const currency = currencyMatch?.[1] || "UZS";
  const numberSource = currencyMatch ? source.slice(0, currencyMatch.index).trim() : source;
  const numericValue = Number(numberSource.replace(/[^\d-]/g, ""));

  if (!Number.isFinite(numericValue)) {
    return { value: numberSource || "0", currency };
  }

  return {
    value: formatDemoMoney(numericValue),
    currency,
  };
}

function transactionDateToInputValue(value) {
  const match = String(value || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (!match) {
    return "";
  }

  const [, day, month, year, hour = "00", minute = "00"] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function transactionInputDateToDisplay(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    return value || "";
  }

  const [, year, month, day, hour, minute] = match;
  return `${day}.${month}.${year} ${hour}:${minute}`;
}

function transactionAmountToDraftValue(value) {
  const amount = formatTransactionAmountParts(value);
  return amount.value;
}

function formatTransactionAmountDraft(value) {
  const numericValue = Number(String(value ?? "").replace(/[^\d-]/g, ""));
  return Number.isFinite(numericValue) ? formatDemoMoney(Math.abs(numericValue)) : "0";
}

function AdminPageSizeDropdown({ value, options, onChange }) {
  const dropdownRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutside(event) {
      if (!dropdownRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectOption(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div className={`admin-page-size ${open ? "is-open" : ""}`} ref={dropdownRef}>
      <button
        className="admin-page-size__button"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="admin-page-size__label">Строк</span>
        <strong>{value}</strong>
        <Icon name="bi-chevron-down" size={14} />
      </button>
      {open ? (
        <div className="admin-page-size__menu" role="listbox" aria-label="Количество строк">
          {options.map((option) => (
            <button
              className={`admin-page-size__option ${option === value ? "is-selected" : ""}`}
              type="button"
              role="option"
              aria-selected={option === value}
              key={option}
              onClick={() => selectOption(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const demoTransactionSeeds = [
  {
    id: 1,
    uuid: "demo-marjon-0001",
    date: "15.07.2026 16:42",
    orgId: "1003001",
    name: "Marjon Cafe - Yunusabad",
    payType: "Payme",
    amount: "2 450 000 UZS",
    kind: "Приход",
    status: "PAID",
    paymentFor: "Обеденный зал",
    comment: "Демо: столы 4-7",
  },
  {
    id: 2,
    uuid: "demo-marjon-0002",
    date: "15.07.2026 15:18",
    orgId: "1003001",
    name: "Marjon Cafe - Chilonzor",
    payType: "Uzcard",
    amount: "1 860 000 UZS",
    kind: "Приход",
    status: "PAID",
    paymentFor: "Банкет",
    comment: "Демо: предоплата",
  },
  {
    id: 3,
    uuid: "demo-marjon-0003",
    date: "15.07.2026 14:05",
    orgId: "1003001",
    name: "Marjon Cafe - Yunusabad",
    payType: "Наличные",
    amount: "740 000 UZS",
    kind: "Приход",
    status: "PAID",
    paymentFor: "Доставка",
    comment: "Демо: курьерская смена",
  },
  {
    id: 4,
    uuid: "demo-marjon-0004",
    date: "15.07.2026 12:34",
    orgId: "1003001",
    name: "Marjon Cafe - Chilonzor",
    payType: "Humo",
    amount: "3 210 000 UZS",
    kind: "Приход",
    status: "PAID",
    paymentFor: "Зал и летняя терраса",
    comment: "Демо: обеденный пик",
  },
  {
    id: 5,
    uuid: "demo-marjon-0005",
    date: "15.07.2026 11:20",
    orgId: "1003001",
    name: "Marjon Cafe - Yunusabad",
    payType: "Click",
    amount: "580 000 UZS",
    kind: "Приход",
    status: "PAID",
    paymentFor: "Кофе-бар",
    comment: "Демо: утренние продажи",
  },
  {
    id: 6,
    uuid: "demo-marjon-0006",
    date: "14.07.2026 22:10",
    orgId: "1003001",
    name: "Marjon Cafe - Chilonzor",
    payType: "Payme",
    amount: "4 980 000 UZS",
    kind: "Приход",
    status: "PAID",
    paymentFor: "Вечерняя смена",
    comment: "Демо: закрытие смены",
  },
  {
    id: 7,
    uuid: "demo-marjon-0007",
    date: "14.07.2026 19:46",
    orgId: "1003001",
    name: "Marjon Cafe - Yunusabad",
    payType: "Uzcard",
    amount: "2 125 000 UZS",
    kind: "Приход",
    status: "PAID",
    paymentFor: "Семейный зал",
    comment: "Демо: бронирование",
  },
  {
    id: 8,
    uuid: "demo-marjon-0008",
    date: "14.07.2026 17:02",
    orgId: "1003001",
    name: "Marjon Cafe - Chilonzor",
    payType: "Наличные",
    amount: "690 000 UZS",
    kind: "Расход",
    status: "PAID",
    paymentFor: "Хозяйственные расходы",
    comment: "Демо: расходные материалы",
  },
  {
    id: 9,
    uuid: "demo-marjon-0009",
    date: "14.07.2026 13:30",
    orgId: "1003001",
    name: "Marjon Cafe - Yunusabad",
    payType: "Humo",
    amount: "1 340 000 UZS",
    kind: "Приход",
    status: "PAID",
    paymentFor: "Бизнес-ланч",
    comment: "Демо: корпоративный заказ",
  },
  {
    id: 10,
    uuid: "demo-marjon-0010",
    date: "13.07.2026 21:15",
    orgId: "1003001",
    name: "Marjon Cafe - Chilonzor",
    payType: "Click",
    amount: "3 780 000 UZS",
    kind: "Приход",
    status: "PAID",
    paymentFor: "Вечерний зал",
    comment: "Демо: пятничная загрузка",
  },
  {
    id: 11,
    uuid: "demo-marjon-0011",
    date: "13.07.2026 18:06",
    orgId: "1003001",
    name: "Marjon Cafe - Yunusabad",
    payType: "Payme",
    amount: "920 000 UZS",
    kind: "Приход",
    status: "PAID",
    paymentFor: "Доставка",
    comment: "Демо: онлайн-меню",
  },
  {
    id: 12,
    uuid: "demo-marjon-0012",
    date: "13.07.2026 10:44",
    orgId: "1003001",
    name: "Marjon Cafe - Chilonzor",
    payType: "Наличные",
    amount: "450 000 UZS",
    kind: "Расход",
    status: "PAID",
    paymentFor: "Склад",
    comment: "Демо: закупка зелени",
  },
];

const demoTransactionBranches = [
  "Marjon Cafe - Yunusabad",
  "Marjon Cafe - Chilonzor",
  "Marjon Cafe - Mirabad",
  "Marjon Cafe - Sergeli",
];

const demoTransactionPayTypes = ["Payme", "Uzcard", "Humo", "Click", "Наличные"];
const demoTransactionTargets = [
  "Обеденный зал",
  "Банкет",
  "Доставка",
  "Кофе-бар",
  "Вечерняя смена",
  "Семейный зал",
  "Склад",
  "Летняя терраса",
];
const demoTransactionComments = [
  "Демо: столы 4-7",
  "Демо: предоплата",
  "Демо: курьерская смена",
  "Демо: обеденный пик",
  "Демо: закрытие смены",
  "Демо: закупка",
  "Демо: онлайн-меню",
  "Демо: корпоративный заказ",
];

function formatDemoTransactionDate(value) {
  return `${padDate(value.getDate())}.${padDate(value.getMonth() + 1)}.${value.getFullYear()} ${padDate(value.getHours())}:${padDate(value.getMinutes())}`;
}

function buildDemoTransactions() {
  const baseDate = new Date(2026, 6, 15, 16, 42);
  return Array.from({ length: DEMO_TRANSACTION_ROW_COUNT }, (_, index) => {
    const seed = demoTransactionSeeds[index % demoTransactionSeeds.length];
    const date = new Date(baseDate);
    date.setMinutes(baseDate.getMinutes() - index * 127);
    const isExpense = index % 11 === 7 || seed.kind === "Расход";
    const amount = isExpense
      ? 320000 + (index % 9) * 85000
      : 520000 + ((index * 337000) % 4300000);

    return {
      ...seed,
      id: index + 1,
      uuid: `demo-marjon-${String(index + 1).padStart(4, "0")}`,
      date: formatDemoTransactionDate(date),
      orgId: String(1003001 + (index % 4)),
      name: demoTransactionBranches[index % demoTransactionBranches.length],
      payType: demoTransactionPayTypes[index % demoTransactionPayTypes.length],
      amount: `${formatDemoMoney(amount)} UZS`,
      kind: isExpense ? "Расход" : "Приход",
      status: "PAID",
      paymentFor: demoTransactionTargets[index % demoTransactionTargets.length],
      comment: `${demoTransactionComments[index % demoTransactionComments.length]} #${String(index + 1).padStart(3, "0")}`,
    };
  });
}

const demoTransactions = buildDemoTransactions();

const dashboardTransactionReportRows = [
  {
    id: "marjon",
    module: "Marjon",
    contract: "754 995 216",
    completed: "651 371 000",
    paid: "536 599 424",
    unpaid: "114 771 576",
    activeOrders: "103 624 216",
    rejected: "96 845 240",
    overdue: "23 797 727",
    children: [
      {
        id: "monthly-payment",
        module: "Ойлик тулов",
        contract: "333 569 000",
        completed: "333 569 000",
        paid: "306 409 424",
        unpaid: "27 159 576",
        activeOrders: "0",
        rejected: "32 371 000",
        overdue: "21 802 165",
      },
      {
        id: "installation",
        module: "Установка",
        contract: "252 568 000",
        completed: "216 898 000",
        paid: "141 450 000",
        unpaid: "75 448 000",
        activeOrders: "35 670 000",
        rejected: "12 033 000",
        overdue: "1 995 562",
      },
      {
        id: "goods-tech",
        module: "Товар + Техника",
        contract: "168 858 216",
        completed: "100 904 000",
        paid: "88 740 000",
        unpaid: "12 164 000",
        activeOrders: "67 954 216",
        rejected: "52 441 240",
        overdue: "0",
      },
    ],
  },
];

const dashboardSalesReportRows = [
  {
    id: "admin-01",
    employee: "Admin 01",
    contract: "3 610 000",
    completed: "3 610 000",
    paid: "3 610 000",
    unpaid: "0",
    activeOrders: "0",
    rejected: "390 000",
    overdue: "0",
    children: [
      {
        id: "admin-01-marjon",
        employee: "Marjon",
        contract: "3 610 000",
        completed: "3 610 000",
        paid: "3 610 000",
        unpaid: "0",
        activeOrders: "0",
        rejected: "390 000",
        overdue: "0",
      },
    ],
  },
  {
    id: "alikulov-jahongir",
    employee: "ALIKULOV JAHONGIR",
    contract: "40 620 000",
    completed: "40 620 000",
    paid: "38 920 390",
    unpaid: "1 699 610",
    activeOrders: "0",
    rejected: "2 850 240",
    overdue: "1 156 000",
    children: [
      {
        id: "alikulov-marjon",
        employee: "Marjon",
        contract: "38 430 000",
        completed: "38 430 000",
        paid: "36 730 390",
        unpaid: "1 699 610",
        activeOrders: "0",
        rejected: "2 850 240",
        overdue: "1 156 000",
      },
    ],
  },
  {
    id: "fayruz",
    employee: "Fayruz",
    contract: "2 730 000",
    completed: "2 730 000",
    paid: "2 730 000",
    unpaid: "0",
    activeOrders: "0",
    rejected: "0",
    overdue: "0",
    children: [
      { id: "fayruz-marjon", employee: "Marjon", contract: "2 730 000", completed: "2 730 000", paid: "2 730 000", unpaid: "0", activeOrders: "0", rejected: "0", overdue: "0" },
    ],
  },
  {
    id: "test-user",
    employee: "Test user",
    contract: "0",
    completed: "0",
    paid: "0",
    unpaid: "0",
    activeOrders: "0",
    rejected: "0",
    overdue: "0",
    children: [
      { id: "test-user-marjon", employee: "Marjon", contract: "0", completed: "0", paid: "0", unpaid: "0", activeOrders: "0", rejected: "0", overdue: "0" },
    ],
  },
  {
    id: "alisher-abdusattorov",
    employee: "ALISHER ABDUSATTOROV",
    contract: "11 790 000",
    completed: "11 790 000",
    paid: "11 400 000",
    unpaid: "390 000",
    activeOrders: "0",
    rejected: "390 000",
    overdue: "0",
    children: [
      { id: "alisher-abdusattorov-marjon", employee: "Marjon", contract: "11 790 000", completed: "11 790 000", paid: "11 400 000", unpaid: "390 000", activeOrders: "0", rejected: "390 000", overdue: "0" },
    ],
  },
  {
    id: "hamzayev-sardor",
    employee: "HAMZAYEV SARDOR",
    contract: "119 065 000",
    completed: "118 685 000",
    paid: "56 025 000",
    unpaid: "62 660 000",
    activeOrders: "380 000",
    rejected: "780 000",
    overdue: "0",
    children: [
      { id: "hamzayev-sardor-marjon", employee: "Marjon", contract: "119 065 000", completed: "118 685 000", paid: "56 025 000", unpaid: "62 660 000", activeOrders: "380 000", rejected: "780 000", overdue: "0" },
    ],
  },
];

function TransactionsTable() {
  const [rows, setRows] = useState(() => (ADMIN_DASHBOARD_DEMO_MODE ? demoTransactions : []));
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSizeOptions = ADMIN_DASHBOARD_DEMO_MODE ? [12, 25, 50] : [10, 20, 50];
  const [pageSize, setPageSize] = useState(() => (ADMIN_DASHBOARD_DEMO_MODE ? 12 : 20));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [columnSettings, setColumnSettings] = useState(loadTransactionColumnSettings);
  const [dragColumnKey, setDragColumnKey] = useState("");
  const [dragColumnTarget, setDragColumnTarget] = useState(null);
  const [transactionEditor, setTransactionEditor] = useState(null);
  const visibleColumns = columnSettings.visible;

  useEffect(() => {
    if (ADMIN_DASHBOARD_DEMO_MODE) return;
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

  useEffect(() => { setPage(1); }, [query, pageSize]);

  useEffect(() => {
    saveTransactionColumnSettings(columnSettings);
  }, [columnSettings]);

  useEffect(() => {
    if (!transactionEditor) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setTransactionEditor(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [transactionEditor]);

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

  function goToPage(nextPage) {
    setPage(Math.min(totalPages, Math.max(1, nextPage)));
  }

  function toggleColumn(key) {
    setColumnSettings((current) => {
      const normalized = normalizeTransactionColumnSettings(current);

      if (normalized.visible.includes(key)) {
        return {
          ...normalized,
          visible: normalized.visible.length > 1
            ? normalized.visible.filter((item) => item !== key)
            : normalized.visible,
        };
      }

      return {
        ...normalized,
        visible: normalized.order.filter((item) => item === key || normalized.visible.includes(item)),
      };
    });
  }

  function moveColumn(key, direction) {
    setColumnSettings((current) => {
      const normalized = normalizeTransactionColumnSettings(current);
      const currentIndex = normalized.order.indexOf(key);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= normalized.order.length) {
        return normalized;
      }

      const nextOrder = [...normalized.order];
      [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];

      return {
        ...normalized,
        order: nextOrder,
      };
    });
  }

  function moveColumnToDrop(sourceKey, targetKey, placement = "before") {
    if (!sourceKey || !targetKey || sourceKey === targetKey) {
      return;
    }

    setColumnSettings((current) => {
      const normalized = normalizeTransactionColumnSettings(current);
      const nextOrder = normalized.order.filter((key) => key !== sourceKey);
      const targetIndex = nextOrder.indexOf(targetKey);

      if (targetIndex < 0 || !normalized.order.includes(sourceKey)) {
        return normalized;
      }

      nextOrder.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, sourceKey);

      return {
        ...normalized,
        order: nextOrder,
      };
    });
  }

  function resetColumnSettings() {
    setColumnSettings(normalizeTransactionColumnSettings());
  }

  function openTransactionEditor(row) {
    setTransactionEditor({
      id: row.id,
      name: row.name || "",
      date: transactionDateToInputValue(row.date),
      amount: transactionAmountToDraftValue(row.amount),
      kind: row.kind || "Приход",
      payType: row.payType || demoTransactionPayTypes[0],
      status: row.status || "PAID",
      paymentFor: row.paymentFor || "",
      comment: row.comment || "",
    });
  }

  function updateTransactionEditor(key, value) {
    setTransactionEditor((current) => (current ? { ...current, [key]: value } : current));
  }

  function saveTransactionEditor(event) {
    event.preventDefault();

    if (!transactionEditor) {
      return;
    }

    const amount = Math.abs(Number(String(transactionEditor.amount).replace(/[^\d-]/g, "")) || 0);
    const nextRow = {
      name: transactionEditor.name.trim() || "—",
      date: transactionInputDateToDisplay(transactionEditor.date),
      amount: `${formatDemoMoney(amount)} UZS`,
      kind: transactionEditor.kind,
      payType: transactionEditor.payType,
      status: transactionEditor.status.trim() || "PAID",
      paymentFor: transactionEditor.paymentFor.trim(),
      comment: transactionEditor.comment.trim(),
    };

    setRows((current) => current.map((row) => (
      row.id === transactionEditor.id ? { ...row, ...nextRow } : row
    )));
    setTransactionEditor(null);
  }

  const allColumns = [
    { key: "id", label: "ID", width: 66 },
    { key: "uuid", label: "UUID", width: 214 },
    { key: "date", label: "Дата", width: 150 },
    { key: "orgId", label: "ID Организация", width: 120 },
    { key: "name", label: "Названия", width: 200 },
    { key: "payType", label: "Тип оплаты", width: 120 },
    { key: "amount", label: "Сумма", width: 156 },
    { key: "kind", label: "Тип", width: 92 },
    { key: "status", label: "Status", width: 90 },
    { key: "paymentFor", label: "Оплата за", width: 180 },
    { key: "comment", label: "Комментария", width: 220 },
    { key: "actions", label: "", width: 58 },
  ];

  const orderedColumns = columnSettings.order
    .map((key) => allColumns.find((column) => column.key === key))
    .filter(Boolean);
  const columns = orderedColumns.filter((column) => visibleColumns.includes(column.key));
  const actionsColumnIsLast = columns.at(-1)?.key === "actions";

  function renderCell(column, row) {
    switch (column.key) {
      case "id": return <span className="admin-tx-id">{row.id}</span>;
      case "uuid": return <span className="admin-tx-uuid">{row.uuid}</span>;
      case "name": return <strong className="org-directory-name">{row.name}</strong>;
      case "amount": {
        const amount = formatTransactionAmountParts(row.amount);
        return (
          <span className="admin-tx-amount">
            <span className="admin-tx-amount__value">{amount.value}</span>
            <span className="admin-tx-amount__currency">{amount.currency}</span>
          </span>
        );
      }
      case "kind": return <span className={`org-directory-flag ${row.kind === "Расход" ? "org-directory-flag--warning" : "org-directory-flag--success"}`}>{row.kind}</span>;
      case "status": return <span className="org-directory-flag org-directory-flag--success">{row.status}</span>;
      case "comment": return row.comment ? row.comment : "—";
      case "actions": return (
        <button type="button" className="admin-tx-edit" onClick={() => openTransactionEditor(row)} aria-label={`Редактировать транзакцию ${row.id}`}>
          <Icon name="bi-pencil" size={14} />
        </button>
      );
      default: return row[column.key];
    }
  }

  const transactionEditorModal = transactionEditor && typeof document !== "undefined"
    ? createPortal(
      <div
        className="admin-income-modal admin-transaction-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Редактировать транзакцию ${transactionEditor.id}`}
        onClick={() => setTransactionEditor(null)}
      >
        <form className="admin-income-dialog admin-transaction-dialog" onSubmit={saveTransactionEditor} onClick={(event) => event.stopPropagation()}>
          <div className="admin-income-dialog__head admin-transaction-dialog__head">
            <div>
              <h3>Редактировать транзакцию</h3>
              <p>ID {transactionEditor.id}. Изменения применятся к строке таблицы.</p>
            </div>
            <button type="button" className="admin-income-dialog__close" onClick={() => setTransactionEditor(null)} aria-label="Закрыть">
              <Icon name="bi-x-lg" size={16} />
            </button>
          </div>

          <div className="admin-transaction-dialog__grid">
            <label className="admin-income-field admin-transaction-field admin-transaction-field--wide">
              <span>Название</span>
              <input
                value={transactionEditor.name}
                onChange={(event) => updateTransactionEditor("name", event.target.value)}
                placeholder="Название организации"
                autoFocus
              />
            </label>

            <label className="admin-income-field admin-transaction-field">
              <span>Сумма</span>
              <div className="admin-transaction-amount-input">
                <input
                  value={transactionEditor.amount}
                  inputMode="numeric"
                  onChange={(event) => updateTransactionEditor("amount", formatTransactionAmountDraft(event.target.value))}
                  placeholder="0"
                />
                <strong>UZS</strong>
              </div>
            </label>

            <label className="admin-income-field admin-transaction-field">
              <span>Дата и время</span>
              <input
                type="datetime-local"
                value={transactionEditor.date}
                onChange={(event) => updateTransactionEditor("date", event.target.value)}
              />
            </label>

            <label className="admin-income-field admin-transaction-field">
              <span>Тип</span>
              <select value={transactionEditor.kind} onChange={(event) => updateTransactionEditor("kind", event.target.value)}>
                <option value="Приход">Приход</option>
                <option value="Расход">Расход</option>
              </select>
            </label>

            <label className="admin-income-field admin-transaction-field">
              <span>Тип оплаты</span>
              <select value={transactionEditor.payType} onChange={(event) => updateTransactionEditor("payType", event.target.value)}>
                {demoTransactionPayTypes.map((type) => <option value={type} key={type}>{type}</option>)}
              </select>
            </label>

            <label className="admin-income-field admin-transaction-field">
              <span>Status</span>
              <select value={transactionEditor.status} onChange={(event) => updateTransactionEditor("status", event.target.value)}>
                <option value="PAID">PAID</option>
                <option value="PENDING">PENDING</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </label>

            <label className="admin-income-field admin-transaction-field">
              <span>Оплата за</span>
              <input
                value={transactionEditor.paymentFor}
                onChange={(event) => updateTransactionEditor("paymentFor", event.target.value)}
                placeholder="Назначение оплаты"
              />
            </label>

            <label className="admin-income-field admin-transaction-field admin-transaction-field--wide">
              <span>Комментария</span>
              <textarea
                value={transactionEditor.comment}
                onChange={(event) => updateTransactionEditor("comment", event.target.value)}
                placeholder="Комментарий к транзакции"
                rows={3}
              />
            </label>
          </div>

          <div className="admin-income-dialog__actions admin-transaction-dialog__actions">
            <button type="button" className="is-ghost" onClick={() => setTransactionEditor(null)}>Отмена</button>
            <button type="submit" className="is-primary">Сохранить</button>
          </div>
        </form>
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <section className="admin-table-card admin-transactions">
        <div className="admin-panel-head admin-transactions__head">
          <div>
            <h2>Последние транзакции</h2>
          </div>
          <button
            className={`admin-transactions__settings ${settingsOpen ? "is-open" : ""}`}
            type="button"
            onClick={() => setSettingsOpen((value) => !value)}
            aria-expanded={settingsOpen}
          >
            <Icon name="bi-sliders" size={15} />
            <span>Настроить таблицу</span>
          </button>
          <label className="org-directory-search admin-transactions__search">
            <Icon name="bi-search" size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" />
          </label>
        </div>

      {settingsOpen ? (
        <div className="org-directory-column-panel admin-transactions__column-panel">
          <div className="admin-transactions__column-panel-head">
            <span>Столбцы</span>
            <button type="button" onClick={resetColumnSettings}>Сброс</button>
          </div>
          <div className="admin-transactions__column-list">
            {orderedColumns.map((column, index) => {
              const checked = visibleColumns.includes(column.key);
              const disabled = checked && visibleColumns.length === 1;
              const label = column.label || "Действия";
              const dropPosition = dragColumnTarget?.key === column.key ? dragColumnTarget.position : "";

              return (
                <div
                  className={`admin-transactions__column-item ${disabled ? "is-disabled" : ""} ${dragColumnKey === column.key ? "is-dragging" : ""} ${dropPosition ? `is-drop-${dropPosition}` : ""}`}
                  key={column.key}
                  draggable
                  onDragStart={(event) => {
                    setDragColumnKey(column.key);
                    setDragColumnTarget(null);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", column.key);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const sourceKey = event.dataTransfer.getData("text/plain") || dragColumnKey;

                    if (!sourceKey || sourceKey === column.key) {
                      setDragColumnTarget(null);
                      return;
                    }

                    const rect = event.currentTarget.getBoundingClientRect();
                    const position = event.clientX - rect.left > rect.width / 2 ? "after" : "before";
                    setDragColumnTarget((current) => (
                      current?.key === column.key && current?.position === position
                        ? current
                        : { key: column.key, position }
                    ));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    moveColumnToDrop(
                      event.dataTransfer.getData("text/plain") || dragColumnKey,
                      column.key,
                      dragColumnTarget?.key === column.key ? dragColumnTarget.position : "before",
                    );
                    setDragColumnKey("");
                    setDragColumnTarget(null);
                  }}
                  onDragEnd={() => {
                    setDragColumnKey("");
                    setDragColumnTarget(null);
                  }}
                >
                  <label className="admin-transactions__column-toggle">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleColumn(column.key)}
                    />
                    <span>{label}</span>
                  </label>
                  <div className="admin-transactions__column-move" aria-label={`Порядок столбца ${label}`}>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveColumn(column.key, -1)}
                      aria-label={`Переместить ${label} левее`}
                    >
                      <Icon name="bi-chevron-left" size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={index === orderedColumns.length - 1}
                      onClick={() => moveColumn(column.key, 1)}
                      aria-label={`Переместить ${label} правее`}
                    >
                      <Icon name="bi-chevron-right" size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="org-directory-table-shell admin-transactions__table-shell" onWheelCapture={keepWheelInsideScroller}>
        <table className={`org-directory-table admin-transactions__table ${actionsColumnIsLast ? "is-actions-sticky" : ""}`}>
          <colgroup>
            {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
          </colgroup>
          <thead>
            <tr>{columns.map((column) => (
              <th className={`admin-transactions__cell admin-transactions__cell--${column.key}`} key={column.key}>
                {column.key === "actions" ? (
                  <span className="admin-transactions__actions-head" aria-hidden="true">
                    <Icon name="bi-sliders" size={15} />
                  </span>
                ) : column.label}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td className={`admin-transactions__cell admin-transactions__cell--${column.key}`} key={column.key}>{renderCell(column, row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!pageRows.length ? <div className="org-directory-empty">Транзакции не найдены.</div> : null}
      </div>

      <div className="org-directory-footer admin-transactions__footer">
        <span className="org-directory-footer__summary">
          {filteredRows.length ? `${startIndex + 1}-${Math.min(startIndex + pageSize, filteredRows.length)} из ${filteredRows.length}` : "0 из 0"}
          <small>Страница {currentPage} из {totalPages}</small>
        </span>
        <div className="org-directory-pager admin-transactions__pager">
          <AdminPageSizeDropdown value={pageSize} options={pageSizeOptions} onChange={setPageSize} />
          <button type="button" disabled={currentPage === 1} onClick={() => goToPage(1)} aria-label="Первая страница">
            <span className="org-directory-double-icon" aria-hidden="true">
              <Icon name="bi-chevron-left" size={13} />
              <Icon name="bi-chevron-left" size={13} />
            </span>
          </button>
          <button type="button" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)} aria-label="Предыдущая страница">
            <Icon name="bi-chevron-left" size={15} />
          </button>
          {pageList.map((item, index) => (
            item === "…" ? (
              <span className="org-directory-ellipsis" key={`gap-${index}`}>…</span>
            ) : (
              <button
                type="button"
                key={item}
                className={`org-directory-page-btn ${item === currentPage ? "is-active" : ""}`}
                onClick={() => goToPage(item)}
                aria-current={item === currentPage ? "page" : undefined}
              >
                {item}
              </button>
            )
          ))}
          <button type="button" disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)} aria-label="Следующая страница">
            <Icon name="bi-chevron-right" size={15} />
          </button>
          <button type="button" disabled={currentPage === totalPages} onClick={() => goToPage(totalPages)} aria-label="Последняя страница">
            <span className="org-directory-double-icon" aria-hidden="true">
              <Icon name="bi-chevron-right" size={13} />
              <Icon name="bi-chevron-right" size={13} />
            </span>
          </button>
        </div>
      </div>
      </section>
      {transactionEditorModal}
    </>
  );
}

function DashboardTransactionsReportPage() {
  const [openRows, setOpenRows] = useState(() => ({}));
  const [dateRange, setDateRange] = useState(() => buildAdminDashboardDateRange("Этот год"));
  const datePresets = useMemo(() => (
    ADMIN_DASHBOARD_DATE_PRESET_LABELS.map((label) => ({
      label,
      getRange: () => buildAdminDashboardDateRange(label),
    }))
  ), []);

  function toggleRow(rowId) {
    setOpenRows((current) => ({
      ...current,
      [rowId]: !current[rowId],
    }));
  }

  return (
    <section className="admin-dashboard-transactions-report">
      <div className="admin-dashboard-transactions-report__filters">
        <div className="admin-dashboard-transactions-report__date-picker admin-chart-filter-date-picker admin-revenue-range">
          <ReportDateRangePicker
            value={dateRange}
            onChange={(nextRange) => setDateRange(normalizeAdminReportRange(nextRange))}
            buttonClassName="admin-chart-filter admin-chart-filter--date admin-dashboard-transactions-report__date"
            showTime={false}
            presets={datePresets}
            formatButtonLabel={formatAdminDashboardDateRangeButton}
            blockPageScrollOnWheel
            applyPresetOnSelect
            showMenuOk={false}
            leadingIconName="bi-calendar3"
            leadingIconSize={16}
          />
        </div>
        <button className="admin-dashboard-transactions-report__branch" type="button">
          <Icon name="bi-geo-alt" size={16} />
          <span>Тошкент филиал</span>
        </button>
      </div>

      <div className="admin-dashboard-transactions-report__card">
        <div className="admin-dashboard-transactions-report__table-wrap">
          <table className="admin-dashboard-transactions-report__table">
            <thead>
              <tr>
                <th>№</th>
                <th>Модуль</th>
                <th>По договору</th>
                <th>Выполненный</th>
                <th>Оплачено</th>
                <th>Не оплачено</th>
                <th>Сумма активных заказов</th>
                <th>Отклонено</th>
                <th>Просроченный долг</th>
              </tr>
            </thead>
            <tbody>
              {dashboardTransactionReportRows.map((row, index) => {
                const isOpen = Boolean(openRows[row.id]);

                return (
                  <Fragment key={row.id}>
                    <tr className={`is-parent${isOpen ? " is-open" : ""}`}>
                      <td>{index + 1}</td>
                      <td>
                        <span className="admin-dashboard-transactions-report__module">
                          <strong>{row.module}</strong>
                          <button
                            type="button"
                            onClick={() => toggleRow(row.id)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Скрыть" : "Показать"} ${row.module}`}
                          >
                            <span aria-hidden="true" />
                          </button>
                        </span>
                      </td>
                      <td>{row.contract}</td>
                      <td>{row.completed}</td>
                      <td>{row.paid}</td>
                      <td>{row.unpaid}</td>
                      <td>{row.activeOrders}</td>
                      <td>{row.rejected}</td>
                      <td>{row.overdue}</td>
                    </tr>
                    {isOpen ? row.children.map((child, childIndex) => (
                      <tr className="is-child" key={child.id}>
                        <td />
                        <td>{childIndex + 1}. {child.module}</td>
                        <td>{child.contract}</td>
                        <td>{child.completed}</td>
                        <td>{child.paid}</td>
                        <td>{child.unpaid}</td>
                        <td>{child.activeOrders}</td>
                        <td>{child.rejected}</td>
                        <td>{child.overdue}</td>
                      </tr>
                    )) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function DashboardSalesReportPage() {
  const [openRows, setOpenRows] = useState(() => ({}));
  const [dateRange, setDateRange] = useState(() => buildAdminDashboardDateRange("Этот год"));
  const datePresets = useMemo(() => (
    ADMIN_DASHBOARD_DATE_PRESET_LABELS.map((label) => ({
      label,
      getRange: () => buildAdminDashboardDateRange(label),
    }))
  ), []);

  function toggleRow(rowId) {
    setOpenRows((current) => ({
      ...current,
      [rowId]: !current[rowId],
    }));
  }

  return (
    <section className="admin-dashboard-transactions-report admin-dashboard-sales-report">
      <div className="admin-dashboard-transactions-report__filters">
        <div className="admin-dashboard-transactions-report__date-picker admin-chart-filter-date-picker admin-revenue-range">
          <ReportDateRangePicker
            value={dateRange}
            onChange={(nextRange) => setDateRange(normalizeAdminReportRange(nextRange))}
            buttonClassName="admin-chart-filter admin-chart-filter--date admin-dashboard-transactions-report__date"
            showTime={false}
            presets={datePresets}
            formatButtonLabel={formatAdminDashboardDateRangeButton}
            blockPageScrollOnWheel
            applyPresetOnSelect
            showMenuOk={false}
            leadingIconName="bi-calendar3"
            leadingIconSize={16}
          />
        </div>
        <button className="admin-dashboard-transactions-report__branch" type="button">
          <Icon name="bi-geo-alt" size={16} />
          <span>Тошкент филиал</span>
        </button>
      </div>

      <div className="admin-dashboard-transactions-report__card">
        <div className="admin-dashboard-transactions-report__table-wrap">
          <table className="admin-dashboard-transactions-report__table">
            <thead>
              <tr>
                <th>№</th>
                <th>Сотрудник</th>
                <th>По договору</th>
                <th>Выполненный</th>
                <th>Оплачено</th>
                <th>Не оплачено</th>
                <th>Сумма активных заказов</th>
                <th>Отклонено</th>
                <th>Просроченный долг</th>
              </tr>
            </thead>
            <tbody>
              {dashboardSalesReportRows.map((row, index) => {
                const hasChildren = row.children.length > 0;
                const isOpen = Boolean(openRows[row.id]);

                return (
                  <Fragment key={row.id}>
                    <tr className={`is-parent${isOpen ? " is-open" : ""}`}>
                      <td>{index + 1}</td>
                      <td>
                        <span className="admin-dashboard-transactions-report__module">
                          <strong>{row.employee}</strong>
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggleRow(row.id)}
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? "Скрыть" : "Показать"} ${row.employee}`}
                            >
                              <span aria-hidden="true" />
                            </button>
                          ) : null}
                        </span>
                      </td>
                      <td>{row.contract}</td>
                      <td>{row.completed}</td>
                      <td>{row.paid}</td>
                      <td>{row.unpaid}</td>
                      <td>{row.activeOrders}</td>
                      <td>{row.rejected}</td>
                      <td>{row.overdue}</td>
                    </tr>
                    {isOpen ? row.children.map((child, childIndex) => (
                      <tr className="is-child" key={child.id}>
                        <td />
                        <td>{childIndex + 1}. {child.employee}</td>
                        <td>{child.contract}</td>
                        <td>{child.completed}</td>
                        <td>{child.paid}</td>
                        <td>{child.unpaid}</td>
                        <td>{child.activeOrders}</td>
                        <td>{child.rejected}</td>
                        <td>{child.overdue}</td>
                      </tr>
                    )) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function DashboardPage({ segment, onSegmentChange, organizationRows, approvals, dashKpis, onExport, onRowAction, onApprovalAction, onShowApprovals, onKpiClick, onOrgClick, onApprovalClick, onSystemClick, dashboardView, onOpenTransactions, onOpenSales, onOpenSection }) {
  if (dashboardView === "transactions") {
    return <DashboardTransactionsReportPage />;
  }
  if (dashboardView === "sales") {
    return <DashboardSalesReportPage />;
  }

  const displayKpis = dashKpis || kpis;
  return (
    <>
      <section className="admin-kpi-grid">
        {displayKpis.map((item) => <KpiCard item={item} key={item.title} onClick={onKpiClick} />)}
      </section>
      <div className="admin-dashboard-grid admin-dashboard-grid--chart-summary">
        <main className="admin-center">
          <DashboardChartFilterBar onOpenTransactions={onOpenTransactions} onOpenSales={onOpenSales} />
          <PlatformChart segment={segment} onSegmentChange={onSegmentChange} />
        </main>
        <DashboardWarehouseCards onOpenSection={onOpenSection} />
      </div>
      <TransactionsTable />
    </>
  );
}

const ADMIN_DASHBOARD_DATE_PRESET_LABELS = ["Сегодня", "Вчера", "Эта неделя", "Этот месяц", "Этот год"];
const ADMIN_DASHBOARD_DATE_SHORT_MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const ADMIN_DASHBOARD_DATE_FULL_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const adminInstallStatusOptions = [
  { key: "all", label: "Все", count: 160 },
  { key: "waiting", label: "Ожидающий", count: 79 },
  { key: "installed", label: "Установлен", count: 12 },
  { key: "cancelled", label: "Отменено", count: 4 },
  { key: "extended", label: "Продлен", count: 0 },
  { key: "unset", label: "Не указано", count: 65 },
];

const adminInstallDateRows = [
  { id: "install-001", date: "02.07.2026", branch: "Тошкент филиал", status: "waiting", client: "AKBAR TEST", manager: "AKBAR MAMAYUSUPOV", address: "Toshkent sh, Sergeli t", amount: "0 UZS" },
  { id: "install-002", date: "04.07.2026", branch: "Тошкент филиал", status: "waiting", client: "MARJON CAFE", manager: "SARDOR HAMZAYEV", address: "Toshkent sh, Yunusobod t", amount: "390 000 UZS" },
  { id: "install-003", date: "06.07.2026", branch: "Тошкент филиал", status: "installed", client: "QADRDONLAR KAFE", manager: "OG'ABEK AXATOV", address: "Toshkent sh, Chilonzor t", amount: "1 200 000 UZS" },
  { id: "install-004", date: "08.07.2026", branch: "Тошкент филиал", status: "waiting", client: "MUSTAFO CAFE", manager: "JAVOHIR SOTUV", address: "Toshkent sh, Yakkasaroy t", amount: "0 UZS" },
  { id: "install-005", date: "11.07.2026", branch: "Тошкент филиал", status: "installed", client: "Yimizmi", manager: "Izzatbek Muzaffarov", address: "Toshkent sh, Шайхонтохур т", amount: "0 UZS", clientId: "1002975", ownerPhone: "+998 90 044 21 20" },
  { id: "install-006", date: "11.07.2026", branch: "Тошкент филиал", status: "installed", client: "OSIYO GARDEN", manager: "Marjon", address: "Samarqand, Жомбой т", amount: "0 UZS", clientId: "1002976", ownerPhone: "+998 90 044 21 21" },
  { id: "install-007", date: "15.07.2026", branch: "Тошкент филиал", status: "waiting", client: "BURGER HOUSE", manager: "YO'LDASHEV XURSHID", address: "Toshkent sh, Mirzo Ulug'bek t", amount: "0 UZS" },
  { id: "install-008", date: "17.07.2026", branch: "Тошкент филиал", status: "cancelled", client: "STREET FOOD", manager: "SAFAYEV AZIZ", address: "Toshkent sh, Uchtepa t", amount: "0 UZS" },
  { id: "install-009", date: "18.07.2026", branch: "Тошкент филиал", status: "waiting", client: "ANXOR KAFE", manager: "DILSHOD XABIBULLAYEV", address: "Toshkent sh, Yashnobod t", amount: "390 000 UZS" },
  { id: "install-010", date: "20.07.2026", branch: "Тошкент филиал", status: "waiting", client: "KARVON OSHXONA", manager: "TURAYEV ALISHER", address: "Toshkent sh, Olmazor t", amount: "0 UZS" },
  { id: "install-011", date: "21.07.2026", branch: "Тошкент филиал", status: "extended", client: "GOLDEN UZBECHIM", manager: "SHOHABBOS DONYOROV", address: "Toshkent sh, Shayxontohur t", amount: "390 000 UZS" },
  { id: "install-012", date: "24.07.2026", branch: "Тошкент филиал", status: "waiting", client: "SIMFONIYA MILLIY TAOMLARI", manager: "AZIM O'KTAMOV", address: "Toshkent sh, Bektemir t", amount: "0 UZS" },
  { id: "install-013", date: "24.07.2026", branch: "Тошкент филиал", status: "installed", client: "AMIRLIK RESTORANI", manager: "ELDOR SOTUV", address: "Toshkent sh, Mirobod t", amount: "1 000 000 UZS" },
  { id: "install-014", date: "", branch: "Тошкент филиал", status: "unset", client: "NOMI HALI TANLANMAGAN", manager: "SARDOR HAMZAYEV", address: "Toshkent sh", amount: "0 UZS" },
];

function buildAdminDashboardDateRange(preset) {
  const end = new Date(`${adminTodayInputValue()}T00:00:00`);
  const start = new Date(end);

  if (preset === "Вчера") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === "Эта неделя") {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  } else if (preset === "Этот месяц") {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  } else if (preset === "Этот год") {
    start.setMonth(0, 1);
    end.setMonth(11, 31);
  }

  return normalizeAdminReportRange({
    preset,
    start: adminInputDateToReportDate(adminDateToInputValue(start)),
    end: adminInputDateToReportDate(adminDateToInputValue(end)),
    startTime: "00:00",
    endTime: "00:00",
  });
}

function formatAdminDashboardDateRangeButton(range) {
  const normalized = normalizeAdminReportRange(range);
  const start = new Date(`${adminReportDateToInputDate(normalized.start)}T00:00:00`);
  const end = new Date(`${adminReportDateToInputDate(normalized.end)}T00:00:00`);
  const startLabel = `${start.getDate()} ${ADMIN_DASHBOARD_DATE_SHORT_MONTHS[start.getMonth()]}`;
  const endLabel = `${end.getDate()} ${ADMIN_DASHBOARD_DATE_SHORT_MONTHS[end.getMonth()]}\u00a0${end.getFullYear()}`;

  if (normalized.start === normalized.end) {
    return `${end.getDate()} ${ADMIN_DASHBOARD_DATE_FULL_MONTHS[end.getMonth()]}\u00a0${end.getFullYear()}`;
  }

  return `${startLabel} - ${endLabel}`;
}

function formatAdminInstallDateHeading(value) {
  const date = parseDate(value);
  return `${date.getDate()} ${ADMIN_DASHBOARD_DATE_FULL_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function AdminInstallDateModal({ onClose }) {
  const [branch, setBranch] = useState("all");
  const [status, setStatus] = useState("installed");
  const [selectedDate, setSelectedDate] = useState("11.07.2026");
  const [viewDate, setViewDate] = useState(() => parseDate("11.07.2026"));
  const [expandedInstallRowId, setExpandedInstallRowId] = useState("");

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const branchOptions = useMemo(() => (
    ["all", ...Array.from(new Set(adminInstallDateRows.map((row) => row.branch).filter(Boolean)))]
  ), []);

  const rowsByBranch = useMemo(() => (
    adminInstallDateRows.filter((row) => branch === "all" || row.branch === branch)
  ), [branch]);

  const statusCounts = useMemo(() => (
    adminInstallStatusOptions.reduce((acc, option) => {
      acc[option.key] = option.count ?? (option.key === "all"
        ? rowsByBranch.length
        : rowsByBranch.filter((row) => row.status === option.key).length);
      return acc;
    }, {})
  ), [rowsByBranch]);

  const filteredRows = useMemo(() => (
    rowsByBranch.filter((row) => {
      const statusMatches = status === "all" || row.status === status;
      const dateMatches = status === "unset" ? !row.date : row.date === selectedDate;
      return statusMatches && dateMatches;
    })
  ), [rowsByBranch, selectedDate, status]);

  const calendarCounts = useMemo(() => (
    rowsByBranch.reduce((acc, row) => {
      if (!row.date || (status !== "all" && row.status !== status)) return acc;
      acc[row.date] = (acc[row.date] || 0) + 1;
      return acc;
    }, {})
  ), [rowsByBranch, status]);

  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const calendarCells = getAdminChartCalendarCells(viewYear, viewMonth);
  const selectedDateObject = parseDate(selectedDate);

  useEffect(() => {
    if (!filteredRows.length) {
      setExpandedInstallRowId("");
      return;
    }

    setExpandedInstallRowId((currentId) => (
      currentId && filteredRows.some((row) => row.id === currentId) ? currentId : ""
    ));
  }, [filteredRows]);

  function shiftMonth(diff) {
    setViewDate(new Date(viewYear, viewMonth + diff, 1));
  }

  function chooseDate(date) {
    const next = formatDate(date);
    setSelectedDate(next);
    setViewDate(date);
    if (status === "unset") setStatus("all");
  }

  const modal = (
    <div className="admin-install-date-modal" role="dialog" aria-modal="true" aria-label="Дата установки">
      <button type="button" className="admin-install-date-modal__shade" onClick={onClose} aria-label="Закрыть" />
      <section className="admin-install-date-dialog" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="admin-install-date-dialog__close" onClick={onClose} aria-label="Закрыть">
          <Icon name="bi-x-lg" size={17} />
        </button>

        <div className="admin-install-date-calendar-pane">
          <div className="admin-install-date-title">
            <Icon name="bi-calendar3" size={16} />
            <h3>Дата установки</h3>
          </div>

          <label className="admin-install-date-branch">
            <select value={branch} onChange={(event) => setBranch(event.target.value)}>
              {branchOptions.map((option) => (
                <option value={option} key={option}>{option === "all" ? "Филиал" : option}</option>
              ))}
            </select>
            <Icon name="bi-chevron-down" size={15} />
          </label>

          <div className="admin-install-date-calendar">
            <div className="admin-install-date-calendar__nav">
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
                <Icon name="bi-chevron-left" size={16} />
              </button>
              <strong>{ADMIN_CHART_MONTHS[viewMonth]} {viewYear}</strong>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
                <Icon name="bi-chevron-right" size={16} />
              </button>
            </div>

            <div className="admin-install-date-calendar__week">
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="admin-install-date-calendar__grid">
              {calendarCells.map((cell) => {
                const count = calendarCounts[cell.key] || 0;
                const isSelected = cell.key === selectedDate;
                const isToday = formatDate(ADMIN_CHART_TODAY) === cell.key;
                return (
                  <button
                    type="button"
                    className={`${cell.muted ? "is-muted" : ""} ${isSelected ? "is-selected" : ""} ${isToday ? "is-today" : ""}`}
                    key={cell.key}
                    onClick={() => chooseDate(cell.date)}
                  >
                    {count ? <small>{count}</small> : null}
                    <span>{cell.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="admin-install-date-list-pane">
          <div className="admin-install-date-filter">
            <span>Статус</span>
            <div>
              {adminInstallStatusOptions.map((option) => (
                <button
                  type="button"
                  className={status === option.key ? "is-active" : ""}
                  onClick={() => setStatus(option.key)}
                  key={option.key}
                >
                  {option.label}
                  <b>{statusCounts[option.key] || 0}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="admin-install-date-list">
            <h4>{status === "unset" ? "Без даты" : formatAdminInstallDateHeading(selectedDate)}</h4>
            {filteredRows.map((row, index) => {
              const isOpen = expandedInstallRowId === row.id;

              return (
                <article className={`admin-install-date-item is-${row.status} ${isOpen ? "is-open" : ""}`} key={row.id}>
                  <button
                    type="button"
                    className="admin-install-date-item__main"
                    onClick={() => setExpandedInstallRowId(isOpen ? "" : row.id)}
                    aria-expanded={isOpen}
                  >
                    <span className="admin-install-date-item__index">{index + 1}</span>
                    <div>
                      <small>{row.manager}</small>
                      <strong>{row.client}</strong>
                      <em>{row.address}</em>
                    </div>
                  </button>
                  {isOpen ? (
                    <div className="admin-install-date-item__details">
                      <span>ID:</span>
                      <strong>{row.clientId || row.id}</strong>
                      <span>Тел. владельца:</span>
                      <strong>{row.ownerPhone || "Не указано"}</strong>
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!filteredRows.length ? (
              <div className="admin-install-date-empty">
                <Icon name="bi-calendar3" size={20} />
                <span>{status === "unset" ? "Нет заявок без даты." : `На ${formatDate(selectedDateObject)} заявок нет.`}</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}

function DashboardChartFilterBar({ onOpenTransactions, onOpenSales }) {
  const [installDateOpen, setInstallDateOpen] = useState(false);
  const [dateRange, setDateRange] = useState(() => buildAdminDashboardDateRange("Этот месяц"));
  const datePresets = useMemo(() => (
    ADMIN_DASHBOARD_DATE_PRESET_LABELS.map((label) => ({
      label,
      getRange: () => buildAdminDashboardDateRange(label),
    }))
  ), []);

  return (
    <div className="admin-chart-filter-bar" aria-label="Фильтры графика">
      <div className="admin-chart-filter-date-picker admin-revenue-range">
        <ReportDateRangePicker
          value={dateRange}
          onChange={(nextRange) => setDateRange(normalizeAdminReportRange(nextRange))}
          buttonClassName="admin-chart-filter admin-chart-filter--date"
          showTime={false}
          presets={datePresets}
          formatButtonLabel={formatAdminDashboardDateRangeButton}
          blockPageScrollOnWheel
          applyPresetOnSelect
          showMenuOk={false}
          leadingIconName="bi-calendar3"
          leadingIconSize={16}
        />
      </div>
      <button className="admin-chart-filter admin-chart-filter--with-icon" type="button" onClick={onOpenSales}>
        <Icon name="bi-tags" size={16} />
        <span>Продажи</span>
      </button>
      <button className="admin-chart-filter admin-chart-filter--with-icon" type="button" onClick={onOpenTransactions}>
        <Icon name="bi-receipt" size={16} />
        <span>Транзакции</span>
      </button>
      <button className="admin-chart-filter admin-chart-filter--install admin-chart-filter--with-icon" type="button" onClick={() => setInstallDateOpen(true)}>
        <Icon name="bi-pc-display" size={16} />
        <span>Дата установки</span>
      </button>
      <button className="admin-chart-filter admin-chart-filter--with-icon" type="button">
        <Icon name="bi-graph-up" size={16} />
        <span>Аналитика</span>
      </button>
      {installDateOpen ? <AdminInstallDateModal onClose={() => setInstallDateOpen(false)} /> : null}
    </div>
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
  const navigationHistoryRef = useRef([]);
  const innerBackRef = useRef(null);
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
  const [dashKpis, setDashKpis] = useState(() => (ADMIN_DASHBOARD_DEMO_MODE ? demoKpis : orderDashboardKpis(kpis)));
  const [dashboardView, setDashboardView] = useState(null);

  const closeDetail = () => setDetail(null);
  const setInnerBackHandler = useCallback((handler) => {
    innerBackRef.current = typeof handler === "function" ? handler : null;
  }, []);

  const navigateTo = useCallback((nextActive) => {
    if (nextActive === active) {
      if (nextActive === "dashboard") setDashboardView(null);
      return;
    }

    navigationHistoryRef.current = [...navigationHistoryRef.current, active].slice(-40);
    innerBackRef.current = null;
    setDetail(null);
    setDashboardView(null);
    setActive(nextActive);
  }, [active]);

  useEffect(() => {
    let mounted = true;
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
    if (!ADMIN_DASHBOARD_DEMO_MODE) {
      adminApi.get("/admin-reports/dashboard-kpis")
        .then(({ data }) => {
          if (!mounted || !data) return;
          setDashKpis((prev) => prev.map((kpi) => {
            const v = data[kpi.dataKey];
            return v != null ? { ...kpi, value: typeof v === "number" ? v.toLocaleString("ru-RU") : String(v) } : kpi;
          }));
        })
        .catch(() => {});
    }
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

  const headerNotifications = useMemo(() => approvals.map((item, index) => ({
    id: `${item[0]}-${item[1]}-${index}`,
    title: item[0],
    text: `${item[1]} · ${item[2]}`,
    icon: "bi-exclamation-triangle",
    approval: item,
  })), [approvals]);

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
    if (item?.dataKey === "organizations") {
      navigateTo("org-list");
      return;
    }

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

  function handleNotificationSelect(item) {
    if (item?.approval) {
      openApprovalDetail(item.approval);
      return;
    }
    setMessage(item?.title || "Уведомление открыто.");
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
        dashboardView={dashboardView}
        onOpenTransactions={() => setDashboardView("transactions")}
        onOpenSales={() => setDashboardView("sales")}
        onOpenSection={navigateTo}
      />
    ) : (
      <CategoryPage active={active} rowsOverride={categoryRows[active]} search={search} onCreate={handleCreate} onRowDetail={openCategoryRowDetail} onNotify={setMessage} onInnerBackChange={setInnerBackHandler} />
    )
  ), [active, approvals, categoryRows, dashKpis, dashboardView, filteredOrganizations, navigateTo, search, segment, setInnerBackHandler]);

  function logout() {
    adminLogout();
    onLogout();
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

    if (active === "dashboard" && dashboardView) {
      setDashboardView(null);
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

export default function AdminApp() {
  const [authenticated, setAuthenticated] = useState(() => isAdminAuthenticated());
  return authenticated ? (
    <AdminShell onLogout={() => setAuthenticated(false)} />
  ) : (
    <LoginView onLogin={() => setAuthenticated(true)} />
  );
}

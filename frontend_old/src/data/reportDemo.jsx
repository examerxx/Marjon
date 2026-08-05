import { formatMoney, formatNumber } from "../api/client";

// Demo data for report sub-category tables.
// Shape: REPORT_TABLES[sectionKey][tableKey] = { columns, rows, endpoint? }
//   column = { key, label, align?, render?(row, index) }
//   endpoint = future real API path (not used yet — swap rows for api.get(endpoint))
// Status cells reuse the unified .badge dot styling (success/warning/danger).

function badge(variant, label) {
  return <span className={`badge ${variant}`}>{label}</span>;
}

export const REPORT_TABLES = {
  orders: {
    list: {
      endpoint: "/reports/orders",
      columns: [
        { key: "n", label: "№" },
        { key: "number", label: "Номер заказа" },
        { key: "channel", label: "Канал" },
        { key: "amount", label: "Сумма", align: "right", render: (r) => formatMoney(r.amount) },
        { key: "status", label: "Статус", render: (r) => badge(r.statusVariant, r.statusLabel) },
      ],
      rows: [
        { id: 1, n: 1, number: "#1042", channel: "Зал", amount: 184000, statusVariant: "badge-success", statusLabel: "Оплачен" },
        { id: 2, n: 2, number: "#1043", channel: "Доставка", amount: 96000, statusVariant: "badge-warning", statusLabel: "В работе" },
        { id: 3, n: 3, number: "#1044", channel: "Самовывоз", amount: 52000, statusVariant: "badge-danger", statusLabel: "Отменён" },
        { id: 4, n: 4, number: "#1045", channel: "Зал", amount: 238000, statusVariant: "badge-success", statusLabel: "Оплачен" },
      ],
    },
    statuses: {
      endpoint: "/reports/orders/statuses",
      columns: [
        { key: "n", label: "№" },
        { key: "status", label: "Статус", render: (r) => badge(r.statusVariant, r.statusLabel) },
        { key: "count", label: "Количество", align: "right", render: (r) => formatNumber(r.count) },
        { key: "amount", label: "Сумма", align: "right", render: (r) => formatMoney(r.amount) },
      ],
      rows: [
        { id: 1, n: 1, statusVariant: "badge-success", statusLabel: "Оплачен", count: 312, amount: 41200000 },
        { id: 2, n: 2, statusVariant: "badge-warning", statusLabel: "В работе", count: 28, amount: 3100000 },
        { id: 3, n: 3, statusVariant: "badge-danger", statusLabel: "Отменён", count: 9, amount: 620000 },
      ],
    },
    filters: {
      endpoint: "/reports/orders/by-filter",
      columns: [
        { key: "n", label: "№" },
        { key: "branch", label: "Филиал" },
        { key: "cashier", label: "Касса" },
        { key: "waiter", label: "Официант" },
        { key: "orders", label: "Заказы", align: "right", render: (r) => formatNumber(r.orders) },
        { key: "revenue", label: "Выручка", align: "right", render: (r) => formatMoney(r.revenue) },
      ],
      rows: [
        { id: 1, n: 1, branch: "Центр", cashier: "Касса 1", waiter: "Алишер", orders: 120, revenue: 15400000 },
        { id: 2, n: 2, branch: "Центр", cashier: "Касса 2", waiter: "Дилноза", orders: 98, revenue: 12100000 },
        { id: 3, n: 3, branch: "Филиал-2", cashier: "Касса 1", waiter: "Сардор", orders: 76, revenue: 9050000 },
      ],
    },
  },

  tables: {
    load: {
      endpoint: "/reports/tables/load",
      columns: [
        { key: "n", label: "№" },
        { key: "table", label: "Стол" },
        { key: "occupancy", label: "Занятость", align: "right", render: (r) => `${r.occupancy}%` },
        { key: "peak", label: "Пиковые часы" },
        { key: "status", label: "Статус", render: (r) => badge(r.statusVariant, r.statusLabel) },
      ],
      rows: [
        { id: 1, n: 1, table: "Стол 1", occupancy: 92, peak: "19:00–21:00", statusVariant: "badge-danger", statusLabel: "Перегружен" },
        { id: 2, n: 2, table: "Стол 2", occupancy: 64, peak: "13:00–14:00", statusVariant: "badge-warning", statusLabel: "Средне" },
        { id: 3, n: 3, table: "Стол 3", occupancy: 38, peak: "18:00–19:00", statusVariant: "badge-success", statusLabel: "Свободно" },
      ],
    },
    turnover: {
      endpoint: "/reports/tables/turnover",
      columns: [
        { key: "n", label: "№" },
        { key: "table", label: "Стол" },
        { key: "orders", label: "Заказов", align: "right", render: (r) => formatNumber(r.orders) },
        { key: "turns", label: "Оборотов", align: "right", render: (r) => formatNumber(r.turns) },
      ],
      rows: [
        { id: 1, n: 1, table: "Стол 1", orders: 142, turns: 38 },
        { id: 2, n: 2, table: "Стол 2", orders: 96, turns: 25 },
        { id: 3, n: 3, table: "Стол 3", orders: 54, turns: 14 },
      ],
    },
    revenue: {
      endpoint: "/reports/tables/revenue",
      columns: [
        { key: "n", label: "№" },
        { key: "table", label: "Стол" },
        { key: "revenue", label: "Выручка", align: "right", render: (r) => formatMoney(r.revenue) },
        { key: "avg", label: "Средний чек", align: "right", render: (r) => formatMoney(r.avg) },
      ],
      rows: [
        { id: 1, n: 1, table: "Стол 1", revenue: 18400000, avg: 129000 },
        { id: 2, n: 2, table: "Стол 2", revenue: 11200000, avg: 116000 },
        { id: 3, n: 3, table: "Стол 3", revenue: 6300000, avg: 98000 },
      ],
    },
  },

  waiters: {
    sales: {
      endpoint: "/reports/waiters/sales",
      columns: [
        { key: "n", label: "№" },
        { key: "name", label: "Официант" },
        { key: "orders", label: "Заказов", align: "right", render: (r) => formatNumber(r.orders) },
        { key: "revenue", label: "Выручка", align: "right", render: (r) => formatMoney(r.revenue) },
      ],
      rows: [
        { id: 1, n: 1, name: "Алишер", orders: 142, revenue: 18400000 },
        { id: 2, n: 2, name: "Дилноза", orders: 118, revenue: 14900000 },
        { id: 3, n: 3, name: "Сардор", orders: 87, revenue: 10200000 },
      ],
    },
    avgCheck: {
      endpoint: "/reports/waiters/avg-check",
      columns: [
        { key: "n", label: "№" },
        { key: "name", label: "Официант" },
        { key: "avg", label: "Средний чек", align: "right", render: (r) => formatMoney(r.avg) },
        { key: "status", label: "Рейтинг", render: (r) => badge(r.statusVariant, r.statusLabel) },
      ],
      rows: [
        { id: 1, n: 1, name: "Алишер", avg: 129000, statusVariant: "badge-success", statusLabel: "Высокий" },
        { id: 2, n: 2, name: "Дилноза", avg: 112000, statusVariant: "badge-warning", statusLabel: "Средний" },
        { id: 3, n: 3, name: "Сардор", avg: 94000, statusVariant: "badge-danger", statusLabel: "Низкий" },
      ],
    },
    service: {
      endpoint: "/reports/waiters/service",
      columns: [
        { key: "n", label: "№" },
        { key: "name", label: "Официант" },
        { key: "avgTime", label: "Ср. время закрытия" },
        { key: "status", label: "Статус", render: (r) => badge(r.statusVariant, r.statusLabel) },
      ],
      rows: [
        { id: 1, n: 1, name: "Алишер", avgTime: "32 мин", statusVariant: "badge-success", statusLabel: "Быстро" },
        { id: 2, n: 2, name: "Дилноза", avgTime: "41 мин", statusVariant: "badge-warning", statusLabel: "Норма" },
        { id: 3, n: 3, name: "Сардор", avgTime: "58 мин", statusVariant: "badge-danger", statusLabel: "Медленно" },
      ],
    },
  },

  dishes: {
    top: {
      endpoint: "/reports/dishes/top",
      columns: [
        { key: "n", label: "№" },
        { key: "dish", label: "Блюдо" },
        { key: "category", label: "Категория" },
        { key: "sold", label: "Продано", align: "right", render: (r) => formatNumber(r.sold) },
        { key: "revenue", label: "Выручка", align: "right", render: (r) => formatMoney(r.revenue) },
        { key: "status", label: "Доступность", render: (r) => badge(r.statusVariant, r.statusLabel) },
      ],
      rows: [
        { id: 1, n: 1, dish: "Плов", category: "Основные", sold: 412, revenue: 18540000, statusVariant: "badge-success", statusLabel: "В наличии" },
        { id: 2, n: 2, dish: "Лагман", category: "Основные", sold: 286, revenue: 11440000, statusVariant: "badge-warning", statusLabel: "Мало" },
        { id: 3, n: 3, dish: "Шашлык", category: "Гриль", sold: 240, revenue: 14400000, statusVariant: "badge-danger", statusLabel: "Критично" },
        { id: 4, n: 4, dish: "Самса", category: "Выпечка", sold: 305, revenue: 6100000, statusVariant: "badge-success", statusLabel: "В наличии" },
      ],
    },
    quantity: {
      endpoint: "/reports/dishes/quantity",
      columns: [
        { key: "n", label: "№" },
        { key: "dish", label: "Блюдо" },
        { key: "category", label: "Категория" },
        { key: "qty", label: "Количество", align: "right", render: (r) => formatNumber(r.qty) },
        { key: "share", label: "Доля", align: "right", render: (r) => `${r.share}%` },
      ],
      rows: [
        { id: 1, n: 1, dish: "Чай", category: "Напитки", qty: 690, share: 18 },
        { id: 2, n: 2, dish: "Плов", category: "Основные", qty: 412, share: 22 },
        { id: 3, n: 3, dish: "Самса", category: "Выпечка", qty: 305, share: 12 },
      ],
    },
    margin: {
      endpoint: "/reports/dishes/margin",
      columns: [
        { key: "n", label: "№" },
        { key: "dish", label: "Блюдо" },
        { key: "cost", label: "Себестоимость", align: "right", render: (r) => formatMoney(r.cost) },
        { key: "price", label: "Цена", align: "right", render: (r) => formatMoney(r.price) },
        { key: "margin", label: "Маржа", align: "right", render: (r) => `${r.margin}%` },
        { key: "status", label: "Оценка", render: (r) => badge(r.statusVariant, r.statusLabel) },
      ],
      rows: [
        { id: 1, n: 1, dish: "Плов", cost: 18000, price: 45000, margin: 60, statusVariant: "badge-success", statusLabel: "Высокая" },
        { id: 2, n: 2, dish: "Шашлык", cost: 38000, price: 60000, margin: 37, statusVariant: "badge-warning", statusLabel: "Средняя" },
        { id: 3, n: 3, dish: "Салат", cost: 14000, price: 20000, margin: 30, statusVariant: "badge-danger", statusLabel: "Низкая" },
      ],
    },
  },

  cancelled: {
    cancellations: {
      endpoint: "/reports/cancelled/dishes",
      columns: [
        { key: "n", label: "№" },
        { key: "dish", label: "Блюдо" },
        { key: "count", label: "Отмен", align: "right", render: (r) => formatNumber(r.count) },
        { key: "status", label: "Частота", render: (r) => badge(r.statusVariant, r.statusLabel) },
      ],
      rows: [
        { id: 1, n: 1, dish: "Шашлык", count: 18, statusVariant: "badge-danger", statusLabel: "Часто" },
        { id: 2, n: 2, dish: "Лагман", count: 9, statusVariant: "badge-warning", statusLabel: "Иногда" },
        { id: 3, n: 3, dish: "Плов", count: 3, statusVariant: "badge-success", statusLabel: "Редко" },
      ],
    },
    reasons: {
      endpoint: "/reports/cancelled/reasons",
      columns: [
        { key: "n", label: "№" },
        { key: "reason", label: "Причина" },
        { key: "count", label: "Кол-во", align: "right", render: (r) => formatNumber(r.count) },
        { key: "share", label: "Доля", align: "right", render: (r) => `${r.share}%` },
      ],
      rows: [
        { id: 1, n: 1, reason: "Ошибка заказа", count: 14, share: 38 },
        { id: 2, n: 2, reason: "Нет товара", count: 11, share: 30 },
        { id: 3, n: 3, reason: "Отказ клиента", count: 8, share: 22 },
      ],
    },
    losses: {
      endpoint: "/reports/cancelled/losses",
      columns: [
        { key: "n", label: "№" },
        { key: "dish", label: "Блюдо" },
        { key: "loss", label: "Потери", align: "right", render: (r) => formatMoney(r.loss) },
        { key: "status", label: "Влияние", render: (r) => badge(r.statusVariant, r.statusLabel) },
      ],
      rows: [
        { id: 1, n: 1, dish: "Шашлык", loss: 1080000, statusVariant: "badge-danger", statusLabel: "Высокое" },
        { id: 2, n: 2, dish: "Лагман", loss: 360000, statusVariant: "badge-warning", statusLabel: "Среднее" },
        { id: 3, n: 3, dish: "Плов", loss: 135000, statusVariant: "badge-success", statusLabel: "Низкое" },
      ],
    },
  },

  debtors: {
    debtors: {
      endpoint: "/reports/debt-credit",
      columns: [
        { key: "n", label: "№" },
        { key: "name", label: "Контрагент" },
        { key: "amount", label: "Долг", align: "right", render: (r) => formatMoney(r.amount) },
        { key: "status", label: "Статус", render: (r) => badge(r.statusVariant, r.statusLabel) },
      ],
      rows: [
        { id: 1, n: 1, name: "ООО «Гелас»", amount: 4200000, statusVariant: "badge-danger", statusLabel: "Просрочен" },
        { id: 2, n: 2, name: "Гость VIP-12", amount: 850000, statusVariant: "badge-warning", statusLabel: "Ожидается" },
        { id: 3, n: 3, name: "Кейтеринг «Той»", amount: 320000, statusVariant: "badge-success", statusLabel: "В норме" },
      ],
    },
    creditors: {
      endpoint: "/reports/debt-credit",
      columns: [
        { key: "n", label: "№" },
        { key: "name", label: "Поставщик" },
        { key: "amount", label: "Обязательство", align: "right", render: (r) => formatMoney(r.amount) },
        { key: "status", label: "Статус", render: (r) => badge(r.statusVariant, r.statusLabel) },
      ],
      rows: [
        { id: 1, n: 1, name: "BOZOR", amount: 6150000, statusVariant: "badge-warning", statusLabel: "К оплате" },
        { id: 2, n: 2, name: "Мясокомбинат", amount: 2100000, statusVariant: "badge-danger", statusLabel: "Просрочен" },
        { id: 3, n: 3, name: "Напитки-Опт", amount: 540000, statusVariant: "badge-success", statusLabel: "Оплачено" },
      ],
    },
    terms: {
      endpoint: "/reports/debt-credit/terms",
      columns: [
        { key: "n", label: "№" },
        { key: "name", label: "Контрагент" },
        { key: "dueDate", label: "Срок оплаты" },
        { key: "overdueDays", label: "Просрочка, дн.", align: "right", render: (r) => formatNumber(r.overdueDays) },
        { key: "status", label: "Статус", render: (r) => badge(r.statusVariant, r.statusLabel) },
      ],
      rows: [
        { id: 1, n: 1, name: "ООО «Гелас»", dueDate: "10.06.2026", overdueDays: 8, statusVariant: "badge-danger", statusLabel: "Просрочен" },
        { id: 2, n: 2, name: "BOZOR", dueDate: "22.06.2026", overdueDays: 0, statusVariant: "badge-warning", statusLabel: "Скоро" },
        { id: 3, n: 3, name: "Кейтеринг «Той»", dueDate: "30.06.2026", overdueDays: 0, statusVariant: "badge-success", statusLabel: "В срок" },
      ],
    },
  },
};

export function getReportTable(sectionKey, tableKey) {
  if (!sectionKey || !tableKey) return null;
  return REPORT_TABLES[sectionKey]?.[tableKey] || null;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Chart, Filler, LineController, LineElement, LinearScale, PointElement, CategoryScale, Tooltip } from "chart.js";
import { Link, useOutletContext } from "react-router-dom";
import { api, formatMoney, formatNumber } from "../api/client";
import { formatDateLabel, todayInputValue, toDateInputValue } from "../utils/date";
import Icon from "../components/Icon";
import { PageLoader } from "../components/Loader";
import ReportDateRangePicker from "../components/ReportDateRangePicker";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

const EMPTY_DASHBOARD = {
  today_revenue: 0,
  today_orders: 0,
  avg_check: 0,
  active_orders: 0,
  cash_total: 0,
  non_cash_total: 0,
  payment_methods: [],
  order_locations: [],
  avg_check_segments: [],
};

const EMPTY_WAREHOUSE_REPORTS = {
  incomes: [],
  consumption: [],
  balances: [],
  debtCredit: [],
  stock: [],
};

function inputDateToReportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatDateLabel(todayInputValue());
  }

  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function reportDateToInputDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) {
    return todayInputValue();
  }

  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function reportRangeEndingAt(days, endValue) {
  const end = new Date(`${endValue}T00:00:00`);
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(1, days) + 1);

  return {
    preset: "",
    start: inputDateToReportDate(toDateInputValue(start)),
    end: inputDateToReportDate(toDateInputValue(end)),
    startTime: "00:00",
    endTime: "00:00",
  };
}

function normalizeReportRange(range = {}) {
  const startInput = reportDateToInputDate(range.start);
  const endInput = reportDateToInputDate(range.end);
  const [dateFrom, dateTo] = startInput <= endInput ? [startInput, endInput] : [endInput, startInput];

  return {
    preset: range.preset || "",
    start: inputDateToReportDate(dateFrom),
    end: inputDateToReportDate(dateTo),
    startTime: "00:00",
    endTime: "00:00",
  };
}

function reportRangeToApiParams(range) {
  const normalized = normalizeReportRange(range);
  return {
    date_from: reportDateToInputDate(normalized.start),
    date_to: reportDateToInputDate(normalized.end),
  };
}

function reportRangeDays(range) {
  const normalized = normalizeReportRange(range);
  const start = new Date(`${reportDateToInputDate(normalized.start)}T00:00:00`);
  const end = new Date(`${reportDateToInputDate(normalized.end)}T00:00:00`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function reportRangeLabel(range) {
  const normalized = normalizeReportRange(range);
  if (normalized.start === normalized.end) {
    return normalized.start;
  }

  return `${normalized.start} - ${normalized.end}`;
}

function formatDaysLabel(days) {
  const value = Math.max(1, Number(days) || 1);
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${value} день`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${value} дня`;
  }

  return `${value} дней`;
}

function clampAmount(value, max = Number.POSITIVE_INFINITY) {
  return Math.max(0, Math.min(Math.round(Number(value) || 0), max));
}

function apiList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function firstText(row, fields, fallback = "—") {
  for (const field of fields) {
    const value = row?.[field];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value);
    }
  }
  return fallback;
}

function sumRows(rows = [], fields = []) {
  return rows.reduce((sum, row) => {
    for (const field of fields) {
      if (row?.[field] !== undefined && row?.[field] !== null) {
        return sum + toFiniteNumber(row[field]);
      }
    }
    return sum;
  }, 0);
}

function warehouseRows(rows = [], selectedDate, options = {}) {
  const {
    amount = (row) => toFiniteNumber(row.total ?? row.amount ?? row.value ?? 0),
    documentFields = ["document_number", "number", "product_name", "name", "id"],
    categoryFields = ["storage_name", "provider_name", "category", "counterparty_name"],
    categoryFallback = "—",
  } = options;

  return rows
    .map((row, index) => ({
      number: index + 1,
      document: firstText(row, documentFields, `#${index + 1}`),
      category: firstText(row, categoryFields, categoryFallback),
      amount: Math.max(0, Math.round(amount(row))),
      status: "Проведено",
      statusClass: "badge-success",
      date: formatDateLabel(selectedDate),
    }))
    .filter((row) => row.amount > 0 || row.document !== "—");
}

function normalizePaymentRows(rows = [], total = 0) {
  const revenue = Math.max(0, Number(total) || 0);
  return rows
    .map((row) => {
      const amount = clampAmount(row.amount);
      return {
        name: row.name,
        amount,
        percent: revenue > 0 ? Math.round((amount / revenue) * 100) : 0,
      };
    })
    .filter((row) => row.amount > 0 || row.name === "Другие оплаты");
}

function paymentMethodLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  const labels = {
    cash: "Наличные",
    card: "Карта",
    click: "CLICK",
    payme: "Pay me",
    pay_me: "Pay me",
    paymego: "Pay me",
    uzum: "Uzum Bank",
    loyalty: "Лояльность",
    mixed: "Смешанная оплата",
  };

  return labels[key] || value || "Способ оплаты";
}

function realPaymentRows(dash = {}, total = 0) {
  const revenue = Math.max(0, Number(total) || 0);
  const sourceRows = dash.payment_methods || dash.paymentMethods || dash.payment_breakdown || dash.paymentBreakdown;

  if (Array.isArray(sourceRows) && sourceRows.length) {
    return normalizePaymentRows(sourceRows.map((row) => {
      const rawName = row.name || row.label || row.method || row.payment_method || row.paymentMethod || row.type;
      return {
        name: paymentMethodLabel(rawName),
        amount: row.amount ?? row.total ?? row.revenue ?? row.value ?? 0,
      };
    }), revenue);
  }

  if (Array.isArray(sourceRows)) {
    return revenue > 0 ? normalizePaymentRows([{ name: "Не указано", amount: revenue }], revenue) : [];
  }

  const cash = clampAmount(dash.cash_total ?? dash.cash ?? 0, revenue);
  const nonCash = clampAmount(dash.non_cash_total ?? dash.card_total ?? dash.card ?? Math.max(0, revenue - cash), revenue - cash);

  if (cash > 0 || nonCash > 0) {
    const card = clampAmount(dash.card_total ?? Math.round(nonCash * 0.42), nonCash);
    const click = clampAmount(dash.click_total ?? dash.click ?? Math.round(nonCash * 0.25), nonCash - card);
    const payme = clampAmount(dash.payme_total ?? dash.pay_me_total ?? dash.payme ?? Math.round(nonCash * 0.20), nonCash - card - click);
    const other = clampAmount(nonCash - card - click - payme);

    return normalizePaymentRows([
      { name: "Наличные", amount: cash },
      { name: "Карта", amount: card },
      { name: "CLICK", amount: click },
      { name: "Pay me", amount: payme },
      { name: "Другие оплаты", amount: other },
    ], revenue);
  }

  return [];
}

function configuredPlaceNames(rows = []) {
  const names = rows
    .map((row) => String(row.name || row.label || row.title || "").trim())
    .filter(Boolean);

  return [...new Set(names)];
}

function orderLocationName(value, orderType, placeNames = []) {
  const type = String(orderType || "").trim().toLowerCase();
  if (type === "delivery" || type === "delivery_app") return "Доставка";
  if (type === "takeaway" || type === "pickup") return "Самовывоз";

  const raw = String(value || "").trim();
  if (!raw) return "Зал";

  const rawLower = raw.toLowerCase();
  const matchedPlace = placeNames.find((name) => rawLower.includes(String(name).toLowerCase()));
  if (matchedPlace) return matchedPlace;

  const [beforeComma] = raw.split(",");
  const cleaned = beforeComma.replace(/\s*(стол|table)\s*№?\s*\d+.*/i, "").trim();
  return cleaned || raw || "Зал";
}

function normalizeOrderRows(rows = [], total = 0, placeNames = []) {
  const ordersTotal = Math.max(0, Number(total) || 0);
  const configuredNames = configuredPlaceNames(placeNames);
  const amounts = new Map(configuredNames.map((name) => [name, 0]));

  rows.forEach((row) => {
    const rawName = row.name || row.label || row.place || row.table_number || row.tableNumber || row.location || row.type;
    const name = orderLocationName(rawName, row.order_type || row.orderType || row.type, configuredNames);
    const amount = clampAmount(row.count ?? row.orders ?? row.amount ?? row.total ?? row.value ?? 0);
    amounts.set(name, (amounts.get(name) || 0) + amount);
  });

  return [...amounts.entries()]
    .map(([name, amount]) => ({
      name,
      amount,
      percent: ordersTotal > 0 ? Math.round((amount / ordersTotal) * 100) : 0,
    }))
    .filter((row) => row.amount > 0 || configuredNames.includes(row.name));
}

function realOrderRows(dash = {}, total = 0, placeNames = []) {
  const sourceRows = dash.order_locations || dash.orderLocations || dash.place_orders || dash.placeOrders || dash.order_places || dash.orderPlaces;

  if (Array.isArray(sourceRows)) {
    return normalizeOrderRows(sourceRows, total, placeNames);
  }

  return [];
}

function normalizeMetricRows(rows = [], total = 0, keepZeroNames = []) {
  const base = Math.max(0, Number(total) || 0);
  const keep = new Set(keepZeroNames);

  return rows
    .map((row) => {
      const amount = clampAmount(row.amount ?? row.avg_check ?? row.avgCheck ?? row.value ?? 0);
      return {
        name: row.name || row.label || "Показатель",
        amount,
        percent: base > 0 ? Math.round((amount / base) * 100) : 0,
      };
    })
    .filter((row) => row.amount > 0 || keep.has(row.name));
}

function realAverageRows(dash = {}, avgCheck = 0, placeSettings = []) {
  const sourceRows = dash.avg_check_segments || dash.avgCheckSegments || dash.average_check_segments || dash.averageCheckSegments;
  const places = configuredPlaceNames(placeSettings);

  if (Array.isArray(sourceRows) && sourceRows.length) {
    const grouped = new Map();
    sourceRows.forEach((row) => {
      const name = orderLocationName(row.name || row.place || row.table_number || row.tableNumber || row.type, row.order_type || row.orderType || row.type, places);
      const count = Math.max(1, Number(row.orders_count ?? row.ordersCount ?? row.count ?? 1) || 1);
      const amount = Number(row.avg_check ?? row.avgCheck ?? row.amount ?? row.value ?? 0) || 0;
      const current = grouped.get(name) || { total: 0, count: 0 };
      grouped.set(name, { total: current.total + amount * count, count: current.count + count });
    });

    return normalizeMetricRows([...grouped.entries()].map(([name, row]) => ({
      name,
      amount: row.count ? row.total / row.count : 0,
    })), avgCheck);
  }

  return [];
}

function groupFinanceRows(rows = [], direction) {
  const grouped = new Map();

  rows.forEach((row) => {
    const rowDirection = row.direction || row.type;
    if (rowDirection !== direction) return;

    const name = row.category_name || row.category || row.payment_type_name || row.paymentType || (direction === "expense" ? "Без категории" : "Приход");
    grouped.set(name, (grouped.get(name) || 0) + Number(row.amount || row.total || row.value || 0));
  });

  return [...grouped.entries()].map(([name, amount]) => ({ name, amount }));
}

function realIncomeRows(dash = {}, total = 0, financeRows = []) {
  const sourceRows = dash.income_breakdown || dash.incomeBreakdown || dash.income_sources || dash.incomeSources;
  if (Array.isArray(sourceRows) && sourceRows.length) {
    return normalizeMetricRows(sourceRows.map((row) => ({
      name: row.name || row.label || row.category || row.type || "Приход",
      amount: row.amount ?? row.total ?? row.value ?? 0,
    })), total);
  }

  const financeIncome = groupFinanceRows(financeRows, "income");
  if (financeIncome.length) {
    return normalizeMetricRows(financeIncome, total);
  }

  const paymentRows = realPaymentRows(dash, total);
  return paymentRows;
}

function realExpenseRows(dash = {}, total = 0, financeRows = []) {
  const sourceRows = dash.expense_breakdown || dash.expenseBreakdown || dash.expense_categories || dash.expenseCategories;
  if (Array.isArray(sourceRows) && sourceRows.length) {
    return normalizeMetricRows(sourceRows.map((row) => ({
      name: row.name || row.label || row.category || row.type || "Расход",
      amount: row.amount ?? row.total ?? row.value ?? 0,
    })), total);
  }

  const financeExpense = groupFinanceRows(financeRows, "expense");
  if (financeExpense.length) {
    return normalizeMetricRows(financeExpense, total);
  }

  return [];
}

function pctChange(curr, prev) {
  if (!prev) return 0;
  return Math.round(((curr - prev) / prev) * 100);
}

function noteClassFor(n) {
  if (n > 0) return "kpi-note--up";
  if (n < 0) return "kpi-note--down";
  return "kpi-note--neutral";
}

function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function buildRealKpis(dash, sales, selectedDate, placeSettings = [], financeRows = []) {
  const day = sales.at(-1) || { revenue: 0, orders_count: 0, avg_check: 0 };
  const prev = sales.at(-2) || day;

  const revenue = dash.today_revenue ?? day.revenue;
  const orders = dash.today_orders ?? day.orders_count;
  const avgCheck = dash.avg_check ?? day.avg_check;
  const activeOrders = dash.active_orders ?? 0;

  const revChange = pctChange(revenue, prev.revenue);
  const ordChange = orders - (prev.orders_count || 0);
  const avgChange = pctChange(avgCheck, prev.avg_check);

  const cashTotal = dash.cash_total ?? 0;
  const nonCashTotal = dash.non_cash_total ?? 0;
  const financeIncomeTotal = groupFinanceRows(financeRows, "income").reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const financeExpenseTotal = groupFinanceRows(financeRows, "expense").reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const income = dash.income_total ?? (financeIncomeTotal > 0 ? financeIncomeTotal : revenue);
  const expense = dash.expense_total ?? financeExpenseTotal;
  const prevIncome = prev.revenue || 1;
  const incomeChange = pctChange(income, prevIncome);
  const expenseChange = expense > 0 ? pctChange(expense, Math.round(prevIncome * 0.31)) : 0;

  return [
    {
      className: "premium-kpi--revenue",
      icon: "bi-currency-exchange",
      badge: formatDateLabel(selectedDate),
      label: "Выручка за день",
      value: formatNumber(revenue),
      suffix: "UZS",
      note: `${signed(revChange)}% к вчерашнему дню`,
      noteClass: noteClassFor(revChange),
      progress: Math.max(8, Math.min(100, 72)),
      description: "Дневная выручка по всем закрытым заказам за выбранную дату.",
      details: [
        ["Наличные", `${formatNumber(cashTotal)} UZS`],
        ["Безнал", `${formatNumber(nonCashTotal)} UZS`],
        ["Активные заказы", `${activeOrders}`],
      ],
      paymentRows: realPaymentRows(dash, revenue),
      insight: revChange >= 0
        ? `Темп выше вчерашнего дня на ${Math.abs(revChange)}%.`
        : `Темп ниже вчерашнего дня на ${Math.abs(revChange)}%.`,
    },
    {
      className: "premium-kpi--orders",
      icon: "bi-receipt",
      badge: "Live",
      label: "Заказов",
      value: formatNumber(orders),
      note: `${signed(ordChange)} к вчерашнему дню`,
      noteClass: noteClassFor(ordChange),
      progress: Math.max(8, Math.min(100, Math.round((orders / Math.max(orders + 28, 1)) * 100))),
      description: "Количество заказов за день.",
      details: [
        ["Активные заказы", `${activeOrders}`],
        ["Завершённых", `${Math.max(0, orders - activeOrders)}`],
      ],
      placeRows: realOrderRows(dash, orders, placeSettings),
      insight: "Количество заказов за выбранный день.",
    },
    {
      className: "premium-kpi--avg",
      icon: "bi-graph-up-arrow",
      badge: "Среднее",
      label: "Средний чек",
      value: formatNumber(avgCheck),
      suffix: "UZS",
      note: `${signed(avgChange)}% к вчерашнему дню`,
      noteClass: noteClassFor(avgChange),
      progress: Math.max(8, 65),
      description: "Средняя сумма одного заказа за выбранный день.",
      details: [],
      table: {
        rows: realAverageRows(dash, avgCheck, placeSettings),
        labelColumn: "Канал",
        valueColumn: "Средний чек",
        shareColumn: "Индекс",
        formatValue: formatMoney,
        emptyText: "Нет данных по среднему чеку",
      },
      insight: "Средний чек по всем каналам продаж.",
    },
    {
      className: "premium-kpi--tables",
      icon: "bi-cash-coin",
      badge: "Приход",
      label: "Денежный приход",
      value: formatNumber(income),
      suffix: "UZS",
      note: `${signed(incomeChange)}% к вчерашнему дню`,
      noteClass: noteClassFor(incomeChange),
      progress: Math.max(8, Math.min(100, Math.round((income / Math.max(revenue, 1)) * 100))),
      description: "Фактически полученные деньги за выбранную дату.",
      details: [
        ["Наличные", `${formatNumber(cashTotal)} UZS`],
        ["Безнал", `${formatNumber(nonCashTotal)} UZS`],
      ],
      table: {
        rows: realIncomeRows(dash, income, financeRows),
        labelColumn: "Источник",
        valueColumn: "Приход",
        shareColumn: "Доля",
        formatValue: formatMoney,
        emptyText: "Нет приходов за выбранный день",
      },
      insight: "Денежный приход показывает поступления, прошедшие через оплату.",
    },
    {
      className: "premium-kpi--expense",
      icon: "bi-arrow-up-right-circle",
      badge: "Расход",
      label: "Денежные расходы",
      value: formatNumber(expense),
      suffix: "UZS",
      note: expense > 0 ? `${signed(expenseChange)}% к вчерашнему дню` : "—",
      noteClass: expense > 0 ? noteClassFor(expenseChange) : "kpi-note--neutral",
      progress: Math.max(8, Math.min(100, Math.round((expense / Math.max(revenue, 1)) * 100))),
      description: "Фактические расходы за выбранную дату.",
      details: [],
      table: {
        rows: realExpenseRows(dash, expense, financeRows),
        labelColumn: "Статья расходов",
        valueColumn: "Сумма",
        shareColumn: "Доля",
        formatValue: formatMoney,
        emptyText: "Нет расходов за выбранный день",
      },
      insight: "Денежные расходы за выбранную дату.",
    },
  ];
}

function buildWarehouseSummary(reports = EMPTY_WAREHOUSE_REPORTS, financeRows = [], selectedDate) {
  const incomes = reports.incomes || [];
  const consumption = reports.consumption || [];
  const balances = reports.balances || [];
  const debtCredit = reports.debtCredit || [];
  const stock = reports.stock || [];
  const financeExpenses = groupFinanceRows(financeRows, "expense");

  const incomeTotal = sumRows(incomes, ["total", "amount", "value"]);
  const expenseTotal = sumRows(consumption, ["total", "amount", "value"]);
  const stockBalance = stock.reduce(
    (sum, row) => sum + toFiniteNumber(row.quantity) * toFiniteNumber(row.cost_price),
    0
  );
  const totalCosts = financeExpenses.length ? sumRows(financeExpenses, ["amount"]) : expenseTotal;
  const creditorTotal = debtCredit.reduce((sum, row) => {
    const balance = toFiniteNumber(row.closing_balance ?? row.closingBalance ?? row.balance);
    return balance < 0 ? sum + Math.abs(balance) : sum;
  }, 0);
  const debtorTotal = debtCredit.reduce((sum, row) => {
    const balance = toFiniteNumber(row.closing_balance ?? row.closingBalance ?? row.balance);
    return balance > 0 ? sum + balance : sum;
  }, 0);

  const incomeRows = warehouseRows(incomes, selectedDate, {
    documentFields: ["product_name", "document_number", "number", "name"],
    categoryFields: ["storage_name", "provider_name"],
  });
  const expenseRows = warehouseRows(consumption, selectedDate, {
    documentFields: ["product_name", "document_number", "number", "name"],
    categoryFields: ["storage_name", "receiver", "destination"],
  });
  const stockRows = warehouseRows(stock.length ? stock : balances, selectedDate, {
    amount: (row) => toFiniteNumber(row.quantity) * toFiniteNumber(row.cost_price),
    documentFields: ["ingredient_name", "product_name", "ingredient_id", "product_id"],
    categoryFields: ["warehouse_name", "storage_name", "warehouse_id", "storage_id"],
  });
  const totalCostRows = warehouseRows(financeExpenses.length ? financeExpenses : consumption, selectedDate, {
    documentFields: ["name", "product_name", "document_number", "number"],
    categoryFields: ["category", "storage_name"],
    categoryFallback: "Расход",
  });
  const creditorRows = warehouseRows(
    debtCredit.filter((row) => toFiniteNumber(row.closing_balance ?? row.closingBalance ?? row.balance) < 0),
    selectedDate,
    {
      amount: (row) => Math.abs(toFiniteNumber(row.closing_balance ?? row.closingBalance ?? row.balance)),
      documentFields: ["counterparty_name", "counterparty", "name"],
      categoryFields: ["status"],
      categoryFallback: "Кредиторка",
    }
  );
  const debtorRows = warehouseRows(
    debtCredit.filter((row) => toFiniteNumber(row.closing_balance ?? row.closingBalance ?? row.balance) > 0),
    selectedDate,
    {
      amount: (row) => toFiniteNumber(row.closing_balance ?? row.closingBalance ?? row.balance),
      documentFields: ["counterparty_name", "counterparty", "name"],
      categoryFields: ["status"],
      categoryFallback: "Дебиторка",
    }
  );

  return [
    { label: "Приход товаров", value: incomeTotal, icon: "bi-download", tone: "income", rows: incomeRows },
    { label: "Расход товаров", value: expenseTotal, icon: "bi-upload", tone: "expense", rows: expenseRows },
    { label: "Остаток склада", value: stockBalance, icon: "bi-box", tone: "stock", rows: stockRows },
    { label: "Общие затраты", value: totalCosts, icon: "bi-wallet2", tone: "costs", rows: totalCostRows },
    { label: "Кредиторка", value: creditorTotal, icon: "bi-arrow-up-right-circle", tone: "creditor", rows: creditorRows },
    { label: "Дебиторка", value: debtorTotal, icon: "bi-arrow-down-left-circle", tone: "debtor", rows: debtorRows },
  ];
}

function dishDisplayName(name = "") {
  const normalized = name.toLowerCase().replaceAll("'", "").replaceAll("‘", "").replaceAll("’", "");
  const translations = {
    lagmon: "Лагман",
    lagman: "Лагман",
    palov: "Плов",
    pilaf: "Плов",
    shashlik: "Шашлык",
    "salat mix": "Салат микс",
    "salad mix": "Салат микс",
    manti: "Манты",
  };
  return translations[normalized] || name;
}

function dishPhotoClass(name = "", index = 0) {
  const normalized = name.toLowerCase();
  if (normalized.includes("лаг") || normalized.includes("lag")) return "dish-photo--lagman";
  if (normalized.includes("плов") || normalized.includes("palov") || normalized.includes("pilaf")) return "dish-photo--palov";
  if (normalized.includes("шаш") || normalized.includes("shash")) return "dish-photo--shashlik";
  if (normalized.includes("сал") || normalized.includes("sal")) return "dish-photo--salad";
  if (normalized.includes("мант") || normalized.includes("mant")) return "dish-photo--manti";
  return `dish-photo--${(index % 5) + 1}`;
}

function RevenueChart({ sales }) {
  const canvasRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const ctx = canvasRef.current.getContext("2d");
    const revealState = { progress: 0, didClip: false };
    const revealDuration = 1200;
    const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);
    const revealPlugin = {
      id: "revenueChartReveal",
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
    const gradient = ctx.createLinearGradient(0, 0, 0, 360);
    gradient.addColorStop(0, "rgba(29, 181, 181, 0.28)");
    gradient.addColorStop(0.55, "rgba(31, 202, 194, 0.10)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

    const chart = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: sales.map((item) => new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(item.date))),
        datasets: [{
          data: sales.map((item) => Number(item.revenue || 0)),
          borderColor: "#1db5b5",
          backgroundColor: gradient,
          borderWidth: 4,
          pointBackgroundColor: "#FFFFFF",
          pointBorderColor: "#1db5b5",
          pointBorderWidth: 3,
          pointRadius: 4,
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
            external: ({ chart, tooltip }) => {
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
              const maxX = chart.width - tooltipHalfWidth - 8;
              const x = Math.min(Math.max(tooltip.caretX, minX), maxX);
              const y = Math.max(tooltip.caretY - 10, 16);

              tooltipEl.style.left = `${chart.canvas.offsetLeft + x}px`;
              tooltipEl.style.top = `${chart.canvas.offsetTop + y}px`;
              tooltipEl.classList.add("is-visible");
            },
            callbacks: { label: (context) => formatMoney(context.parsed.y) },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#667085", font: { size: 12, weight: "600", family: "'Golos Text', Manrope, sans-serif" } }, border: { display: false } },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(16, 24, 40, 0.08)", drawTicks: false },
            ticks: {
              color: "#667085",
              font: { size: 12, weight: "600", family: "'Golos Text', Manrope, sans-serif" },
              callback: (value) => `${Number(value) / 1000000}M`,
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
  }, [sales]);

  return (
    <>
      <canvas ref={canvasRef} id="ownerRevenueChart" />
      <div className="owner-revenue-tooltip" ref={tooltipRef} aria-hidden="true">
        <strong />
        <span />
      </div>
    </>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="card dashboard-empty">
      <div>
        <div className="dashboard-empty__mark"><Icon name="bi-shop" size={20} /></div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}

function ShiftSummaryCard({ summary }) {
  return (
    <aside className="card card-pad shift-summary-card shift-summary-card--window">
      <div className="shift-summary-card__header">
        <div>
          <span className="eyebrow">Live operations</span>
          <h2>Сводка смены</h2>
        </div>
        <div className="shift-summary-card__status" aria-label="Смена открыта">
          <span />
          Смена открыта
        </div>
      </div>

      <div className="shift-summary-card__open-time">
        <Icon name="bi-clock-history" size={20} />
        <span>Время открытия</span>
        <strong>09:00</strong>
      </div>

      <div className="shift-summary-card__stats">
        <div>
          <span>Касса</span>
          <strong>{formatMoney(summary.revenue)}</strong>
        </div>
        <div>
          <span>Заказы</span>
          <strong>{summary.orders}</strong>
        </div>
        <div>
          <span>Зал</span>
          <strong>{summary.occupancy}%</strong>
        </div>
        <div>
          <span>Среднее время</span>
          <strong>{summary.avgTime} мин</strong>
        </div>
      </div>

      <div className="shift-summary-card__load">
        <div>
          <span>Загруженность зала</span>
          <strong>{summary.occupancy}%</strong>
        </div>
        <div className="shift-summary-card__progress" aria-hidden="true">
          <i style={{ width: `${summary.occupancy}%` }} />
        </div>
      </div>

      <div className="shift-summary-card__alert">
        <div className="shift-summary-card__alert-icon"><Icon name="bi-exclamation-triangle" size={20} /></div>
        <p>Куриное филе заканчивается — осталось 2 кг</p>
        <span>Важно</span>
      </div>

      <div className="shift-summary-card__actions">
        <Link className="shift-summary-card__primary" to="/orders">Управление сменой</Link>
        <Link className="shift-summary-card__link" to="/reports/z-report">Посмотреть отчёт</Link>
      </div>
    </aside>
  );
}

function QuickActionsCard({ activeOrders, occupancy, avgTime }) {
  return (
    <section className="card card-pad quick-actions quick-actions--command">
      <div className="section-header">
        <div>
          <span className="eyebrow">Command center</span>
          <h2>Быстрые действия</h2>
          <p className="quick-actions__subtitle">Самые частые операции владельца в одном месте</p>
        </div>
        <span className="quick-actions__live"><Icon name="bi-lightning-charge-fill" size={20} /> Live</span>
      </div>

      <div className="quick-actions__grid">
        <Link to="/orders"><Icon name="bi-plus-circle" size={20} /><span>Новый заказ</span><small>Создать продажу</small></Link>
        <Link to="/menu"><Icon name="bi-journal-plus" size={20} /><span>Добавить блюдо</span><small>{products.length} блюд в меню</small></Link>
        <Link to="/staff"><Icon name="bi-person-plus" size={20} /><span>Сотрудник</span><small>{employees.length} в команде</small></Link>
        <Link to="/finance"><Icon name="bi-file-earmark-spreadsheet" size={20} /><span>Финансы</span><small>Отчеты и касса</small></Link>
      </div>

      <div className="quick-actions__insights">
        <div className="quick-actions__metric">
          <span>Активные заказы</span>
          <strong>{activeOrders}</strong>
        </div>
        <div className="quick-actions__metric">
          <span>Меню</span>
          <strong>{products.length}</strong>
        </div>
        <div className="quick-actions__metric">
          <span>Команда</span>
          <strong>{employees.length}</strong>
        </div>
        <div className="quick-actions__metric">
          <span>Столы заняты</span>
          <strong>{occupancy}%</strong>
        </div>
        <div className="quick-actions__metric">
          <span>Среднее время</span>
          <strong>{avgTime} мин</strong>
        </div>
      </div>
    </section>
  );
}

function RecentOrdersCard({ orders }) {
  const hasOrders = orders.length > 0;

  return (
    <section className="card card-pad recent-orders-card">
      <div className="section-header">
        <div>
          <span className="eyebrow">Последние заказы</span>
          <h2>Последние заказы</h2>
        </div>
        <Link className="btn btn-ghost" to="/reports/orders">Все заказы</Link>
      </div>
      <div className="recent-orders-list">
        {hasOrders ? orders.map((order) => (
          <div className="recent-order" key={order.id}>
            <strong>{order.id}</strong>
            <span>{order.date}</span>
            <span>{order.place}</span>
            <em>{order.amount}</em>
            <small className={order.ready ? "is-ready" : "is-progress"}>{order.status}</small>
          </div>
        )) : (
          <div className="recent-order">
            <strong>—</strong>
            <span>Нет заказов за выбранную дату</span>
            <span>—</span>
            <em>{formatMoney(0)}</em>
            <small>—</small>
          </div>
        )}
      </div>
    </section>
  );
}

function TopSalesCard({ dishes }) {
  const hasDishes = dishes.length > 0;

  return (
    <section className="card card-pad top-dishes-card owner-top-sales-card">
      <div className="section-header">
        <div>
          <span className="eyebrow">Лучшие продажи</span>
          <h2>Топ-5 продаж</h2>
        </div>
        <Link className="btn btn-ghost" to="/menu">Все блюда</Link>
      </div>
      <div className="top-dishes-list">
        {hasDishes ? dishes.map((item, index) => (
          <div className="top-dish top-dish--compact" key={item.product_id || item.name}>
            <div className="top-dish__rank">{index + 1}</div>
            <div className={`top-dish__photo ${dishPhotoClass(item.name, index)}`} aria-hidden="true" />
            <div className="top-dish__body">
              <div className="top-dish__line">
                <strong>{dishDisplayName(item.name)}</strong>
              </div>
            </div>
            <div className="top-dish__qty">{formatNumber(item.quantity)} шт</div>
            <div className="top-dish__price">{formatMoney(item.revenue)}</div>
          </div>
        )) : (
          <div className="top-dish top-dish--compact">
            <div className="top-dish__rank">—</div>
            <div className="top-dish__photo dish-photo--1" aria-hidden="true" />
            <div className="top-dish__body">
              <div className="top-dish__line">
                <strong>Нет продаж за выбранную дату</strong>
              </div>
            </div>
            <div className="top-dish__qty">0 шт</div>
            <div className="top-dish__price">{formatMoney(0)}</div>
          </div>
        )}
      </div>
    </section>
  );
}

function formatOrderCount(value) {
  const count = Math.round(Number(value) || 0);
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? "заказ"
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? "заказа"
      : "заказов";

  return `${formatNumber(count)} ${word}`;
}

function KpiPaymentTable({
  rows = [],
  labelColumn = "Способ оплаты",
  valueColumn = "Выручка",
  shareColumn = "Доля",
  formatValue = formatMoney,
  emptyText = "Нет оплат за выбранный день",
}) {
  const hasRows = rows.length > 0;

  return (
    <div className="kpi-payment-report">
      <div className="kpi-payment-report__table-wrap">
        <table className="kpi-payment-report__table">
          <thead>
            <tr>
              <th>{labelColumn}</th>
              <th>{valueColumn}</th>
              <th>{shareColumn}</th>
            </tr>
          </thead>
          <tbody>
            {hasRows ? rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{formatValue(row.amount)}</td>
                  <td>
                    <div className="kpi-payment-report__share">
                      <span aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, row.percent))}%` }} /></span>
                      <strong>{row.percent}%</strong>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td className="kpi-payment-report__empty" colSpan={3}>{emptyText}</td>
                </tr>
              )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiInfoDialog({ kpi, onClose }) {
  const hasCustomTable = kpi?.table && Array.isArray(kpi.table.rows);
  const hasPlaceTable = !hasCustomTable && Array.isArray(kpi?.placeRows);
  const tableRows = hasPlaceTable ? kpi.placeRows : !hasCustomTable && Array.isArray(kpi?.paymentRows) ? kpi.paymentRows : null;
  const tableProps = hasCustomTable ? kpi.table : hasPlaceTable
    ? {
      rows: tableRows,
      labelColumn: "Место",
      valueColumn: "Заказы",
      formatValue: formatOrderCount,
      emptyText: "Нет заказов за выбранный день",
    }
    : {
      rows: tableRows || [],
    };
  const hasTable = hasCustomTable || Array.isArray(tableRows);

  useEffect(() => {
    if (!kpi) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [kpi, onClose]);

  if (!kpi) return null;

  const container = document.querySelector(".dashboard-main") || document.body;

  return createPortal(
    <div className="kpi-info-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`kpi-info-window ${kpi.className} ${hasTable ? "kpi-info-window--payment-table" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-info-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={`kpi-info-window__head ${hasTable ? "kpi-info-window__head--payment-table" : ""}`}>
          {hasTable ? null : <div className="kpi-info-window__icon"><Icon name={kpi.icon} size={20} /></div>}
          <div>
            <span>{kpi.badge}</span>
            <h2 id="kpi-info-title">{kpi.label}</h2>
          </div>
          <button type="button" className="kpi-info-window__close" aria-label="Закрыть" onClick={onClose}>
            <Icon name="bi-x-lg" size={20} />
          </button>
        </div>

        <div className="kpi-info-window__value">
          <strong>{kpi.value}</strong>
          {kpi.suffix ? <small>{kpi.suffix}</small> : null}
        </div>
        <p>{kpi.description}</p>

        {hasTable ? (
          <KpiPaymentTable {...tableProps} />
        ) : (
          <div className="kpi-info-window__details">
            {kpi.details.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        )}

        {hasTable ? null : (
          <div className="kpi-info-window__insight">
            <Icon name="bi-info-circle" size={20} />
            <span>{kpi.insight}</span>
          </div>
        )}
      </section>
    </div>,
    container
  );
}

function WarehouseReportDialog({ report, selectedDate, onClose }) {
  useEffect(() => {
    if (!report) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [report, onClose]);

  const rows = useMemo(() => report?.rows || [], [report]);

  if (!report) return null;

  const container = document.querySelector(".dashboard-main") || document.body;

  return createPortal(
    <div className="kpi-info-backdrop warehouse-report-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`warehouse-report-window warehouse-report-window--${report.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="warehouse-report-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="warehouse-report-window__head">
          <div className="warehouse-report-window__icon"><Icon name={report.icon} size={20} /></div>
          <div>
            <span>Складской отчёт</span>
            <h2 id="warehouse-report-title">{report.label}</h2>
          </div>
          <button type="button" className="warehouse-report-window__close" aria-label="Закрыть" onClick={onClose}>
            <Icon name="bi-x-lg" size={20} />
          </button>
        </div>

        <div className="warehouse-report-window__value">
          <strong>{formatNumber(report.value)}</strong>
          <small>UZS</small>
        </div>
        <p>Табличный отчёт по выбранному показателю склада за {formatDateLabel(selectedDate)}.</p>

        <div className="warehouse-report-table-wrap">
          <table className="data-table warehouse-report-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Документ</th>
                <th>Категория / Поставщик</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Дата</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row) => (
                <tr key={`${row.number}-${row.document}`}>
                  <td>{row.number}</td>
                  <td>{row.document}</td>
                  <td>{row.category}</td>
                  <td>{formatMoney(row.amount)}</td>
                  <td><span className={`badge ${row.statusClass}`}>{row.status}</span></td>
                  <td>{row.date}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6}>Нет данных за выбранную дату</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>,
    container
  );
}

export default function OwnerDashboard() {
  const { selectedDate = todayInputValue() } = useOutletContext();
  const [revenueRange, setRevenueRange] = useState(() => reportRangeEndingAt(7, selectedDate));
  const [selectedKpi, setSelectedKpi] = useState(null);
  const [selectedWarehouseReport, setSelectedWarehouseReport] = useState(null);
  const hasLoadedRef = useRef(false);
  const lastSelectedDateRef = useRef(selectedDate);
  const [dashboard, setDashboard] = useState(null);
  const [sales, setSales] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [products, setProducts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [placeSettings, setPlaceSettings] = useState([]);
  const [financeTransactions, setFinanceTransactions] = useState([]);
  const [warehouseReports, setWarehouseReports] = useState(EMPTY_WAREHOUSE_REPORTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const normalizedRevenueRange = useMemo(() => normalizeReportRange(revenueRange), [revenueRange]);
  const revenueParams = useMemo(() => reportRangeToApiParams(normalizedRevenueRange), [normalizedRevenueRange]);
  const revenuePeriod = useMemo(() => reportRangeDays(normalizedRevenueRange), [normalizedRevenueRange]);
  const revenuePeriodLabel = reportRangeLabel(normalizedRevenueRange);
  const revenuePresetOptions = useMemo(() => ([
    { label: "7 дней", getRange: () => ({ ...reportRangeEndingAt(7, selectedDate), preset: "7 дней" }) },
    { label: "30 дней", getRange: () => ({ ...reportRangeEndingAt(30, selectedDate), preset: "30 дней" }) },
  ]), [selectedDate]);

  useEffect(() => {
    if (lastSelectedDateRef.current === selectedDate) {
      return;
    }

    lastSelectedDateRef.current = selectedDate;
    setRevenueRange((current) => reportRangeEndingAt(reportRangeDays(current), selectedDate));
  }, [selectedDate]);

  useEffect(() => {
    let mounted = true;
    setLoading(!hasLoadedRef.current);
    setError("");
    const params = revenueParams;
    const dayParams = { date_from: selectedDate, date_to: selectedDate };

    Promise.all([
      api.get("/analytics/dashboard", { params: { date: selectedDate } }),
      api.get("/analytics/sales", { params }),
      api.get("/analytics/products/top", { params: { limit: 5, ...dayParams } }),
      api.get("/inventory/products"),
      api.get("/hr/employees"),
      api.get("/pos/orders", { params: { date: selectedDate } }),
      api.get("/settings/places").catch(() => ({ data: [] })),
      api.get("/finance/transactions", { params: { date_from: selectedDate, date_to: selectedDate } }).catch(() => ({ data: [] })),
      api.get("/reports/incomes", { params: dayParams }).catch(() => ({ data: [] })),
      api.get("/reports/consumption", { params: dayParams }).catch(() => ({ data: [] })),
      api.get("/reports/storage-balances", { params: dayParams }).catch(() => ({ data: [] })),
      api.get("/reports/debt-credit", { params: dayParams }).catch(() => ({ data: [] })),
      api.get("/inventory/stock").catch(() => ({ data: [] })),
    ]).then(([
      dashboardRes,
      salesRes,
      topRes,
      productsRes,
      employeesRes,
      ordersRes,
      placesRes,
      financeRes,
      incomeRes,
      consumptionRes,
      balanceRes,
      debtCreditRes,
      stockRes,
    ]) => {
      if (!mounted) return;
      setDashboard(dashboardRes.data);
      setSales(apiList(salesRes.data));
      setTopProducts(apiList(topRes.data));
      setProducts(apiList(productsRes.data));
      setEmployees(apiList(employeesRes.data));
      const orderList = apiList(ordersRes.data);
      setRecentOrders(orderList.slice(0, 5));
      const placeList = apiList(placesRes.data);
      setPlaceSettings(placeList);
      const financeList = apiList(financeRes.data);
      setFinanceTransactions(financeList);
      setWarehouseReports({
        incomes: apiList(incomeRes.data),
        consumption: apiList(consumptionRes.data),
        balances: apiList(balanceRes.data),
        debtCredit: apiList(debtCreditRes.data),
        stock: apiList(stockRes.data),
      });
      hasLoadedRef.current = true;
    }).catch((err) => {
      if (mounted) setError(err.response?.data?.detail || "Не удалось загрузить dashboard данные.");
    }).finally(() => mounted && setLoading(false));

    return () => { mounted = false; };
  }, [revenueParams, selectedDate]);

  const displaySales = useMemo(() => sales, [sales]);
  const displayDashboard = useMemo(() => (
    dashboard && dashboard.today_revenue !== undefined ? dashboard : EMPTY_DASHBOARD
  ), [dashboard]);
  const kpis = useMemo(() => {
    return buildRealKpis(displayDashboard, displaySales, selectedDate, placeSettings, financeTransactions);
  }, [displayDashboard, displaySales, selectedDate, placeSettings, financeTransactions]);
  const displayTopDishes = useMemo(() => {
  if (topProducts.length > 0) {
    const maxRevenue = Number(topProducts[0]?.revenue || 1);
    return topProducts.map((item, index) => ({
      product_id: item.product_id || `p-${index}`,
      name: item.name,
      quantity: item.quantity_sold,
      revenue: Number(item.revenue || 0),
      change: "",
      positive: true,
      progress: Math.max(22, Math.round((Number(item.revenue || 0) / maxRevenue) * 100)),
    }));
  }
  return [];
}, [topProducts]);
  const warehouseSummary = useMemo(
    () => buildWarehouseSummary(warehouseReports, financeTransactions, selectedDate),
    [warehouseReports, financeTransactions, selectedDate]
  );
  const recentOrdersList = useMemo(() => {
    if (recentOrders.length > 0) {
      return recentOrders.map((order) => {
        const created = order.created_at ? new Date(order.created_at) : new Date();
        const time = created.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        const dateLabel = created.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
        const ready = order.status === "completed" || order.status === "ready";
        return {
          id: `#${order.order_number || order.id?.slice(0, 6)}`,
          date: `${dateLabel} ${time}`,
          place: order.table_number ? `Стол ${order.table_number}` : order.order_type || "—",
          amount: formatMoney(order.total_amount || 0),
          status: ready ? "Готов" : order.status === "cancelled" ? "Отменён" : "В работе",
          ready,
        };
      });
    }
    return [];
  }, [recentOrders]);
  const revenueStats = useMemo(() => {
    const revenues = displaySales.map((item) => Number(item.revenue || 0));
    const total = revenues.reduce((acc, value) => acc + value, 0);
    return {
      max: revenues.length ? Math.max(...revenues) : 0,
      min: revenues.length ? Math.min(...revenues) : 0,
      avg: revenues.length ? Math.round(total / revenues.length) : 0,
    };
  }, [displaySales]);
  if (loading) return <PageLoader />;
  if (error) return <EmptyState title="Dashboard недоступен" text={error} />;

  return (
    <>
      <div className="owner-kpi-band">
        <section className="kpi-grid kpi-grid--premium">
          {kpis.map((kpi) => (
            <button
              className={`kpi-card premium-kpi ${kpi.className}`}
              key={kpi.label}
              type="button"
              onClick={() => setSelectedKpi(kpi)}
              aria-haspopup="dialog"
            >
              <div className="premium-kpi__top">
                <div className="premium-kpi__icon"><Icon name={kpi.icon} size={20} /></div>
                <span className="trend">{kpi.badge}</span>
              </div>
              <div className="kpi-label">{kpi.label}</div>
              <div className="kpi-value">{kpi.value} {kpi.suffix ? <small>{kpi.suffix}</small> : null}</div>
              <div className={`kpi-note ${kpi.noteClass}`}>{kpi.note}</div>
              <div className="premium-kpi__progress"><i style={{ width: `${kpi.progress}%` }} /></div>
            </button>
          ))}
        </section>
        <div className="owner-kpi-band__side" aria-hidden="true" />
      </div>
      <KpiInfoDialog kpi={selectedKpi} onClose={() => setSelectedKpi(null)} />
      <WarehouseReportDialog report={selectedWarehouseReport} selectedDate={selectedDate} onClose={() => setSelectedWarehouseReport(null)} />

      <section className="owner-main-grid">
        <div className="card card-pad chart-card premium-chart">
          <div className="section-header section-header--stack">
            <div><span className="eyebrow">Revenue analytics</span><h2>Выручка за {formatDaysLabel(revenuePeriod)}</h2><p>{revenuePeriodLabel}</p></div>
            <div className="period-switcher owner-revenue-switcher" aria-label="Период выручки">
              <div className="owner-revenue-range report-actions">
                <ReportDateRangePicker
                  value={normalizedRevenueRange}
                  onChange={(nextRange) => setRevenueRange(normalizeReportRange(nextRange))}
                  buttonClassName="period-dropdown__button owner-revenue-range__button"
                  presets={revenuePresetOptions}
                  formatButtonLabel={(range) => formatDaysLabel(reportRangeDays(range))}
                  showDropdownIcon
                  showTime={false}
                />
              </div>
              <Link className="period-switcher__details" to="/analytics">Подробнее</Link>
            </div>
          </div>
          <div className="revenue-stat-grid">
            <div><span>Максимум</span><strong>{formatMoney(revenueStats.max)}</strong></div>
            <div><span>Минимум</span><strong>{formatMoney(revenueStats.min)}</strong></div>
            <div><span>Среднее</span><strong>{formatMoney(revenueStats.avg)}</strong></div>
          </div>
          <div className="chart-wrap"><RevenueChart sales={displaySales} /></div>
        </div>

        <aside className="warehouse-summary-card">
          <div className="warehouse-summary-list">
            {warehouseSummary.map((item) => (
              <button
                className={`warehouse-summary-item warehouse-summary-item--${item.tone}`}
                key={item.label}
                type="button"
                onClick={() => setSelectedWarehouseReport(item)}
                aria-haspopup="dialog"
              >
                <span className="warehouse-summary-item__icon"><Icon name={item.icon} size={18} /></span>
                <div>
                  <strong>{item.label}</strong>
                  <span>{formatMoney(item.value)}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section className="owner-widgets">
        <TopSalesCard dishes={displayTopDishes} />
        <RecentOrdersCard orders={recentOrdersList} />
      </section>
    </>
  );
}

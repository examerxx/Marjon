import { formatMoney, formatNumber } from "../../api/client";
import { formatDateLabel, todayInputValue, toDateInputValue } from "../../utils/date";
import { t } from "../../i18n/t";

// Реальные аналитические преобразования OWNER-дашборда: нормализация строк
// оплат/заказов/среднего чека, сборка KPI и складской сводки.
// Вынесено из OwnerDashboard.jsx (FE-07B). Только реальные данные, без фабрикаций.

export const EMPTY_DASHBOARD = {
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

export const EMPTY_WAREHOUSE_REPORTS = {
  incomes: [],
  consumption: [],
  balances: [],
  debtCredit: [],
  stock: [],
};

export function clampAmount(value, max = Number.POSITIVE_INFINITY) {
  return Math.max(0, Math.min(Math.round(Number(value) || 0), max));
}

export function apiList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

export function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function firstText(row, fields, fallback = "—") {
  for (const field of fields) {
    const value = row?.[field];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value);
    }
  }
  return fallback;
}

export function sumRows(rows = [], fields = []) {
  return rows.reduce((sum, row) => {
    for (const field of fields) {
      if (row?.[field] !== undefined && row?.[field] !== null) {
        return sum + toFiniteNumber(row[field]);
      }
    }
    return sum;
  }, 0);
}

export function warehouseRows(rows = [], selectedDate, options = {}) {
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

export function normalizePaymentRows(rows = [], total = 0) {
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

export function paymentMethodLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  const labels = {
    cash: t("dashboard.cash_revenue"),
    card: "Карта",
    click: "CLICK",
    payme: "Pay me",
    pay_me: "Pay me",
    paymego: "Pay me",
    uzum: "Uzum Bank",
    loyalty: "Лояльность",
    mixed: "Смешанная оплата",
    // Исторические заказы, закрытые до включения учёта оплат (счёт закрыт
    // старой версией приложения, записи в payments не было). Способ оплаты
    // неизвестен, поэтому показываем это явно, а не выдаём за наличные.
    legacy: "Способ не указан (до обновления)",
  };

  return labels[key] || value || "Способ оплаты";
}

export function realPaymentRows(dash = {}, total = 0) {
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

  return [];
}

export function configuredPlaceNames(rows = []) {
  const names = rows
    .map((row) => String(row.name || row.label || row.title || "").trim())
    .filter(Boolean);

  return [...new Set(names)];
}

export function orderLocationName(value, orderType, placeNames = []) {
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

export function normalizeOrderRows(rows = [], total = 0, placeNames = []) {
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

export function realOrderRows(dash = {}, total = 0, placeNames = []) {
  const sourceRows = dash.order_locations || dash.orderLocations || dash.place_orders || dash.placeOrders || dash.order_places || dash.orderPlaces;

  if (Array.isArray(sourceRows)) {
    return normalizeOrderRows(sourceRows, total, placeNames);
  }

  return [];
}

export function normalizeMetricRows(rows = [], total = 0, keepZeroNames = []) {
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

export function realAverageRows(dash = {}, avgCheck = 0, placeSettings = []) {
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

export function groupFinanceRows(rows = [], direction) {
  const grouped = new Map();

  rows.forEach((row) => {
    const rowDirection = row.direction || row.type;
    if (rowDirection !== direction) return;

    const name = row.category_name || row.category || row.payment_type_name || row.paymentType || (direction === "expense" ? "Без категории" : "Приход");
    grouped.set(name, (grouped.get(name) || 0) + Number(row.amount || row.total || row.value || 0));
  });

  return [...grouped.entries()].map(([name, amount]) => ({ name, amount }));
}

export function realIncomeRows(dash = {}, total = 0, financeRows = []) {
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

export function realExpenseRows(dash = {}, total = 0, financeRows = []) {
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

export function pctChange(curr, prev) {
  if (!prev) return 0;
  return Math.round(((curr - prev) / prev) * 100);
}

export function noteClassFor(n) {
  if (n > 0) return "kpi-note--up";
  if (n < 0) return "kpi-note--down";
  return "kpi-note--neutral";
}

export function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

export function buildRevenueChartSales(rows) {
  return Array.isArray(rows) ? rows : [];
}

// Денежный приход одного бакета. Бэкенд с базой
// `completed_income_minus_snapshot_cogs` отдаёт рядом с `revenue` ещё и
// `income` (приход) и `cogs` (себестоимость), где revenue = income − cogs.
// График на дашборде показывает именно приход, поэтому берём `income`.
// Старые ответы поля не несут — тогда честно падаем обратно на `revenue`,
// чтобы график не превратился в нули.
export function bucketIncome(item) {
  const value = item?.income ?? item?.revenue;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Display-only zero buckets for the Revenue Analytics no-data state.
// NOT business data: every value is exactly 0 ("no sales occurred in these
// buckets"). Derived in render from the selected period, never stored/sent.
// Ось одного дня идёт до конца суток: последний бакет 23:59, а не 21:00.
const ZERO_DAY_HOURS = ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00", "23:59"];

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

export function buildZeroRevenueBuckets(dateFrom, dateTo) {
  const from = isIsoDate(dateFrom) ? dateFrom : todayInputValue();
  const to = isIsoDate(dateTo) && dateTo >= from ? dateTo : from;

  if (from === to) {
    return ZERO_DAY_HOURS.map((time) => ({
      date: `${from}T${time}:00`,
      chartLabel: time,
      revenue: 0,
      orders_count: 0,
      avg_check: 0,
      isDisplayOnly: true,
    }));
  }

  const days = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(`${from}T00:00:00`);
    date.setDate(date.getDate() + index);
    return {
      date: toDateInputValue(date),
      revenue: 0,
      orders_count: 0,
      avg_check: 0,
      isDisplayOnly: true,
    };
  });
}

export function buildRealKpis(dash, sales, selectedDate, placeSettings = [], financeRows = []) {
  // Почасовые бакеты одного дня (chart_label "HH:00" от /analytics/sales)
  // для day-over-day сравнения не годятся: «вчера» — это предыдущий
  // ДНЕВНОЙ бакет, а не соседний час. История — только по дневным.
  const dailySales = Array.isArray(sales)
    ? sales.filter((item) => !(item && typeof item.chart_label === "string" && item.chart_label))
    : [];
  const day = dailySales.at(-1) || { revenue: 0, orders_count: 0, avg_check: 0 };
  const prev = dailySales.at(-2) || day;

  // A truthful day-over-day comparison needs a real previous datapoint. A new
  // company with no sales history (sales.length < 2) has no "вчера" to compare
  // to, so we must not print a fabricated "±0% к вчерашнему дню".
  const hasHistory = dailySales.length >= 2;

  const revenue = dash.today_revenue ?? day.revenue;
  const orders = dash.today_orders ?? day.orders_count;
  const avgCheck = dash.avg_check ?? day.avg_check;
  const activeOrders = dash.active_orders ?? 0;

  const revChange = pctChange(revenue, prev.revenue);
  const ordChange = orders - (prev.orders_count || 0);
  const avgChange = pctChange(avgCheck, prev.avg_check);

  const cashTotal = dash.cash_total;
  const nonCashTotal = dash.non_cash_total;
  const financeIncomeTotal = groupFinanceRows(financeRows, "income").reduce((sum, row) => sum + Number(row.amount), 0);
  const financeExpenseTotal = groupFinanceRows(financeRows, "expense").reduce((sum, row) => sum + Number(row.amount), 0);
  const income = dash.income_total ?? financeIncomeTotal;
  const expense = dash.expense_total ?? financeExpenseTotal;

  // Карточки собираются по ИМЕНИ в порядке определения (revenue, orders, avg,
  // income, expense) — на этот порядок опираются финансовые расчёты ниже.
  // Порядок на экране задаётся отдельно (`kpis`), поэтому перестановка карточек
  // не может переназначить значение чужой карточке.
  const [revenueKpi, ordersKpi, avgKpi, incomeKpi, expenseKpi] = [
    {
      className: "premium-kpi--revenue",
      icon: "bi-wallet2",
      badge: formatDateLabel(selectedDate),
      label: t("pages.dashboard.analyticsdata.chistaya_pribyl"),
      value: formatNumber(revenue),
      suffix: "UZS",
      note: hasHistory ? `${signed(revChange)}% к вчерашнему дню` : "Нет данных для сравнения",
      noteClass: hasHistory ? noteClassFor(revChange) : "kpi-note--neutral",
      progress: Math.max(8, Math.min(100, 72)),
      description: t("pages.dashboard.analyticsdata.dnevnaya_vyruchka_po_vsem_zakrytym_zakazam_za"),
      details: [
        [t("dashboard.cash_revenue"), cashTotal == null ? t("common.unavailable") : `${formatNumber(cashTotal)} UZS`],
        [t("common.noncash"), nonCashTotal == null ? t("common.unavailable") : `${formatNumber(nonCashTotal)} UZS`],
        ["Активные заказы", `${activeOrders}`],
      ],
      paymentRows: realPaymentRows(dash, revenue),
      insight: !hasHistory
        ? "Пока нет данных за предыдущий день для сравнения."
        : revChange >= 0
          ? `Темп выше вчерашнего дня на ${Math.abs(revChange)}%.`
          : `Темп ниже вчерашнего дня на ${Math.abs(revChange)}%.`,
    },
    {
      className: "premium-kpi--orders",
      icon: "bi-receipt",
      badge: "Live",
      label: t("pages.dashboard.analyticsdata.zakazy"),
      value: formatNumber(orders),
      dialogSuffix: "шт",
      note: hasHistory ? `${signed(ordChange)} к вчерашнему дню` : "Заказов пока нет",
      noteClass: hasHistory ? noteClassFor(ordChange) : "kpi-note--neutral",
      progress: Math.max(8, Math.min(100, Math.round((orders / Math.max(orders + 28, 1)) * 100))),
      description: t("pages.dashboard.analyticsdata.kolichestvo_zakazov_za_den"),
      details: [
        ["Активные заказы", `${activeOrders}`],
        ["Завершённых", `${Math.max(0, orders - activeOrders)}`],
      ],
      placeRows: realOrderRows(dash, orders, placeSettings),
      insight: "Количество заказов за выбранный день.",
    },
    {
      className: "premium-kpi--avg",
      icon: "bi-file-earmark-bar-graph",
      badge: "Среднее",
      label: t("pages.dashboard.analyticsdata.sredniy_chek"),
      value: formatNumber(avgCheck),
      suffix: "UZS",
      note: hasHistory ? `${signed(avgChange)}% к вчерашнему дню` : "Появится после первых заказов",
      noteClass: hasHistory ? noteClassFor(avgChange) : "kpi-note--neutral",
      progress: Math.max(8, 65),
      description: t("pages.dashboard.analyticsdata.srednyaya_summa_odnogo_zakaza_za_vybrannyy_den"),
      details: [],
      table: {
        rows: realAverageRows(dash, avgCheck, placeSettings),
        labelColumn: "Канал",
        valueColumn: "Средний чек",
        shareColumn: "Индекс",
        formatValue: formatMoney,
        emptyText: t("pages.dashboard.analyticsdata.net_dannyh_po_srednemu_cheku"),
      },
      insight: "Средний чек по всем каналам продаж.",
    },
    {
      className: "premium-kpi--tables",
      icon: "bi-arrow-down-left-circle",
      badge: "Приход",
      label: t("pages.dashboard.analyticsdata.denezhnyy_prihod"),
      value: formatNumber(income),
      suffix: "UZS",
      note: "",
      noteClass: "kpi-note--neutral",
      progress: Math.max(8, Math.min(100, Math.round((income / Math.max(revenue, 1)) * 100))),
      description: t("pages.dashboard.analyticsdata.fakticheski_poluchennye_dengi_za_vybrannuyu_datu"),
      details: [
        [t("dashboard.cash_revenue"), cashTotal == null ? t("common.unavailable") : `${formatNumber(cashTotal)} UZS`],
        [t("common.noncash"), nonCashTotal == null ? t("common.unavailable") : `${formatNumber(nonCashTotal)} UZS`],
      ],
      table: {
        rows: realIncomeRows(dash, income, financeRows),
        labelColumn: "Источник",
        valueColumn: "Приход",
        shareColumn: "Доля",
        formatValue: formatMoney,
        emptyText: t("pages.dashboard.analyticsdata.net_prihodov_za_vybrannyy_den"),
      },
      insight: t("pages.dashboard.analyticsdata.denezhnyy_prihod_pokazyvaet_postupleniya_proshedshie_cherez_oplatu"),
    },
    {
      className: "premium-kpi--expense",
      icon: "bi-arrow-up-right-circle",
      badge: "Расход",
      label: t("pages.dashboard.analyticsdata.denezhnye_rashody"),
      value: t("common.soon"),
      suffix: "",
      comingSoon: true,
      hideDescription: true,
      note: "",
      noteClass: "kpi-note--neutral",
      progress: Math.max(8, Math.min(100, Math.round((expense / Math.max(revenue, 1)) * 100))),
      description: "",
      details: [],
      insight: "",
    },
  ];
  // Порядок карточек на дашборде (задан владельцем): денежный приход →
  // чистая прибыль → заказы → средний чек → денежные расходы.
  const kpis = [incomeKpi, revenueKpi, ordersKpi, avgKpi, expenseKpi];
  if (dash.metric_basis === "completed_income_minus_snapshot_cogs") {
    const unavailable = Boolean(dash.financial_unavailable);
    const unknownCost = dash.today_revenue == null;
    const moneyOrUnknown = (amount) => amount == null ? t("common.unknown") : formatMoney(amount);
    const reason = dash.profit_unavailable_reason || t("pages.dashboard.analyticsdata.denezhnyy_prihod_minus_istoricheskaya_sebestoimost_oplachennyh_pozitsiy");
    Object.assign(revenueKpi, {
      // Под этой базой расчёта today_revenue — это приход минус себестоимость,
      // то есть чистая прибыль, а не выручка. Ярлык обязан совпадать с числом.
      label: t("pages.dashboard.analyticsdata.chistaya_pribyl"),
      badge: dash.date_from && dash.date_to && dash.date_from !== dash.date_to
        ? `${formatDateLabel(dash.date_from)} – ${formatDateLabel(dash.date_to)}`
        : formatDateLabel(dash.date_to || selectedDate),
      value: unknownCost ? t("common.unavailable") : formatNumber(dash.today_revenue), suffix: unknownCost ? "" : "UZS",
      description: reason, note: "", insight: reason,
      productReport: Array.isArray(dash.product_rows) || unavailable ? {
        rows: dash.product_rows || [], income: dash.income_total, cogs: dash.cogs_total,
        revenue: dash.today_revenue, unavailable,
      } : null,
      table: { rows: [
        { name: t("pages.dashboard.dashboarddialogs.denezhnyy_prihod"), amount: dash.income_total },
        { name: t("pages.dashboard.analyticsdata.sebestoimost_oplachennyh_pozitsiy_rychitaetsya"), amount: dash.cogs_total },
        { name: t("pages.dashboard.analyticsdata.vyruchka_prihod_minus_sebestoimost"), amount: dash.today_revenue },
      ], labelColumn: t("common.calculation"), valueColumn: "Сумма", showShare: false, formatValue: moneyOrUnknown },
    });
    Object.assign(ordersKpi, { value: unavailable ? t("common.unavailable") : formatNumber(dash.today_orders),
      dialogSuffix: unavailable ? "" : "шт",
      orderReport: {
        rows: dash.order_rows || [], total: dash.orders_total ?? (Number(dash.today_orders) === 0 ? "0" : null),
        unavailable: unavailable || (!Array.isArray(dash.order_rows) && Number(dash.today_orders) > 0),
      },
      hideDescription: true,
      description: t("pages.dashboard.analyticsdata.polnostyu_oplachennye_zavershennye_zakazy_za"),
      details: [[t("pages.dashboard.analyticsdata.zavershennyh_i_oplachennyh"), unavailable ? t("common.unavailable") : String(dash.today_orders)]], note: "" });
    Object.assign(avgKpi, { value: unavailable ? t("common.unavailable") : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(dash.avg_check)),
      averageReport: {
        rows: dash.average_check_rows || [], count: dash.today_orders, income: dash.income_total, average: dash.avg_check,
        unavailable: unavailable || (!Array.isArray(dash.average_check_rows) && Number(dash.today_orders) > 0),
      },
      hideDescription: true,
      suffix: unavailable ? "" : "UZS", note: "", description: t("pages.dashboard.analyticsdata.denezhnyy_prihod_kolichestvo_oplachennyh") });
    Object.assign(incomeKpi, { value: unavailable ? t("common.unavailable") : formatNumber(dash.income_total),
      productReport: revenueKpi.productReport ? { ...revenueKpi.productReport, incomeLast: true } : null,
      suffix: unavailable ? "" : "UZS", description: t("pages.dashboard.analyticsdata.podtverzhdennye_oplaty_polnostyu_zavershennyh"),
      table: { ...incomeKpi.table, rows: unavailable ? [] : realPaymentRows(dash, dash.income_total),
        emptyText: unavailable ? "Не удалось загрузить подтверждённые оплаты" : "Нет оплат завершённых заказов за выбранный период" },
    });
  }
  return kpis;
}

export function buildWarehouseSummary(reports = EMPTY_WAREHOUSE_REPORTS, financeRows = [], selectedDate) {
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
    { label: t("pages.dashboard.analyticsdata.prihod_tovarov"), value: incomeTotal, icon: "bi-download", tone: "income", rows: incomeRows, to: "/stock-report/incoming" },
    { label: t("pages.dashboard.analyticsdata.rashod_tovarov"), value: expenseTotal, icon: "bi-upload", tone: "expense", rows: expenseRows, to: "/stock-report/outgoing" },
    { label: t("pages.dashboard.analyticsdata.ostatok_sklada"), value: stockBalance, icon: "bi-box", tone: "stock", rows: stockRows, to: "/stock-report/stock" },
    { label: t("pages.dashboard.analyticsdata.obschie_zatraty"), value: totalCosts, icon: "bi-wallet2", tone: "costs", rows: totalCostRows },
    { label: t("pages.dashboard.analyticsdata.kreditorka"), value: creditorTotal, icon: "bi-arrow-up-right-circle", tone: "creditor", rows: creditorRows },
    { label: t("pages.dashboard.analyticsdata.debitorka"), value: debtorTotal, icon: "bi-arrow-down-left-circle", tone: "debtor", rows: debtorRows },
  ];
}

export function buildUnavailableWarehouseSummary() {
  return [
    { label: t("pages.dashboard.analyticsdata.prihod_tovarov"), icon: "bi-download", tone: "income" },
    { label: t("pages.dashboard.analyticsdata.rashod_tovarov"), icon: "bi-upload", tone: "expense" },
    { label: t("pages.dashboard.analyticsdata.ostatok_sklada"), icon: "bi-box", tone: "stock" },
    { label: t("pages.dashboard.analyticsdata.obschie_zatraty"), icon: "bi-wallet2", tone: "costs" },
    { label: t("pages.dashboard.analyticsdata.kreditorka"), icon: "bi-arrow-up-right-circle", tone: "creditor" },
    { label: t("pages.dashboard.analyticsdata.debitorka"), icon: "bi-arrow-down-left-circle", tone: "debtor" },
  ].map((item) => ({ ...item, value: null, rows: [], unavailable: true }));
}





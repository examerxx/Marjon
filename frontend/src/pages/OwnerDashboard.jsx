import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatMoney } from "../api/client";
import { webFormat, webTime } from "../utils/webTime";
import { dashboardService } from "../api/dashboard";
import { warehouseService } from "../api/warehouse";
import { docDateToISO, registeredAtToISO } from "./WarehousePage";
import { readOutgoingReport } from "./warehouse/outgoingReport";
import { toDateInputValue } from "../utils/date";
import Icon from "../components/Icon";
import { PageLoader } from "../components/Loader";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { isAbortError, useLatestRequest } from "../hooks/useAsyncSafety";
import {
  todayReportRange,
  dashboardPeriodFromSearch,
  normalizeReportRange,
  reportRangeToApiParams,
  reportRangeDays,
  reportRangeLabel,
  formatDaysLabel,
} from "./dashboard/reportRange";
import {
  EMPTY_DASHBOARD,
  EMPTY_WAREHOUSE_REPORTS,
  apiList,
  toFiniteNumber,
  buildRealKpis,
  buildRevenueChartSales,
  bucketIncome,
  buildUnavailableWarehouseSummary,
  buildZeroRevenueBuckets,
} from "./dashboard/analyticsData";
import {
  buildSimulatedDashboard,
  buildSimulatedWarehouseReports,
  simulatedRevenueAmount,
  hasRows,
  hasPositiveAmount,
  hasBalanceRows,
} from "./dashboard/simulation";
import RevenueChart from "./dashboard/RevenueChart";
import "./dashboard/dashboardRefinements.css";
import { KpiInfoDialog, WarehouseReportDialog } from "./dashboard/DashboardDialogs";
import { EmptyState, TopSalesCard, RecentOrdersCard } from "./dashboard/DashboardCards";
import { prepareKpiDialogTrigger } from "./dashboard/kpiFocusOrigin";
import revenueArt from "../assets/dashboard-card-art/revenue.png";
import ordersArt from "../assets/dashboard-card-art/orders.png";
import averageCheckArt from "../assets/dashboard-card-art/average_check.png";
import incomeArt from "../assets/dashboard-card-art/income.png";
import expenseArt from "../assets/dashboard-card-art/expense.png";
import incomingGoodsArt from "../assets/dashboard-card-art/incoming_goods_clean.png";
import outgoingGoodsArt from "../assets/dashboard-card-art/outgoing_goods_clean.png";
import warehouseStockArt from "../assets/dashboard-card-art/warehouse_stock_clean.png";
import totalCostsArt from "../assets/dashboard-card-art/total_costs_clean.png";
import accountsPayableArt from "../assets/dashboard-card-art/accounts_payable_clean.png";
import accountsReceivableArt from "../assets/dashboard-card-art/accounts_receivable_clean.png";
import { t } from "../i18n/t";

// DASHBOARD MAXIMAL KPI CARDS V1 — decorative-only PNG mapping. Real KPI values
// stay as DOM text; PNGs are presentational (alt="" aria-hidden, no pointers).
const KPI_VISUALS = {
  "premium-kpi--revenue": { src: revenueArt, variant: "revenue" },
  "premium-kpi--orders": { src: ordersArt, variant: "orders" },
  "premium-kpi--avg": { src: averageCheckArt, variant: "average" },
  "premium-kpi--tables": { src: incomeArt, variant: "income" },
  "premium-kpi--expense": { src: expenseArt, variant: "expense" },
};

const WAREHOUSE_VISUALS = {
  income: { src: incomingGoodsArt, variant: "incoming" },
  expense: { src: outgoingGoodsArt, variant: "outgoing" },
  stock: { src: warehouseStockArt, variant: "stock" },
  costs: { src: totalCostsArt, variant: "costs" },
  creditor: { src: accountsPayableArt, variant: "payable" },
  debtor: { src: accountsReceivableArt, variant: "receivable" },
};

// Оркестратор OWNER-дашборда (FE-07B). Владеет верхнеуровневым состоянием
// (период выручки, выбранные KPI/склад-отчёт, данные запроса) и раздаёт его
// презентационным подкомпонентам. Аналитика/симуляция/секции вынесены в
// ./dashboard/*. FE-05 (сервисный слой) и FE-06 (безопасность запросов) сохранены.

// Слияние с симуляцией сохранено из исходника как невызываемый код
// (truth-гарды фиксируют единичное присутствие). В живом рендере не используется.
function mergeDashboardWithSimulation(dash, sales) {
  const source = dash || EMPTY_DASHBOARD;
  const demo = buildSimulatedDashboard(sales);
  const positive = (field) => toFiniteNumber(source[field]) > 0;
  const sourceRows = (...fields) => fields.map((field) => source[field]).find((rows) => Array.isArray(rows) && rows.length > 0);
  const paymentRows = sourceRows("payment_methods", "paymentMethods", "payment_breakdown", "paymentBreakdown");
  const orderRows = sourceRows("order_locations", "orderLocations", "place_orders", "placeOrders", "order_places", "orderPlaces");
  const avgRows = sourceRows("avg_check_segments", "avgCheckSegments", "average_check_segments", "averageCheckSegments");
  const incomeRows = sourceRows("income_breakdown", "incomeBreakdown", "income_sources", "incomeSources");
  const expenseRows = sourceRows("expense_breakdown", "expenseBreakdown", "expense_categories", "expenseCategories");

  return {
    ...source,
    today_revenue: positive("today_revenue") ? source.today_revenue : demo.today_revenue,
    today_orders: positive("today_orders") ? source.today_orders : demo.today_orders,
    avg_check: positive("avg_check") ? source.avg_check : demo.avg_check,
    active_orders: positive("active_orders") ? source.active_orders : demo.active_orders,
    cash_total: positive("cash_total") ? source.cash_total : demo.cash_total,
    non_cash_total: positive("non_cash_total") ? source.non_cash_total : demo.non_cash_total,
    income_total: positive("income_total") ? source.income_total : demo.income_total,
    expense_total: positive("expense_total") ? source.expense_total : demo.expense_total,
    payment_methods: paymentRows || demo.payment_methods,
    order_locations: orderRows || demo.order_locations,
    avg_check_segments: avgRows || demo.avg_check_segments,
    income_breakdown: incomeRows || demo.income_breakdown,
    expense_breakdown: expenseRows || demo.expense_breakdown,
  };
}

function mergeWarehouseReportsWithSimulation(reports = EMPTY_WAREHOUSE_REPORTS) {
  const demo = buildSimulatedWarehouseReports();
  const source = reports || EMPTY_WAREHOUSE_REPORTS;

  return {
    incomes: hasPositiveAmount(source.incomes, ["total", "amount", "value"]) ? source.incomes : demo.incomes,
    consumption: hasPositiveAmount(source.consumption, ["total", "amount", "value"]) ? source.consumption : demo.consumption,
    balances: hasRows(source.balances) ? source.balances : demo.balances,
    debtCredit: hasBalanceRows(source.debtCredit) ? source.debtCredit : demo.debtCredit,
    stock: hasPositiveAmount(source.stock, ["quantity", "total", "amount", "value"]) ? source.stock : demo.stock,
  };
}

function buildSimulatedRevenueSales(range) {
  const params = reportRangeToApiParams(range);
  const days = reportRangeDays(range);
  const start = new Date(`${params.date_from}T00:00:00`);

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const revenue = simulatedRevenueAmount(index, days);
    const orders = Math.max(1, Math.round(revenue / 115_000));

    return {
      date: toDateInputValue(date),
      revenue,
      orders_count: orders,
      avg_check: Math.round(revenue / orders),
      isSimulated: true,
    };
  });
}

export function isDashboardPreviewEnabled(search, isDev = import.meta.env.DEV) {
  return isDev === true && new URLSearchParams(search).get("previewData") === "1";
}

export function buildDashboardPeriodSearch(apiRange, currentSearch, isDev = import.meta.env.DEV) {
  const params = new URLSearchParams({
    date_from: apiRange.date_from,
    date_to: apiRange.date_to,
  });
  if (apiRange.time_from) params.set("time_from", apiRange.time_from);
  if (apiRange.time_to) params.set("time_to", apiRange.time_to);
  if (isDashboardPreviewEnabled(currentSearch, isDev)) params.set("previewData", "1");
  return params.toString();
}

export default function OwnerDashboard() {
  const navigate = useNavigate();
  const previewEnabled = isDashboardPreviewEnabled(window.location.search);
  const [previewKpis, setPreviewKpis] = useState(null);
  const [dashboardPeriod, setDashboardPeriod] = useState(() => (
    dashboardPeriodFromSearch(window.location.search) || todayReportRange()
  ));
  const [periodPanelState, setPeriodPanelState] = useState({ active: "", closing: "", pending: "" });
  const [selectedKpi, setSelectedKpi] = useState(null);
  const [selectedKpiSource, setSelectedKpiSource] = useState(null);
  const selectedKpiTriggerRef = useRef(null);
  const [selectedWarehouseReport, setSelectedWarehouseReport] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [sales, setSales] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [topProductsError, setTopProductsError] = useState("");
  const [products, setProducts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [placeSettings, setPlaceSettings] = useState([]);
  const [financeTransactions, setFinanceTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoadedDashboardRef = useRef(false);
  const beginRequest = useLatestRequest();
  // Отдельный трекер для складских итогов: общий beginRequest делить нельзя —
  // два эффекта на одном трекере гасили бы друг друга (isCurrent).
  const beginWarehouseRequest = useLatestRequest();
  const [warehouseTotals, setWarehouseTotals] = useState(null);
  const normalizedDashboardPeriod = useMemo(() => normalizeReportRange(dashboardPeriod), [dashboardPeriod]);
  const dashboardPeriodParams = useMemo(() => reportRangeToApiParams(normalizedDashboardPeriod), [normalizedDashboardPeriod]);
  const dashboardPeriodDays = useMemo(() => reportRangeDays(normalizedDashboardPeriod), [normalizedDashboardPeriod]);
  const dashboardPeriodLabel = reportRangeLabel(normalizedDashboardPeriod);
  const dashboardReferenceDate = dashboardPeriodParams.date_to;

  useEffect(() => {
    if (!import.meta.env.DEV || !previewEnabled) return undefined;
    let active = true;
    // DEV-only, URL-only and isolated from API/state used by every other widget.
    import("./dashboard/dashboardPreviewData").then(({ buildDashboardPreviewKpis }) => {
      if (active) setPreviewKpis(buildDashboardPreviewKpis());
    });
    return () => { active = false; };
  }, [previewEnabled]);

  function requestPeriodPanel(panelId) {
    setPeriodPanelState((current) => {
      if (current.closing) {
        const nextPending = current.pending === panelId ? "" : panelId;
        return { ...current, pending: nextPending };
      }
      if (!current.active) return panelId ? { active: panelId, closing: "", pending: "" } : current;
      return {
        active: "",
        closing: current.active,
        pending: current.active === panelId ? "" : panelId,
      };
    });
  }

  function completePeriodPanelExit(panelId) {
    setPeriodPanelState((current) => {
      if (current.closing !== panelId) return current;
      return { active: current.pending, closing: "", pending: "" };
    });
  }

  useEffect(() => {
    const request = beginRequest();
    if (!hasLoadedDashboardRef.current) setLoading(true);
    setError("");
    dashboardService.loadOwnerOverview({
      dateFrom: dashboardPeriodParams.date_from,
      dateTo: dashboardPeriodParams.date_to,
      ...(dashboardPeriodParams.time_from ? { timeFrom: dashboardPeriodParams.time_from, timeTo: dashboardPeriodParams.time_to } : {}),
      signal: request.signal,
    }).then(([
      dashboardRes,
      salesRes,
      topRes,
      productsRes,
      employeesRes,
      ordersRes,
      placesRes,
      financeRes,
    ]) => {
      if (!request.isCurrent()) return;
      setDashboard(dashboardRes.data);
      setSales(apiList(salesRes.data));
      setTopProducts(apiList(topRes.data));
      setTopProductsError(topRes.unavailable ? topRes.unavailableReason || "Не удалось загрузить подтверждённые продажи." : "");
      setProducts(apiList(productsRes.data));
      setEmployees(apiList(employeesRes.data));
      const orderList = apiList(ordersRes.data);
      setRecentOrders(orderList.slice(0, 5));
      const placeList = apiList(placesRes.data);
      setPlaceSettings(placeList);
      const financeList = apiList(financeRes.data);
      setFinanceTransactions(financeList);
    }).catch((err) => {
      if (request.isCurrent() && !isAbortError(err)) setError(err.response?.data?.detail || "Не удалось загрузить dashboard данные.");
    }).finally(() => {
      if (request.isCurrent()) {
        hasLoadedDashboardRef.current = true;
        setLoading(false);
      }
    });
  }, [beginRequest, dashboardPeriodParams]);

  // Живые итоги складских карточек за период дашборда (приход/расход — сумма
  // документов по дате регистрации; расход — исторический складской отчёт,
  // остаток — текущий срез qty×cost_price).
  // Любая ошибка API — null, карточки остаются в честном unavailable (0).
  useEffect(() => {
    const request = beginWarehouseRequest();
    const { date_from: fromISO, date_to: toISO } = dashboardPeriodParams;
    const safeList = (fn) => {
      try {
        const out = fn();
        return Promise.resolve(out)
          .catch(() => ({ data: [], __failed: true }));
      } catch {
        return Promise.resolve({ data: [], __failed: true });
      }
    };
    Promise.all([
      safeList(() => warehouseService.list("incoming", { signal: request.signal })),
      safeList(() => warehouseService.listOutgoingReport(fromISO, toISO, { signal: request.signal })
        .then((res) => ({ data: readOutgoingReport(res.data) }))),
      safeList(() => warehouseService.listStock({ signal: request.signal })),
    ]).then(([incomingRes, outgoingRes, stockRes]) => {
      if (!request.isCurrent()) return;
      if (incomingRes.__failed || stockRes.__failed) {
        setWarehouseTotals(null);
        return;
      }
      const asList = (res) => {
        const data = res?.data;
        return Array.isArray(data) ? data : data?.items || [];
      };
      const docDay = (doc) => registeredAtToISO(doc.registered_at) || docDateToISO(doc.date);
      const inPeriod = (doc) => {
        const iso = docDay(doc);
        if (!iso) return false;
        if (fromISO && iso < fromISO) return false;
        if (toISO && iso > toISO) return false;
        return true;
      };
      const sumDocs = (docs) => docs.filter(inPeriod)
        .reduce((sum, doc) => sum + (Number(doc.total_amount) || 0), 0);
      const stockTotal = asList(stockRes)
        .reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.cost_price) || 0), 0);
      setWarehouseTotals({
        incoming: sumDocs(asList(incomingRes)),
        outgoing: outgoingRes.__failed ? null : outgoingRes.data.total,
        stock: stockTotal,
      });
    }).catch(() => {
      if (request.isCurrent()) setWarehouseTotals(null);
    });
  }, [beginWarehouseRequest, dashboardPeriodParams]);

  function applyDashboardPeriod(nextRange) {
    const normalized = normalizeReportRange(nextRange);
    const apiRange = reportRangeToApiParams(normalized);
    const search = buildDashboardPeriodSearch(apiRange, window.location.search);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${search}${window.location.hash}`,
    );
    setDashboardPeriod(normalized);
  }

  const displaySales = useMemo(() => sales, [sales]);
  const revenueChartSales = useMemo(
    () => buildRevenueChartSales(displaySales),
    [displaySales]
  );
  // No-data state: same real chart shell with a flat display-only zero series
  // derived from the selected period (never stored/sent, values exactly 0).
  const revenueChartZeroBuckets = useMemo(
    () => buildZeroRevenueBuckets(dashboardPeriodParams.date_from, dashboardPeriodParams.date_to),
    [dashboardPeriodParams]
  );
  const revenueChartDisplaySales = revenueChartSales.length ? revenueChartSales : revenueChartZeroBuckets;
  const displayPlaceSettings = useMemo(() => placeSettings, [placeSettings]);
  const displayFinanceTransactions = useMemo(() => financeTransactions, [financeTransactions]);
  const displayDashboard = useMemo(() => dashboard || EMPTY_DASHBOARD, [dashboard]);
  // График показывает ДЕНЕЖНЫЙ ПРИХОД (gross, до вычитания себестоимости), как
  // и первая карточка. Он не зависит от исторической себестоимости, поэтому
  // недоступен только когда недоступен сам приход. «Чистая прибыль» на второй
  // карточке по-прежнему честно уходит в «Недоступно», если себестоимость
  // не сохранена — но это уже не повод скрывать график прихода.
  const chartUnavailable = !previewEnabled && dashboard?.metric_basis === "completed_income_minus_snapshot_cogs"
    && (dashboard.financial_unavailable || dashboard.income_total == null);
  const kpis = useMemo(() => {
    if (previewEnabled && previewKpis) return previewKpis;
    return buildRealKpis(displayDashboard, revenueChartSales, dashboardReferenceDate, displayPlaceSettings, displayFinanceTransactions);
  }, [previewEnabled, previewKpis, dashboardReferenceDate, displayDashboard, revenueChartSales, displayPlaceSettings, displayFinanceTransactions]);
  const displayTopProducts = useMemo(() => topProducts, [topProducts]);
  const displayTopDishes = useMemo(() => {
  if (displayTopProducts.length > 0) {
    const maxRevenue = Math.max(1, ...displayTopProducts.map((item) => Number(item.revenue || 0)));
    return displayTopProducts.map((item, index) => ({
      product_id: item.product_id || `p-${index}`,
      name: item.name,
      photo: item.image_url || products.find((product) => String(product.id) === String(item.product_id))?.image_url || "",
      quantity: Number(item.quantity_sold ?? item.quantity ?? item.count ?? 0),
      revenue: Number(item.revenue || 0),
      change: "",
      positive: true,
      progress: Math.max(22, Math.round((Number(item.revenue || 0) / maxRevenue) * 100)),
    }));
  }
  return [];
}, [displayTopProducts, products]);
  // Складские карточки: при живых итогах — реальные суммы + навигация
  // в подкатегории; без итогов — честное unavailable (0, без перехода).
  const warehouseSummary = useMemo(() => {
    if (!warehouseTotals) return buildUnavailableWarehouseSummary();
    const live = {
      "Приход товаров": { value: warehouseTotals.incoming, to: "/stock-report/incoming" },
      "Расход товаров": { value: warehouseTotals.outgoing, to: "/stock-report/outgoing" },
      "Остаток склада": { value: warehouseTotals.stock, to: "/stock-report/stock" },
    };
    return buildUnavailableWarehouseSummary().map((item) => (
      live[item.label] && live[item.label].value !== null
        ? { ...item, value: live[item.label].value, to: live[item.label].to, unavailable: false, rows: [] }
        : item
    ));
  }, [warehouseTotals]);
  const displayRecentOrders = useMemo(() => recentOrders, [recentOrders]);
  const recentOrdersList = useMemo(() => {
    if (displayRecentOrders.length > 0) {
      return displayRecentOrders.map((order) => {
        const created = order.created_at ? new Date(order.created_at) : new Date();
        const time = webTime(order.created_at || created);
        const dateLabel = webFormat(order.created_at || created, { day: "2-digit", month: "2-digit" });
        const ready = order.status === "completed" || order.status === "ready";
        return {
          id: `#${order.order_number || order.id?.slice(0, 6)}`,
          date: `${dateLabel} ${time}`,
          place: order.table_number ? `Стол ${order.table_number}` : ({
            delivery: "Доставка", delivery_app: "Доставка", takeaway: "С собой", pickup: "С собой", dine_in: "На стол",
          }[order.order_type] || "—"),
          amount: formatMoney(order.total_amount || 0),
          status: ready ? "Готов" : order.status === "cancelled" ? "Отменён" : "В работе",
          // Канонический код статуса: карточка рисует его общим OrderStatus
          // (как в «Отчёте по заказам»), а не собственной плашкой.
          statusCode: order.status || null,
          ready,
        };
      });
    }
    return [];
  }, [displayRecentOrders]);
  const revenueStats = useMemo(() => {
    // Статистика считается по той же серии, что нарисована на графике.
    const revenues = revenueChartSales.map(bucketIncome);
    const total = revenues.reduce((acc, value) => acc + value, 0);
    return {
      max: revenues.length ? Math.max(...revenues) : 0,
      min: revenues.length ? Math.min(...revenues) : 0,
      avg: revenues.length ? Math.round(total / revenues.length) : 0,
    };
  }, [revenueChartSales]);
  const handleWarehouseSummaryClick = (item) => {
    if (item.unavailable) return;
    if (item.to) {
      navigate(item.label === "Расход товаров"
        ? `${item.to}?${new URLSearchParams(dashboardPeriodParams).toString()}`
        : item.to);
      return;
    }

    setSelectedWarehouseReport(item);
  };

  if (previewEnabled ? !previewKpis : loading) return <PageLoader />;
  if (error && !previewEnabled) return <EmptyState title={t("pages.ownerdashboard.dashboard_nedostupen")} text={error} />;

  return (
    <>
      <div className="owner-kpi-band">
        <section className="kpi-grid kpi-grid--premium">
          {kpis.map((kpi) => {
            const visual = KPI_VISUALS[kpi.className];
            return (
            <button
              className={`kpi-card premium-kpi ${kpi.className}${visual ? ` dashboard-kpi-card--visual dashboard-kpi-card--${visual.variant}` : ""}`}
              key={kpi.label}
              type="button"
              onClick={(event) => {
                setSelectedKpiSource(prepareKpiDialogTrigger(event, selectedKpiTriggerRef));
                setSelectedKpi(kpi);
              }}
              aria-haspopup="dialog"
            >
              <div className="premium-kpi__top">
                <div className="premium-kpi__icon"><Icon name={kpi.icon} size={20} /></div>
              </div>
              <div className="kpi-label">{kpi.label}</div>
              <div className="kpi-value">{kpi.value} {kpi.suffix ? <small>{kpi.suffix}</small> : null}</div>
              <div className="premium-kpi__progress"><i style={{ width: `${kpi.progress}%` }} /></div>
              {visual ? (
                <img
                  className="dashboard-kpi-card__art"
                  src={visual.src}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
              ) : null}
            </button>
            );
          })}
        </section>
        <div className="owner-kpi-band__side" aria-hidden="true" />
      </div>
      <KpiInfoDialog
        kpi={selectedKpi}
        sourceRect={selectedKpiSource}
        returnFocusRef={selectedKpiTriggerRef}
        onClose={() => setSelectedKpi(null)}
      />
      <WarehouseReportDialog report={selectedWarehouseReport} selectedDate={dashboardReferenceDate} onClose={() => setSelectedWarehouseReport(null)} />

      <section className="owner-main-grid">
        <div className="card card-pad chart-card premium-chart">
          <div className="section-header section-header--stack">
            <div><span className="eyebrow">{t("eyebrow.money_income")}</span><h2>{t("pages.ownerdashboard.denezhnyy_prihod_za")} {formatDaysLabel(dashboardPeriodDays)}</h2></div>
            <div className="owner-revenue-switcher" aria-label={t("pages.ownerdashboard.period_denezhnogo_prihoda")}>
              <ReportDateRangePicker
                variant="canonical"
                animateExit
                value={normalizedDashboardPeriod}
                onChange={applyDashboardPeriod}
                open={periodPanelState.active === "period"}
                onOpenChange={(nextOpen) => requestPeriodPanel(nextOpen ? "period" : "")}
                onExitComplete={() => completePeriodPanelExit("period")}
                buttonAriaLabel={t("pages.ownerdashboard.period_denezhnogo_prihoda")}
                buttonClassName="owner-dashboard-period__trigger"
              />
            </div>
          </div>
          <div className="revenue-stat-grid">
            <div><span>{t("pages.ownerdashboard.maksimum")}</span><strong>{chartUnavailable ? t("common.unavailable") : formatMoney(revenueStats.max)}</strong></div>
            <div><span>{t("pages.ownerdashboard.srednee")}</span><strong>{chartUnavailable ? t("common.unavailable") : formatMoney(revenueStats.avg)}</strong></div>
            <div><span>{t("pages.ownerdashboard.obsluzhivanie")}</span><strong>{chartUnavailable || displayDashboard.service_fee_total == null ? t("common.unavailable") : formatMoney(displayDashboard.service_fee_total)}</strong></div>
          </div>
          <div className="chart-wrap">
            {chartUnavailable
              ? <div role="status">{dashboard.profit_unavailable_reason || "Не удалось загрузить денежный приход."}</div>
              : <RevenueChart sales={revenueChartDisplaySales} valueKey="income" />}
          </div>
        </div>

        <aside className="warehouse-summary-card">
          <div className="warehouse-summary-list">
            {warehouseSummary.filter(item => item.tone !== "costs").map((item) => {
              const visual = WAREHOUSE_VISUALS[item.tone];
              return (
              <button
                className={`warehouse-summary-item warehouse-summary-item--${item.tone}${visual ? ` dashboard-side-metric--visual dashboard-side-metric--${visual.variant}` : ""}`}
                key={item.label}
                type="button"
                onClick={() => handleWarehouseSummaryClick(item)}
                aria-haspopup={item.to ? undefined : "dialog"}
              >
                <span className="warehouse-summary-item__icon"><Icon name={item.icon} size={18} /></span>
                <div className="warehouse-summary-item__text">
                  <strong>{item.label}</strong>
                  <span>{item.unavailable && item.tone === "expense" ? t("common.unavailable") : item.unavailable && (item.tone === "creditor" || item.tone === "debtor") ? t("common.soon") : formatMoney(item.unavailable ? 0 : item.value)}</span>
                </div>
                {visual ? (
                  <img
                    className="dashboard-side-metric__art"
                    src={visual.src}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                ) : null}
              </button>
              );
            })}
          </div>
        </aside>

      </section>

      <section className="owner-widgets">
        <TopSalesCard dishes={displayTopDishes} error={topProductsError} />
        <RecentOrdersCard orders={recentOrdersList} />
      </section>
    </>
  );
}





import { useEffect, useMemo, useState } from "react";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import ReportEmptyState from "../components/ReportEmptyState";
import ReportMultiSelect from "../components/ReportMultiSelect";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { formatDateLabel, todayInputValue } from "../utils/date";
import { toApiDate } from "./reports/reportPeriod";

const initialFilters = {
  query: "",
  authorId: [],
  productId: [],
  orderType: [],
  orderStatus: [],
  categoryId: [],
  paymentMethod: [],
};

const filterNames = {
  query: "Поиск",
  authorId: "Автор",
  productId: "Продукт",
  orderType: "Тип заказа",
  orderStatus: "Статус заказа",
  categoryId: "Категория",
  paymentMethod: "Тип оплаты",
};

const emptyFilterOptions = {
  authors: [],
  cooks: [],
  products: [],
  categories: [],
  order_types: [],
  order_statuses: [],
  payment_methods: [],
  cook_filter_supported: false,
};

const filterOptionGroups = {
  authorId: "authors",
  productId: "products",
  orderType: "order_types",
  orderStatus: "order_statuses",
  categoryId: "categories",
  paymentMethod: "payment_methods",
};

function optionLabel(key, value, options) {
  if (key === "query") return value;
  const group = options[filterOptionGroups[key]] || [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((single) => group.find((option) => option.value === single)?.label || single).join(", ");
}

function isFilterActive(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(String(value ?? "").trim());
}

// DISHES-01: the Dishes UI exposes only the user-requested subsets below.
// Values stay canonical (backend enum untouched); labels are the requested
// user wording. Subsets are intersected with backend-provided options so the
// UI can never offer a value the server would reject.
const DISHES_ORDER_TYPE_OPTIONS = [
  { value: "dine_in", label: "На стол" },
  { value: "delivery", label: "Доставка" },
  { value: "takeaway", label: "С собой" },
];

const DISHES_ORDER_STATUS_OPTIONS = [
  { value: "new", label: "Новый" },
  { value: "completed", label: "Завершенный" },
];

function intersectOptions(allowed, provided) {
  const available = new Set((provided || []).map((option) => option.value));
  return allowed.filter((row) => available.has(row.value));
}

function formatReportMoney(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} UZS`;
}

function toDishesDisplayRow(item, index) {
  const quantityValue = Number(item.quantity || 0);
  const priceValue = Number(item.price || 0);
  const amountValue = Number(item.amount || 0);

  return {
    // product_id is canonical; item.id covers the pre-Phase-1 frontend
    // fallback (old backend always sent product_id).
    id: String(item.product_id || item.id || item.name || index),
    name: `${index + 1}. ${item.name || ""}`,
    // Real master unit only — never a hardcoded fallback. Cost/profit/status
    // are intentionally absent (no truthful source) and ignored when present.
    unit: item.unit || "",
    quantity: String(quantityValue),
    price: formatReportMoney(priceValue),
    amount: formatReportMoney(amountValue),
  };
}

function normalizeDishesReportResponse(data) {
  // ZERO-DOWNTIME BRIDGE (temporary, removable after the old contract retires):
  // NEW canonical { rows, totals } => backend totals authoritative, never recomputed.
  // OLD legacy [...] => transitional client totals from the returned rows only.
  // Anything else => throw contract error (never fake zero-data).
  if (Array.isArray(data)) {
    let quantity = 0;
    let amount = 0;
    for (const item of data) {
      const quantityValue = Number(item?.quantity || 0);
      const amountValue = Number(item?.amount || 0);
      if (Number.isFinite(quantityValue)) quantity += quantityValue;
      if (Number.isFinite(amountValue)) amount += amountValue;
    }
    return { rows: data.map(toDishesDisplayRow), totals: { quantity, amount } };
  }
  if (
    data &&
    typeof data === "object" &&
    Array.isArray(data.rows) &&
    data.totals &&
    typeof data.totals === "object" &&
    data.totals.quantity != null &&
    data.totals.amount != null
  ) {
    const quantity = Number(data.totals.quantity);
    const amount = Number(data.totals.amount);
    if (!Number.isFinite(quantity) || !Number.isFinite(amount)) {
      throw new Error("Invalid dishes report response");
    }
    return { rows: data.rows.map(toDishesDisplayRow), totals: { quantity, amount } };
  }
  throw new Error("Invalid dishes report response");
}

export default function DishesReportPage() {
  // DISHES-01: Dishes opens on today only, same semantics as Orders
  // (local calendar day, single-date label, preset "Сегодня").
  const [dateRange, setDateRange] = useState(() => {
    const today = formatDateLabel(todayInputValue());
    return { preset: "Сегодня", start: today, end: today };
  });
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [filterOptions, setFilterOptions] = useState(emptyFilterOptions);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Shared open-panel orchestration (Orders parity): at most one floating
  // panel (period popover or filter dropdown) is open at a time; `pending`
  // hands off when another panel is requested mid-exit, and an outside click
  // during exit cancels the handoff so no invisible overlay can stick around.
  const [panelState, setPanelState] = useState({ active: "", closing: "", pending: "" });
  const [rows, setRows] = useState([]);
  // Canonical totals are backend-authoritative. The legacy bare-array branch
  // below uses a transitional local sum ONLY for rollout compatibility.
  const [totals, setTotals] = useState({ quantity: 0, amount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beginRequest = useLatestRequest();
  const beginOptionsRequest = useLatestRequest();

  useEffect(() => {
    if (!panelState.closing) return undefined;
    function cancelPendingOnOutsideClick(event) {
      if (!event.target.closest?.(".orders-filter-select, .report-period-picker")) {
        setPanelState((current) => ({ ...current, pending: "" }));
      }
    }
    document.addEventListener("mousedown", cancelPendingOnOutsideClick);
    return () => document.removeEventListener("mousedown", cancelPendingOnOutsideClick);
  }, [panelState.closing]);

  useEffect(() => {
    const request = beginOptionsRequest();
    setFilterOptionsLoading(true);
    reportsService.getDishesFilters({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        // DISHES-01: order type/status expose only the requested user subsets
        // (intersected with backend options so no unserviceable value appears).
        setFilterOptions({
          ...emptyFilterOptions,
          ...(data || {}),
          order_types: intersectOptions(DISHES_ORDER_TYPE_OPTIONS, data?.order_types),
          order_statuses: intersectOptions(DISHES_ORDER_STATUS_OPTIONS, data?.order_statuses),
        });
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setFilterOptions(emptyFilterOptions);
      })
      .finally(() => { if (request.isCurrent()) setFilterOptionsLoading(false); });
  }, [beginOptionsRequest]);

  useEffect(() => {
    const request = beginRequest();
    const dateFrom = toApiDate(dateRange.start);
    const dateTo = toApiDate(dateRange.end);
    setLoading(true);
    setError("");
    if (!isOrderedDateRange(dateFrom, dateTo)) {
      setRows([]);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false);
      return;
    }
    reportsService.listDishes(dateFrom, dateTo, { filters: appliedFilters, signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        // Phase 1 truth: cost/profit/status intentionally absent.
        // Dual-shape bridge: canonical object keeps backend totals verbatim;
        // legacy array falls back to transitional client totals.
        const normalized = normalizeDishesReportResponse(data);
        setRows(normalized.rows);
        setTotals(normalized.totals);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить отчёт по блюдам.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [
    beginRequest,
    dateRange.start,
    dateRange.end,
    appliedFilters.query,
    appliedFilters.authorId,
    appliedFilters.productId,
    appliedFilters.orderType,
    appliedFilters.orderStatus,
    appliedFilters.categoryId,
    appliedFilters.paymentMethod,
  ]);

  const filteredRows = rows;
  // The "Итого" row renders totals verbatim from normalization:
  // backend-authoritative for canonical, transitional client sum for legacy.
  const totalRow = useMemo(() => ({
    name: "Итого",
    unit: "",
    quantity: String(Number(totals.quantity || 0).toLocaleString("ru-RU")),
    price: "",
    amount: formatReportMoney(totals.amount),
  }), [totals]);
  const activeFilterEntries = Object.entries(appliedFilters).filter(([, value]) => isFilterActive(value));

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  // Multi-select toggle: checking adds, unchecking removes; the panel stays
  // open and the draft commits only through page-level «Фильтровать».
  function toggleFilterValue(key, value) {
    setFilters((current) => {
      const list = Array.isArray(current[key]) ? current[key] : [];
      const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
      return { ...current, [key]: next };
    });
  }

  function requestPanel(panelId) {
    setPanelState((current) => {
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

  function completePanelExit(panelId) {
    setPanelState((current) => {
      if (current.closing !== panelId) return current;
      return { active: current.pending, closing: "", pending: "" };
    });
  }

  function closeFilterPanel() {
    requestPanel("");
  }

  function dishFilterPanelProps(key) {
    return {
      open: panelState.active === key,
      closing: panelState.closing === key,
      onOpen: () => requestPanel(key),
      onClose: closeFilterPanel,
      onExitComplete: () => completePanelExit(key),
    };
  }

  function applyFilters() {
    setAppliedFilters(filters);
    requestPanel("");
  }

  function clearFilters() {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
    requestPanel("");
  }

  function downloadExcel() {
    const cols = [
      { key: "name", label: "Название" },
      { key: "unit", label: "Ед изм" },
      { key: "quantity", label: "Кол-во" },
      { key: "price", label: "Цена" },
      { key: "amount", label: "Сумма" },
    ];
    const totalExcelRow = {
      name: "Итого",
      unit: "",
      quantity: String(Number(totals.quantity || 0)),
      price: "",
      amount: formatReportMoney(totals.amount),
    };
    exportToExcel([...filteredRows, totalExcelRow], cols, "dishes-report", {
      metadata: [
        {
          label: "Период",
          value: dateRange.start === dateRange.end ? dateRange.start : `${dateRange.start} – ${dateRange.end}`,
        },
        ...activeFilterEntries.map(([key, value]) => ({
          label: filterNames[key],
          value: optionLabel(key, value, filterOptions),
        })),
      ],
    });
  }

  // No full-page loader: the shell (title/controls/table header)
  // renders immediately, even while the first request pends (see tbody).
  if (error) return <section className="dishes-report-page"><div className="login-error" role="alert">{error}</div></section>;

  return (
    <section className="dishes-report-page owner-report-view">
      <article className="report-page-card owner-report-surface">
        <div className="report-page-header owner-report-header">
          <div className="report-title-group owner-report-heading">
            <span className="report-accent-bar" aria-hidden="true" />
            <div>
              <span className="report-eyebrow owner-report-kicker">Отчёты</span>
              <h1>Отчёт по блюдам</h1>
            </div>
          </div>
          <div className="report-actions owner-report-actions">
            <ReportDateRangePicker variant="canonical" animateExit value={dateRange} onChange={setDateRange} open={panelState.active === "period"} onOpenChange={(nextOpen) => requestPanel(nextOpen ? "period" : "")} onExitComplete={() => completePanelExit("period")} buttonAriaLabel="Период отчёта по блюдам" />
            <button
              className="dishes-filter-toggle"
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="dishes-report-filters"
              onClick={() => {
                if (filtersOpen) requestPanel("");
                setFiltersOpen((current) => !current);
              }}
            >
              <Icon name="bi-sliders" size={17} />
              Фильтровать
            </button>
            <button className="report-excel-button owner-report-excel" type="button" onClick={downloadExcel}>
              <Icon name="bi-filetype-xlsx" size={19} strokeWidth={1.9} className="owner-report-xlsx-icon" />
              Скачать Excel
            </button>
          </div>
        </div>

        <div className={`orders-filter-collapse${filtersOpen ? " is-open" : ""}`}>
          <div className="orders-filter-collapse__inner" inert={!filtersOpen ? true : undefined}>
        <div
          className="report-filters-grid dishes-filter-panel"
          id="dishes-report-filters"
          aria-label="Фильтры отчёта по блюдам"
        >
          <label className="report-filter-input">
            <Icon name="bi-search" size={17} />
            <input aria-label="Поиск по названию блюда" value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="Поиск" />
          </label>
          <ReportMultiSelect filterKey="authorId" label="Автор" placeholder="Выберите автора" options={filterOptions.authors} selected={filters.authorId} onToggle={(value) => toggleFilterValue("authorId", value)} disabled={filterOptionsLoading || !filterOptions.authors.length} {...dishFilterPanelProps("authorId")} />
          <ReportMultiSelect filterKey="categoryId" label="Категория" placeholder="Выберите категорию" options={filterOptions.categories} selected={filters.categoryId} onToggle={(value) => toggleFilterValue("categoryId", value)} disabled={filterOptionsLoading || !filterOptions.categories.length} {...dishFilterPanelProps("categoryId")} />
          <ReportMultiSelect filterKey="productId" label="Продукт" placeholder="Выберите продукт" options={filterOptions.products} selected={filters.productId} onToggle={(value) => toggleFilterValue("productId", value)} disabled={filterOptionsLoading || !filterOptions.products.length} {...dishFilterPanelProps("productId")} />
          <ReportMultiSelect filterKey="orderType" label="Тип заказа" placeholder="Выберите тип заказа" options={filterOptions.order_types} selected={filters.orderType} onToggle={(value) => toggleFilterValue("orderType", value)} disabled={filterOptionsLoading || !filterOptions.order_types.length} {...dishFilterPanelProps("orderType")} />
          <ReportMultiSelect filterKey="orderStatus" label="Статус заказа" placeholder="Выберите статус заказа" options={filterOptions.order_statuses} selected={filters.orderStatus} onToggle={(value) => toggleFilterValue("orderStatus", value)} disabled={filterOptionsLoading || !filterOptions.order_statuses.length} {...dishFilterPanelProps("orderStatus")} />
          <ReportMultiSelect filterKey="paymentMethod" label="Тип оплаты" placeholder="Выберите тип оплаты" options={filterOptions.payment_methods} selected={filters.paymentMethod} onToggle={(value) => toggleFilterValue("paymentMethod", value)} disabled={filterOptionsLoading || !filterOptions.payment_methods.length} {...dishFilterPanelProps("paymentMethod")} />
          <div className="report-filter-buttons">
            <button type="button" className="report-filter-apply" onClick={applyFilters}>
              <Icon name="bi-sliders" size={17} />
              Фильтровать
            </button>
            <button type="button" className="report-filter-clear" onClick={clearFilters}>
              <Icon name="bi-x-circle" size={17} />
              Очистить
            </button>
          </div>
        </div>
          </div>
        </div>

        {activeFilterEntries.length ? (
          <div className="report-active-filters" aria-label="Активные фильтры">
            {activeFilterEntries.map(([key, value]) => (
              <span key={key}>{filterNames[key]}: {optionLabel(key, value, filterOptions)}</span>
            ))}
          </div>
        ) : null}

        <div className="report-table-wrapper owner-report-table-scroll" aria-busy={loading ? "true" : "false"}>
          <table className="report-table owner-report-table" aria-label="Отчёт по блюдам">
            <thead>
              <tr>
                <th>Название</th>
                <th>Ед изм</th>
                <th>Кол-во</th>
                <th>Цена</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {/* DISHES-01: the visible totals row exists only when the report
                  has rows. Successful zero-data shows the truthful empty state
                  without a totals row; rows state persists during refetch so
                  stale-while-refresh never flashes. Backend-authoritative
                  totals are preserved whenever rows exist. */}
              {filteredRows.length ? (
                <tr className="report-total-row">
                  <td>{totalRow.name}</td>
                  <td>{totalRow.unit}</td>
                  <td>{totalRow.quantity}</td>
                  <td>{totalRow.price}</td>
                  <td>{totalRow.amount}</td>
                </tr>
              ) : null}
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="report-dish-name">
                      <span className="report-dish-name__spacer" />
                      <a href="#dish" onClick={(event) => event.preventDefault()}>{row.name}</a>
                    </div>
                  </td>
                  <td>{row.unit}</td>
                  <td>{row.quantity}</td>
                  <td>{row.price}</td>
                  <td>{row.amount}</td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr className="report-empty-row" aria-hidden={loading || undefined}>
                  <td colSpan="5"><ReportEmptyState title="Блюд не найдено" hidden={loading} /></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import ReportEmptyState from "../components/ReportEmptyState";
import { reportCacheKey, readReportCache, writeReportCache } from "./reports/reportResultCache";
import { exportToExcel } from "../utils/excel";
import { formatSelectedLabels } from "../components/ReportMultiSelect";
import { formatDateLabel, todayInputValue } from "../utils/date";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { toApiDate } from "./reports/reportPeriod";
import { formatMoney } from "./reports/reportMoney";
import { paymentMethodLabel } from "./dashboard/analyticsData";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ru-RU");
}

const initialFilters = {
  orderNumber: "",
  waiterId: [],
  cashierId: [],
  productId: [],
  orderType: [],
  orderStatus: [],
  paymentMethod: [],
};

const emptyFilterOptions = {
  waiters: [],
  cashiers: [],
  products: [],
  order_types: [],
  order_statuses: [],
  payment_methods: [],
};

// Orders opens on the restaurant's local calendar day. todayInputValue uses
// local Date fields (rather than an ISO/UTC slice), while the picker keeps its
// approved DD.MM.YYYY display contract.
export function currentOrdersDateRange() {
  const today = formatDateLabel(todayInputValue());
  return { preset: "Сегодня", start: today, end: today };
}

const filterNames = {
  orderNumber: "Номер заказа",
  waiterId: "Официант",
  cashierId: "Кассир",
  productId: "Блюда",
  orderType: "Тип заказа",
  orderStatus: "Статус заказа",
  paymentMethod: "Тип оплаты",
};

const filterOptionGroups = {
  waiterId: "waiters",
  cashierId: "cashiers",
  productId: "products",
  orderType: "order_types",
  orderStatus: "order_statuses",
  paymentMethod: "payment_methods",
};

// REPORT-03: the Orders report offers only the three service modes the floor
// actually books against, in this order and with the floor's own wording. The
// VALUES stay canonical (`dine_in` / `takeaway` / `delivery`) — nothing is
// renamed for the backend, only relabelled for this dropdown — and any type the
// backend does not return is dropped, so the picker can never offer a value the
// server would reject. `qr` is deliberately not offered here.
const ORDER_TYPE_ROWS = [
  { value: "dine_in", label: "На стол" },
  { value: "takeaway", label: "На вынос" },
  { value: "delivery", label: "Доставка" },
];

function curateOrderTypes() {
  return ORDER_TYPE_ROWS;
}

// REPORTS-EXCEL-02 display resolvers. order_type reuses this page's canonical
// ORDER_TYPE_ROWS map; unknown future raw values fall back to the raw value
// (never hidden, never blank). Status reuses the OWNER oracle wording shared
// with Tables/Cancelled; payment methods reuse the dashboard PaymentType
// resolver (paymentMethodLabel) with raw-value fallback — never lost.
function orderTypeLabel(value) {
  if (value === null || value === undefined || value === "") return "—";
  return ORDER_TYPE_ROWS.find((row) => row.value === value)?.label || String(value);
}

const ORDER_STATUS_LABELS = {
  new: "Новый",
  accepted: "Принят",
  cooking: "Готовится",
  ready: "Готов",
  completed: "Завершён",
  cancelled: "Отменён",
};

function orderStatusLabel(value) {
  if (value === null || value === undefined || value === "") return "—";
  return ORDER_STATUS_LABELS[value] || String(value);
}

function formatCashierNames(names) {
  const list = (names || []).map((name) => String(name ?? "").trim()).filter(Boolean);
  return list.length ? list.join(", ") : "—";
}

function joinPaymentMethods(methods) {
  const list = (methods || []).map((method) => String(method ?? "").trim()).filter(Boolean);
  return list.map((method) => paymentMethodLabel(method)).join(", ");
}

// ORDERS-FRONTEND-TRUTH-01 canonical "Место" formatter — the SINGLE mapping
// shared by the on-page table cell and the Excel export so UI and workbook
// cannot drift. Composes ONLY canonical backend values: the historical
// hall_name snapshot + table_number. Graceful partial states:
//   both      -> "Основной зал, стол 12"
//   hall only -> "Основной зал"
//   table only-> "стол 12"
//   neither   -> "" (callers apply the report's own empty convention, e.g. "—")
// Never reconstructs place from live Hall/Table frontend data.
export function formatPlace(hallName, tableNumber) {
  const hall = String(hallName ?? "").trim();
  const table = String(tableNumber ?? "").trim();
  if (hall && table) return `${hall}, стол ${table}`;
  if (hall) return hall;
  if (table) return `стол ${table}`;
  return "";
}

function optionLabel(key, value, options) {
  if (key === "orderNumber") return value;
  const group = options[filterOptionGroups[key]] || [];
  const label = (v) => group.find((option) => option.value === v)?.label || v;
  return Array.isArray(value) ? value.map(label).join(", ") : label(value);
}

// REPORT-04: every select filter is MULTI-value. The canonical Orders report takes
// repeated query params per dimension (`waiter_id=<a>&waiter_id=<b>`), so several
// values inside one dimension are OR'd by the backend and different dimensions are
// AND'd there — nothing is post-filtered in the browser.
function isFilterActive(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? "").trim());
}

// Closed-trigger summary. Every selected label is shown, joined with ", "
// in dropdown option order (shared formatSelectedLabels) — never a count.
function summariseSelection(selected, options) {
  return formatSelectedLabels(selected, options);
}

// Orders-local multi-select filter primitive — one component, used by all six
// select filters. Visual language is the Z-report dropdown (`owner-msel__*`
// checkbox rows reused verbatim); layout/typography stay the Orders field styles.
//
// IMMEDIATE (Z-report parity): checking a row toggles the page's filter draft at
// once and the trigger re-renders with the new summary. There is NO draft copy
// and NO dropdown footer — no «Выбрать»/«Отменить» inside the panel. Toggling
// never issues an analytics request: the click only mutates the page draft, and
// the page-level «Фильтровать» is still what commits the draft into
// appliedFilters — the state the request effect actually reads. Outside click,
// Escape and Tab simply close the panel; toggled rows stay toggled. The parent
// owns which panel is open, so at most one floating panel exists at a time.
//
// The placeholder is trigger-only: there is deliberately no reset row inside the
// panel — unchecking is the per-filter reset, and page-level «Очистить» resets all.
function FilterMultiSelect({
  label, placeholder, options, selected, onToggle, disabled = false,
  open, closing = false, onOpen, onClose, onExitComplete,
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listId = `orders-filter-${label}-listbox`;
  const summary = summariseSelection(selected, options);

  // Every open starts keyboard navigation from the top.
  useEffect(() => {
    if (open) setActiveIndex(-1);
  }, [open]);

  // Outside click just closes; the selection is already the page's draft state.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (!rootRef.current?.contains(event.target)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  function toggle(value) {
    onToggle(value);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      if (open) { event.preventDefault(); event.stopPropagation(); onClose(); triggerRef.current?.focus(); }
      return;
    }
    if (event.key === "Tab") { if (open) onClose(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { onOpen(); return; }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => {
        const next = i + step;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) { onOpen(); return; }
      if (activeIndex >= 0 && options[activeIndex]) toggle(options[activeIndex].value);
    }
  }

  function handlePanelAnimationEnd(event) {
    if (closing && event.target === event.currentTarget) onExitComplete();
  }

  return (
    <div className={`orders-filter-select${open ? " is-open" : ""}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        className={`orders-filter-select__trigger${summary ? "" : " is-placeholder"}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        aria-label={label}
        title={summary || undefined}
        disabled={disabled}
        onClick={() => (open ? onClose() : onOpen())}
      >
        <span className="orders-filter-select__value">{summary || placeholder}</span>
        <span className="orders-filter-select__chevron" aria-hidden="true"><Icon name="bi-chevron-down" size={16} /></span>
      </button>
      {open || closing ? (
        <div
          className={`orders-filter-select__panel${closing ? " is-closing" : ""}`}
          aria-hidden={closing ? true : undefined}
          {...(closing ? { inert: true } : {})}
          onAnimationEnd={closing ? handlePanelAnimationEnd : undefined}
        >
          <ul className="orders-filter-select__menu" id={listId} role="listbox" aria-multiselectable="true" aria-label={label}>
            {options.map((option, index) => {
              const checked = selected.includes(option.value);
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={checked}
                    className={`orders-filter-select__option owner-msel__option${checked ? " is-checked" : ""}${index === activeIndex ? " is-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => toggle(option.value)}
                  >
                    <span className="owner-msel__check" aria-hidden="true">
                      {checked ? (
                        <svg className="owner-msel__tick" viewBox="0 0 16 16" width="12" height="12">
                          <path d="M13 4.5 6.5 11 3 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="owner-msel__option-label">{option.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function OrdersReportPage() {
  const [dateRange, setDateRange] = useState(currentOrdersDateRange);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [panelState, setPanelState] = useState({ active: "", closing: "", pending: "" });
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [filterOptions, setFilterOptions] = useState(emptyFilterOptions);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);
  const [error, setError] = useState("");
  const beginRequest = useLatestRequest();
  const beginOptionsRequest = useLatestRequest();
  const drawerCloseRef = useRef(null);

  // Details drawer keyboard contract (matches the app's established modal
  // convention): Escape closes it, and focus moves to the close control on open
  // so keyboard users are not stranded. Backdrop click still closes for mouse.
  useEffect(() => {
    if (!selectedOrder) return undefined;
    function onKey(event) { if (event.key === "Escape") setSelectedOrder(null); }
    window.addEventListener("keydown", onKey);
    drawerCloseRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedOrder]);

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
    reportsService.getOrdersFilters({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const merged = { ...emptyFilterOptions, ...(data || {}) };
        // Curate once, here, so the dropdown AND the active-filter chips read the
        // same three labels.
        setFilterOptions({ ...merged, order_types: curateOrderTypes(merged.order_types) });
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
    setError("");
    if (!isOrderedDateRange(dateFrom, dateTo)) {
      setRows([]);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false);
      return;
    }
    const cacheKey = reportCacheKey("orders", { dateFrom, dateTo, filters: appliedFilters });
    const cached = readReportCache(cacheKey);
    if (cached) {
      setRows(cached.rows);
      setLoading(false);
    } else {
      setLoading(true);
    }
    reportsService.listOrders(dateFrom, dateTo, { filters: appliedFilters, signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        if (!Array.isArray(data)) throw new Error("Invalid orders report response");
        const items = data;
        const mapped = items.map((item) => ({
          // ORDERS-FRONTEND-TRUTH-01: `id` (UUID) stays the internal React key
          // ONLY. `publicId` is the canonical human-facing order id shown in the
          // ID column / drawer / Excel — consumed straight from the backend
          // (integer, per-company, required), never derived from the UUID.
          id: String(item.order_id),
          publicId: item.public_id,
          orderNumber: String(item.order_number),
          createdAt: item.created_at,
          status: item.status,
          tableNumber: item.table_number,
          // Canonical historical place snapshot from the backend — never
          // reconstructed from live Hall/Table data on the frontend.
          hallName: item.hall_name ?? null,
          waiterName: item.waiter_name,
          itemsCount: Number(item.items_count),
          totalAmount: Number(item.total_amount),
          orderType: item.order_type ?? null,
          cashierNames: Array.isArray(item.cashier_names) ? item.cashier_names.map(String) : [],
          serviceFee: Number(item.service_fee ?? 0),
          paymentMethods: Array.isArray(item.payment_methods) ? item.payment_methods.map(String) : [],
        }));
        writeReportCache(cacheKey, { rows: mapped });
        setRows(mapped);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить отчёт по заказам.");
      })
      .finally(() => {
        if (request.isCurrent()) {
          setLoading(false);
        }
      });
  }, [
    beginRequest,
    dateRange.start,
    dateRange.end,
    appliedFilters.orderNumber,
    appliedFilters.waiterId,
    appliedFilters.cashierId,
    appliedFilters.productId,
    appliedFilters.orderType,
    appliedFilters.orderStatus,
    appliedFilters.paymentMethod,
    requestVersion,
  ]);

  const visibleRows = rows;
  const activeFilterEntries = Object.entries(appliedFilters).filter(([, value]) => isFilterActive(value));

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  // A checkbox click toggles the page draft IMMEDIATELY (Z-report parity) — the
  // trigger re-renders at once, but no analytics request moves: only the page's
  // own «Фильтровать» commits the draft into appliedFilters, which is what the
  // request effect reads.
  function toggleFilterValue(key, value) {
    setFilters((current) => {
      const list = current[key];
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

  function applyFilters() {
    setAppliedFilters({ ...filters });
    setRequestVersion((version) => version + 1);
    requestPanel("");
  }

  function clearFilters() {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
    requestPanel("");
  }

  function filterPanelProps(panelId) {
    return {
      open: panelState.active === panelId,
      closing: panelState.closing === panelId,
      onOpen: () => requestPanel(panelId),
      onClose: closeFilterPanel,
      onExitComplete: () => completePanelExit(panelId),
    };
  }

  // Compact Excel metadata labels (the on-page chips keep filterNames).
  // Only dimensions actually supported by this page appear here.
  const excelMetadataNames = {
    orderNumber: "Номер заказа",
    waiterId: "Официант",
    cashierId: "Кассир",
    productId: "Блюда",
    orderType: "Тип",
    orderStatus: "Статус",
    paymentMethod: "Тип оплаты",
  };

  // REPORTS-EXCEL-02 final contract: the visible UI stays 8 business columns,
  // while Excel is intentionally richer (11 columns: canonical order_id,
  // service_fee, payment_methods). Export population = visibleRows, i.e. ALL
  // applied-filter result rows (this page has no pagination) — never a page
  // slice, never pending draft state. Totals sum EXACTLY the exported rows;
  // service_fee is already a component of total_amount, so the two totals are
  // separate metrics and are never added together.
  function downloadExcel() {
    const exportRows = visibleRows.map((row) => {
      const cashierDisplay = formatCashierNames(row.cashierNames);
      return {
        // ID column = canonical public_id (not the UUID). Same shared formatter
        // family as the UI so the two surfaces cannot diverge.
        id: row.publicId,
        orderNumber: row.orderNumber,
        createdAt: row.createdAt,
        orderType: orderTypeLabel(row.orderType),
        place: formatPlace(row.hallName, row.tableNumber),
        waiterName: row.waiterName ?? "",
        cashiers: cashierDisplay === "—" ? "" : cashierDisplay,
        serviceFee: row.serviceFee,
        totalAmount: row.totalAmount,
        payments: joinPaymentMethods(row.paymentMethods),
        status: orderStatusLabel(row.status),
      };
    });
    const serviceFeeTotal = exportRows.reduce((sum, row) => sum + (Number(row.serviceFee) || 0), 0);
    const totalAmountTotal = exportRows.reduce((sum, row) => sum + (Number(row.totalAmount) || 0), 0);
    exportToExcel(exportRows, [
      { key: "id", label: "ID", width: 14 },
      { key: "orderNumber", label: "Номер заказа", width: 16 },
      { key: "createdAt", label: "Дата", type: "date", format: "dd.mm.yyyy hh:mm", width: 18 },
      { key: "orderType", label: "Тип", width: 13 },
      { key: "place", label: "Место", width: 22 },
      { key: "waiterName", label: "Официант", width: 18 },
      { key: "cashiers", label: "Кассир", width: 24 },
      { key: "serviceFee", label: "Цена обслуживания", type: "number", format: "#,##0", width: 20 },
      { key: "totalAmount", label: "Цена всего", type: "number", format: "#,##0", width: 16 },
      { key: "payments", label: "Тип оплаты", width: 20 },
      { key: "status", label: "Статус", width: 14, statusColors: true },
    ], "orders-report", {
      sheetName: "Отчёт по заказам",
      autofilter: true,
      // VISUAL FIX 01: the exported Orders workbook no longer renders the
      // applied-filter metadata block — the sheet begins directly with the
      // business header at row 1. The filters below still BUILD the exported
      // population (appliedFilters drives the request); only the visible
      // metadata rows are omitted from the workbook.
      totals: {
        label: "Итого:",
        values: { serviceFee: serviceFeeTotal, totalAmount: totalAmountTotal },
      },
    });
  }

  // No full-page loader: the shell (title/controls/table header) renders
  // immediately, even while the first request pends (see the tbody branch).
  if (error) return <section className="orders-report-page"><div className="login-error" role="alert">{error}</div></section>;

  return (
    <section className="orders-report-page owner-report-view">
      <article className="report-page-card owner-report-surface">
        <div className="report-page-header owner-report-header">
          <div className="report-title-group owner-report-heading"><span className="report-accent-bar" aria-hidden="true" /><div><span className="report-eyebrow owner-report-kicker">Отчёты</span><h1>Отчёт по заказам</h1></div></div>
          <div className="report-actions owner-report-actions">
            <ReportDateRangePicker
              variant="canonical"
              animateExit
              value={dateRange}
              onChange={setDateRange}
              open={panelState.active === "period"}
              onOpenChange={(nextOpen) => requestPanel(nextOpen ? "period" : "")}
              onExitComplete={() => completePanelExit("period")}
              buttonAriaLabel="Период отчёта по заказам"
            />
            <button
              className="orders-filter-toggle"
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="orders-report-filters"
              onClick={() => {
                if (filtersOpen) requestPanel("");
                setFiltersOpen((value) => !value);
              }}
            ><Icon name="bi-sliders" size={17} /> Фильтровать</button>
            <button className="report-excel-button owner-report-excel" type="button" onClick={downloadExcel}><Icon name="bi-filetype-xlsx" size={19} strokeWidth={1.9} className="owner-report-xlsx-icon" /> Скачать Excel</button>
          </div>
        </div>

        <div className={`orders-filter-collapse${filtersOpen ? " is-open" : ""}`}>
          <div className="orders-filter-collapse__inner" inert={!filtersOpen ? true : undefined}>
            <div className="report-filters-grid orders-filter-panel" id="orders-report-filters" aria-label="Фильтры отчёта по заказам">
              <label className="report-filter-input">
                <Icon name="bi-search" size={17} />
                <input aria-label="Номер заказа" value={filters.orderNumber} onChange={(event) => updateFilter("orderNumber", event.target.value)} placeholder="Введите номер заказа" />
              </label>
              <FilterMultiSelect label="Официант" placeholder="Выберите официанта" options={filterOptions.waiters} selected={filters.waiterId} onToggle={(v) => toggleFilterValue("waiterId", v)} disabled={filterOptionsLoading || !filterOptions.waiters.length} {...filterPanelProps("waiterId")} />
              <FilterMultiSelect label="Кассир" placeholder="Выберите кассира" options={filterOptions.cashiers} selected={filters.cashierId} onToggle={(v) => toggleFilterValue("cashierId", v)} disabled={filterOptionsLoading || !filterOptions.cashiers.length} {...filterPanelProps("cashierId")} />
              <FilterMultiSelect label="Блюда" placeholder="Выберите блюдо" options={filterOptions.products} selected={filters.productId} onToggle={(v) => toggleFilterValue("productId", v)} disabled={filterOptionsLoading || !filterOptions.products.length} {...filterPanelProps("productId")} />
              <FilterMultiSelect label="Тип заказа" placeholder="Выберите тип заказа" options={filterOptions.order_types} selected={filters.orderType} onToggle={(v) => toggleFilterValue("orderType", v)} disabled={filterOptionsLoading || !filterOptions.order_types.length} {...filterPanelProps("orderType")} />
              <FilterMultiSelect label="Статус заказа" placeholder="Выберите статус заказа" options={filterOptions.order_statuses} selected={filters.orderStatus} onToggle={(v) => toggleFilterValue("orderStatus", v)} disabled={filterOptionsLoading || !filterOptions.order_statuses.length} {...filterPanelProps("orderStatus")} />
              <FilterMultiSelect label="Тип оплаты" placeholder="Выберите тип оплаты" options={filterOptions.payment_methods} selected={filters.paymentMethod} onToggle={(v) => toggleFilterValue("paymentMethod", v)} disabled={filterOptionsLoading || !filterOptions.payment_methods.length} {...filterPanelProps("paymentMethod")} />
              <div className="report-filter-buttons">
                <button type="button" className="report-filter-apply" onClick={applyFilters}><Icon name="bi-sliders" size={17} /> Фильтровать</button>
                <button type="button" className="report-filter-clear" onClick={clearFilters}><Icon name="bi-x-circle" size={17} /> Очистить</button>
              </div>
            </div>
          </div>
        </div>

        {activeFilterEntries.length ? (
          <div className="report-active-filters" aria-label="Активные фильтры">
            {activeFilterEntries.map(([key, value]) => <span key={key}>{filterNames[key]}: {optionLabel(key, value, filterOptions)}</span>)}
          </div>
        ) : null}

        <div className="report-table-wrapper owner-report-table-scroll" aria-busy={loading ? "true" : "false"}>
          <table className="report-table owner-report-table" aria-label="Отчёт по заказам">
            <thead><tr><th>Номер заказа</th><th>Тип</th><th>Дата</th><th>Место</th><th>Цена всего</th><th>Официант</th><th>Кассир</th><th>Статус</th></tr></thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.id}
                  className="owner-report-row-click"
                  role="button"
                  tabIndex={0}
                  aria-label={`Детали заказа ${row.orderNumber}`}
                  onClick={() => setSelectedOrder(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedOrder(row);
                    }
                  }}
                >
                  <td><strong>{row.orderNumber}</strong></td><td>{orderTypeLabel(row.orderType)}</td><td>{formatDate(row.createdAt)}</td><td>{formatPlace(row.hallName, row.tableNumber) || "—"}</td><td className="report-total-price">{formatMoney(row.totalAmount)}</td><td>{row.waiterName ?? "—"}</td><td>{formatCashierNames(row.cashierNames)}</td><td>{row.status}</td>
                </tr>
              ))}
              {!visibleRows.length ? <tr className="report-empty-row"><td colSpan={8}><ReportEmptyState title="Заказов не найдено" loading={loading} /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </article>

      {selectedOrder ? (
        <div className="order-details-drawer" role="dialog" aria-label="Детали заказа">
          <div className="order-details-drawer__backdrop" onClick={() => setSelectedOrder(null)} />
          <aside className="order-details-drawer__panel">
            <div className="order-details-drawer__head"><div><span>Заказ</span><h3>{selectedOrder.orderNumber}</h3></div><button type="button" ref={drawerCloseRef} onClick={() => setSelectedOrder(null)} aria-label="Закрыть"><Icon name="bi-x-lg" size={18} /></button></div>
            <div className="order-details-drawer__grid">
              <div><span>ID</span><strong>{selectedOrder.publicId}</strong></div><div><span>Дата</span><strong>{formatDate(selectedOrder.createdAt)}</strong></div><div><span>Тип</span><strong>{orderTypeLabel(selectedOrder.orderType)}</strong></div><div><span>Статус</span><strong>{selectedOrder.status}</strong></div><div><span>Стол</span><strong>{selectedOrder.tableNumber ?? "—"}</strong></div><div><span>Официант</span><strong>{selectedOrder.waiterName ?? "—"}</strong></div><div><span>Кассир</span><strong>{formatCashierNames(selectedOrder.cashierNames)}</strong></div><div><span>Позиций</span><strong>{selectedOrder.itemsCount}</strong></div><div><span>Итоговая сумма</span><strong>{formatMoney(selectedOrder.totalAmount)}</strong></div>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { currentMonthRange, toApiDate } from "./reports/reportPeriod";
import { formatMoney } from "./reports/reportMoney";

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

// Closed-trigger summary. One selection reads as itself; several read as a joined
// list while it fits the field, and collapse to «first +N» when it would not.
const TRIGGER_SUMMARY_BUDGET = 24;
function summariseSelection(selected, options) {
  const labels = selected.map((value) => options.find((o) => o.value === value)?.label ?? value);
  if (!labels.length) return "";
  const joined = labels.join(", ");
  if (labels.length === 1 || joined.length <= TRIGGER_SUMMARY_BUDGET) return joined;
  return `${labels[0]} +${labels.length - 1}`;
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
  const [dateRange, setDateRange] = useState(currentMonthRange);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [panelState, setPanelState] = useState({ active: "", closing: "", pending: "" });
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [filterOptions, setFilterOptions] = useState(emptyFilterOptions);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
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
    setLoading(true);
    setError("");
    if (!isOrderedDateRange(dateFrom, dateTo)) {
      setRows([]);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false);
      setHasLoaded(true);
      return;
    }
    reportsService.listOrders(dateFrom, dateTo, { filters: appliedFilters, signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        if (!Array.isArray(data)) throw new Error("Invalid orders report response");
        const items = data;
        setRows(items.map((item) => ({
          id: String(item.order_id),
          orderNumber: String(item.order_number),
          createdAt: item.created_at,
          status: item.status,
          tableNumber: item.table_number,
          waiterName: item.waiter_name,
          itemsCount: Number(item.items_count),
          totalAmount: Number(item.total_amount),
        })));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить отчёт по заказам.");
      })
      .finally(() => {
        if (request.isCurrent()) {
          setLoading(false);
          setHasLoaded(true);
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

  function downloadExcel() {
    exportToExcel(visibleRows, [
      { key: "id", label: "ID заказа" },
      { key: "orderNumber", label: "Номер заказа" },
      { key: "createdAt", label: "Дата" },
      { key: "status", label: "Статус" },
      { key: "tableNumber", label: "Номер стола" },
      { key: "waiterName", label: "Официант" },
      { key: "itemsCount", label: "Количество позиций" },
      { key: "totalAmount", label: "Итоговая сумма" },
    ], "orders-report");
  }

  if (loading && !hasLoaded) return <section className="orders-report-page"><div className="dashboard-empty" role="status">Загрузка отчёта...</div></section>;
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

        <div className="report-table-wrapper owner-report-table-scroll">
          <table className="report-table owner-report-table" aria-label="Отчёт по заказам">
            <thead><tr><th>ID заказа</th><th>Номер заказа</th><th>Дата</th><th>Статус</th><th>Номер стола</th><th>Официант</th><th>Количество позиций</th><th>Итоговая сумма</th></tr></thead>
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
                  <td><strong>{row.id}</strong></td><td>{row.orderNumber}</td><td>{formatDate(row.createdAt)}</td><td>{row.status}</td><td>{row.tableNumber ?? "—"}</td><td>{row.waiterName ?? "—"}</td><td>{row.itemsCount}</td><td className="report-total-price">{formatMoney(row.totalAmount)}</td>
                </tr>
              ))}
              {!visibleRows.length ? <tr className="report-empty-row"><td colSpan={8}><div className="owner-report-empty" role="status"><span className="owner-report-empty__icon"><Icon name="bi-receipt" size={18} /></span><div><strong>Заказов не найдено</strong><span>Измените период или параметры фильтра.</span></div></div></td></tr> : null}
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
              <div><span>ID</span><strong>{selectedOrder.id}</strong></div><div><span>Дата</span><strong>{formatDate(selectedOrder.createdAt)}</strong></div><div><span>Статус</span><strong>{selectedOrder.status}</strong></div><div><span>Стол</span><strong>{selectedOrder.tableNumber ?? "—"}</strong></div><div><span>Официант</span><strong>{selectedOrder.waiterName ?? "—"}</strong></div><div><span>Позиций</span><strong>{selectedOrder.itemsCount}</strong></div><div><span>Итоговая сумма</span><strong>{formatMoney(selectedOrder.totalAmount)}</strong></div>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

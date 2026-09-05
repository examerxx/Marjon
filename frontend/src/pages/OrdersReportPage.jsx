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
  waiterId: "all",
  cashierId: "all",
  productId: "all",
  orderType: "all",
  orderStatus: "all",
  paymentMethod: "all",
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

function optionLabel(key, value, options) {
  if (key === "orderNumber") return value;
  return (options[filterOptionGroups[key]] || []).find((option) => option.value === value)?.label || value;
}

// Orders-local custom dropdown. Composes the SAME behaviour/visual language as
// the Settings → Место `MarjonSelect` (white rounded panel, soft-cyan hover,
// keyboard listbox) WITHOUT importing that page-local component or touching
// Settings — styling lives under `.orders-report-page` in reports.css. The
// placeholder ("all") is the first, selectable reset row so parity with the
// former native <select> is preserved; onChange only mutates the DRAFT filter.
function FilterDropdown({ label, placeholder, value, options, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  // Row 0 is the placeholder/reset ("all"); real options follow.
  const rows = [{ value: "all", label: placeholder }, ...options];
  const selectedIndex = rows.findIndex((o) => o.value === value);
  const selected = value !== "all" ? rows.find((o) => o.value === value) : null;
  const listId = `orders-filter-${label}-listbox`;

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) { if (!rootRef.current?.contains(event.target)) setOpen(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openMenu(index = selectedIndex >= 0 ? selectedIndex : 0) { setActiveIndex(index); setOpen(true); }
  function commit(index) {
    const option = rows[index];
    if (option) onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }
  function onKeyDown(event) {
    if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } return; }
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { openMenu(); return; }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => {
        const next = i + step;
        if (next < 0) return rows.length - 1;
        if (next >= rows.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) { openMenu(); return; }
      commit(activeIndex);
    }
  }

  return (
    <div className={`orders-filter-select${open ? " is-open" : ""}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        className={`orders-filter-select__trigger${selected ? "" : " is-placeholder"}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span className="orders-filter-select__value">{selected ? selected.label : placeholder}</span>
        <span className="orders-filter-select__chevron" aria-hidden="true"><Icon name="bi-chevron-down" size={16} /></span>
      </button>
      {open ? (
        <ul className="orders-filter-select__menu" id={listId} role="listbox" aria-label={label}>
          {rows.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  id={`${listId}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  className={`orders-filter-select__option${isSelected ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(index)}
                >
                  <span>{option.label}</span>
                  {isSelected ? <Icon name="bi-check2" size={14} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export default function OrdersReportPage() {
  const [dateRange, setDateRange] = useState(currentMonthRange);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [filterOptions, setFilterOptions] = useState(emptyFilterOptions);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(true);
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
    const request = beginOptionsRequest();
    setFilterOptionsLoading(true);
    reportsService.getOrdersFilters({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        setFilterOptions({ ...emptyFilterOptions, ...(data || {}) });
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
      .finally(() => { if (request.isCurrent()) setLoading(false); });
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
  ]);

  const visibleRows = rows;
  const activeFilterEntries = Object.entries(appliedFilters).filter(([, value]) => value && value !== "all");

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    setAppliedFilters(filters);
  }

  function clearFilters() {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
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

  if (loading) return <section className="orders-report-page"><div className="dashboard-empty" role="status">Загрузка отчёта...</div></section>;
  if (error) return <section className="orders-report-page"><div className="login-error" role="alert">{error}</div></section>;

  return (
    <section className="orders-report-page owner-report-view">
      <article className="report-page-card owner-report-surface">
        <div className="report-page-header owner-report-header">
          <div className="report-title-group owner-report-heading"><span className="report-accent-bar" aria-hidden="true" /><div><span className="report-eyebrow owner-report-kicker">Отчёты</span><h1>Отчёт по заказам</h1></div></div>
          <div className="report-actions owner-report-actions">
            <ReportDateRangePicker variant="canonical" value={dateRange} onChange={setDateRange} buttonAriaLabel="Период отчёта по заказам" />
            <button className="orders-filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="orders-report-filters" onClick={() => setFiltersOpen((value) => !value)}><Icon name="bi-sliders" size={17} /> Фильтровать</button>
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
              <FilterDropdown label="Официант" placeholder="Выберите официанта" value={filters.waiterId} options={filterOptions.waiters} onChange={(value) => updateFilter("waiterId", value)} disabled={filterOptionsLoading || !filterOptions.waiters.length} />
              <FilterDropdown label="Кассир" placeholder="Выберите кассира" value={filters.cashierId} options={filterOptions.cashiers} onChange={(value) => updateFilter("cashierId", value)} disabled={filterOptionsLoading || !filterOptions.cashiers.length} />
              <FilterDropdown label="Блюда" placeholder="Выберите блюдо" value={filters.productId} options={filterOptions.products} onChange={(value) => updateFilter("productId", value)} disabled={filterOptionsLoading || !filterOptions.products.length} />
              <FilterDropdown label="Тип заказа" placeholder="Выберите тип заказа" value={filters.orderType} options={filterOptions.order_types} onChange={(value) => updateFilter("orderType", value)} disabled={filterOptionsLoading || !filterOptions.order_types.length} />
              <FilterDropdown label="Статус заказа" placeholder="Выберите статус заказа" value={filters.orderStatus} options={filterOptions.order_statuses} onChange={(value) => updateFilter("orderStatus", value)} disabled={filterOptionsLoading || !filterOptions.order_statuses.length} />
              <FilterDropdown label="Тип оплаты" placeholder="Выберите тип оплаты" value={filters.paymentMethod} options={filterOptions.payment_methods} onChange={(value) => updateFilter("paymentMethod", value)} disabled={filterOptionsLoading || !filterOptions.payment_methods.length} />
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

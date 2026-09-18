import { useEffect, useMemo, useRef, useState } from "react";
import { reportsService } from "../api/reports";
import { ordersService } from "../api/orders";
import { paymentsService } from "../api/payments";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import ReportEmptyState from "../components/ReportEmptyState";
import ReportMultiSelect from "../components/ReportMultiSelect";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { formatDateLabel, todayInputValue } from "../utils/date";
import { toApiDate } from "./reports/reportPeriod";
import { formatMoney } from "./reports/reportMoney";

const initialFilters = {
  tableNumber: "",
  waiterId: [],
  paymentMethod: [],
  cashierId: [],
  hallId: [],
};

const filterNames = {
  tableNumber: "Номер стола",
  waiterId: "Официант",
  hallId: "Зал",
  cashierId: "Кассир",
  paymentMethod: "Тип оплаты",
};

const emptyFilterOptions = {
  waiters: [],
  cashiers: [],
  payment_methods: [],
  places: [],
  place_filter_supported: false,
};

const filterOptionGroups = {
  waiterId: "waiters",
  hallId: "places",
  cashierId: "cashiers",
  paymentMethod: "payment_methods",
};

function optionLabel(key, value, options) {
  if (key === "tableNumber") return value;
  const group = options[filterOptionGroups[key]] || [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((single) => group.find((option) => option.value === single)?.label || single).join(", ");
}

function isFilterActive(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(String(value ?? "").trim());
}

// Canonical backend value labels (same wording as the backend label maps).
// Unknown values fall back to the raw value — never blank, never invented.
const ORDER_TYPE_LABELS = {
  dine_in: "На месте",
  takeaway: "На вынос",
  delivery: "Доставка",
  qr: "QR",
};

const ORDER_STATUS_LABELS = {
  new: "Новый",
  accepted: "Принят",
  cooking: "Готовится",
  ready: "Готов",
  completed: "Завершён",
  cancelled: "Отменён",
};

function formatTableDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  const day = date.toLocaleDateString("ru-RU");
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${day} / ${time}`;
}

function tableDisplayLabel(row) {
  return row.hallName ? `${row.tableNumber} — ${row.hallName}` : row.tableNumber;
}

export default function TablesReportPage() {
  // Tables opens on today only, same semantics as Orders/Dishes
  // (local calendar day, single-date label, preset "Сегодня").
  const [dateRange, setDateRange] = useState(() => {
    const today = formatDateLabel(todayInputValue());
    return { preset: "Сегодня", start: today, end: today };
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [filterOptions, setFilterOptions] = useState(emptyFilterOptions);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Shared open-panel orchestration (Orders/Dishes parity): at most one
  // floating panel (period popover or filter dropdown) at a time.
  const [panelState, setPanelState] = useState({ active: "", closing: "", pending: "" });
  // "Посмотреть заказы" modal: the selected table row; order summaries come
  // from the row itself, full contents lazy-load per expanded order.
  const [selectedTable, setSelectedTable] = useState(null);
  const [expandedOrder, setExpandedOrder] = useState("");
  const [orderDetails, setOrderDetails] = useState({});
  const beginRequest = useLatestRequest();
  const beginOptionsRequest = useLatestRequest();
  const detailRequest = useLatestRequest();
  const selectedTableRef = useRef(null);
  const drawerCloseRef = useRef(null);

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

  // Modal keyboard contract (Orders drawer parity): Escape closes, focus moves
  // to the close control on open so keyboard users are not stranded.
  useEffect(() => {
    if (!selectedTable) return undefined;
    function onKey(event) { if (event.key === "Escape") closeTableOrders(); }
    window.addEventListener("keydown", onKey);
    drawerCloseRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTable]);

  useEffect(() => {
    const request = beginOptionsRequest();
    setFilterOptionsLoading(true);
    reportsService.getTablesFilters({ signal: request.signal })
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
    reportsService.listTables(dateFrom, dateTo, { filters: appliedFilters, signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        if (!Array.isArray(data)) throw new Error("Invalid tables report response");
        setRows(data.map((item) => ({
          // Stable identity: canonical table_id, else the legacy number bucket.
          id: String(item.table_id || `legacy-${item.table_number}`),
          tableId: item.table_id || null,
          tableNumber: String(item.table_number),
          hallId: item.hall_id || null,
          hallName: item.hall_name || "",
          orders: (item.orders || []).map((order) => ({
            id: String(order.order_id),
            number: String(order.order_number),
            date: order.created_at,
            amount: Number(order.total_amount),
            type: order.order_type || "",
            status: order.status || "",
            waiter: order.waiter_name || "",
          })),
        })));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить отчёт по столам.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [
    beginRequest,
    dateRange.start,
    dateRange.end,
    appliedFilters.tableNumber,
    appliedFilters.waiterId,
    appliedFilters.paymentMethod,
    appliedFilters.cashierId,
    appliedFilters.hallId,
  ]);

  const filteredRows = rows;
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

  function tableFilterPanelProps(key) {
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

  function openTableOrders(row) {
    selectedTableRef.current = row;
    setSelectedTable(row);
    setExpandedOrder("");
  }

  function closeTableOrders() {
    selectedTableRef.current = null;
    detailRequest();
    setSelectedTable(null);
    setExpandedOrder("");
  }

  function toggleOrderDetail(tableRow, orderId) {
    if (expandedOrder === orderId) {
      setExpandedOrder("");
      return;
    }
    setExpandedOrder(orderId);
    if (orderDetails[orderId]) return;
    // Lazy full contents only for the expanded order; cached afterwards.
    // No eager per-order fetching on page or modal load.
    const request = detailRequest();
    const tableId = tableRow.id;
    Promise.all([
      ordersService.get(orderId, { signal: request.signal }),
      paymentsService.listByOrder(orderId, { signal: request.signal }),
    ])
      .then(([orderRes, paymentsRes]) => {
        if (!request.isCurrent()) return;
        if (selectedTableRef.current?.id !== tableId) return;
        setOrderDetails((current) => ({
          ...current,
          [orderId]: { data: { order: orderRes.data, payments: paymentsRes.data } },
        }));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        if (selectedTableRef.current?.id !== tableId) return;
        setOrderDetails((current) => ({ ...current, [orderId]: { error: true } }));
      });
  }

  function downloadExcel() {
    const cols = [
      { key: "table", label: "Номер стола" },
      { key: "date", label: "Дата" },
      { key: "amount", label: "Сумма" },
    ];
    // One truthful row per matching order — never multi-line cells, never the
    // UI action text ("Посмотреть заказы") as business data.
    const lines = [];
    filteredRows.forEach((row) => {
      row.orders.forEach((order) => {
        lines.push({
          table: tableDisplayLabel(row),
          date: formatTableDateTime(order.date),
          amount: formatMoney(order.amount),
        });
      });
    });
    exportToExcel(lines, cols, "tables-report", {
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

  const selectedDetails = useMemo(() => orderDetails, [orderDetails]);

  // No full-page loader: the shell (title/controls/table header) renders
  // immediately, even while the first request pends (see tbody).
  if (error) return <section className="tables-report-page"><div className="login-error" role="alert">{error}</div></section>;

  return (
    <section className="tables-report-page owner-report-view">
      <article className="report-page-card owner-report-surface">
        <div className="report-page-header owner-report-header">
          <div className="report-title-group owner-report-heading"><span className="report-accent-bar" aria-hidden="true" /><div><span className="report-eyebrow owner-report-kicker">Отчёты</span><h1>Отчёт по столам</h1></div></div>
          <div className="report-actions owner-report-actions">
            <ReportDateRangePicker variant="canonical" animateExit value={dateRange} onChange={setDateRange} open={panelState.active === "period"} onOpenChange={(nextOpen) => requestPanel(nextOpen ? "period" : "")} onExitComplete={() => completePanelExit("period")} buttonAriaLabel="Период отчёта по столам" />
            <button className="tables-filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="tables-report-filters" onClick={() => { if (filtersOpen) requestPanel(""); setFiltersOpen((current) => !current); }}><Icon name="bi-sliders" size={17} /> Фильтровать</button>
            <button className="report-excel-button owner-report-excel" type="button" onClick={downloadExcel}><Icon name="bi-filetype-xlsx" size={19} strokeWidth={1.9} className="owner-report-xlsx-icon" /> Скачать Excel</button>
          </div>
        </div>

        <div className={`orders-filter-collapse${filtersOpen ? " is-open" : ""}`}>
          <div className="orders-filter-collapse__inner" inert={!filtersOpen ? true : undefined}>
        <div className="report-filters-grid tables-filter-panel" id="tables-report-filters" aria-label="Фильтры отчёта по столам">
          <label className="report-filter-input">
            <Icon name="bi-search" size={17} />
            <input aria-label="Номер стола" value={filters.tableNumber} onChange={(event) => updateFilter("tableNumber", event.target.value)} placeholder="Введите номер стола" />
          </label>
          <ReportMultiSelect filterKey="waiterId" label="Официант" placeholder="Выберите официанта" options={filterOptions.waiters} selected={filters.waiterId} onToggle={(value) => toggleFilterValue("waiterId", value)} disabled={filterOptionsLoading || !filterOptions.waiters.length} {...tableFilterPanelProps("waiterId")} />
          <ReportMultiSelect filterKey="hallId" label="Зал" placeholder="Выберите зал" options={filterOptions.places} selected={filters.hallId} onToggle={(value) => toggleFilterValue("hallId", value)} disabled={!filterOptions.place_filter_supported || filterOptionsLoading || !filterOptions.places.length} {...tableFilterPanelProps("hallId")} />
          <ReportMultiSelect filterKey="cashierId" label="Кассир" placeholder="Выберите кассира" options={filterOptions.cashiers} selected={filters.cashierId} onToggle={(value) => toggleFilterValue("cashierId", value)} disabled={filterOptionsLoading || !filterOptions.cashiers.length} {...tableFilterPanelProps("cashierId")} />
          <ReportMultiSelect filterKey="paymentMethod" label="Тип оплаты" placeholder="Выберите тип оплаты" options={filterOptions.payment_methods} selected={filters.paymentMethod} onToggle={(value) => toggleFilterValue("paymentMethod", value)} disabled={filterOptionsLoading || !filterOptions.payment_methods.length} {...tableFilterPanelProps("paymentMethod")} />
          <div className="report-filter-buttons">
            <button type="button" className="report-filter-apply" onClick={applyFilters}><Icon name="bi-sliders" size={17} /> Фильтровать</button>
            <button type="button" className="report-filter-clear" onClick={clearFilters}><Icon name="bi-x-circle" size={17} /> Очистить</button>
          </div>
        </div>
          </div>
        </div>

        <div className="report-table-wrapper owner-report-table-scroll" aria-busy={loading ? "true" : "false"}>
          <table className="report-table owner-report-table" aria-label="Отчёт по столам">
            <thead><tr><th>Номер стола</th><th>Дата</th><th>Сумма</th><th>Транзакции</th></tr></thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{tableDisplayLabel(row)}</strong></td>
                  <td>{row.orders.length ? row.orders.map((order) => (
                    <div key={order.id}>{formatTableDateTime(order.date)}</div>
                  )) : <span aria-hidden="true">—</span>}</td>
                  <td>{row.orders.length ? row.orders.map((order) => (
                    <div key={order.id}>{formatMoney(order.amount)}</div>
                  )) : <span aria-hidden="true">—</span>}</td>
                  <td>
                    <button
                      type="button"
                      className="tables-orders-toggle"
                      onClick={() => openTableOrders(row)}
                      disabled={!row.orders.length}
                      aria-label={`Посмотреть заказы стола ${tableDisplayLabel(row)}`}
                    >
                      Посмотреть заказы
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? <tr className="report-empty-row" aria-hidden={loading || undefined}><td colSpan={4}><ReportEmptyState title="Столы не найдены" hidden={loading} /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </article>

      {selectedTable ? (
        <div className="order-details-drawer" role="dialog" aria-label={`Заказы стола ${tableDisplayLabel(selectedTable)}`}>
          <div className="order-details-drawer__backdrop" onClick={closeTableOrders} />
          <aside className="order-details-drawer__panel">
            <div className="order-details-drawer__head">
              <div>
                <span>Отчёт по столам</span>
                <h3>Стол №{selectedTable.tableNumber}</h3>
                {selectedTable.hallName ? <span>Зал: {selectedTable.hallName}</span> : null}
              </div>
              <button type="button" ref={drawerCloseRef} onClick={closeTableOrders} aria-label="Закрыть"><Icon name="bi-x-lg" size={18} /></button>
            </div>
            {selectedTable.orders.map((order) => {
              const expanded = expandedOrder === order.id;
              const detail = selectedDetails[order.id];
              return (
                <div key={order.id} className="order-details-drawer__dishes">
                  <button
                    type="button"
                    className="order-details-drawer__order-toggle"
                    aria-expanded={expanded}
                    onClick={() => toggleOrderDetail(selectedTable, order.id)}
                  >
                    <span>Заказ №{order.number}</span>
                    <Icon name={expanded ? "bi-dash" : "bi-plus"} size={15} />
                  </button>
                  <div className="order-details-drawer__grid">
                    <div><span>Дата</span><strong>{formatTableDateTime(order.date)}</strong></div>
                    <div><span>Официант</span><strong>{order.waiter || "—"}</strong></div>
                    <div><span>Тип заказа</span><strong>{ORDER_TYPE_LABELS[order.type] || order.type || "—"}</strong></div>
                    <div><span>Статус</span><strong>{ORDER_STATUS_LABELS[order.status] || order.status || "—"}</strong></div>
                    <div><span>Сумма</span><strong>{formatMoney(order.amount)}</strong></div>
                  </div>
                  {expanded ? (
                    <div className="order-details-drawer__detail">
                      {!detail ? (
                        <div role="status">Загрузка деталей заказа…</div>
                      ) : detail.error ? (
                        <div role="alert">Не удалось загрузить детали заказа.</div>
                      ) : (
                        <>
                          <table className="order-details-drawer__items" aria-label={`Позиции заказа №${order.number}`}>
                            <thead><tr><th>Название</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
                            <tbody>
                              {(detail.data.order.items || []).map((item, index) => (
                                <tr key={`${item.product_id || index}`}>
                                  <td>{item.name}</td>
                                  <td>{String(Number(item.quantity))}</td>
                                  <td>{formatMoney(item.price)}</td>
                                  <td>{formatMoney(item.total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="order-details-drawer__totals">
                            <div><span>Подытог</span><strong>{formatMoney(detail.data.order.subtotal)}</strong></div>
                            <div><span>Скидка</span><strong>{formatMoney(detail.data.order.discount_amount)}</strong></div>
                            <div><span>Налог</span><strong>{formatMoney(detail.data.order.tax_amount)}</strong></div>
                            <div><span>Обслуживание</span><strong>{formatMoney(detail.data.order.service_fee)}</strong></div>
                            <div><span>Итого</span><strong>{formatMoney(detail.data.order.total_amount)}</strong></div>
                          </div>
                          <div className="order-details-drawer__payments">
                            <span>Оплата</span>
                            {(detail.data.payments || []).length ? (detail.data.payments || []).map((payment, index) => (
                              <div key={payment.id || index}>
                                <span>{payment.method}</span>
                                <strong>{formatMoney(payment.amount)}</strong>
                                <span>{payment.status}</span>
                              </div>
                            )) : <div>Платежи не найдены.</div>}
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </aside>
        </div>
      ) : null}
    </section>
  );
}

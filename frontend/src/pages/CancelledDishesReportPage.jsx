import { useEffect, useRef, useState } from "react";
import { reportsService } from "../api/reports";
import { ordersService } from "../api/orders";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import ReportMultiSelect from "../components/ReportMultiSelect";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { formatDateLabel, todayInputValue } from "../utils/date";
import { toApiDate } from "./reports/reportPeriod";
import { formatMoney } from "./reports/reportMoney";

// Cancelled Dishes Phase 1B: OWNER truthful report on the Phase 1A backend
// contract. Waiter (Order.waiter_id) and Author (scope-aware cancelled_by)
// are separate concepts — never interchanged. Amount always comes from the
// backend `amount` snapshot; the frontend never derives it from unit price
// and quantity and never reads the zeroed per-item total snapshot.
// Missing author/waiter/table render as —.

const initialFilters = {
  from: "",
  to: "",
  periodPreset: "",
  startTime: "00:00",
  endTime: "00:00",
  orderNumber: "",
  authorId: [],
  dishName: [],
};

function todayFilters() {
  const today = formatDateLabel(todayInputValue());
  return { ...initialFilters, from: todayInputValue(), to: todayInputValue(), periodPreset: "Сегодня" };
}

const filterNames = {
  orderNumber: "Номер заказа",
  authorId: "Автор",
  dishName: "Блюда",
};

const emptyFilterOptions = {
  authors: [],
  dishes: [],
};

const filterOptionGroups = {
  authorId: "authors",
  dishName: "dishes",
};

// Canonical order_type → MARJON Russian labels (Tables oracle wording).
// Unknown values fall back to the raw canonical value — never blank.
const ORDER_TYPE_LABELS = {
  dine_in: "На месте",
  takeaway: "На вынос",
  delivery: "Доставка",
  qr: "QR",
};

const SCOPE_LABELS = {
  item: "Отмена позиции",
  order: "Отмена заказа",
};

function normalizeAuthorOptions(authors) {
  return (authors || []).map((option) => (
    option && typeof option === "object" && "value" in option
      ? option
      : { value: option?.id, label: option?.name }
  )).filter((option) => option.value);
}

function normalizeDishOptions(dishes) {
  return (dishes || []).map((dish) => (
    typeof dish === "string" ? { value: dish, label: dish } : dish
  )).filter((option) => option?.value);
}

function optionLabel(key, value, options) {
  if (key === "orderNumber") return value;
  const group = options[filterOptionGroups[key]] || [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((single) => group.find((option) => option.value === single)?.label || single).join(", ");
}

function isFilterActive(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(String(value ?? "").trim());
}

function formatEventDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = date.toLocaleDateString("ru-RU");
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${day} / ${time}`;
}

function formatLegacyDateTime(date, time) {
  if (!date && !time) return "";
  return time ? `${date} / ${time}` : String(date || "");
}

export function toCancelledDisplayRow(item, index = 0) {
  const eventStamp = item.report_event_at || item.cancelled_at || null;
  return {
    // Stable identity: canonical order_item_id, else the parent order.
    id: String(item.order_item_id || item.order_id || `${item.order_number}-${item.name}-${index}`),
    orderId: item.order_id || null,
    orderItemId: item.order_item_id || null,
    orderNumber: item.order_number ?? "—",
    // Neutral visible Дата: truthful report_event_at when present, legacy
    // date/time split only as a compatibility fallback for old payloads.
    date: eventStamp ? formatEventDateTime(eventStamp) : formatLegacyDateTime(item.date, item.time),
    name: item.name || "",
    tableNumber: item.table_number ?? null,
    quantity: Number(item.quantity ?? 0),
    waiterName: item.waiter_name ?? null,
    orderType: item.order_type || "",
    // Backend-computed truthful line amount. Null (legacy payloads without
    // the field) renders as — rather than a recomputed fabrication.
    amount: item.amount ?? null,
    authorName: item.cancelled_by_name ?? null,
    price: item.price ?? null,
    scope: item.cancellation_scope || "",
    dateSource: item.date_source || "",
  };
}

function normalizeCancelledReportResponse(data) {
  if (!Array.isArray(data)) throw new Error("Invalid cancelled-items report response");
  return data.map(toCancelledDisplayRow);
}

export function cancelledExcelColumns() {
  return [
    { key: "orderNumber", label: "Номер заказа" },
    { key: "date", label: "Дата" },
    { key: "name", label: "Название" },
    { key: "tableNumber", label: "Номер стола" },
    { key: "quantity", label: "Кол-во" },
    { key: "waiterName", label: "Официант" },
    { key: "orderType", label: "Тип" },
    { key: "amount", label: "Сумма" },
    { key: "authorName", label: "Автор" },
  ];
}

export function toCancelledExcelRow(row) {
  return {
    orderNumber: row.orderNumber,
    date: row.date,
    name: row.name,
    tableNumber: row.tableNumber ?? "—",
    quantity: row.quantity,
    waiterName: row.waiterName ?? "—",
    orderType: row.orderType ? (ORDER_TYPE_LABELS[row.orderType] || row.orderType) : "—",
    amount: row.amount ?? "—",
    authorName: row.authorName ?? "—",
  };
}

export default function CancelledDishesReportPage() {
  // Cancelled opens on today only (local calendar day, preset "Сегодня").
  // Period stays a draft until «Фильтровать», same as the frozen page rule.
  const [filters, setFilters] = useState(todayFilters);
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterOptions, setFilterOptions] = useState(emptyFilterOptions);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Shared open-panel orchestration (Orders/Dishes/Tables parity): at most
  // one floating panel (period popover or filter dropdown) at a time.
  const [panelState, setPanelState] = useState({ active: "", closing: "", pending: "" });
  // Details: the selected row; canonical order contents lazy-load on open.
  const [selectedRow, setSelectedRow] = useState(null);
  const [orderDetails, setOrderDetails] = useState({});
  const beginRequest = useLatestRequest();
  const beginOptionsRequest = useLatestRequest();
  const detailRequest = useLatestRequest();
  const selectedRowRef = useRef(null);
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

  // Modal keyboard contract (Tables parity): Escape closes, focus moves to
  // the close control on open so keyboard users are not stranded.
  useEffect(() => {
    if (!selectedRow) return undefined;
    function onKey(event) { if (event.key === "Escape") closeDetails(); }
    window.addEventListener("keydown", onKey);
    drawerCloseRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedRow]); // eslint-disable-line react-hooks/exhaustive-deps

  // Author/dish directories load independently from report rows so the
  // pickers stay useful even when the current result is empty.
  useEffect(() => {
    if (typeof reportsService.getCancelledFilters !== "function") {
      setFilterOptionsLoading(false);
      return;
    }
    const request = beginOptionsRequest();
    setFilterOptionsLoading(true);
    reportsService.getCancelledFilters({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        setFilterOptions({
          authors: normalizeAuthorOptions(data?.authors),
          dishes: normalizeDishOptions(data?.dishes),
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
    setLoading(true);
    setError("");
    if (!isOrderedDateRange(appliedFilters.from, appliedFilters.to)) {
      setRows([]);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false);
      return;
    }
    reportsService.listCancelledDishes(appliedFilters.from, appliedFilters.to, {
      filters: {
        orderNumber: appliedFilters.orderNumber,
        authorId: appliedFilters.authorId,
        dishName: appliedFilters.dishName,
      },
      signal: request.signal,
    })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        setRows(normalizeCancelledReportResponse(data));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить отчёт по отменённым блюдам.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [
    beginRequest,
    appliedFilters.from,
    appliedFilters.to,
    appliedFilters.orderNumber,
    appliedFilters.authorId,
    appliedFilters.dishName,
  ]);

  const filteredRows = rows;
  const activeFilterEntries = Object.entries({
    orderNumber: appliedFilters.orderNumber,
    authorId: appliedFilters.authorId,
    dishName: appliedFilters.dishName,
  }).filter(([, value]) => isFilterActive(value));

  const periodValue = {
    preset: filters.periodPreset,
    start: formatDateLabel(filters.from) || "",
    end: formatDateLabel(filters.to) || "",
    startTime: filters.startTime,
    endTime: filters.endTime,
  };

  function updatePeriod(nextPeriod) {
    setFilters((current) => ({
      ...current,
      from: toApiDate(nextPeriod.start) || "",
      to: toApiDate(nextPeriod.end) || "",
      periodPreset: nextPeriod.preset || "",
      startTime: nextPeriod.startTime || "00:00",
      endTime: nextPeriod.endTime || "00:00",
    }));
  }

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

  function cancelledFilterPanelProps(key) {
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
    // Очистить resets order/author/dish drafts; the applied request drops
    // emptied params entirely (never author_id= or dish_name[]=).
    setFilters((current) => ({ ...current, orderNumber: "", authorId: [], dishName: [] }));
    setAppliedFilters((current) => ({ ...current, orderNumber: "", authorId: [], dishName: [] }));
    requestPanel("");
  }

  function openDetails(row) {
    selectedRowRef.current = row;
    setSelectedRow(row);
    if (!row.orderId || orderDetails[row.orderId]) return;
    // Lazy canonical order contents only for the opened row; cached after.
    // No eager per-row requests.
    const request = detailRequest();
    const rowId = row.id;
    ordersService.get(row.orderId, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        if (selectedRowRef.current?.id !== rowId) return;
        setOrderDetails((current) => ({ ...current, [row.orderId]: { data } }));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        if (selectedRowRef.current?.id !== rowId) return;
        setOrderDetails((current) => ({ ...current, [row.orderId]: { error: true } }));
      });
  }

  function closeDetails() {
    selectedRowRef.current = null;
    detailRequest();
    setSelectedRow(null);
  }

  function downloadExcel() {
    const lines = filteredRows.map(toCancelledExcelRow);
    exportToExcel(lines, cancelledExcelColumns(), "cancelled-dishes-report", {
      metadata: [
        {
          label: "Период",
          value: appliedFilters.from === appliedFilters.to
            ? formatDateLabel(appliedFilters.from)
            : `${formatDateLabel(appliedFilters.from)} – ${formatDateLabel(appliedFilters.to)}`,
        },
        ...activeFilterEntries.map(([key, value]) => ({
          label: filterNames[key],
          value: optionLabel(key, value, {
            authors: normalizeAuthorOptions(filterOptions.authors),
            dishes: normalizeDishOptions(filterOptions.dishes),
          }),
        })),
      ],
    });
  }

  const selectedDetail = selectedRow && selectedRow.orderId ? orderDetails[selectedRow.orderId] : null;

  // Shell-first: title/controls/table header render immediately, even while
  // the first request pends or when loading fails (inline error, no
  // full-page collapse).
  return (
    <section className="cancelled-report-page owner-report-view">
      <article className="cancelled-report-card owner-report-surface">
        <div className="cancelled-report-head owner-report-header">
          <div className="cancelled-report-title owner-report-heading">
            <span className="report-accent-bar" aria-hidden="true" />
            <div>
              <span className="cancelled-report-eyebrow owner-report-kicker">Отчёты</span>
              <h1>Отчёт по отменённым блюдам</h1>
            </div>
          </div>
          <div className="report-actions owner-report-actions">
            <ReportDateRangePicker variant="canonical" animateExit value={periodValue} onChange={updatePeriod} open={panelState.active === "period"} onOpenChange={(nextOpen) => requestPanel(nextOpen ? "period" : "")} onExitComplete={() => completePanelExit("period")} buttonAriaLabel="Период отчёта по отменённым блюдам" />
            <button
              className="cancelled-filter-toggle"
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="cancelled-report-filters"
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
              className="report-filters-grid cancelled-filter-grid"
              id="cancelled-report-filters"
              aria-label="Фильтры отчёта по отменённым блюдам"
            >
              <label className="report-filter-input">
                <Icon name="bi-search" size={17} />
                <input aria-label="Номер заказа" value={filters.orderNumber} onChange={(event) => updateFilter("orderNumber", event.target.value)} placeholder="Введите номер заказа" />
              </label>
              <ReportMultiSelect filterKey="authorId" label="Автор" placeholder="Выберите автора" options={normalizeAuthorOptions(filterOptions.authors)} selected={filters.authorId} onToggle={(value) => toggleFilterValue("authorId", value)} disabled={filterOptionsLoading || !normalizeAuthorOptions(filterOptions.authors).length} {...cancelledFilterPanelProps("authorId")} />
              <ReportMultiSelect filterKey="dishName" label="Блюда" placeholder="Выберите блюда" options={normalizeDishOptions(filterOptions.dishes)} selected={filters.dishName} onToggle={(value) => toggleFilterValue("dishName", value)} disabled={filterOptionsLoading || !normalizeDishOptions(filterOptions.dishes).length} {...cancelledFilterPanelProps("dishName")} />
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
              <span key={key}>{filterNames[key]}: {optionLabel(key, value, {
                authors: normalizeAuthorOptions(filterOptions.authors),
                dishes: normalizeDishOptions(filterOptions.dishes),
              })}</span>
            ))}
          </div>
        ) : null}

        {error ? <div className="login-error" role="alert">{error}</div> : null}

        <div className="cancelled-table-wrap owner-report-table-scroll" aria-busy={loading ? "true" : "false"}>
          <table className="cancelled-table owner-report-table" aria-label="Отчёт по отменённым блюдам">
            <thead>
              <tr>
                <th>Номер заказа</th>
                <th>Дата</th>
                <th>Название</th>
                <th>Номер стола</th>
                <th>Кол-во</th>
                <th>Официант</th>
                <th>Тип</th>
                <th>Сумма</th>
                <th>Автор</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.orderNumber}</td>
                  <td>{row.date}</td>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.tableNumber ?? "—"}</td>
                  <td>{row.quantity}</td>
                  <td>{row.waiterName ?? "—"}</td>
                  <td>{row.orderType ? (ORDER_TYPE_LABELS[row.orderType] || row.orderType) : "—"}</td>
                  <td>{row.amount == null ? "—" : formatMoney(row.amount)}</td>
                  <td>{row.authorName ?? "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="cancelled-details-action"
                      onClick={() => openDetails(row)}
                      aria-label={`Детали отмены ${row.orderNumber} — ${row.name}`}
                    >
                      <Icon name="bi-eye" size={17} />
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr className="cancelled-empty-row" aria-hidden={loading || undefined}>
                  <td colSpan={10}>
                    <div className="owner-report-empty" role="status" style={loading ? { visibility: "hidden" } : undefined}>
                      <span className="owner-report-empty__icon"><Icon name="bi-x-octagon" size={18} /></span>
                      <div><strong>Отменённых блюд нет</strong><span>За выбранный период и фильтры отмены не найдены.</span></div>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      {selectedRow ? (
        <div className="order-details-drawer" role="dialog" aria-label={`Детали отмены ${selectedRow.orderNumber}`}>
          <div className="order-details-drawer__backdrop" onClick={closeDetails} />
          <aside className="order-details-drawer__panel">
            <div className="order-details-drawer__head">
              <div>
                <span>Отменённые блюда</span>
                <h3>Заказ №{selectedRow.orderNumber}</h3>
                <span>{selectedRow.name}</span>
              </div>
              <button type="button" ref={drawerCloseRef} onClick={closeDetails} aria-label="Закрыть"><Icon name="bi-x-lg" size={18} /></button>
            </div>
            <div className="order-details-drawer__grid">
              <div><span>Дата</span><strong>{selectedRow.date || "—"}</strong></div>
              <div><span>Блюдо</span><strong>{selectedRow.name || "—"}</strong></div>
              <div><span>Кол-во</span><strong>{selectedRow.quantity}</strong></div>
              <div><span>Цена</span><strong>{selectedRow.price == null ? "—" : formatMoney(selectedRow.price)}</strong></div>
              <div><span>Сумма</span><strong>{selectedRow.amount == null ? "—" : formatMoney(selectedRow.amount)}</strong></div>
              <div><span>Официант</span><strong>{selectedRow.waiterName ?? "—"}</strong></div>
              <div><span>Автор</span><strong>{selectedRow.authorName ?? "—"}</strong></div>
              <div><span>Тип заказа</span><strong>{selectedRow.orderType ? (ORDER_TYPE_LABELS[selectedRow.orderType] || selectedRow.orderType) : "—"}</strong></div>
              <div><span>Номер стола</span><strong>{selectedRow.tableNumber ?? "—"}</strong></div>
              <div><span>Отмена</span><strong>{selectedRow.scope ? (SCOPE_LABELS[selectedRow.scope] || selectedRow.scope) : "—"}</strong></div>
            </div>
            <div className="order-details-drawer__detail">
              {!selectedRow.orderId ? (
                <div role="status">Детали заказа недоступны для этой строки.</div>
              ) : !selectedDetail ? (
                <div role="status">Загрузка деталей заказа…</div>
              ) : selectedDetail.error ? (
                <div role="alert">Не удалось загрузить детали заказа.</div>
              ) : (
                <>
                  <table className="order-details-drawer__items" aria-label={`Позиции заказа №${selectedRow.orderNumber}`}>
                    <thead><tr><th>Название</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
                    <tbody>
                      {/* Canonical order contents (GET /pos/orders/{id}); the
                          cancelled-line amount above always stays the backend
                          `amount` snapshot, never a value derived here. */}
                      {(selectedDetail.data.items || []).map((position, index) => (
                        <tr key={String(position.product_id || position.id || index)}>
                          <td>{position.name}</td>
                          <td>{String(Number(position.quantity ?? 0))}</td>
                          <td>{formatMoney(position.price)}</td>
                          <td>{formatMoney(position.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="order-details-drawer__totals">
                    <div><span>Подытог</span><strong>{formatMoney(selectedDetail.data.subtotal)}</strong></div>
                    <div><span>Скидка</span><strong>{formatMoney(selectedDetail.data.discount_amount)}</strong></div>
                    <div><span>Налог</span><strong>{formatMoney(selectedDetail.data.tax_amount)}</strong></div>
                    <div><span>Обслуживание</span><strong>{formatMoney(selectedDetail.data.service_fee)}</strong></div>
                    <div><span>Итого</span><strong>{formatMoney(selectedDetail.data.total_amount)}</strong></div>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

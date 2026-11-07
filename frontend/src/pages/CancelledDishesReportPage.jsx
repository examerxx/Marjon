import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { reportsService } from "../api/reports";
import { webDateTime } from "../utils/webTime";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import ReportEmptyState from "../components/ReportEmptyState";
import { reportCacheKey, readReportCache, writeReportCache } from "./reports/reportResultCache";
import ReportMultiSelect from "../components/ReportMultiSelect";
import { exportToExcel, excelLocalDateTime, excelAmountNumber } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { formatDateLabel, todayInputValue } from "../utils/date";
import { toApiDate } from "./reports/reportPeriod";
import { formatMoney } from "./reports/reportMoney";
import { groupCancelledOrders } from "./reports/cancelledOrderGroups";
import CancelledOrderDetails from "./reports/CancelledOrderDetails";
import { isCancellationAcknowledged, useCancellationAcknowledgements } from "../hooks/useCancellationAcknowledgements";

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
  return webDateTime(value);
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
    // Excel-only truthful sources (never rendered on screen): the canonical
    // report_event_at timestamp for a real Excel date cell, and the backend
    // unit snapshot exported verbatim (today the backend returns a hardcoded
    // "шт" — CANCELLED_DISHES_REAL_UNIT_REQUIRED handoff; the frontend just
    // forwards whatever unit the row carries, never inventing one).
    reportEventAt: eventStamp,
    unit: item.unit ?? null,
  };
}

function normalizeCancelledReportResponse(data) {
  if (!Array.isArray(data)) throw new Error("Invalid cancelled-items report response");
  return data.map(toCancelledDisplayRow);
}

// TABLES-family finalized contract: the user-approved 9-column workbook, one
// row per cancelled OrderItem. Money/quantity are numeric-typed cells, Дата is
// a real Excel datetime; missing values stay BLANK (never "—"), real 0 stays 0.
// Тип is screen-only and is not exported.
export function cancelledExcelColumns() {
  return [
    { key: "date", label: "Дата", type: "date", format: "dd.mm.yyyy hh:mm", width: 18 },
    { key: "orderNumber", label: "Номер заказа", width: 16 },
    { key: "tableNumber", label: "Номер стола", width: 14 },
    { key: "name", label: "Название", width: 28 },
    { key: "unit", label: "Ед. изм", width: 10 },
    { key: "quantity", label: "Кол-во", type: "number", format: "#,##0.###", width: 12 },
    { key: "price", label: "Цена", type: "number", format: "#,##0", width: 14 },
    { key: "amount", label: "Сумма", type: "number", format: "#,##0", width: 16 },
    { key: "authorName", label: "Автор", width: 22 },
  ];
}

export function toCancelledExcelRow(row) {
  return {
    // Дата ← report_event_at as a real Excel date (never the legacy date/time
    // strings, which are formatted from Order.created_at); null → blank cell.
    date: excelLocalDateTime(row.reportEventAt),
    // order_number is a text cell (may be non-numeric); "" → blank cell.
    orderNumber: row.orderNumber === "—" ? "" : row.orderNumber,
    tableNumber: row.tableNumber ?? "",
    name: row.name || "",
    // Backend unit snapshot forwarded verbatim (hardcoded "шт" today); blank
    // when absent — the frontend never fabricates a unit.
    unit: row.unit ?? "",
    // Numeric cells: genuine 0 preserved, missing/invalid → blank (null).
    quantity: excelAmountNumber(row.quantity),
    price: excelAmountNumber(row.price),
    // amount is the backend snapshot (max(price*qty - discount, 0)); the
    // frontend never recomputes it and never reads the zeroed OrderItem.total.
    amount: excelAmountNumber(row.amount),
    authorName: row.authorName ?? "",
  };
}

export default function CancelledDishesReportPage() {
  const { receipts, loaded: acknowledgementsLoaded } = useCancellationAcknowledgements();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedOrderId = searchParams.get("cancelledOrder");
  const eventDate = searchParams.get("eventDate") || searchParams.get("dateFrom");
  const eventEnd = searchParams.get("eventDate") || searchParams.get("dateTo");
  const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(value));
  const notificationDate = validDay(eventDate) && validDay(eventEnd) && eventDate <= eventEnd ? eventDate : null;
  const linkedEnd = notificationDate ? eventEnd : null;
  // Cancelled opens on today only (local calendar day, preset "Сегодня").
  // Period stays a draft until «Фильтровать», same as the frozen page rule.
  const [filters, setFilters] = useState(() => notificationDate
    ? { ...initialFilters, from: notificationDate, to: linkedEnd }
    : todayFilters());
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
  useEffect(() => {
    if (!notificationDate) return;
    // Notifications may open while this report already shows another period
    // or actor filter. Request the event day without hiding its order.
    const next = { ...initialFilters, from: notificationDate, to: linkedEnd };
    setFilters(next);
    setAppliedFilters(next);
  }, [notificationDate, linkedEnd, selectedOrderId]);
  function openOrder(order) {
    // Push a real history entry: the existing topbar/browser Back returns to
    // the list without unmounting this page or resetting its report filters.
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("cancelledOrder", order.id);
      return next;
    });
  }
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
    setError("");
    if (!isOrderedDateRange(appliedFilters.from, appliedFilters.to)) {
      setRows([]);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false);
      return;
    }
    const cacheKey = reportCacheKey("cancelled-dishes", {
      from: appliedFilters.from,
      to: appliedFilters.to,
      orderNumber: appliedFilters.orderNumber,
      authorId: appliedFilters.authorId,
      dishName: appliedFilters.dishName,
    });
    const cached = readReportCache(cacheKey);
    if (cached) {
      setRows(cached.rows);
      setLoading(false);
    } else {
      setLoading(true);
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
        const mapped = normalizeCancelledReportResponse(data);
        writeReportCache(cacheKey, { rows: mapped });
        setRows(mapped);
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
  const orderGroups = useMemo(() => groupCancelledOrders(filteredRows), [filteredRows]);
  const selectedOrder = orderGroups.find((order) => order.id === selectedOrderId);
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

  function downloadExcel() {
    // Finalized family workbook: no «Период» metadata block (the sheet starts
    // at the business header), a real Итого row via the shared totals option.
    // Only Кол-во and Сумма are summed; Цена is never totalled. Each total is
    // completeness-aware (Tables rule): numeric only when EVERY row's value is
    // known, otherwise blank — never a partial total masquerading as complete.
    const lines = filteredRows.map(toCancelledExcelRow);
    const columnTotal = (key) => {
      if (!lines.length) return null;
      let sum = 0;
      for (const line of lines) {
        const value = line[key];
        if (typeof value !== "number" || !Number.isFinite(value)) return null;
        sum += value;
      }
      return sum;
    };
    exportToExcel(lines, cancelledExcelColumns(), "cancelled-dishes-report", {
      sheetName: "Отчёт по отменённым блюдам",
      totals: {
        label: "Итого",
        values: {
          quantity: columnTotal("quantity"),
          amount: columnTotal("amount"),
        },
      },
    });
  }

  if (selectedOrder) {
    return <CancelledOrderDetails key={selectedOrder.id} order={selectedOrder} />;
  }

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
                <th>Номер стола</th>
                <th>Кол-во</th>
                <th>Автор</th>
                <th>Тип</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {orderGroups.map((row) => (
                <tr key={row.id} className="cancelled-order-row" tabIndex={0} aria-label={`Заказ №${row.orderNumber}`} onClick={() => openOrder(row)} onKeyDown={(event) => {
                  if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); openOrder(row); }
                }}>
                  <td><span className="cancelled-order-number">{row.orderNumber}{acknowledgementsLoaded && row.orderId && row.items.some(item => !isCancellationAcknowledged(receipts, row.orderId, item.reportEventAt)) ? <span className="cancelled-order-unread" role="img" aria-label="Не ознакомлен" title="Вы ещё не нажали «Ознакомлен»" /> : null}</span></td>
                  <td>{row.date}</td>
                  <td>{row.tableNumber ?? "—"}</td>
                  <td>{row.quantity ?? "—"}</td>
                  <td>{row.authorName ?? "—"}</td>
                  <td>{row.orderType ? (ORDER_TYPE_LABELS[row.orderType] || row.orderType) : "—"}</td>
                  <td>{row.amount == null ? "—" : formatMoney(row.amount)}</td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr className="cancelled-empty-row">
                  <td colSpan={7}>
                    <ReportEmptyState title="Отменённых блюд нет" loading={loading} />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { formatDateLabel, todayInputValue } from "../utils/date";
import { toApiDate } from "./reports/reportPeriod";
import { formatMoney } from "./reports/reportMoney";

export const defaultWaiterFilters = Object.freeze({
  // 0% is the real initial value AND the muted default look: the initial DATA
  // request fires with explicit service_percent=0, so rows/totals always come
  // from the backend. Backend contract untouched (range 0..100). An emptied
  // field is only a transient editing state — commit normalizes it back to 0.
  waiterId: "", servicePercent: "0", includeOrders: true,
  includeTakeawayDelivery: false, includeService: false,
});

export function createWaitersTodayRange() {
  const today = formatDateLabel(todayInputValue());
  return { preset: "Сегодня", start: today, end: today };
}

const calculationOptions = [
  { key: "includeOrders", label: "Сумма заказов" },
  { key: "includeTakeawayDelivery", label: "Самовывоз и доставка" },
  { key: "includeService", label: "Сумма услуги" },
];

const emptyTotals = Object.freeze({
  ordersCount: 0, ordersTotal: 0, takeawayDeliveryTotal: 0,
  serviceTotal: 0, waiterServiceTotal: 0, dishesCount: 0,
});

export function normalizeServicePercent(rawValue) {
  const normalized = String(rawValue ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    return { value: "", error: "Введите целое число от 0 до 100." };
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    return { value: "", error: "Процент должен быть от 0 до 100." };
  }
  return { value: String(Math.trunc(number)), error: "" };
}

function normalizeCommittedServicePercent(rawValue) {
  const normalized = String(rawValue ?? "").trim().replace(",", ".");
  if (!normalized) return normalizeServicePercent(normalized);
  const number = Number(normalized);
  if (!Number.isFinite(number)) return normalizeServicePercent(normalized);
  return {
    value: String(Math.min(100, Math.max(0, Math.trunc(number)))),
    error: "",
  };
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatQuantity(value) {
  return numberValue(value).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function normalizeReport(data) {
  if (!data || !Array.isArray(data.rows) || !data.totals) throw new Error("Invalid waiters report response");
  const rows = data.rows.map((item) => ({
    waiterId: String(item.waiter_id),
    name: String(item.name || "—"),
    ordersCount: numberValue(item.orders_count),
    ordersTotal: numberValue(item.orders_total),
    takeawayDeliveryTotal: numberValue(item.takeaway_delivery_total),
    serviceTotal: numberValue(item.service_total),
    waiterServiceTotal: numberValue(item.waiter_service_total),
    dishesCount: numberValue(item.dishes_count),
    dishes: Array.isArray(item.dishes) ? item.dishes.map((dish) => ({
      productId: String(dish.product_id), name: String(dish.name || "—"),
      quantity: numberValue(dish.quantity), amount: numberValue(dish.amount),
    })) : [],
  }));
  return {
    rows,
    totals: {
      ordersCount: numberValue(data.totals.orders_count),
      ordersTotal: numberValue(data.totals.orders_total),
      takeawayDeliveryTotal: numberValue(data.totals.takeaway_delivery_total),
      serviceTotal: numberValue(data.totals.service_total),
      waiterServiceTotal: numberValue(data.totals.waiter_service_total),
      dishesCount: numberValue(data.totals.dishes_count),
    },
  };
}

function WaiterSingleSelect({
  options, value, onChange, disabled = false, loading = false, error = "",
  open, closing = false, onOpen, onClose, onExitComplete,
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listId = "waiters-report-waiter-listbox";
  const selectedLabel = options.find((option) => option.value === value)?.label || "";

  useEffect(() => { if (open) setActiveIndex(-1); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) { if (!rootRef.current?.contains(event.target)) onClose(); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  function choose(nextValue) {
    onChange(nextValue);
    onClose();
    triggerRef.current?.focus();
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
      if (loading || error || !options.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => {
        const next = index + step;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && activeIndex >= 0 && options[activeIndex]) {
      event.preventDefault();
      choose(options[activeIndex].value);
    }
  }

  function handlePanelAnimationEnd(event) {
    if (closing && event.target === event.currentTarget) onExitComplete();
  }

  function clearSelection(event) {
    event.stopPropagation();
    onChange("");
    if (open) onClose();
    triggerRef.current?.focus();
  }

  return (
    <div className={`orders-filter-select waiters-filter-select${open ? " is-open" : ""}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button type="button" ref={triggerRef} className={`orders-filter-select__trigger${selectedLabel ? " has-value" : " is-placeholder"}`}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
        aria-label="Официант" disabled={disabled} onClick={() => (open ? onClose() : onOpen())}>
        <span className="orders-filter-select__value">{selectedLabel || "Выберите официанта"}</span>
        <span className="orders-filter-select__chevron" aria-hidden="true"><Icon name="bi-chevron-down" size={16} /></span>
      </button>
      {selectedLabel ? <button type="button" className="waiters-filter-select__clear" aria-label="Сбросить выбор официанта"
        disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={clearSelection}>
        <span aria-hidden="true">×</span>
      </button> : null}
      {open || closing ? (
        <div className={`orders-filter-select__panel${closing ? " is-closing" : ""}`}
          aria-hidden={closing ? true : undefined} {...(closing ? { inert: true } : {})}
          onAnimationEnd={closing ? handlePanelAnimationEnd : undefined}>
          <ul className="orders-filter-select__menu" id={listId} role="listbox" aria-label="Официант">
            {loading ? <li role="presentation">
              <span className="orders-filter-select__option waiters-filter-select__state" role="status">Загрузка официантов...</span>
            </li> : error ? <li role="presentation">
              <span className="orders-filter-select__option waiters-filter-select__state is-error" role="alert">{error}</span>
            </li> : !options.length ? <li role="presentation">
              <span className="orders-filter-select__option waiters-filter-select__state">Официанты не найдены</span>
            </li> : options.map((option, index) => {
              const selected = option.value === value;
              return <li key={option.value}>
                <button type="button" id={`${listId}-option-${index}`} role="option" aria-selected={selected}
                  className={`orders-filter-select__option waiters-filter-select__option${selected ? " is-checked" : ""}${index === activeIndex ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option.value)}>
                  <span>{option.label}</span>
                  <span className="waiters-filter-select__choice" aria-hidden="true">{selected ? "✓" : null}</span>
                </button>
              </li>;
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function WaitersReportPage() {
  const [dateRange, setDateRange] = useState(createWaitersTodayRange);
  const [panelState, setPanelState] = useState({ active: "", closing: "", pending: "" });
  const [filters, setFilters] = useState(defaultWaiterFilters);
  const [waiterOptions, setWaiterOptions] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(emptyTotals);
  const [selectedWaiter, setSelectedWaiter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");
  const [percentError, setPercentError] = useState("");
  const beginRequest = useLatestRequest();
  const beginOptionsRequest = useLatestRequest();
  const drawerCloseRef = useRef(null);
  const percentInputRef = useRef(null);
  const lastValidPercentRef = useRef(defaultWaiterFilters.servicePercent);

  useEffect(() => {
    const input = percentInputRef.current;
    if (!input) return undefined;
    function preventWheelSpin(event) {
      event.preventDefault();
    }
    input.addEventListener("wheel", preventWheelSpin, { passive: false });
    return () => input.removeEventListener("wheel", preventWheelSpin);
  }, [hasLoaded]);

  useEffect(() => {
    if (!selectedWaiter) return undefined;
    function onKeyDown(event) { if (event.key === "Escape") setSelectedWaiter(null); }
    window.addEventListener("keydown", onKeyDown);
    drawerCloseRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedWaiter]);

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
    setOptionsLoading(true);
    setOptionsError("");
    reportsService.getWaitersFilters({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        setWaiterOptions(Array.isArray(data?.waiters) ? data.waiters : []);
      })
      .catch((requestError) => {
        if (!request.isCurrent() || isAbortError(requestError)) return;
        setWaiterOptions([]);
        setOptionsError("Не удалось загрузить официантов.");
      })
      .finally(() => { if (request.isCurrent()) setOptionsLoading(false); });
  }, [beginOptionsRequest]);

  useEffect(() => {
    const request = beginRequest();
    const dateFrom = toApiDate(dateRange.start);
    const dateTo = toApiDate(dateRange.end);
    const validatedPercent = normalizeServicePercent(filters.servicePercent);
    if (validatedPercent.error) {
      // Invalid uncommitted input: fetch nothing and claim nothing.
      // hasLoaded flips only on a resolved DATA request or the invalid-date
      // error state below — never synthesized here.
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    if (!isOrderedDateRange(dateFrom, dateTo)) {
      setRows([]); setTotals(emptyTotals);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false); setHasLoaded(true);
      return;
    }
    reportsService.listWaiters(dateFrom, dateTo, {
      filters: { ...filters, servicePercent: validatedPercent.value },
      signal: request.signal,
    })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const report = normalizeReport(data);
        setRows(report.rows); setTotals(report.totals);
      })
      .catch((requestError) => {
        if (!request.isCurrent() || isAbortError(requestError)) return;
        setError(requestError.response?.data?.detail || "Не удалось загрузить отчёт по официантам.");
      })
      .finally(() => {
        if (request.isCurrent()) { setLoading(false); setHasLoaded(true); }
      });
  }, [beginRequest, dateRange.start, dateRange.end, filters.waiterId, filters.servicePercent,
    filters.includeOrders, filters.includeTakeawayDelivery, filters.includeService]);

  function requestPanel(panelId) {
    setPanelState((current) => {
      if (current.closing) return { ...current, pending: current.pending === panelId ? "" : panelId };
      if (!current.active) return panelId ? { active: panelId, closing: "", pending: "" } : current;
      return { active: "", closing: current.active, pending: current.active === panelId ? "" : panelId };
    });
  }

  function completePanelExit(panelId) {
    setPanelState((current) => current.closing === panelId
      ? { active: current.pending, closing: "", pending: "" } : current);
  }

  function panelProps(panelId) {
    return {
      open: panelState.active === panelId,
      closing: panelState.closing === panelId,
      onOpen: () => requestPanel(panelId),
      onClose: () => requestPanel(""),
      onExitComplete: () => completePanelExit(panelId),
    };
  }

  function updateFilter(key, value) {
    setFilters((current) => current[key] === value ? current : { ...current, [key]: value });
  }

  function updateServicePercent(rawValue) {
    // Clearing the field returns to the gray 0% placeholder — never an error.
    if (String(rawValue ?? "") === "") {
      setPercentError("");
      updateFilter("servicePercent", "");
      return;
    }
    const validated = normalizeServicePercent(rawValue);
    setPercentError(validated.error);
    if (!validated.error) lastValidPercentRef.current = validated.value;
    // Store the NORMALIZED value ("0012" -> "12"): with initial "0", typing
    // would otherwise append ("0"+"12" = "012"). Invalid input stays raw so
    // the user sees what to fix alongside the error.
    updateFilter("servicePercent", validated.error ? rawValue : validated.value);
  }

  function commitServicePercent() {
    // An emptied field normalizes back to real 0 on commit — the report must
    // never sit in an unrequested state.
    if (String(filters.servicePercent ?? "").trim() === "") {
      lastValidPercentRef.current = "0";
      setPercentError("");
      updateFilter("servicePercent", "0");
      return;
    }
    const validated = normalizeCommittedServicePercent(filters.servicePercent);
    if (validated.error) {
      setPercentError("");
      updateFilter("servicePercent", lastValidPercentRef.current);
      return;
    }
    lastValidPercentRef.current = validated.value;
    setPercentError("");
    updateFilter("servicePercent", validated.value);
  }

  function stepServicePercent(delta) {
    const validated = normalizeCommittedServicePercent(filters.servicePercent);
    const current = Number(validated.error ? lastValidPercentRef.current : validated.value);
    const next = String(Math.min(100, Math.max(0, current + delta)));
    lastValidPercentRef.current = next;
    setPercentError("");
    updateFilter("servicePercent", next);
  }


  function downloadExcel() {
    const validatedPercent = normalizeServicePercent(filters.servicePercent);
    if (validatedPercent.error) { setPercentError(validatedPercent.error); return; }
    // WAITERS-EXCEL-01: the workbook begins directly with the business header at
    // row 1 (no Период/Официант/Процент/База metadata block — those stay in the
    // browser UI, and the selected percent already drives the canonical request
    // so the exported waiter_service_total reflects it). Exactly 5 reference
    // columns; "Блюда" is intentionally UI-only. All money stays numeric; the
    // shared `totals` option renders the Итого row directly after the data
    // (numeric totals, never summed together).
    exportToExcel(rows, [
      { key: "name", label: "Имя", width: 24 },
      { key: "ordersTotal", label: "Сумма заказов", type: "number", format: "#,##0", width: 20 },
      { key: "takeawayDeliveryTotal", label: "Сумма заказов на вынос", type: "number", format: "#,##0", width: 24 },
      { key: "serviceTotal", label: "Сумма услуги", type: "number", format: "#,##0", width: 18 },
      { key: "waiterServiceTotal", label: "Обслуга официанта", type: "number", format: "#,##0", width: 20 },
    ], "waiters-report", {
      sheetName: "Отчёт по официантам",
      totals: {
        label: "Итого:",
        values: {
          ordersTotal: totals.ordersTotal,
          takeawayDeliveryTotal: totals.takeawayDeliveryTotal,
          serviceTotal: totals.serviceTotal,
          waiterServiceTotal: totals.waiterServiceTotal,
        },
      },
    });
  }

  // No full-page loader: the shell (title/controls/table header/totals row)
  // renders immediately, even while the first request pends. hasLoaded still
  // gates only the initial-error page below.
  if (error && !hasLoaded) return <section className="waiters-report-page"><div className="login-error" role="alert">{error}</div></section>;

  return (
    <section className="waiters-report-page owner-report-view">
      <article className="report-page-card waiters-report-card owner-report-surface">
        <div className="report-page-header owner-report-header waiters-report-header">
          <div className="report-title-group owner-report-heading">
            <span className="report-accent-bar" aria-hidden="true" />
            <div><span className="report-eyebrow owner-report-kicker">Отчёты</span><h1>Отчёт по официантам</h1></div>
          </div>
          <div className="report-actions owner-report-actions waiters-report-actions">
            <ReportDateRangePicker variant="canonical" animateExit value={dateRange} onChange={setDateRange}
              open={panelState.active === "period"} onOpenChange={(nextOpen) => requestPanel(nextOpen ? "period" : "")}
              onExitComplete={() => completePanelExit("period")} buttonAriaLabel="Период отчёта по официантам" />
            <div className="waiters-percent-control-wrap">
              <div className={`waiters-percent-stepper${percentError ? " is-invalid" : ""}${!filters.servicePercent || Number(filters.servicePercent) === 0 ? " is-empty" : ""}`}>
                <input ref={percentInputRef} type="number" min="0" max="100" step="1" inputMode="numeric" aria-label="Процент обслуживания" placeholder="0"
                  aria-invalid={percentError ? true : undefined} aria-describedby={percentError ? "waiters-percent-error" : undefined}
                  value={filters.servicePercent} onChange={(event) => updateServicePercent(event.target.value)} onBlur={commitServicePercent}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                      event.preventDefault(); stepServicePercent(event.key === "ArrowUp" ? 1 : -1);
                    } else if (event.key === "Enter") {
                      commitServicePercent();
                    }
                  }} />
                {/* MICRO-JITTER-02: fixed suffix slot — one constant offset for
                    0..100. The right-anchored numeric slot absorbs digit-width
                    differences, so "%" never shifts per value. */}
                <span className="waiters-percent-stepper__suffix" aria-hidden="true"
                  style={{ left: "calc(33px + 0.5ch)" }}>%</span>
                <span className="waiters-percent-stepper__controls">
                  <button type="button" className="waiters-percent-stepper__up" aria-label="Увеличить процент обслуживания"
                    disabled={!percentError && Number(filters.servicePercent) >= 100}
                    onClick={() => stepServicePercent(1)} />
                  <button type="button" className="waiters-percent-stepper__down" aria-label="Уменьшить процент обслуживания"
                    disabled={!percentError && Number(filters.servicePercent) <= 0}
                    onClick={() => stepServicePercent(-1)} />
                </span>
              </div>
              {percentError ? <small id="waiters-percent-error" className="waiters-filter-error" role="alert">{percentError}</small> : null}
            </div>
            <WaiterSingleSelect options={waiterOptions} value={filters.waiterId}
              onChange={(value) => updateFilter("waiterId", value)} loading={optionsLoading} error={optionsError}
              {...panelProps("waiter")} />
            <button className="report-excel-button owner-report-excel" type="button" onClick={downloadExcel}>
              <Icon name="bi-filetype-xlsx" size={19} strokeWidth={1.9} className="owner-report-xlsx-icon" /> Скачать Excel
            </button>
          </div>
        </div>

        {error ? <div className="login-error waiters-report-error" role="alert">{error}</div> : null}

        <div className="report-table-wrapper owner-report-table-scroll" aria-busy={loading ? "true" : "false"}>
          <table className="report-table owner-report-table" aria-label="Отчёт по официантам">
            <thead><tr><th>Имя</th>{calculationOptions.map((option) => <th key={option.key}>
              <label className={`waiters-table-toggle${filters[option.key] ? " is-checked" : ""}`}>
                <input type="checkbox" checked={filters[option.key]}
                  onChange={(event) => updateFilter(option.key, event.target.checked)} />
                <span className="waiters-table-toggle__box" aria-hidden="true">
                  {filters[option.key] ? <span className="waiters-table-toggle__tick">✓</span> : null}
                </span>
                <span>{option.label}</span>
              </label>
            </th>)}<th>Обслуживание официанта</th><th>Блюда</th></tr></thead>
            <tbody>
              <tr className="report-total-row"><td><strong>Всего</strong></td><td>{formatMoney(totals.ordersTotal)}</td>
                <td>{formatMoney(totals.takeawayDeliveryTotal)}</td><td>{formatMoney(totals.serviceTotal)}</td>
                <td>{formatMoney(totals.waiterServiceTotal)}</td><td>{formatQuantity(totals.dishesCount)}</td></tr>
              {rows.map((waiter) => <tr key={waiter.waiterId}><td><strong>{waiter.name}</strong></td><td>{formatMoney(waiter.ordersTotal)}</td>
                <td>{formatMoney(waiter.takeawayDeliveryTotal)}</td><td>{formatMoney(waiter.serviceTotal)}</td>
                <td className="report-total-price">{formatMoney(waiter.waiterServiceTotal)}</td><td>
                  <button type="button" className="waiters-dishes-button" aria-label={`Блюда официанта ${waiter.name}`} onClick={() => setSelectedWaiter(waiter)}>
                    {formatQuantity(waiter.dishesCount)} <span>шт.</span>
                  </button>
                </td></tr>)}
            </tbody>
          </table>
        </div>
      </article>

      {selectedWaiter ? <div className="waiter-dishes-drawer" role="dialog" aria-modal="true" aria-label={`Блюда официанта ${selectedWaiter.name}`}>
        <div className="waiter-dishes-drawer__backdrop" onClick={() => setSelectedWaiter(null)} />
        <aside className="waiter-dishes-drawer__panel">
          <div className="waiter-dishes-drawer__head"><div><span>Блюда официанта</span><h3>{selectedWaiter.name}</h3></div>
            <button type="button" ref={drawerCloseRef} onClick={() => setSelectedWaiter(null)} aria-label="Закрыть"><Icon name="bi-x-lg" size={18} /></button></div>
          <div className="waiter-dishes-drawer__period">Период: {dateRange.start === dateRange.end ? dateRange.start : `${dateRange.start} – ${dateRange.end}`}</div>
          <div className="waiter-dishes-drawer__table-wrap"><table aria-label="Состав блюд официанта">
            <thead><tr><th>Блюдо</th><th>Количество</th><th>Сумма</th></tr></thead><tbody>
              {selectedWaiter.dishes.map((dish) => <tr key={`${dish.productId}-${dish.name}`}><td>{dish.name}</td><td>{formatQuantity(dish.quantity)}</td><td>{formatMoney(dish.amount)}</td></tr>)}
              {!selectedWaiter.dishes.length ? <tr><td colSpan={3}>Блюд за период нет.</td></tr> : null}
            </tbody></table></div>
        </aside>
      </div> : null}
    </section>
  );
}

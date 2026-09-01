import { useEffect, useMemo, useRef, useState } from "react";
import { reportsService } from "../api/reports";
import { staffService } from "../api/staff";
import { settingsService } from "../api/settings";
import { getCategories } from "../api/categories";
import { isAbortError, useLatestRequest } from "../hooks/useAsyncSafety";
import Icon from "../components/Icon";
import ReportDateRangePicker, {
  formatCanonicalReportPeriodLabel,
  validateCanonicalReportPeriod,
} from "../components/ReportDateRangePicker";
import { formatDateLabel, todayInputValue } from "../utils/date";
import { formatMoney } from "./reports/reportMoney";
import { toApiDate } from "./reports/reportPeriod";

function currentZReportPeriod() {
  const today = formatDateLabel(todayInputValue());
  return { preset: "Сегодня", start: today, end: today, startTime: "00:00", endTime: "00:00" };
}

export const formatZReportPeriodLabel = formatCanonicalReportPeriodLabel;
export const validateZReportPeriod = validateCanonicalReportPeriod;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNullable(value) {
  return value == null || value === "" ? "Недоступно" : String(value);
}

function apiList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function hasRole(user, slug) {
  const slugs = Array.isArray(user?.role_slugs)
    ? user.role_slugs
    : user?.role_slug
      ? [user.role_slug]
      : [];
  return slugs.includes(slug);
}

const financialRows = [
  ["Валовые продажи", "gross_sales"],
  ["Скидки", "discounts_total"],
  ["Сервисный сбор", "service_fee_total"],
  ["Налог", "tax_total"],
  ["Возвраты", "refunds_total"],
  ["Чистые продажи", "net_sales"],
  ["Наличные", "cash_total"],
  ["Получено наличными", "cash_received_total"],
  ["Выдано сдачи", "change_given_total"],
  ["Безналичные оплаты", "non_cash_total"],
  ["Средний чек", "avg_check"],
];

const countRows = [
  ["Заказы", "orders_count"],
  ["Отменённые заказы", "cancelled_orders_count"],
  ["Оплаты", "payments_count"],
  ["Фискальные чеки", "fiscal_receipts_count"],
];

// Render the report's period as DD.MM.YYYY (single) or a range, from the
// backend's own date / date_from / date_to — so the printout names exactly the
// aggregation window it contains.
function isoToDisplay(value) {
  if (!value || typeof value !== "string") return "";
  const [y, m, d] = value.split("-");
  return y && m && d ? `${d}.${m}.${y}` : value;
}
export function formatZReportPrintPeriod(report) {
  if (report.date_from && report.date_to) {
    return `за период ${isoToDisplay(report.date_from)} – ${isoToDisplay(report.date_to)}`;
  }
  return `за ${isoToDisplay(report.date)}`;
}

export function buildPrintDocument(report) {
  const periodLabel = formatZReportPrintPeriod(report);
  const paymentRows = report.payment_methods.map((item) => `
    <tr><td>${escapeHtml(item.method)}</td><td>${escapeHtml(item.count)}</td><td>${escapeHtml(formatMoney(item.amount))}</td></tr>
  `).join("");
  const metrics = financialRows.map(([label, key]) => `
    <tr><td>${escapeHtml(label)}</td><td>${escapeHtml(formatMoney(report[key]))}</td></tr>
  `).join("");
  const counts = countRows.map(([label, key]) => `
    <tr><td>${escapeHtml(label)}</td><td>${escapeHtml(report[key])}</td></tr>
  `).join("");

  return `<!doctype html>
<html lang="ru"><head><meta charset="UTF-8"><title>MARJON — Z-отчёт ${escapeHtml(periodLabel)}</title>
<style>body{font-family:Arial,sans-serif;color:#111827;margin:24px}h1{text-align:center}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #d1d5db;padding:8px;text-align:left}th{background:#f3f4f6}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px}</style>
</head><body><h1>Z-отчёт ${escapeHtml(periodLabel)}</h1><div class="meta"><span>Период: ${escapeHtml(periodLabel)}</span><span>Смена закрыта: ${report.is_closed ? "Да" : "Нет"}</span><span>Открыта: ${escapeHtml(formatNullable(report.shift_opened_at))}</span><span>Закрыта: ${escapeHtml(formatNullable(report.shift_closed_at))}</span></div>
<h2>Показатели</h2><table><tbody>${metrics}${counts}</tbody></table>
<h2>Способы оплаты</h2><table><thead><tr><th>Способ</th><th>Количество</th><th>Сумма</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="3">Нет оплат за выбранный период</td></tr>'}</tbody></table>
</body></html>`;
}

// Four per-entity report generators. Their backend contracts (report by
// cashier, per-entity waiter/place/menu filtering, waiter %) do NOT exist
// yet on the authoritative backend, so every per-entity Print is a truthful
// DEFERRED state ("Скоро" / "Отчёт ещё не подключён") — NOT an error, NOT fake
// output. Selector options come from real (currently empty) backend lists.
const REPORT_ROWS = [
  { key: "cashier", title: "Отчёт по кассирам", empty: "Нет кассиров", role: "cashier", multi: true },
  { key: "waiter", title: "Отчёт по официантам", empty: "Нет официантов", role: "waiter", multi: true, percent: true },
  { key: "place", title: "Отчёт по местам", empty: "Нет мест", source: "places", multi: true },
  { key: "menu", title: "Отчёт по меню", empty: "Нет категорий", source: "categories" },
];

function optionLabel(item) {
  return item.name || item.title || item.full_name || item.label || "—";
}
function optionValue(item) {
  return String(item.id ?? item.slug ?? item.name ?? "");
}

// Measure the pixel width of the percent digits in the input's own font, so the
// "%" suffix can be placed exactly one pixel past them (module-scoped canvas).
let _percentCanvas;
function measurePercentDigits(text, fontShorthand) {
  try {
    _percentCanvas = _percentCanvas || document.createElement("canvas");
    const ctx = _percentCanvas.getContext("2d");
    ctx.font = fontShorthand;
    return ctx.measureText(text).width;
  } catch {
    return text.length * 8;
  }
}

// Checkbox multi-select dropdown (cashier/waiter/place). Marjon visual language,
// not a native multi listbox. Multiple employees can be selected/deselected;
// picking a second does not replace the first. Empty list → disabled.
function EmployeeMultiSelect({ label, emptyLabel, options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const disabled = options.length === 0;

  useEffect(() => {
    if (!open) return undefined;
    function onDocDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  let summary;
  let selectedNames = "";
  if (disabled) summary = emptyLabel;
  else if (selected.length === 0) summary = "Не выбрано";
  else {
    selectedNames = selected
      .map((value) => { const one = options.find((item) => optionValue(item) === value); return one ? optionLabel(one) : null; })
      .filter(Boolean)
      .join(", ");
    summary = selectedNames || "Не выбрано";
  }

  return (
    <div className={`owner-msel${open ? " is-open" : ""}`} ref={ref}>
      <button
        type="button"
        className="owner-msel__button owner-report-row__select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selectedNames ? `${label}: ${selectedNames}` : label}
        title={selectedNames || undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`owner-msel__value${selected.length ? "" : " owner-msel__placeholder"}`}>{summary}</span>
        {!disabled ? <Icon name="bi-chevron-down" size={14} /> : null}
      </button>
      {open && !disabled ? (
        <ul className="owner-msel__menu" role="listbox" aria-multiselectable="true">
          {options.map((item) => {
            const value = optionValue(item);
            const checked = selected.includes(value);
            return (
              <li key={value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={`owner-msel__option${checked ? " is-checked" : ""}`}
                  onClick={() => onToggle(value)}
                >
                  <span className="owner-msel__check" aria-hidden="true">
                    {checked ? (
                      <svg className="owner-msel__tick" viewBox="0 0 16 16" width="12" height="12">
                        <path d="M13 4.5 6.5 11 3 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </span>
                  {optionLabel(item)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export default function ZReportPage() {
  const [selectedPeriod, setSelectedPeriod] = useState(currentZReportPeriod);
  // Single day → { date }; multi-day → { date_from, date_to }. The displayed
  // range (picker label) therefore always equals the exact backend request.
  const reportFrom = toApiDate(selectedPeriod.start);
  const reportTo = toApiDate(selectedPeriod.end);
  const isPeriod = Boolean(reportFrom && reportTo && reportFrom !== reportTo);
  const reportParams = isPeriod ? { date_from: reportFrom, date_to: reportTo } : { date: reportTo || reportFrom };
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beginRequest = useLatestRequest();
  const [staff, setStaff] = useState([]);
  const [places, setPlaces] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selection, setSelection] = useState({ cashier: [], waiter: [], waiterPercent: "", place: [], menu: "" });
  // Position the presentational "%" exactly one pixel past the rendered digits
  // (measured with the input's real font), so the number's left edge is fixed,
  // the "%" hugs the digits, and the native number stepper stays at the right.
  const percentInputRef = useRef(null);
  const [percentSuffixLeft, setPercentSuffixLeft] = useState(19);
  useEffect(() => {
    const el = percentInputRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const font = cs.font && cs.font.trim()
      ? cs.font
      : `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    setPercentSuffixLeft(12 + Math.round(measurePercentDigits(String(selection.waiterPercent || "") || "0", font)) + 1);
  }, [selection.waiterPercent]);

  function toggleMulti(key, value) {
    setSelection((prev) => {
      const current = prev[key];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  }

  // Whole-shift Z-report (the one real, backend-supported report) — for print.
  useEffect(() => {
    const request = beginRequest();
    setLoading(true);
    setError("");
    setReport(null);
    reportsService.getZReport(reportParams, { signal: request.signal })
      .then(({ data }) => {
        if (!data || typeof data !== "object" || !Array.isArray(data.payment_methods)) {
          throw new Error("Invalid Z-report response");
        }
        if (request.isCurrent()) setReport(data);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setError(err.response?.status === 403
          ? "Доступ к Z-отчёту запрещён."
          : err.response?.data?.detail || "Не удалось загрузить Z-отчёт.");
      })
      .finally(() => {
        if (request.isCurrent()) setLoading(false);
      });
  }, [beginRequest, reportParams.date, reportParams.date_from, reportParams.date_to]);

  // Real selector lists (empty on a new company). Failures leave the selector
  // truthfully empty rather than fabricating names. Places come from the
  // canonical Hall directory (settingsService.listPlaces → GET /halls: active,
  // non-deleted Halls; value = Hall.id, label = Hall.name) — NOT branches.
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    Promise.allSettled([
      staffService.listStaffUsers({ signal: controller.signal }),
      settingsService.listPlaces({ signal: controller.signal }),
      getCategories({ signal: controller.signal }),
    ]).then(([staffRes, placesRes, categoriesRes]) => {
      if (!alive) return;
      if (staffRes.status === "fulfilled") setStaff(apiList(staffRes.value.data));
      if (placesRes.status === "fulfilled") setPlaces(apiList(placesRes.value.data));
      if (categoriesRes.status === "fulfilled") setCategories(apiList(categoriesRes.value.data));
    });
    return () => { alive = false; controller.abort(); };
  }, []);

  const optionsByKey = useMemo(() => ({
    cashier: staff.filter((user) => hasRole(user, "cashier")),
    waiter: staff.filter((user) => hasRole(user, "waiter")),
    place: places,
    menu: categories,
  }), [staff, places, categories]);

  function handleShiftPrint() {
    if (!report || loading || error) return;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);
    const printWindow = iframe.contentWindow;
    const printDocument = printWindow?.document;
    if (!printWindow || !printDocument) {
      iframe.remove();
      return;
    }
    printDocument.open();
    printDocument.write(buildPrintDocument(report));
    printDocument.close();
    printWindow.onafterprint = () => iframe.remove();
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      window.setTimeout(() => iframe.remove(), 60000);
    }, 120);
  }

  const shiftPrintDisabled = !report || loading || Boolean(error);

  return (
    <section className="owner-reports-page owner-reports-page--generator">
      <header className="owner-reports__head">
        <h1 className="owner-reports__title">Z-отчёт</h1>
        <div className="owner-reports__head-actions">
          <ReportDateRangePicker
            variant="canonical"
            value={selectedPeriod}
            onChange={setSelectedPeriod}
            buttonAriaLabel="Период Z-отчёта"
          />
          <button
            className="owner-reports__shift-print"
            type="button"
            onClick={handleShiftPrint}
            disabled={shiftPrintDisabled}
          >
            <Icon name="bi-printer" size={16} /> Печать общего Z-отчёта
          </button>
        </div>
      </header>

      {error ? (
        <div className="owner-reports__note owner-reports__note--error" role="alert">Общий Z-отчёт недоступен: {error}</div>
      ) : null}

      <section className="owner-reports__panel">
        <h2 className="owner-reports__panel-title">Детализированные отчёты</h2>
        <div className="owner-reports__rows">
        {REPORT_ROWS.map((row) => {
          const options = optionsByKey[row.key] || [];
          const hasOptions = options.length > 0;
          return (
            <div className="owner-report-row" key={row.key}>
              <div className="owner-report-row__title">{row.title}</div>
              <div className="owner-report-row__controls">
                {row.multi ? (
                  <EmployeeMultiSelect
                    label={row.title}
                    emptyLabel={row.empty}
                    options={options}
                    selected={selection[row.key]}
                    onToggle={(value) => toggleMulti(row.key, value)}
                  />
                ) : (
                  <select
                    className="owner-report-row__select"
                    aria-label={row.title}
                    value={hasOptions ? (selection[row.key] || optionValue(options[0])) : ""}
                    disabled={!hasOptions}
                    onChange={(event) => setSelection((prev) => ({ ...prev, [row.key]: event.target.value }))}
                  >
                    {hasOptions ? (
                      options.map((item) => (
                        <option key={optionValue(item)} value={optionValue(item)}>{optionLabel(item)}</option>
                      ))
                    ) : (
                      <option value="">{row.empty}</option>
                    )}
                  </select>
                )}
                {row.percent ? (
                  <span className="owner-report-row__percent-wrap">
                    <input
                      ref={percentInputRef}
                      className="owner-report-row__percent"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="100"
                      placeholder="0"
                      aria-label="Процент официанта"
                      value={selection.waiterPercent}
                      disabled={selection.waiter.length === 0}
                      onChange={(event) => setSelection((prev) => ({ ...prev, waiterPercent: event.target.value }))}
                    />
                    {/* Presentation-only "%" one pixel past the digits (font-measured):
                        number LEFT edge fixed, "%" hugs the digits, native stepper at
                        the right. Value stays numeric. */}
                    <span
                      className="owner-report-row__percent-suffix"
                      aria-hidden="true"
                      style={{ left: `${percentSuffixLeft}px` }}
                    >%</span>
                  </span>
                ) : null}
              </div>
              <div className="owner-report-row__action">
                <button
                  className="owner-report-row__print"
                  type="button"
                  disabled
                  aria-disabled="true"
                  aria-label="Печать недоступна: отчёт ещё не подключён"
                  title="Отчёт ещё не подключён"
                >
                  <Icon name="bi-printer" size={16} /> Печать
                </button>
              </div>
            </div>
          );
        })}
        </div>
      </section>
    </section>
  );
}

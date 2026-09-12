import { useEffect, useMemo, useRef, useState } from "react";
import { reportsService } from "../api/reports";
import { staffService } from "../api/staff";
import { settingsService } from "../api/settings";
import { getCategories } from "../api/categories";
import { isAbortError } from "../hooks/useAsyncSafety";
import Icon from "../components/Icon";
import ReportDateRangePicker, {
  formatCanonicalReportPeriodLabel,
  validateCanonicalReportPeriod,
} from "../components/ReportDateRangePicker";
import { formatDateLabel, todayInputValue } from "../utils/date";
import {
  isEmptyExplicitRange,
  zReportPeriodParams,
  zReportPrintPeriod,
} from "./reports/reportPeriod";
import {
  buildZReportDetailPrintDocument,
  closePrintSurface,
  openPrintSurface,
  renderPrintSurface,
} from "./reports/zReportDetailPrint";

function currentZReportPeriod() {
  const today = formatDateLabel(todayInputValue());
  // timeTouched stays false: the report opens as a whole-day, date-only window
  // and only an explicit clock change (ZR-TIME-01) turns it into a time window.
  return { preset: "Сегодня", start: today, end: today, startTime: "00:00", endTime: "00:00" };
}

export const formatZReportPeriodLabel = formatCanonicalReportPeriodLabel;

// The Z-report's own range rule: the shared canonical date rules, plus — once the
// operator has chosen clocks — a strictly positive window. A zero-length or
// inverted explicit window is refused at OK, so it never becomes page state and
// never reaches the analytics API.
export function validateZReportPeriod(range = {}) {
  const dateError = validateCanonicalReportPeriod(range);
  if (dateError) return dateError;
  if (isEmptyExplicitRange(range)) {
    return "Начало периода должно быть раньше его окончания.";
  }
  return "";
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

// ZR-TIME-01: the printed period is the window the BACKEND aggregated, because
// the same selection now produces both. In explicit-time mode the request carries
// time_from/time_to and the head prints «DD.MM.YYYY HH:MM - DD.MM.YYYY HH:MM»; in
// date-only mode no clock is sent and none is printed — a whole-day report must
// never be labelled «00:00 - 00:00», which would claim a zero-length window.
// The mapping itself lives in reports/reportPeriod so the request builder and the
// printed head cannot disagree.
export const formatZReportPrintPeriod = zReportPrintPeriod;

// Four per-entity report generators. Three are backed by the real canonical
// contract GET /analytics/z-report/detail (dimension = cashier | waiter | hall)
// and print for real once at least one entity is selected. Menu has NO detail
// dimension — category-level money cannot be expressed in the Z shape — so its
// Print stays truthfully DISABLED rather than faking a successful print.
// Selector values are canonical backend ids: cashier/waiter = User.id (from
// /auth/staff-users), place = Hall.id (from the canonical /halls directory).
const REPORT_ROWS = [
  { key: "cashier", title: "Отчёт по кассирам", empty: "Нет кассиров", role: "cashier", multi: true, dimension: "cashier" },
  { key: "waiter", title: "Отчёт по официантам", empty: "Нет официантов", role: "waiter", multi: true, percent: true, dimension: "waiter" },
  { key: "place", title: "Отчёт по местам", empty: "Нет мест", source: "places", multi: true, dimension: "hall" },
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
  // ONE builder for every Z-report request (ZR-TIME-01): single day → { date };
  // multi-day → { date_from, date_to }; plus { time_from, time_to } once the
  // operator has chosen clocks. The displayed range, the printed head and the
  // backend window are therefore all derived from the same selection.
  const reportParams = zReportPeriodParams(selectedPeriod);
  const printPeriod = zReportPrintPeriod(selectedPeriod);
  const [staff, setStaff] = useState([]);
  const [places, setPlaces] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selection, setSelection] = useState({ cashier: [], waiter: [], waiterPercent: "", place: [], menu: "" });
  // Per-entity Print (ZR-PRINT-01C): which row is currently fetching its detail
  // (one at a time — no duplicate Print jobs), and the last print failure.
  const [printingRow, setPrintingRow] = useState("");
  const [detailError, setDetailError] = useState("");
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

  // Real per-entity Print: ONE dimension per click, exactly the period the
  // picker displays, ids = canonical backend ids in picker order. The backend
  // returns per-entity blocks plus authoritative union totals — nothing here is
  // summed, averaged or otherwise re-derived.
  async function handleDetailPrint(row) {
    const ids = selection[row.key];
    if (!row.dimension || !Array.isArray(ids) || ids.length === 0 || printingRow) return;
    // ZR-TIME-01 last line of defence: an empty explicit window is refused at the
    // picker's OK, so it should never be page state — if it somehow is, no
    // analytics request goes out and the operator is told why.
    if (isEmptyExplicitRange(selectedPeriod)) {
      setDetailError(`${row.title}: начало периода должно быть раньше его окончания.`);
      return;
    }
    setPrintingRow(row.key);
    setDetailError("");
    // Opened BEFORE the await, while the click's user activation is still live, so
    // the dedicated print tab is never treated as a blocked popup and the user
    // sees its waiting document immediately instead of a blank tab. It is closed
    // again on failure, so a failed request never leaves a print surface that
    // could look like a successful (empty) report.
    const surface = openPrintSurface();
    try {
      const { data } = await reportsService.getZReportDetail({
        ...reportParams,
        dimension: row.dimension,
        ids,
      });
      if (!data || typeof data !== "object" || !Array.isArray(data.entities) || data.entities.length === 0) {
        throw new Error("Invalid Z-report detail response");
      }
      renderPrintSurface(surface, buildZReportDetailPrintDocument({
        detail: data,
        periodTerm: printPeriod.term,
        periodLabel: printPeriod.label,
        waiterPercent: selection.waiterPercent,
      }));
    } catch (err) {
      closePrintSurface(surface);
      if (!isAbortError(err)) {
        const detail = err.response?.data?.detail;
        setDetailError(err.response?.status === 403
          ? `${row.title}: доступ запрещён.`
          : `${row.title}: ${typeof detail === "string" && detail.trim() ? detail : "не удалось получить данные для печати."}`);
      }
    } finally {
      setPrintingRow("");
    }
  }

  return (
    <section className="owner-reports-page owner-reports-page--generator">
      <header className="owner-reports__head">
        <h1 className="owner-reports__title">Z-отчёт</h1>
        <div className="owner-reports__head-actions">
          <ReportDateRangePicker
            variant="canonical"
            animateExit
            value={selectedPeriod}
            onChange={setSelectedPeriod}
            validateRange={validateZReportPeriod}
            buttonAriaLabel="Период Z-отчёта"
          />
        </div>
      </header>

      {detailError ? (
        <div className="owner-reports__note owner-reports__note--error" role="alert">Печать не выполнена — {detailError}</div>
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
                {row.dimension ? (
                  <button
                    className="owner-report-row__print"
                    type="button"
                    onClick={() => handleDetailPrint(row)}
                    disabled={selection[row.key].length === 0 || Boolean(printingRow)}
                    aria-disabled={selection[row.key].length === 0 || Boolean(printingRow) ? "true" : undefined}
                    aria-busy={printingRow === row.key ? "true" : undefined}
                    aria-label={`Печать: ${row.title}`}
                    title={selection[row.key].length === 0 ? "Выберите хотя бы одну позицию" : undefined}
                  >
                    <Icon name="bi-printer" size={16} /> Печать
                  </button>
                ) : (
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
                )}
              </div>
            </div>
          );
        })}
        </div>
      </section>
    </section>
  );
}

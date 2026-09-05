// Общие помощники периода для страниц отчётов владельца.
// Единый источник диапазона по умолчанию и конверсии даты для API,
// чтобы страницы отчётов не дублировали одну и ту же логику периода.

// Диапазон "текущий месяц" в формате пикера (DD.MM.YYYY, без пресета).
export function currentMonthRange() {
  const now = new Date();
  return {
    preset: "",
    start: `01.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`,
    end: `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`,
  };
}

// Преобразует дату пикера DD.MM.YYYY в формат API YYYY-MM-DD.
export function toApiDate(value) {
  if (!value) return undefined;
  const [day, month, year] = value.split(".");
  return `${year}-${month}-${day}`;
}

// --- ZR-TIME-01: the ONE Z-report period contract on the client ---------------
// Every Z-report request — per-entity detail for cashier, waiter and place, and
// the printed head that names the window — goes through the helpers below, so the
// period the user sees and the period the backend aggregates cannot drift apart.
//
// TWO MODES, deliberately distinguishable:
//   * DATE-ONLY (default): the picker's time state is still untouched, so the
//     request carries dates only and the backend applies its unchanged
//     calendar-day semantics. The default 00:00 must NEVER be sent as a real
//     boundary — that would turn a whole day into a zero-length window.
//   * EXPLICIT TIME: the user changed a start/end clock in the picker, which sets
//     `timeTouched`. Only then are time_from/time_to sent, and only then does the
//     printed head state clock times.

const DEFAULT_TIME = "00:00";

export function hasExplicitTimeRange(period = {}) {
  return Boolean(period?.timeTouched);
}

function periodTime(value) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : DEFAULT_TIME;
}

// Sortable "YYYY-MM-DDTHH:MM" for comparing the two boundaries without a Date.
function boundaryKey(date, time) {
  return `${toApiDate(date) || ""}T${periodTime(time)}`;
}

export function isEmptyExplicitRange(period = {}) {
  if (!hasExplicitTimeRange(period)) return false;
  return boundaryKey(period.start, period.startTime) >= boundaryKey(period.end, period.endTime);
}

// The request params for EVERY Z-report call. Date-only mode keeps the exact
// shape the backend has always received.
export function zReportPeriodParams(period = {}) {
  const from = toApiDate(period.start);
  const to = toApiDate(period.end);
  const single = !from || !to || from === to;
  const params = single ? { date: to || from } : { date_from: from, date_to: to };
  if (!hasExplicitTimeRange(period)) return params;
  return {
    ...params,
    time_from: periodTime(period.startTime),
    time_to: periodTime(period.endTime),
  };
}

// The printed head, truthful about which mode ran: clock times only when they
// were actually sent, a bare date (or date range) otherwise — never a fabricated
// «00:00 - 00:00» for a whole-day report.
export function zReportPrintPeriod(period = {}) {
  const start = period.start || "";
  const end = period.end || start;
  if (hasExplicitTimeRange(period)) {
    return {
      term: "Период",
      label: `${start} ${periodTime(period.startTime)} - ${end} ${periodTime(period.endTime)}`,
    };
  }
  return start && end && start !== end
    ? { term: "Период", label: `${start} - ${end}` }
    : { term: "Дата", label: start || end };
}

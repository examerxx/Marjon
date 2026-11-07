import { formatDateLabel, todayInputValue, toDateInputValue } from "../../utils/date";

// Работа с периодом выручки OWNER-дашборда: разбор/нормализация диапазона дат
// и человекочитаемые подписи. Вынесено из OwnerDashboard.jsx (FE-07B) без изменений логики.

export function inputDateToReportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatDateLabel(todayInputValue());
  }

  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export function reportDateToInputDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) {
    return todayInputValue();
  }

  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function reportRangeEndingAt(days, endValue) {
  const end = new Date(`${endValue}T00:00:00`);
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(1, days) + 1);

  return {
    preset: "",
    start: inputDateToReportDate(toDateInputValue(start)),
    end: inputDateToReportDate(toDateInputValue(end)),
    startTime: "00:00",
    endTime: "00:00",
  };
}

export function todayReportRange() {
  return {
    ...reportRangeEndingAt(1, todayInputValue()),
    preset: "Сегодня",
  };
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function shiftInputDate(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function presetRangeForDate(label, todayValue = todayInputValue()) {
  const today = new Date(`${todayValue}T00:00:00`);
  const end = todayValue;
  if (label === "Сегодня") return reportRangeEndingAt(1, end);
  if (label === "Вчера") return reportRangeEndingAt(1, shiftInputDate(end, -1));
  if (label === "Эта неделя") {
    const mondayOffset = (today.getDay() + 6) % 7;
    const start = shiftInputDate(end, -mondayOffset);
    return { ...reportRangeEndingAt(1, end), start: inputDateToReportDate(start), preset: label };
  }
  if (label === "Этот месяц") {
    const start = `${todayValue.slice(0, 8)}01`;
    return { ...reportRangeEndingAt(1, end), start: inputDateToReportDate(start), preset: label };
  }
  if (label === "Этот год") {
    const start = `${todayValue.slice(0, 4)}-01-01`;
    return { ...reportRangeEndingAt(1, end), start: inputDateToReportDate(start), preset: label };
  }
  return null;
}

function inferReportPreset(range) {
  const normalized = normalizeReportRange(range);
  return ["Сегодня", "Вчера", "Эта неделя", "Этот месяц", "Этот год"].find((label) => {
    const candidate = presetRangeForDate(label);
    return candidate?.start === normalized.start && candidate?.end === normalized.end;
  }) || "";
}

export function dashboardPeriodFromSearch(search = "") {
  const params = new URLSearchParams(search);
  const dateFrom = params.get("date_from");
  const dateTo = params.get("date_to");
  if (!dateFrom && !dateTo) return null;
  if (!isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo) || dateFrom > dateTo) return null;

  const range = normalizeReportRange({
    start: inputDateToReportDate(dateFrom),
    end: inputDateToReportDate(dateTo),
    startTime: params.get("time_from") || "00:00",
    endTime: params.get("time_to") || "00:00",
    timeTouched: params.has("time_from") || params.has("time_to"),
  });
  return { ...range, preset: inferReportPreset(range) };
}

export function normalizeReportRange(range = {}) {
  const startInput = reportDateToInputDate(range.start);
  const endInput = reportDateToInputDate(range.end);
  const [dateFrom, dateTo] = startInput <= endInput ? [startInput, endInput] : [endInput, startInput];

  return {
    preset: range.preset || "",
    start: inputDateToReportDate(dateFrom),
    end: inputDateToReportDate(dateTo),
    startTime: range.startTime || "00:00",
    endTime: range.endTime || "00:00",
    timeTouched: Boolean(range.timeTouched),
  };
}

export function reportRangeToApiParams(range) {
  const normalized = normalizeReportRange(range);
  const hasTime = normalized.timeTouched || normalized.startTime !== "00:00" || normalized.endTime !== "00:00";
  return {
    date_from: reportDateToInputDate(normalized.start),
    date_to: reportDateToInputDate(normalized.end),
    ...(hasTime ? { time_from: normalized.startTime, time_to: normalized.endTime } : {}),
  };
}

export function reportRangeDays(range) {
  const normalized = normalizeReportRange(range);
  const start = new Date(`${reportDateToInputDate(normalized.start)}T00:00:00`);
  const end = new Date(`${reportDateToInputDate(normalized.end)}T00:00:00`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

export function reportRangeLabel(range) {
  const normalized = normalizeReportRange(range);
  if (normalized.start === normalized.end) {
    return normalized.start;
  }

  return `${normalized.start} - ${normalized.end}`;
}

export function formatDaysLabel(days) {
  const value = Math.max(1, Number(days) || 1);
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${value} день`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${value} дня`;
  }

  return `${value} дней`;
}

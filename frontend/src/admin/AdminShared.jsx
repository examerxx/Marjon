import { useEffect, useRef, useState } from "react";
import { webCalendarToday, webDayKey } from "../utils/webTime";

import Icon from '../components/Icon';
import { t } from "../i18n/t";

const STATUS_GREEN = ["Активна", "Активен", "Проведен", "Завершено", "В норме", "Включено", "ОК"];

const STATUS_VIOLET = ["Новый", "Новая", "Черновик"];

export function formatAdminMoney(value) {
  return Math.round(value).toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}

export function padDate(value) {
  return String(value).padStart(2, "0");
}

export function formatDate(date) {
  return `${padDate(date.getDate())}.${padDate(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function parseDate(value) {
  const [day, month, year] = value.split(".").map(Number);
  return new Date(year || 2026, (month || 1) - 1, day || 1);
}

function rangeLabel(range) {
  return range.start === range.end ? range.start : `${range.start} - ${range.end}`;
}

export function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} UZS`;
}

export function formatSignedFinanceAmount(value) {
  return `${value < 0 ? "- " : "+ "}${formatCurrency(Math.abs(value))}`;
}

export function presetRange(label) {
  const today = webCalendarToday();
  const start = new Date(today);
  const end = new Date(today);

  if (label === "Вчера") {
    start.setDate(today.getDate() - 1);
    end.setDate(today.getDate() - 1);
  } else if (label === "Эта неделя") {
    start.setDate(today.getDate() - 6);
  } else if (label === "Этот месяц") {
    start.setDate(1);
  } else if (label === "Прошлый месяц") {
    start.setMonth(today.getMonth() - 1, 1);
    end.setMonth(today.getMonth(), 0);
  } else if (label === "Этот квартал") {
    start.setMonth(Math.floor(today.getMonth() / 3) * 3, 1);
  } else if (label === "Прошлый квартал") {
    const quarterStart = Math.floor(today.getMonth() / 3) * 3;
    start.setMonth(quarterStart - 3, 1);
    end.setMonth(quarterStart, 0);
  } else if (label === "Этот год") {
    start.setMonth(0, 1);
  } else if (label === "Прошлый год") {
    start.setFullYear(today.getFullYear() - 1, 0, 1);
    end.setFullYear(today.getFullYear() - 1, 11, 31);
  }

  const range = { start: formatDate(start), end: formatDate(end), preset: label };
  return { ...range, label: label === "Сегодня" || label === "Вчера" ? label : rangeLabel(range) };
}

export function adminDateToInputValue(date) {
  const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${value.getFullYear()}-${padDate(value.getMonth() + 1)}-${padDate(value.getDate())}`;
}

export function adminTodayInputValue() {
  return webDayKey();
}

export function adminReportDateToInputDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return adminTodayInputValue();
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function adminInputDateToReportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return formatDate(webCalendarToday());
  }
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export function normalizeAdminReportRange(range = {}) {
  const startInput = adminReportDateToInputDate(range.start);
  const endInput = adminReportDateToInputDate(range.end);
  const [dateFrom, dateTo] = startInput <= endInput ? [startInput, endInput] : [endInput, startInput];
  return {
    preset: range.preset || "",
    start: adminInputDateToReportDate(dateFrom),
    end: adminInputDateToReportDate(dateTo),
    startTime: "00:00",
    endTime: "00:00",
  };
}

export function formatAdminDaysLabel(days) {
  const value = Math.max(1, Number(days) || 1);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${value} дня`;
  return `${value} дней`;
}

export function StatusBadge({ status }) {
  const key = STATUS_GREEN.includes(status) ? "green" : STATUS_VIOLET.includes(status) ? "violet" : "orange";
  return <span className={`admin-status admin-status--${key}`}>{status}</span>;
}

export function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export function getAdminFinanceLoadMessage(error) {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg || item?.message || String(item)).join("; ");
  }
  if (detail && typeof detail === "object") {
    return detail.message || JSON.stringify(detail);
  }
  return detail || "Не удалось загрузить финансовые данные.";
}

export function getPageList(current, total) {
  // Номера страниц с многоточиями: 1 … c-1 c c+1 … total
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const list = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const p of list) {
    if (p - prev > 1) result.push("…");
    result.push(p);
    prev = p;
  }
  return result;
}

export function keepWheelInsideScroller(event) {
  const scroller = event.currentTarget;
  const horizontalDelta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
  const verticalDelta = event.shiftKey ? 0 : event.deltaY;

  if (!horizontalDelta && !verticalDelta) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  scroller.scrollLeft += horizontalDelta;
  scroller.scrollTop += verticalDelta;
}

export function AdminPageSizeDropdown({ value, options, onChange }) {
  const dropdownRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutside(event) {
      if (!dropdownRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectOption(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div className={`admin-page-size ${open ? "is-open" : ""}`} ref={dropdownRef}>
      <button
        className="admin-page-size__button"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="admin-page-size__label">{t("admin.adminshared.strok")}</span>
        <strong>{value}</strong>
        <Icon name="bi-chevron-down" size={14} />
      </button>
      {open ? (
        <div className="admin-page-size__menu" role="listbox" aria-label={t("admin.adminshared.kolichestvo_strok")}>
          {options.map((option) => (
            <button
              className={`admin-page-size__option ${option === value ? "is-selected" : ""}`}
              type="button"
              role="option"
              aria-selected={option === value}
              key={option}
              onClick={() => selectOption(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const ADMIN_DASHBOARD_DATE_PRESET_LABELS = ["Сегодня", "Вчера", "Эта неделя", "Этот месяц", "Этот год"];

const ADMIN_DASHBOARD_DATE_SHORT_MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const ADMIN_DASHBOARD_DATE_FULL_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function buildAdminDashboardDateRange(preset) {
  const end = new Date(`${adminTodayInputValue()}T00:00:00`);
  const start = new Date(end);

  if (preset === "Вчера") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === "Эта неделя") {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  } else if (preset === "Этот месяц") {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  } else if (preset === "Этот год") {
    start.setMonth(0, 1);
    end.setMonth(11, 31);
  }

  return normalizeAdminReportRange({
    preset,
    start: adminInputDateToReportDate(adminDateToInputValue(start)),
    end: adminInputDateToReportDate(adminDateToInputValue(end)),
    startTime: "00:00",
    endTime: "00:00",
  });
}

export function formatAdminDashboardDateRangeButton(range) {
  const normalized = normalizeAdminReportRange(range);
  const start = new Date(`${adminReportDateToInputDate(normalized.start)}T00:00:00`);
  const end = new Date(`${adminReportDateToInputDate(normalized.end)}T00:00:00`);
  const startLabel = `${start.getDate()} ${ADMIN_DASHBOARD_DATE_SHORT_MONTHS[start.getMonth()]}`;
  const endLabel = `${end.getDate()} ${ADMIN_DASHBOARD_DATE_SHORT_MONTHS[end.getMonth()]}\u00a0${end.getFullYear()}`;

  if (normalized.start === normalized.end) {
    return `${end.getDate()} ${ADMIN_DASHBOARD_DATE_FULL_MONTHS[end.getMonth()]}\u00a0${end.getFullYear()}`;
  }

  return `${startLabel} - ${endLabel}`;
}

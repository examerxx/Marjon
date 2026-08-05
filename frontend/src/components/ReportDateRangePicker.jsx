import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

const datePresets = [
  "Сегодня",
  "Вчера",
  "Эта неделя",
  "Этот месяц",
  "Этот год",
];

const shortMonths = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const yearOptions = Array.from({ length: 13 }, (_, index) => 2020 + index);
const hourOptions = Array.from({ length: 24 }, (_, hour) => padDate(hour));
const minuteOptions = Array.from({ length: 60 }, (_, minute) => padDate(minute));

function padDate(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${padDate(date.getDate())}.${padDate(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function parseDate(value = "") {
  const [day, month, year] = value.split(".").map(Number);
  return new Date(year || 2026, (month || 1) - 1, day || 1);
}

function formatShortDate(value) {
  if (!value) {
    return "";
  }

  const date = parseDate(value);
  return `${date.getDate()} ${shortMonths[date.getMonth()]} ${date.getFullYear()}`;
}

function formatPeriodLabel(range = {}) {
  if (!range.start || !range.end) {
    return "Выберите дату";
  }

  return `${formatShortDate(range.start)} - ${formatShortDate(range.end)}`;
}

function withDefaultTimes(range = {}) {
  return {
    preset: range.preset || "",
    start: range.start || formatDate(new Date()),
    end: range.end || formatDate(new Date()),
    startTime: range.startTime || "00:00",
    endTime: range.endTime || "00:00",
  };
}

function startOfWeek(date) {
  const start = new Date(date);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  return start;
}

function calendarDays(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function presetRange(label) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);
  const end = new Date(today);

  if (label === "Вчера") {
    start.setDate(today.getDate() - 1);
    end.setDate(today.getDate() - 1);
  } else if (label === "Эта неделя") {
    const weekStart = startOfWeek(today);
    start.setTime(weekStart.getTime());
  } else if (label === "Этот месяц") {
    start.setDate(1);
  } else if (label === "Прошлый квартал") {
    const quarterStart = Math.floor(today.getMonth() / 3) * 3;
    start.setMonth(quarterStart - 3, 1);
    end.setMonth(quarterStart, 0);
  } else if (label === "Этот год") {
    start.setMonth(0, 1);
  }

  return {
    preset: label,
    start: formatDate(start),
    end: formatDate(end),
    startTime: "00:00",
    endTime: "00:00",
  };
}

function toDateInputText(range, key, showTime = true) {
  const current = withDefaultTimes(range);
  if (!showTime) {
    return current[key];
  }
  const time = current[`${key}Time`] || "00:00";
  return time === "00:00" ? current[key] : `${current[key]} ${time}`;
}

function fromDateInputText(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);

  if (!match) {
    return null;
  }

  const [, day, month, year, hour = "00", minute = "00"] = match;
  return {
    date: formatDate(new Date(Number(year), Number(month) - 1, Number(day))),
    time: `${padDate(hour)}:${minute}`,
  };
}

export default function ReportDateRangePicker({
  value,
  onChange,
  buttonClassName = "",
  showChevrons = false,
  showTime = true,
  labelPrefix = "",
  showDropdownIcon = false,
  presets = datePresets,
  formatButtonLabel,
  blockPageScrollOnWheel = false,
  openCalendarOnOpen = false,
  applyPresetOnSelect = false,
  showMenuOk = true,
  leadingIconName = "",
  leadingIconSize = 16,
  trailingIconName = "",
  trailingIconSize = 16,
}) {
  const rootRef = useRef(null);
  const hourListRef = useRef(null);
  const minuteListRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => withDefaultTimes(value));
  const [activePicker, setActivePicker] = useState(null);
  const activeDate = parseDate(draft[activePicker] || draft.start);
  const [calendarView, setCalendarView] = useState(() => new Date(activeDate.getFullYear(), activeDate.getMonth(), 1));

  useEffect(() => {
    if (open) {
      setDraft(withDefaultTimes(value));
      setActivePicker(openCalendarOnOpen ? "start" : null);
    }
  }, [open, value, openCalendarOnOpen]);

  useEffect(() => {
    if (!activePicker) {
      return;
    }

    const date = parseDate(draft[activePicker]);
    setCalendarView(new Date(date.getFullYear(), date.getMonth(), 1));
  }, [activePicker]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  function openPicker() {
    setDraft(withDefaultTimes(value));
    setOpen((current) => {
      const nextOpen = !current;
      if (!nextOpen) {
        setActivePicker(null);
      }
      return nextOpen;
    });
  }

  function applyDraft() {
    onChange(withDefaultTimes(draft));
    setActivePicker(null);
    setOpen(false);
  }

  function selectPreset(preset) {
    const option = typeof preset === "string" ? { label: preset } : preset;
    const nextRange = option.getRange ? option.getRange() : presetRange(option.value || option.label);
    const nextDraft = {
      ...withDefaultTimes(nextRange),
      preset: option.label,
    };
    setDraft(nextDraft);

    if (applyPresetOnSelect) {
      onChange(nextDraft);
      setActivePicker(null);
      setOpen(false);
    }
  }

  function updateDateTime(key, nextValue) {
    const parsed = fromDateInputText(nextValue);

    if (!parsed) {
      setDraft((current) => ({
        ...withDefaultTimes(current),
        preset: "",
        [key]: nextValue,
      }));
      return;
    }

    setDraft((current) => ({
      ...withDefaultTimes(current),
      preset: "",
      [key]: parsed.date,
      [`${key}Time`]: parsed.time,
    }));
  }

  function openDateTimePicker(key) {
    setActivePicker(key);
  }

  function updateCalendarYear(year) {
    setCalendarView(new Date(Number(year), calendarView.getMonth(), 1));
  }

  function updateCalendarMonth(month) {
    setCalendarView(new Date(calendarView.getFullYear(), Number(month), 1));
  }

  function selectCalendarDate(date) {
    if (!activePicker) {
      return;
    }

    setDraft((current) => ({
      ...withDefaultTimes(current),
      preset: "",
      [activePicker]: formatDate(date),
    }));
  }

  function updateActiveTime(time) {
    if (!activePicker) {
      return;
    }

    setDraft((current) => ({
      ...withDefaultTimes(current),
      preset: "",
      [`${activePicker}Time`]: time,
    }));
  }

  function selectHour(hour) {
    const [, minute = "00"] = activeTime.split(":");
    updateActiveTime(`${hour}:${minute}`);
  }

  function selectMinute(minute) {
    const [hour = "00"] = activeTime.split(":");
    updateActiveTime(`${hour}:${minute}`);
  }

  function selectToday() {
    if (!activePicker) {
      return;
    }

    const today = new Date();
    setCalendarView(new Date(today.getFullYear(), today.getMonth(), 1));
    setDraft((current) => ({
      ...withDefaultTimes(current),
      preset: "",
      [activePicker]: formatDate(today),
    }));
  }

  const selectedCalendarDate = activePicker ? formatDate(parseDate(draft[activePicker])) : "";
  const activeTime = activePicker ? draft[`${activePicker}Time`] || "00:00" : "00:00";
  const [activeHour = "00", activeMinute = "00"] = activeTime.split(":");

  useEffect(() => {
    if (!showTime || !activePicker) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      hourListRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "center" });
      minuteListRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "center" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activePicker, activeTime, showTime]);

  const presetOptions = presets.map((preset) => (typeof preset === "string" ? { label: preset } : preset));
  const periodLabel = formatButtonLabel ? formatButtonLabel(value) : formatPeriodLabel(value);
  const buttonClasses = ["report-period-button", buttonClassName].filter(Boolean).join(" ");
  const blockWheelScroll = blockPageScrollOnWheel
    ? (event) => {
      event.preventDefault();
      event.stopPropagation();
    }
    : undefined;

  return (
    <div className="report-period-picker" ref={rootRef}>
      <button className={buttonClasses} type="button" onClick={openPicker} aria-expanded={open}>
        {showChevrons ? <Icon name="bi-chevron-left" size={18} /> : null}
        {leadingIconName ? <Icon name={leadingIconName} size={leadingIconSize} /> : null}
        {labelPrefix ? (
          <>
            <span>{labelPrefix}</span>
            <strong>{periodLabel}</strong>
          </>
        ) : (
          <span>{periodLabel}</span>
        )}
        {showChevrons ? <Icon name="bi-chevron-right" size={18} /> : null}
        {showDropdownIcon ? <Icon name="bi-chevron-down" size={18} /> : null}
        {trailingIconName ? <Icon name={trailingIconName} size={trailingIconSize} /> : null}
      </button>
      {open ? (
        <div className="report-date-menu" onWheel={blockWheelScroll}>
          <div className="report-date-presets">
            {presetOptions.map((preset) => (
              <button className={draft.preset === preset.label ? "is-active" : ""} type="button" key={preset.value || preset.label} onClick={() => selectPreset(preset)}>
                {preset.label}
              </button>
            ))}
          </div>
          <div className="report-date-range">
            <input
              className="report-date-input"
              type="text"
              inputMode="numeric"
              value={toDateInputText(draft, "start", showTime)}
              onChange={(event) => updateDateTime("start", event.target.value)}
              onClick={() => openDateTimePicker("start")}
              onFocus={() => openDateTimePicker("start")}
              aria-label="Начало периода"
            />
            <span>-</span>
            <input
              className="report-date-input"
              type="text"
              inputMode="numeric"
              value={toDateInputText(draft, "end", showTime)}
              onChange={(event) => updateDateTime("end", event.target.value)}
              onClick={() => openDateTimePicker("end")}
              onFocus={() => openDateTimePicker("end")}
              aria-label="Конец периода"
            />
            {showMenuOk ? <button className="report-date-ok" type="button" onClick={applyDraft}>ОК</button> : null}
          </div>
          {activePicker ? (
            <div className={`report-date-calendar-popover report-date-calendar-popover--${activePicker}`}>
              <div className={`report-date-picker-body ${showTime ? "" : "report-date-picker-body--date-only"}`.trim()}>
                <div className="report-date-calendar-panel">
                  <div className="report-date-calendar-toolbar">
                    <button type="button" onClick={() => setCalendarView(new Date(calendarView.getFullYear(), calendarView.getMonth() - 1, 1))} aria-label="Предыдущий месяц">
                      <Icon name="bi-chevron-left" size={17} />
                    </button>
                    <select value={calendarView.getFullYear()} onChange={(event) => updateCalendarYear(event.target.value)} aria-label="Год">
                      {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
                    </select>
                    <select value={calendarView.getMonth()} onChange={(event) => updateCalendarMonth(event.target.value)} aria-label="Месяц">
                      {monthNames.map((month, index) => <option key={month} value={index}>{month}</option>)}
                    </select>
                    <button type="button" onClick={() => setCalendarView(new Date(calendarView.getFullYear(), calendarView.getMonth() + 1, 1))} aria-label="Следующий месяц">
                      <Icon name="bi-chevron-right" size={17} />
                    </button>
                  </div>
                  <div className="report-date-calendar-week">
                    {weekDays.map((day) => <span key={day}>{day}</span>)}
                  </div>
                  <div className="report-date-calendar-grid">
                    {calendarDays(calendarView).map((day) => {
                      const formatted = formatDate(day);
                      return (
                        <button
                          className={`${day.getMonth() === calendarView.getMonth() ? "" : "is-muted"} ${formatted === selectedCalendarDate ? "is-selected" : ""}`}
                          type="button"
                          key={formatted}
                          onClick={() => selectCalendarDate(day)}
                        >
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="report-date-time-panel">
                  <div className="report-date-time-title">
                    <Icon name="bi-clock" size={18} />
                    <span>Время</span>
                  </div>
                  <div className="report-date-time-columns">
                    <div className="report-date-time-column">
                      <span className="report-date-time-column-label">Часы</span>
                      <div className="report-date-time-list" ref={hourListRef}>
                        {hourOptions.map((hour) => (
                          <button
                            className={hour === activeHour ? "is-selected" : ""}
                            data-active={hour === activeHour ? "true" : undefined}
                            type="button"
                            key={hour}
                            onClick={() => selectHour(hour)}
                          >
                            {hour}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="report-date-time-column">
                      <span className="report-date-time-column-label">Минуты</span>
                      <div className="report-date-time-list" ref={minuteListRef}>
                        {minuteOptions.map((minute) => (
                          <button
                            className={minute === activeMinute ? "is-selected" : ""}
                            data-active={minute === activeMinute ? "true" : undefined}
                            type="button"
                            key={minute}
                            onClick={() => selectMinute(minute)}
                          >
                            {minute}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="report-date-calendar-footer">
                <button className="report-date-today-button" type="button" onClick={selectToday}>
                  <Icon name="bi-calendar3" size={17} />
                  <span>Сегодня</span>
                </button>
                <button className="report-date-calendar-ok" type="button" onClick={applyDraft}>ОК</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

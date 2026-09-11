import { useEffect, useId, useRef, useState } from "react";
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
const calendarYearSelectOptions = yearOptions.map((year) => ({ value: year, label: String(year) }));
const calendarMonthSelectOptions = monthNames.map((month, index) => ({ value: index, label: month }));
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
    // ZR-TIME-01: the 00:00 defaults above are a DISPLAY state, not a chosen
    // boundary. `timeTouched` records that the operator actually changed a clock,
    // which is the only thing that may turn a whole-day report into an explicit
    // time window downstream. Carried through every draft update and committed
    // with the range, so reopening the picker does not forget it.
    timeTouched: Boolean(range.timeTouched),
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

// Screen-only display contract (ZR-PRINT-FINAL-UX-05): a time-bearing input
// always reads «DD.MM.YYYY | HH:MM» — one visible separator with balanced
// spacing. The selected HH:MM is shown even at 00:00, because it is the real
// UI state; it never reaches the API (the canonical detail contract is
// date-only), and it is never printed as an accounting interval.
function toDateInputText(range, key, showTime = true) {
  const current = withDefaultTimes(range);
  if (!showTime) {
    return current[key];
  }
  return `${current[key]} | ${current[`${key}Time`] || "00:00"}`;
}

function fromDateInputText(value) {
  const trimmed = value.trim().replace(/\s*\|\s*/, " ");
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

// ZR-PERIOD-01B: current-period presets share ONE canonical rule —
// start-of-period → TODAY, never a future calendar date. "Эта неделя" and
// "Этот год" already resolved that way through presetRange(); the previous
// canonicalCurrentMonthRange() override made only "Этот месяц" run to the
// month's future end, which was inconsistent (and, for a report, implied a
// wider period than the data covers). Month now falls through to the same
// shared helper, matching each report page's own default (currentMonthRange).
const canonicalDatePresets = [
  "Сегодня",
  "Вчера",
  "Эта неделя",
  "Этот месяц",
  "Этот год",
];

export function formatCanonicalReportPeriodLabel(range = {}) {
  if (!range.start || !range.end) return "Выберите дату";
  return range.start === range.end ? range.start : `${range.start} – ${range.end}`;
}

function strictPickerDate(value) {
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value || "")) return null;
  const [day, month, year] = value.split(".").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function validateCanonicalReportPeriod(range = {}) {
  const start = strictPickerDate(range.start);
  const end = strictPickerDate(range.end);
  if (!start || !end) return "Введите даты в формате ДД.ММ.ГГГГ";
  if (start > end) return "Дата начала не может быть позже даты окончания";
  return "";
}

function CalendarToolbarSelect({
  label,
  value,
  options,
  open,
  onToggle,
  onSelect,
  buttonRef,
  listRef,
  onListKeyDown,
}) {
  const selectedOption = options.find((option) => String(option.value) === String(value));

  return (
    <div className={`report-date-calendar-select${open ? " is-open" : ""}`}>
      <button
        ref={buttonRef}
        className="report-date-calendar-select__trigger"
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{selectedOption?.label || value}</span>
        <Icon name="bi-chevron-down" size={13} />
      </button>
      {open ? (
        <div
          ref={listRef}
          className="report-date-calendar-select__menu"
          role="listbox"
          aria-label={label === "Год" ? "Выбор года" : "Выбор месяца"}
          onKeyDown={onListKeyDown}
        >
          {options.map((option) => {
            const selected = String(option.value) === String(value);
            return (
              <button
                className={`report-date-calendar-select__option${selected ? " is-selected" : ""}`}
                type="button"
                role="option"
                aria-selected={selected}
                data-value={option.value}
                key={option.value}
                onClick={() => onSelect(option.value)}
              >
                <span>{option.label}</span>
                {selected ? <Icon name="bi-check2" size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function ReportDateRangePicker({
  value,
  onChange,
  variant = "default",
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
  buttonAriaLabel = "",
  dateFieldLabels = null,
  validateRange,
  enableEscapeClose = false,
  restoreFocusOnApply = false,
  containTimeListScroll = false,
  exposeCalendarA11y = false,
  showRangeHighlight = false,
  collapseCalendarOnOk = false,
  useCustomCalendarSelects = false,
  animateExit = false,
  open: controlledOpen,
  onOpenChange,
  onExitComplete,
}) {
  const canonical = variant === "canonical";
  const effectiveButtonClassName = [canonical ? "owner-reports__period-button" : "", buttonClassName].filter(Boolean).join(" ");
  const effectiveShowTime = canonical || showTime;
  const effectiveShowDropdownIcon = canonical ? false : showDropdownIcon;
  const effectivePresets = canonical ? canonicalDatePresets : presets;
  const effectiveFormatButtonLabel = canonical ? formatCanonicalReportPeriodLabel : formatButtonLabel;
  const effectiveBlockPageScrollOnWheel = canonical || blockPageScrollOnWheel;
  const effectiveTrailingIconName = canonical ? "bi-calendar3" : trailingIconName;
  const effectiveTrailingIconSize = canonical ? 16 : trailingIconSize;
  const effectiveDateFieldLabels = canonical ? { start: "Дата с", end: "Дата по" } : dateFieldLabels;
  const effectiveValidateRange = validateRange || (canonical ? validateCanonicalReportPeriod : undefined);
  const effectiveEnableEscapeClose = canonical || enableEscapeClose;
  const effectiveRestoreFocusOnApply = canonical || restoreFocusOnApply;
  const effectiveContainTimeListScroll = canonical || containTimeListScroll;
  const effectiveExposeCalendarA11y = canonical || exposeCalendarA11y;
  const effectiveShowRangeHighlight = canonical || showRangeHighlight;
  const effectiveCollapseCalendarOnOk = canonical || collapseCalendarOnOk;
  const effectiveUseCustomCalendarSelects = canonical || useCustomCalendarSelects;
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuOkRef = useRef(null);
  const menuId = useId();
  const hourListRef = useRef(null);
  const minuteListRef = useRef(null);
  const calendarToolbarRef = useRef(null);
  const yearSelectButtonRef = useRef(null);
  const monthSelectButtonRef = useRef(null);
  const yearSelectListRef = useRef(null);
  const monthSelectListRef = useRef(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;
  const setOpen = (nextOpen) => {
    const resolved = typeof nextOpen === "function" ? nextOpen(open) : nextOpen;
    if (!controlled) setInternalOpen(resolved);
    onOpenChange?.(resolved);
  };
  const [draft, setDraft] = useState(() => withDefaultTimes(value));
  const [activePicker, setActivePicker] = useState(null);
  const [validationError, setValidationError] = useState("");
  const [openCalendarSelect, setOpenCalendarSelect] = useState(null);
  const activeDate = parseDate(draft[activePicker] || draft.start);
  const [calendarView, setCalendarView] = useState(() => new Date(activeDate.getFullYear(), activeDate.getMonth(), 1));

  useEffect(() => {
    if (open) {
      setDraft(withDefaultTimes(value));
      setActivePicker(openCalendarOnOpen ? "start" : null);
      setValidationError("");
      setOpenCalendarSelect(null);
    }
  }, [open, value, openCalendarOnOpen]);

  useEffect(() => {
    if (!activePicker) {
      return;
    }

    const date = parseDate(draft[activePicker]);
    setCalendarView(new Date(date.getFullYear(), date.getMonth(), 1));
    setOpenCalendarSelect(null);
  }, [activePicker]);

  useEffect(() => {
    if (!openCalendarSelect) return undefined;

    function closeCalendarSelectOnOutside(event) {
      if (!calendarToolbarRef.current?.contains(event.target)) {
        setOpenCalendarSelect(null);
      }
    }

    document.addEventListener("mousedown", closeCalendarSelectOnOutside);
    return () => document.removeEventListener("mousedown", closeCalendarSelectOnOutside);
  }, [openCalendarSelect]);

  useEffect(() => {
    if (!openCalendarSelect) return undefined;

    const frame = window.requestAnimationFrame(() => {
      const list = openCalendarSelect === "year" ? yearSelectListRef.current : monthSelectListRef.current;
      const selected = list?.querySelector('[aria-selected="true"]');
      if (!list || !selected) return;
      list.scrollTop = selected.offsetTop - (list.clientHeight - selected.offsetHeight) / 2;
      selected.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [openCalendarSelect]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setActivePicker(null);
        setValidationError("");
        setOpenCalendarSelect(null);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open || !effectiveEnableEscapeClose) {
      return undefined;
    }

    function closeOnEscape(event) {
      if (event.key !== "Escape") {
        return;
      }
      setOpen(false);
      setActivePicker(null);
      setValidationError("");
      setOpenCalendarSelect(null);
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [effectiveEnableEscapeClose, open]);

  // Opt-in exit animation (REPORT-03, Orders report). `open` keeps owning every
  // behaviour — the outside-click, Escape and focus effects above are untouched;
  // this only keeps the panel in the DOM while its close animation plays and then
  // drops it, so a closing panel is visible instead of vanishing in one frame.
  // Default OFF, so every other caller (Z-report, HQ dashboards, finance) still
  // unmounts on close exactly as before.
  const [menuWasOpen, setMenuWasOpen] = useState(open);
  const [menuClosing, setMenuClosing] = useState(false);
  const menuOpenRef = useRef(open);
  if (animateExit && open !== menuOpenRef.current) {
    menuOpenRef.current = open;
    if (open) {
      if (!menuWasOpen) setMenuWasOpen(true);
      if (menuClosing) setMenuClosing(false);
    } else if (menuWasOpen && !menuClosing) {
      setMenuClosing(true);
    }
  }
  const menuMounted = animateExit ? (open || menuClosing) : open;
  const handleMenuAnimationEnd = (event) => {
    if (menuClosing && event.target === event.currentTarget) {
      setMenuClosing(false);
      setMenuWasOpen(false);
      onExitComplete?.();
    }
  };

  function openPicker() {
    setDraft(withDefaultTimes(value));
    setValidationError("");
    setOpen((current) => {
      const nextOpen = !current;
      if (!nextOpen) {
        setActivePicker(null);
        setOpenCalendarSelect(null);
      }
      return nextOpen;
    });
  }

  function applyDraft() {
    const nextRange = withDefaultTimes(draft);
    const nextError = effectiveValidateRange?.(nextRange) || "";
    if (nextError) {
      setValidationError(nextError);
      return;
    }

    onChange(nextRange);
    setActivePicker(null);
    setOpen(false);
    setValidationError("");
    setOpenCalendarSelect(null);
    if (effectiveRestoreFocusOnApply) {
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }

  function handleCalendarOk() {
    if (!effectiveCollapseCalendarOnOk) {
      applyDraft();
      return;
    }

    setActivePicker(null);
    setValidationError("");
    setOpenCalendarSelect(null);
    window.requestAnimationFrame(() => menuOkRef.current?.focus());
  }

  function selectPreset(preset) {
    const option = typeof preset === "string" ? { label: preset } : preset;
    const nextRange = option.getRange ? option.getRange() : presetRange(option.value || option.label);
    const nextDraft = {
      ...withDefaultTimes(nextRange),
      preset: option.label,
      // a preset is a DATE range: it resets both clocks to 00:00, so it also
      // resets them to "not chosen" (ZR-TIME-01)
      timeTouched: false,
    };
    setDraft(nextDraft);
    setValidationError("");

    if (applyPresetOnSelect) {
      onChange(nextDraft);
      setActivePicker(null);
      setOpen(false);
    }
  }

  function updateDateTime(key, nextValue) {
    setValidationError("");
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
      // typing a DIFFERENT clock into the field is an explicit time choice, the
      // same as picking one from the hour/minute lists
      timeTouched: Boolean(current?.timeTouched) || parsed.time !== (current?.[`${key}Time`] || "00:00"),
    }));
  }

  function openDateTimePicker(key) {
    setOpenCalendarSelect(null);
    setActivePicker(key);
  }

  function updateCalendarYear(year) {
    setCalendarView(new Date(Number(year), calendarView.getMonth(), 1));
  }

  function updateCalendarMonth(month) {
    setCalendarView(new Date(calendarView.getFullYear(), Number(month), 1));
  }

  function toggleCalendarSelect(kind) {
    setOpenCalendarSelect((current) => (current === kind ? null : kind));
  }

  function selectCalendarOption(kind, nextValue) {
    if (kind === "year") updateCalendarYear(nextValue);
    else updateCalendarMonth(nextValue);
    setOpenCalendarSelect(null);
    const triggerRef = kind === "year" ? yearSelectButtonRef : monthSelectButtonRef;
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleCalendarSelectKeyDown(event, kind) {
    if (["Enter", " "].includes(event.key) && document.activeElement?.getAttribute("role") === "option") {
      event.preventDefault();
      selectCalendarOption(kind, document.activeElement.dataset.value);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpenCalendarSelect(null);
      const triggerRef = kind === "year" ? yearSelectButtonRef : monthSelectButtonRef;
      window.requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    }

    if (event.key === "Tab") {
      setOpenCalendarSelect(null);
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const options = Array.from(event.currentTarget.querySelectorAll('[role="option"]'));
    const currentIndex = options.indexOf(document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else if (event.key === "ArrowDown") nextIndex = Math.min(options.length - 1, currentIndex + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - 1);
    options[nextIndex]?.focus();
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
      // ZR-TIME-01: only a CHANGED clock activates explicit time filtering, so
      // re-picking the value that is already selected cannot silently narrow a
      // whole-day report to a zero-length window.
      timeTouched: Boolean(current?.timeTouched) || time !== (current?.[`${activePicker}Time`] || "00:00"),
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
  const todayCalendarDate = formatDate(new Date());
  const draftStartDate = fromDateInputText(draft.start)?.date;
  const draftEndDate = fromDateInputText(draft.end)?.date;
  const draftStartTime = draftStartDate ? parseDate(draftStartDate).getTime() : Number.NaN;
  const draftEndTime = draftEndDate ? parseDate(draftEndDate).getTime() : Number.NaN;
  const activeTime = activePicker ? draft[`${activePicker}Time`] || "00:00" : "00:00";
  const [activeHour = "00", activeMinute = "00"] = activeTime.split(":");

  useEffect(() => {
    if (!effectiveShowTime || !activePicker) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      [hourListRef.current, minuteListRef.current].forEach((list) => {
        const activeOption = list?.querySelector('[data-active="true"]');
        if (!list || !activeOption) return;
        if (effectiveContainTimeListScroll) {
          list.scrollTop = activeOption.offsetTop - (list.clientHeight - activeOption.offsetHeight) / 2;
        } else {
          activeOption.scrollIntoView({ block: "center" });
        }
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activePicker, activeTime, effectiveContainTimeListScroll, effectiveShowTime]);

  const presetOptions = effectivePresets.map((preset) => (typeof preset === "string" ? { label: preset } : preset));
  const periodLabel = effectiveFormatButtonLabel ? effectiveFormatButtonLabel(value) : formatPeriodLabel(value);
  const buttonClasses = ["report-period-button", effectiveButtonClassName].filter(Boolean).join(" ");
  const blockWheelScroll = effectiveBlockPageScrollOnWheel
    ? (event) => {
      event.preventDefault();
      event.stopPropagation();
    }
    : undefined;
  const renderDateInput = (key, ariaLabel) => (
    <input
      className="report-date-input"
      type="text"
      inputMode="numeric"
      value={toDateInputText(draft, key, effectiveShowTime)}
      onChange={(event) => updateDateTime(key, event.target.value)}
      onClick={() => openDateTimePicker(key)}
      onFocus={() => openDateTimePicker(key)}
      aria-label={ariaLabel}
    />
  );

  const picker = (
    <div className="report-period-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        className={buttonClasses}
        type="button"
        onClick={openPicker}
        aria-expanded={open}
        aria-controls={effectiveExposeCalendarA11y && open ? menuId : undefined}
        aria-label={buttonAriaLabel || undefined}
      >
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
        {effectiveShowDropdownIcon ? <Icon name="bi-chevron-down" size={18} /> : null}
        {effectiveTrailingIconName ? <Icon name={effectiveTrailingIconName} size={effectiveTrailingIconSize} /> : null}
      </button>
      {menuMounted ? (
        <div
          className={`report-date-menu${effectiveShowTime ? "" : " report-date-menu--date-only"}${menuClosing ? " is-closing" : ""}`}
          id={effectiveExposeCalendarA11y ? menuId : undefined}
          onWheel={blockWheelScroll}
          onAnimationEnd={animateExit ? handleMenuAnimationEnd : undefined}
          aria-hidden={menuClosing ? true : undefined}
          {...(menuClosing ? { inert: true } : {})}
        >
          <div className="report-date-presets">
            {presetOptions.map((preset) => (
              <button className={draft.preset === preset.label ? "is-active" : ""} type="button" key={preset.value || preset.label} onClick={() => selectPreset(preset)}>
                {preset.label}
              </button>
            ))}
          </div>
          <div className={`report-date-range${effectiveDateFieldLabels ? " report-date-range--labeled" : ""}`}>
            {effectiveDateFieldLabels ? <label className={`report-date-field${activePicker === "start" ? " is-active" : ""}`}><span>{effectiveDateFieldLabels.start}</span>{renderDateInput("start", "Начало периода")}</label> : renderDateInput("start", "Начало периода")}
            <span>-</span>
            {effectiveDateFieldLabels ? <label className={`report-date-field${activePicker === "end" ? " is-active" : ""}`}><span>{effectiveDateFieldLabels.end}</span>{renderDateInput("end", "Конец периода")}</label> : renderDateInput("end", "Конец периода")}
            {showMenuOk ? <button ref={menuOkRef} className="report-date-ok" type="button" onClick={applyDraft}>ОК</button> : null}
          </div>
          {validationError ? <div className="report-date-error" role="alert">{validationError}</div> : null}
          {activePicker || effectiveCollapseCalendarOnOk ? (
            <div
              className={effectiveCollapseCalendarOnOk ? `report-date-calendar-shell${activePicker ? " is-expanded" : ""}` : undefined}
              style={effectiveCollapseCalendarOnOk ? undefined : { display: "contents" }}
              aria-hidden={effectiveCollapseCalendarOnOk && !activePicker ? true : undefined}
              {...(effectiveCollapseCalendarOnOk && !activePicker ? { inert: true } : {})}
            >
              <div
                className={effectiveCollapseCalendarOnOk ? "report-date-calendar-shell__inner" : undefined}
                style={effectiveCollapseCalendarOnOk ? undefined : { display: "contents" }}
              >
            <div className={`report-date-calendar-popover report-date-calendar-popover--${activePicker || "start"}`}>
              <div className={`report-date-picker-body ${effectiveShowTime ? "" : "report-date-picker-body--date-only"}`.trim()}>
                <div className="report-date-calendar-panel">
                  <div className="report-date-calendar-toolbar" ref={calendarToolbarRef}>
                    <button type="button" onClick={() => { setOpenCalendarSelect(null); setCalendarView(new Date(calendarView.getFullYear(), calendarView.getMonth() - 1, 1)); }} aria-label="Предыдущий месяц">
                      <Icon name="bi-chevron-left" size={17} />
                    </button>
                    {effectiveUseCustomCalendarSelects ? (
                      <CalendarToolbarSelect
                        label="Год"
                        value={calendarView.getFullYear()}
                        options={calendarYearSelectOptions}
                        open={openCalendarSelect === "year"}
                        onToggle={() => toggleCalendarSelect("year")}
                        onSelect={(nextValue) => selectCalendarOption("year", nextValue)}
                        buttonRef={yearSelectButtonRef}
                        listRef={yearSelectListRef}
                        onListKeyDown={(event) => handleCalendarSelectKeyDown(event, "year")}
                      />
                    ) : (
                      <select value={calendarView.getFullYear()} onChange={(event) => updateCalendarYear(event.target.value)} aria-label="Год">
                        {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
                      </select>
                    )}
                    {effectiveUseCustomCalendarSelects ? (
                      <CalendarToolbarSelect
                        label="Месяц"
                        value={calendarView.getMonth()}
                        options={calendarMonthSelectOptions}
                        open={openCalendarSelect === "month"}
                        onToggle={() => toggleCalendarSelect("month")}
                        onSelect={(nextValue) => selectCalendarOption("month", nextValue)}
                        buttonRef={monthSelectButtonRef}
                        listRef={monthSelectListRef}
                        onListKeyDown={(event) => handleCalendarSelectKeyDown(event, "month")}
                      />
                    ) : (
                      <select value={calendarView.getMonth()} onChange={(event) => updateCalendarMonth(event.target.value)} aria-label="Месяц">
                        {monthNames.map((month, index) => <option key={month} value={index}>{month}</option>)}
                      </select>
                    )}
                    <button type="button" onClick={() => { setOpenCalendarSelect(null); setCalendarView(new Date(calendarView.getFullYear(), calendarView.getMonth() + 1, 1)); }} aria-label="Следующий месяц">
                      <Icon name="bi-chevron-right" size={17} />
                    </button>
                  </div>
                  <div className="report-date-calendar-week">
                    {weekDays.map((day) => <span key={day}>{day}</span>)}
                  </div>
                  <div className="report-date-calendar-grid">
                    {calendarDays(calendarView).map((day) => {
                      const formatted = formatDate(day);
                      const dayTime = day.getTime();
                       const isRangeStart = effectiveShowRangeHighlight && formatted === draftStartDate;
                       const isRangeEnd = effectiveShowRangeHighlight && formatted === draftEndDate;
                      const isRangeBoundary = isRangeStart || isRangeEnd;
                       const isSelected = effectiveShowRangeHighlight ? isRangeBoundary : formatted === selectedCalendarDate;
                       const isInRange = effectiveShowRangeHighlight
                        && Number.isFinite(draftStartTime)
                        && Number.isFinite(draftEndTime)
                        && dayTime > draftStartTime
                        && dayTime < draftEndTime;
                      const isToday = formatted === todayCalendarDate;
                      const dayClasses = [
                        day.getMonth() === calendarView.getMonth() ? "" : "is-muted",
                        isInRange ? "is-in-range" : "",
                        isRangeStart ? "is-range-start" : "",
                        isRangeEnd ? "is-range-end" : "",
                        isToday ? "is-today" : "",
                        isSelected ? "is-selected" : "",
                      ].filter(Boolean).join(" ");
                      return (
                        <button
                          className={dayClasses}
                          type="button"
                          key={formatted}
                          onClick={() => selectCalendarDate(day)}
                           aria-label={effectiveExposeCalendarA11y ? formatted : undefined}
                           aria-pressed={effectiveExposeCalendarA11y ? isSelected : undefined}
                           aria-current={effectiveExposeCalendarA11y && isToday ? "date" : undefined}
                        >
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {effectiveShowTime ? <div className="report-date-time-panel">
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
                </div> : null}
              </div>
              <div className="report-date-calendar-footer">
                <button className="report-date-today-button" type="button" onClick={selectToday}>
                  <Icon name="bi-calendar3" size={17} />
                  <span>Сегодня</span>
                </button>
                <button className="report-date-calendar-ok" type="button" onClick={handleCalendarOk}>ОК</button>
              </div>
            </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return canonical ? <div className="owner-reports__period report-actions">{picker}</div> : picker;
}

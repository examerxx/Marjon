import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { todayInputValue } from "../utils/date";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function parseValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return new Date();
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function buildGrid(viewYear, viewMonth) {
  const first = new Date(viewYear, viewMonth, 1);
  // Monday-first offset (JS getDay: 0=Sun..6=Sat)
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(viewYear, viewMonth, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return date;
  });
}

export default function DatePicker({ value, max, onChange, onClear }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => parseValue(value));
  const [showMonthList, setShowMonthList] = useState(false);
  const wrapRef = useRef(null);
  const popoverRef = useRef(null);
  const [dropUp, setDropUp] = useState(false);

  const today = useMemo(() => parseValue(todayInputValue()), []);
  const selected = useMemo(() => parseValue(value), [value]);
  const maxDate = useMemo(() => (max ? parseValue(max) : null), [max]);

  const viewYear = view.getFullYear();
  const viewMonth = view.getMonth();
  const grid = useMemo(() => buildGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  useEffect(() => {
    if (open) setView(parseValue(value));
  }, [open, value]);

  useEffect(() => {
    function onDocClick(event) {
      if (!wrapRef.current?.contains(event.target)) {
        setOpen(false);
        setShowMonthList(false);
      }
    }
    function onKey(event) {
      if (event.key === "Escape") {
        setOpen(false);
        setShowMonthList(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onDocClick);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
    setDropUp(rect.bottom > window.innerHeight - 12);
  }, [open]);

  function isDisabled(date) {
    return maxDate ? date > maxDate : false;
  }

  function pick(date) {
    if (isDisabled(date)) return;
    onChange?.(toValue(date));
    setOpen(false);
    setShowMonthList(false);
  }

  function stepMonth(delta) {
    setView(new Date(viewYear, viewMonth + delta, 1));
  }

  function goToday() {
    if (maxDate && today > maxDate) return;
    onChange?.(toValue(today));
    setView(new Date(today));
    setOpen(false);
  }

  const label = `${String(selected.getDate()).padStart(2, "0")}.${String(selected.getMonth() + 1).padStart(2, "0")}.${selected.getFullYear()}`;

  return (
    <div className={`mj-datepicker ${open ? "is-open" : ""}`} ref={wrapRef}>
      <button
        type="button"
        className="mj-datepicker__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="mj-datepicker__icon"><i className="bi bi-calendar3" /></span>
        <span className="mj-datepicker__value">{label}</span>
        <i className={`bi bi-chevron-${open ? "up" : "down"} mj-datepicker__caret`} aria-hidden="true" />
      </button>

      {open ? (
        <div
          className={`mj-calendar ${dropUp ? "is-dropup" : ""}`}
          role="dialog"
          aria-label="Выбор даты"
          ref={popoverRef}
        >
          <div className="mj-calendar__header">
            <button
              type="button"
              className="mj-calendar__title"
              onClick={() => setShowMonthList((s) => !s)}
              aria-expanded={showMonthList}
            >
              <strong>{MONTHS[viewMonth]}</strong>
              <span>{viewYear}</span>
              <i className={`bi bi-caret-${showMonthList ? "up" : "down"}-fill`} aria-hidden="true" />
            </button>
            <div className="mj-calendar__nav">
              <button type="button" onClick={() => stepMonth(-1)} aria-label="Предыдущий месяц">
                <i className="bi bi-chevron-left" />
              </button>
              <button type="button" onClick={() => stepMonth(1)} aria-label="Следующий месяц">
                <i className="bi bi-chevron-right" />
              </button>
            </div>
          </div>

          {showMonthList ? (
            <div className="mj-calendar__months">
              <div className="mj-calendar__year-switch">
                <button type="button" onClick={() => setView(new Date(viewYear - 1, viewMonth, 1))} aria-label="Прошлый год">
                  <i className="bi bi-chevron-left" />
                </button>
                <strong>{viewYear}</strong>
                <button type="button" onClick={() => setView(new Date(viewYear + 1, viewMonth, 1))} aria-label="Следующий год">
                  <i className="bi bi-chevron-right" />
                </button>
              </div>
              <div className="mj-calendar__months-grid">
                {MONTHS.map((name, idx) => (
                  <button
                    type="button"
                    key={name}
                    className={idx === viewMonth ? "is-current" : ""}
                    onClick={() => {
                      setView(new Date(viewYear, idx, 1));
                      setShowMonthList(false);
                    }}
                  >
                    {name.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="mj-calendar__weekdays">
                {WEEKDAYS.map((day, i) => (
                  <span key={day} className={i >= 5 ? "is-weekend" : ""}>{day}</span>
                ))}
              </div>
              <div className="mj-calendar__grid">
                {grid.map((date) => {
                  const outside = date.getMonth() !== viewMonth;
                  const disabled = isDisabled(date);
                  const isToday = sameDay(date, today);
                  const isSelected = sameDay(date, selected);
                  const weekend = (date.getDay() + 6) % 7 >= 5;
                  return (
                    <button
                      type="button"
                      key={toValue(date)}
                      className={[
                        "mj-calendar__day",
                        outside ? "is-outside" : "",
                        disabled ? "is-disabled" : "",
                        isToday ? "is-today" : "",
                        isSelected ? "is-selected" : "",
                        weekend ? "is-weekend" : "",
                      ].join(" ").trim()}
                      disabled={disabled}
                      onClick={() => pick(date)}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="mj-calendar__footer">
            {onClear ? (
              <button type="button" className="mj-calendar__action mj-calendar__action--ghost" onClick={() => { onClear(); setOpen(false); }}>
                Удалить
              </button>
            ) : <span />}
            <button type="button" className="mj-calendar__action mj-calendar__action--accent" onClick={goToday}>
              Сегодня
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayInputValue() {
  return toDateInputValue(new Date());
}

export function clampToToday(value) {
  const today = todayInputValue();
  return value > today ? today : value;
}

export function formatDateLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }

  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

export function dateRangeEndingAt(days, endValue) {
  const end = new Date(`${endValue}T00:00:00`);
  const start = new Date(end);
  start.setDate(end.getDate() - days + 1);
  return { date_from: toDateInputValue(start), date_to: toDateInputValue(end) };
}

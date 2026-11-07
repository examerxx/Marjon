import { webDayKey } from "../../utils/webTime";

export function checkedTransactions(response) {
  const items = response?.data?.items;
  if (!Array.isArray(items) || items.some(row =>
    !["income", "expense"].includes(row.direction)
    || row.amount == null || !Number.isFinite(Number(row.amount)) || Number(row.amount) < 0
    || !webDayKey(row.date))) throw new Error("Invalid transactions");
  return items;
}

export function previousDay(value) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function overviewRangeFromSearch(search, fallback) {
  const params = new URLSearchParams(search);
  const start = params.get("date_from"), end = params.get("date_to");
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "")
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end) || start > end) return fallback;
  const display = value => value.split("-").reverse().join(".");
  return { ...fallback, preset: "", start: display(start), end: display(end) };
}

const cents = row => Math.round(Number(row.amount) * 100);
export function transactionTotals(rows) {
  const result = rows.reduce((sum, row) => {
    sum[row.direction] += cents(row);
    return sum;
  }, { income: 0, expense: 0 });
  return { income: result.income / 100, expense: result.expense / 100,
    net: (result.income - result.expense) / 100 };
}

export function expenseGroups(rows, categories, fallback, direction = "expense") {
  const names = new Map(categories.map(row => [String(row.id), row.name]));
  const groups = new Map();
  rows.filter(row => row.direction === direction).forEach(row => {
    const key = String(row.category_id || "");
    const current = groups.get(key) || { key, name: names.get(key) || fallback, cents: 0 };
    current.cents += cents(row);
    groups.set(key, current);
  });
  return [...groups.values()].map(row => ({ ...row, amount: row.cents / 100 }))
    .sort((a, b) => b.amount - a.amount);
}

export function paymentBalances(rows, paymentTypes, fallback) {
  const names = new Map(paymentTypes.map(row => [String(row.id), row.name]));
  const groups = new Map();
  rows.forEach(row => {
    const key = String(row.payment_type_id || "");
    const item = groups.get(key) || { key, name: names.get(key) || fallback, cents: 0 };
    item.cents += cents(row) * (row.direction === "income" ? 1 : -1);
    groups.set(key, item);
  });
  return [...groups.values()].map(row => ({ ...row, amount: row.cents / 100 }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

export function dailyMovement(rows, start, end) {
  const days = new Map();
  const cursor = new Date(`${start}T12:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= end) {
    const key = cursor.toISOString().slice(0, 10);
    days.set(key, { date: key, income: 0, expense: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  rows.forEach(row => {
    const bucket = days.get(webDayKey(row.date));
    if (bucket) bucket[row.direction] += cents(row);
  });
  return [...days.values()].map(row => ({ ...row, income: row.income / 100, expense: row.expense / 100 }));
}

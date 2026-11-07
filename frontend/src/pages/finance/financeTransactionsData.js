// Чистые помощники данных для страницы финансовых транзакций:
// разбор/форматирование сумм и дат + отображение ответа API в модель строки.

import { webCalendarToday, webDateTime } from "../../utils/webTime";

export const emptyForm = {
  type: "income",
  amount: "",
  paymentTypeId: "",
  counterpartyId: "",
  categoryId: "",
  financeTemplateId: "",
  comment: "",
  operationDateTime: "",
};

export function currentMonthRange() {
  const now = webCalendarToday();
  return {
    preset: "Этот месяц",
    start: `01.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`,
    end: `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`,
    startTime: "",
    endTime: "",
  };
}

export function toApiDate(value) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [day, month, year] = value.split(".");
  return `${year}-${month}-${day}`;
}

export function parseAmount(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

export function formatMoney(value) {
  return `${new Intl.NumberFormat("ru-RU").format(Number(value))} UZS`;
}

export function formatDate(value) {
  if (!value) return "—";
  return webDateTime(value) || String(value);
}

export function itemsOf(response) {
  const data = response?.data;
  return Array.isArray(data) ? data : data?.items || [];
}

function labelFor(id, labels) {
  if (!id) return "—";
  return labels.get(String(id)) || "Недоступно";
}

export function mapTransactions(items, paymentTypes, categories, counterparties) {
  const paymentLabels = new Map(paymentTypes.map((item) => [String(item.id), item.name]));
  const categoryLabels = new Map(categories.map((item) => [String(item.id), item.name]));
  const counterpartyLabels = new Map(counterparties.map((item) => [String(item.id), item.full_name]));
  return items.map((tx) => ({
    id: String(tx.id),
    date: tx.date,
    createdAt: tx.created_at,
    amount: Number(tx.amount),
    type: tx.direction,
    paymentTypeId: tx.payment_type_id ? String(tx.payment_type_id) : "",
    counterpartyId: tx.counterparty_id ? String(tx.counterparty_id) : "",
    categoryId: tx.category_id ? String(tx.category_id) : "",
    financeTemplateId: tx.finance_template_id ? String(tx.finance_template_id) : "",
    paymentType: labelFor(tx.payment_type_id, paymentLabels),
    counterparty: labelFor(tx.counterparty_id, counterpartyLabels),
    category: labelFor(tx.category_id, categoryLabels),
    comment: tx.comment ?? "",
  }));
}

// Долги клиентов и их погашение (веб-панель владельца).
//
// Как устроено на сервере:
// • кассир закрывает счёт «в долг» → баланс клиента (контрагент типа client) растёт на неоплаченную часть;
// • погашение — это приход на клиента в категории «Возврат долга»; список /finance/counterparties
//   отдаёт баланс уже за вычетом таких погашений, т.е. текущий долг.
// Погашение не привязано к конкретному счёту, поэтому остаток по счетам считаем здесь: погашения
// закрывают счета от старых к новым, а непогашенный остаток «сидит» на самых новых.
import { financeService } from "../../../api/finance";
import { webFormat } from "../../../utils/webTime";

export const REPAYMENT_CATEGORY_NAME = "Возврат долга";

const normalizeName = (value) => String(value || "").trim().toLowerCase();
const itemsOf = (response) => (Array.isArray(response?.data) ? response.data : response?.data?.items || []);

export function toDebtNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function formatDebt(value) {
  return `${Math.round(toDebtNumber(value)).toLocaleString("ru-RU")} сум`;
}

// Текущий долг каждого клиента: Map<id, сумма>. Отрицательный баланс (переплата) — тоже как есть.
export async function loadClientDebts({ signal } = {}) {
  const debts = new Map();
  for (let page = 1; page < 100; page += 1) {
    const response = await financeService.listCounterparties({ page, signal });
    const items = itemsOf(response);
    for (const item of items) {
      if (item?.type === "client") debts.set(String(item.id), toDebtNumber(item.balance));
    }
    const total = Number(response?.data?.total);
    if (Array.isArray(response?.data) || items.length < 200 || (Number.isFinite(total) && debts.size >= total)) break;
  }
  return debts;
}

// Категория «Возврат долга» (приход): находим по названию, а если её нет — создаём.
// Без неё сервер не узнает в приходе погашение, и долг клиента не уменьшится.
async function ensureCategory(name, kind) {
  const response = await financeService.listTransactionCategories(kind);
  const found = itemsOf(response).find((item) =>
    normalizeName(item.name) === normalizeName(name)
    && (!item.kind || item.kind === kind)
    && item.is_system !== true);
  if (found) return found;
  const created = await financeService.createTransactionCategory({ name, kind, status: true });
  return created.data;
}

export const ensureRepaymentCategory = () => ensureCategory(REPAYMENT_CATEGORY_NAME, "income");

// Оплата долга поставщику — расход в категории «Оплата поставщику»: отчёт «Дебиторы и кредиторы»
// узнаёт её по названию и уменьшает долг перед поставщиком (обычный расход его, наоборот, увеличивает).
export const SUPPLIER_PAYMENT_CATEGORY_NAME = "Оплата поставщику";
export const ensureSupplierPaymentCategory = () => ensureCategory(SUPPLIER_PAYMENT_CATEGORY_NAME, "expense");

// Комментарий погашения конкретного счёта: «Погашение по заказу № 2 от 16.11.2026».
// Номера заказов повторяются по дням, поэтому рядом с номером — дата закрытия заказа.
// (Ранние записи были с «(ID …)» — их тоже понимаем, но на экране ID не показываем.)
const orderDay = (order) => webFormat(order?.closed_at || order?.created_at, { day: "2-digit", month: "2-digit", year: "numeric" });

export function orderRepaymentComment(order) {
  const day = orderDay(order);
  return `Погашение по заказу № ${order?.order_number ?? ""}${day ? ` от ${day}` : ""}`;
}

export function parseOrderRepayment(comment) {
  const match = /по (?:заказу|приходу) №\s*([^\s,(]+)(?:\s*\(ID\s*(\d+)\))?(?:\s+от\s+(\d{2}\.\d{2}\.\d{4}))?/i.exec(String(comment || ""));
  return match ? { orderNumber: match[1], publicId: match[2] || null, day: match[3] || null } : null;
}

// Комментарий для показа: без технического «(ID …)».
export function displayRepaymentComment(comment) {
  return String(comment || "").replace(/\s*\(ID\s*\d+\)/gi, "").trim();
}

// Что осталось погасить по каждому счёту и чем он гасился.
// orders — счета клиента в долг (debt_amount — долг по счёту при закрытии);
// balance — текущий долг клиента (сервер уже вычел все погашения);
// repayments — погашения клиента (приходы в категории «Возврат долга»).
// Погашения идут по времени: погашение «по заказу» (кнопка у счёта) гасит свой счёт, остальное —
// счета от старых к новым (сначала те, что уже были закрыты в долг к моменту оплаты).
// Возвращает те же счета в исходном порядке с полями open_amount, repaid и history —
// список { id, date, amount, left, comment } — какие погашения (left — остаток после него) и на какую сумму закрыли этот счёт.
export function allocateDebtToOrders(orders, balance, repayments = [], options = {}) {
  const list = Array.isArray(orders) ? orders : [];
  const time = (value) => new Date(value || 0).getTime() || 0;
  const orderTime = (order) => time(order?.closed_at || order?.created_at);
  const open = list.map((order) => Math.max(0, toDebtNumber(order?.debt_amount)));
  const history = list.map(() => []);
  const totalDebt = open.reduce((sum, value) => sum + value, 0);
  let budget = Math.max(0, totalDebt - toDebtNumber(balance)); // сколько всего погашено по счетам
  const oldestFirst = list.map((order, i) => ({ order, i })).sort((a, b) => orderTime(a.order) - orderTime(b.order) || a.i - b.i);
  const pay = (i, item, amount) => {
    open[i] -= amount;
    budget -= amount;
    history[i].push({ payment_type_id: item?.payment_type_id, payment_type_name: item?.payment_type_name, id: item?.id, date: item?.date, amount, left: open[i], comment: displayRepaymentComment(item?.comment) });
  };

  const sorted = (Array.isArray(repayments) ? repayments : [])
    // Клиенты гасят приходом, поставщикам платим расходом — какое направление считать оплатой, задаёт options.direction.
    .filter((item) => (options.direction ? item?.direction === options.direction : item?.direction !== "expense") && toDebtNumber(item?.amount) > 0)
    .sort((a, b) => time(a?.date) - time(b?.date));
  for (const item of sorted) {
    if (budget <= 0) break;
    let left = Math.min(toDebtNumber(item.amount), budget);
    const target = parseOrderRepayment(item.comment);
    if (target) {
      let index = target.publicId ? list.findIndex((order) => String(order?.public_id) === target.publicId) : -1;
      if (index < 0) {
        // По номеру (и дате, если есть): из таких счетов — самый новый, по которому ещё есть долг.
        const candidates = list.map((order, i) => ({ order, i }))
          .filter(({ order, i }) => String(order?.order_number) === target.orderNumber && open[i] > 0
            && (!target.day || orderDay(order) === target.day))
          .sort((a, b) => orderTime(b.order) - orderTime(a.order));
        index = candidates.length ? candidates[0].i : -1;
      }
      if (index >= 0 && open[index] > 0) {
        const amount = Math.min(open[index], left);
        pay(index, item, amount);
        left -= amount;
      }
    }
    // остаток (или обычное погашение): сначала счета, закрытые в долг до оплаты, от старых к новым
    const paidAt = time(item.date);
    const queue = [
      ...oldestFirst.filter(({ order }) => orderTime(order) <= paidAt),
      ...oldestFirst.filter(({ order }) => orderTime(order) > paidAt),
    ];
    for (const { i } of queue) {
      if (left <= 0 || budget <= 0) break;
      if (open[i] <= 0) continue;
      const amount = Math.min(open[i], left);
      pay(i, item, amount);
      left -= amount;
    }
  }
  // Если по записям погашений набралось меньше, чем уменьшился долг (например, старые
  // погашения без категории), остаток долга всё равно сходится с балансом: от старых к новым.
  for (const { i } of oldestFirst) {
    if (budget <= 0) break;
    if (open[i] <= 0) continue;
    const amount = Math.min(open[i], budget);
    open[i] -= amount;
    budget -= amount;
  }
  return list.map((order, i) => ({ ...order, open_amount: open[i], repaid: open[i] <= 0, history: history[i] }));
}

// id категории «Возврат долга» (без создания) — чтобы отличать погашения от прочих приходов.
export async function findRepaymentCategoryId(name = REPAYMENT_CATEGORY_NAME, kind = "income") {
  const response = await financeService.listTransactionCategories(kind);
  const found = itemsOf(response).find((item) => normalizeName(item.name) === normalizeName(name));
  return found ? String(found.id) : null;
}

// Все погашения клиента за всё время (для раскладки по счетам).
export async function loadClientRepayments(clientId, { signal, categoryName = REPAYMENT_CATEGORY_NAME, kind = "income" } = {}) {
  const all = [];
  for (let page = 1; page < 50; page += 1) {
    const response = await financeService.listCounterpartyTransactions(clientId, { page, size: 200 });
    if (signal?.aborted) break;
    const items = itemsOf(response);
    all.push(...items);
    const pages = Number(response?.data?.pages || 1);
    if (!items.length || page >= pages) break;
  }
  const categoryId = await findRepaymentCategoryId(categoryName, kind).catch(() => null);
  return categoryId ? all.filter((item) => String(item?.category_id) === categoryId) : all;
}

// Тело запроса на погашение: приход на клиента в категории «Возврат долга».
export function repaymentPayload({ amount, clientId, categoryId, paymentTypeId, date, comment, direction = "income", defaultComment = "Погашение долга" }) {
  const payload = {
    amount,
    direction,
    counterparty_id: clientId,
    category_id: categoryId,
    comment: String(comment || "").trim() || defaultComment,
  };
  if (paymentTypeId) payload.payment_type_id = paymentTypeId;
  if (date) payload.date = date.toISOString();
  return payload;
}

// Комментарий оплаты конкретного прихода поставщика: «Оплата по приходу № 15 от 18.11.2026».
export function purchaseRepaymentComment(purchase) {
  const day = webFormat(purchase?.closed_at || purchase?.created_at, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `Оплата по приходу № ${purchase?.order_number ?? ""}${day ? ` от ${day}` : ""}`;
}

import { t } from "../../../i18n/t";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { financeService, resolveTransactionSubmission } from "../../../api/finance";
import FinanceTransactionDrawer from "../../finance/FinanceTransactionDrawer";
import { emptyForm, itemsOf, parseAmount } from "../../finance/financeTransactionsData";
import { allocateDebtToOrders, displayRepaymentComment, ensureRepaymentCategory, ensureSupplierPaymentCategory, formatDebt, loadClientRepayments, orderRepaymentComment, repaymentPayload } from "./clientDebts";
import "./clientDebts.css";
import { isAbortError } from "../../../hooks/useAsyncSafety";
import ReportDateRangePicker from "../../../components/ReportDateRangePicker";
import ReportEmptyState from "../../../components/ReportEmptyState";
import OrderReceiptDialog from "../../dashboard/OrderReceiptDialog";
import OrderStatus from "../../reports/OrderStatus";
import Icon from "../../../components/Icon";
import { formatTablePhone } from "./phone";
import { toApiDate } from "../../reports/reportPeriod";
import { parseWebDateTimeInput, webDateTimeInput, webDayKey, webFormat, webCalendarToday } from "../../../utils/webTime";

// Иконка шапки колонки выбора: список с отмеченным пунктом и рука-указатель.
export function ChecklistPickIcon() {
  return <svg className="client-order-select__icon" width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.6" y="3.2" width="4.4" height="4.4" rx=".5" />
    <path d="M3.6 5.4l1.1 1.1 2.6-2.8" />
    <rect x="2.6" y="10.2" width="4.4" height="4.4" rx=".5" />
    <rect x="2.6" y="17.2" width="4.4" height="4.4" rx=".5" />
    <path d="M10.2 3.4h11.6" />
    <path d="M15.2 6.2h2.6" />
    <path d="M11.4 22v-2.1c-1-1-1.9-2.1-1.9-3.3 0-.9.6-1.4 1.4-1.4h.5V6.6a1.25 1.25 0 0 1 2.5 0v6.2" />
    <path d="M13.9 12.4v-.8a1.15 1.15 0 0 1 2.3 0v1.1" />
    <path d="M16.2 12.4a1.15 1.15 0 0 1 2.3 0v.8" />
    <path d="M18.5 13.1a1.15 1.15 0 0 1 2.3 0v3.6c0 1.9-.7 3.5-1.6 5.3" />
  </svg>;
}

// Равные промежутки между колонками: ширина колонки = самое широкое содержимое + общий для всех зазор.
// Колонка выбора (44px) и кнопка погашения (56px) — фиксированные, кнопка у правого края.
// Если всё не помещается в одну строку — таблица работает как обычная (шапка переносится).
export function useEqualColumnGaps(tableRef, deps) {
  useLayoutEffect(() => {
    const table = tableRef.current;
    const frame = table?.parentElement;
    if (!table || !frame) return undefined;
    const measure = (element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().width;
    };
    // В тестовой среде (jsdom) измерять нечего — остаётся обычная раскладка.
    if (typeof document.createRange !== "function" || typeof document.createRange().getBoundingClientRect !== "function") return undefined;
    const apply = () => {
      const fillCols = [...table.querySelectorAll("col.client-debt-orders__fill")];
      if (!fillCols.length) return;
      fillCols.forEach((col) => { col.style.width = ""; });
      table.style.tableLayout = "";
      const offset = table.querySelector("col.client-debt-orders__select") ? 1 : 0;
      const fixed = (offset ? 44 : 0) + (table.querySelector("col.client-debt-orders__action") ? 56 : 0);
      const heads = [...table.querySelectorAll("thead th")];
      const columnCells = (index) => [...table.querySelectorAll(`tbody tr > :nth-child(${offset + index + 1})`)];
      const bodyWidths = fillCols.map((_, index) => Math.max(0, ...columnCells(index).map(measure)));
      // шапка: сначала в одну строку; если так не помещается — по самому длинному слову (перенос на 2 строки)
      const headWidth = (index, oneLine) => {
        const th = heads[offset + index];
        th.style.whiteSpace = oneLine ? "nowrap" : "normal";
        th.style.width = oneLine ? "" : "1px";
        const width = measure(th);
        th.style.whiteSpace = "";
        th.style.width = "";
        return width;
      };
      const available = frame.clientWidth - fixed;
      let result = null;
      for (const oneLine of [true, false]) {
        const widths = fillCols.map((_, index) => Math.max(bodyWidths[index], headWidth(index, oneLine)));
        const gap = (available - widths.reduce((sum, width) => sum + width, 0)) / fillCols.length;
        if (gap >= 20) { result = { widths, gap }; break; }
      }
      if (!result) return; // совсем узко — оставляем автоматическую раскладку (горизонтальная прокрутка)
      fillCols.forEach((col, index) => { col.style.width = `${(result.widths[index] + result.gap).toFixed(2)}px`; });
      table.style.tableLayout = "fixed";
    };
    apply();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    observer?.observe(frame);
    return () => observer?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function ClientOrders({
  clientId, dateFrom, dateTo, debt = null, refreshKey = 0, onPayOrder = null,
  selectedIds = null, onToggleSelect = null, onAllocated = null,
}) {
  // В карточке клиента (есть кнопки погашения) колонок «Тип оплаты» и «Статус» нет; в отчётах — есть.
  const full = !onPayOrder;
  const selectable = Boolean(onToggleSelect && selectedIds);
  const tableRef = useRef(null);
  const [result, setResult] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [openByOrder, setOpenByOrder] = useState(null);
  // Остаток по каждому счёту: текущий долг клиента раскладываем по ВСЕМ его счетам в долг
  // (погашения закрывают счета от старых к новым), а не только по счетам выбранного периода.
  useEffect(() => {
    if (debt == null) { setOpenByOrder(null); return undefined; }
    const request = new AbortController();
    Promise.all([
      financeService.listCounterpartyOrders(clientId, { signal: request.signal }),
      // погашения кнопкой у счёта гасят именно этот счёт — для этого нужны все погашения клиента
      loadClientRepayments(clientId, { signal: request.signal }).catch(() => []),
    ])
      .then(([{ data }, repayments]) => {
        if (request.signal.aborted || !Array.isArray(data)) return;
        const allocated = new Map(allocateDebtToOrders(data, debt, repayments).map((order) => [order.order_id, order]));
        setOpenByOrder(allocated);
        onAllocated?.(allocated);
      })
      .catch(() => { if (!request.signal.aborted) setOpenByOrder(null); });
    return () => request.abort();
  }, [clientId, debt, refreshKey]);
  useEffect(() => {
    const request = new AbortController();
    setResult(null);
    financeService.listCounterpartyOrders(clientId, { dateFrom, dateTo, signal: request.signal })
      .then(({ data }) => {
        if (!Array.isArray(data)) throw new Error("Invalid orders response");
        if (!request.signal.aborted) setResult({ orders: data });
      })
      .catch(() => {
        if (!request.signal.aborted) setResult({ error: true });
      });
    return () => request.abort();
  }, [clientId, dateFrom, dateTo, refreshKey]);

  useEqualColumnGaps(tableRef, [result, openByOrder, selectable, full]);
  if (!result) return <p role="status">Загрузка заказов…</p>;
  if (result.error) return <p role="alert">Не удалось загрузить заказы.</p>;
  // Рамка, фон и шапка — как у таблицы блюд в «Меню» (класс client-debt-frame), остальное — как в отчётах.
  return <>
    <div className="orders-report-page owner-report-view">
    <div className="report-table-wrapper owner-report-table-scroll client-debt-frame">
      {/* Колонки по содержимому, а свободное место делится поровну — промежутки между колонками
          одинаковые; колонка выбора и кнопка погашения — узкие, кнопка прижата к правому краю. */}
      <table ref={tableRef} className="report-table owner-report-table client-debt-orders" aria-label="Заказы в долг">
        <colgroup>
          {selectable ? <col className="client-debt-orders__select" /> : null}
          {Array.from({ length: full ? 10 : 8 }, (_, index) => <col key={index} className="client-debt-orders__fill" />)}
          {onPayOrder ? <col className="client-debt-orders__action" /> : null}
        </colgroup>
        <thead><tr>
          {selectable ? <th className="client-order-select" aria-label="Выбор заказа" title="Выберите заказ, чтобы увидеть его погашения">
            <ChecklistPickIcon />
          </th> : null}
          {["№", "Тип", "Дата закрытия", "Место", "Цена всего", "Остаток долга", ...(full ? ["Тип оплаты"] : []), "Официант", "Кассир", ...(full ? ["Статус"] : [])].map(label => <th key={label}>{label}</th>)}
          {onPayOrder ? <th className="client-order-actions" aria-label="Действия" /> : null}
        </tr></thead>
        <tbody>
          {!result.orders.length && <tr><td colSpan={(full ? 10 : 8) + (selectable ? 1 : 0) + (onPayOrder ? 1 : 0)}>Заказов в долг за этот период нет</td></tr>}
          {result.orders.map(order => <tr key={order.order_id} className="owner-report-row-click" role="button" tabIndex={0}
            aria-label={`Открыть чек заказа ${order.order_number}`} onClick={() => setReceipt(order)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setReceipt(order);
              }
            }}>
            {selectable ? <td className="client-order-select" onClick={(event) => event.stopPropagation()}>
              <input type="checkbox" className="marjon-check" checked={selectedIds.has(order.order_id)}
                aria-label={`Показать погашения заказа № ${order.order_number}`}
                onChange={() => onToggleSelect(order)}
                onKeyDown={(event) => event.stopPropagation()} />
            </td> : null}
            <td><strong>{order.order_number}</strong></td>
            <td>{{ dine_in: "На стол", delivery: "Доставка", takeaway: "На вынос" }[order.order_type] || order.order_type}</td>
            <td>{webFormat(order.closed_at || order.created_at, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
            <td>{[order.hall_name, order.table_number && `стол ${order.table_number}`].filter(Boolean).join(", ") || "—"}</td>
            <td className="report-total-price">{formatTxMoney(order.total_amount)}</td>
            <td className="client-debt-money">{(() => {
              const allocated = openByOrder?.get(order.order_id);
              if (!allocated) return formatTxMoney(order.debt_amount);
              if (allocated.repaid) return <span className="client-order-debt is-repaid">Погашен</span>;
              return <span className="client-order-debt is-open">{formatTxMoney(allocated.open_amount)}</span>;
            })()}</td>
            {full ? <td>{order.payment_methods.filter(method => method !== "debt").map(method => (
              <div key={method}>{({ cash: "Наличные", card: "Карта" })[method] || method}</div>
            ))}
              <div>В долг</div></td> : null}
            <td>{order.waiter_name || "—"}</td><td>{order.cashier_name || "—"}</td>
            {full ? <td><OrderStatus value={order.status} /></td> : null}
            {onPayOrder ? <td className="client-order-actions">{(() => {
              const allocated = openByOrder?.get(order.order_id);
              const open = allocated ? Number(allocated.open_amount) : 0;
              const label = open > 0
                ? `Погасить долг по заказу № ${order.order_number}: ${formatTxMoney(open)}`
                : `Заказ № ${order.order_number} погашен`;
              if (allocated?.repaid) return <span className="client-order-paid" role="img" aria-label={label} title={label}><svg className="client-order-paid__mark" width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="14.5" cy="18" r="10.5" stroke="#a4b6af" strokeWidth="1.2" strokeDasharray=".6 3" strokeLinecap="round"/><path d="M6.5 16.5L11.8 19.5C16 13.2 21.1 8.1 28.5 5.5C22.9 10.7 17.9 17.7 12.3 27L6.5 16.5Z" fill="#00964e"/></svg></span>;
              return <button type="button" className="client-order-pay" disabled={!(open > 0)}
                aria-label={label} title={label}
                onClick={(event) => { event.stopPropagation(); onPayOrder(order, open); }}
                onKeyDown={(event) => event.stopPropagation()}>
                <Icon name={open > 0 ? "bi-cash-coin" : "bi-check2-circle"} size={16} />
              </button>;
            })()}</td> : null}
          </tr>)}
        </tbody>
      </table>
    </div>
    </div>
    {receipt && <OrderReceiptDialog orderId={receipt.order_id} orderNumber={receipt.order_number} onClose={() => setReceipt(null)} />}
  </>;
}

// Строки нижней таблицы: одно погашение может закрыть несколько заказов — тогда строк несколько.
// «Остаток» — сколько осталось по заказу сразу после этого погашения.
export function repaymentRows(items, allocation) {
  const byRepayment = new Map();
  for (const order of allocation ? allocation.values() : []) {
    for (const entry of order.history || []) {
      if (!entry.id) continue;
      if (!byRepayment.has(entry.id)) byRepayment.set(entry.id, []);
      byRepayment.get(entry.id).push({ ...entry, order });
    }
  }
  const rows = [];
  for (const item of items) {
    const parts = byRepayment.get(item.id) || [];
    rows.push(...parts.map(part => ({ ...part, payment_type_id: item.payment_type_id, payment_type_name: item.payment_type_name })));
    const rest = toTxNumber(item.amount) - parts.reduce((sum, part) => sum + toTxNumber(part.amount), 0);
    if (rest > 0.004 || !parts.length) {
      rows.push({ payment_type_id: item.payment_type_id, payment_type_name: item.payment_type_name, id: item.id, date: item.date, amount: parts.length ? rest : toTxNumber(item.amount), comment: displayRepaymentComment(item.comment), order: null, left: null });
    }
  }
  return rows;
}

export function RepaymentTable({ rows, onEdit, paymentTypes }) {
  return <div className="orders-report-page owner-report-view"><div className="report-table-wrapper owner-report-table-scroll client-debt-frame">
    <table className="report-table owner-report-table client-repayments__table">
      <colgroup>{[5, 16, 13, 13, 13, 14, 21, 5].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
      <thead><tr><th>№</th><th>Дата</th><th>Долг</th><th>Сумма</th><th>Остаток</th><th>Способ оплаты</th><th>Комментарий</th><th aria-label="Действия" /></tr></thead>
      <tbody>
        {rows.map((row, index) => <tr key={`${row.id || row.date}-${row.order?.order_id || "free"}-${index}`}>
          <td>{row.order ? <strong>№ {row.order.order_number}</strong> : "—"}</td>
          <td>{webFormat(row.date, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
          <td>{row.left == null ? "—" : <span className="client-order-debt is-before">{formatTxMoney(toTxNumber(row.left) + toTxNumber(row.amount))}</span>}</td>
          <td className="client-repayments__amount">+{formatTxMoney(row.amount)}</td>
          <td>{row.left == null ? "—"
            : row.left > 0 ? <span className="client-order-debt is-open">{formatTxMoney(row.left)}</span>
            : <span className="client-order-debt is-repaid">Погашен</span>}</td>
          <td>{row.payment_type_name || paymentTypes.find(type => String(type.id) === String(row.payment_type_id))?.name || "—"}</td>
          <td className="client-repayments__comment" title={displayRepaymentComment(row.comment) || undefined}>{displayRepaymentComment(row.comment) || "—"}</td>
          <td className="client-repayments__actions"><button type="button" className="client-order-pay" title="Редактировать погашение" aria-label="Редактировать погашение" onClick={() => onEdit?.(row.id)}><Icon name="bi-pencil" size={16} /></button></td>
        </tr>)}
      </tbody>

    </table>
  </div></div>;
}

// Погашения долга: за период или (если отмечены заказы) — история отмеченных заказов.
function ClientRepayments({ items, loading, error, allocation = null, selectedOrders = [], onEdit }) {
  const [paymentTypes, setPaymentTypes] = useState([]);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => financeService.listPaymentTypes())
      .then(response => { if (active) setPaymentTypes(itemsOf(response)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  if (selectedOrders.length > 0) {
    const rows = selectedOrders
      .flatMap((order) => (order.history || []).map((entry) => ({ ...entry, order })))
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const title = `История погашений: ${selectedOrders.map((order) => `заказ № ${order.order_number}`).join(", ")}`;
    return <section className="client-repayments" aria-label="Погашения долга">
      <h3>{title}</h3>
      {!rows.length ? <p>По выбранным заказам погашений ещё не было</p> : <RepaymentTable rows={rows} onEdit={onEdit} paymentTypes={paymentTypes} />}
    </section>;
  }
  return <section className="client-repayments" aria-label="Погашения долга">
    <h3>Погашения за период</h3>
    {loading ? <p role="status">Загрузка погашений…</p>
      : error ? <p role="alert">{error}</p>
      : !items.length ? <p>Погашений за этот период нет</p>
      : <RepaymentTable rows={repaymentRows(items, allocation)} onEdit={onEdit} paymentTypes={paymentTypes} />}
  </section>;
}

export const DIRECTION_INCOME = "income";
export const DIRECTION_EXPENSE = "expense";

export function directionLabel(direction) {
  return direction === DIRECTION_EXPENSE ? t("Расход") : t("Приход");
}

export function formatTxDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return webFormat(value, {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export function txDay(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return webFormat(value, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function txDayKey(value) {
  return webDayKey(value || "") || String(value || "").slice(0, 10);
}

export function toTxNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function formatTxMoney(value) {
  return `${toTxNumber(value).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} UZS`;
}

// Deterministic client-side aggregation over a COMPLETE fetched set.
// No invented balances: only sums of real loaded operations.
export function aggregateByDay(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = txDayKey(item?.date);
    const entry = map.get(key) || { date: txDay(item?.date), income: 0, expense: 0, count: 0 };
    const amount = toTxNumber(item?.amount);
    if (item?.direction === DIRECTION_EXPENSE) entry.expense += amount;
    else entry.income += amount;
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => entry);
}

export function turnover(items) {
  let income = 0;
  let expense = 0;
  for (const item of items || []) {
    const amount = toTxNumber(item?.amount);
    if (item?.direction === DIRECTION_EXPENSE) expense += amount;
    else income += amount;
  }
  return { income, expense, count: (items || []).length };
}

function defaultPeriod() {
  const now = webCalendarToday();
  const pad = (value) => String(value).padStart(2, "0");
  const fmt = (date) => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  const ago = new Date(now);
  ago.setDate(ago.getDate() - 30);
  return { preset: "", start: fmt(ago), end: fmt(now) };
}

function useCounterpartyHistory(counterpartyId, period) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("detailed");

  const load = useCallback(async (range) => {
    if (!counterpartyId) return;
    setLoading(true);
    setError("");
    try {
      // Server-side date filtering (endpoint contract) + full pagination so
      // turnover/aggregation always cover the whole selected period.
      // The canonical finance contract is date-only: DD.MM.YYYY -> YYYY-MM-DD.
      const params = { page: 1, size: 200 };
      const from = range ? toApiDate(range.start) : undefined;
      const to = range ? toApiDate(range.end) : undefined;
      if (from) params.date_from = from;
      if (to) params.date_to = to;
      const first = await financeService.listCounterpartyTransactions(counterpartyId, params);
      const all = [...(first.data?.items || [])];
      const pages = Number(first.data?.pages || 1);
      for (let page = 2; page <= pages; page += 1) {
        const next = await financeService.listCounterpartyTransactions(counterpartyId, { ...params, page });
        all.push(...(next.data?.items || []));
        if (!(next.data?.items || []).length) break;
      }
      setItems(all);
      setTotal(Number(first.data?.total ?? all.length));
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err?.response?.data?.detail || "Не удалось загрузить историю операций.");
        setItems([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
    }
  }, [counterpartyId]);

  useEffect(() => {
    load(period);
  }, [load, period?.start, period?.end]);

  return { items, total, loading, error, mode, setMode, reload: () => load(period) };
}

// «Погасить долг»: тот же диалог прихода, что в «Финансах», но клиент и категория «Возврат долга»
// уже подставлены. Каждое частичное погашение — отдельная операция.
// Что именно вносим: погашение долга клиента (приход «Возврат долга») или оплата долга поставщику
// (расход «Оплата поставщику»). Окно и логика одни и те же.
export const CLIENT_REPAYMENT = {
  direction: "income", partyType: "client", ensureCategory: ensureRepaymentCategory,
  loadOptions: {},
  heading: "Погашение долга", editHeading: "Редактирование погашения", submit: "Погасить",
  defaultComment: "Погашение долга", dateError: "Укажите дату и время погашения.",
};
export const SUPPLIER_PAYMENT = {
  direction: "expense", partyType: "supplier", ensureCategory: ensureSupplierPaymentCategory,
  loadOptions: { categoryName: "Оплата поставщику", kind: "expense" },
  heading: "Оплата поставщику", editHeading: "Редактирование оплаты", submit: "Оплатить",
  defaultComment: "Оплата долга поставщику", dateError: "Укажите дату и время оплаты.",
};

export function useDebtRepayment(row, debt, onSaved, config = CLIENT_REPAYMENT) {
  const [form, setForm] = useState(null);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [paymentTypes, setPaymentTypes] = useState([]);
  const [category, setCategory] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const submissionRef = useRef(null);
  const savingRef = useRef(false);
  // Сколько можно погасить в этом окне: остаток заказа (кнопка у заказа) или весь долг клиента.
  const [limit, setLimit] = useState(null);

  const open = async ({ limit: orderLimit = null, comment = "", transaction = null, initialAmount = "" } = {}) => {
    if (opening || !row?.id) return;
    setOpening(true);
    setError("");
    try {
      const [types, repaymentCategory] = await Promise.all([
        financeService.listPaymentTypes().then((response) => itemsOf(response)).catch(() => []),
        config.ensureCategory(),
      ]);
      setPaymentTypes(types.filter((item) => item.status !== false && String(item.type || "").toLowerCase() !== "vip" && String(item.name || "").trim().toLowerCase() !== "vip"));
      setCategory(repaymentCategory);
      submissionRef.current = null;
      setEditingTransaction(transaction);
      setLimit(transaction ? Math.max(0, Number(debt) || 0) + toTxNumber(transaction.amount) : orderLimit != null ? orderLimit : debt);
      setForm({
        ...emptyForm,
        type: config.direction,
        amount: transaction ? String(transaction.amount) : String(initialAmount),
        comment: transaction ? (transaction.comment || "") : comment,
        paymentTypeId: transaction?.payment_type_id ? String(transaction.payment_type_id) : "",
        counterpartyId: String(row.id),
        categoryId: String(repaymentCategory.id),
        operationDateTime: webDateTimeInput(transaction?.date || new Date()),
      });
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Не удалось подготовить погашение. Попробуйте ещё раз.");
    } finally {
      setOpening(false);
    }
  };

  const save = async () => {
    if (savingRef.current || !form) return false;
    const amount = parseAmount(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError("Введите положительную сумму."); return false; }
    if (limit != null && limit > 0 && amount > limit) { setError(`Сумма больше долга (${formatDebt(limit)}).`); return false; }
    if (!form.paymentTypeId) { setError("Выберите способ оплаты."); return false; }
    const date = parseWebDateTimeInput(form.operationDateTime);
    if (!date) { setError(config.dateError); return false; }
    const payload = repaymentPayload({
      amount, clientId: form.counterpartyId, categoryId: form.categoryId,
      paymentTypeId: form.paymentTypeId, date, comment: form.comment,
      direction: config.direction, defaultComment: config.defaultComment,
    });
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      let response;
      if (editingTransaction) {
        response = await financeService.updateTransaction(editingTransaction.id, { amount, comment: form.comment, payment_type_id: form.paymentTypeId });
      } else {
        const submission = resolveTransactionSubmission(submissionRef.current, payload);
        submissionRef.current = submission;
        response = await financeService.createTransaction(payload, submission.idempotencyKey);
      }
      if (!response.data?.id) throw new Error("Погашение не подтверждено сервером");
      submissionRef.current = null;
      onSaved?.();
      return true;
    } catch (err) {
      setError(typeof err?.response?.data?.detail === "string" ? err.response.data.detail : "Не удалось сохранить погашение.");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const typed = form ? parseAmount(form.amount) : Number.NaN;
  const debtLeft = limit != null ? Math.max(0, limit - (Number.isFinite(typed) ? typed : 0)) : null;
  const drawer = form ? (
    <FinanceTransactionDrawer
      form={form}
      repaymentMode
      lockOperationDate={Boolean(editingTransaction)}
      setForm={setForm}
      onClose={() => { setForm(null); setError(""); }}
      onSave={save}
      paymentTypes={paymentTypes}
      categories={category ? [category] : []}
      counterparties={[{ id: String(row.id), full_name: row.name, type: config.partyType }]}
      presetPartyType={config.partyType}
      lockParty
      lockCategory
      heading={`${editingTransaction ? config.editHeading : config.heading} · ${row.name}`}
      submitLabel={editingTransaction ? "Сохранить" : config.submit}
      headerAside={debtLeft != null ? <button type="button" className="client-debt-left" data-testid="debt-left"
        disabled={saving || debtLeft <= 0} title="Внести эту сумму"
        onClick={event => {
          setForm(current => ({ ...current, amount: String(debtLeft) }));
          setError("");
          const input = event.currentTarget.closest("form")?.querySelector(".finance-amount input");
          input?.focus({ preventScroll: true });
        }}><Icon name="bi-database" size={14} />Долг: {formatDebt(debtLeft)}</button> : null}
      saving={saving}
      error={error}
      onClearError={() => setError("")}
    />
  ) : null;

  const edit = async (id) => {
    if (opening || savingRef.current) return;
    try {
      const transactions = await loadClientRepayments(row.id, config.loadOptions);
      const transaction = transactions.find(item => String(item.id) === String(id));
      if (!transaction) throw new Error("Погашение не найдено. Обновите страницу.");
      await open({ transaction });
    } catch (err) {
      window.alert(err.message || "Не удалось открыть погашение.");
    }
  };
  return { open, edit, opening, drawer };
}

export function CounterpartyStatementView({ row, debt = null, onDebtChanged = null }) {
  const [period, setPeriod] = useState(() => defaultPeriod());
  const showOrders = row?.type === "clients" || row?.type === "client";
  const history = useCounterpartyHistory(row?.id, period);
  const { items, loading, error, mode, setMode } = history;
  const [refreshKey, setRefreshKey] = useState(0);
  const repayment = useDebtRepayment(row, debt, () => {
    history.reload();
    setRefreshKey((value) => value + 1);
    onDebtChanged?.();
  });
  const repayments = useMemo(() => items.filter((item) => item.direction !== DIRECTION_EXPENSE), [items]);
  // Галочка у заказа: нижняя таблица показывает историю погашений выбранного заказа.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [allocation, setAllocation] = useState(null);
  // Выбрать можно только один заказ: новая галочка снимает прежнюю, повторный клик — снимает выбор.
  const toggleOrder = useCallback((order) => setSelectedIds((current) => (
    current.has(order.order_id) ? new Set() : new Set([order.order_id])
  )), []);
  const selectedOrders = useMemo(() => (allocation ? [...selectedIds].map((id) => allocation.get(id)).filter(Boolean) : []),
    [allocation, selectedIds]);
  const debtSummary = useMemo(() => {
    if (!allocation) return null;
    const orders = [...allocation.values()];
    const paid = orders.reduce((sum, order) => sum + Math.max(0, toTxNumber(order.debt_amount) - toTxNumber(order.open_amount)), 0);
    const remaining = Math.max(0, toTxNumber(debt));
    return { total: remaining + paid, paid, remaining };
  }, [allocation, debt]);
  const sums = useMemo(() => turnover(items), [items]);
  const daily = useMemo(() => (mode === "simple" ? aggregateByDay(items) : []), [items, mode]);

  // Clients V10: the Simple/Detailed toggle reuses the EXACT Clients
  // segmented-control primitive (.staff-header--cashier .staff-tabs--slider +
  // measured indicator), so shell/border/active pill/teal text/shadow/
  // typography/height/radius (22px) match the directory tabs by construction.
  const modeTabsRef = useRef(null);
  const [modePill, setModePill] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const container = modeTabsRef.current;
    if (!container) return undefined;
    const update = () => {
      const active = container.querySelector(`[data-mode="${mode}"]`);
      if (!active) return;
      setModePill((current) => {
        const next = { left: active.offsetLeft, width: active.offsetWidth };
        return current.left === next.left && current.width === next.width
          ? current
          : next;
      });
    };
    update();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(container);
      container.querySelectorAll("[data-mode]").forEach((segment) => ro.observe(segment));
    } else {
      window.addEventListener("resize", update);
    }
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [mode, showOrders]);

  // Clients V10: the period picker uses the SAME controlled invocation as the
  // accepted Reports pages (variant="canonical" + animateExit + open +
  // onOpenChange + onExitComplete). Previously it was uncontrolled with no
  // animateExit, so it unmounted instantly on close (no exit animation), and
  // the Reports open animation never applied either — its CSS is scoped to
  // report page shells, which this view never carried until now.
  const [panelState, setPanelState] = useState({ active: "", closing: "", pending: "" });
  useEffect(() => {
    if (!panelState.closing) return undefined;
    function cancelPendingOnOutsideClick(event) {
      if (!event.target.closest?.(".orders-filter-select, .report-period-picker")) {
        setPanelState((current) => ({ ...current, pending: "" }));
      }
    }
    document.addEventListener("mousedown", cancelPendingOnOutsideClick);
    return () => document.removeEventListener("mousedown", cancelPendingOnOutsideClick);
  }, [panelState.closing]);
  function requestPanel(panelId) {
    setPanelState((current) => {
      if (current.closing) {
        const nextPending = current.pending === panelId ? "" : panelId;
        return { ...current, pending: nextPending };
      }
      if (!current.active) return panelId ? { active: panelId, closing: "", pending: "" } : current;
      return {
        active: "",
        closing: current.active,
        pending: current.active === panelId ? "" : panelId,
      };
    });
  }
  function completePanelExit(panelId) {
    setPanelState((current) => {
      if (current.closing !== panelId) return current;
      return { active: current.pending, closing: "", pending: "" };
    });
  }

  // No local back button here by design (Clients V10): the global/topbar Back
  // returns to the Clients directory and restores the source tab via
  // ?tab=…&history=… navigation state owned by SettingsResourcePage.
  return (
    <div className="settings-page settings-owner-view clients-directory-page client-statement-page">
      <section className="settings-card">
        <header className="settings-header client-statement-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" />
            <div>
              <p>{t("История транзакций")}</p>
              <div className="client-statement-identity">
                <h1>{row?.name || "-"}</h1>
                {row?.phone ? <span className="client-statement-phone">{formatTablePhone(row.phone)}</span> : null}

              </div>
            </div>
          </div>
          <div className="client-statement-right staff-header--cashier">
            {debt != null ? <div className="client-debt-summary" aria-label="Сводка долга клиента">
              <span className="client-debt-badge is-debt" data-testid="client-debt"><Icon name="bi-database" size={17} />Долг: {debtSummary ? formatDebt(debtSummary.total) : "—"}</span>
              <span className="client-debt-badge is-payment"><Icon name="bi-database" size={17} />Погашение: {debtSummary ? formatDebt(debtSummary.paid) : "—"}</span>
              <button type="button" className="client-debt-badge is-remaining" onClick={() => repayment.open({ initialAmount: debt })} disabled={repayment.opening || debt <= 0} title="Погасить общий долг клиента"><Icon name="bi-database" size={17} />Остаток: {debt < 0 ? `Переплата ${formatDebt(-debt)}` : formatDebt(debt)}</button>
            </div> : null}
            {!showOrders && <div className="staff-tabs staff-tabs--slider" role="group" aria-label={t("Режим")} data-active={mode} ref={modeTabsRef}>
              <span
                className="staff-tabs__indicator"
                aria-hidden="true"
                style={{ transform: `translateX(${modePill.left}px)`, width: modePill.width }}
              />
              <button type="button" data-mode="simple" className={mode === "simple" ? "is-active" : ""} onClick={() => setMode("simple")}>{t("Простой")}</button>
              <button type="button" data-mode="detailed" className={mode === "detailed" ? "is-active" : ""} onClick={() => setMode("detailed")}>{t("Подробный")}</button>
            </div>}
            <ReportDateRangePicker
              variant="canonical"
              animateExit
              value={period}
              onChange={setPeriod}
              open={panelState.active === "period"}
              onOpenChange={(nextOpen) => requestPanel(nextOpen ? "period" : "")}
              onExitComplete={() => completePanelExit("period")}
              buttonAriaLabel={t("pages.settings.clients.counterpartyhistory.period_istorii_tranzaktsiy")}
            />
          </div>
        </header>

        {showOrders ? <>
          <ClientOrders clientId={row.id} dateFrom={toApiDate(period.start)} dateTo={toApiDate(period.end)} debt={debt} refreshKey={refreshKey}
            selectedIds={selectedIds} onToggleSelect={toggleOrder} onAllocated={setAllocation}
            onPayOrder={debt != null ? (order, open) => repayment.open({ limit: open, comment: orderRepaymentComment(order) }) : null} />
          <ClientRepayments items={repayments} loading={loading} error={error} allocation={allocation} selectedOrders={selectedOrders} onEdit={repayment.edit} />
        </> :
        <div className="staff-table-wrapper client-statement-table-region">
          {loading ? <div className="settings-empty-state">{t("pages.settings.clients.counterpartyhistory.zagruzka")}</div> : null}
          {!loading && error ? <div className="settings-empty-state" role="alert">{error}</div> : null}
          {!loading && !error && !items.length ? (
            <div className="client-statement-empty">
              <ReportEmptyState title={t("pages.settings.clients.counterpartyhistory.net_tranzaktsiy_za_vybrannyy_period")} />
            </div>
          ) : null}

          {!loading && !error && items.length > 0 ? (
            <>
              <table className="staff-table client-statement-table">
                <thead>
                  <tr>
                    <th>{t("pages.settings.clients.counterpartyhistory.data")}</th>
                    {mode === "simple" ? <th>{t("Операций")}</th> : <th>{t("pages.settings.clients.counterpartyhistory.operatsiya")}</th>}
                    <th>{t("pages.settings.clients.counterpartyhistory.prihod")}</th>
                    <th>{t("pages.settings.clients.counterpartyhistory.rashod")}</th>
                    {mode === "detailed" ? <th>{t("pages.settings.clients.counterpartyhistory.kommentariy")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {mode === "simple" ? daily.map((day) => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{day.count}</td>
                      <td>{day.income > 0 ? formatTxMoney(day.income) : "-"}</td>
                      <td>{day.expense > 0 ? formatTxMoney(day.expense) : "-"}</td>
                    </tr>
                  )) : items.map((item) => (
                    <tr key={item.id || `${item.date}-${item.amount}`}>
                      <td>{formatTxDate(item.date)}</td>
                      <td>{directionLabel(item.direction)}</td>
                      <td>{item.direction === DIRECTION_EXPENSE ? "-" : formatTxMoney(item.amount)}</td>
                      <td>{item.direction === DIRECTION_EXPENSE ? formatTxMoney(item.amount) : "-"}</td>
                      <td>{item.comment || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="client-statement-summary">
                <span>{t("pages.settings.clients.counterpartyhistory.oboroty_za_period_prihod")} {formatTxMoney(sums.income)} {t("pages.settings.clients.counterpartyhistory.rashod_2")} {formatTxMoney(sums.expense)}</span>
                <span>{t("pages.settings.clients.counterpartyhistory.operatsiy_2")} {sums.count}</span>
              </div>
            </>
          ) : null}
        </div>}
      </section>
      {repayment.drawer}
    </div>
  );
}

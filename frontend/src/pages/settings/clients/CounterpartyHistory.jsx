import { useCallback, useEffect, useMemo, useState } from "react";
import { financeService } from "../../../api/finance";
import { isAbortError } from "../../../hooks/useAsyncSafety";
import ReportDateRangePicker from "../../../components/ReportDateRangePicker";
import ReportEmptyState from "../../../components/ReportEmptyState";
import OrderReceiptDialog from "../../dashboard/OrderReceiptDialog";
import OrderStatus from "../../reports/OrderStatus";
import { formatMoney } from "../../reports/reportMoney";
import { formatTablePhone } from "./phone";
import { toApiDate } from "../../reports/reportPeriod";
import { webDayKey, webFormat, webCalendarToday } from "../../../utils/webTime";
import { t } from "../../../i18n/t";

export const DIRECTION_INCOME = "income";
export const DIRECTION_EXPENSE = "expense";

export function directionLabel(direction) {
  return direction === DIRECTION_EXPENSE ? "Расход" : "Приход";
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

// DEBT-ORDERS-01: строка заказа клиента → вид, который рисует таблица.
// Поля считает бэкенд (/finance/counterparties/{id}/orders): сумма, оплачено
// и остаток долга, поэтому фронтенд ничего не досчитывает сам.
export function normalizeClientOrder(item) {
  return {
    id: String(item?.order_id ?? ""),
    orderNumber: String(item?.order_number ?? ""),
    createdAt: item?.created_at || null,
    status: item?.status || "",
    itemsCount: Number(item?.items_count ?? 0),
    totalAmount: toTxNumber(item?.total_amount),
    paidAmount: toTxNumber(item?.paid_amount),
    debtAmount: toTxNumber(item?.debt_amount),
    paymentMethods: Array.isArray(item?.payment_methods) ? item.payment_methods.map(String) : [],
    waiterName: item?.waiter_name || "",
  };
}

function formatOrderMoment(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return webFormat(value, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
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

  return { items, total, loading, error, reload: () => load(period) };
}

// Заказы клиента за период. Долг при закрытии «в долг» не создаёт финансовую
// транзакцию, поэтому в «Транзакциях» у должника было пусто: показываем его
// заказы так же, как отчёт по заказам.
function useCounterpartyOrders(counterpartyId, period, enabled) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || !counterpartyId) {
      setOrders([]);
      setLoading(false);
      setError("");
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    financeService
      .listCounterpartyOrders(counterpartyId, {
        dateFrom: toApiDate(period?.start),
        dateTo: toApiDate(period?.end),
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!active) return;
        setOrders((Array.isArray(data) ? data : []).map(normalizeClientOrder));
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setError(err?.response?.data?.detail || "Не удалось загрузить заказы клиента.");
        setOrders([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [counterpartyId, enabled, period?.start, period?.end]);

  return { orders, loading, error };
}

export function CounterpartyStatementView({ row }) {
  const [period, setPeriod] = useState(() => defaultPeriod());
  // Заказы есть только у клиентов: поставщики/сотрудники живут транзакциями.
  const isClient = row?.type === "clients";
  const history = useCounterpartyHistory(row?.id, period);
  const { items, loading: txLoading, error: txError } = history;
  const { orders, loading: ordersLoading, error: ordersError } = useCounterpartyOrders(row?.id, period, isClient);
  const [receiptOrder, setReceiptOrder] = useState(null);
  const sums = useMemo(() => turnover(items), [items]);
  const orderSums = useMemo(() => orders.reduce((acc, order) => ({
    total: acc.total + order.totalAmount,
    paid: acc.paid + order.paidAmount,
    debt: acc.debt + order.debtAmount,
  }), { total: 0, paid: 0, debt: 0 }), [orders]);

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

  function openReceipt(order) {
    setReceiptOrder({ id: order.id, number: order.orderNumber });
  }

  const loading = isClient ? ordersLoading : txLoading;
  const error = isClient ? ordersError : txError;
  const nothingAtAll = isClient
    ? !orders.length && !items.length
    : !items.length;
  // Транзакции показываем вторым блоком и только если они реально есть:
  // у должника их нет, у клиента с ручными операциями — есть.
  const showTransactions = !isClient || items.length > 0;

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
              <p>{isClient ? t("pages.settings.clients.counterpartyhistory.zakazy_klienta") : t("pages.settings.clients.counterpartyhistory.istoriya_tranzaktsiy")}</p>
              <div className="client-statement-identity">
                <h1>{row?.name || "-"}</h1>
                {row?.phone ? <span className="client-statement-phone">{formatTablePhone(row.phone)}</span> : null}
              </div>
            </div>
          </div>
          <div className="client-statement-right staff-header--cashier">
            <ReportDateRangePicker
              variant="canonical"
              animateExit
              value={period}
              onChange={setPeriod}
              open={panelState.active === "period"}
              onOpenChange={(nextOpen) => requestPanel(nextOpen ? "period" : "")}
              onExitComplete={() => completePanelExit("period")}
              buttonAriaLabel={t("pages.settings.clients.counterpartyhistory.period_istorii")}
            />
          </div>
        </header>

        <div className="staff-table-wrapper client-statement-table-region">
          {loading ? <div className="settings-empty-state">{t("pages.settings.clients.counterpartyhistory.zagruzka")}</div> : null}
          {!loading && error ? <div className="settings-empty-state" role="alert">{error}</div> : null}
          {!loading && !error && nothingAtAll ? (
            <div className="client-statement-empty">
              <ReportEmptyState
                title={isClient
                  ? t("pages.settings.clients.counterpartyhistory.net_zakazov_za_period")
                  : t("pages.settings.clients.counterpartyhistory.net_tranzaktsiy_za_vybrannyy_period")}
              />
            </div>
          ) : null}

          {!loading && !error && isClient && orders.length > 0 ? (
            <>
              <table className="staff-table client-statement-table client-orders-table">
                <thead>
                  <tr>
                    <th>{t("pages.settings.clients.counterpartyhistory.nomer_zakaza")}</th>
                    <th>{t("pages.settings.clients.counterpartyhistory.data")}</th>
                    <th>{t("pages.settings.clients.counterpartyhistory.summa")}</th>
                    <th>{t("pages.settings.clients.counterpartyhistory.oplacheno")}</th>
                    <th>{t("pages.settings.clients.counterpartyhistory.dolg")}</th>
                    <th>{t("pages.settings.clients.counterpartyhistory.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr
                      key={order.id}
                      className="client-statement-order-row"
                      role="button"
                      tabIndex={0}
                      aria-label={`${t("pages.settings.clients.counterpartyhistory.otkryt_chek")} ${order.orderNumber}`}
                      onClick={() => openReceipt(order)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openReceipt(order);
                        }
                      }}
                    >
                      <td><strong>{order.orderNumber}</strong></td>
                      <td>{formatOrderMoment(order.createdAt)}</td>
                      <td className="client-statement-money">{formatMoney(order.totalAmount)}</td>
                      <td>{formatMoney(order.paidAmount)}</td>
                      <td className={order.debtAmount > 0 ? "client-statement-debt is-debt" : "client-statement-debt"}>
                        {order.debtAmount > 0 ? formatMoney(order.debtAmount) : "—"}
                      </td>
                      <td><OrderStatus value={order.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="client-statement-summary">
                <span>{t("pages.settings.clients.counterpartyhistory.zakazov")} {orders.length}</span>
                <span>{t("pages.settings.clients.counterpartyhistory.summa")} {formatMoney(orderSums.total)}</span>
                <span>{t("pages.settings.clients.counterpartyhistory.oplacheno")} {formatMoney(orderSums.paid)}</span>
                <span>{t("pages.settings.clients.counterpartyhistory.dolg")} {formatMoney(orderSums.debt)}</span>
              </div>
            </>
          ) : null}

          {!loading && !error && showTransactions && items.length > 0 ? (
            <>
              {isClient ? (
                <h2 className="client-statement-section-title">
                  {t("pages.settings.clients.counterpartyhistory.finansovye_operatsii")}
                </h2>
              ) : null}
              <table className="staff-table client-statement-table">
                <thead>
                  <tr>
                    <th>{t("pages.settings.clients.counterpartyhistory.data")}</th>
                    <th>{t("pages.settings.clients.counterpartyhistory.operatsiya")}</th>
                    <th>{t("pages.settings.clients.counterpartyhistory.prihod")}</th>
                    <th>{t("pages.settings.clients.counterpartyhistory.rashod")}</th>
                    <th>{t("pages.settings.clients.counterpartyhistory.kommentariy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
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
        </div>
      </section>

      {/* Тот же чек, что в отчёте по заказам: клик по строке открывает его. */}
      {receiptOrder ? (
        <OrderReceiptDialog
          orderId={receiptOrder.id}
          orderNumber={receiptOrder.number}
          onClose={() => setReceiptOrder(null)}
        />
      ) : null}
    </div>
  );
}

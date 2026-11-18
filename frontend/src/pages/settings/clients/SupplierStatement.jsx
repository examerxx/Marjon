import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { financeService } from "../../../api/finance";
import Icon from "../../../components/Icon";
import ReportDateRangePicker from "../../../components/ReportDateRangePicker";
import { toApiDate } from "../../reports/reportPeriod";
import { webCalendarToday, webDayKey, webFormat } from "../../../utils/webTime";
import { formatPurchaseDate, formatPurchaseRegistered, usePurchaseViewer, useSupplierCreditPurchases } from "../../warehouse/SupplierPurchases";
import {
  ChecklistPickIcon, RepaymentTable, SUPPLIER_PAYMENT, repaymentRows, toTxNumber, useDebtRepayment, useEqualColumnGaps,
} from "./CounterpartyHistory";
import { allocateDebtToOrders, formatDebt, loadClientRepayments, purchaseRepaymentComment } from "./clientDebts";
import { formatTablePhone } from "./phone";
import { itemsOf } from "../../finance/financeTransactionsData";
import "./clientDebts.css";

const money = (value) => `${Math.round(Number(value) || 0).toLocaleString("ru-RU")} UZS`;

function defaultPeriod() {
  const now = webCalendarToday();
  const pad = (value) => String(value).padStart(2, "0");
  const fmt = (date) => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  const ago = new Date(now);
  ago.setDate(ago.getDate() - 30);
  return { preset: "", start: fmt(ago), end: fmt(now) };
}

// Карточка поставщика («История транзакций»): та же структура, что у клиента, но по теме —
// вместо заказов в долг приходы «на потом», вместо погашений оплаты поставщику.
export default function SupplierStatementView({ row, onDebtChanged = null }) {
  const [period, setPeriod] = useState(() => defaultPeriod());
  const [refreshKey, setRefreshKey] = useState(0);
  const purchases = useSupplierCreditPurchases(row?.name, refreshKey);
  const { view, dialog } = usePurchaseViewer(row?.name);
  const [payments, setPayments] = useState({ loading: true, error: false, items: [] });
  const [paymentTypes, setPaymentTypes] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const tableRef = useRef(null);

  useEffect(() => {
    let active = true;
    setPayments((current) => ({ ...current, loading: true, error: false }));
    loadClientRepayments(row.id, SUPPLIER_PAYMENT.loadOptions)
      .then((items) => { if (active) setPayments({ loading: false, error: false, items }); })
      .catch(() => { if (active) setPayments({ loading: false, error: true, items: [] }); });
    return () => { active = false; };
  }, [row?.id, refreshKey]);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => financeService.listPaymentTypes())
      .then((response) => { if (active) setPaymentTypes(itemsOf(response)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Приходы как «счета» для раскладки оплат: оплата «по приходу» гасит свой приход, остальное — от старых к новым.
  const orders = useMemo(() => purchases.rows.map((item) => ({
    ...item,
    order_id: item.id,
    order_number: item.number,
    closed_at: item.created_at,
    debt_amount: item.total_amount,
  })), [purchases.rows]);
  const totalCredit = useMemo(() => orders.reduce((sum, order) => sum + toTxNumber(order.debt_amount), 0), [orders]);
  const totalPaid = useMemo(() => payments.items.reduce((sum, item) => sum + toTxNumber(item.amount), 0), [payments.items]);
  const owed = Math.max(0, totalCredit - totalPaid);
  const allocation = useMemo(() => new Map(
    allocateDebtToOrders(orders, owed, payments.items, { direction: "expense" }).map((order) => [order.order_id, order]),
  ), [orders, owed, payments.items]);
  const summary = useMemo(() => {
    const list = [...allocation.values()];
    const remaining = list.reduce((sum, order) => sum + toTxNumber(order.open_amount), 0);
    return { total: totalCredit, paid: Math.max(0, totalCredit - remaining), remaining };
  }, [allocation, totalCredit]);

  const payment = useDebtRepayment({ id: row.id, name: row.name }, summary.remaining, () => {
    setRefreshKey((value) => value + 1);
    onDebtChanged?.();
  }, SUPPLIER_PAYMENT);

  // Выбрать можно один приход: новая галочка снимает прежнюю, повторный клик — снимает выбор.
  const toggle = useCallback((id) => setSelectedIds((current) => (current.has(id) ? new Set() : new Set([id]))), []);
  const selected = useMemo(() => [...selectedIds].map((id) => allocation.get(id)).filter(Boolean), [allocation, selectedIds]);

  useEqualColumnGaps(tableRef, [purchases.rows, allocation, purchases.loading]);

  const inPeriod = useMemo(() => {
    const from = toApiDate(period.start);
    const to = toApiDate(period.end);
    return payments.items.filter((item) => {
      const day = webDayKey(item.date);
      return (!from || day >= from) && (!to || day <= to);
    });
  }, [payments.items, period]);

  const bottom = (() => {
    if (selected.length) {
      const rows = selected
        .flatMap((order) => (order.history || []).map((entry) => ({ ...entry, order })))
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      const title = `История оплат: ${selected.map((order) => `приход № ${order.order_number}`).join(", ")}`;
      return { title, rows, empty: "По выбранному приходу оплат ещё не было" };
    }
    return { title: "Оплаты за период", rows: repaymentRows(inPeriod, allocation), empty: "Оплат за этот период нет" };
  })();

  return (
    <div className="settings-page settings-owner-view clients-directory-page client-statement-page">
      <section className="settings-card">
        <header className="settings-header client-statement-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" />
            <div>
              <p>История транзакций</p>
              <div className="client-statement-identity">
                <h1>{row?.name || "-"}</h1>
                {row?.phone ? <span className="client-statement-phone">{formatTablePhone(row.phone)}</span> : null}
              </div>
            </div>
          </div>
          <div className="client-statement-right staff-header--cashier">
            <div className="client-debt-summary" aria-label="Сводка долга перед поставщиком">
              <span className="client-debt-badge is-debt" data-testid="supplier-debt"><Icon name="bi-database" size={17} />Долг: {formatDebt(summary.total)}</span>
              <span className="client-debt-badge is-payment"><Icon name="bi-database" size={17} />Оплата: {formatDebt(summary.paid)}</span>
              <button type="button" className="client-debt-badge is-remaining" onClick={() => payment.open({ initialAmount: summary.remaining })}
                disabled={payment.opening || summary.remaining <= 0} title="Оплатить общий долг поставщику">
                <Icon name="bi-database" size={17} />Остаток: {formatDebt(summary.remaining)}
              </button>
            </div>
            <ReportDateRangePicker variant="canonical" value={period} onChange={setPeriod} buttonAriaLabel="Период оплат" />
          </div>
        </header>

        {purchases.loading ? <p role="status">Загрузка приходов…</p> : purchases.error ? <p role="alert">Не удалось загрузить приходы поставщика.</p> : (
          <div className="orders-report-page owner-report-view">
            <div className="report-table-wrapper owner-report-table-scroll client-debt-frame">
              <table ref={tableRef} className="report-table owner-report-table client-debt-orders" aria-label="Приходы поставщика на потом">
                <colgroup>
                  <col className="client-debt-orders__select" />
                  {Array.from({ length: 6 }, (_, index) => <col key={index} className="client-debt-orders__fill" />)}
                  <col className="client-debt-orders__action" />
                </colgroup>
                <thead><tr>
                  <th className="client-order-select" aria-label="Выбор прихода" title="Выберите приход, чтобы увидеть его оплаты"><ChecklistPickIcon /></th>
                  {["№", "На склад", "Дата поступления", "Дата регистрации", "Сумма прихода", "Остаток долга"].map((label) => <th key={label}>{label}</th>)}
                  <th className="client-order-actions" aria-label="Действия" />
                </tr></thead>
                <tbody>
                  {!orders.length && <tr><td colSpan={8}>Приходов «на потом» у этого поставщика нет</td></tr>}
                  {orders.map((order) => {
                    const allocated = allocation.get(order.order_id);
                    const open = allocated ? Number(allocated.open_amount) : 0;
                    const label = open > 0 ? `Оплатить приход № ${order.order_number}: ${money(open)}` : `Приход № ${order.order_number} оплачен`;
                    return <tr key={order.order_id} className="owner-report-row-click" role="button" tabIndex={0}
                      aria-label={`Открыть состав прихода ${order.order_number}`}
                      onClick={() => view(order, order.order_number)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); view(order, order.order_number); } }}>
                      <td className="client-order-select" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" className="marjon-check" checked={selectedIds.has(order.order_id)}
                          aria-label={`Показать оплаты прихода № ${order.order_number}`}
                          onChange={() => toggle(order.order_id)} onKeyDown={(event) => event.stopPropagation()} />
                      </td>
                      <td><strong>{order.order_number}</strong></td>
                      <td>{order.warehouse_name || "—"}</td>
                      <td>{formatPurchaseDate(order.date || String(order.created_at || "").slice(0, 10))}</td>
                      <td>{formatPurchaseRegistered(order.registered_at || order.created_at)}</td>
                      <td className="report-total-price">{money(order.total_amount)}</td>
                      <td className="client-debt-money">{allocated?.repaid
                        ? <span className="client-order-debt is-repaid">Оплачен</span>
                        : <span className="client-order-debt is-open">{money(open)}</span>}</td>
                      <td className="client-order-actions">{allocated?.repaid
                        ? <span className="client-order-paid" role="img" aria-label={label} title={label}><svg className="client-order-paid__mark" width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="14.5" cy="18" r="10.5" stroke="#a4b6af" strokeWidth="1.2" strokeDasharray=".6 3" strokeLinecap="round" /><path d="M6.5 16.5L11.8 19.5C16 13.2 21.1 8.1 28.5 5.5C22.9 10.7 17.9 17.7 12.3 27L6.5 16.5Z" fill="#00964e" /></svg></span>
                        : <button type="button" className="client-order-pay" aria-label={label} title={label}
                          onClick={(event) => { event.stopPropagation(); payment.open({ limit: open, comment: purchaseRepaymentComment(order) }); }}
                          onKeyDown={(event) => event.stopPropagation()}>
                          <Icon name="bi-cash-coin" size={16} />
                        </button>}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <section className="client-repayments" aria-label="Оплаты поставщику">
          <h3>{bottom.title}</h3>
          {payments.loading ? <p role="status">Загрузка оплат…</p>
            : payments.error ? <p role="alert">Не удалось загрузить оплаты.</p>
            : !bottom.rows.length ? <p>{bottom.empty}</p>
            : <RepaymentTable rows={bottom.rows} onEdit={payment.edit} paymentTypes={paymentTypes} />}
        </section>
      </section>
      {payment.drawer}
      {dialog}
    </div>
  );
}

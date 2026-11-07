import { useEffect, useRef, useState } from "react";
import { isCancellationAcknowledged, useCancellationAcknowledgements } from "../../hooks/useCancellationAcknowledgements";
import { formatMoney } from "./reportMoney";
import "./cancelledOrderDetails.css";

const orderTypes = { dine_in: "На месте", takeaway: "На вынос", delivery: "Доставка", qr: "QR" };

export default function CancelledOrderDetails({ order }) {
  const heading = useRef(null);
  const { receipts, acknowledge } = useCancellationAcknowledgements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const latestEvent = order.items.map(item => item.reportEventAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
  const acknowledged = isCancellationAcknowledged(receipts, order.orderId, latestEvent);
  const savingRef = useRef(false);
  async function handleAcknowledge() {
    if (savingRef.current || !order.orderId || acknowledged) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try { await acknowledge(order.orderId); }
    catch { setError("Не удалось сохранить отметку. Попробуйте ещё раз."); }
    finally { savingRef.current = false; setSaving(false); }
  }
  useEffect(() => {
    heading.current?.focus();
  }, [order.id]);
  return <section className="cancelled-report-page cancelled-order-details owner-report-view">
    <article className="cancelled-report-card owner-report-surface">
      <header className="owner-report-header"><div className="owner-report-heading"><span className="report-accent-bar" aria-hidden="true" /><div><span className="owner-report-kicker">Отчёты / Отменённые блюда</span><h1 ref={heading} tabIndex={-1}>Заказ №{order.orderNumber}</h1></div></div>
        <button type="button" className="cancelled-order-ack" onClick={handleAcknowledge} disabled={!order.orderId || saving || acknowledged}>{saving ? "Сохранение…" : acknowledged ? "Ознакомлен ✓" : "Ознакомлен"}</button>
      </header>
      {error ? <div role="alert" className="login-error">{error}</div> : null}
      <div className="cancelled-order-details__scroll owner-report-table-scroll" tabIndex={0}>
        <table className="cancelled-table owner-report-table" aria-label={`Отменённые позиции заказа ${order.orderNumber}`}>
          <thead><tr>{["Номер заказа", "Дата", "Название", "Номер стола", "Кол-во", "Автор", "Тип", "Сумма"].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{order.items.map((item, index) => <tr key={`${item.id}:${index}`}>
            <td>{item.orderNumber}</td><td>{item.date || "—"}</td><td><strong>{item.name}</strong></td>
            <td>{item.tableNumber ?? "—"}</td><td>{item.quantity}</td><td>{item.authorName ?? "—"}</td>
            <td>{orderTypes[item.orderType] || item.orderType || "—"}</td><td>{item.amount == null ? "—" : formatMoney(item.amount)}</td>
          </tr>)}</tbody>
          <tfoot><tr><td colSpan={7}>Итого</td><td>{order.amount == null ? "—" : formatMoney(order.amount)}</td></tr></tfoot>
        </table>
      </div>
    </article>
  </section>;
}

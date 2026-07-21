import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, formatMoney } from "../api/client";
import { printKitchenReceipt, printOrderReceipt } from "../api/receipt";
import { formatDateLabel, todayInputValue } from "../utils/date";

function orderItemsLabel(order) {
  const items = order.items || [];
  if (!items.length) return "Позиции не загружены";
  return items.map((item) => `${item.name} x${Number(item.quantity || 1)}`).join(", ");
}

export default function OrdersPage() {
  const outlet = useOutletContext();
  const { selectedDate = todayInputValue() } = outlet || {};
  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [error, setError] = useState("");
  const [printState, setPrintState] = useState({ id: "", type: "", loading: false, message: "", error: "" });

  useEffect(() => {
    setError("");
    api.get("/pos/orders", { params: { date: selectedDate } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : [];
        setOrders(items);
        setSelectedOrderId((current) => current || items[0]?.id || null);
      })
      .catch((err) => { setOrders([]); setError(err.response?.data?.detail || "Не удалось загрузить заказы."); });
  }, [selectedDate]);

  const selectedOrder = useMemo(
    () => orders.find((order) => String(order.id) === String(selectedOrderId)) || null,
    [orders, selectedOrderId],
  );

  async function handlePrint(order, type) {
    setPrintState({ id: order.id, type, loading: true, message: "", error: "" });
    const result = type === "kitchen"
      ? await printKitchenReceipt(order.id)
      : await printOrderReceipt(order.id);
    setPrintState({
      id: order.id,
      type,
      loading: false,
      message: result.ok ? "Печать отправлена." : "",
      error: result.ok ? "" : result.detail,
    });
  }

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div>
          <span className="eyebrow">Orders</span>
          <h2>Заказы за {formatDateLabel(selectedDate)}</h2>
        </div>
      </div>
      {error ? <div className="login-error">{error}</div> : null}
      {printState.error ? <div className="message message-error">{printState.error}</div> : null}
      {printState.message ? <div className="message message-success">{printState.message}</div> : null}
      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th>Номер</th>
              <th>Тип</th>
              <th>Статус</th>
              <th>Стол</th>
              <th>Сумма</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const printing = printState.loading && printState.id === order.id;
              return (
                <tr key={order.id}>
                  <td>{order.order_number}</td>
                  <td>{order.order_type}</td>
                  <td><span className="badge badge-info">{order.status}</span></td>
                  <td>{order.table_number || "-"}</td>
                  <td>{formatMoney(order.total_amount)}</td>
                  <td>
                    <div className="order-row-actions">
                      <button className="receipt-mini-btn" type="button" onClick={() => setSelectedOrderId(order.id)}>
                        Детали
                      </button>
                      <button className="receipt-mini-btn" type="button" disabled={printing} onClick={() => handlePrint(order, "customer")}>
                        {printing && printState.type === "customer" ? "Печать..." : "Печать"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!orders.length ? <tr><td colSpan="6">Заказов за этот день нет.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {selectedOrder ? (
        <aside className="order-details-panel">
          <div className="order-details-panel__head">
            <div>
              <span className="eyebrow">Детали заказа</span>
              <h3>Заказ #{selectedOrder.order_number}</h3>
              <p className="muted">Стол {selectedOrder.table_number || "-"} · {selectedOrder.status}</p>
            </div>
            <strong>{formatMoney(selectedOrder.total_amount)}</strong>
          </div>
          <div className="order-details-panel__items">
            {(selectedOrder.items || []).map((item) => (
              <div className="order-details-panel__item" key={item.id || item.name}>
                <span>{item.name} x{Number(item.quantity || 1)}</span>
                <b>{formatMoney(item.total || Number(item.price || 0) * Number(item.quantity || 1))}</b>
              </div>
            ))}
            {!selectedOrder.items?.length ? <div className="muted">{orderItemsLabel(selectedOrder)}</div> : null}
          </div>
          {selectedOrder.note ? <p className="muted">Комментарий: {selectedOrder.note}</p> : null}
          <div className="order-details-panel__actions">
            <div className="receipt-inline-actions">
              <button className="btn btn-primary" type="button" disabled={printState.loading} onClick={() => handlePrint(selectedOrder, "customer")}>
                Печать клиентского чека
              </button>
              <button className="btn btn-ghost" type="button" disabled={printState.loading} onClick={() => handlePrint(selectedOrder, "kitchen")}>
                Печать кухонного чека
              </button>
            </div>
          </div>
        </aside>
      ) : null}
    </section>
  );
}

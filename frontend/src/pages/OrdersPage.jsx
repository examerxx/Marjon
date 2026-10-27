import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { formatMoney } from "../api/client";
import { ordersService } from "../api/orders";
import { printKitchenReceipt, printOrderReceipt } from "../api/receipt";
import { formatDateLabel, todayInputValue } from "../utils/date";
import { isAbortError, useLatestRequest, useMutationLocks } from "../hooks/useAsyncSafety";
import { t } from "../i18n/t";

function orderItemsLabel(order) {
  const items = order.items || [];
  if (!items.length) return "Позиции не загружены";
  return items.map((item) => `${item.name} x${Number(item.quantity || 1)}`).join(", ");
}

export default function OrdersPage() {
  const outlet = useOutletContext();
  const { selectedDate = todayInputValue() } = outlet || {};
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [error, setError] = useState("");
  const [printState, setPrintState] = useState({ id: "", type: "", loading: false, message: "", error: "" });
  const beginRequest = useLatestRequest();
  const { acquire, release } = useMutationLocks();

  useEffect(() => {
    const request = beginRequest();
    setOrders([]);
    setSelectedOrderId(null);
    setLoading(true);
    setError("");
    ordersService.list({ date: selectedDate }, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : [];
        setOrders(items);
        setSelectedOrderId((current) => (
          items.some((item) => String(item.id) === String(current)) ? current : items[0]?.id || null
        ));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setOrders([]);
        setSelectedOrderId(null);
        setError(err.response?.data?.detail || "Не удалось загрузить заказы.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [beginRequest, selectedDate]);

  const selectedOrder = useMemo(
    () => orders.find((order) => String(order.id) === String(selectedOrderId)) || null,
    [orders, selectedOrderId],
  );

  async function handlePrint(order, type) {
    const lockKey = `order-print:${order.id}:${type}`;
    if (!acquire(lockKey)) return;
    setPrintState({ id: order.id, type, loading: true, message: "", error: "" });
    try {
      await (type === "kitchen" ? printKitchenReceipt(order.id) : printOrderReceipt(order.id));
      setPrintState({ id: order.id, type, loading: false, message: t("pages.orderspage.pechat_otpravlena"), error: "" });
    } catch (error) {
      setPrintState({
        id: order.id,
        type,
        loading: false,
        message: "",
        error: error.response?.data?.detail || "Принтер API недоступен.",
      });
    } finally {
      release(lockKey);
    }
  }

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div>
          <span className="eyebrow">{t("eyebrow.orders")}</span>
          <h2>{t("pages.orderspage.zakazy_za")} {formatDateLabel(selectedDate)}</h2>
        </div>
      </div>
      {error ? <div className="login-error" role="alert">{error}</div> : null}
      {printState.error ? <div className="message message-error">{printState.error}</div> : null}
      {printState.message ? <div className="message message-success">{printState.message}</div> : null}
      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("pages.orderspage.nomer")}</th>
              <th>{t("pages.orderspage.tip")}</th>
              <th>{t("pages.orderspage.status")}</th>
              <th>{t("pages.orderspage.stol")}</th>
              <th>{t("pages.orderspage.summa")}</th>
              <th>{t("pages.orderspage.deystviya")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="6" role="status">{t("pages.orderspage.zagruzka")}</td></tr> : orders.map((order) => {
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
                       {t("pages.orderspage.detali")}
                      </button>
                      <button className="receipt-mini-btn" type="button" disabled={printing} onClick={() => handlePrint(order, "customer")}>
                        {printing && printState.type === "customer" ? "Печать..." : "Печать"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && !error && !orders.length ? <tr><td colSpan="6">{t("pages.orderspage.zakazov_za_etot_den_net")}</td></tr> : null}
          </tbody>
        </table>
      </div>

      {selectedOrder ? (
        <aside className="order-details-panel">
          <div className="order-details-panel__head">
            <div>
              <span className="eyebrow">{t("pages.orderspage.detali_zakaza")}</span>
              <h3>{t("pages.orderspage.zakaz")}{selectedOrder.order_number}</h3>
              <p className="muted">{t("pages.orderspage.stol")} {selectedOrder.table_number || "-"} · {selectedOrder.status}</p>
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
          {selectedOrder.note ? <p className="muted">{t("pages.orderspage.kommentariy")} {selectedOrder.note}</p> : null}
          <div className="order-details-panel__actions">
            <div className="receipt-inline-actions">
              <button className="btn btn-primary" type="button" disabled={printState.loading} onClick={() => handlePrint(selectedOrder, "customer")}>
               {t("pages.orderspage.pechat_klientskogo_cheka")}
              </button>
              <button className="btn btn-ghost" type="button" disabled={printState.loading} onClick={() => handlePrint(selectedOrder, "kitchen")}>
               {t("pages.orderspage.pechat_kuhonnogo_cheka")}
              </button>
            </div>
          </div>
        </aside>
      ) : null}
    </section>
  );
}

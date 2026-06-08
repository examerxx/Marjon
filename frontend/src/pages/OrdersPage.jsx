import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, formatMoney } from "../api/client";
import { formatDateLabel, todayInputValue } from "../utils/date";

const STATUS_BADGE = {
  new: "badge-info",
  accepted: "badge-info",
  cooking: "badge-warning",
  ready: "badge-success",
  completed: "badge-success",
  cancelled: "badge-danger",
  paid: "badge-success",
};

const STATUS_LABEL = {
  new: "Новый",
  accepted: "Принят",
  cooking: "Готовится",
  ready: "Готов",
  completed: "Завершён",
  cancelled: "Отменён",
  paid: "Оплачен",
};

export default function OrdersPage() {
  const { selectedDate = todayInputValue() } = useOutletContext();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api
      .get("/pos/orders", { params: { date: selectedDate } })
      .then(({ data }) => setOrders(Array.isArray(data) ? data : data.items || []))
      .catch((err) =>
        setError(err.response?.data?.detail || "Не удалось загрузить заказы."),
      );
  }, [selectedDate]);

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div>
          <span className="eyebrow">Orders</span>
          <h2>Заказы за {formatDateLabel(selectedDate)}</h2>
        </div>
      </div>
      {error ? <div className="login-error">{error}</div> : null}
      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th>Номер</th>
              <th>Тип</th>
              <th>Статус</th>
              <th>Стол</th>
              <th>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>{order.order_number}</td>
                <td>{order.order_type}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[order.status] || "badge-info"}`}>
                    {STATUS_LABEL[order.status] || order.status}
                  </span>
                </td>
                <td>{order.table_number || "-"}</td>
                <td>{formatMoney(order.total_amount)}</td>
              </tr>
            ))}
            {!orders.length ? (
              <tr>
                <td colSpan="5">Заказов за этот день нет.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

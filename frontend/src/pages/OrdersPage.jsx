import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, formatMoney } from "../api/client";
import { formatDateLabel, todayInputValue } from "../utils/date";

export default function OrdersPage() {
  const { selectedDate = todayInputValue() } = useOutletContext();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api.get("/pos/orders", { params: { date: selectedDate } })
      .then(({ data }) => setOrders(data))
      .catch((err) => setError(err.response?.data?.detail || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0437\u0430\u043a\u0430\u0437\u044b."));
  }, [selectedDate]);

  return (
    <section className="card card-pad">
      <div className="section-header"><div><span className="eyebrow">Orders</span><h2>{"\u0417\u0430\u043a\u0430\u0437\u044b \u0437\u0430"} {formatDateLabel(selectedDate)}</h2></div></div>
      {error ? <div className="login-error">{error}</div> : null}
      <div className="table-responsive">
        <table className="data-table"><thead><tr><th>{"\u041d\u043e\u043c\u0435\u0440"}</th><th>{"\u0422\u0438\u043f"}</th><th>{"\u0421\u0442\u0430\u0442\u0443\u0441"}</th><th>{"\u0421\u0442\u043e\u043b"}</th><th>{"\u0421\u0443\u043c\u043c\u0430"}</th></tr></thead><tbody>
          {orders.map((order) => <tr key={order.id}><td>{order.order_number}</td><td>{order.order_type}</td><td><span className="badge badge-info">{order.status}</span></td><td>{order.table_number || "-"}</td><td>{formatMoney(order.total_amount)}</td></tr>)}
          {!orders.length ? <tr><td colSpan="5">{"\u0417\u0430\u043a\u0430\u0437\u043e\u0432 \u0437\u0430 \u044d\u0442\u043e\u0442 \u0434\u0435\u043d\u044c \u043d\u0435\u0442."}</td></tr> : null}
        </tbody></table>
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, formatMoney, formatNumber } from "../api/client";
import { formatDateLabel, todayInputValue } from "../utils/date";

function getDayRange(date) {
  return { date_from: date, date_to: date };
}

export default function AnalyticsPage() {
  const { selectedDate = todayInputValue() } = useOutletContext();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api.get("/analytics/sales", { params: getDayRange(selectedDate) })
      .then(({ data }) => setRows(Array.isArray(data) ? data : data.items || []))
      .catch((err) => setError(err.response?.data?.detail || "Не удалось загрузить аналитику."));
  }, [selectedDate]);

  return (
    <section className="card card-pad">
      <div className="section-header"><div><span className="eyebrow">Analytics</span><h2>{"\u041f\u0440\u043e\u0434\u0430\u0436\u0438 \u0437\u0430"} {formatDateLabel(selectedDate)}</h2></div></div>
      {error ? <div className="login-error">{error}</div> : null}
      <div className="table-responsive"><table className="data-table"><thead><tr><th>{"\u0414\u0430\u0442\u0430"}</th><th>{"\u0417\u0430\u043a\u0430\u0437\u044b"}</th><th>{"\u0412\u044b\u0440\u0443\u0447\u043a\u0430"}</th><th>{"\u0421\u0440\u0435\u0434\u043d\u0438\u0439 \u0447\u0435\u043a"}</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.date}><td>{row.date}</td><td>{formatNumber(row.orders_count)}</td><td>{formatMoney(row.revenue)}</td><td>{formatMoney(row.avg_check)}</td></tr>)}
        {!rows.length ? <tr><td colSpan="4">{"\u0414\u0430\u043d\u043d\u044b\u0445 \u043f\u043e \u043f\u0440\u043e\u0434\u0430\u0436\u0430\u043c \u0437\u0430 \u044d\u0442\u043e\u0442 \u0434\u0435\u043d\u044c \u043d\u0435\u0442."}</td></tr> : null}
      </tbody></table></div>
    </section>
  );
}

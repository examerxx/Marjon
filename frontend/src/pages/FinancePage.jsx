import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, formatMoney, formatNumber } from "../api/client";
import { formatDateLabel, todayInputValue } from "../utils/date";

function getDayRange(date) {
  return { date_from: date, date_to: date };
}

export default function FinancePage() {
  const { selectedDate = todayInputValue() } = useOutletContext();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api.get("/analytics/sales", { params: getDayRange(selectedDate) })
      .then(({ data }) => setRows(Array.isArray(data) ? data : data.items || []))
      .catch((err) => setError(err.response?.data?.detail || "Не удалось загрузить финансы."));
  }, [selectedDate]);

  const totals = useMemo(() => rows.reduce((acc, row) => {
    acc.revenue += Number(row.revenue || 0);
    acc.orders += Number(row.orders_count || 0);
    return acc;
  }, { revenue: 0, orders: 0 }), [rows]);

  return (
    <>
      <section className="kpi-grid">
        <article className="kpi-card compact"><div className="kpi-icon orange"><i className="bi bi-cash-stack" /></div><div><div className="kpi-label">{"\u0412\u044b\u0440\u0443\u0447\u043a\u0430 \u0437\u0430 \u0434\u0435\u043d\u044c"}</div><div className="kpi-value">{formatMoney(totals.revenue)}</div></div></article>
        <article className="kpi-card compact"><div className="kpi-icon blue"><i className="bi bi-receipt" /></div><div><div className="kpi-label">{"\u0417\u0430\u043a\u0430\u0437\u043e\u0432"}</div><div className="kpi-value">{formatNumber(totals.orders)}</div></div></article>
        <article className="kpi-card compact"><div className="kpi-icon green"><i className="bi bi-graph-up" /></div><div><div className="kpi-label">{"\u0421\u0440\u0435\u0434\u043d\u0438\u0439 \u0447\u0435\u043a"}</div><div className="kpi-value">{formatMoney(totals.orders ? totals.revenue / totals.orders : 0)}</div></div></article>
      </section>
      <section className="card card-pad">
        <div className="section-header"><div><span className="eyebrow">Finance</span><h2>{"\u0424\u0438\u043d\u0430\u043d\u0441\u043e\u0432\u0430\u044f \u0441\u0432\u043e\u0434\u043a\u0430 \u0437\u0430"} {formatDateLabel(selectedDate)}</h2></div></div>
        {error ? <div className="login-error">{error}</div> : null}
        <p>{"\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0435 \u043f\u0440\u043e\u0434\u0430\u0436 \u0437\u0430 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u0434\u0435\u043d\u044c."}</p>
      </section>
    </>
  );
}

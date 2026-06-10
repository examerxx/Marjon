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
      .then(({ data }) => setRows(data))
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
        <article className="kpi-card compact"><div className="kpi-icon orange"><i className="bi bi-cash-stack" /></div><div><div className="kpi-label">Выручка за день</div><div className="kpi-value">{formatMoney(totals.revenue)}</div></div></article>
        <article className="kpi-card compact"><div className="kpi-icon blue"><i className="bi bi-receipt" /></div><div><div className="kpi-label">Заказов</div><div className="kpi-value">{formatNumber(totals.orders)}</div></div></article>
        <article className="kpi-card compact"><div className="kpi-icon green"><i className="bi bi-graph-up" /></div><div><div className="kpi-label">Средний чек</div><div className="kpi-value">{formatMoney(totals.orders ? totals.revenue / totals.orders : 0)}</div></div></article>
      </section>
      <section className="card card-pad">
        <div className="section-header"><div><span className="eyebrow">Finance</span><h2>Финансовая сводка за {formatDateLabel(selectedDate)}</h2></div></div>
        {error ? <div className="login-error">{error}</div> : null}
        {rows.length > 0 ? (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Канал / Категория</th>
                  <th>Заказов</th>
                  <th>Выручка</th>
                  <th>Ср. чек</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx}>
                    <td><strong>{row.category || row.channel || `Канал ${idx + 1}`}</strong></td>
                    <td>{formatNumber(row.orders_count || 0)}</td>
                    <td>{formatMoney(row.revenue || 0)}</td>
                    <td>{formatMoney(row.orders_count ? (row.revenue || 0) / row.orders_count : 0)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border, #e4e7ec)" }}>
                  <td>Итого</td>
                  <td>{formatNumber(totals.orders)}</td>
                  <td>{formatMoney(totals.revenue)}</td>
                  <td>{formatMoney(totals.orders ? totals.revenue / totals.orders : 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state__icon"><i className="bi bi-calendar-x" /></div>
            <h3>Нет данных</h3>
            <p>За {formatDateLabel(selectedDate)} продаж не зафиксировано. Выберите другую дату в шапке.</p>
          </div>
        )}
      </section>
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { currentMonthRange, toApiDate } from "./reports/reportPeriod";
import { formatMoney } from "./reports/reportMoney";

export default function WaitersReportPage() {
  const [selectedWaiter, setSelectedWaiter] = useState("all");
  const [dateRange, setDateRange] = useState(currentMonthRange);
  const [waiters, setWaiters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beginRequest = useLatestRequest();

  useEffect(() => {
    const request = beginRequest();
    const dateFrom = toApiDate(dateRange.start);
    const dateTo = toApiDate(dateRange.end);
    setLoading(true);
    setError("");
    if (!isOrderedDateRange(dateFrom, dateTo)) {
      setWaiters([]);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false);
      return;
    }
    reportsService.listWaiters(dateFrom, dateTo, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        if (!Array.isArray(data)) throw new Error("Invalid waiters report response");
        const items = data;
        setWaiters(items.map((item, index) => ({
          key: item.waiter_id == null ? `unassigned-${index}-${item.name}` : String(item.waiter_id),
          waiterId: item.waiter_id,
          name: item.name,
          ordersCount: Number(item.orders_count),
          ordersTotal: Number(item.orders_total),
          dishesCount: Number(item.dishes_count),
        })));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setWaiters([]);
        setError(err.response?.data?.detail || "Не удалось загрузить отчёт по официантам.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [beginRequest, dateRange.start, dateRange.end]);

  const visibleRows = useMemo(() => selectedWaiter === "all" ? waiters : waiters.filter((waiter) => waiter.key === selectedWaiter), [selectedWaiter, waiters]);
  const totals = useMemo(() => visibleRows.reduce((acc, waiter) => ({
    ordersCount: acc.ordersCount + waiter.ordersCount,
    ordersTotal: acc.ordersTotal + waiter.ordersTotal,
    dishesCount: acc.dishesCount + waiter.dishesCount,
  }), { ordersCount: 0, ordersTotal: 0, dishesCount: 0 }), [visibleRows]);

  function handleExport() {
    exportToExcel(visibleRows, [
      { key: "waiterId", label: "ID официанта" },
      { key: "name", label: "Имя" },
      { key: "ordersCount", label: "Количество заказов" },
      { key: "ordersTotal", label: "Сумма заказов" },
      { key: "dishesCount", label: "Количество блюд" },
    ], "waiters-report");
  }

  if (loading) return <section className="z-waiters-report"><div className="dashboard-empty" role="status">Загрузка отчёта...</div></section>;
  if (error) return <section className="z-waiters-report"><div className="login-error" role="alert">{error}</div></section>;

  return (
    <section className="waiters-report-page owner-report-view">
      <article className="waiters-report-card z-waiters-report owner-report-surface">
        <div className="z-waiters-report__head owner-report-header">
          <div className="z-waiters-report__title owner-report-heading"><span aria-hidden="true" /><div><span className="owner-report-kicker">Отчёты</span><h1>Отчёт по официантам</h1></div></div>
          <div className="z-waiters-report__controls owner-report-actions">
            <ReportDateRangePicker variant="canonical" value={dateRange} onChange={setDateRange} buttonAriaLabel="Период отчёта по официантам" />
            <label className="z-waiters-report__select"><select aria-label="Официант" value={selectedWaiter} onChange={(event) => setSelectedWaiter(event.target.value)}><option value="all">Все официанты</option>{waiters.map((waiter) => <option key={waiter.key} value={waiter.key}>{waiter.name}</option>)}</select><Icon name="bi-chevron-down" size={18} /></label>
            <button className="z-waiters-report__excel owner-report-excel" type="button" onClick={handleExport}><Icon name="bi-file-earmark-excel" size={18} /> Скачать Excel</button>
          </div>
        </div>

        <div className="report-table-wrapper owner-report-table-scroll">
          <table className="report-table owner-report-table" aria-label="Отчёт по официантам">
            <thead><tr><th>Имя</th><th>Количество заказов</th><th>Сумма заказов</th><th>Количество блюд</th></tr></thead>
            <tbody>
              <tr className="z-waiters-report__row--total"><td><strong>Всего</strong></td><td>{totals.ordersCount}</td><td>{formatMoney(totals.ordersTotal)}</td><td>{totals.dishesCount}</td></tr>
              {visibleRows.map((waiter) => <tr key={waiter.key}><td><strong>{waiter.name}</strong></td><td>{waiter.ordersCount}</td><td>{formatMoney(waiter.ordersTotal)}</td><td>{waiter.dishesCount}</td></tr>)}
              {!visibleRows.length ? <tr className="report-empty-row"><td colSpan={4}><div className="owner-report-empty" role="status"><span className="owner-report-empty__icon"><Icon name="bi-people" size={18} /></span><div><strong>Данных по официантам нет</strong><span>Выберите другой период или официанта.</span></div></div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

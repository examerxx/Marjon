import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "../api/client";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";

const rowsPerPage = 5;

function currentMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${day}`,
    periodPreset: "",
    startTime: "00:00",
    endTime: "00:00",
  };
}

function toPickerDate(value) {
  const [year, month, day] = String(value || "").split("-");
  return year && month && day ? `${day}.${month}.${year}` : "";
}

function toApiDate(value) {
  const [day, month, year] = String(value || "").split(".");
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function formatDateTime(date, time) {
  return time ? `${date} / ${time}` : date;
}

export default function CancelledDishesReportPage() {
  const [filters, setFilters] = useState(() => ({ ...currentMonthRange(), waiter: "all", query: "" }));
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beginRequest = useLatestRequest();

  useEffect(() => {
    const request = beginRequest();
    setLoading(true);
    setError("");
    if (!isOrderedDateRange(appliedFilters.from, appliedFilters.to)) {
      setRows([]);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false);
      return;
    }
    reportsService.listCancelledDishes(appliedFilters.from, appliedFilters.to, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        if (!Array.isArray(data)) throw new Error("Invalid cancelled-items report response");
        const items = data;
        setRows(items.map((item, index) => ({
          key: `${item.date}-${item.time}-${item.order_number}-${item.name}-${index}`,
          date: item.date,
          time: item.time,
          orderNumber: item.order_number,
          tableNumber: item.table_number,
          name: item.name,
          waiterName: item.waiter_name,
          unit: item.unit,
          quantity: Number(item.quantity),
          price: Number(item.price),
        })));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить отчёт по отменённым блюдам.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [appliedFilters.from, appliedFilters.to, beginRequest]);

  const waiters = useMemo(() => [...new Set(rows.map((row) => row.waiterName).filter(Boolean))], [rows]);
  const filteredRows = useMemo(() => {
    const query = appliedFilters.query.trim().toLowerCase();
    return rows.filter((row) => (appliedFilters.waiter === "all" || row.waiterName === appliedFilters.waiter)
      && (!query || [row.name, row.orderNumber, row.tableNumber, row.waiterName].some((value) => String(value ?? "").toLowerCase().includes(query))));
  }, [rows, appliedFilters]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
  const visibleRows = filteredRows.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const periodValue = {
    preset: filters.periodPreset,
    start: toPickerDate(filters.from),
    end: toPickerDate(filters.to),
    startTime: filters.startTime,
    endTime: filters.endTime,
  };

  function updatePeriod(nextPeriod) {
    setFilters((current) => ({
      ...current,
      from: toApiDate(nextPeriod.start),
      to: toApiDate(nextPeriod.end),
      periodPreset: nextPeriod.preset || "",
      startTime: nextPeriod.startTime || "00:00",
      endTime: nextPeriod.endTime || "00:00",
    }));
  }

  function applyFilters() {
    setAppliedFilters(filters);
    setPage(1);
  }

  function downloadExcel() {
    exportToExcel(filteredRows, [
      { key: "date", label: "Дата" },
      { key: "time", label: "Время" },
      { key: "orderNumber", label: "Номер заказа" },
      { key: "tableNumber", label: "Номер стола" },
      { key: "name", label: "Название" },
      { key: "waiterName", label: "Официант" },
      { key: "unit", label: "Единица измерения" },
      { key: "quantity", label: "Количество" },
      { key: "price", label: "Цена" },
    ], "cancelled-dishes-report");
  }

  if (loading) return <section className="cancelled-report-page"><div className="dashboard-empty" role="status">Загрузка отчёта...</div></section>;
  if (error) return <section className="cancelled-report-page"><div className="login-error" role="alert">{error}</div></section>;

  return (
    <section className="cancelled-report-page owner-report-view">
      <article className="cancelled-report-card owner-report-surface">
        <div className="cancelled-report-head owner-report-header">
          <div className="cancelled-report-title owner-report-heading"><span className="cancelled-report-title__mark" aria-hidden="true" /><div><span className="cancelled-report-eyebrow owner-report-kicker">Отчёты</span><h1>Отчёт по отменённым блюдам</h1></div></div>
          <div className="cancelled-report-actions owner-report-actions">
            <ReportDateRangePicker variant="canonical" value={periodValue} onChange={updatePeriod} buttonAriaLabel="Период отчёта по отменённым блюдам" />
            <button className="cancelled-report-excel owner-report-excel" type="button" onClick={downloadExcel}><Icon name="bi-file-earmark-excel" size={18} /> Скачать Excel</button>
          </div>
        </div>

        <div className="cancelled-filter-panel">
          <label><span>Официант</span><select value={filters.waiter} onChange={(event) => setFilters((current) => ({ ...current, waiter: event.target.value }))}><option value="all">Все официанты</option>{waiters.map((waiter) => <option key={waiter} value={waiter}>{waiter}</option>)}</select></label>
          <label className="cancelled-filter-panel__search"><span>Поиск</span><input value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="Блюдо, заказ, стол, официант" /></label>
          <button className="cancelled-filter-button" type="button" onClick={applyFilters}><Icon name="bi-sliders" size={18} /> Фильтровать</button>
        </div>

        <div className="cancelled-table-wrap owner-report-table-scroll">
          <table className="cancelled-table owner-report-table" aria-label="Отчёт по отменённым блюдам">
            <thead><tr><th>Дата</th><th>Номер заказа</th><th>Номер стола</th><th>Название</th><th>Официант</th><th>Ед. изм.</th><th>Количество</th><th>Цена</th></tr></thead>
            <tbody>
              {visibleRows.map((row) => <tr key={row.key}><td>{formatDateTime(row.date, row.time)}</td><td>{row.orderNumber}</td><td>{row.tableNumber ?? "—"}</td><td><strong>{row.name}</strong></td><td>{row.waiterName ?? "—"}</td><td>{row.unit}</td><td>{row.quantity}</td><td>{formatMoney(row.price, "UZS")}</td></tr>)}
              {!visibleRows.length ? <tr className="cancelled-empty-row"><td colSpan={8}><div className="owner-report-empty" role="status"><span className="owner-report-empty__icon"><Icon name="bi-x-octagon" size={18} /></span><div><strong>Отменённых блюд нет</strong><span>За выбранный период и фильтры отмены не найдены.</span></div></div></td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="cancelled-pagination"><span>Показано {visibleRows.length} из {filteredRows.length}</span><div><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} aria-label="Предыдущая страница"><Icon name="bi-chevron-left" size={18} /></button>{Array.from({ length: totalPages }, (_, index) => index + 1).map((item) => <button type="button" key={item} className={page === item ? "is-active" : ""} onClick={() => setPage(item)}>{item}</button>)}<button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} aria-label="Следующая страница"><Icon name="bi-chevron-right" size={18} /></button></div></div>
      </article>
    </section>
  );
}

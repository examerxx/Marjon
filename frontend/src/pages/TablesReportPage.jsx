import { useEffect, useState } from "react";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { currentMonthRange, toApiDate } from "./reports/reportPeriod";
import { formatMoney } from "./reports/reportMoney";

const initialFilters = {
  tableNumber: "",
  waiterId: "all",
  paymentMethod: "all",
  cashierId: "all",
  hallId: "all",
};

const emptyFilterOptions = {
  waiters: [],
  cashiers: [],
  payment_methods: [],
  places: [],
  place_filter_supported: false,
};

function FilterSelect({ label, placeholder, value, options, onChange, disabled = false }) {
  return (
    <label className="report-filter-select">
      <select aria-label={label} value={value} onChange={onChange} disabled={disabled}>
        <option value="all">{placeholder}</option>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
      <Icon name="bi-chevron-down" size={16} />
    </label>
  );
}

export default function TablesReportPage() {
  const [dateRange, setDateRange] = useState(currentMonthRange);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [filterOptions, setFilterOptions] = useState(emptyFilterOptions);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beginRequest = useLatestRequest();
  const beginOptionsRequest = useLatestRequest();

  useEffect(() => {
    const request = beginOptionsRequest();
    setFilterOptionsLoading(true);
    reportsService.getTablesFilters({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        setFilterOptions({ ...emptyFilterOptions, ...(data || {}) });
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setFilterOptions(emptyFilterOptions);
      })
      .finally(() => { if (request.isCurrent()) setFilterOptionsLoading(false); });
  }, [beginOptionsRequest]);

  useEffect(() => {
    const request = beginRequest();
    const dateFrom = toApiDate(dateRange.start);
    const dateTo = toApiDate(dateRange.end);
    setLoading(true);
    setError("");
    if (!isOrderedDateRange(dateFrom, dateTo)) {
      setRows([]);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false);
      return;
    }
    reportsService.listTables(dateFrom, dateTo, { filters: appliedFilters, signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        if (!Array.isArray(data)) throw new Error("Invalid tables report response");
        const items = data;
        setRows(items.map((item) => ({
          tableNumber: String(item.table_number),
          ordersCount: Number(item.orders_count),
          revenue: Number(item.revenue),
          avgCheck: Number(item.avg_check),
        })));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить отчёт по столам.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [
    beginRequest,
    dateRange.start,
    dateRange.end,
    appliedFilters.tableNumber,
    appliedFilters.waiterId,
    appliedFilters.paymentMethod,
    appliedFilters.cashierId,
    appliedFilters.hallId,
  ]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    setAppliedFilters(filters);
  }

  function clearFilters() {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
  }

  function downloadExcel() {
    exportToExcel(rows, [
      { key: "tableNumber", label: "Номер стола" },
      { key: "ordersCount", label: "Количество заказов" },
      { key: "revenue", label: "Выручка" },
      { key: "avgCheck", label: "Средний чек" },
    ], "tables-report");
  }

  // No full-page loader: the shell (title/controls/table header) renders
  // immediately, even while the first request pends (see the tbody branch).
  if (error) return <section className="tables-report-page"><div className="login-error" role="alert">{error}</div></section>;

  return (
    <section className="tables-report-page owner-report-view">
      <article className="report-page-card owner-report-surface">
        <div className="report-page-header owner-report-header">
          <div className="report-title-group owner-report-heading"><span className="report-accent-bar" aria-hidden="true" /><div><span className="report-eyebrow owner-report-kicker">Отчёты</span><h1>Отчёт по столам</h1></div></div>
          <div className="report-actions owner-report-actions">
            <ReportDateRangePicker variant="canonical" value={dateRange} onChange={setDateRange} buttonAriaLabel="Период отчёта по столам" />
            <button className="tables-filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="tables-report-filters" onClick={() => setFiltersOpen((value) => !value)}><Icon name="bi-sliders" size={17} /> Фильтровать</button>
            <button className="report-excel-button owner-report-excel" type="button" onClick={downloadExcel}><Icon name="bi-filetype-xlsx" size={19} strokeWidth={1.9} className="owner-report-xlsx-icon" /> Скачать Excel</button>
          </div>
        </div>

        <div className="report-filters-grid tables-filter-panel" id="tables-report-filters" aria-label="Фильтры отчёта по столам" hidden={!filtersOpen}>
          <label className="report-filter-input">
            <Icon name="bi-search" size={17} />
            <input aria-label="Номер стола" value={filters.tableNumber} onChange={(event) => updateFilter("tableNumber", event.target.value)} placeholder="Введите номер стола" />
          </label>
          <FilterSelect label="Официант" placeholder="Выберите официанта" value={filters.waiterId} options={filterOptions.waiters} onChange={(event) => updateFilter("waiterId", event.target.value)} disabled={filterOptionsLoading || !filterOptions.waiters.length} />
          <FilterSelect label="Место" placeholder={filterOptions.place_filter_supported ? "Выберите место" : "Нет связи заказа с местом"} value={filters.hallId} options={filterOptions.places} onChange={(event) => updateFilter("hallId", event.target.value)} disabled={!filterOptions.place_filter_supported || filterOptionsLoading || !filterOptions.places.length} />
          <FilterSelect label="Кассир" placeholder="Выберите кассира" value={filters.cashierId} options={filterOptions.cashiers} onChange={(event) => updateFilter("cashierId", event.target.value)} disabled={filterOptionsLoading || !filterOptions.cashiers.length} />
          <FilterSelect label="Тип оплаты" placeholder="Выберите тип оплаты" value={filters.paymentMethod} options={filterOptions.payment_methods} onChange={(event) => updateFilter("paymentMethod", event.target.value)} disabled={filterOptionsLoading || !filterOptions.payment_methods.length} />
          <div className="report-filter-buttons">
            <button type="button" className="report-filter-apply" onClick={applyFilters}><Icon name="bi-sliders" size={17} /> Фильтровать</button>
            <button type="button" className="report-filter-clear" onClick={clearFilters}><Icon name="bi-x-circle" size={17} /> Очистить</button>
          </div>
        </div>

        <div className="report-table-wrapper owner-report-table-scroll" aria-busy={loading ? "true" : "false"}>
          <table className="report-table owner-report-table" aria-label="Отчёт по столам">
            <thead><tr><th>Номер стола</th><th>Количество заказов</th><th>Выручка</th><th>Средний чек</th></tr></thead>
            <tbody>
              {rows.map((row) => <tr key={row.tableNumber}><td><strong>{row.tableNumber}</strong></td><td>{row.ordersCount}</td><td>{formatMoney(row.revenue)}</td><td>{formatMoney(row.avgCheck)}</td></tr>)}
              {!rows.length ? <tr className="report-empty-row" aria-hidden={loading || undefined}><td colSpan={4}><div className="owner-report-empty" role="status" style={loading ? { visibility: "hidden" } : undefined}><span className="owner-report-empty__icon"><Icon name="bi-grid-3x3-gap" size={18} /></span><div><strong>Столов не найдено</strong><span>Измените период или фильтры.</span></div></div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

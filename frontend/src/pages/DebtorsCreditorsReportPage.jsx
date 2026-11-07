import { useEffect, useMemo, useState } from "react";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import "./finance/financeOverview.css";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { currentMonthRange, toApiDate } from "./reports/reportPeriod";
import { formatMoney as displayAmount } from "./reports/reportMoney";

export default function DebtorsCreditorsReportPage({ finance = false }) {
  const [dateRange, setDateRange] = useState(currentMonthRange);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftSearch, setDraftSearch] = useState("");
  const [draftDirection, setDraftDirection] = useState("all");
  const [direction, setDirection] = useState("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
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
      setRows([]);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false);
      return;
    }
    reportsService.listDebtCredit(dateFrom, dateTo, undefined, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        if (!Array.isArray(data)) throw new Error("Invalid debt-credit report response");
        const items = data;
        setRows(items.map((item) => ({
          id: String(item.counterparty_id),
          name: item.counterparty_name,
          debit: Number(item.debit),
          credit: Number(item.credit),
          closingBalance: Number(item.closing_balance),
        })));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить отчёт по дебету и кредиту.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [beginRequest, dateRange.start, dateRange.end]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(row => (!query || row.name.toLowerCase().includes(query)) && (!finance || direction === "all" || (direction === "debtors" ? row.closingBalance > 0 : row.closingBalance < 0)));
  }, [rows, search, finance, direction]);
  const totals = useMemo(() => visibleRows.reduce((acc, row) => ({
    debit: acc.debit + row.debit,
    credit: acc.credit + row.credit,
    closingBalance: acc.closingBalance + row.closingBalance,
  }), { debit: 0, credit: 0, closingBalance: 0 }), [visibleRows]);

  const receivable = rows.reduce((sum, row) => sum + Math.max(0, row.closingBalance), 0);
  const payable = rows.reduce((sum, row) => sum + Math.max(0, -row.closingBalance), 0);

  function downloadExcel() {
    exportToExcel(visibleRows, [
      { key: "id", label: "ID контрагента" },
      { key: "name", label: "Контрагент" },
      { key: "debit", label: "Дебет" },
      { key: "credit", label: "Кредит" },
      { key: "closingBalance", label: "Сальдо" },
    ], "debt-credit-report");
  }

  if (loading) return <section className="debt-credit-page"><div className="dashboard-empty" role="status">Загрузка отчёта...</div></section>;
  if (error) return <section className="debt-credit-page"><div className="login-error" role="alert">{error}</div></section>;

  return (
    <section className={finance ? "debt-credit-page finance-overview owner-report-view" : "debt-credit-page"} aria-label={finance ? "Дебиторы и кредиторы" : undefined}>
      <article className={finance ? "fo-panel dc-finance-card" : "debt-credit-card"}>
        <div className={finance ? "dc-finance-controls" : undefined}>
        <div className={finance ? "fo-toolbar" : "dc-page-head"}>
          {!finance && <div><span className="report-accent-bar" aria-hidden="true" /><div><span>{finance ? "Финансы" : "Marjon reports"}</span><h2>Дебиторы и кредиторы</h2></div></div>}
          <div className="report-actions"><ReportDateRangePicker value={dateRange} onChange={setDateRange} showDropdownIcon variant={finance ? "canonical" : undefined} buttonClassName={finance ? "fo-period-button" : undefined} /></div>{finance && <button type="button" className="orders-filter-toggle" aria-expanded={filtersOpen} aria-controls="dc-filters" onClick={() => setFiltersOpen(open => !open)}><Icon name="bi-sliders" size={17} /> Фильтровать</button>}{!finance && <button className="report-excel-button" type="button" onClick={downloadExcel}><Icon name="bi-file-earmark-excel" size={18} /> Скачать Excel</button>}
        </div>

        <div className={finance ? "dc-summary-grid fo-toolbar" : "dc-summary-grid"}>
          <article className={finance ? "fo-summary-card fo-tone--teal" : "dc-summary-card dc-summary-card--debt"}><div className="dc-summary-card__top">{finance && <Icon name="bi-arrow-down-left-circle" size={22} />}<span>{finance ? "Дебиторы" : "Дебет"}</span>{!finance && <Icon name="bi-arrow-down-left-circle" size={22} />}</div><strong>{displayAmount(finance ? receivable : totals.debit)}</strong></article>
          <article className={finance ? "fo-summary-card fo-tone--coral" : "dc-summary-card dc-summary-card--credit"}><div className="dc-summary-card__top">{finance && <Icon name="bi-arrow-up-right-circle" size={22} />}<span>{finance ? "Кредиторы" : "Кредит"}</span>{!finance && <Icon name="bi-arrow-up-right-circle" size={22} />}</div><strong>{displayAmount(finance ? payable : totals.credit)}</strong></article>
          <article className={finance ? "fo-summary-card" : "dc-summary-card dc-summary-card--balance"}><div className="dc-summary-card__top"><span>Сальдо</span><Icon name="bi-bank" size={22} /></div><strong>{displayAmount(totals.closingBalance)}</strong></article>
        </div>

        </div>
        <div className={finance ? "fo-recent" : undefined}>
          {finance ? <form id="dc-filters" hidden={!filtersOpen} onSubmit={event => {
            event.preventDefault();
            setSearch(draftSearch);
            setDirection(draftDirection);
          }}>
            <div className="report-filters-grid dc-toolbar" style={{ flexWrap: "wrap", gap: 12 }}>
              <label className="dc-search"><Icon name="bi-search" size={18} /><input aria-label="Контрагент" placeholder="Поиск по контрагенту" value={draftSearch} onChange={event => setDraftSearch(event.target.value)} /></label>
              <label>Вид задолженности <select value={draftDirection} onChange={event => setDraftDirection(event.target.value)}>
                <option value="all">Все контрагенты</option>
                <option value="debtors">Дебиторы</option>
                <option value="creditors">Кредиторы</option>
              </select></label>
              <div className="report-filter-buttons">
                <button type="submit" className="report-filter-apply"><Icon name="bi-sliders" size={17} /> Фильтровать</button>
                <button type="button" className="report-filter-clear" onClick={() => {
                  setDraftSearch("");
                  setDraftDirection("all");
                  setSearch("");
                  setDirection("all");
                }}>Очистить</button>
              </div>
            </div>
          </form> : <div className="dc-toolbar"><label className="dc-search"><Icon name="bi-search" size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Поиск по контрагенту" /></label></div>}

        <div className={finance ? "fo-table-scroll" : "dc-table-wrap"}>
          <table className="dc-table">
            <thead><tr><th>Контрагент</th><th>Дебет</th><th>Кредит</th><th>Сальдо</th></tr></thead>
            <tbody>
              <tr className="dc-total-row"><td>Итого</td><td>{displayAmount(totals.debit)}</td><td>{displayAmount(totals.credit)}</td><td>{displayAmount(totals.closingBalance)}</td></tr>
              {visibleRows.map((row) => <tr className="dc-party-row" key={row.id} data-counterparty-id={row.id}><td><strong>{row.name}</strong></td><td>{displayAmount(row.debit)}</td><td>{displayAmount(row.credit)}</td><td>{displayAmount(row.closingBalance)}</td></tr>)}
              {!visibleRows.length ? <tr className="dc-empty-row"><td colSpan={4}>По запросу ничего не найдено</td></tr> : null}
            </tbody>
          </table>
        </div>
        </div>
      </article>
    </section>
  );
}

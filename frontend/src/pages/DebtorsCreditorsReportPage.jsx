import { useEffect, useMemo, useState } from "react";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { currentMonthRange, toApiDate } from "./reports/reportPeriod";
import { formatMoney as displayAmount } from "./reports/reportMoney";
import { t } from "../i18n/t";

export default function DebtorsCreditorsReportPage() {
  const [dateRange, setDateRange] = useState(currentMonthRange);
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
          openingBalance: Number(item.opening_balance),
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
    return query ? rows.filter((row) => row.name.toLowerCase().includes(query)) : rows;
  }, [rows, search]);
  const totals = useMemo(() => visibleRows.reduce((acc, row) => ({
    openingBalance: acc.openingBalance + row.openingBalance,
    debit: acc.debit + row.debit,
    credit: acc.credit + row.credit,
    closingBalance: acc.closingBalance + row.closingBalance,
  }), { openingBalance: 0, debit: 0, credit: 0, closingBalance: 0 }), [visibleRows]);

  function downloadExcel() {
    exportToExcel(visibleRows, [
      { key: "id", label: t("pages.debtorscreditorsreportpage.id_kontragenta") },
      { key: "name", label: t("pages.debtorscreditorsreportpage.kontragent") },
      { key: "openingBalance", label: t("pages.debtorscreditorsreportpage.nachalnyy_ostatok") },
      { key: "debit", label: t("pages.debtorscreditorsreportpage.debet") },
      { key: "credit", label: t("pages.debtorscreditorsreportpage.kredit") },
      { key: "closingBalance", label: t("pages.debtorscreditorsreportpage.konechnyy_ostatok") },
    ], "debt-credit-report");
  }

  if (loading) return <section className="debt-credit-page"><div className="dashboard-empty" role="status">{t("pages.debtorscreditorsreportpage.zagruzka_otcheta")}</div></section>;
  if (error) return <section className="debt-credit-page"><div className="login-error" role="alert">{error}</div></section>;

  return (
    <section className="debt-credit-page">
      <article className="debt-credit-card">
        <div className="dc-page-head">
          <div><span className="report-accent-bar" aria-hidden="true" /><div><span>Marjon reports</span><h2>{t("pages.debtorscreditorsreportpage.debitory_i_kreditory")}</h2></div></div>
          <div className="report-actions"><ReportDateRangePicker value={dateRange} onChange={setDateRange} showDropdownIcon /><button className="report-excel-button" type="button" onClick={downloadExcel}><Icon name="bi-file-earmark-excel" size={18} /> {t("pages.debtorscreditorsreportpage.skachat_excel")}</button></div>
        </div>

        <div className="dc-summary-grid">
          <article className="dc-summary-card dc-summary-card--debt"><div className="dc-summary-card__top"><span>{t("pages.debtorscreditorsreportpage.debet")}</span><Icon name="bi-arrow-down-left-circle" size={22} /></div><strong>{displayAmount(totals.debit)}</strong></article>
          <article className="dc-summary-card dc-summary-card--credit"><div className="dc-summary-card__top"><span>{t("pages.debtorscreditorsreportpage.kredit")}</span><Icon name="bi-arrow-up-right-circle" size={22} /></div><strong>{displayAmount(totals.credit)}</strong></article>
          <article className="dc-summary-card dc-summary-card--balance"><div className="dc-summary-card__top"><span>{t("pages.debtorscreditorsreportpage.konechnyy_ostatok")}</span><Icon name="bi-bank" size={22} /></div><strong>{displayAmount(totals.closingBalance)}</strong></article>
        </div>

        <div className="dc-toolbar"><label className="dc-search"><Icon name="bi-search" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("pages.debtorscreditorsreportpage.poisk_po_kontragentu")} /></label></div>

        <div className="dc-table-wrap">
          <table className="dc-table">
            <thead><tr><th>{t("pages.debtorscreditorsreportpage.kontragent")}</th><th>{t("pages.debtorscreditorsreportpage.nachalnyy_ostatok")}</th><th>{t("pages.debtorscreditorsreportpage.debet")}</th><th>{t("pages.debtorscreditorsreportpage.kredit")}</th><th>{t("pages.debtorscreditorsreportpage.konechnyy_ostatok")}</th></tr></thead>
            <tbody>
              <tr className="dc-total-row"><td>{t("pages.debtorscreditorsreportpage.itogo")}</td><td>{displayAmount(totals.openingBalance)}</td><td>{displayAmount(totals.debit)}</td><td>{displayAmount(totals.credit)}</td><td>{displayAmount(totals.closingBalance)}</td></tr>
              {visibleRows.map((row) => <tr className="dc-party-row" key={row.id} data-counterparty-id={row.id}><td><strong>{row.name}</strong></td><td>{displayAmount(row.openingBalance)}</td><td>{displayAmount(row.debit)}</td><td>{displayAmount(row.credit)}</td><td>{displayAmount(row.closingBalance)}</td></tr>)}
              {!visibleRows.length ? <tr className="dc-empty-row"><td colSpan={5}>{t("pages.debtorscreditorsreportpage.po_zaprosu_nichego_ne_naydeno")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

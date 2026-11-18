import { ExpenseDisclosureRow } from "../components/ExpenseDisclosureRow";
import { ClientOrders, SUPPLIER_PAYMENT, useDebtRepayment } from "./settings/clients/CounterpartyHistory";
import SupplierPurchases from "./warehouse/SupplierPurchases";
import { Fragment, useEffect, useMemo, useState } from "react";
import { financeService } from "../api/finance";
import { itemsOf } from "./finance/financeTransactionsData";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import "./finance/financeOverview.css";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { currentMonthRange, toApiDate } from "./reports/reportPeriod";
import { formatMoney as displayAmount } from "./reports/reportMoney";

const partyGroups = { provider: "Поставщики", supplier: "Поставщики", client: "Клиенты", employee: "Сотрудники", other: "Другие" };
const sections = [
  { key: "debtors", label: "Дебиторы", icon: "bi-arrow-down-left-circle", tone: "fo-tone--teal" },
  { key: "creditors", label: "Кредиторы", icon: "bi-arrow-up-right-circle", tone: "fo-tone--coral" },
  { key: "all", label: "Сальдо", icon: "bi-bank", tone: "" },
];

// Кнопка «Оплатить» у поставщика в разделе «Кредиторы»: окно расхода с поставщиком и категорией
// «Оплата поставщику» уже подставлены, долг уменьшается по мере ввода суммы.
// Сколько мы должны контрагенту. У поставщика — не меньше долга по приходам «на потом»: старые приходы
// и расходы по нему могут уводить итоговое сальдо в плюс, но долг по приходам от этого не пропадает.
export function owedOf(row) {
  return Math.max(Number(row.payable) || 0, Math.max(0, -Number(row.closingBalance) || 0));
}

function SupplierPayButton({ row, onPaid }) {
  const owed = owedOf(row);
  const payment = useDebtRepayment({ id: row.id, name: row.name }, owed, onPaid, SUPPLIER_PAYMENT);
  if (owed <= 0) return null;
  return <>
    <button type="button" className="dc-pay-button" disabled={payment.opening}
      aria-label={`Оплатить поставщику ${row.name}`} title="Оплатить долг поставщику"
      onClick={() => payment.open()}>
      <Icon name="bi-cash-coin" size={15} /> Оплатить
    </button>
    {payment.drawer}
  </>;
}

export default function DebtorsCreditorsReportPage({ finance = false }) {
  const [dateRange, setDateRange] = useState(currentMonthRange);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftSearch, setDraftSearch] = useState("");
  const [partyTypes, setPartyTypes] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});
  const [selectedParty, setSelectedParty] = useState(null);
  const [direction, setDirection] = useState("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
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
          payable: Number(item.payable) || 0,
        })));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить отчёт по дебету и кредиту.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [beginRequest, dateRange.start, dateRange.end, reloadKey]);

  useEffect(() => {
    if (!finance) return;
    const controller = new AbortController();
    async function loadPartyTypes() {
      const parties = [];
      for (let page = 1; ; page += 1) {
        const result = await financeService.listCounterparties({ page, signal: controller.signal });
        const items = itemsOf(result);
        parties.push(...items);
        if (Array.isArray(result.data) || items.length < 200 || parties.length >= result.data.total) break;
      }
      if (!controller.signal.aborted) {
        setPartyTypes(Object.fromEntries(parties.map(party => [party.id, party.type])));
      }
    }
    loadPartyTypes().catch(() => {});
    return () => controller.abort();
  }, [finance]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(row => (!query || row.name.toLowerCase().includes(query)) && (!finance || direction === "all" || (direction === "debtors" ? row.closingBalance > 0 : owedOf(row) > 0)));
  }, [rows, search, finance, direction]);
  const totals = useMemo(() => visibleRows.reduce((acc, row) => ({
    debit: acc.debit + row.debit,
    credit: acc.credit + row.credit,
    closingBalance: acc.closingBalance + row.closingBalance,
  }), { debit: 0, credit: 0, closingBalance: 0 }), [visibleRows]);

  const receivable = rows.reduce((sum, row) => sum + Math.max(0, row.closingBalance), 0);
  const payable = rows.reduce((sum, row) => sum + owedOf(row), 0);

  // Что показывать в строке сгруппированной таблицы: кредиторам — сколько мы должны (минус), дебиторам — сальдо.
  const shown = row => (direction === "creditors" ? -owedOf(row) : row.closingBalance);
  const grouped = finance && direction !== "all";
  const groups = new Map();
  if (grouped) {
    for (const row of visibleRows) {
      const label = partyGroups[partyTypes[row.id]] || "Без группы";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(row);
    }
  }
  const summaryValues = { debtors: receivable, creditors: payable, all: receivable - payable };
  function toggleParty(id) {
    setSelectedParty(current => current === id ? null : id);
  }

  function chooseSection(key) {
    setDirection(key);
    setExpandedGroups({});
    setSelectedParty(null);
  }

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

        {finance ? <div className="dc-summary-grid fo-toolbar" role="group" aria-label="Раздел отчёта">
          {sections.map(({ key, label, icon, tone }) => (
            <button key={key} type="button" className={`fo-summary-card ${tone}`}
              aria-pressed={direction === key} onClick={() => chooseSection(key)}>
              <div className="dc-summary-card__top"><Icon name={icon} size={22} /><span>{label}</span></div>
              <strong>{displayAmount(summaryValues[key])}</strong>
            </button>
          ))}
        </div> : <div className="dc-summary-grid">
          <article className="dc-summary-card dc-summary-card--debt"><div className="dc-summary-card__top"><span>Дебет</span><Icon name="bi-arrow-down-left-circle" size={22} /></div><strong>{displayAmount(totals.debit)}</strong></article>
          <article className="dc-summary-card dc-summary-card--credit"><div className="dc-summary-card__top"><span>Кредит</span><Icon name="bi-arrow-up-right-circle" size={22} /></div><strong>{displayAmount(totals.credit)}</strong></article>
          <article className="dc-summary-card dc-summary-card--balance"><div className="dc-summary-card__top"><span>Сальдо</span><Icon name="bi-bank" size={22} /></div><strong>{displayAmount(totals.closingBalance)}</strong></article>
        </div>}

        </div>
        <div className={finance ? "fo-recent" : undefined}>
          {finance ? <form id="dc-filters" hidden={!filtersOpen} onSubmit={event => {
            event.preventDefault();
            setSearch(draftSearch);

          }}>
            <div className="report-filters-grid dc-toolbar" style={{ flexWrap: "wrap", gap: 12 }}>
              <label className="dc-search"><Icon name="bi-search" size={18} /><input aria-label="Контрагент" placeholder="Поиск по контрагенту" value={draftSearch} onChange={event => setDraftSearch(event.target.value)} /></label>
              <div className="report-filter-buttons">
                <button type="submit" className="report-filter-apply"><Icon name="bi-sliders" size={17} /> Фильтровать</button>
                <button type="button" className="report-filter-clear" onClick={() => {
                  setDraftSearch("");
                  setSearch("");
                }}>Очистить</button>
              </div>
            </div>
          </form> : <div className="dc-toolbar"><label className="dc-search"><Icon name="bi-search" size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Поиск по контрагенту" /></label></div>}

        <div className={finance ? "fo-table-scroll" : "dc-table-wrap"}>
          {grouped ? <table className={`dc-table dc-grouped-table dc-grouped-table--${direction}`}>
            <thead><tr><th>Контрагент</th><th>{direction === "debtors" ? "Дебет" : "Кредит"}</th></tr></thead>
            <tbody>
              <tr className="dc-total-row"><td>{direction === "debtors" ? "Итого дебиторка" : "Итого кредиторка"}</td><td>{displayAmount(visibleRows.reduce((sum, row) => sum + shown(row), 0))}</td></tr>
              {[...groups].map(([label, members]) => {
                const open = Boolean(expandedGroups[label]);
                return <Fragment key={label}>
                  <tr className="dc-group-row">
                    <td><button type="button" aria-expanded={open} onClick={() => {
                      setExpandedGroups(current => ({ ...current, [label]: !open }));
                      if (open && members.some(row => row.id === selectedParty)) setSelectedParty(null);
                    }}>
                      <Icon name="bi-chevron-right" className="dc-group-chevron" size={14} />{label}
                    </button></td>
                    <td>{displayAmount(members.reduce((sum, row) => sum + shown(row), 0))}</td>
                  </tr>
                  {members.map(row => <Fragment key={row.id}>
                    <ExpenseDisclosureRow visible={open} className="dc-group-member">
                      <td><button type="button" aria-expanded={selectedParty === row.id}
                        onClick={() => toggleParty(row.id)}>
                        <Icon name="bi-chevron-right" className="dc-group-chevron" size={14} />{row.name}
                      </button></td>
                      <td>
                        <span className="dc-amount-cell">
                          {displayAmount(shown(row))}
                          {direction === "creditors" && partyTypes[row.id] === "supplier"
                            ? <SupplierPayButton row={row} onPaid={() => setReloadKey(key => key + 1)} /> : null}
                        </span>
                      </td>
                    </ExpenseDisclosureRow>
                    <ExpenseDisclosureRow visible={open && selectedParty === row.id} className="dc-party-orders">
                      <td colSpan={2}>
                        {partyTypes[row.id] === "supplier"
                          // Поставщик: его приходы «на потом» — из них складывается долг.
                          ? <SupplierPurchases supplier={row.name} />
                          // Клиент: остаток по счетам — сальдо раскладываем по его счетам от новых к старым.
                          : <ClientOrders clientId={row.id} dateTo={toApiDate(dateRange.end)}
                            debt={partyTypes[row.id] === "client" ? row.closingBalance : null} />}
                      </td>
                    </ExpenseDisclosureRow>
                  </Fragment>)}
                </Fragment>;
              })}
              {!visibleRows.length && <tr className="dc-empty-row"><td colSpan={2}>По запросу ничего не найдено</td></tr>}
            </tbody>
          </table> : <table className="dc-table">
            <thead><tr><th>Контрагент</th><th>Дебет</th><th>Кредит</th><th>Сальдо</th></tr></thead>
            <tbody>
              <tr className="dc-total-row"><td>Итого</td><td>{displayAmount(totals.debit)}</td><td>{displayAmount(totals.credit)}</td><td>{displayAmount(totals.closingBalance)}</td></tr>
              {visibleRows.map((row) => <tr className="dc-party-row" key={row.id} data-counterparty-id={row.id}><td><strong>{row.name}</strong></td><td>{displayAmount(row.debit)}</td><td>{displayAmount(row.credit)}</td><td>{displayAmount(row.closingBalance)}</td></tr>)}
              {!visibleRows.length ? <tr className="dc-empty-row"><td colSpan={4}>По запросу ничего не найдено</td></tr> : null}
            </tbody>
          </table>}
        </div>
        </div>
      </article>
    </section>
  );
}

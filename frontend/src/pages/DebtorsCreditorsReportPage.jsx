import { ExpenseDisclosureRow } from "../components/ExpenseDisclosureRow";
import OrderReceiptDialog from "./dashboard/OrderReceiptDialog";
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

export default function DebtorsCreditorsReportPage({ finance = false }) {
  const [dateRange, setDateRange] = useState(currentMonthRange);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftSearch, setDraftSearch] = useState("");
  const [partyTypes, setPartyTypes] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});
  const [selectedParty, setSelectedParty] = useState(null);
  const [partyOrders, setPartyOrders] = useState(null);
  const [receipt, setReceipt] = useState(null);
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
    return rows.filter(row => (!query || row.name.toLowerCase().includes(query)) && (!finance || direction === "all" || (direction === "debtors" ? row.closingBalance > 0 : row.closingBalance < 0)));
  }, [rows, search, finance, direction]);
  const totals = useMemo(() => visibleRows.reduce((acc, row) => ({
    debit: acc.debit + row.debit,
    credit: acc.credit + row.credit,
    closingBalance: acc.closingBalance + row.closingBalance,
  }), { debit: 0, credit: 0, closingBalance: 0 }), [visibleRows]);

  const receivable = rows.reduce((sum, row) => sum + Math.max(0, row.closingBalance), 0);
  const payable = rows.reduce((sum, row) => sum + Math.max(0, -row.closingBalance), 0);

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
  useEffect(() => {
    if (!selectedParty) return;
    const controller = new AbortController();
    setPartyOrders(null);
    financeService.listCounterpartyOrders(selectedParty, { dateTo: toApiDate(dateRange.end), signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data)) throw new Error("Invalid orders response");
        const orders = data.filter(order => order.order_id && Number(order.debt_amount) > 0);
        setPartyOrders({ orders });
        if (orders.length === 1) setReceipt(orders[0]);
      })
      .catch(() => { if (!controller.signal.aborted) setPartyOrders({ error: true }); });
    return () => controller.abort();
  }, [dateRange.end, selectedParty]);

  function toggleParty(id) {
    setPartyOrders(null);
    setSelectedParty(current => current === id ? null : id);
  }

  function chooseSection(key) {
    setDirection(key);
    setExpandedGroups({});
    setSelectedParty(null);
    setPartyOrders(null);
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
              <tr className="dc-total-row"><td>{direction === "debtors" ? "Итого дебиторка" : "Итого кредиторка"}</td><td>{displayAmount(totals.closingBalance)}</td></tr>
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
                    <td>{displayAmount(members.reduce((sum, row) => sum + row.closingBalance, 0))}</td>
                  </tr>
                  {members.map(row => <Fragment key={row.id}>
                    <ExpenseDisclosureRow visible={open} className="dc-group-member">
                      <td><button type="button" className="dc-party-link" aria-expanded={selectedParty === row.id}
                        onClick={() => toggleParty(row.id)}>{row.name}</button></td>
                      <td>{displayAmount(row.closingBalance)}</td>
                    </ExpenseDisclosureRow>
                    <ExpenseDisclosureRow visible={open && selectedParty === row.id} className="dc-party-orders">
                      <td colSpan={2}>
                        {!partyOrders ? <span role="status">Загрузка заказов…</span>
                          : partyOrders.error ? <span role="alert">Не удалось загрузить заказы.</span>
                          : !partyOrders.orders.length ? <span>Связанных заказов в долг нет.</span>
                          : partyOrders.orders.map(order => <button type="button" className="dc-party-link" key={order.order_id}
                            onClick={() => setReceipt(order)}>
                            Чек № {order.order_number} · {displayAmount(order.debt_amount)}
                          </button>)}
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
      {receipt && <OrderReceiptDialog orderId={receipt.order_id} orderNumber={receipt.order_number}
        onClose={() => setReceipt(null)} />}
    </section>
  );
}

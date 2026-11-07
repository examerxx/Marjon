import { parseWebDateTimeInput, webDateTimeInput } from "../../utils/webTime";
import { useId, useLayoutEffect } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Icon from "../../components/Icon";
import ReportDateRangePicker from "../../components/ReportDateRangePicker";
import { financeService, resolveTransactionSubmission } from "../../api/finance";
import FinanceTransactionDrawer from "./FinanceTransactionDrawer";
import { useLatestRequest, isOrderedDateRange } from "../../hooks/useAsyncSafety";
import { exportToExcel } from "../../utils/excel";
import { webDayKey, webTime } from "../../utils/webTime";
import { currentMonthRange, toApiDate, formatMoney, formatDate, itemsOf, mapTransactions, emptyForm, parseAmount } from "./financeTransactionsData";
import { checkedTransactions, previousDay, transactionTotals, expenseGroups, dailyMovement, overviewRangeFromSearch } from "./financeOverviewData";
import labels from "./financeOverviewLabels";
import "./financeOverview.css";

const compact = value => new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);

// Round the axis up to a 1/2/2.5/5 step and keep 8% headroom above the peak.
function niceStep(raw) {
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const fraction = raw / power;
  const multiplier = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return multiplier * power;
}

const categoryColors = ["#00b8b4", "#ff3972", "#2875ff", "#ff9d00", "#8b36ed"];

function ExpenseRing({ rows, active, setActive, totalLabel }) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const selected = rows[active];
  const gradientId = useId();
  const amountRef = useRef(null);
  const amountLabel = formatMoney(selected?.amount ?? total);
  useLayoutEffect(() => {
    const amount = amountRef.current;
    const center = amount.parentElement;
    const fit = () => {
      let low = 1, high = Math.min(32, center.parentElement.clientWidth * .16);
      while (high - low > .1) {
        const size = (low + high) / 2;
        amount.style.fontSize = size + "px";
        if (amount.getBoundingClientRect().width <= center.clientWidth - 1) low = size;
        else high = size;
      }
      amount.style.fontSize = low + "px";
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(center);
    document.fonts?.addEventListener("loadingdone", fit);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, [amountLabel]);
  let offset = 0;
  return <div className="fo-ring-stage" style={{ "--fo-ring-glow": categoryColors[active] ?? categoryColors[0] }}>
    <svg viewBox="0 0 100 100" aria-hidden="true" onPointerLeave={() => setActive(null)}>
            <defs>{categoryColors.map((color, index) => <linearGradient key={color} id={gradientId + index} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop stopColor={color} style={{ stopColor: `color-mix(in srgb, ${color}, white 18%)` }} />
        <stop offset="55%" stopColor={color} />
        <stop offset="100%" stopColor={color} style={{ stopColor: `color-mix(in srgb, ${color}, black 24%)` }} />
      </linearGradient>)}</defs>
      {total > 0 && rows.map((row, index) => {
        const share = row.amount / total * 100;
        const start = offset;
        offset += share;
        return <circle key={row.key} cx="50" cy="50" r="40" pathLength="100"
          fill="none" stroke={`url(#${gradientId}${index})`} strokeWidth={active === index ? 16 : 14}
          strokeDasharray={`${Math.max(0, share - (rows.length > 1 ? Math.min(1.4, share / 3) : 0))} ${100}`}
          strokeDashoffset={-start} transform="rotate(-90 50 50)"
          opacity={active == null || active === index ? 1 : .38}
          onPointerEnter={() => setActive(index)} />;
      })}
    </svg>
    <div className="fo-ring-center">
      <span title={selected?.name ?? totalLabel}>{selected?.name ?? totalLabel}</span>
      <strong ref={amountRef}>{amountLabel}</strong>
      {selected && total > 0 && <span>{new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(selected.amount / total)}</span>}
    </div>
  </div>;
}
function MovementChart({ days, text }) {
  const wrapRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Chart units are CSS pixels: axis text keeps its size on every viewport width.
  const w = Math.max(320, width || 680);
  const h = 248;
  const left = 52, right = 12, top = 14, bottom = 26;
  const maximum = Math.max(1, ...days.map(day => Math.max(day.income, day.expense)));
  const step = niceStep(maximum * 1.08 / 4);
  const ceiling = step * 4;
  const x = index => left + index * (w - left - right) / Math.max(1, days.length - 1);
  const y = value => h - bottom - value / ceiling * (h - bottom - top);
  const tickStep = Math.max(1, Math.ceil(days.length / (days[0]?.date.includes(":") ? Math.max(1, Math.floor((w - left - right) / 36)) : 6)));
  const ticks = days.map((day, index) => ({ day, index }))
    .filter(({ index }) => index % tickStep === 0 || index === days.length - 1)
    .filter(({ index }, position, list) => position === list.length - 1 || x(list[position + 1].index) - x(index) > 34);
  const hovered = days[hoverIndex];
  const hoverPosition = hovered ? x(hoverIndex) / w * 100 : 0;
  return <div className="fo-chart-wrap" ref={wrapRef} onPointerLeave={() => setHoverIndex(null)}>
    <svg className="fo-chart" viewBox={`0 0 ${w} ${h + 12}`} role="img" aria-label={`${text.movement}: ${text.income}, ${text.expense}`}>
      {[0, 1, 2, 3, 4].map(i => <g key={i}>
        <line x1={left} x2={w - right} y1={y(ceiling * i / 4)} y2={y(ceiling * i / 4)} className="fo-chart-grid" />
        <text x={left - 10} y={y(ceiling * i / 4) + 4} textAnchor="end">{compact(ceiling * i / 4)}</text>
      </g>)}
      {["income", "expense"].map(type => {
        const line = days.map((day, i) => {
          if (!i) return `M ${x(i)} ${y(day[type])}`;
          const middle = (x(i - 1) + x(i)) / 2;
          return `C ${middle} ${y(days[i - 1][type])}, ${middle} ${y(day[type])}, ${x(i)} ${y(day[type])}`;
        }).join(" ");
        return <g key={type} className={`fo-series fo-series--${type}`}>
        {days.length > 1 && <path className="fo-chart-area" d={`${line} L ${x(days.length - 1)} ${y(0)} H ${x(0)} Z`} />}
        <path className="fo-chart-line" d={line} />
        {days.map((day, i) => <circle key={day.date} cx={x(i)} cy={y(day[type])} r="3.2"><title>{day.date} · {text[type]}: {formatMoney(day[type])}</title></circle>)}
      </g>; })}
      {hovered && <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={top} y2={y(0)} className="fo-chart-guide" />}
      <rect x={left - 6} y={top} width={w - left - right + 12} height={y(0) - top + 6} fill="transparent" onPointerMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const fraction = ((event.clientX - bounds.left) / bounds.width * (w - left - right + 12) - 6) / (w - left - right);
        setHoverIndex(Math.max(0, Math.min(days.length - 1, Math.round(fraction * (days.length - 1)))));
      }} onPointerLeave={() => setHoverIndex(null)} />
      {ticks.map(({ day, index }) => <text key={day.date} x={x(index)} y={h + 5} textAnchor="middle">{day.date.includes(":") ? day.date : day.date.slice(8) + "." + day.date.slice(5, 7)}</text>)}
    </svg>
    {hovered && <div className="fo-chart-tooltip" style={{ left: `clamp(0px, calc(${hoverPosition}% - 84px), max(0px, calc(100% - 168px)))` }}>
      <strong>{hovered.date.includes(":") ? `${hovered.date} - ${String((Number(hovered.date.slice(0, 2)) + 1) % 24).padStart(2, "0")}:00` : hovered.date.split("-").reverse().join(".")}</strong>
      <span className="fo-income">{text.income}<b>{formatMoney(hovered.income)}</b></span>
      <span className="fo-expense">{text.expense}<b>{formatMoney(hovered.expense)}</b></span>
    </div>}
  </div>;
}

function CategoryPanel({ rows, categories, text, loading, error, direction, title, empty, totalLabel, total }) {
  const groups = expenseGroups(rows, categories || [], text.uncategorized, direction);
  const [activeCategory, setActiveCategory] = useState(null);
  const categoryRows = groups.length > 5 ? [...groups.slice(0, 4), { key: "other", name: text.other, amount: groups.slice(4).reduce((sum, row) => sum + row.amount, 0) }] : groups;
  return <section className="fo-panel fo-categories"><header><h2>{title}</h2></header>
        {loading || error || !categoryRows.length ? <div className="fo-empty">{loading ? text.loading : error ? text.unavailable : empty}</div> : <div className="fo-category-layout" data-has-active={activeCategory != null}><ExpenseRing rows={categoryRows} active={activeCategory} setActive={setActiveCategory} totalLabel={totalLabel} /><div className="fo-bars">{categoryRows.map((row, index) => <div className="fo-bar-row" key={row.key} style={{ "--fo-category-color": categoryColors[index] }} tabIndex={0} data-active={activeCategory === index} onPointerEnter={() => setActiveCategory(index)} onPointerLeave={() => setActiveCategory(null)} onFocus={() => setActiveCategory(index)} onBlur={() => setActiveCategory(null)}>
          <span className="fo-category-rank" style={{ color: categoryColors[index] }}>{index + 1}</span><span title={row.name}>{row.name}</span><span className="fo-category-share">{new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(total ? row.amount / total : 0)}</span><strong>{formatMoney(row.amount)}</strong>
        </div>)}</div></div>}
      </section>;
}

export default function FinanceOperationsOverview() {
  const { i18n } = useTranslation();
  const text = labels[(i18n.resolvedLanguage || i18n.language || "ru").split("-")[0]] || labels.ru;
  const [range, setRange] = useState(() => overviewRangeFromSearch(window.location.search, currentMonthRange()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [form, setForm] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [counterparties, setCounterparties] = useState([]);
  const saveLock = useRef(false);
  const submissionRef = useRef(null);
  const drawerRequest = useRef(null);
  useEffect(() => () => drawerRequest.current?.abort(), []);
  const openCreate = async (type) => {
    drawerRequest.current?.abort();
    const controller = new AbortController();
    drawerRequest.current = controller;
    submissionRef.current = null;
    setEditingRow(null);
    setFormError(""); setCounterparties([]); setForm({ ...emptyForm, type, operationDateTime: webDateTimeInput(new Date()) });
    try {
      const result = await financeService.listCounterparties({ signal: controller.signal });
      if (!controller.signal.aborted) setCounterparties(itemsOf(result));
    } catch { /* Counterparty is optional; existing payment/category options remain available. */ }
  };
  const openEdit = (row) => {
    setEditingRow(row);
    setFormError("");
    setForm({
      ...emptyForm,
      type: row.type,
      amount: String(row.amount),
      paymentTypeId: row.paymentTypeId,
      counterpartyId: row.counterpartyId,
      categoryId: row.categoryId,
      comment: row.comment,
      operationDateTime: webDateTimeInput(row.date),
    });
  };
  const closeCreate = () => {
    if (saveLock.current) return;
    drawerRequest.current?.abort(); setForm(null); setEditingRow(null); submissionRef.current = null;
  };
  const saveOperation = async () => {
    if (saveLock.current) return;
    const amount = parseAmount(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setFormError("Введите положительную сумму."); return; }
    const date = parseWebDateTimeInput(form.operationDateTime);
    if (!date) { setFormError("Укажите дату и время операции."); return; }
    saveLock.current = true; setSaving(true); setFormError("");
    const payload = { amount, direction: form.type, comment: form.comment };
    if (!editingRow || form.operationDateTime !== webDateTimeInput(editingRow.date)) {
      payload.date = date.toISOString();
    }
    if (form.categoryId) payload.category_id = form.categoryId;
    try {
      let response;
      if (editingRow) {
        response = await financeService.updateTransaction(editingRow.id, payload);
      } else {
        if (form.paymentTypeId) payload.payment_type_id = form.paymentTypeId;
        if (form.counterpartyId) payload.counterparty_id = form.counterpartyId;
        const submission = resolveTransactionSubmission(submissionRef.current, payload);
        submissionRef.current = submission;
        response = await financeService.createTransaction(payload, submission.idempotencyKey);
      }
      if (!response.data?.id) throw new Error("Операция не подтверждена сервером");
      submissionRef.current = null; await load();
      return true;
    } catch (err) {
      setFormError(typeof err.response?.data?.detail === "string" ? err.response.data.detail : "Не удалось сохранить операцию.");
    } finally { saveLock.current = false; setSaving(false); }
  };
  const beginRequest = useLatestRequest();
  const start = toApiDate(range.start), end = toApiDate(range.end);
  const load = useCallback(async () => {
    const request = beginRequest();
    setLoading(true); setError(false); setData(null);
    if (!isOrderedDateRange(start, end)) { setError(true); setLoading(false); return; }
    try {
      const results = await Promise.allSettled([
        financeService.listTransactions({ dateFrom: start, dateTo: end, signal: request.signal }),
        financeService.listTransactions({ dateTo: previousDay(start), signal: request.signal }),
        financeService.listPaymentTypes({ signal: request.signal }),
        financeService.listTransactionCategories(undefined, { signal: request.signal }),
        Promise.resolve().then(() => financeService.listCounterparties({ signal: request.signal })),
      ]);
      if (!request.isCurrent()) return;
      if (results[0].status !== "fulfilled") throw new Error("Transactions unavailable");
      const rows = checkedTransactions(results[0].value);
      let history = null;
      if (results[1].status === "fulfilled") {
        try { history = checkedTransactions(results[1].value); } catch { /* Unknown opening balance stays unavailable. */ }
      }
      setData({ rows, history,
        payments: results[2].status === "fulfilled" ? itemsOf(results[2].value) : [],
        counterparties: results[4].status === "fulfilled" ? itemsOf(results[4].value) : [],
        categories: results[3].status === "fulfilled" ? itemsOf(results[3].value) : [],
      });
    } catch { if (request.isCurrent()) setError(true); }
    finally { if (request.isCurrent()) setLoading(false); }
  }, [beginRequest, start, end]);
  useEffect(() => { load(); }, [load]);

  const rows = data?.rows || [];
  const totals = useMemo(() => transactionTotals(rows), [rows]);
  const [expanded, setExpanded] = useState(false);
  const tableRef = useRef(null);
  useEffect(() => {
    const table = tableRef.current;
    const overview = table.closest(".finance-overview");
    const sidebar = document.getElementById("dashboardSidebar");
    const fitTable = () => {
      const sidebarBottom = sidebar?.getBoundingClientRect().bottom || window.innerHeight - 12;
      const available = Math.min(sidebarBottom, window.innerHeight - 12) - table.getBoundingClientRect().top - parseFloat(getComputedStyle(table.parentElement).paddingBottom) - 1;
      table.style.maxHeight = available >= 100 ? Math.floor(available) + "px" : "";
    };
    fitTable();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fitTable);
    observer?.observe(overview.querySelector(".fo-toolbar"));
    observer?.observe(overview.querySelector(".fo-middle"));
    if (sidebar) observer?.observe(sidebar);
    window.addEventListener("resize", fitTable);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fitTable);
    };
  }, [expanded]);
  const recent = mapTransactions([...rows].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, expanded ? undefined : 6), data?.payments || [], data?.categories || [], data?.counterparties || []);
  const hourly = Boolean(start) && start === end;
  const days = useMemo(() => {
    if (!start || !end || start > end) return [];
    if (!hourly) return dailyMovement(rows, start, end);
    return Array.from({ length: 24 }, (_, hour) => {
      const prefix = String(hour).padStart(2, "0");
      const totals = transactionTotals(rows.filter(row =>
        webDayKey(row.date) === start && webTime(row.date).slice(0, 2) === prefix
      ));
      return { date: prefix + ":00", income: totals.income, expense: totals.expense };
    });
  }, [data, start, end, hourly]);
  const cards = [
    { key: "income", value: totals.income, icon: "bi-arrow-down-left-circle", tone: "teal" },
    { key: "expense", value: totals.expense, icon: "bi-arrow-up-right-circle", tone: "coral" },
  ];
  const value = amount => loading ? "…" : error || amount == null ? "—" : <>
    <span>{new Intl.NumberFormat("ru-RU").format(amount)}</span>{" "}
    <span className="fo-cur">UZS</span>
  </>;
  const exportRows = () => exportToExcel(mapTransactions(rows, data?.payments || [], data?.categories || [], data?.counterparties || []), [
    { key: "date", label: text.date, type: "date" }, { key: "type", label: text.operation },
    { key: "category", label: text.category }, { key: "paymentType", label: text.payment }, { key: "amount", label: text.amount, type: "number" },
  ], "finance-operations");

  return <section className="finance-overview" aria-labelledby="finance-overview-title">
    <div className="fo-toolbar">
      <h1 className="fo-title" id="finance-overview-title"><span className="fo-title-section">Финансы</span>{text.title}</h1>
      <div className="fo-summary" aria-busy={loading}>
        {cards.map(card => <button type="button" onClick={() => openCreate(card.key)} className={`fo-summary-card fo-tone--${card.tone}`} key={card.key}>
          <span className="fo-metric-icon"><Icon name={card.icon} size={23} /></span>
          <div><span className="fo-metric-label">{text[card.key]}</span><strong>{value(card.value)}</strong></div>
        </button>)}
      </div>
      <ReportDateRangePicker variant="canonical" value={range} onChange={setRange} buttonAriaLabel={text.period} buttonClassName="fo-period-button" />
      <button className="fo-export" onClick={exportRows} disabled={loading || error || !rows.length}><Icon name="bi-filetype-xlsx" size={19} strokeWidth={1.9} className="owner-report-xlsx-icon" />{(i18n.resolvedLanguage || i18n.language || "ru").split("-")[0] === "ru" ? "Скачать Excel" : text.export}</button>
    </div>
    {error && <div className="fo-alert" role="alert">{text.error}<button onClick={load}>{text.retry}</button></div>}
    {!loading && data && !data.history && <p className="fo-history-warning" role="status">{text.historyError}</p>}
    <div className="fo-middle" hidden={expanded}>
      <section className="fo-panel fo-movement"><header><h2>{text.movement}</h2><div className="fo-legend"><span className="fo-income">{text.income}</span><span className="fo-expense">{text.expense}</span></div></header>
        {loading ? <div className="fo-empty" role="status">{text.loading}</div> : error ? <div className="fo-empty">{text.unavailable}</div> : <MovementChart days={days} text={text} />}
      </section>
      <CategoryPanel rows={rows} categories={data?.categories} text={text} loading={loading} error={error} direction="income" title="Приход по категориям" empty="Приходов за период нет" totalLabel="Всего приходов" total={totals.income} />
      <CategoryPanel rows={rows} categories={data?.categories} text={text} loading={loading} error={error} direction="expense" title={text.categories} empty={text.noExpense} totalLabel="Всего расходов" total={totals.expense} />
    </div>
    <div className={expanded ? "fo-bottom fo-bottom--expanded" : "fo-bottom"}>
      <section className="fo-panel fo-recent"><header><h2>{text.recent}</h2><button type="button" className="fo-details" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Свернуть" : "Подробнее"}<Icon name={expanded ? "bi-chevron-up" : "bi-chevron-right"} size={15} /></button></header>
        <div className="fo-table-scroll finance-catalog-scroll" ref={tableRef} tabIndex={0} aria-label={text.recent}><table><thead><tr><th>{text.operationDate}</th><th>{text.registrationDate}</th><th>{text.amount}</th><th>{text.counterparty}</th><th>{text.category}</th><th>{text.payment}</th><th aria-label={text.actions} /></tr></thead><tbody>
          {recent.map(row => <tr key={row.id}><td>{formatDate(row.date)}</td><td>{formatDate(row.createdAt)}</td><td className={`fo-amount--${row.type}`}>{row.amount > 0 ? (row.type === "income" ? "+" : "−") : ""}{formatMoney(row.amount)}</td><td>{row.counterparty}</td><td>{row.categoryId ? row.category : text.uncategorized}</td><td>{row.paymentTypeId ? row.paymentType : text.unspecified}</td><td className="fo-operation-actions"><button type="button" className="finance-action-edit" aria-label={text.editOperation} onClick={() => openEdit(row)}><Icon name="bi-pencil" size={15} /></button></td></tr>)}
          {(loading || error || !recent.length) && <tr><td colSpan={7} className="fo-table-empty">{loading ? text.loading : error ? text.unavailable : text.empty}</td></tr>}
        </tbody></table></div>
      </section>
    </div>
    {form && <FinanceTransactionDrawer form={form} setForm={setForm} onClose={closeCreate} onSave={saveOperation} paymentTypes={data?.payments || []} categories={(data?.categories || []).filter(item => item.status !== false)} counterparties={editingRow ? data?.counterparties : counterparties} editing={Boolean(editingRow)} saving={saving} error={formError} onClearError={() => setFormError("")} />}
  </section>;
}

import { parseWebDateTimeInput, webDateTimeInput } from "../utils/webTime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { overviewRangeFromSearch } from "./finance/financeOverviewData";
import { financeService, resolveTransactionSubmission } from "../api/finance";
import Icon from "../components/Icon";
import FinanceTransactionDrawer from "./finance/FinanceTransactionDrawer";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest, useMutationLocks } from "../hooks/useAsyncSafety";
import { emptyForm, currentMonthRange, toApiDate, parseAmount, formatMoney, formatDate, itemsOf, mapTransactions } from "./finance/financeTransactionsData";
import { t } from "../i18n/t";

export default function FinanceTransactionsPage() {
  const [rows, setRows] = useState([]);
  const [paymentTypes, setPaymentTypes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [dateRange, setDateRange] = useState(() => overviewRangeFromSearch(window.location.search, currentMonthRange()));
  const beginRequest = useLatestRequest();
  const mutationLocks = useMutationLocks();
  const createSubmissionRef = useRef(null);

  const loadData = useCallback(async ({ showLoader = true } = {}) => {
    const request = beginRequest();
    if (showLoader) setLoading(true);
    setError("");
    const params = { date_from: toApiDate(dateRange.start), date_to: toApiDate(dateRange.end) };
    if (!isOrderedDateRange(params.date_from, params.date_to)) {
      if (request.isCurrent()) {
        setRows([]);
        setError("Начальная дата не может быть позже конечной.");
        if (showLoader) setLoading(false);
      }
      return false;
    }
    if (direction !== "all") params.direction = direction;
    const [transactionsResult, paymentsResult, categoriesResult, counterpartiesResult] = await Promise.allSettled([
      financeService.listTransactions({ dateFrom: params.date_from, dateTo: params.date_to, direction: params.direction, signal: request.signal }),
      financeService.listPaymentTypes({ signal: request.signal }),
      financeService.listTransactionCategories(undefined, { signal: request.signal }),
      financeService.listCounterparties({ signal: request.signal }),
    ]);
    if (!request.isCurrent()) return false;
    if (transactionsResult.status === "rejected") {
      const err = transactionsResult.reason;
      if (isAbortError(err)) return false;
      setRows([]);
      setError(err.response?.data?.detail || "Не удалось загрузить финансовые транзакции.");
      if (showLoader) setLoading(false);
      return false;
    }
    if (!Array.isArray(transactionsResult.value?.data?.items)) {
      setRows([]);
      setError("Не удалось проверить формат финансовых транзакций.");
      if (showLoader) setLoading(false);
      return false;
    }
    const nextPaymentTypes = paymentsResult.status === "fulfilled" ? itemsOf(paymentsResult.value) : [];
    const nextCategories = categoriesResult.status === "fulfilled" ? itemsOf(categoriesResult.value) : [];
    const nextCounterparties = counterpartiesResult.status === "fulfilled" ? itemsOf(counterpartiesResult.value) : [];
    setPaymentTypes(nextPaymentTypes);
    setCategories(nextCategories);
    setCounterparties(nextCounterparties);
    setRows(mapTransactions(transactionsResult.value.data.items, nextPaymentTypes, nextCategories, nextCounterparties));
    if (showLoader) setLoading(false);
    return true;
  }, [beginRequest, dateRange.start, dateRange.end, direction]);

  useEffect(() => { loadData(); }, [loadData]);

  const totals = useMemo(() => rows.reduce((acc, row) => {
    acc[row.type] += row.amount;
    return acc;
  }, { income: 0, expense: 0 }), [rows]);

  const openCreate = (type) => {
    createSubmissionRef.current = null;
    setEditingId(null);
    setMutationError("");
    setForm({ ...emptyForm, type, operationDateTime: webDateTimeInput(new Date()) });
    setDrawerOpen(true);
  };

  const openEdit = (row) => {
    createSubmissionRef.current = null;
    setEditingId(row.id);
    setMutationError("");
    setForm({
      type: row.type,
      amount: String(row.amount),
      paymentTypeId: row.paymentTypeId,
      counterpartyId: row.counterpartyId,
      categoryId: row.categoryId,
      financeTemplateId: row.financeTemplateId,
      comment: row.comment,
      operationDateTime: webDateTimeInput(row.date),
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!mutationLocks.acquire("transaction-save")) return;
    const amount = parseAmount(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMutationError(t("pages.financetransactionspage.vvod_polozhitelnoy_summy"));
      mutationLocks.release("transaction-save");
      return;
    }
    const date = parseWebDateTimeInput(form.operationDateTime);
    if (!date) {
      setMutationError(t("pages.financetransactionspage.ukazhite_datu_i_vremya_operatsii"));
      mutationLocks.release("transaction-save");
      return;
    }
    setSaving(true);
    setMutationError("");
    const payload = { amount, direction: form.type, comment: form.comment };
    if (!editingId || form.operationDateTime !== webDateTimeInput(rows.find(row => row.id === editingId)?.date)) {
      payload.date = date.toISOString();
    }
    if (form.categoryId) payload.category_id = form.categoryId;
    if (editingId) {
      if (form.financeTemplateId) payload.finance_template_id = form.financeTemplateId;
    } else {
      if (form.paymentTypeId) payload.payment_type_id = form.paymentTypeId;
      if (form.counterpartyId) payload.counterparty_id = form.counterpartyId;
      if (form.financeTemplateId) payload.finance_template_id = form.financeTemplateId;
    }
    try {
      let response;
      if (editingId) {
        response = await financeService.updateTransaction(editingId, payload);
      } else {
        const submission = resolveTransactionSubmission(createSubmissionRef.current, payload);
        createSubmissionRef.current = submission;
        response = await financeService.createTransaction(payload, submission.idempotencyKey);
      }
      const { data } = response;
      if (!data?.id) throw new Error("Backend не вернул сохранённую транзакцию.");
      createSubmissionRef.current = null;
      const [confirmed] = mapTransactions([data], paymentTypes, categories, counterparties);
      setRows((current) => editingId
        ? current.map((row) => row.id === editingId ? confirmed : row)
        : [confirmed, ...current.filter((row) => row.id !== confirmed.id)]);
      await loadData({ showLoader: false });
      return true;
    } catch (err) {
      setMutationError(err.response?.data?.detail || "Ошибка сохранения.");
    } finally {
      setSaving(false);
      mutationLocks.release("transaction-save");
    }
  };

  return (
    <section className="nomenclature-page dish-catalog-page owner-report-view finance-page">
      <Link className="fo-detail-back" to={`/finance/transactions?${new URLSearchParams({ date_from: toApiDate(dateRange.start), date_to: toApiDate(dateRange.end) })}`}>← {t("pages.financetransactionspage.k_obzoru_denezhnyh_operatsiy")}</Link>
      <section className="dish-catalog-card owner-report-surface settings-card finance-card">
        <header className="settings-header finance-header finance-header--transactions">
          <div className="settings-title-group">
            <span className="settings-accent-bar" aria-hidden="true" />
            <div>
              <p>{t("pages.financetransactionspage.finansy")}</p>
              <h1>{t("pages.financetransactionspage.denezhnye_operatsii")}</h1>
            </div>
          </div>
          <div className="settings-actions finance-actions">
            <div className="report-actions finance-date-range"><ReportDateRangePicker value={dateRange} onChange={setDateRange} /></div>
            <button type="button" className="finance-income-action" onClick={() => openCreate("income")}><span>+</span> {t("pages.financetransactionspage.prihod")}</button>
            <button type="button" className="finance-expense-action" onClick={() => openCreate("expense")}><span>-</span> {t("pages.financetransactionspage.rashod")}</button>
            <button type="button" className="finance-excel-action" onClick={() => exportToExcel(rows, [{ key: "date", label: t("pages.financetransactionspage.data") }, { key: "amount", label: t("pages.financetransactionspage.summa") }, { key: "type", label: t("pages.financetransactionspage.napravlenie") }, { key: "paymentType", label: t("pages.financetransactionspage.tip_oplaty") }, { key: "counterparty", label: t("pages.financetransactionspage.kontragent") }, { key: "category", label: t("pages.financetransactionspage.kategoriya") }, { key: "comment", label: t("pages.financetransactionspage.kommentariy") }], "finance-transactions")}>{t("pages.financetransactionspage.skachat_excel")}</button>
            <label><span className="visually-hidden">{t("pages.financetransactionspage.napravlenie")}</span><select aria-label={t("pages.financetransactionspage.napravlenie")} value={direction} onChange={(event) => setDirection(event.target.value)}><option value="all">{t("pages.financetransactionspage.vse_operatsii")}</option><option value="income">{t("pages.financetransactionspage.prihod_2")}</option><option value="expense">{t("pages.financetransactionspage.rashod_2")}</option></select></label>
          </div>
        </header>
        <div className="finance-summary-row"><article className="finance-summary-pill finance-income-pill"><span>{t("pages.financetransactionspage.prihod_2")}</span><strong>{error ? "Недоступно" : formatMoney(totals.income)}</strong></article><article className="finance-summary-pill finance-expense-pill"><span>{t("pages.financetransactionspage.rashod_2")}</span><strong>{error ? "Недоступно" : formatMoney(totals.expense)}</strong></article></div>

        <div className="finance-table-wrapper finance-catalog-scroll">
          <table className="finance-table">
            <thead><tr><th>{t("Дата поступления")}</th><th>{t("Дата регистрации")}</th><th>{t("pages.financetransactionspage.summa")}</th><th>{t("pages.financetransactionspage.kontragent")}</th><th>{t("pages.financetransactionspage.kategoriya")}</th><th>{t("Способ оплаты")}</th><th>{t("pages.financetransactionspage.kommentariy")}</th><th>{t("pages.financetransactionspage.deystviya")}</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 24 }}>{t("pages.financetransactionspage.zagruzka")}</td></tr> : error ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 24 }}><div className="login-error" role="alert">{error}</div></td></tr> : rows.map((row) => <tr key={row.id}><td>{formatDate(row.date)}</td><td>{formatDate(row.createdAt)}</td><td className={row.type === "income" ? "finance-amount-income" : "finance-amount-expense"}>{row.type === "income" ? "+" : "-"} {formatMoney(row.amount)}</td><td>{row.counterparty}</td><td>{row.category}</td><td>{row.paymentType}</td><td>{row.comment}</td><td><button type="button" className="finance-action-edit" aria-label={`Редактировать транзакцию ${row.id}`} onClick={() => openEdit(row)}><Icon name="bi-pencil" size={15} /></button></td></tr>)}
              {!loading && !error && !rows.length ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 24 }}>{t("pages.financetransactionspage.tranzaktsiy_net")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {drawerOpen ? <FinanceTransactionDrawer form={form} setForm={setForm} onClose={() => { if (!saving) { createSubmissionRef.current = null; setDrawerOpen(false); } }} onSave={save} editing={Boolean(editingId)} paymentTypes={paymentTypes} counterparties={counterparties} categories={categories} saving={saving} error={mutationError} onClearError={() => setMutationError("")} /> : null}
    </section>
  );
}

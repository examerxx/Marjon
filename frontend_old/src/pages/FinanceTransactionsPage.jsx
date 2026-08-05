import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import Icon from "../components/Icon";
import FinanceTransactionDrawer from "./FinanceTransactionDrawer";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { todayInputValue } from "../utils/date";
import { exportToExcel } from "../utils/excel";

const emptyForm = {
  type: "income", date: "", amount: "0", currency: "UZS",
  paymentType: "NAXT", counterparty: "-", category: "Приход от продаж", comment: "",
};

function parseAmount(value) {
  return Number(String(value || "").replace(/[^\d.-]/g, "")) || 0;
}

function formatMoney(value) {
  return `${new Intl.NumberFormat("ru-RU").format(Number(value) || 0)} UZS`;
}

function formatDate(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return `${d.toLocaleDateString("ru-RU")} / ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

function FinanceTransactionsPage() {
  const outlet = useOutletContext();
  const { selectedDate = todayInputValue() } = outlet || {};
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ type: "all", paymentType: "", category: "", counterparty: "", min: "", max: "" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [dateRange, setDateRange] = useState({ preset: "Этот месяц", start: "", end: "", startTime: "", endTime: "" });

  useEffect(() => {
    setLoading(true);
    api.get("/finance/transactions", { params: { date_from: selectedDate, date_to: selectedDate } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        setRows(items.map((tx) => ({
            id: tx.id,
            date: formatDate(tx.date),
            amount: Number(tx.amount || 0),
            type: tx.direction || "income",
            paymentType: tx.payment_type_name || "—",
            counterparty: tx.counterparty_name || "-",
            category: tx.category_name || "—",
            comment: tx.comment || "",
          })));
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [selectedDate]);

  const totals = useMemo(() => rows.reduce((acc, row) => {
    acc[row.type] = (acc[row.type] || 0) + Number(row.amount || 0);
    return acc;
  }, { income: 0, expense: 0 }), [rows]);

  const visibleRows = useMemo(() => rows.filter((row) => {
    if (filters.type !== "all" && row.type !== filters.type) return false;
    if (filters.paymentType && row.paymentType !== filters.paymentType) return false;
    if (filters.category && !row.category.toLowerCase().includes(filters.category.toLowerCase())) return false;
    if (filters.min && row.amount < parseAmount(filters.min)) return false;
    if (filters.max && row.amount > parseAmount(filters.max)) return false;
    return true;
  }), [filters, rows]);

  const openCreate = (type) => {
    setEditingId(null);
    setForm({ ...emptyForm, type, category: type === "income" ? "Приход от продаж" : "Расход" });
    setDrawerOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({ ...emptyForm, ...row, amount: String(row.amount), currency: "UZS" });
    setDrawerOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        amount: parseAmount(form.amount),
        direction: form.type,
        comment: form.comment || "",
      };
      if (editingId) {
        await api.patch(`/finance/transactions/${editingId}`, payload);
      } else {
        await api.post("/finance/transactions", payload);
      }
      const { data } = await api.get("/finance/transactions", { params: { date_from: selectedDate, date_to: selectedDate } });
      const items = Array.isArray(data) ? data : data?.items || [];
      setRows(items.map((tx) => ({
        id: tx.id,
        date: formatDate(tx.date),
        amount: Number(tx.amount || 0),
        type: tx.direction || "income",
        paymentType: tx.payment_type_name || "—",
        counterparty: tx.counterparty_name || "-",
        category: tx.category_name || "—",
        comment: tx.comment || "",
      })));
      setDrawerOpen(false);
    } catch (e) {
      window.alert(e.response?.data?.detail || "Ошибка сохранения");
    }
  };

  return (
    <div className="finance-page">
      <section className="finance-card">
        <header className="finance-header finance-header--transactions">
          <div className="report-actions finance-date-range">
            <ReportDateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
          <div className="finance-summary-row">
            <article className="finance-summary-pill finance-income-pill">
              <span>Приход</span>
              <strong>{formatMoney(totals.income)}</strong>
            </article>
            <article className="finance-summary-pill finance-expense-pill">
              <span>Расход</span>
              <strong>{formatMoney(totals.expense)}</strong>
            </article>
          </div>
          <div className="finance-actions">
            <button type="button" className="finance-income-action" onClick={() => openCreate("income")}><span>+</span> ПРИХОД</button>
            <button type="button" className="finance-expense-action" onClick={() => openCreate("expense")}><span>-</span> РАСХОД</button>
            <button type="button" className="finance-excel-action" onClick={() => exportToExcel(visibleRows, [
              { key: "date", label: "Дата" },
              { key: "amount", label: "Сумма" },
              { key: "type", label: "Тип" },
              { key: "counterparty", label: "Контрагент" },
              { key: "category", label: "Категория" },
              { key: "comment", label: "Комментарий" },
            ], "finance-transactions")}>Скачать Excel</button>
            <button type="button" onClick={() => setFilterOpen((v) => !v)}>Фильтровать</button>
          </div>
        </header>

        {filterOpen ? (
          <div className="finance-filters">
            <select value={filters.type} onChange={(e) => setFilters((c) => ({ ...c, type: e.target.value }))}>
              <option value="all">Все операции</option>
              <option value="income">Приход</option>
              <option value="expense">Расход</option>
            </select>
            <input placeholder="Тип оплаты" value={filters.paymentType} onChange={(e) => setFilters((c) => ({ ...c, paymentType: e.target.value }))} />
            <input placeholder="Категория" value={filters.category} onChange={(e) => setFilters((c) => ({ ...c, category: e.target.value }))} />
            <input placeholder="Мин. сумма" value={filters.min} onChange={(e) => setFilters((c) => ({ ...c, min: e.target.value }))} />
            <input placeholder="Макс. сумма" value={filters.max} onChange={(e) => setFilters((c) => ({ ...c, max: e.target.value }))} />
          </div>
        ) : null}

        <div className="finance-table-wrapper">
          <table className="finance-table">
            <thead>
              <tr><th>Дата</th><th>Сумма</th><th>Тип оплаты</th><th>Контрагент</th><th>Категория</th><th>Комментарий</th><th>Действия</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>Загрузка...</td></tr>
              ) : visibleRows.map((row) => {
                const [day, time] = String(row.date || "").split(" / ");
                return (
                  <tr key={row.id}>
                    <td><strong>{day}</strong><small>{time}</small></td>
                    <td className={row.type === "income" ? "finance-amount-income" : "finance-amount-expense"}>
                      {row.type === "income" ? "+" : "-"} {formatMoney(row.amount)}
                    </td>
                    <td>{row.paymentType}</td>
                    <td>{row.counterparty}</td>
                    <td>{row.category}</td>
                    <td>{row.comment}</td>
                    <td>
                      <button type="button" className="finance-action-edit" onClick={() => openEdit(row)}>
                        <Icon name="bi-pencil" size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && !visibleRows.length ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>Транзакций нет.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {drawerOpen ? <FinanceTransactionDrawer form={form} setForm={setForm} onClose={() => setDrawerOpen(false)} onSave={save} /> : null}
    </div>
  );
}

export default FinanceTransactionsPage;

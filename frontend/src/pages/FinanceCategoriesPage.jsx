import { useEffect, useMemo, useState } from "react";
import { api, formatMoney } from "../api/client";
import Icon from "../components/Icon";

const DEMO_FINANCE_CATEGORIES = {
  income: [
    { id: "demo-income-sales", name: "Продажи", description: "Приход", operations: "86", total: "8 420 000 UZS", status: "Активно" },
    { id: "demo-income-delivery", name: "Доставка", description: "Приход", operations: "18", total: "1 260 000 UZS", status: "Активно" },
    { id: "demo-income-other", name: "Прочие поступления", description: "Приход", operations: "4", total: "380 000 UZS", status: "Активно" },
    { id: "demo-income-archive", name: "Старые бонусы", description: "Приход", operations: "2", total: "90 000 UZS", status: "Архив" },
  ],
  expense: [
    { id: "demo-expense-products", name: "Закупка продуктов", description: "Расход", operations: "24", total: "3 180 000 UZS", status: "Активно" },
    { id: "demo-expense-salary", name: "Зарплата", description: "Расход", operations: "8", total: "2 400 000 UZS", status: "Активно" },
    { id: "demo-expense-utility", name: "Коммунальные", description: "Расход", operations: "5", total: "740 000 UZS", status: "Активно" },
    { id: "demo-expense-archive", name: "Старые расходы", description: "Расход", operations: "1", total: "120 000 UZS", status: "Архив" },
  ],
};

function demoFinanceCategories(kind) {
  return DEMO_FINANCE_CATEGORIES[kind] || DEMO_FINANCE_CATEGORIES.income;
}

function FinanceCategoriesPage({ title, kind }) {
  const [rows, setRows] = useState([]);
  const [activeTab, setActiveTab] = useState("Активно");
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);

  async function loadCategories() {
    try {
      const { data } = await api.get("/finance/transaction-categories", { params: { kind } });
      const items = Array.isArray(data) ? data : data?.items || [];
      const mapped = items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.kind === "income" ? "Приход" : "Расход",
          operations: "—",
          total: "—",
          status: item.status ? "Активно" : "Архив",
        }));
      setRows(mapped.length ? mapped : demoFinanceCategories(kind));
    } catch {
      setRows(demoFinanceCategories(kind));
    }
  }

  useEffect(() => { loadCategories(); }, [kind]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => row.status === activeTab && (!query || row.name.toLowerCase().includes(query)));
  }, [activeTab, rows, search]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: "", description: "" });
    setDrawerOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({ name: row.name, description: row.description });
    setDrawerOpen(true);
  };

  const archive = async (row) => {
    try {
      await api.patch(`/finance/transaction-categories/${row.id}`, { status: false });
      await loadCategories();
    } catch {
      window.alert("Ошибка архивирования");
    }
  };

  const restore = async (row) => {
    try {
      await api.patch(`/finance/transaction-categories/${row.id}`, { status: true });
      await loadCategories();
    } catch {
      window.alert("Ошибка восстановления");
    }
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await api.patch(`/finance/transaction-categories/${editingId}`, { name: form.name });
      } else {
        await api.post("/finance/transaction-categories", { name: form.name, kind });
      }
      await loadCategories();
      setDrawerOpen(false);
    } catch (e) {
      window.alert(e.response?.data?.detail || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="finance-page">
      <section className="finance-card">
        <header className="finance-header">
          <div className="finance-title-group">
            <span className="finance-accent-bar" />
            <div>
              <p>Финансы</p>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="finance-actions">
            <button type="button" className="finance-primary-action" onClick={openCreate}>Добавить категорию +</button>
          </div>
        </header>

        <div className="finance-tabs">
          {["Активно", "Архив"].map((tab) => (
            <button key={tab} type="button" className={activeTab === tab ? "is-active" : ""} onClick={() => setActiveTab(tab)}>
              {tab === "Активно" ? "Активные" : "Архив"}
            </button>
          ))}
        </div>

        <div className="finance-filters finance-filters--categories">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию" />
        </div>

        <div className="finance-table-wrapper">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Описание</th>
                <th>Кол-во операций</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.description}</td>
                  <td>{row.operations}</td>
                  <td>{row.total}</td>
                  <td><span className={`finance-status-badge ${row.status === "Архив" ? "is-archived" : ""}`}>{row.status}</span></td>
                  <td>
                    <div className="finance-category-actions">
                      <button type="button" className="finance-action-edit" onClick={() => openEdit(row)}><Icon name="bi-pencil" size={15} /></button>
                      <button type="button" className={row.status === "Архив" ? "is-restore" : "is-danger"} onClick={() => row.status === "Архив" ? restore(row) : archive(row)}>
                        <Icon name={row.status === "Архив" ? "bi-recycle" : "bi-trash3"} size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {drawerOpen ? (
        <div className="finance-drawer" role="dialog" aria-modal="true">
          <div className="finance-drawer__backdrop" onClick={() => setDrawerOpen(false)} />
          <form className="finance-form" onSubmit={save}>
            <header className="finance-form__header">
              <span className="finance-accent-bar" />
              <div>
                <p>Категория</p>
                <h2>{title}</h2>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)}><Icon name="bi-x-lg" size={20} /></button>
            </header>
            <div className="finance-form__grid">
              <label><span>Название</span><input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label className="finance-form__wide"><span>Описание</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
            </div>
            <footer className="finance-form__footer">
              <button type="button" onClick={() => setDrawerOpen(false)}>Отмена</button>
              <button type="submit" disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default FinanceCategoriesPage;

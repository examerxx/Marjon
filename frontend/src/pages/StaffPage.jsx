import { useEffect, useState } from "react";
import { api, formatMoney } from "../api/client";
import Icon from "../components/Icon";

const emptyForm = { position: "", salary_type: "fixed", salary_amount: "" };

export default function StaffPage() {
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function loadEmployees() {
    try {
      const { data } = await api.get("/hr/employees");
      const items = Array.isArray(data) ? data : [];
      setEmployees(items);
    } catch (err) {
      setError(err.response?.data?.detail || "");
    }
  }

  useEffect(() => { loadEmployees(); }, []);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDrawerOpen(true);
  }

  function openEdit(employee) {
    setEditingId(employee.id);
    setForm({
      position: employee.position || "",
      salary_type: employee.salary_type || "fixed",
      salary_amount: String(employee.salary_amount || ""),
    });
    setDrawerOpen(true);
  }

  async function handleSave(event) {
    event.preventDefault();

    setSaving(true);
    try {
      if (editingId) {
        await api.patch(`/hr/employees/${editingId}`, {
          position: form.position,
          salary_type: form.salary_type,
          salary_amount: Number(form.salary_amount) || 0,
        });
      } else {
        const { data: branches } = await api.get("/companies/me/branches");
        const branchId = branches?.[0]?.id;
        if (!branchId) { window.alert("Сначала создайте филиал"); return; }

        const { data: user } = await api.get("/auth/me");
        await api.post("/hr/employees", {
          user_id: user.id,
          branch_id: branchId,
          position: form.position,
          hire_date: new Date().toISOString().slice(0, 10),
          salary_type: form.salary_type,
          salary_amount: Number(form.salary_amount) || 0,
        });
      }
      await loadEmployees();
      setDrawerOpen(false);
    } catch (e) {
      window.alert(e.response?.data?.detail || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(employee) {
    if (!window.confirm(`Удалить сотрудника «${employee.position}»?`)) return;
    try {
      await api.delete(`/hr/employees/${employee.id}`);
      await loadEmployees();
    } catch (e) {
      window.alert(e.response?.data?.detail || "Ошибка удаления");
    }
  }

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div><span className="eyebrow">Staff</span><h2>Сотрудники</h2></div>
        <button type="button" className="btn btn-primary" onClick={openCreate} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="bi-plus-circle" size={16} /> Добавить
        </button>
      </div>
      {error ? <div className="login-error">{error}</div> : null}
      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr><th>Позиция</th><th>Дата найма</th><th>Тип зарплаты</th><th>Сумма</th><th>Действия</th></tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <td>{employee.position}</td>
                <td>{employee.hire_date}</td>
                <td>{employee.salary_type === "fixed" ? "Фиксированная" : employee.salary_type === "hourly" ? "Почасовая" : employee.salary_type}</td>
                <td>{formatMoney(employee.salary_amount)}</td>
                <td>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="finance-action-edit" onClick={() => openEdit(employee)}><Icon name="bi-pencil" size={15} /></button>
                    <button type="button" className="is-danger" onClick={() => handleDelete(employee)}><Icon name="bi-trash3" size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {!employees.length ? <tr><td colSpan="5">Сотрудников пока нет.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {drawerOpen ? (
        <div className="finance-drawer" role="dialog" aria-modal="true">
          <div className="finance-drawer__backdrop" onClick={() => setDrawerOpen(false)} />
          <form className="finance-form" onSubmit={handleSave}>
            <header className="finance-form__header">
              <span className="finance-accent-bar" />
              <div>
                <p>Сотрудник</p>
                <h2>{editingId ? "Редактировать" : "Новый сотрудник"}</h2>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)}><Icon name="bi-x-lg" size={20} /></button>
            </header>
            <div className="finance-form__grid">
              <label><span>Позиция</span><input required value={form.position} onChange={(e) => setForm((c) => ({ ...c, position: e.target.value }))} placeholder="Кассир, Повар, Официант..." /></label>
              <label><span>Тип зарплаты</span>
                <select value={form.salary_type} onChange={(e) => setForm((c) => ({ ...c, salary_type: e.target.value }))}>
                  <option value="fixed">Фиксированная</option>
                  <option value="hourly">Почасовая</option>
                  <option value="percent">Процент</option>
                </select>
              </label>
              <label><span>Сумма</span><input type="number" value={form.salary_amount} onChange={(e) => setForm((c) => ({ ...c, salary_amount: e.target.value }))} placeholder="0" /></label>
            </div>
            <footer className="finance-form__footer">
              <button type="button" onClick={() => setDrawerOpen(false)}>Отмена</button>
              <button type="submit" disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</button>
            </footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "../api/client";
import { todayInputValue } from "../utils/date";
import { settingsService } from "../api/settings";
import { staffService } from "../api/staff";
import Icon from "../components/Icon";
import { isAbortError, useLatestRequest, useMutationLocks } from "../hooks/useAsyncSafety";
import { t } from "../i18n/t";

const STAFF_ROLE_SLUGS = new Set(["manager", "cashier", "waiter", "kitchen", "monoblock", "courier", "warehouse"]);
const emptyForm = { user_id: "", branch_id: "", position: "", salary_type: "fixed", salary_amount: "" };

function userLabel(user) {
  return user.name ? `${user.name} — ${user.email}` : user.email;
}

export default function StaffPage() {
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState("");
  const beginRequest = useLatestRequest();
  const mutationLocks = useMutationLocks();

  async function loadPage() {
    const request = beginRequest();
    setError("");
    try {
      const [{ data: employeeRows }, { data: companyUsers }, { data: companyBranches }] = await Promise.all([
        staffService.listEmployees({ signal: request.signal }),
        staffService.listCompanyUsers({ signal: request.signal }),
        settingsService.listBranches({ signal: request.signal }),
      ]);
      if (!request.isCurrent()) return false;
      if (!Array.isArray(employeeRows) || !Array.isArray(companyUsers) || !Array.isArray(companyBranches)) {
        throw new Error("Invalid staff response");
      }
      setEmployees(employeeRows);
      setUsers(companyUsers);
      setBranches(companyBranches);
      return true;
    } catch (err) {
      if (!request.isCurrent() || isAbortError(err)) return false;
      setError(err.response?.data?.detail || "Не удалось загрузить сотрудников и доступные учётные записи.");
      return false;
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }

  useEffect(() => { loadPage(); }, []);

  const eligibleUsers = useMemo(() => {
    const employeeUserIds = new Set(employees.map((employee) => String(employee.user_id)));
    return users.filter((user) => {
      const roleSlugs = Array.isArray(user.role_slugs) ? user.role_slugs : [];
      if (roleSlugs.length !== 1) return false;
      const roleSlug = roleSlugs[0];
      return user.is_active !== false
        && user.is_superadmin !== true
        && (!user.role_slug || user.role_slug === roleSlug)
        && STAFF_ROLE_SLUGS.has(roleSlug)
        && !employeeUserIds.has(String(user.id));
    });
  }, [employees, users]);

  function openCreate() {
    setEditingId(null);
    setMutationError("");
    setForm(emptyForm);
    setDrawerOpen(true);
  }

  function openEdit(employee) {
    setEditingId(employee.id);
    setMutationError("");
    setForm({
      user_id: String(employee.user_id),
      branch_id: String(employee.branch_id),
      position: employee.position,
      salary_type: employee.salary_type,
      salary_amount: String(employee.salary_amount),
    });
    setDrawerOpen(true);
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!mutationLocks.acquire("employee-save")) return;
    if (!editingId && !eligibleUsers.some((user) => String(user.id) === form.user_id)) {
      setMutationError("Выберите доступную учётную запись сотрудника.");
      mutationLocks.release("employee-save");
      return;
    }
    if (!branches.some((branch) => String(branch.id) === form.branch_id)) {
      setMutationError("Выберите филиал сотрудника.");
      mutationLocks.release("employee-save");
      return;
    }
    const salaryAmount = Number(form.salary_amount);
    if (!form.position.trim() || form.salary_amount === "" || !Number.isFinite(salaryAmount) || salaryAmount < 0) {
      setMutationError("Укажите должность и корректную сумму зарплаты.");
      mutationLocks.release("employee-save");
      return;
    }

    setSaving(true);
    setMutationError("");
    const commonPayload = {
      branch_id: form.branch_id,
      position: form.position.trim(),
      salary_type: form.salary_type,
      salary_amount: salaryAmount,
    };
    try {
      let confirmedEmployee;
      if (editingId) {
        const { data } = await staffService.updateEmployee(editingId, commonPayload);
        confirmedEmployee = data;
      } else {
        const { data } = await staffService.createEmployee({
          user_id: form.user_id,
          ...commonPayload,
          hire_date: todayInputValue(),
        });
        confirmedEmployee = data;
      }
      if (!confirmedEmployee?.id) throw new Error("Backend не вернул сохранённого сотрудника.");
      setEmployees((current) => editingId
        ? current.map((employee) => employee.id === editingId ? confirmedEmployee : employee)
        : [confirmedEmployee, ...current.filter((employee) => employee.id !== confirmedEmployee.id)]);
      await loadPage();
      setDrawerOpen(false);
    } catch (err) {
      setMutationError(err.response?.data?.detail || "Ошибка сохранения сотрудника.");
    } finally {
      setSaving(false);
      mutationLocks.release("employee-save");
    }
  }

  async function handleDelete(employee) {
    if (!window.confirm(`Удалить сотрудника «${employee.position}»?`)) return;
    const key = `employee-delete:${employee.id}`;
    if (!mutationLocks.acquire(key)) return;
    setPendingDeleteId(String(employee.id));
    try {
      await staffService.deleteEmployee(employee.id);
      await loadPage();
    } catch (err) {
      setError(err.response?.data?.detail || "Ошибка удаления сотрудника.");
    } finally {
      setPendingDeleteId("");
      mutationLocks.release(key);
    }
  }

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div><span className="eyebrow">{t("eyebrow.staff")}</span><h2>{t("pages.staffpage.sotrudniki")}</h2></div>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={openCreate} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="bi-plus-circle" size={16} /> {t("pages.staffpage.dobavit")}
        </button>
      </div>
      {loading ? <div className="dashboard-empty" role="status">{t("pages.staffpage.zagruzka_sotrudnikov")}</div> : null}
      {error ? <div className="login-error" role="alert">{error}</div> : null}
      {!loading && !error ? <div className="table-responsive">
        <table className="data-table">
          <thead><tr><th>{t("pages.staffpage.sotrudnik")}</th><th>{t("pages.staffpage.pozitsiya")}</th><th>{t("pages.staffpage.data_nayma")}</th><th>{t("pages.staffpage.tip_zarplaty")}</th><th>{t("pages.staffpage.summa")}</th><th>{t("pages.staffpage.deystviya")}</th></tr></thead>
          <tbody>
            {employees.map((employee) => <tr key={employee.id}>
              <td>{employee.name || employee.email || `ID: ${employee.user_id}`}</td>
              <td>{employee.position}</td><td>{employee.hire_date}</td>
              <td>{employee.salary_type === "fixed" ? "Фиксированная" : employee.salary_type === "hourly" ? "Почасовая" : employee.salary_type}</td>
              <td>{formatMoney(employee.salary_amount)}</td>
              <td><div style={{ display: "flex", gap: 8 }}><button type="button" className="finance-action-edit" disabled={saving || Boolean(pendingDeleteId)} onClick={() => openEdit(employee)} aria-label={`Редактировать ${employee.position}`}><Icon name="bi-pencil" size={15} /></button><button type="button" className="is-danger" disabled={pendingDeleteId === String(employee.id)} onClick={() => handleDelete(employee)} aria-label={`Удалить ${employee.position}`}><Icon name="bi-trash3" size={15} /></button></div></td>
            </tr>)}
            {!employees.length ? <tr><td colSpan="6">{t("pages.staffpage.sotrudnikov_poka_net")}</td></tr> : null}
          </tbody>
        </table>
      </div> : null}

      {drawerOpen ? <div className="finance-drawer" role="dialog" aria-modal="true">
        <div className="finance-drawer__backdrop" onClick={saving ? undefined : () => setDrawerOpen(false)} />
        <form className="finance-form" onSubmit={handleSave}>
          <header className="finance-form__header"><span className="finance-accent-bar" /><div><p>{t("pages.staffpage.sotrudnik")}</p><h2>{editingId ? "Редактировать" : "Новый сотрудник"}</h2></div><button type="button" disabled={saving} onClick={() => setDrawerOpen(false)} aria-label={t("pages.staffpage.zakryt")}><Icon name="bi-x-lg" size={20} /></button></header>
          <div className="finance-form__grid">
            {!editingId ? <label><span>{t("pages.staffpage.uchetnaya_zapis_sotrudnika")}</span><select aria-label={t("pages.staffpage.uchetnaya_zapis_sotrudnika")} required value={form.user_id} onChange={(event) => setForm((current) => ({ ...current, user_id: event.target.value }))}><option value="">{t("pages.staffpage.vyberite_sotrudnika")}</option>{eligibleUsers.map((user) => <option key={user.id} value={user.id}>{userLabel(user)}</option>)}</select></label> : null}
            <label><span>{t("pages.staffpage.filial")}</span><select aria-label={t("pages.staffpage.filial")} required value={form.branch_id} onChange={(event) => setForm((current) => ({ ...current, branch_id: event.target.value }))}><option value="">{t("pages.staffpage.vyberite_filial")}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label><span>{t("pages.staffpage.pozitsiya")}</span><input required value={form.position} onChange={(event) => setForm((current) => ({ ...current, position: event.target.value }))} /></label>
            <label><span>{t("pages.staffpage.tip_zarplaty")}</span><select value={form.salary_type} onChange={(event) => setForm((current) => ({ ...current, salary_type: event.target.value }))}><option value="fixed">{t("pages.staffpage.fiksirovannaya")}</option><option value="hourly">{t("pages.staffpage.pochasovaya")}</option><option value="percent">{t("pages.staffpage.protsent")}</option></select></label>
            <label><span>{t("pages.staffpage.summa")}</span><input type="number" value={form.salary_amount} onChange={(event) => setForm((current) => ({ ...current, salary_amount: event.target.value }))} /></label>
          </div>
          {mutationError ? <div className="login-error" role="alert">{mutationError}</div> : null}
          <footer className="finance-form__footer"><button type="button" onClick={() => setDrawerOpen(false)} disabled={saving}>{t("pages.staffpage.otmena")}</button><button type="submit" disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</button></footer>
        </form>
      </div> : null}
    </section>
  );
}

import { useEffect, useState } from "react";
import { settingsService } from "../../api/settings";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import { extractPhoneDigits, formatPhone, fullPhone, isPhoneComplete } from "../../utils/uzPhone";
import { enterBranchFromOwner } from "../../auth/branchSession";

// Страница «Филиалы» OWNER (сеть → филиалы). Один веб-аккаунт владельца на всю
// сеть; у каждого филиала — свой ЛОГИН-НОМЕР + пароль для входа с десктопа (шаг 1).
// Логин филиала — номер телефона (+998XXXXXXXXX): десктоп в поле логина принимает
// только номер, поэтому в форме держим 9 локальных цифр, а на бэкенд шлём каноничный
// вид через fullPhone(). Пароль не читается с бэкенда: пустое поле пароля = «не менять».
const EMPTY_FORM = { name: "", address: "", login: "", password: "" };

function SettingsBranchesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const beginRequest = useLatestRequest();
  const mutationLocks = useMutationLocks();

  useEffect(() => {
    const request = beginRequest();
    setError("");
    setLoading(true);
    settingsService.listBranches({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        setRows(items);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить филиалы.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [beginRequest]);

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError("");
    setShowPassword(false);
    setDrawerOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    // form.login держит 9 локальных цифр; из бэкенда приходит +998XXXXXXXXX.
    setForm({ name: row.name || "", address: row.address || "", login: extractPhoneDigits(row.login), password: "" });
    setSaveError("");
    setShowPassword(false);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (saving) return;
    setDrawerOpen(false);
    setSaveError("");
  };

  const save = async (event) => {
    event.preventDefault();
    if (!mutationLocks.acquire("branch-save")) return;
    const name = form.name.trim();
    const loginDigits = form.login; // уже только цифры (extractPhoneDigits в onChange)
    const hasLogin = loginDigits.length > 0;
    if (!name) {
      setSaveError("Укажите название филиала.");
      mutationLocks.release("branch-save");
      return;
    }
    // Логин филиала — номер телефона: если начали вводить, требуем полный номер.
    if (hasLogin && !isPhoneComplete(loginDigits)) {
      setSaveError("Введите номер филиала полностью: +998 и 9 цифр.");
      mutationLocks.release("branch-save");
      return;
    }
    // Логин без пароля бесполезен для входа с десктопа: при создании требуем оба.
    if (!editingId && hasLogin && !form.password) {
      setSaveError("Для входа филиала с десктопа задайте пароль.");
      mutationLocks.release("branch-save");
      return;
    }
    const payload = { name, address: form.address.trim() || null };
    if (hasLogin) payload.login = fullPhone(loginDigits); // каноничный +998XXXXXXXXX
    if (form.password) payload.password = form.password;
    setSaving(true);
    setSaveError("");
    try {
      const { data } = editingId
        ? await settingsService.updateBranch(editingId, payload)
        : await settingsService.createBranch(payload);
      setRows((current) => editingId
        ? current.map((row) => (row.id === data.id ? data : row))
        : [data, ...current.filter((row) => row.id !== data.id)]);
      setDrawerOpen(false);
    } catch (err) {
      setSaveError(err.response?.data?.detail || "Не удалось сохранить филиал.");
    } finally {
      setSaving(false);
      mutationLocks.release("branch-save");
    }
  };

  // Войти в филиал (переключиться из сети владельца в его админку).
  const enterBranch = async (branchId) => {
    if (!mutationLocks.acquire("branch-enter")) return;
    setError("");
    try {
      await enterBranchFromOwner(branchId); // при успехе страница перезагрузится
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось войти в филиал.");
      mutationLocks.release("branch-enter");
    }
  };

  // PLACEHOLDER_RENDER
  return (
    <div className="settings-page">
      <section className="settings-card">
        <header className="settings-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" />
            <div>
              <p>Настройки</p>
              <h1>Филиалы</h1>
            </div>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={openAdd}>Добавить +</button>
          </div>
        </header>

        <div className="settings-table-wrapper">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Адрес</th>
                <th>Номер (логин кассы)</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name || "-"}</td>
                  <td>{row.address || "-"}</td>
                  <td>{row.login ? formatPhone(extractPhoneDigits(row.login)) : "—"}</td>
                  <td>
                    <div className="settings-row-actions">
                      <button type="button" className="settings-action-enter" onClick={() => enterBranch(row.id)}>
                        Войти
                      </button>
                      <button type="button" className="settings-action-edit" onClick={() => openEdit(row)} aria-label="Изменить">
                        <Icon name="bi-pencil" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {loading ? <tr><td colSpan={4}><div className="settings-empty-state">Загрузка...</div></td></tr> : null}
              {!loading && error ? <tr><td colSpan={4}><div className="settings-empty-state" role="alert">{error}</div></td></tr> : null}
              {!loading && !error && !rows.length ? <tr><td colSpan={4}><div className="settings-empty-state">Филиалов пока нет</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* PLACEHOLDER_DRAWER */}
      {drawerOpen ? (
        <div className="settings-drawer" role="dialog" aria-modal="true">
          <div className="settings-drawer__backdrop" onClick={closeDrawer} />
          <form className="settings-form" onSubmit={save} autoComplete="off">
            <header className="settings-form__header">
              <span className="settings-accent-bar" />
              <div>
                <p>{editingId ? "Редактирование" : "Новый филиал"}</p>
                <h2>Филиал</h2>
              </div>
              <button type="button" disabled={saving} onClick={closeDrawer} aria-label="Закрыть"><Icon name="bi-x-lg" size={20} /></button>
            </header>
            <div className="settings-form__grid">
              <label>
                <span>Название</span>
                <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="Например: Филиал на Чиланзаре" />
              </label>
              <label>
                <span>Адрес</span>
                <input value={form.address} onChange={(event) => updateForm("address", event.target.value)} placeholder="Улица, дом" />
              </label>
              <label>
                <span>Номер филиала (логин для входа с кассы)</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={formatPhone(form.login)}
                  onChange={(event) => updateForm("login", extractPhoneDigits(event.target.value))}
                  placeholder="+998 90 123-45-67"
                />
              </label>
              <label>
                <span>{editingId ? "Новый пароль" : "Пароль"}</span>
                <div className="staff-password-field">
                  <input
                    autoComplete="new-password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(event) => updateForm("password", event.target.value)}
                    placeholder="Пароль филиала"
                  />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"} aria-pressed={showPassword}>
                    <Icon name={showPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
                  </button>
                </div>
                {editingId ? <small className="muted">Оставьте пустым, чтобы не менять пароль.</small> : null}
              </label>
            </div>
            {saveError ? <Toast kind="error" message={saveError} onClose={() => setSaveError("")} /> : null}
            <footer className="settings-form__footer">
              <button type="button" disabled={saving} onClick={closeDrawer}>Отмена</button>
              <button type="submit" disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default SettingsBranchesPage;

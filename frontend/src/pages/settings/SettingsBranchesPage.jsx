import { useEffect, useState } from "react";
import { settingsService } from "../../api/settings";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import { extractPhoneDigits, formatPhone, fullPhone, isPhoneComplete } from "../../utils/uzPhone";
import { enterBranchFromOwner } from "../../auth/branchSession";
import { t } from "../../i18n/t";

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
              <p>{t("pages.settings.settingsbranchespage.nastroyki")}</p>
              <h1>{t("pages.settings.settingsbranchespage.filialy")}</h1>
            </div>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={openAdd}>{t("pages.settings.settingsbranchespage.dobavit")}</button>
          </div>
        </header>

        <div className="settings-table-wrapper">
          <table className="settings-table">
            <thead>
              <tr>
                <th>{t("pages.settings.settingsbranchespage.nazvanie")}</th>
                <th>{t("pages.settings.settingsbranchespage.adres")}</th>
                <th>{t("pages.settings.settingsbranchespage.nomer_login_kassy")}</th>
                <th>{t("pages.settings.settingsbranchespage.deystviya")}</th>
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
                       {t("pages.settings.settingsbranchespage.voyti")}
                      </button>
                      <button type="button" className="settings-action-edit" onClick={() => openEdit(row)} aria-label={t("pages.settings.settingsbranchespage.izmenit")}>
                        <Icon name="bi-pencil" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {loading ? <tr><td colSpan={4}><div className="settings-empty-state">{t("pages.settings.settingsbranchespage.zagruzka")}</div></td></tr> : null}
              {!loading && error ? <tr><td colSpan={4}><div className="settings-empty-state" role="alert">{error}</div></td></tr> : null}
              {!loading && !error && !rows.length ? <tr><td colSpan={4}><div className="settings-empty-state">{t("pages.settings.settingsbranchespage.filialov_poka_net")}</div></td></tr> : null}
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
                <h2>{t("pages.settings.settingsbranchespage.filial")}</h2>
              </div>
              <button type="button" disabled={saving} onClick={closeDrawer} aria-label={t("pages.settings.settingsbranchespage.zakryt")}><Icon name="bi-x-lg" size={20} /></button>
            </header>
            <div className="settings-form__grid">
              <label>
                <span>{t("pages.settings.settingsbranchespage.nazvanie")}</span>
                <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder={t("pages.settings.settingsbranchespage.naprimer_filial_na_chilanzare")} />
              </label>
              <label>
                <span>{t("pages.settings.settingsbranchespage.adres")}</span>
                <input value={form.address} onChange={(event) => updateForm("address", event.target.value)} placeholder={t("pages.settings.settingsbranchespage.ulitsa_dom")} />
              </label>
              <label>
                <span>{t("pages.settings.settingsbranchespage.nomer_filiala_login_dlya_vhoda_s_kassy")}</span>
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
                    placeholder={t("pages.settings.settingsbranchespage.parol_filiala")}
                  />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"} aria-pressed={showPassword}>
                    <Icon name={showPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
                  </button>
                </div>
                {editingId ? <small className="muted">{t("pages.settings.settingsbranchespage.ostavte_pustym_chtoby_ne_menyat_parol")}</small> : null}
              </label>
            </div>
            {saveError ? <Toast kind="error" message={saveError} onClose={() => setSaveError("")} /> : null}
            <footer className="settings-form__footer">
              <button type="button" disabled={saving} onClick={closeDrawer}>{t("pages.settings.settingsbranchespage.otmena")}</button>
              <button type="submit" disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default SettingsBranchesPage;

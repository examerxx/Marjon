import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { settingsService } from "../../api/settings";
import Icon from "../../components/Icon";
import ReportEmptyState from "../../components/ReportEmptyState";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import "./SettingsPrintersPage.css";

const RESOURCE = "printers";

// Simplified V2 contract: the form collects exactly { name, ip, active }.
// printer_type/connection_type/port fall back to canonical backend defaults
// (receipt / network / 9100) because the backend requires printer_type while
// the simplified entity deliberately exposes no technical fields.
const DEFAULT_PRINTER_TYPE = "receipt";
const DEFAULT_CONNECTION_TYPE = "network";
const DEFAULT_PORT = 9100;

export function mapRow(item) {
  return {
    id: item.id,
    name: item.name || "",
    printerType: item.printer_type || "",
    connectionType: item.connection_type || "",
    ip: item.ip_address || "",
    port: item.port == null ? "" : String(item.port),
    devicePath: item.device_path || "",
    paperWidth: item.paper_width ?? 80,
    branchId: item.branch_id || "",
    zone: item.zone || item.print_zone || "",
    active: item.is_active !== false,
  };
}

// Keep the historical export names: RequestFormSafety asserts this exact
// boundary (canonical-fields-only, invalid input rejected without POST).
export const apiMapRow = mapRow;

// Build the request payload. Returns null when the form is invalid so the
// caller surfaces a validation message WITHOUT hitting the backend.
// Only the three form fields map here: name, ip_address, and (on EDIT only)
// is_active — the backend Create schema has no status field, so Add+inactive
// is persisted with an explicit follow-up PATCH in save() instead of a fake.
export const apiMapFormToPayload = (form, { editing }) => {
  const name = String(form.name ?? "").trim();
  if (!name) return null;
  const ip = String(form.ip ?? "").trim();
  if (!ip) return null;
  if (editing) {
    return { name, ip_address: ip, is_active: Boolean(form.active) };
  }
  return {
    name,
    printer_type: DEFAULT_PRINTER_TYPE,
    connection_type: DEFAULT_CONNECTION_TYPE,
    ip_address: ip,
    port: DEFAULT_PORT,
  };
};

const EMPTY_FORM = { name: "", ip: "", active: true };

function extractItems(data) {
  if (Array.isArray(data)) return data;
  return data?.items || data?.results || [];
}

function SettingsPrintersPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawerMode, setDrawerMode] = useState(null); // null | "create" | "edit"
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const beginRequest = useLatestRequest();
  const mutationLocks = useMutationLocks();

  useEffect(() => {
    const request = beginRequest();
    setLoading(true);
    setError("");
    settingsService
      .listResource(RESOURCE, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        setRows(extractItems(data).map(mapRow));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить принтеры.");
      })
      .finally(() => {
        if (request.isCurrent()) setLoading(false);
      });
  }, [beginRequest]);

  // Escape closes whichever overlay is open (delete confirm takes priority
  // over the create/edit modal), unless a request is in flight.
  useEffect(() => {
    if (!drawerMode && !deleteTarget) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (deleteTarget && !deleting) setDeleteTarget(null);
      else if (drawerMode && !saving) setDrawerMode(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerMode, deleteTarget, saving, deleting]);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setDrawerMode("create");
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({ name: row.name, ip: row.ip, active: row.active });
    setFormError("");
    setDrawerMode("edit");
  };

  const closeDrawer = () => {
    if (saving) return;
    setDrawerMode(null);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!mutationLocks.acquire("save")) return;
    const payload = apiMapFormToPayload(form, { editing: Boolean(editingId) });
    if (!payload) {
      setFormError("Проверьте поля: «Название» и «IP адрес» обязательны.");
      mutationLocks.release("save");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (editingId) {
        const { data } = await settingsService.updateResource(RESOURCE, editingId, payload);
        if (!data?.id) throw new Error("Backend не вернул сохранённый принтер.");
        const mapped = mapRow(data);
        setRows((current) => current.map((r) => (r.id === editingId ? mapped : r)));
      } else {
        const { data } = await settingsService.createResource(RESOURCE, payload);
        if (!data?.id) throw new Error("Backend не вернул сохранённый принтер.");
        let saved = data;
        // Create cannot persist is_active (no such field in PrinterCreate):
        // an explicit follow-up PATCH makes Add+inactive real instead of fake.
        if (!form.active) {
          try {
            const { data: patched } = await settingsService.updateResource(RESOURCE, data.id, { is_active: false });
            if (patched?.id) saved = patched;
          } catch (patchError) {
            setRows((current) => [mapRow(data), ...current]);
            setDrawerMode(null);
            setError(patchError.response?.data?.detail || "Принтер создан, но не удалось выключить его. Он остался активным.");
            return;
          }
        }
        setRows((current) => [mapRow(saved), ...current]);
      }
      setDrawerMode(null);
    } catch (err) {
      setFormError(err.response?.data?.detail || "Не удалось сохранить. Попробуйте позже.");
    } finally {
      setSaving(false);
      mutationLocks.release("save");
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target || !mutationLocks.acquire(`delete:${target.id}`)) return;
    setDeleting(true);
    try {
      await settingsService.deleteResource(RESOURCE, target.id);
      // Backend hard-deletes (no deleted_at on printers): drop the row only
      // after the backend confirms — never optimistically.
      setRows((current) => current.filter((r) => r.id !== target.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteTarget(null);
      setError(err.response?.data?.detail || "Не удалось удалить. Попробуйте позже.");
    } finally {
      setDeleting(false);
      mutationLocks.release(`delete:${target.id}`);
    }
  };

  return (
    <div className="settings-page settings-owner-view printers-page">
      <section className="settings-card">
        <header className="settings-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" />
            <div>
              <p>Настройки</p>
              <h1>Настройка принтеров</h1>
            </div>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={openAdd}>
              <Icon name="bi-plus" size={18} aria-hidden="true" />
              Добавить принтер
            </button>
          </div>
        </header>

        {loading ? (
          <div className="settings-empty-state" role="status">Загрузка...</div>
        ) : error && rows.length === 0 ? (
          <div className="settings-empty-state" role="alert">
            {error}
            <button type="button" className="settings-places-retry" onClick={() => window.location.reload()}>Повторить</button>
          </div>
        ) : (
          <>
            {error && rows.length > 0 ? (
              <div className="settings-form__error" role="alert">{error}</div>
            ) : null}
            <div className="settings-table-wrapper">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Название</th>
                    <th>IP адрес</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.id}>
                      <td>{index + 1}</td>
                      <td>{row.name || "—"}</td>
                      <td>{row.ip || row.devicePath || "—"}</td>
                      <td>
                        <span className={`settings-status-badge ${row.active ? "is-active" : "is-inactive"}`}>
                          <span className="settings-status-badge__dot" aria-hidden="true" />
                          {row.active ? "Активен" : "Не активен"}
                        </span>
                      </td>
                      <td>
                        <div className="settings-row-actions">
                          <button type="button" className="settings-action-edit" aria-label={`Редактировать «${row.name}»`} onClick={() => openEdit(row)}>
                            <Icon name="bi-pencil" size={15} />
                          </button>
                          <button type="button" className="settings-action-delete" aria-label={`Удалить «${row.name}»`} disabled={deleting} onClick={() => setDeleteTarget(row)}>
                            <Icon name="bi-trash3" size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!error && rows.length === 0 ? (
                    <tr className="pp-empty-row">
                      <td colSpan={5} className="pp-empty-cell">
                        <ReportEmptyState title="Список принтеров пуст" />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {drawerMode ? createPortal((
        <div className="settings-owner-view printers-modal-layer">
          <div className="settings-drawer settings-modal-overlay" role="presentation">
            <div className="settings-drawer__backdrop" onClick={closeDrawer} />
            <form className="settings-form settings-modal" role="dialog" aria-modal="true" aria-labelledby="printer-drawer-title" onSubmit={save}>
              <header className="settings-form__header">
                <span className="settings-accent-bar" />
                <div>
                  <p>{editingId ? "Редактирование" : "Новая запись"}</p>
                  <h2 id="printer-drawer-title">{editingId ? "Редактировать принтер" : "Добавить принтер"}</h2>
                </div>
                <button type="button" aria-label="Закрыть" disabled={saving} onClick={closeDrawer}>
                  <Icon name="bi-x-lg" size={20} />
                </button>
              </header>
              <div className="settings-form__body">
                <label>
                  <span>Название</span>
                  <input
                    autoFocus
                    value={form.name}
                    onChange={(event) => setForm((cur) => ({ ...cur, name: event.target.value }))}
                  />
                </label>
                <label>
                  <span>IP адрес</span>
                  <input
                    inputMode="decimal"
                    value={form.ip}
                    placeholder="192.168.1.15"
                    onChange={(event) => setForm((cur) => ({ ...cur, ip: event.target.value }))}
                  />
                </label>
                <div className="settings-toggle-field settings-form__wide">
                  <span>Статус</span>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(event) => setForm((cur) => ({ ...cur, active: event.target.checked }))}
                    />
                    <span className="settings-switch__track" aria-hidden="true"><span className="settings-switch__thumb" /></span>
                    <span className={`settings-switch__label ${form.active ? "is-active" : "is-inactive"}`}>
                      {form.active ? "Активен" : "Не активен"}
                    </span>
                  </label>
                </div>
              </div>
              {formError ? <p className="settings-form__error" role="alert">{formError}</p> : null}
              <footer className="settings-form__footer">
                <button type="button" disabled={saving} onClick={closeDrawer}>Отмена</button>
                <button type="submit" disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</button>
              </footer>
            </form>
          </div>
        </div>
      ), document.body) : null}

      {deleteTarget ? createPortal((
        <div className="settings-owner-view printers-modal-layer">
          <div className="settings-drawer settings-modal-overlay" role="presentation">
            <div className="settings-drawer__backdrop" onClick={deleting ? undefined : () => setDeleteTarget(null)} />
            <div className="settings-form settings-modal settings-confirm" role="dialog" aria-modal="true" aria-labelledby="printer-delete-title" aria-describedby="printer-delete-body">
              <header className="settings-form__header">
                <span className="settings-accent-bar" />
                <div>
                  <p>Удаление</p>
                  <h2 id="printer-delete-title">Удалить принтер?</h2>
                </div>
                <button type="button" aria-label="Закрыть" disabled={deleting} onClick={() => setDeleteTarget(null)}>
                  <Icon name="bi-x-lg" size={18} />
                </button>
              </header>
              <div className="settings-form__body">
                <p id="printer-delete-body" className="settings-confirm__text">
                  «<strong>{deleteTarget.name}</strong>» будет удалён из настроек.
                </p>
              </div>
              <footer className="settings-form__footer">
                <button type="button" autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>Отмена</button>
                <button type="button" className="settings-confirm__delete" disabled={deleting} onClick={confirmDelete}>
                  {deleting ? "Удаление..." : "Удалить"}
                </button>
              </footer>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}

export default SettingsPrintersPage;

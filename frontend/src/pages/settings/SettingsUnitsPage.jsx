import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { settingsService } from "../../api/settings";
import Icon from "../../components/Icon";
import ReportEmptyState from "../../components/ReportEmptyState";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import "./SettingsUnitsPage.css";

const RESOURCE = "units";

// Backend truth (nomenclature Unit): global picklist, no company scope.
// Reads are open to any authenticated staff; writes are HQ-admin-only, so an
// OWNER currently receives 403 on every mutation. The UI below exposes the
// full interaction surface but NEVER fakes persistence: failed mutations keep
// canonical server state and surface a truthful error.
export function mapRow(item) {
  return {
    id: item.id,
    sort: item.sort ?? item.sort_order ?? 0,
    name: item.name || "",
    shortName: item.short_name ?? "",
    active: (item.status ?? item.is_active) !== false,
  };
}

// Modal payload (Сорт lives only in the inline table editor, never here).
// Returns null when the form is invalid so the caller can surface a
// validation message WITHOUT hitting the backend. `status` is always sent:
// the old mapper dropped it, silently discarding status edits.
export function formToPayload(form) {
  const name = String(form.name ?? "").trim();
  if (!name) return null;
  const shortName = String(form.short_name ?? form.shortName ?? "").trim();
  if (!shortName) return null;
  return {
    name,
    short_name: shortName,
    status: Boolean(form.active),
  };
}

const EMPTY_FORM = { name: "", shortName: "", active: true };

// Session-only snapshot of the last SUCCESSFUL real GET /units result (rows
// or confirmed empty). Memory only — never localStorage/sessionStorage,
// never fake rows, never locally edited values. Return visits render the
// cached real state instantly while a background revalidation reconciles
// with the server. Null = never loaded successfully.
let cachedUnits = null;
export function resetUnitsCacheForTest() {
  cachedUnits = null;
}

// OWNER truthful-mutation notice (backend currently answers 403 for owner
// writes on the global units picklist). Shown instead of a fake success.
const OWNER_MUTATION_BLOCKED_MESSAGE = "Изменение единиц измерения пока недоступно для владельца.";
const DELETE_CONFLICT_MESSAGE = "Единица измерения используется и не может быть удалена.";

function extractItems(data) {
  if (Array.isArray(data)) return data;
  return data?.items || data?.results || [];
}

function SettingsUnitsPage() {
  // Lazy init from the session cache so a return visit renders real content
  // on the very first paint (no one-frame Загрузка... before the effect).
  const [rows, setRows] = useState(() => cachedUnits ?? []);
  const [loading, setLoading] = useState(() => cachedUnits === null);
  const [error, setError] = useState("");
  const [drawerMode, setDrawerMode] = useState(null); // null | "create" | "edit"
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // Per-row inline Sort drafts (never written to rows until the backend
  // confirms). Clearing a draft restores the canonical server value.
  const [sortDrafts, setSortDrafts] = useState({});

  const beginRequest = useLatestRequest();
  const mutationLocks = useMutationLocks();

  const load = (options = {}) => {
    const request = beginRequest();
    // Background revalidation (return visit with cached truth) must never
    // flash loading nor blank cached rows/empty: it reconciles silently.
    const background = Boolean(options.background) && cachedUnits !== null;
    if (!background) setLoading(true);
    setError("");
    settingsService
      .listResource(RESOURCE, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const mapped = extractItems(data).map(mapRow);
        cachedUnits = mapped;
        setRows(mapped);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        if (background) {
          // Keep the last successful real state visible; surface a
          // restrained refresh error instead of blanking the page.
          setError(err.response?.data?.detail || "Не удалось обновить единицы измерения.");
          return;
        }
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить единицы измерения.");
      })
      .finally(() => {
        if (request.isCurrent() && !background) setLoading(false);
      });
  };

  useEffect(() => {
    if (cachedUnits !== null) {
      // Return visit: render last successful real result instantly (rows or
      // confirmed empty-table state), then revalidate in background.
      // First visit (null): truthful loading.
      setRows(cachedUnits);
      setLoading(false);
      load({ background: true });
      return undefined;
    }
    load();
  }, [beginRequest]);

  // Escape closes whichever overlay is open (delete confirm takes priority
  // over the create/edit drawer), unless a request is in flight.
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
    setDrawerMode("create");
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({ name: row.name, shortName: row.shortName, active: row.active });
    setDrawerMode("edit");
  };

  const closeDrawer = () => {
    if (saving) return;
    setDrawerMode(null);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!mutationLocks.acquire("save")) return;
    const payload = formToPayload(form);
    if (!payload) {
      setError("Проверьте поля: «Название» и «Короткое название» обязательны.");
      mutationLocks.release("save");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data } = editingId
        ? await settingsService.updateResource(RESOURCE, editingId, payload)
        : await settingsService.createResource(RESOURCE, payload);
      if (!data?.id) throw new Error("Backend не вернул сохранённую запись.");
      const mapped = mapRow(data);
      setRows((current) =>
        editingId ? current.map((r) => (r.id === editingId ? mapped : r)) : [mapped, ...current],
      );
      setDrawerMode(null);
    } catch (err) {
      if (err.response?.status === 403) {
        setError(OWNER_MUTATION_BLOCKED_MESSAGE);
      } else {
        setError(err.response?.data?.detail || "Не удалось сохранить. Попробуйте позже.");
      }
    } finally {
      setSaving(false);
      mutationLocks.release("save");
    }
  };

  const commitSort = async (row, rawValue) => {
    const key = String(row.id);
    setSortDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    const text = String(rawValue ?? "").trim();
    if (text === String(row.sort ?? "")) return;
    if (!/^\d+$/.test(text)) {
      setError("Сорт должен быть целым числом. Значение не сохранено.");
      return;
    }
    if (!mutationLocks.acquire(`sort:${row.id}`)) return;
    setError("");
    try {
      const { data } = await settingsService.updateResource(RESOURCE, row.id, { sort: Number(text) });
      const mapped = mapRow(data?.id
        ? data
        : { ...row, sort: Number(text), short_name: row.shortName, status: row.active });
      setRows((current) => current.map((r) => (r.id === row.id ? mapped : r)));
    } catch (err) {
      if (err.response?.status === 403) {
        setError(OWNER_MUTATION_BLOCKED_MESSAGE);
      } else {
        setError(err.response?.data?.detail || "Не удалось сохранить сортировку.");
      }
    } finally {
      mutationLocks.release(`sort:${row.id}`);
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target || !mutationLocks.acquire(`delete:${target.id}`)) return;
    setDeleting(true);
    try {
      await settingsService.deleteResource(RESOURCE, target.id);
      // Only drop the row after the backend confirms the delete — never
      // optimistically, so a rejected delete leaves the list truthful.
      setRows((current) => current.filter((r) => r.id !== target.id));
      setDeleteTarget(null);
    } catch (err) {
      if (err.response?.status === 409) {
        setDeleteTarget(null);
        setError(err.response?.data?.detail || DELETE_CONFLICT_MESSAGE);
      } else if (err.response?.status === 403) {
        setError(OWNER_MUTATION_BLOCKED_MESSAGE);
      } else {
        setError(err.response?.data?.detail || "Не удалось удалить. Попробуйте позже.");
      }
    } finally {
      setDeleting(false);
      mutationLocks.release(`delete:${target.id}`);
    }
  };

  return (
    <div className="settings-page settings-owner-view units-page">
      <section className="settings-card">
        <header className="settings-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" />
            <div>
              <p>Настройки</p>
              <h1>Единица измерения</h1>
            </div>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={openAdd}>Добавить единицу измерения</button>
          </div>
        </header>

        {loading ? (
          <div className="settings-empty-state" role="status">Загрузка...</div>
        ) : error && rows.length === 0 && cachedUnits === null ? (
          <div className="settings-empty-state" role="alert">
            {error}
            <button type="button" className="settings-places-retry" onClick={load}>Повторить</button>
          </div>
        ) : rows.length === 0 ? (
          <>
            {error ? (
              <div className="settings-form__error" role="alert">{error}</div>
            ) : null}
            <div className="settings-table-wrapper">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>Сорт</th>
                    <th>Название</th>
                    <th>Короткое название</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="pm-empty-row">
                    <td colSpan={5} className="pm-empty-cell">
                      <ReportEmptyState title="Единиц измерения пока нет" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            {error ? (
              <div className="settings-form__error" role="alert">{error}</div>
            ) : null}
            <div className="settings-table-wrapper">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>Сорт</th>
                    <th>Название</th>
                    <th>Короткое название</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          className="settings-inline-input"
                          inputMode="numeric"
                          aria-label={`Сорт: ${row.name}`}
                          value={sortDrafts[String(row.id)] ?? String(row.sort ?? "")}
                          onChange={(event) => setSortDrafts((current) => ({
                            ...current,
                            [String(row.id)]: event.target.value.replace(/[^0-9]/g, ""),
                          }))}
                          onBlur={(event) => commitSort(row, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.target.blur();
                          }}
                        />
                      </td>
                      <td>{row.name || "—"}</td>
                      <td>{row.shortName || "—"}</td>
                      <td>
                        <span className={`settings-status-badge ${row.active ? "is-active" : "is-inactive"}`}>
                          <span className="settings-status-badge__dot" aria-hidden="true" />
                          {row.active ? "Активен" : "Неактивен"}
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
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {drawerMode ? createPortal((
        <div className="settings-owner-view units-modal-layer">
          <div className="settings-drawer settings-modal-overlay" role="presentation">
            <div className="settings-drawer__backdrop" onClick={closeDrawer} />
            <form className="settings-form settings-modal" role="dialog" aria-modal="true" aria-labelledby="unit-drawer-title" onSubmit={save}>
              <header className="settings-form__header">
                <span className="settings-accent-bar" />
                <div>
                  <p>{editingId ? "Редактирование" : "Новая запись"}</p>
                  <h2 id="unit-drawer-title">{editingId ? "Редактировать единицу измерения" : "Добавить единицу измерения"}</h2>
                </div>
                <button type="button" aria-label="Закрыть" disabled={saving} onClick={closeDrawer}>
                  <Icon name="bi-x-lg" size={20} />
                </button>
              </header>
              <div className="settings-form__body">
                <div className="u-form-row">
                  <label>
                    <span>Название</span>
                    <input
                      autoFocus
                      value={form.name}
                      onChange={(event) => setForm((cur) => ({ ...cur, name: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Короткое название</span>
                    <input
                      value={form.shortName}
                      onChange={(event) => setForm((cur) => ({ ...cur, shortName: event.target.value }))}
                    />
                  </label>
                </div>
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
                      {form.active ? "Активен" : "Неактивен"}
                    </span>
                  </label>
                </div>
              </div>
              {error ? <p className="settings-form__error" role="alert">{error}</p> : null}
              <footer className="settings-form__footer">
                <button type="button" disabled={saving} onClick={closeDrawer}>Отмена</button>
                <button type="submit" disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</button>
              </footer>
            </form>
          </div>
        </div>
      ), document.body) : null}

      {deleteTarget ? createPortal((
        <div className="settings-owner-view units-modal-layer">
          <div className="settings-drawer settings-modal-overlay" role="presentation">
            <div className="settings-drawer__backdrop" onClick={deleting ? undefined : () => setDeleteTarget(null)} />
            <div className="settings-form settings-modal settings-confirm" role="dialog" aria-modal="true" aria-labelledby="unit-delete-title" aria-describedby="unit-delete-body">
              <header className="settings-form__header">
                <span className="settings-accent-bar" />
                <div>
                  <p>Удаление</p>
                  <h2 id="unit-delete-title">Удалить единицу измерения?</h2>
                </div>
                <button type="button" aria-label="Закрыть" disabled={deleting} onClick={() => setDeleteTarget(null)}>
                  <Icon name="bi-x-lg" size={18} />
                </button>
              </header>
              <div className="settings-form__body">
                <p id="unit-delete-body" className="settings-confirm__text">
                  «<strong>{deleteTarget.name}</strong>» будет удалена. Это действие необратимо.
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

export default SettingsUnitsPage;

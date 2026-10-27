import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { settingsService } from "../../api/settings";
import Icon from "../../components/Icon";
import ReportEmptyState from "../../components/ReportEmptyState";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import { t } from "../../i18n/t";
import "./SettingsUnitsPage.css";

const RESOURCE = "units";

// Backend truth (nomenclature Unit): global system rows plus company-owned
// rows. OWNER mutations are available only for own company rows; global rows
// stay visible and read-only.
export function mapRow(item) {
  return {
    id: item.id,
    sort: item.sort ?? item.sort_order ?? 0,
    name: item.name || "",
    shortName: item.short_name ?? "",
    active: (item.status ?? item.is_active) !== false,
    companyId: item.company_id ?? null,
    isGlobal: item.is_global ?? item.company_id == null,
  };
}

// Modal payload (Сорт is preserved by the backend and displayed read-only in
// the table, matching Settings → Payment Methods).
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

const DELETE_CONFLICT_MESSAGE = "Единица измерения используется и не может быть удалена.";

function mutationError(err, fallback) {
  return err.response?.data?.detail || fallback;
}

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
      setRows((current) => {
        const next = editingId
          ? current.map((r) => (r.id === editingId ? mapped : r))
          : [mapped, ...current];
        cachedUnits = next;
        return next;
      });
      setDrawerMode(null);
    } catch (err) {
      setError(mutationError(err, "Не удалось сохранить. Попробуйте позже."));
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
      // Only drop the row after the backend confirms the delete — never
      // optimistically, so a rejected delete leaves the list truthful.
      setRows((current) => {
        const next = current.filter((r) => r.id !== target.id);
        cachedUnits = next;
        return next;
      });
      setDeleteTarget(null);
    } catch (err) {
      if (err.response?.status === 409) {
        setDeleteTarget(null);
        setError(err.response?.data?.detail || DELETE_CONFLICT_MESSAGE);
      } else {
        setError(mutationError(err, "Не удалось удалить. Попробуйте позже."));
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
              <p>{t("pages.settings.settingsunitspage.nastroyki")}</p>
              <h1>{t("pages.settings.settingsunitspage.edinitsa_izmereniya")}</h1>
            </div>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={openAdd}>{t("pages.settings.settingsunitspage.dobavit_edinitsu_izmereniya")}</button>
          </div>
        </header>

        {loading ? (
          <div className="settings-empty-state" role="status">{t("pages.settings.settingsunitspage.zagruzka")}</div>
        ) : error && rows.length === 0 && cachedUnits === null ? (
          <div className="settings-empty-state" role="alert">
            {error}
            <button type="button" className="settings-places-retry" onClick={load}>{t("pages.settings.settingsunitspage.povtorit")}</button>
          </div>
        ) : rows.length === 0 ? (
          <>
            {error ? (
              <div className="settings-form__error" role="alert">{error}</div>
            ) : null}
            <div className="settings-table-wrapper">
              <table className="settings-table">
                <colgroup>
                  <col className="units-col-sort" />
                  <col className="units-col-name" />
                  <col className="units-col-short" />
                  <col className="units-col-status" />
                  <col className="units-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t("pages.settings.settingsunitspage.sort")}</th>
                    <th>{t("pages.settings.settingsunitspage.nazvanie")}</th>
                    <th>{t("pages.settings.settingsunitspage.korotkoe_nazvanie")}</th>
                    <th>{t("pages.settings.settingsunitspage.status")}</th>
                    <th>{t("pages.settings.settingsunitspage.deystviya")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="pm-empty-row">
                    <td colSpan={5} className="pm-empty-cell">
                      <ReportEmptyState title={t("pages.settings.settingsunitspage.edinits_izmereniya_poka_net")} />
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
                <colgroup>
                  <col className="units-col-sort" />
                  <col className="units-col-name" />
                  <col className="units-col-short" />
                  <col className="units-col-status" />
                  <col className="units-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t("pages.settings.settingsunitspage.sort")}</th>
                    <th>{t("pages.settings.settingsunitspage.nazvanie")}</th>
                    <th>{t("pages.settings.settingsunitspage.korotkoe_nazvanie")}</th>
                    <th>{t("pages.settings.settingsunitspage.status")}</th>
                    <th>{t("pages.settings.settingsunitspage.deystviya")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.sort === 0 || row.sort ? String(row.sort) : "—"}</td>
                      <td>
                        <span className="units-name-cell">
                          <span>{row.name || "—"}</span>
                          {row.isGlobal ? <span className="units-system-badge">{t("pages.settings.settingsunitspage.sistemnaya")}</span> : null}
                        </span>
                      </td>
                      <td>{row.shortName || "—"}</td>
                      <td>
                        <span className={`settings-status-badge ${row.active ? "is-active" : "is-inactive"}`}>
                          <span className="settings-status-badge__dot" aria-hidden="true" />
                          {row.active ? "Активен" : "Неактивен"}
                        </span>
                      </td>
                      <td>
                        <div className="settings-row-actions">
                          <button type="button" className="settings-action-edit" aria-label={`Редактировать «${row.name}»`} disabled={row.isGlobal} title={row.isGlobal ? "Системная единица" : undefined} onClick={() => openEdit(row)}>
                            <Icon name="bi-pencil" size={15} />
                          </button>
                          <button type="button" className="settings-action-delete" aria-label={`Удалить «${row.name}»`} disabled={deleting || row.isGlobal} title={row.isGlobal ? "Системная единица" : undefined} onClick={() => setDeleteTarget(row)}>
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
                <button type="button" aria-label={t("pages.settings.settingsunitspage.zakryt")} disabled={saving} onClick={closeDrawer}>
                  <Icon name="bi-x-lg" size={20} />
                </button>
              </header>
              <div className="settings-form__body">
                <div className="u-form-row">
                  <label>
                    <span>{t("pages.settings.settingsunitspage.nazvanie")}</span>
                    <input
                      autoFocus
                      value={form.name}
                      onChange={(event) => setForm((cur) => ({ ...cur, name: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>{t("pages.settings.settingsunitspage.korotkoe_nazvanie")}</span>
                    <input
                      value={form.shortName}
                      onChange={(event) => setForm((cur) => ({ ...cur, shortName: event.target.value }))}
                    />
                  </label>
                </div>
                <div className="settings-toggle-field settings-form__wide">
                  <span>{t("pages.settings.settingsunitspage.status")}</span>
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
                <button type="button" disabled={saving} onClick={closeDrawer}>{t("pages.settings.settingsunitspage.otmena")}</button>
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
                  <p>{t("pages.settings.settingsunitspage.udalenie")}</p>
                  <h2 id="unit-delete-title">{t("pages.settings.settingsunitspage.udalit_edinitsu_izmereniya")}</h2>
                </div>
                <button type="button" aria-label={t("pages.settings.settingsunitspage.zakryt")} disabled={deleting} onClick={() => setDeleteTarget(null)}>
                  <Icon name="bi-x-lg" size={18} />
                </button>
              </header>
              <div className="settings-form__body">
                <p id="unit-delete-body" className="settings-confirm__text">
                  «<strong>{deleteTarget.name}</strong>{t("pages.settings.settingsunitspage.budet_udalena_eto_deystvie_neobratimo")}
                </p>
              </div>
              <footer className="settings-form__footer">
                <button type="button" autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>{t("pages.settings.settingsunitspage.otmena")}</button>
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

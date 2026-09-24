import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { settingsService } from "../../api/settings";
import Icon from "../../components/Icon";
import ReportEmptyState from "../../components/ReportEmptyState";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import "./SettingsPaymentMethodsPage.css";

const RESOURCE = "paymentMethods";

// Canonical Payment-method domain. These codes mirror the values the backend
// actually stores/uses (backend/app/modules/payments/models.py:28 —
// `cash | card | payme | click | uzum | loyalty | mixed`). The Settings page
// presents human-readable Russian labels but keeps the canonical code as the
// stored/sent value, so the dictionary is aligned with real payment data.
export const PAYMENT_TYPE_LABELS = Object.freeze({
  cash: "Наличные",
  card: "Карта",
  payme: "Payme",
  click: "Click",
  uzum: "Uzum",
  loyalty: "Лояльность",
  mixed: "Смешанный",
});

// Display map keeps ALL known codes so any legacy row (payme/click/…) still
// renders a human label in the table. The create/edit form, however, offers
// only the two business-approved options.
export const PAYMENT_TYPE_OPTIONS = Object.freeze([
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Карта" },
]);

// Unknown / legacy values (rows created before the canonical enum) must render
// safely as their raw stored value — never crash, never be silently rewritten.
export function paymentTypeLabel(code) {
  if (code === null || code === undefined || code === "") return "—";
  return PAYMENT_TYPE_LABELS[code] || String(code);
}

const DELETE_CONFLICT_MESSAGE =
  "Этот способ оплаты используется и не может быть удалён. Сделайте его неактивным.";

export function mapRow(item) {
  return {
    id: item.id,
    sort: item.sort_order ?? item.sort ?? 0,
    name: item.name || "",
    type: item.type ?? "",
    active: (item.status ?? item.is_active) !== false,
  };
}

// Build the request payload. Returns null when the form is invalid so the
// caller can surface a validation message WITHOUT hitting the backend. The
// canonical `type` code is sent as-is (no Russian label leaks to the API);
// `sort`/`status` use the HQ-convention names the backend accepts directly.
export function formToPayload(form) {
  const sortInput = String(form.sort ?? "").trim();
  if (!/^\d+$/.test(sortInput)) return null;
  const name = String(form.name ?? "").trim();
  if (!name) return null;
  return {
    name,
    sort: Number(sortInput),
    type: form.type ? form.type : null,
    status: Boolean(form.active),
  };
}

const EMPTY_FORM = { sort: "", name: "", type: "", active: true };

function extractItems(data) {
  if (Array.isArray(data)) return data;
  return data?.items || data?.results || [];
}

// Compact OWNER custom select (chevron + rotate-on-open + animated menu),
// reusing the accepted `settings-select` design-system classes. Kept local to
// this page so no Places file is imported. Keyboard + outside-click aware.
function MarjonSelect({ id, value, options, placeholder, label, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openMenu = (index = selectedIndex >= 0 ? selectedIndex : 0) => { setActiveIndex(index); setOpen(true); };
  const commit = (index) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } return; }
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { openMenu(); return; }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => {
        const next = i + step;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) { openMenu(); return; }
      commit(activeIndex);
    }
  };

  const listId = `${id}-listbox`;
  return (
    <div className={`settings-select${open ? " is-open" : ""}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`settings-select__trigger${selected ? "" : " is-placeholder"}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span className="settings-select__value">{selected ? selected.label : placeholder}</span>
      </button>
      <span className="settings-select__chevron" aria-hidden="true"><Icon name="bi-chevron-down" size={15} /></span>
      {open ? (
        <ul className="settings-select__menu" id={listId} role="listbox" aria-label={label}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  id={`${id}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  className={`settings-select__option${isSelected ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(index)}
                >
                  <span>{option.label}</span>
                  {isSelected ? <Icon name="bi-check2" size={14} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function SettingsPaymentMethodsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawerMode, setDrawerMode] = useState(null); // null | "create" | "edit"
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const beginRequest = useLatestRequest();
  const mutationLocks = useMutationLocks();

  const load = () => {
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
        setError(err.response?.data?.detail || "Не удалось загрузить способы оплаты.");
      })
      .finally(() => {
        if (request.isCurrent()) setLoading(false);
      });
  };

  useEffect(load, [beginRequest]);

  // Escape closes whichever overlay is open (delete confirm takes priority over
  // the create/edit drawer), unless a request is in flight.
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

  // The type dropdown ALWAYS offers exactly the two business options
  // (Наличные / Карта). A legacy row whose stored code is neither is NOT added
  // as a third option; its raw value is preserved in `form.type` (and shown as
  // a neutral note) until the user explicitly picks a canonical type.
  const legacyType = form.type && !PAYMENT_TYPE_OPTIONS.some((o) => o.value === form.type)
    ? form.type
    : "";

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDrawerMode("create");
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({ sort: String(row.sort ?? ""), name: row.name, type: row.type, active: row.active });
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
      setError("Проверьте поля: «Сорт» — целое число, «Название» — обязательно.");
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
      setError(err.response?.data?.detail || "Не удалось сохранить. Попробуйте позже.");
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
      setRows((current) => current.filter((r) => r.id !== target.id));
      setDeleteTarget(null);
    } catch (err) {
      // A referenced method is expected to fail once the backend enforces the
      // reference guard (409). Surface the safe "make it inactive" path; the
      // row stays because it was NOT deleted.
      setDeleteTarget(null);
      setError(
        err.response?.status === 409
          ? err.response?.data?.detail || DELETE_CONFLICT_MESSAGE
          : err.response?.data?.detail || "Не удалось удалить. Попробуйте позже.",
      );
    } finally {
      setDeleting(false);
      mutationLocks.release(`delete:${target.id}`);
    }
  };

  return (
    <div className="settings-page settings-owner-view payment-methods-page">
      <section className="settings-card">
        <header className="settings-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" />
            <div>
              <p>Настройки</p>
              <h1>Способ оплаты</h1>
            </div>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={openAdd}>Добавить способ оплаты</button>
          </div>
        </header>

        {loading ? (
          <div className="settings-empty-state" role="status">Загрузка...</div>
        ) : error && rows.length === 0 ? (
          <div className="settings-empty-state" role="alert">
            {error}
            <button type="button" className="settings-places-retry" onClick={load}>Повторить</button>
          </div>
        ) : rows.length === 0 ? (
          <ReportEmptyState title="Способов оплаты пока нет" />
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
                    <th>Тип</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.sort === 0 || row.sort ? String(row.sort) : "—"}</td>
                      <td>{row.name || "—"}</td>
                      <td>{paymentTypeLabel(row.type)}</td>
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
        <div className="settings-owner-view payment-methods-modal-layer">
          <div className="settings-drawer settings-modal-overlay" role="presentation">
            <div className="settings-drawer__backdrop" onClick={closeDrawer} />
            <form className="settings-form settings-modal" role="dialog" aria-modal="true" aria-labelledby="payment-drawer-title" onSubmit={save}>
              <header className="settings-form__header">
                <span className="settings-accent-bar" />
                <div>
                  <p>{editingId ? "Редактирование" : "Новая запись"}</p>
                  <h2 id="payment-drawer-title">{editingId ? "Редактировать способ оплаты" : "Добавить способ оплаты"}</h2>
                </div>
                <button type="button" aria-label="Закрыть" disabled={saving} onClick={closeDrawer}>
                  <Icon name="bi-x-lg" size={20} />
                </button>
              </header>
              <div className="settings-form__body">
                <div className="pm-form-row">
                  <label>
                    <span>Сорт</span>
                    <input
                      inputMode="numeric"
                      value={form.sort}
                      onChange={(event) => setForm((cur) => ({ ...cur, sort: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Название</span>
                    <input
                      autoFocus
                      value={form.name}
                      onChange={(event) => setForm((cur) => ({ ...cur, name: event.target.value }))}
                    />
                  </label>
                </div>
                <div className="settings-form__wide settings-field">
                  <label className="settings-field__label" htmlFor="pm-type">Тип</label>
                  <MarjonSelect
                    id="pm-type"
                    label="Тип"
                    placeholder="Выберите тип"
                    value={legacyType ? "" : form.type}
                    options={PAYMENT_TYPE_OPTIONS}
                    onChange={(next) => setForm((cur) => ({ ...cur, type: next }))}
                  />
                  {legacyType ? (
                    <p className="pm-legacy-note">Текущий тип: {paymentTypeLabel(legacyType)}</p>
                  ) : null}
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
        <div className="settings-owner-view payment-methods-modal-layer">
          <div className="settings-drawer settings-modal-overlay" role="presentation">
            <div className="settings-drawer__backdrop" onClick={deleting ? undefined : () => setDeleteTarget(null)} />
            <div className="settings-form settings-modal settings-confirm" role="dialog" aria-modal="true" aria-labelledby="payment-delete-title" aria-describedby="payment-delete-body">
              <header className="settings-form__header">
                <span className="settings-accent-bar" />
                <div>
                  <p>Удаление</p>
                  <h2 id="payment-delete-title">Удалить способ оплаты?</h2>
                </div>
                <button type="button" aria-label="Закрыть" disabled={deleting} onClick={() => setDeleteTarget(null)}>
                  <Icon name="bi-x-lg" size={18} />
                </button>
              </header>
              <div className="settings-form__body">
                <p id="payment-delete-body" className="settings-confirm__text">
                  «<strong>{deleteTarget.name}</strong>» будет удалён. Это действие необратимо.
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

export default SettingsPaymentMethodsPage;

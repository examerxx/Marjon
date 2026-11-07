import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { financeService } from "../../api/finance";
import Icon from "../../components/Icon";
import { useCategoryListHeight } from "../categoryListHeight";
import "../../styles/owner/raw-categories.css";
import "../../styles/shared/catalog-scrollbar-arrows.css";
import "./financeCategories.css";

const errorMessage = (error) => typeof error.response?.data?.detail === "string"
  ? error.response.data.detail : "Не удалось сохранить категорию. Попробуйте ещё раз.";

export default function FinanceCategoriesPage({ kind }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [archived, setArchived] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const lock = useRef(false);
  const listRef = useRef(null);
  const title = kind === "income" ? "Категория приходов" : "Категория расходов";
  const visible = rows.filter((row) => row.kind === kind && (row.status === false) === archived);
  useCategoryListHeight(listRef, true, `${kind}:${archived}:${loading}:${visible.length}`);

  useEffect(() => {
    const controller = new AbortController();
    setRows([]); setLoading(true); setError(""); setArchived(false); setDialog(null);
    financeService.listTransactionCategories(kind, { signal: controller.signal }).then(({ data }) => {
      if (!Array.isArray(data?.items)) throw new Error("Некорректный ответ сервера");
      if (!controller.signal.aborted) setRows(data.items);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Не удалось загрузить категории.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind]);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (event) => { if (event.key === "Escape" && !lock.current) setDialog(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  function open(action, row = null) {
    setFormError(""); setName(row?.name || ""); setActive(row?.status !== false);
    setDialog({ action, row });
  }

  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    const { action, row } = dialog;
    if ((action === "create" || action === "edit") && !name.trim()) {
      setFormError("Укажите название категории."); return;
    }
    lock.current = true; setSaving(true); setFormError("");
    try {
      if (action === "delete") {
        await financeService.deleteTransactionCategory(row.id);
        setRows((current) => current.filter((item) => item.id !== row.id));
      } else {
        const payload = action === "archive" ? { status: false }
          : action === "restore" ? { status: true } : { name: name.trim(), status: active };
        const { data } = action === "create"
          ? await financeService.createTransactionCategory({ ...payload, kind })
          : await financeService.updateTransactionCategory(row.id, payload);
        if (!data?.id || data.kind !== kind || typeof data.status !== "boolean") throw new Error("Некорректный ответ сервера");
        setRows((current) => [...current.filter((item) => item.id !== data.id), data]
          .sort((a, b) => a.name.localeCompare(b.name, "ru")));
      }
      setDialog(null);
    } catch (err) { setFormError(errorMessage(err)); }
    finally { lock.current = false; setSaving(false); }
  }

  const editing = dialog?.action === "create" || dialog?.action === "edit";
  const actionTitle = { create: "Добавить категорию", edit: "Редактировать категорию", archive: "Архивировать категорию?", restore: "Восстановить категорию?", delete: "Удалить категорию навсегда?" };
  const actionLabel = { create: "Добавить", edit: "Сохранить", archive: "Архивировать", restore: "Восстановить", delete: "Удалить" };

  return <section className="nomenclature-page menu-categories-page is-dish-categories finance-categories-page">
    <div className="menu-categories-card">
      <header className="settings-header dishcat-header">
        <div className="settings-title-group"><span className="settings-accent-bar" aria-hidden="true" /><div><p>Финансы</p><h1>{title}</h1></div></div>
        <div className="settings-actions">
          <div className="dish-status-tabs finance-category-tabs" role="tablist" aria-label="Статус категорий">
            <button type="button" role="tab" aria-selected={!archived} className={!archived ? "is-active" : ""} onClick={() => setArchived(false)}>Активные</button>
            <button type="button" role="tab" aria-selected={archived} className={archived ? "is-active" : ""} onClick={() => setArchived(true)}>Архивированные</button>
          </div>
          <button type="button" onClick={() => open("create")}>Добавить категорию</button>
        </div>
      </header>
      <div className="menu-category-list dishcat-list" ref={listRef} tabIndex={0} aria-busy={loading}>
        {loading ? <div className="menu-category-empty">Загрузка...</div> : error ? <div className="menu-category-empty" role="alert">{error}</div> : visible.length === 0 ? <div className="menu-category-empty">{archived ? "Архивированных категорий пока нет." : "Категорий пока нет."}</div> : visible.map((row) => <article className="menu-category-row dishcat-row" key={row.id}>
          <div className="dishcat-main"><div className="dishcat-info"><strong>{row.name}</strong></div></div>
          <div className="dishcat-meta">
            <span className={`settings-status-badge ${archived ? "is-inactive" : "is-active"}`}><span className="settings-status-badge__dot" aria-hidden="true" />{archived ? "В архиве" : "Активен"}</span>
            <button type="button" className="settings-place__edit" onClick={() => open(archived ? "restore" : "edit", row)}>{archived ? "Восстановить" : "Редактировать"}</button>
            <button type="button" className="settings-action-delete" aria-label={`${archived ? "Удалить" : "Архивировать"} категорию ${row.name}`} title={archived ? "Удалить навсегда" : "Архивировать категорию"} onClick={() => open(archived ? "delete" : "archive", row)}><Icon name="bi-trash3" size={15} /></button>
          </div>
        </article>)}
      </div>
    </div>
    {dialog ? createPortal(<div className="settings-owner-view dishcat-modal-layer"><div className="settings-drawer settings-modal-overlay" role="presentation">
      <div className="settings-drawer__backdrop" onClick={() => { if (!lock.current) setDialog(null); }} />
      <form className="settings-form settings-modal" role="dialog" aria-modal="true" aria-labelledby="finance-category-dialog-title" onSubmit={submit}>
        <header className="settings-form__header"><span className="settings-accent-bar" /><div><p>{title}</p><h2 id="finance-category-dialog-title">{actionTitle[dialog.action]}</h2></div><button type="button" disabled={saving} onClick={() => setDialog(null)} aria-label="Закрыть"><Icon name="bi-x-lg" size={20} /></button></header>
        {editing ? <div className="settings-form__body"><label className="settings-form__wide"><span>Название</span><input autoFocus value={name} disabled={saving} onChange={(event) => setName(event.target.value)} placeholder="Название категории" /></label><div className="settings-toggle-field settings-form__wide"><span>Статус</span><label className="settings-switch"><input type="checkbox" aria-label="Активная категория" checked={active} disabled={saving} onChange={(event) => setActive(event.target.checked)} /><span className="settings-switch__track" aria-hidden="true"><span className="settings-switch__thumb" /></span><span className={`settings-switch__label ${active ? "is-active" : "is-inactive"}`}>{active ? "Активен" : "Неактивен"}</span></label></div></div>
          : <p className="settings-form__context">Категория «{dialog.row.name}» {dialog.action === "archive" ? "будет перемещена в архив." : dialog.action === "restore" ? "снова станет активной." : "будет удалена без возможности восстановления."}</p>}
        {formError ? <p className="settings-form__error" role="alert">{formError}</p> : null}
        <footer className="settings-form__footer"><button type="button" disabled={saving} onClick={() => setDialog(null)}>Отмена</button><button type="submit" disabled={saving || (editing && !name.trim())}>{saving ? "Сохранение..." : actionLabel[dialog.action]}</button></footer>
      </form>
    </div></div>, document.body) : null}
  </section>;
}

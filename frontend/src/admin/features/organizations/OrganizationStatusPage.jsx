import { useEffect, useRef, useState } from "react";

import { normalizePaginatedList } from "../../../api/normalizers";
import Icon from "../../../components/Icon";
import { AdminPageSizeDropdown, getPageList } from "../../AdminShared";
import { normalizeOrganizationStatus } from "./OrganizationDirectoryPage";
import { organizationErrorMessage } from "./organizationErrors";
import { organizationsApi } from "./organizationsApi";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function StatusDeleteDialog({ row, busy, error, onClose, onConfirm }) {
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    panelRef.current?.querySelector("button")?.focus();
    return () => returnFocusRef.current?.focus?.();
  }, []);

  function onKeyDown(event) {
    if (event.key === "Escape" && !busy) onClose();
    if (event.key !== "Tab") return;
    const buttons = [...panelRef.current.querySelectorAll("button:not([disabled])")];
    if (!buttons.length) return;
    if (event.shiftKey && document.activeElement === buttons[0]) {
      event.preventDefault();
      buttons.at(-1).focus();
    } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
      event.preventDefault();
      buttons[0].focus();
    }
  }

  return (
    <div className="admin-modal org-directory-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section ref={panelRef} className="admin-modal__panel org-directory-modal__panel is-danger" role="dialog" aria-modal="true" aria-labelledby="status-delete-title" aria-describedby="status-delete-description" onKeyDown={onKeyDown}>
        <div className="admin-modal__head">
          <div><h3 id="status-delete-title">Удалить статус</h3><p id="status-delete-description">Backend удаляет запись статуса без архива. Ссылки организаций будут очищены.</p></div>
          <button type="button" className="admin-modal__close" onClick={onClose} disabled={busy} aria-label="Закрыть"><Icon name="bi-x-lg" size={16} /></button>
        </div>
        <p className="org-directory-modal__confirmation">{row.name}</p>
        {error ? <div className="org-directory-modal__error" role="alert">{error}</div> : null}
        <div className="admin-modal__actions">
          <button type="button" className="admin-modal__btn is-ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="admin-modal__btn is-primary" onClick={onConfirm} disabled={busy}>{busy ? "Удаление..." : "Удалить"}</button>
        </div>
      </section>
    </div>
  );
}

export function OrganizationStatusPage({ search = "", onNotify }) {
  const [rows, setRows] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [pageMeta, setPageMeta] = useState({ total: 0, page: 1, size: 20, pages: 1 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortDirection, setSortDirection] = useState("asc");
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [activeDraft, setActiveDraft] = useState("");
  const [appliedActive, setAppliedActive] = useState("");
  const [editor, setEditor] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = { page, size: pageSize, sort: sortDirection === "asc" ? "sort" : "-sort" };
    const canonicalSearch = appliedSearch || search.trim();
    if (canonicalSearch) params.search = canonicalSearch;
    if (appliedActive) params.status = appliedActive;

    setLoadState("loading");
    setLoadError("");
    organizationsApi.listOrganizationStatuses(params, { signal: controller.signal })
      .then(({ data }) => {
        const normalizedPage = normalizePaginatedList(data);
        setRows(normalizedPage.items.map(normalizeOrganizationStatus));
        setPageMeta({
          total: normalizedPage.total,
          page: normalizedPage.page,
          size: normalizedPage.size,
          pages: normalizedPage.pages,
        });
        setLoadState(normalizedPage.items.length ? "success" : "empty");
      })
      .catch((error) => {
        if (error?.isAborted || error?.code === "ABORTED") return;
        setRows([]);
        setLoadState("error");
        setLoadError(organizationErrorMessage(error, "Не удалось загрузить статусы организаций."));
      });
    return () => controller.abort();
  }, [appliedActive, appliedSearch, page, pageSize, reloadKey, search, sortDirection]);

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(searchDraft.trim());
    setAppliedActive(activeDraft);
  }

  function resetFilters() {
    setSearchDraft("");
    setAppliedSearch("");
    setActiveDraft("");
    setAppliedActive("");
    setPage(1);
  }

  function openCreate() {
    setMutationError("");
    setEditor({ mode: "create", id: "", name: "", sort: 0, active: true });
  }

  function openEdit(row) {
    setMutationError("");
    setEditor({ mode: "edit", id: row.id, name: row.name === "—" ? "" : row.name, sort: row.sort ?? "", active: row.active });
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (mutationBusy) return;
    const name = editor.name.trim();
    const sort = Number(editor.sort);
    if (!name) {
      setMutationError("Укажите название статуса.");
      return;
    }
    if (!Number.isInteger(sort)) {
      setMutationError("Порядок должен быть целым числом.");
      return;
    }

    setMutationBusy(true);
    setMutationError("");
    try {
      const payload = { name, sort, status: editor.active };
      if (editor.mode === "create") await organizationsApi.createOrganizationStatus(payload);
      else await organizationsApi.updateOrganizationStatus(editor.id, payload);
      onNotify?.(editor.mode === "create" ? "Статус создан." : "Статус обновлён.");
      setEditor(null);
      setReloadKey((value) => value + 1);
    } catch (error) {
      setMutationError(organizationErrorMessage(error, "Не удалось сохранить статус."));
    } finally {
      setMutationBusy(false);
    }
  }

  async function toggleActive(row) {
    if (mutationBusy) return;
    setMutationBusy(true);
    setMutationError("");
    try {
      await organizationsApi.updateOrganizationStatus(row.id, { status: !row.active });
      onNotify?.(!row.active ? "Статус активирован." : "Статус деактивирован.");
      setReloadKey((value) => value + 1);
    } catch (error) {
      setMutationError(organizationErrorMessage(error, "Не удалось изменить статус."));
    } finally {
      setMutationBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteRow || mutationBusy) return;
    setMutationBusy(true);
    setMutationError("");
    try {
      await organizationsApi.deleteOrganizationStatus(deleteRow.id);
      onNotify?.("Статус удалён.");
      setDeleteRow(null);
      if (rows.length === 1 && page > 1) setPage((value) => value - 1);
      else setReloadKey((value) => value + 1);
    } catch (error) {
      setMutationError(organizationErrorMessage(error, "Не удалось удалить статус."));
    } finally {
      setMutationBusy(false);
    }
  }

  const pageList = getPageList(pageMeta.page, pageMeta.pages);
  const startIndex = (pageMeta.page - 1) * pageMeta.size;
  const endIndex = Math.min(startIndex + rows.length, pageMeta.total);
  const hasFilters = Boolean(appliedSearch || search.trim() || appliedActive);

  return (
    <section className="org-status-page">
      <div className="org-status-header">
        <div className="org-status-title"><span aria-hidden="true" /><div><h2>Статусы организаций</h2><p>Канонический справочник состояний подключения и обслуживания.</p></div></div>
        <div className="org-status-actions">
          <button type="button" className="org-status-refresh" onClick={() => setReloadKey((value) => value + 1)} disabled={loadState === "loading"}><Icon name="bi-arrow-repeat" size={15} /> Обновить</button>
          <button type="button" className="org-status-add" onClick={openCreate}>Добавить <Icon name="bi-plus-lg" size={15} /></button>
        </div>
      </div>

      <div className="org-status-summary"><span><b>{pageMeta.total}</b> всего</span><span><b>{rows.length}</b> на странице</span><span><b>{rows.filter((row) => row.active).length}</b> активных на странице</span></div>

      <form className="org-status-filters" onSubmit={applyFilters}>
        <label><Icon name="bi-search" size={15} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Поиск по названию" /></label>
        <select value={activeDraft} onChange={(event) => setActiveDraft(event.target.value)} aria-label="Активность статуса"><option value="">Все статусы</option><option value="true">Активные</option><option value="false">Неактивные</option></select>
        <button type="submit" className="org-status-refresh">Применить</button>
        <button type="button" className="org-status-refresh" onClick={resetFilters}>Сбросить</button>
      </form>

      {editor ? <form className="org-status-editor" onSubmit={saveEditor}>
        <label><span>Название</span><input value={editor.name} onChange={(event) => { setEditor((current) => ({ ...current, name: event.target.value })); setMutationError(""); }} placeholder="Название статуса" autoFocus required /></label>
        <label><span>Порядок</span><input type="number" value={editor.sort} onChange={(event) => { setEditor((current) => ({ ...current, sort: event.target.value })); setMutationError(""); }} /></label>
        <button type="button" className={`org-status-toggle ${editor.active ? "is-on" : ""}`} onClick={() => setEditor((current) => ({ ...current, active: !current.active }))} disabled={mutationBusy}><span /> {editor.active ? "Активно" : "Неактивно"}</button>
        <div><button type="submit" className="org-status-save" disabled={mutationBusy}>{mutationBusy ? "Сохранение..." : "Сохранить"}</button><button type="button" className="org-status-cancel" onClick={() => setEditor(null)} disabled={mutationBusy}>Отмена</button></div>
        {mutationError ? <div className="org-status-mutation-error" role="alert">{mutationError}</div> : null}
      </form> : mutationError && !deleteRow ? <div className="org-status-mutation-error" role="alert">{mutationError}</div> : null}

      {loadState === "loading" ? <div className="admin-data-state" role="status">Загрузка статусов...</div> : null}
      {loadState === "error" ? <div className="admin-data-state" role="alert">{loadError}</div> : null}

      {loadState !== "error" ? <div className="org-status-table-shell">
        <table className="org-status-table">
          <thead><tr><th>№</th><th>Название</th><th><button type="button" onClick={() => { setPage(1); setSortDirection((value) => value === "asc" ? "desc" : "asc"); }}>Порядок <Icon name="bi-sort-down" size={14} /></button></th><th>Статус</th><th aria-label="Действия" /></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.id}>
            <td>{startIndex + index + 1}</td><td><strong>{row.name}</strong></td><td><b>{row.sort ?? "—"}</b></td>
            <td><button type="button" className={`org-status-badge ${row.active ? "is-active" : "is-disabled"}`} onClick={() => toggleActive(row)} disabled={mutationBusy}>{row.active ? "#активно" : "#неактивно"}</button></td>
            <td><div className="org-status-row-actions"><button type="button" className="is-edit" onClick={() => openEdit(row)} aria-label={`Редактировать ${row.name}`}><Icon name="bi-pencil" size={15} /></button><button type="button" className="is-delete" onClick={() => { setMutationError(""); setDeleteRow(row); }} aria-label={`Удалить ${row.name}`}><Icon name="bi-trash3" size={15} /></button></div></td>
          </tr>)}</tbody>
        </table>
        {loadState === "empty" ? <div className="org-status-empty">{hasFilters ? "По заданным условиям статусы не найдены." : "Статусы не найдены."}</div> : null}
      </div> : null}

      <div className="admin-data-footer org-status-footer">
        <span className="admin-data-footer__summary">{pageMeta.total ? `${startIndex + 1}-${endIndex} из ${pageMeta.total}` : "0 из 0"}<small>Страница {pageMeta.page} из {pageMeta.pages}</small></span>
        <div className="admin-data-pager"><AdminPageSizeDropdown value={pageSize} options={PAGE_SIZE_OPTIONS} onChange={(value) => { setPageSize(value); setPage(1); }} /><button type="button" disabled={pageMeta.page === 1 || loadState === "loading"} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Предыдущая страница"><Icon name="bi-chevron-left" size={15} /></button>{pageList.map((item, index) => item === "…" ? <span className="admin-data-ellipsis" key={`gap-${index}`}>…</span> : <button type="button" className={`admin-data-page-btn ${item === pageMeta.page ? "is-active" : ""}`} key={item} onClick={() => setPage(item)} aria-current={item === pageMeta.page ? "page" : undefined}>{item}</button>)}<button type="button" disabled={pageMeta.page === pageMeta.pages || loadState === "loading"} onClick={() => setPage((value) => Math.min(pageMeta.pages, value + 1))} aria-label="Следующая страница"><Icon name="bi-chevron-right" size={15} /></button></div>
      </div>

      {deleteRow ? <StatusDeleteDialog row={deleteRow} busy={mutationBusy} error={mutationError} onClose={() => { if (!mutationBusy) setDeleteRow(null); }} onConfirm={confirmDelete} /> : null}
    </section>
  );
}

import { useEffect, useState } from "react";

import { adminFinanceApi } from "./financeApi";

import Icon from '../components/Icon';

import { isAbortError, useLatestRequest } from "../hooks/useAsyncSafety";

import { getAdminFinanceLoadMessage } from "./AdminShared";

import { extractAdminFinanceItems, useDefaultAdminFinanceOrganizationId } from "./AdminFinanceOperations";

function AdminFinanceCategoriesPage({
  search,
  onNotify,
  title,
  localPrefix,
  modalCreateTitle,
  modalEditTitle,
  emptyText,
  categoryKind,
}) {
  const { organizationId, loadState: organizationLoadState } = useDefaultAdminFinanceOrganizationId(onNotify);
  const [categories, setCategories] = useState([]);
  const [loadState, setLoadState] = useState("idle");
  const [editor, setEditor] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftStatus, setDraftStatus] = useState("#активно");
  const query = search.trim().toLowerCase();
  const beginRequest = useLatestRequest();

  useEffect(() => {
    const request = beginRequest();
    if (!organizationId) return;
    setLoadState("loading");
    adminFinanceApi.listCategories(organizationId, categoryKind, { size: 100 }, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = extractAdminFinanceItems(data);
        if (!items.length) setCategories([]);
        if (items.length) {
          setCategories(items.map((r, index) => {
            const rawStatus = typeof r.status === "string" ? r.status.toLowerCase() : r.status;
            const isOff = rawStatus === false || r.is_active === false || ["inactive", "disabled", "#неактивно", "#отключено"].includes(rawStatus);
            return {
              id: String(r.id ?? r.category_id ?? `${localPrefix}-api-${index + 1}`),
              name: r.name || r.title || "",
              status: isOff ? "#отключено" : "#активно",
              locked: Boolean(r.is_system || r.locked),
            };
          }).filter((row) => row.name));
        }
        setLoadState(items.length ? "success" : "empty");
      })
      .catch((error) => {
        if (!request.isCurrent() || isAbortError(error)) return;
        setCategories([]);
        setLoadState("error");
        onNotify?.(getAdminFinanceLoadMessage(error));
      });
  }, [beginRequest, categoryKind, localPrefix, onNotify, organizationId]);

  const filteredCategories = categories.filter((row) => (
    !query || row.name.toLowerCase().includes(query) || row.status.toLowerCase().includes(query)
  ));
  const activeCount = categories.filter((row) => row.status === "#активно").length;
  const lockedCount = categories.filter((row) => row.locked).length;
  const customCount = Math.max(categories.length - lockedCount, 0);
  const sectionNote = localPrefix === "income"
    ? "Категории для приходных операций"
    : "Категории для расходных операций";

  useEffect(() => {
    if (!editor) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") closeEditor();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  function addCategory() {
    setEditor({ mode: "create" });
    setDraftName("");
    setDraftStatus("#активно");
  }

  function editCategory(row) {
    if (row.locked) return;
    setEditor({ mode: "edit", row });
    setDraftName(row.name);
    setDraftStatus(row.status);
  }

  function closeEditor() {
    setEditor(null);
    setDraftName("");
    setDraftStatus("#активно");
  }

  function saveCategory(event) {
    event.preventDefault();
    onNotify?.("Сохранение категории недоступно: backend mutation contract не подключён.");
  }

  function deleteCategory(row) {
    void row;
    onNotify?.("Удаление категории недоступно: backend mutation contract не подключён.");
  }

  return (
    <section className="admin-income-page admin-finance-category-page">
      <div className="admin-income-head">
        <div className="admin-income-head__main">
          <div className="admin-income-title">
            <span aria-hidden="true">
              <Icon name="bi-tags" size={18} />
            </span>
            <div>
              <h2>{title}</h2>
              <p>{sectionNote}</p>
            </div>
          </div>
          <div className="admin-income-stats" aria-label="Сводка категорий">
            <span><strong>{categories.length}</strong> всего</span>
            <span><strong>{activeCount}</strong> активные</span>
            <span><strong>{customCount}</strong> свои</span>
            <span><strong>{lockedCount}</strong> системные</span>
          </div>
        </div>
        <button type="button" className="admin-income-add" onClick={addCategory}>
          <Icon name="bi-plus-lg" size={15} />
          <span>Добавить</span>
        </button>
      </div>

      <div className="admin-income-table-shell">
        <div className="admin-income-list-head" aria-hidden="true">
          <span>Категория</span>
          <span>Статус</span>
          <span>Действия</span>
        </div>
        <div className="admin-income-list" role="list">
          {filteredCategories.map((row) => (
            <div className={`admin-income-row ${row.locked ? "is-locked" : ""}`} role="listitem" key={row.id}>
              <div className="admin-income-name">
                <span className="admin-income-category-dot" aria-hidden="true">
                  <Icon name={row.locked ? "bi-shield-lock" : "bi-tags"} size={14} />
                </span>
                <span className="admin-income-name__text">
                  <strong>{row.name}</strong>
                  <small>{row.locked ? "Системная" : "Пользовательская"}</small>
                </span>
              </div>
              <div className="admin-income-row__actions">
                <span className={`admin-income-status ${row.status !== "#активно" ? "is-off" : ""}`}>{row.status}</span>
                {row.locked ? (
                  <span className="admin-income-lock" aria-label="Системная категория" title="Системная категория">
                    <Icon name="bi-lock" size={15} />
                  </span>
                ) : (
                  <>
                    <button type="button" className="admin-income-icon is-edit" onClick={() => editCategory(row)} aria-label="Изменить категорию">
                      <Icon name="bi-pencil" size={15} />
                    </button>
                    <button type="button" className="admin-income-icon is-delete" onClick={() => deleteCategory(row)} aria-label="Удалить категорию">
                      <Icon name="bi-trash3" size={15} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {loadState === "error" || organizationLoadState === "error" ? (
            <div className="admin-income-empty" role="alert">Не удалось загрузить финансовые категории.</div>
          ) : !filteredCategories.length ? (
            <div className="admin-income-empty">{emptyText}</div>
          ) : null}
        </div>
      </div>

      {editor ? (
        <div className="admin-income-modal" role="dialog" aria-modal="true" aria-label={editor.mode === "create" ? modalCreateTitle : modalEditTitle} onClick={closeEditor}>
          <form className="admin-income-dialog" onSubmit={saveCategory} onClick={(event) => event.stopPropagation()}>
            <div className="admin-income-dialog__head">
              <div>
                <h3>{editor.mode === "create" ? modalCreateTitle : modalEditTitle}</h3>
              </div>
              <button type="button" className="admin-income-dialog__close" onClick={closeEditor} aria-label="Закрыть">
                <Icon name="bi-x-lg" size={16} />
              </button>
            </div>

            <label className="admin-income-field">
              <span>Название <b>*</b></span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Введите название"
                autoFocus
              />
            </label>

            <div className="admin-income-status-field">
              <span>Статус</span>
              <button
                type="button"
                className={`admin-income-switch ${draftStatus === "#активно" ? "is-on" : ""}`}
                aria-pressed={draftStatus === "#активно"}
                onClick={() => setDraftStatus((status) => (status === "#активно" ? "#отключено" : "#активно"))}
              >
                <span />
              </button>
            </div>

            <div className="admin-income-dialog__actions is-single">
              <button type="submit" className="is-primary">{editor.mode === "create" ? "Добавить" : "Сохранить"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

export function AdminIncomeCategoriesPage({ search, onNotify }) {
  return (
    <AdminFinanceCategoriesPage
      search={search}
      onNotify={onNotify}
      title="Категории приходов"
      localPrefix="income"
      modalCreateTitle="Добавить категорию приходов"
      modalEditTitle="Изменить категорию приходов"
      createDescription="Создайте новую категорию для приходных операций."
      editDescription="Измените название и статус категории."
      emptyText="Категории приходов не найдены."
      categoryKind="income"
    />
  );
}

export function AdminExpenseCategoriesPage({ search, onNotify }) {
  return (
    <AdminFinanceCategoriesPage
      search={search}
      onNotify={onNotify}
      title="Категории расходов"
      localPrefix="expense"
      modalCreateTitle="Добавить категорию расходов"
      modalEditTitle="Изменить категорию расходов"
      createDescription="Создайте новую категорию для расходных операций."
      editDescription="Измените название и статус категории расходов."
      emptyText="Категории расходов не найдены."
      categoryKind="expense"
    />
  );
}

export function AdminPaymentMethodsPage({ search, onNotify }) {
  const { organizationId, loadState: organizationLoadState } = useDefaultAdminFinanceOrganizationId(onNotify);
  const [methods, setMethods] = useState([]);
  const [loadState, setLoadState] = useState("idle");
  const [editor, setEditor] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState("Карта");
  const [draftStatus, setDraftStatus] = useState("#активно");
  const [draftVip, setDraftVip] = useState(false);
  const query = search.trim().toLowerCase();
  const beginRequest = useLatestRequest();

  useEffect(() => {
    const request = beginRequest();
    if (!organizationId) return;
    setLoadState("loading");
    adminFinanceApi.listPaymentTypes(organizationId, { size: 100 }, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = extractAdminFinanceItems(data);
        if (!items.length) setMethods([]);
        if (items.length) {
          setMethods(items.map((r, index) => ({
            id: String(r.id ?? r.payment_type_id ?? `payment-api-${index + 1}`),
            sort: Number(r.sort_order ?? r.sort ?? index + 1) || index + 1,
            name: r.name || r.title || "",
            type: r.type || r.kind || "Карта",
            status: r.status !== false && r.is_active !== false ? "#активно" : "#неактивно",
            vip: Boolean(r.is_vip || r.vip),
          })).filter((row) => row.name));
        }
        setLoadState(items.length ? "success" : "empty");
      })
      .catch((error) => {
        if (!request.isCurrent() || isAbortError(error)) return;
        setMethods([]);
        setLoadState("error");
        onNotify?.(getAdminFinanceLoadMessage(error));
      });
  }, [beginRequest, onNotify, organizationId]);
  const filteredMethods = methods
    .filter((row) => !query || [row.name, row.type, row.status].some((value) => value.toLowerCase().includes(query)))
    .sort((a, b) => a.sort - b.sort);

  useEffect(() => {
    if (!editor) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") closeEditor();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  function openCreate() {
    setEditor({ mode: "create" });
    setDraftName("");
    setDraftType("Карта");
    setDraftStatus("#активно");
    setDraftVip(false);
  }

  function openEdit(row) {
    setEditor({ mode: "edit", row });
    setDraftName(row.name);
    setDraftType(row.type);
    setDraftStatus(row.status);
    setDraftVip(Boolean(row.vip));
  }

  function closeEditor() {
    setEditor(null);
    setDraftName("");
    setDraftType("Карта");
    setDraftStatus("#активно");
    setDraftVip(false);
  }

  function saveMethod(event) {
    event.preventDefault();
    onNotify?.("Сохранение способа оплаты недоступно: backend mutation contract не подключён.");
  }

  function deleteMethod(row) {
    void row;
    onNotify?.("Удаление способа оплаты недоступно: backend mutation contract не подключён.");
  }

  function updateSort(row, value) {
    void row;
    void value;
    onNotify?.("Изменение порядка недоступно: backend mutation contract не подключён.");
  }

  return (
    <section className="admin-income-page admin-payment-page">
      <div className="admin-income-head">
        <div className="admin-income-title">
          <span aria-hidden="true" />
          <div>
            <h2>Способ оплаты</h2>
            <p>{filteredMethods.length} способов, {methods.filter((row) => row.vip).length} VIP.</p>
          </div>
        </div>
        <button type="button" className="admin-income-add" onClick={openCreate}>
          <span>Добавить</span>
          <Icon name="bi-plus-lg" size={15} />
        </button>
      </div>

      <div className="admin-payment-table" role="table" aria-label="Способы оплаты">
        <div className="admin-payment-table__row admin-payment-table__head" role="row">
          <span>Сорт</span>
          <span>Название</span>
          <span>Тип</span>
          <span>Статус</span>
          <span aria-label="Действия" />
        </div>
        {filteredMethods.map((row) => (
          <div className="admin-payment-table__row" role="row" key={row.id}>
            <span>
              <input
                type="number"
                min="1"
                value={row.sort}
                onChange={(event) => updateSort(row, event.target.value)}
                aria-label={`Сортировка ${row.name}`}
              />
            </span>
            <strong>{row.name}</strong>
            <span>{row.type}</span>
            <span className={`admin-income-status ${row.status === "#отключено" ? "is-off" : ""}`}>{row.status}</span>
            <span className="admin-payment-actions">
              <button type="button" className="admin-income-icon is-edit" onClick={() => openEdit(row)} aria-label="Изменить способ оплаты">
                <Icon name="bi-pencil" size={15} />
              </button>
              <button type="button" className="admin-income-icon is-delete" onClick={() => deleteMethod(row)} aria-label="Удалить способ оплаты">
                <Icon name="bi-trash3" size={15} />
              </button>
            </span>
          </div>
        ))}
        {loadState === "error" || organizationLoadState === "error" ? (
          <div className="admin-income-empty" role="alert">Не удалось загрузить способы оплаты.</div>
        ) : !filteredMethods.length ? (
          <div className="admin-income-empty">Способы оплаты не найдены.</div>
        ) : null}
      </div>

      {editor ? (
        <div className="admin-income-modal" role="dialog" aria-modal="true" aria-label={editor.mode === "create" ? "Добавить способ оплаты" : "Изменить способ оплаты"} onClick={closeEditor}>
          <form className="admin-income-dialog admin-payment-dialog" onSubmit={saveMethod} onClick={(event) => event.stopPropagation()}>
            <div className="admin-income-dialog__head">
              <div>
                <h3>{editor.mode === "create" ? "Добавить способ оплаты" : "Изменить способ оплаты"}</h3>
              </div>
              <button type="button" className="admin-income-dialog__close" onClick={closeEditor} aria-label="Закрыть">
                <Icon name="bi-x-lg" size={16} />
              </button>
            </div>

            <label className="admin-income-field">
              <span>Название <b>*</b></span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Введите название способа оплаты"
                autoFocus
              />
            </label>

            <label className="admin-income-field admin-payment-select-field">
              <span>Тип оплаты</span>
              <select value={draftType} onChange={(event) => setDraftType(event.target.value)}>
                <option value="Карта">Карта</option>
                <option value="Наличные">Наличные</option>
                <option value="Онлайн">Онлайн</option>
                <option value="Перечисление">Перечисление</option>
              </select>
            </label>

            <div className="admin-income-status-field">
              <span>Статус</span>
              <button
                type="button"
                className={`admin-income-switch ${draftStatus === "#активно" ? "is-on" : ""}`}
                aria-pressed={draftStatus === "#активно"}
                onClick={() => setDraftStatus((status) => (status === "#активно" ? "#отключено" : "#активно"))}
              >
                <span />
              </button>
            </div>

            <div className="admin-income-status-field">
              <span>VIP</span>
              <button
                type="button"
                className={`admin-income-switch ${draftVip ? "is-on" : ""}`}
                aria-pressed={draftVip}
                onClick={() => setDraftVip((value) => !value)}
              >
                <span />
              </button>
            </div>

            <div className="admin-income-dialog__actions is-single">
              <button type="submit" className="is-primary">Сохранить</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

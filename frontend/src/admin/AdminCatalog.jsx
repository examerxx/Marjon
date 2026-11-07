import { useEffect, useMemo, useState } from "react";

import { hqService } from "./hqService";

import { normalizePaginatedList } from "../api/normalizers";

import Icon from '../components/Icon';

import { createPortal } from "react-dom";

export function normalizeAdminProduct(row, index = 0, dictionaries = {}) {
  const rawStatus = String(row.status ?? "").toLowerCase();
  const isInactive = row.status === false || rawStatus.includes("inactive") || rawStatus.includes("неак");
  const isArchived = Boolean(row.archived) || rawStatus.includes("archiv") || rawStatus.includes("архив");
  const categoryId = row.category_id ? String(row.category_id) : "";
  const unitId = row.unit_id ? String(row.unit_id) : "";

  return {
    id: String(row.id ?? row.product_id ?? `product-${index + 1}`),
    name: row.name || row.product_name || row.title || "",
    category: categoryId ? dictionaries.categories?.get(categoryId) || `ID: ${categoryId}` : "—",
    categoryId,
    price: Number(row.price ?? row.sale_price ?? row.cost_price ?? 0),
    unit: unitId ? dictionaries.units?.get(unitId) || `ID: ${unitId}` : "—",
    unitId,
    status: isInactive ? "inactive" : "active",
    photo: row.photo || row.image || row.image_url || "",
    archived: isArchived,
  };
}

function createAdminProductDraft(row = null) {
  return {
    id: row?.id || "",
    name: row?.name || "",
    category: row?.category || "—",
    price: row?.price != null ? String(row.price) : "",
    unit: row?.unit || "—",
    status: row?.status || "active",
    photo: row?.photo || "",
    archived: Boolean(row?.archived),
  };
}

function normalizeAdminSaleCategory(row, index = 0) {
  const rawStatus = String(row.status ?? "").toLowerCase();
  const isInactive = row.status === false || rawStatus.includes("inactive") || rawStatus.includes("неак");

  return {
    id: String(row.id ?? row.category_id ?? `sale-category-${index + 1}`),
    name: row.name || row.title || row.category_name || "",
    status: isInactive ? "inactive" : "active",
  };
}

function createAdminSaleCategoryDraft(row = null) {
  return {
    id: row?.id || "",
    name: row?.name || "",
    status: row?.status || "active",
  };
}

function normalizeAdminSource(row, index = 0) {
  return {
    id: String(row?.id ?? row?.source_id ?? index + 1),
    name: row?.name || row?.title || row?.source || "",
  };
}

function createAdminSourceDraft(row = null) {
  return {
    id: row?.id || "",
    name: row?.name || "",
  };
}

function normalizeAdminOrderStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("cancel") || value.includes("отмен")) return "cancelled";
  if (value.includes("accept") || value.includes("прин") || value.includes("done") || value.includes("заверш")) return "accepted";
  return "new";
}

export function normalizeAdminOrder(row, index = 0) {
  const rawItems = Array.isArray(row.items)
    ? row.items
    : Array.isArray(row.products)
      ? row.products
      : Array.isArray(row.order_items)
        ? row.order_items
        : [];

  const items = rawItems.map((item, itemIndex) => ({
    id: String(item.id || `${row.id || index}-item-${itemIndex}`),
    product: item.product_name || item.name || item.product?.name || item.title || "—",
    quantity: Number(item.quantity || item.qty || 1),
    price: Number(item.price || item.amount || item.total || 0),
    comment: item.comment || "-",
  }));

  return {
    id: String(row.id || row.order_number || `order-${index + 1}`),
    organization: row.organization_name || (row.organization_id ? `ID: ${row.organization_id}` : "—"),
    paymentId: String(row.payment_id || row.paymentId || row.transaction_id || row.pay_id || "—"),
    items,
    total: Number(row.price ?? row.total ?? row.amount ?? items.reduce((sum, item) => sum + item.price * item.quantity, 0)),
    comment: row.comment || "-",
    status: normalizeAdminOrderStatus(row.status),
  };
}

export function getAdminOrderTotal(row) {
  if (row.total != null) {
    return Number(row.total || 0);
  }

  if (row.items?.length) {
    return row.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  }

  return 0;
}

function getAdminOrderProductsLabel(row) {
  if (!row.items?.length) return "—";

  return row.items
    .map((item) => `${item.product} — ${item.quantity}`)
    .join("\n");
}

function normalizeAdminUnit(row, index = 0) {
  const rawStatus = String(row.status ?? "").toLowerCase();
  const isInactive = row.status === false || rawStatus.includes("inactive") || rawStatus.includes("неак");

  return {
    id: String(row.id ?? row.unit_id ?? `unit-${index + 1}`),
    sort: Number(row.sort_order ?? row.sort ?? row.order ?? 1) || 1,
    name: row.name || row.title || "",
    shortName: row.short_name || row.shortName || row.code || row.abbreviation || "",
    status: isInactive ? "inactive" : "active",
  };
}

function createAdminUnitDraft(row = null) {
  return {
    id: row?.id || "",
    sort: row?.sort != null ? String(row.sort) : "1",
    name: row?.name || "",
    shortName: row?.shortName || "",
    status: row?.status || "active",
  };
}

export function ProductNomenclaturePage({ search, onNotify }) {
  const [rows, setRows] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [nameFilter, setNameFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");
  const [showArchive, setShowArchive] = useState(false);
  const [editor, setEditor] = useState(null);
  const query = search.trim().toLowerCase();

  useEffect(() => {
    let activeRequest = true;
    Promise.allSettled([
      hqService.listProducts(),
      hqService.listCategories(),
      hqService.listUnits(),
    ])
      .then(([productsResult, categoriesResult, unitsResult]) => {
        if (!activeRequest) return;
        if (productsResult.status === "rejected") throw productsResult.reason;

        const items = normalizePaginatedList(productsResult.value.data).items;
        const categories = categoriesResult.status === "fulfilled"
          ? normalizePaginatedList(categoriesResult.value.data).items
          : [];
        const units = unitsResult.status === "fulfilled"
          ? normalizePaginatedList(unitsResult.value.data).items
          : [];
        const dictionaries = {
          categories: new Map(categories.map((row) => [String(row.id), row.name]).filter(([, name]) => name)),
          units: new Map(units.map((row) => [String(row.id), row.name]).filter(([, name]) => name)),
        };

        setRows(items.map((row, index) => normalizeAdminProduct(row, index, dictionaries)));
        setLoadState(items.length ? "success" : "empty");
      })
      .catch(() => {
        if (!activeRequest) return;
        setRows([]);
        setLoadState("error");
      });
    return () => { activeRequest = false; };
  }, []);

  const categoryOptions = useMemo(() => {
    const values = rows.map((row) => row.category).filter(Boolean);
    return Array.from(new Set(values));
  }, [rows]);

  const visibleRows = useMemo(() => {
    const filterText = nameFilter.trim().toLowerCase();

    return rows
      .filter((row) => Boolean(row.archived) === showArchive)
      .filter((row) => {
        const haystack = `${row.name} ${row.category} ${row.unit}`.toLowerCase();
        return !query || haystack.includes(query);
      })
      .filter((row) => !filterText || row.name.toLowerCase().includes(filterText))
      .filter((row) => !categoryFilter || row.category === categoryFilter)
      .sort((a, b) => {
        const result = a.name.localeCompare(b.name, "ru", { sensitivity: "base" });
        return sortDirection === "asc" ? result : -result;
      });
  }, [rows, showArchive, query, nameFilter, categoryFilter, sortDirection]);

  function updateEditor(field, value) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function openAddProduct() {
    setEditor(createAdminProductDraft());
  }

  function openEditProduct(row) {
    setEditor(createAdminProductDraft(row));
  }

  function closeEditor() {
    setEditor(null);
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => updateEditor("photo", String(reader.result || ""));
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function saveProduct(event) {
    event.preventDefault();
    onNotify?.("Сохранение продукта недоступно: backend mutation contract не подключён.");
  }

  function archiveProduct(row) {
    void row;
    onNotify?.("Архивация недоступна: backend mutation contract не подключён.");
  }

  function restoreProduct(row) {
    void row;
    onNotify?.("Восстановление недоступно: backend mutation contract не подключён.");
  }

  function clearFilters() {
    setNameFilter("");
    setCategoryFilter("");
  }

  const drawer = editor ? createPortal(
    <div className="admin-product-drawer" role="dialog" aria-modal="true" aria-label="Карточка продукта">
      <button type="button" className="admin-product-drawer__shade" onClick={closeEditor} aria-label="Закрыть форму" />
      <form className="admin-product-panel" onSubmit={saveProduct}>
        <div className="admin-product-panel__body">
          <label className="admin-product-photo-upload">
            <input type="file" accept="image/*" onChange={handlePhotoChange} />
            {editor.photo ? (
              <img src={editor.photo} alt="" />
            ) : (
              <>
                <Icon name="bi-image" size={18} />
                <span>Загрузить фото</span>
              </>
            )}
          </label>

          <label className="admin-product-field admin-product-field--wide">
            <span>Склад для расхода</span>
            <select value="" disabled aria-label="Склад для расхода">
              <option value="">Не подключено</option>
            </select>
          </label>

          <label className="admin-product-field admin-product-field--wide">
            <span>Название <b>*</b></span>
            <input value={editor.name} onChange={(event) => updateEditor("name", event.target.value)} required />
          </label>

          <label className="admin-product-field admin-product-field--wide">
            <span>Цена <b>*</b></span>
            <input
              inputMode="numeric"
              value={editor.price}
              onChange={(event) => updateEditor("price", event.target.value)}
              required
            />
          </label>

          <div className="admin-product-form-grid">
            <label className="admin-product-field">
              <span>Категория товара</span>
              <select value={editor.category} disabled aria-label="Категория товара">
                <option value={editor.category}>{editor.category || "Не подключено"}</option>
              </select>
            </label>

            <div className="admin-product-status-field">
              <span>Статус</span>
              <button
                type="button"
                className={`admin-product-switch ${editor.status === "active" ? "is-on" : ""}`}
                onClick={() => updateEditor("status", editor.status === "active" ? "inactive" : "active")}
                aria-pressed={editor.status === "active"}
              >
                <span />
              </button>
            </div>
          </div>

          <div className="admin-product-unit-field">
            <span>Выберите единицу измерения <b>*</b></span>
            <div>
              <button type="button" className="is-selected" disabled>
                {editor.unit || "Не подключено"}
              </button>
            </div>
          </div>
        </div>

        <div className="admin-product-panel__footer">
          <button type="button" onClick={closeEditor}>Отменить</button>
          <button type="submit">Сохранить</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <section className="admin-product-page">
      {loadState === "loading" ? <div className="admin-data-state" role="status">Загрузка продуктов...</div> : null}
      {loadState === "error" ? <div className="admin-data-state" role="alert">Не удалось загрузить продукты.</div> : null}
      <div className="admin-product-card">
        <div className="admin-product-toolbar">
          <div className="admin-product-title">
            <span className="admin-product-title-mark" aria-hidden="true" />
            <h2>Список продуктов</h2>
            <button type="button" className="admin-product-archive-link" onClick={() => setShowArchive((value) => !value)}>
              <Icon name="bi-trash3" size={13} />
              <span>{showArchive ? "Вернуться к списку" : "Перейти к архив"}</span>
            </button>
          </div>

          <button type="button" className="admin-product-add" onClick={openAddProduct}>
            <span>Добавить</span>
            <Icon name="bi-plus" size={15} />
          </button>
        </div>

        <div className="admin-product-table-shell">
          <table className="admin-product-table">
            <thead>
              <tr>
                <th>Фото</th>
                <th>
                  <button type="button" className="admin-product-sort" onClick={() => setSortDirection((value) => value === "asc" ? "desc" : "asc")}>
                    <span>Название</span>
                    <i className={`admin-product-sort__icon is-${sortDirection}`} aria-hidden="true" />
                  </button>
                </th>
                <th>Категория</th>
                <th>Цена</th>
                <th>Ед. изм</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr className="admin-product-filter-row">
                <td />
                <td>
                  <input value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} placeholder="Введите" />
                </td>
                <td>
                  <label className="admin-product-filter-select">
                    <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                      <option value="">Выберите</option>
                      {categoryOptions.map((category) => (
                        <option value={category} key={category}>{category}</option>
                      ))}
                    </select>
                    <Icon name="bi-chevron-down" size={15} />
                  </label>
                </td>
                <td />
                <td />
                <td />
                <td>
                  <button type="button" className="admin-product-filter-clear" onClick={clearFilters} aria-label="Очистить фильтр">
                    <Icon name="bi-funnel" size={16} />
                  </button>
                </td>
              </tr>

              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="admin-product-photo">
                      {row.photo ? <img src={row.photo} alt="" /> : <Icon name="bi-image" size={17} />}
                    </span>
                  </td>
                  <td>
                    <span className="admin-product-name">{row.name}</span>
                  </td>
                  <td>{row.category}</td>
                  <td>{Number(row.price || 0).toLocaleString("ru-RU")}</td>
                  <td>{row.unit}</td>
                  <td>
                    <span className={`admin-product-status ${row.status === "active" ? "is-active" : "is-inactive"}`}>
                      {row.status === "active" ? "#активно" : "#неактивно"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-product-row-actions">
                      <button type="button" className="admin-product-icon-action is-edit" onClick={() => openEditProduct(row)} aria-label="Редактировать продукт">
                        <Icon name="bi-pencil" size={15} />
                      </button>
                      <button
                        type="button"
                        className="admin-product-icon-action is-delete"
                        onClick={() => showArchive ? restoreProduct(row) : archiveProduct(row)}
                        aria-label={showArchive ? "Вернуть из архива" : "Переместить в архив"}
                      >
                        <Icon name={showArchive ? "bi-check2" : "bi-trash3"} size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {(loadState === "empty" || loadState === "success") && !visibleRows.length ? (
                <tr>
                  <td colSpan="7" className="admin-product-empty">
                    {showArchive ? "Архив пуст" : "Список пуст"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {drawer}
    </section>
  );
}

export function SaleCategoryPage({ search, onNotify }) {
  const [rows, setRows] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [editor, setEditor] = useState(null);
  const query = (search || "").trim().toLowerCase();

  useEffect(() => {
    let activeRequest = true;
    hqService.listCategories()
      .then(({ data }) => {
        if (!activeRequest) return;
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        const nextRows = items.map(normalizeAdminSaleCategory).filter((row) => row.name);
        setRows(nextRows);
        setLoadState(nextRows.length ? "success" : "empty");
      })
      .catch(() => {
        if (!activeRequest) return;
        setRows([]);
        setLoadState("error");
      });
    return () => { activeRequest = false; };
  }, []);

  useEffect(() => {
    if (!editor) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setEditor(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => !query || row.name.toLowerCase().includes(query));
  }, [rows, query]);

  function openCreate() {
    setEditor(createAdminSaleCategoryDraft());
  }

  function openEdit(row) {
    setEditor(createAdminSaleCategoryDraft(row));
  }

  function closeEditor() {
    setEditor(null);
  }

  function updateEditor(field, value) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function saveCategory(event) {
    event.preventDefault();
    onNotify?.("Сохранение недоступно: backend mutation contract не подключён.");
  }

  function deleteCategory(row) {
    void row;
    onNotify?.("Удаление недоступно: backend mutation contract не подключён.");
  }

  const modal = editor ? createPortal(
    <div className="admin-sale-category-modal" role="dialog" aria-modal="true" aria-label="Категория реализации">
      <button type="button" className="admin-sale-category-modal__shade" onClick={closeEditor} aria-label="Закрыть" />
      <form className="admin-sale-category-dialog" onSubmit={saveCategory}>
        <div className="admin-sale-category-dialog__head">
          <h3>{editor.id ? "Изменить категорию продукта" : "Добавить категорию продукта"}</h3>
          <button type="button" onClick={closeEditor} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={18} />
          </button>
        </div>

        <div className="admin-sale-category-dialog__body">
          <label className="admin-sale-category-field">
            <span>Название <b>*</b></span>
            <input
              value={editor.name}
              onChange={(event) => updateEditor("name", event.target.value)}
              autoFocus
              required
            />
          </label>

          <div className="admin-sale-category-status-field">
            <span>Статус</span>
            <button
              type="button"
              className={`admin-sale-category-switch ${editor.status === "active" ? "is-on" : ""}`}
              onClick={() => updateEditor("status", editor.status === "active" ? "inactive" : "active")}
              aria-pressed={editor.status === "active"}
            >
              <span />
            </button>
          </div>
        </div>

        <div className="admin-sale-category-dialog__actions">
          <button type="submit">Сохранить</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <section className="admin-sale-category-page">
      {loadState === "loading" ? <div className="admin-data-state" role="status">Загрузка категорий...</div> : null}
      {loadState === "error" ? <div className="admin-data-state" role="alert">Не удалось загрузить категории.</div> : null}
      <div className="admin-sale-category-card">
        <div className="admin-sale-category-head">
          <div className="admin-sale-category-title">
            <span aria-hidden="true" />
            <h2>Реализация</h2>
          </div>

          <button type="button" className="admin-sale-category-add" onClick={openCreate}>
            <span>Добавить</span>
            <Icon name="bi-plus" size={15} />
          </button>
        </div>

        <div className="admin-sale-category-list" role="table" aria-label="Список категорий реализации">
          {visibleRows.map((row) => (
            <div className="admin-sale-category-row" role="row" key={row.id}>
              <strong>{row.name}</strong>
              <span className={`admin-sale-category-status ${row.status === "active" ? "is-active" : "is-inactive"}`}>
                {row.status === "active" ? "#активно" : "#неактивно"}
              </span>
              <div className="admin-sale-category-actions">
                <button type="button" className="is-edit" onClick={() => openEdit(row)} aria-label="Редактировать категорию">
                  <Icon name="bi-pencil" size={15} />
                </button>
                <button type="button" className="is-delete" onClick={() => deleteCategory(row)} aria-label="Удалить категорию">
                  <Icon name="bi-trash3" size={15} />
                </button>
              </div>
            </div>
          ))}

          {(loadState === "empty" || loadState === "success") && !visibleRows.length ? (
            <div className="admin-sale-category-empty">Список пуст</div>
          ) : null}
        </div>
      </div>

      {modal}
    </section>
  );
}

export function AdminSourcesPage({ search, onNotify }) {
  const [rows, setRows] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [editor, setEditor] = useState(null);
  const [sortState, setSortState] = useState({ key: "id", direction: "desc" });
  const query = (search || "").trim().toLowerCase();

  useEffect(() => {
    hqService.listSources()
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        const nextRows = items.map(normalizeAdminSource).filter((row) => row.name);
        setRows(nextRows);
        setLoadState(nextRows.length ? "success" : "empty");
      })
      .catch(() => {
        setRows([]);
        setLoadState("error");
      });
  }, []);

  useEffect(() => {
    if (!editor) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setEditor(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  const visibleRows = useMemo(() => {
    return rows
      .filter((row) => {
        if (!query) return true;
        return [row.id, row.name].some((value) => String(value).toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const direction = sortState.direction === "asc" ? 1 : -1;
        if (sortState.key === "id") {
          return (Number(a.id) - Number(b.id)) * direction;
        }
        return String(a.name).localeCompare(String(b.name), "ru", { sensitivity: "base" }) * direction;
      });
  }, [query, rows, sortState.direction, sortState.key]);

  function toggleSort(key) {
    setSortState((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function openCreate() {
    setEditor(createAdminSourceDraft());
  }

  function openEdit(row) {
    setEditor(createAdminSourceDraft(row));
  }

  function closeEditor() {
    setEditor(null);
  }

  function updateEditor(field, value) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function saveSource(event) {
    event.preventDefault();
    onNotify?.("Сохранение недоступно: backend mutation contract не подключён.");
  }

  function deleteSource(row) {
    void row;
    onNotify?.("Удаление недоступно: backend mutation contract не подключён.");
  }

  const modal = editor ? createPortal(
    <div className="admin-source-modal" role="dialog" aria-modal="true" aria-label="Источник">
      <button type="button" className="admin-source-modal__shade" onClick={closeEditor} aria-label="Закрыть" />
      <form className="admin-source-dialog" onSubmit={saveSource}>
        <div className="admin-source-dialog__head">
          <h3>{editor.id ? "Изменить источник" : "Добавить источник"}</h3>
          <button type="button" onClick={closeEditor} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={18} />
          </button>
        </div>

        <div className="admin-source-dialog__body">
          <label className="admin-source-field">
            <span>Название <b>*</b></span>
            <input
              value={editor.name}
              onChange={(event) => updateEditor("name", event.target.value)}
              autoFocus
              required
            />
          </label>
        </div>

        <div className="admin-source-dialog__actions">
          <button type="button" onClick={closeEditor}>Отмена</button>
          <button type="submit">Сохранить</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <section className="admin-source-page">
      {loadState === "loading" ? <div className="admin-data-state" role="status">Загрузка источников...</div> : null}
      {loadState === "error" ? <div className="admin-data-state" role="alert">Не удалось загрузить источники.</div> : null}
      <div className="admin-source-card">
        <div className="admin-source-head">
          <div className="admin-source-title">
            <span aria-hidden="true">
              <Icon name="bi-megaphone" size={18} />
            </span>
            <div>
              <h2>Список источников</h2>
              <p>Каналы привлечения клиентов</p>
            </div>
          </div>

          <button type="button" className="admin-source-add" onClick={openCreate}>
            <span>Добавить</span>
            <Icon name="bi-plus" size={14} />
          </button>
        </div>

        <div className="admin-source-table" role="table" aria-label="Список источников">
          <div className="admin-source-row admin-source-row--head" role="row">
            <button
              type="button"
              className={`admin-source-sort-button ${sortState.key === "id" ? `is-${sortState.direction}` : ""}`}
              onClick={() => toggleSort("id")}
            >
              <span>ID</span>
              <span className="admin-source-sort-icon" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`admin-source-sort-button ${sortState.key === "name" ? `is-${sortState.direction}` : ""}`}
              onClick={() => toggleSort("name")}
            >
              <span>Названия</span>
              <span className="admin-source-sort-icon" aria-hidden="true" />
            </button>
            <span aria-hidden="true" />
          </div>

          {visibleRows.map((row) => (
            <div className="admin-source-row" role="row" key={row.id}>
              <span className="admin-source-id">{row.id}</span>
              <strong>{row.name}</strong>
              <div className="admin-source-actions">
                <button type="button" className="is-edit" onClick={() => openEdit(row)} aria-label="Редактировать источник">
                  <Icon name="bi-pencil" size={14} />
                </button>
                <button type="button" className="is-delete" onClick={() => deleteSource(row)} aria-label="Удалить источник">
                  <Icon name="bi-trash3" size={14} />
                </button>
              </div>
            </div>
          ))}

          {(loadState === "empty" || loadState === "success") && !visibleRows.length ? (
            <div className="admin-source-empty">Источники не найдены</div>
          ) : null}
        </div>
      </div>

      {modal}
    </section>
  );
}

export function OrdersNomenclaturePage({ search, onNotify }) {
  const [rows, setRows] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [sortState, setSortState] = useState({ key: "id", direction: "desc" });
  const [page, setPage] = useState(1);
  const pageSize = 14;
  const query = (search || "").trim().toLowerCase();

  useEffect(() => {
    hqService.listOrders()
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        const nextRows = items.map(normalizeAdminOrder).filter((row) => row.id);
        setRows(nextRows);
        setLoadState(nextRows.length ? "success" : "empty");
      })
      .catch(() => {
        setRows([]);
        setLoadState("error");
      });
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const filteredRows = useMemo(() => {
    const nextRows = rows.filter((row) => {
      if (!query) return true;
      return [
        row.id,
        row.organization,
        row.paymentId,
        getAdminOrderProductsLabel(row),
        getAdminOrderTotal(row),
        row.comment,
        row.status,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });

    const direction = sortState.direction === "asc" ? 1 : -1;
    return [...nextRows].sort((a, b) => {
      let first = a[sortState.key];
      let second = b[sortState.key];

      if (sortState.key === "total") {
        first = getAdminOrderTotal(a);
        second = getAdminOrderTotal(b);
      }

      if (sortState.key === "id" || sortState.key === "paymentId" || sortState.key === "total") {
        first = Number(String(first).replace(/\D/g, "")) || 0;
        second = Number(String(second).replace(/\D/g, "")) || 0;
      }

      if (first > second) return direction;
      if (first < second) return -direction;
      return 0;
    });
  }, [rows, query, sortState]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const paginationItems = useMemo(() => {
    if (totalPages <= 4) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    return [1, 2, 3, "...", totalPages];
  }, [totalPages]);

  function toggleSort(key) {
    setSortState((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function openCreate() {
    onNotify?.("Добавление заказа недоступно: полный backend editor contract не подключён.");
  }

  function openEdit(row) {
    void row;
    onNotify?.("Редактирование заказа недоступно: полный backend editor contract не подключён.");
  }

  function confirmOrder(row) {
    void row;
    onNotify?.("Подтверждение недоступно: backend mutation contract не подключён.");
  }

  function cancelOrder(row) {
    void row;
    onNotify?.("Отмена недоступна: backend mutation contract не подключён.");
  }

  function deleteOrder(row) {
    void row;
    onNotify?.("Удаление недоступно: backend mutation contract не подключён.");
  }

  function statusLabel(status) {
    if (status === "accepted") return "Принято";
    if (status === "cancelled") return "Отменено";
    return "Новые";
  }

  return (
    <section className="admin-orders-page">
      {loadState === "loading" ? <div className="admin-data-state" role="status">Загрузка заказов...</div> : null}
      {loadState === "error" ? <div className="admin-data-state" role="alert">Не удалось загрузить заказы.</div> : null}
      <div className="admin-orders-card">
        <div className="admin-orders-head">
          <div className="admin-orders-title">
            <span aria-hidden="true" />
            <h2>Список заказов</h2>
          </div>

          <button type="button" className="admin-orders-add" onClick={openCreate} aria-label="Добавление заказа недоступно">
            <span>Добавить</span>
            <Icon name="bi-plus" size={15} />
          </button>
        </div>

        <div className="admin-orders-table-wrap">
          <table className="admin-orders-table">
            <thead>
              <tr>
                <th>
                  <button type="button" onClick={() => toggleSort("id")}>
                    <span>ID</span>
                    <i className={`admin-orders-sort is-${sortState.key === "id" ? sortState.direction : "none"}`} />
                  </button>
                </th>
                <th>Названия</th>
                <th>
                  <button type="button" onClick={() => toggleSort("paymentId")}>
                    <span>ID платежа</span>
                    <i className={`admin-orders-sort is-${sortState.key === "paymentId" ? sortState.direction : "none"}`} />
                  </button>
                </th>
                <th>Продукты</th>
                <th>
                  <button type="button" onClick={() => toggleSort("total")}>
                    <span>Цена</span>
                    <i className={`admin-orders-sort is-${sortState.key === "total" ? sortState.direction : "none"}`} />
                  </button>
                </th>
                <th>Комментария</th>
                <th>
                  <button type="button" onClick={() => toggleSort("status")}>
                    <span>Статус</span>
                    <i className={`admin-orders-sort is-${sortState.key === "status" ? sortState.direction : "none"}`} />
                  </button>
                </th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.organization}</td>
                  <td><strong>{row.paymentId}</strong></td>
                  <td>
                    <span className="admin-orders-products">{getAdminOrderProductsLabel(row)}</span>
                  </td>
                  <td>{getAdminOrderTotal(row).toLocaleString("ru-RU")}</td>
                  <td>{row.comment || "-"}</td>
                  <td>
                    <span className={`admin-orders-status is-${row.status}`}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td>
                    {row.status === "new" ? (
                      <div className="admin-orders-decision">
                        <button type="button" className="is-confirm" onClick={() => confirmOrder(row)}>Подтвердить</button>
                        <button type="button" className="is-cancel" onClick={() => cancelOrder(row)}>Отменить</button>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div className="admin-orders-actions">
                      <button type="button" className="is-edit" onClick={() => openEdit(row)} aria-label="Редактирование заказа недоступно">
                        <Icon name="bi-pencil" size={15} />
                      </button>
                      <button type="button" className="is-delete" onClick={() => deleteOrder(row)} aria-label="Удалить заказ">
                        <Icon name="bi-trash3" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {(loadState === "empty" || loadState === "success") && !pageRows.length ? (
                <tr>
                  <td colSpan="9" className="admin-orders-empty">Список пуст</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="admin-orders-pagination">
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} aria-label="Предыдущая страница">
            <Icon name="bi-chevron-left" size={15} />
          </button>
          {paginationItems.map((item) => item === "..." ? (
            <span key="dots">...</span>
          ) : (
            <button type="button" className={item === currentPage ? "is-active" : ""} onClick={() => setPage(item)} key={item}>
              {item}
            </button>
          ))}
          <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages} aria-label="Следующая страница">
            <Icon name="bi-chevron-right" size={15} />
          </button>
        </div>
      </div>

    </section>
  );
}

export function UnitNomenclaturePage({ search, onNotify }) {
  const [rows, setRows] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [editor, setEditor] = useState(null);
  const query = (search || "").trim().toLowerCase();

  useEffect(() => {
    hqService.listUnits()
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        const nextRows = items.map(normalizeAdminUnit).filter((row) => row.name);
        setRows(nextRows);
        setLoadState(nextRows.length ? "success" : "empty");
      })
      .catch(() => {
        setRows([]);
        setLoadState("error");
      });
  }, []);

  useEffect(() => {
    if (!editor) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setEditor(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  const visibleRows = useMemo(() => {
    return rows
      .filter((row) => {
        if (!query) return true;
        return [row.sort, row.name, row.shortName, row.status]
          .some((value) => String(value || "").toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const sortDiff = Number(a.sort || 0) - Number(b.sort || 0);
        return sortDiff || a.name.localeCompare(b.name, "ru", { sensitivity: "base" });
      });
  }, [rows, query]);

  function openCreate() {
    setEditor(createAdminUnitDraft());
  }

  function openEdit(row) {
    setEditor(createAdminUnitDraft(row));
  }

  function closeEditor() {
    setEditor(null);
  }

  function updateEditor(field, value) {
    setEditor((current) => current ? { ...current, [field]: value } : current);
  }

  function updateSort(row, value) {
    void row;
    void value;
    onNotify?.("Изменение порядка недоступно: backend mutation contract не подключён.");
  }

  function saveUnit(event) {
    event.preventDefault();
    onNotify?.("Сохранение недоступно: backend mutation contract не подключён.");
  }

  function deleteUnit(row) {
    void row;
    onNotify?.("Удаление недоступно: backend mutation contract не подключён.");
  }

  const modal = editor ? createPortal(
    <div className="admin-unit-modal" role="dialog" aria-modal="true" aria-label="Единица измерения">
      <button type="button" className="admin-unit-modal__shade" onClick={closeEditor} aria-label="Закрыть" />
      <form className="admin-unit-dialog" onSubmit={saveUnit}>
        <div className="admin-unit-dialog__head">
          <h3>{editor.id ? "Изменить единица измерению" : "Добавить единица измерению"}</h3>
          <button type="button" onClick={closeEditor} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={18} />
          </button>
        </div>

        <div className="admin-unit-dialog__body">
          <label className="admin-unit-field">
            <span>Название <b>*</b></span>
            <input value={editor.name} onChange={(event) => updateEditor("name", event.target.value)} autoFocus required />
          </label>

          <label className="admin-unit-field">
            <span>Короткое названия <b>*</b></span>
            <input value={editor.shortName} onChange={(event) => updateEditor("shortName", event.target.value)} required />
          </label>

          <div className="admin-unit-status-field">
            <span>Статус</span>
            <button
              type="button"
              className={`admin-unit-switch ${editor.status === "active" ? "is-on" : ""}`}
              onClick={() => updateEditor("status", editor.status === "active" ? "inactive" : "active")}
              aria-pressed={editor.status === "active"}
            >
              <span />
            </button>
          </div>
        </div>

        <div className="admin-unit-dialog__actions">
          <button type="submit">Сохранить</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <section className="admin-unit-page">
      {loadState === "loading" ? <div className="admin-data-state" role="status">Загрузка единиц измерения...</div> : null}
      {loadState === "error" ? <div className="admin-data-state" role="alert">Не удалось загрузить единицы измерения.</div> : null}
      <div className="admin-unit-card">
        <div className="admin-unit-head">
          <div className="admin-unit-title">
            <span aria-hidden="true" />
            <h2>Единица измерения</h2>
          </div>

          <button type="button" className="admin-unit-add" onClick={openCreate}>
            <span>Добавить</span>
            <Icon name="bi-plus" size={15} />
          </button>
        </div>

        <div className="admin-unit-table-wrap">
          <table className="admin-unit-table">
            <thead>
              <tr>
                <th>Сорт</th>
                <th>Название</th>
                <th>Короткое названия</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      aria-label={`Сорт ${row.name}`}
                      value={row.sort}
                      inputMode="numeric"
                      onChange={(event) => updateSort(row, event.target.value)}
                    />
                  </td>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.shortName}</td>
                  <td>
                    <span className={`admin-unit-status ${row.status === "active" ? "is-active" : "is-inactive"}`}>
                      {row.status === "active" ? "#активно" : "#неактивно"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-unit-actions">
                      <button type="button" className="is-edit" onClick={() => openEdit(row)} aria-label="Редактировать единицу измерения">
                        <Icon name="bi-pencil" size={15} />
                      </button>
                      <button type="button" className="is-delete" onClick={() => deleteUnit(row)} aria-label="Удалить единицу измерения">
                        <Icon name="bi-trash3" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {(loadState === "empty" || loadState === "success") && !visibleRows.length ? (
                <tr>
                  <td colSpan="5" className="admin-unit-empty">Список пуст</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {modal}
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getCategories } from "../api/categories";
import { catalogService } from "../api/catalog";
import Icon from "../components/Icon";
import { isAbortError, useLatestRequest, useMutationLocks } from "../hooks/useAsyncSafety";

const TYPE_CONFIG = {
  dishes: { label: "Категории блюд", title: "Меню", slug_prefix: "dish" },
  raw: { label: "Категории сырья", title: "Категории сырья", slug_prefix: "raw" },
  semi: { label: "Категории полуфабрикатов", title: "Категории полуфабрикатов", slug_prefix: "semi" },
  sales: { label: "Категории реализации", title: "Категории реализации", slug_prefix: "sales" },
};

const DEFAULT_FORM = { name: "", slug: "", sort_order: 0 };

function makeSlug(name, prefix) {
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return clean || `${prefix}-${Date.now()}`;
}

function sortCategories(a, b) {
  const first = Number(a.sort_order || 0);
  const second = Number(b.sort_order || 0);

  if (first !== second) return first - second;
  return String(a.name || "").localeCompare(String(b.name || ""), "ru");
}

// V1 — Dish Categories visual rework: status in the "Место" family language
// (dot + "Активен"/"Неактивен", transparent like SettingsPlacesPage rows).
// Reuses the shared .settings-status-badge component classes; business meaning
// stays category truth (is_active !== false = active). No Place data copied.
function DishCategoryStatusBadge({ active }) {
  return (
    <span className={`settings-status-badge ${active ? "is-active" : "is-inactive"}`}>
      <span className="settings-status-badge__dot" aria-hidden="true" />
      {active ? "Активен" : "Неактивен"}
    </span>
  );
}

export default function CategoriesPage({ type = "dishes" }) {
  return <ProductCategoriesPage type={type} />;
}

function ProductCategoriesPage({ type }) {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.dishes;
  // Категории сырья и полуфабрикатов живут в общей таблице categories, но
  // отделяются slug-префиксом (raw*/semi*). При namespaced-типе список
  // фильтруется по префиксу, а новые категории его получают принудительно —
  // так SemiProductsPage находит их тем же приёмом (slug.startsWith("semi")).
  const namespaced = type === "raw" || type === "semi";
  // V1 — Place-family rework applies ONLY to dish categories (Menu →
  // Категория блюд). Raw/semi/sales keep their exact current markup so their
  // contract tests and visuals are untouched.
  const isDishCategories = type === "dishes";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  // V2 — Add Category modal local UI state. Backend NomCategoryCreate accepts
  // only {name, sort, status}, so photo / service / show-in-menu are
  // presentational until the contract grows; create still sends the existing
  // payload below and never claims to persist them.
  const [photoPreview, setPhotoPreview] = useState(null);
  const [statusOn, setStatusOn] = useState(true);
  const [serviceOn, setServiceOn] = useState(true);
  const [showInMenu, setShowInMenu] = useState(true);
  // V4 — row being edited (null = create). Holds the clicked category so the
  // edit modal prefills its real values; no fake backend update is performed.
  const [editingRow, setEditingRow] = useState(null);
  // V6 — real delete confirmation (null = closed). Mirrors the OWNER
  // settings-modal confirm pattern; no fake "not connected" banner.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const beginRequest = useLatestRequest();
  const { acquire, release } = useMutationLocks();

  async function load() {
    const request = beginRequest();
    setLoading(true);
    setError("");
    try {
      const { data } = await getCategories();
      if (!request.isCurrent()) return;
      const loadedCategories = Array.isArray(data) ? data : [];
      setRows(loadedCategories);
    } catch (err) {
      if (!request.isCurrent() || isAbortError(err)) return;
      setRows([]);
      setError(err.response?.data?.detail || "Не удалось загрузить категории.");
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [type]);

  function openCreate() {
    setEditingId(null);
    setEditingRow(null);
    setForm(DEFAULT_FORM);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setStatusOn(true);
    setServiceOn(true);
    setShowInMenu(true);
    setShowForm(true);
  }

  function openEdit(row) {
    if (!isDishCategories) {
      setError(`Редактирование категории «${row.name}» пока не подключено к backend.`);
      return;
    }
    // V4 — centered edit modal in the Add-modal family, prefilled with the
    // clicked category's real values (name + is_active; photo only if the
    // row actually carries one). V6 — flags are canonical: real prefill.
    setEditingId(row.id);
    setEditingRow(row);
    setForm({
      name: row.name || "",
      slug: row.slug || "",
      sort_order: row.sort_order ?? row.sort ?? 0,
    });
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setStatusOn(row.is_active !== false);
    // V6 — canonical flags: prefill real backend values (absent = false,
    // matching the migration backfill for legacy rows).
    setServiceOn(row.calculate_service === true);
    setShowInMenu(row.show_in_menu === true);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setEditingRow(null);
    setForm(DEFAULT_FORM);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  // V2 — centered modal Escape close (same contract as SettingsPlacesPage:
  // no close while saving). V6 — also covers the delete confirm.
  useEffect(() => {
    if (type !== "dishes") return undefined;
    if (!showForm && !deleteTarget) return undefined;
    function onKey(event) {
      if (event.key !== "Escape") return;
      if (showForm && !saving) closeForm();
      else if (deleteTarget && !deleting) setDeleteTarget(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showForm, deleteTarget, type, saving, deleting]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(event) {
    event.preventDefault();
    if (!acquire("category-save")) return;
    if (editingId) {
      // V6 — real canonical persistence: PATCH /inventory/categories/{id}
      // with supported fields (name + the three booleans). Photo has no
      // backend contract and is never sent.
      const name = form.name.trim();
      if (!name) {
        setError("Укажите название категории.");
        release("category-save");
        return;
      }
      setSaving(true);
      setError("");
      try {
        await catalogService.updateCategory(editingId, {
          name,
          is_active: statusOn,
          calculate_service: serviceOn,
          show_in_menu: showInMenu,
        });
        await load();
        closeForm();
      } catch (err) {
        setError(err.response?.data?.detail || "Не удалось сохранить категорию.");
      } finally {
        setSaving(false);
        release("category-save");
      }
      return;
    }
    const sortOrder = Number(form.sort_order);
    if (!form.name.trim() || !Number.isInteger(sortOrder) || sortOrder < 0) {
      setError("Укажите название и корректный неотрицательный порядок сортировки.");
      release("category-save");
      return;
    }

    const slug = form.slug.trim() || makeSlug(form.name, config.slug_prefix);
    const namespacedSlug = namespaced && !slug.startsWith(config.slug_prefix)
      ? `${config.slug_prefix}-${slug}`
      : slug;
    const categoryPayload = {
      name: form.name.trim(),
      slug: namespacedSlug,
      sort_order: sortOrder,
      // V6 — real booleans: modal states persist through canonical create.
      is_active: statusOn,
      calculate_service: serviceOn,
      show_in_menu: showInMenu,
    };

    setSaving(true);
    setError("");
    try {
      if (!editingId) {
        const { data } = await catalogService.createCategory(categoryPayload);
        if (data?.id) {
          setRows((current) => [...current, data]);
        } else {
          await load();
        }
      }
      closeForm();
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось сохранить категорию.");
    } finally {
      setSaving(false);
      release("category-save");
    }
  }

  function openDeleteConfirm(row) {
    if (!isDishCategories) {
      setError(`Удаление категории «${row.name}» пока не подключено к backend.`);
      return;
    }
    setDeleteError("");
    setDeleteTarget(row);
  }

  async function confirmDelete() {
    if (!deleteTarget || !acquire(`category-del:${deleteTarget.id}`)) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await catalogService.deleteCategory(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      // Referenced categories stay: 409 keeps the confirm open with the real
      // backend message, never a faked removal.
      setDeleteError(err.response?.data?.detail || "Не удалось удалить категорию.");
    } finally {
      setDeleting(false);
      release(`category-del:${deleteTarget?.id}`);
    }
  }

  const visible = useMemo(() => {
    const list = namespaced
      ? rows.filter((row) => String(row.slug || "").startsWith(config.slug_prefix))
      : [...rows];
    return list.sort(sortCategories);
  }, [rows, namespaced, config.slug_prefix]);

  return (
    <section className={`nomenclature-page menu-categories-page${isDishCategories ? " is-dish-categories" : ""}`}>
      <div className="menu-categories-card">
        {isDishCategories ? (
          <header className="settings-header dishcat-header">
            <div className="settings-title-group">
              <span className="settings-accent-bar" />
              <div>
                <p>Меню</p>
                <h1>Категория блюд</h1>
              </div>
            </div>
            <div className="settings-actions">
              <button type="button" disabled={saving} onClick={openCreate}>
                Добавить категорию
              </button>
            </div>
          </header>
        ) : (
          <div className="menu-categories-header">
            <div className="menu-categories-title">
              <span className="menu-categories-accent" />
              <div>
                <h1>{config.title}</h1>
                <p>{config.label}</p>
              </div>
            </div>
            <button type="button" className="menu-category-add" disabled={saving} onClick={openCreate}>
              <span>Добавить</span>
              <Icon name="bi-plus" />
            </button>
          </div>
        )}

        {error ? <div className="login-error menu-category-error">{error}</div> : null}

        {showForm && isDishCategories
          ? createPortal(
              <div className="settings-owner-view dishcat-modal-layer">
                <div className="settings-drawer settings-modal-overlay" role="presentation">
                  <div className="settings-drawer__backdrop" onClick={saving ? undefined : closeForm} />
                  <form
                    className="settings-form settings-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="dishcat-modal-title"
                    onSubmit={handleSave}
                  >
                    <header className="settings-form__header">
                      <span className="settings-accent-bar" />
                      <div>
                        <p>{editingId ? "Редактирование" : "Новая"}</p>
                        <h2 id="dishcat-modal-title">
                          {editingId ? "Редактировать категорию" : "Добавить категорию"}
                        </h2>
                      </div>
                      <button type="button" disabled={saving} onClick={closeForm} aria-label="Закрыть">
                        <Icon name="bi-x-lg" size={20} />
                      </button>
                    </header>
                    <div className="settings-form__body">
                      <div className="dishcat-photo">
                        <div
                          className="dishcat-photo__preview"
                          aria-hidden={!(photoPreview || editingRow?.photo)}
                        >
                          {photoPreview || editingRow?.photo ? (
                            <img
                              src={photoPreview || editingRow.photo}
                              alt={
                                editingId
                                  ? `Фото категории ${editingRow?.name || ""}`
                                  : "Фото новой категории"
                              }
                            />
                          ) : (
                            <Icon name="bi-image" size={26} />
                          )}
                        </div>
                        <div className="dishcat-photo__body">
                          <span>Фото</span>
                          <label
                            className="dishcat-photo__upload"
                            title={editingId ? "Фото пока не сохраняется на сервере" : undefined}
                          >
                            <Icon name="bi-camera" size={16} />
                            {photoPreview ? "Заменить фото" : "Загрузить фото"}
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={saving || Boolean(editingId)}
                              onChange={handlePhotoChange}
                              aria-label="Загрузить фото категории"
                            />
                          </label>
                        </div>
                      </div>
                      <label className="settings-form__wide">
                        <span>Название</span>
                        <input
                          autoFocus
                          value={form.name}
                          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                          placeholder="Название категории"
                        />
                      </label>
                      <div className="settings-toggle-field settings-form__wide">
                        <span>Статус</span>
                        <label className="settings-switch">
                          <input
                            type="checkbox"
                            checked={statusOn}
                            onChange={(event) => setStatusOn(event.target.checked)}
                          />
                          <span className="settings-switch__track" aria-hidden="true">
                            <span className="settings-switch__thumb" />
                          </span>
                          <span className={`settings-switch__label ${statusOn ? "is-active" : "is-inactive"}`}>
                            {statusOn ? "Активен" : "Неактивен"}
                          </span>
                        </label>
                      </div>
                      <div className="settings-toggle-field settings-form__wide">
                        <span>Рассчитать обслугу</span>
                        <label className="settings-switch">
                          <input
                            type="checkbox"
                            checked={serviceOn}
                            onChange={(event) => setServiceOn(event.target.checked)}
                          />
                          <span className="settings-switch__track" aria-hidden="true">
                            <span className="settings-switch__thumb" />
                          </span>
                          <span className={`settings-switch__label ${serviceOn ? "is-active" : "is-inactive"}`}>
                            {serviceOn ? "Включено" : "Выключено"}
                          </span>
                        </label>
                      </div>
                      <div className="settings-toggle-field settings-form__wide">
                        <span>Показать в меню</span>
                        <label className="settings-switch">
                          <input
                            type="checkbox"
                            checked={showInMenu}
                            onChange={(event) => setShowInMenu(event.target.checked)}
                          />
                          <span className="settings-switch__track" aria-hidden="true">
                            <span className="settings-switch__thumb" />
                          </span>
                          <span className={`settings-switch__label ${showInMenu ? "is-active" : "is-inactive"}`}>
                            {showInMenu ? "Включено" : "Выключено"}
                          </span>
                        </label>
                      </div>
                    </div>
                    {error ? (
                      <p className="settings-form__error" role="alert">
                        {error}
                      </p>
                    ) : null}
                    <footer className="settings-form__footer">
                      <button type="button" disabled={saving} onClick={closeForm}>
                        Отмена
                      </button>
                      <button type="submit" disabled={saving || !form.name.trim()}>
                        {saving ? "Сохранение..." : editingId ? "Сохранить" : "Добавить"}
                      </button>
                    </footer>
                  </form>
                </div>
              </div>,
              document.body,
            )
          : null}

        {showForm && !isDishCategories ? (
          <form className="menu-category-form" onSubmit={handleSave}>
            <div className="menu-category-form-title">
              <strong>{editingId ? "Изменить категорию" : "Новая категория"}</strong>
              <button type="button" disabled={saving} onClick={closeForm} aria-label="Закрыть">
                <Icon name="bi-x-lg" />
              </button>
            </div>
            <div className="menu-category-form-grid">
              <label>
                <span>Название *</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Название категории"
                />
              </label>
              <label>
                <span>Slug</span>
                <input
                  value={form.slug}
                  onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                  placeholder="Автоматически"
                />
              </label>
              <label>
                <span>Сортировка</span>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))}
                />
              </label>
            </div>
            <div className="menu-category-form-actions">
              <button className="menu-category-save" type="submit" disabled={saving || !form.name.trim()}>
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
              <button className="menu-category-cancel" type="button" disabled={saving} onClick={closeForm}>
                Отмена
              </button>
            </div>
          </form>
        ) : null}

        <div className={`menu-category-list${isDishCategories ? " dishcat-list" : ""}`} aria-busy={loading}>
          {loading
            ? Array.from({ length: 6 }, (_, index) => <div className="menu-category-row is-loading" key={index} />)
            : visible.map((row) =>
                isDishCategories ? (
                  <article className="menu-category-row dishcat-row" key={row.id}>
                    <div className="dishcat-main">
                      <div className="dishcat-info">
                        <strong>{row.name}</strong>
                      </div>
                    </div>
                    <div className="dishcat-meta">
                      <div className="dishcat-photo-sm" aria-hidden="true">
                        {row.photo || row.image_url ? (
                          <img src={row.photo || row.image_url} alt="" />
                        ) : (
                          <Icon name="bi-image" size={20} />
                        )}
                      </div>
                      <span
                        className={`dishcat-service-badge ${row.calculate_service === true ? "is-on" : "is-off"}`}
                      >
                        <span className="dishcat-service-badge__dot" aria-hidden="true" />
                        Рассчитать обслугу
                      </span>
                      <DishCategoryStatusBadge active={row.is_active !== false} />
                      <button type="button" className="settings-place__edit" onClick={() => openEdit(row)}>
                        Редактировать
                      </button>
                      <button
                        type="button"
                        className="settings-action-delete"
                        onClick={() => openDeleteConfirm(row)}
                        aria-label="Удалить"
                      >
                        <Icon name="bi-trash3" size={15} />
                      </button>
                    </div>
                  </article>
                ) : (
                  <article className="menu-category-row" key={row.id}>
                    <div className="menu-category-name">
                      <strong>{row.name}</strong>
                      <span>#{row.slug || makeSlug(row.name || "", config.slug_prefix)}</span>
                    </div>
                    <button type="button" className="menu-category-image" aria-label="Изображение категории">
                      <Icon name="bi-image" />
                    </button>
                    <button type="button" className="menu-category-service">
                      Рассчитать обслугу
                    </button>
                    <span className={`menu-category-status ${row.is_active === false ? "is-muted" : ""}`}>
                      {row.is_active === false ? "#архив" : "#активно"}
                    </span>
                    <button type="button" className="menu-category-icon edit" onClick={() => openEdit(row)} aria-label="Изменить">
                      <Icon name="bi-pencil" />
                    </button>
                    <button type="button" className="menu-category-icon delete" onClick={() => openDeleteConfirm(row)} aria-label="Удалить">
                      <Icon name="bi-trash3" />
                    </button>
                  </article>
                ),
              )}

          {!loading && !error && !visible.length ? (
            <div className="menu-category-empty">
              <Icon name="bi-inbox" />
              <span>Категорий пока нет.</span>
            </div>
          ) : null}
        </div>
      </div>

      {deleteTarget && isDishCategories
        ? createPortal(
            <div className="settings-owner-view dishcat-modal-layer">
              <div className="settings-drawer settings-modal-overlay" role="presentation">
                <div
                  className="settings-drawer__backdrop"
                  onClick={deleting ? undefined : () => setDeleteTarget(null)}
                />
                <form
                  className="settings-form settings-modal dishcat-confirm"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="dishcat-delete-title"
                  onSubmit={(event) => {
                    event.preventDefault();
                    confirmDelete();
                  }}
                >
                  <header className="settings-form__header">
                    <span className="settings-accent-bar" />
                    <div>
                      <p>Удаление</p>
                      <h2 id="dishcat-delete-title">Удалить категорию</h2>
                    </div>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => setDeleteTarget(null)}
                      aria-label="Закрыть"
                    >
                      <Icon name="bi-x-lg" size={20} />
                    </button>
                  </header>
                  <p className="settings-form__context">
                    Удалить категорию <strong>«{deleteTarget.name}»</strong>? Это действие нельзя отменить.
                  </p>
                  {deleteError ? (
                    <p className="settings-form__error" role="alert">
                      {deleteError}
                    </p>
                  ) : null}
                  <footer className="settings-form__footer">
                    <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>
                      Отмена
                    </button>
                    <button
                      type="submit"
                      className="dishcat-confirm__delete"
                      disabled={deleting}
                    >
                      {deleting ? "Удаление..." : "Удалить"}
                    </button>
                  </footer>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}

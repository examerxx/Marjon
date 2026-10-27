import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getCategories } from "../api/categories";
import { catalogService } from "../api/catalog";
import { categoryBelongsToKind } from "../utils/catalogCategories";
import Icon from "../components/Icon";
import { useCategoryListHeight } from "./categoryListHeight";
import { isAbortError, useLatestRequest, useMutationLocks } from "../hooks/useAsyncSafety";
import { t } from "../i18n/t";
import "../styles/owner/raw-categories.css";
import "../styles/shared/catalog-scrollbar-arrows.css";

const TYPE_CONFIG = {
  dishes: { label: "Категории блюд", title: "Меню", slug_prefix: "dish" },
  raw: { label: "Категория продуктов", title: "Категория продуктов", slug_prefix: "raw" },
  semi: { label: "Категории полуфабрикатов", title: "Категории полуфабрикатов", slug_prefix: "semi" },
  sales: { label: "Категория товаров", title: "Категория товаров", slug_prefix: "sales" },
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

// SWR-кэш рядов по type: повторный заход (блюда ↔ товары) показывает
// прошлые ряды мгновенно, свежие подтягиваются фоном — нет вспышки
// скелетон → данные при каждом переходе. Мутации идут через load(),
// кэш обновляется там же; create-append зеркалит в кэш вручную.
const rowsByTypeCache = new Map();

// REORDER V1 — optimistic merge для видимого списка категорий: только отправленные
// id (строки текущего таба) перенумеровываются 0..n-1; все остальные ряды
// (например, архивные) хранят свой sort_order. Возвращает НОВЫЙ массив,
// вход не мутирует (rollback держит прежний массив).
export function applyCategoryOrder(rows, orderedIds) {
  const orderIndex = new Map(orderedIds.map((id, index) => [String(id), index]));
  return rows.map((row) => {
    const index = orderIndex.get(String(row.id));
    return index === undefined ? row : { ...row, sort_order: index };
  });
}

// Live-подписка prefers-reduced-motion для сортируемого списка (приватный
// хук SettingsPlacesPage, скопированный — он не экспортируется): drag должен
// реагировать на смену настройки ОС mid-session, без перезагрузки.
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

// REORDER V1 — sortable-строка категории блюд/товаров (1:1 approved dishcat-row
// разметка + grip). Pointer-drag — по телу строки (.dishcat-main, порог 6px,
// клик по строке ничего не делает, т.к. строка не навигационная). Клавиатурный
// reorder — на grip (Enter/Space взять, стрелки двигать), как у Мест; grip
// несёт {...attributes} {...listeners}. Meta гасит pointerdown, чтобы кнопки
// Редактировать/Архивировать/удалить не стартовали drag. Меняется только порядок.
function DishCategoryRow({ row, reducedMotion, disabled, onEdit, onArchive, sortable = {}, overlay = false }) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = sortable;
  // The actual moving card is portalled out of the scrolling panel. Keep a
  // placeholder here so list geometry and the neighbouring row motion stay intact.
  const translate = CSS.Translate.toString(transform);
  const style = {
    transform: isDragging ? undefined : translate || undefined,
    transition: reducedMotion ? undefined : transition,
  };
  const className = "menu-category-row dishcat-row"
    + (isDragging ? " is-dragging is-drag-placeholder" : "")
    + (overlay ? " is-drag-overlay" : "")
    + (reducedMotion ? " is-reduced-motion" : "");
  return (
    <article ref={setNodeRef} style={style} className={className} aria-hidden={overlay || undefined}>
      <div
        className="dishcat-main"
        onPointerDown={disabled ? undefined : listeners?.onPointerDown}
      >
        <div className="dishcat-info">
          <strong>{row.name}</strong>
        </div>
      </div>
      <div className="dishcat-meta" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="settings-place__grip"
          ref={setActivatorNodeRef}
          aria-label={`Переместить категорию: ${row.name}`}
          title={t("pages.categoriespage.peretaschite_chtoby_izmenit_poryadok")}
          tabIndex={overlay ? -1 : undefined}
          {...attributes}
          {...listeners}
        >
          <Icon name="bi-grip-vertical" size={16} />
        </button>
        <span
          className={`dishcat-service-badge ${row.calculate_service === true ? "is-on" : "is-off"}`}
        >
          <span className="dishcat-service-badge__dot" aria-hidden="true" />
         {t("pages.categoriespage.rasschitat_obslugu")}
        </span>
        <DishCategoryStatusBadge active={row.is_active !== false} />
        <button type="button" className="settings-place__edit" tabIndex={overlay ? -1 : undefined} onClick={overlay ? undefined : () => onEdit(row)}>
         {t("pages.categoriespage.redaktirovat")}
        </button>
        <button
          type="button"
          className="settings-action-delete"
          onClick={overlay ? undefined : () => onArchive(row)}
          tabIndex={overlay ? -1 : undefined}
          aria-label={t("pages.categoriespage.arhivirovat_kategoriyu")}
          title={t("pages.categoriespage.arhivirovat_kategoriyu")}
        >
          <Icon name="bi-trash3" size={15} />
        </button>
      </div>
    </article>
  );
}

function SortableDishCategoryRow(props) {
  const sortable = useSortable({ id: String(props.row.id), disabled: props.disabled });
  return <DishCategoryRow {...props} sortable={sortable} />;
}

function ProductCategoriesPage({ type }) {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.dishes;
  // All newly created categories keep the originating section's slug prefix.
  // Legacy unprefixed categories remain in dishes (see catalogCategories).
  // V1 — Place-family rework applies ONLY to dish categories (Menu →
  // Категория блюд). Raw/semi keep their exact current markup so their
  // contract tests and visuals are untouched. Sales (Категория товаров)
  // разделяет dish-ветку 1:1 (row-cards, архив, модалка без фото).
  const isDishCategories = type === "dishes";
  const isSalesCategories = type === "sales";
  const isMenuCategories = isDishCategories || isSalesCategories;
  // RAW CATEGORY V1 — выделенная ветка только для Склад → Категория сырья.
  // Блюда и semi не затрагиваются: их разметка,
  // модалки и стабы остаются 1:1. Raw получает table из 3 колонок
  // (Название/Статус/Действия) в визуальной семье dish-категорий.
  const isRawCategories = type === "raw";
  const [rows, setRows] = useState(() => rowsByTypeCache.get(type) || []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  // Exit-анимация формы (is-closing → unmount, 160мс settings-modal-out).
  const [formClosing, setFormClosing] = useState(false);
  const formCloseTimer = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  // V2 — Add Category modal local UI state. Backend NomCategoryCreate accepts
  // only {name, sort, status}, so service / show-in-menu are presentational
  // until the contract grows; create still sends the existing payload below
  // and never claims to persist them. Фото у категорий блюд убрано (п.13).
  const [statusOn, setStatusOn] = useState(true);
  const [serviceOn, setServiceOn] = useState(true);
  const [showInMenu, setShowInMenu] = useState(true);
  // V4 — row being edited (null = create). Holds the clicked category so the
  // edit modal prefills its real values; no fake backend update is performed.
  // V6 — real delete confirmation (null = closed). Mirrors the OWNER
  // settings-modal confirm pattern; no fake "not connected" banner.
  // ARCHIVE V1 — permanent delete lives ONLY in the Archived tab; the
  // Active-tab trash archives instead (see archiveTarget below).
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // ARCHIVE V1 — Active-tab archive flow: trash means "move to archive"
  // (PATCH is_active:false), never physical DELETE. Archived rows expose
  // Restore (PATCH is_active:true) + permanent Delete instead of Edit.
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [restoringId, setRestoringId] = useState(null);
  const beginRequest = useLatestRequest();
  const { acquire, release } = useMutationLocks();
  // REORDER V1 — состояние drag-and-drop: savingOrder блокирует второй drop
  // (optimistic-порядок ещё не подтверждён backend), orderError — rollback-баннер.
  const [savingOrder, setSavingOrder] = useState(false);
  const [draggedCategory, setDraggedCategory] = useState(null);
  useEffect(() => setDraggedCategory(null), [type, showArchived]);
  const [orderError, setOrderError] = useState("");
  const reducedMotion = useReducedMotion();
  const sensors = useSensors(
    // 6px порог: обычный клик по строке ничего не делает, тянет только
    // реальное движение (та же настройка, что у SettingsPlacesPage).
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function load() {
    const request = beginRequest();
    setLoading(true);
    setError("");
    try {
      // ARCHIVE V1: one canonical read with archived rows included; the
      // Active/Archived tabs split client-side by real is_active. Default
      // backend behavior (active-only) is untouched for other consumers.
      const { data } = await getCategories({ params: { include_inactive: true } });
      if (!request.isCurrent()) return;
      const loadedCategories = Array.isArray(data) ? data : [];
      rowsByTypeCache.set(type, loadedCategories);
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
    clearTimeout(formCloseTimer.current);
    setFormClosing(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setStatusOn(true);
    setServiceOn(true);
    setShowInMenu(true);
    setShowForm(true);
  }

  function openEdit(row) {
    clearTimeout(formCloseTimer.current);
    setFormClosing(false);
    if (isRawCategories) {
      // RAW V1 — настоящее редактирование через canonical PATCH:
      // только имя + статус (slug на update backend не принимает).
      setEditingId(row.id);
      setForm({
        name: row.name || "",
        slug: row.slug || "",
        sort_order: row.sort_order ?? row.sort ?? 0,
      });
      setStatusOn(row.is_active !== false);
      setServiceOn(row.calculate_service === true);
      setShowInMenu(row.show_in_menu === true);
      setShowForm(true);
      return;
    }
    if (!isMenuCategories) {
      setError(`Редактирование категории «${row.name}» пока не подключено к backend.`);
      return;
    }
    // V4 — centered edit modal in the Add-modal family, prefilled with the
    // clicked category's real values (name + is_active).
    // V6 — flags are canonical: real prefill.
    setEditingId(row.id);
    setForm({
      name: row.name || "",
      slug: row.slug || "",
      sort_order: row.sort_order ?? row.sort ?? 0,
    });
    setStatusOn(row.is_active !== false);
    // V6 — canonical flags: prefill real backend values (absent = false,
    // matching the migration backfill for legacy rows).
    setServiceOn(row.calculate_service === true);
    setShowInMenu(row.show_in_menu === true);
    setShowForm(true);
  }

  function closeForm() {
    clearTimeout(formCloseTimer.current);
    setFormClosing(false);
    setShowForm(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
  }

  // Пользовательское закрытие — через exit-анимацию; сброс/анмаунт в closeForm.
  function requestCloseForm() {
    if (saving || formClosing) return;
    const reduced = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      closeForm();
      return;
    }
    setFormClosing(true);
    clearTimeout(formCloseTimer.current);
    formCloseTimer.current = setTimeout(closeForm, 160);
  }

  // V2 — centered modal Escape close (same contract as SettingsPlacesPage:
  // no close while saving). V6 — also covers the delete confirm.
  // ARCHIVE V1 — raw modals and the archive confirm close on Escape as well.
  useEffect(() => {
    if (!isMenuCategories && type !== "raw") return undefined;
    if (!showForm && !deleteTarget && !archiveTarget) return undefined;
    function onKey(event) {
      if (event.key !== "Escape") return;
      if (archiveTarget && !archiving) {
        setArchiveTarget(null);
        return;
      }
      if (showForm && !saving) requestCloseForm();
      else if (deleteTarget && !deleting) setDeleteTarget(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showForm, deleteTarget, archiveTarget, type, saving, deleting, archiving]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    clearTimeout(formCloseTimer.current);
  }, []);

  async function handleSave(event) {
    event.preventDefault();
    if (!acquire("category-save")) return;
    if (editingId) {
      // V6 — real canonical persistence: PATCH /inventory/categories/{id}
      // with supported fields (name + the three booleans).
      // RAW V1 — только имя + статус: slug на update backend не принимает,
      // флаги блюд к сырью не относятся. Фото у категорий блюд убрано.
      const name = form.name.trim();
      if (!name) {
        setError("Укажите название категории.");
        release("category-save");
        return;
      }
      setSaving(true);
      setError("");
      try {
        if (isRawCategories) {
          try {
            await catalogService.updateCategory(editingId, {
              name,
              is_active: statusOn,
            });
            await load();
            requestCloseForm();
          } catch (err) {
            setError(err.response?.data?.detail || err.message || "Не удалось сохранить категорию.");
          } finally {
            setSaving(false);
            release("category-save");
          }
          return;
        }
        await catalogService.updateCategory(editingId, {
          name,
          is_active: statusOn,
          calculate_service: serviceOn,
          show_in_menu: showInMenu,
        });
        await load();
        requestCloseForm();
      } catch (err) {
        setError(err.response?.data?.detail || err.message || "Не удалось сохранить категорию.");
      } finally {
        setSaving(false);
        release("category-save");
      }
      return;
    }
    if (!form.name.trim()) {
      setError("Укажите название категории.");
      release("category-save");
      return;
    }

    const slug = form.slug.trim() || makeSlug(form.name, config.slug_prefix);
    const namespacedSlug = !slug.startsWith(config.slug_prefix)
      ? `${config.slug_prefix}-${slug}`
      : slug;

    setSaving(true);
    setError("");
    try {
      // RAW V1 — минимально необходимый контракт: имя + slug + порядок +
      // статус. Флаги блюд к сырью не относятся и не отправляются.
      if (isRawCategories) {
        try {
          const rawPayload = {
            name: form.name.trim(),
            slug: namespacedSlug,
            is_active: statusOn,
          };
          const { data } = await catalogService.createCategory(rawPayload);
          if (data?.id) {
            setRows((current) => {
              const next = [...current, data];
              rowsByTypeCache.set(type, next);
              return next;
            });
          } else {
            await load();
          }
          requestCloseForm();
        } catch (err) {
          setError(err.response?.data?.detail || err.message || "Не удалось сохранить категорию.");
        } finally {
          setSaving(false);
          release("category-save");
        }
        return;
      }
      const categoryPayload = {
        name: form.name.trim(),
        slug: namespacedSlug,
        is_active: statusOn,
        calculate_service: serviceOn,
        show_in_menu: showInMenu,
      };
      if (!editingId) {
        const { data } = await catalogService.createCategory(categoryPayload);
        if (data?.id) {
          setRows((current) => {
            const next = [...current, data];
            rowsByTypeCache.set(type, next);
            return next;
          });
        } else {
          await load();
        }
      }
      requestCloseForm();
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Не удалось сохранить категорию.");
    } finally {
      setSaving(false);
      release("category-save");
    }
  }

  function openDeleteConfirm(row) {
    if (isRawCategories) {
      // RAW V1 — реальное подтверждение удаления (hard delete backend,
      // 409 при связанных блюдах/дочерних категориях).
      setDeleteError("");
      setDeleteTarget(row);
      return;
    }
    if (!isMenuCategories) {
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

  function openArchiveConfirm(row) {
    setArchiveError("");
    setArchiveTarget(row);
  }

  async function confirmArchive() {
    if (!archiveTarget || !acquire(`category-archive:${archiveTarget.id}`)) return;
    setArchiving(true);
    setArchiveError("");
    try {
      // Canonical archive: soft state flip only. Dishes, raw materials,
      // prices, recipes and relations are untouched (no cascade); the row
      // keeps its ID and simply moves to the Archived tab.
      await catalogService.updateCategory(archiveTarget.id, { is_active: false });
      setArchiveTarget(null);
      await load();
    } catch (err) {
      setArchiveError(err.response?.data?.detail || err.message || "Не удалось архивировать категорию.");
    } finally {
      setArchiving(false);
      release(`category-archive:${archiveTarget?.id}`);
    }
  }

  async function restoreCategory(row) {
    if (!acquire(`category-restore:${row.id}`)) return;
    setRestoringId(row.id);
    setError("");
    try {
      // Canonical restore: flip the persisted flag back. Name, photo,
      // flags and product/raw relations are preserved by the partial PATCH;
      // independent status is not invented (is_active IS the archive state).
      await catalogService.updateCategory(row.id, { is_active: true });
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Не удалось восстановить категорию.");
    } finally {
      setRestoringId(null);
      release(`category-restore:${row.id}`);
    }
  }

  // REORDER V1 — persist завершённого drag видимого списка (таб Активные).
  // Optimistic: отправленные id перенумеровываются 0..n-1 в локальных rows и
  // SWR-кэше, затем ОДИН PATCH /inventory/categories/reorder. При успехе
  // порядок уже каноничен (backend применил ровно этот subset); при ошибке —
  // откат к pre-drag rows + баннер. Контракт partial: категории вне списка
  // свой sort_order хранят.
  async function reorderVisible(orderedIds) {
    if (!acquire("category-reorder")) return;
    const previous = rows;
    setOrderError("");
    setSavingOrder(true);
    setRows((current) => {
      const next = applyCategoryOrder(current, orderedIds);
      rowsByTypeCache.set(type, next);
      return next;
    });
    try {
      await catalogService.reorderCategories(orderedIds);
    } catch (err) {
      // Rollback — никогда не оставляем отклонённый порядок на экране.
      setRows(previous);
      rowsByTypeCache.set(type, previous);
      setOrderError(err.response?.data?.detail || err.message || "Не удалось сохранить порядок категорий.");
    } finally {
      setSavingOrder(false);
      release("category-reorder");
    }
  }

  function onDragEnd(event) {
    setDraggedCategory(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = displayed.map((row) => String(row.id));
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    reorderVisible(arrayMove(ids, from, to));
  }

  const visible = useMemo(() => {
    const list = rows.filter((row) => categoryBelongsToKind(row, config.slug_prefix));
    return list.sort(sortCategories);
  }, [rows, config.slug_prefix]);

  // ARCHIVE V1 — segmented Active/Archived control (same MARJON family as
  // Dishes/Raw: soft blue container, white sliding indicator, 250ms ease).
  // Only one header (dish or raw) is mounted at a time, so one pill fits both.
  const tabsRef = useRef(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });
  // Первый замер — без слайда (is-settled гасит transition до него).
  const [pillSettled, setPillSettled] = useState(false);
  useLayoutEffect(() => {
    const container = tabsRef.current;
    if (!container) return undefined;
    const update = () => {
      const active = container.querySelector("[data-tab].is-active");
      if (!active) return;
      setPill((current) => {
        const next = { left: active.offsetLeft, width: active.offsetWidth };
        return current.left === next.left && current.width === next.width
          ? current
          : next;
      });
      setPillSettled(true);
    };
    update();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(container);
      container.querySelectorAll("[data-tab]").forEach((segment) => ro.observe(segment));
    } else {
      window.addEventListener("resize", update);
    }
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [showArchived, type]);

  const visibleActive = useMemo(
    () => visible.filter((row) => row.is_active !== false),
    [visible],
  );
  const visibleArchived = useMemo(
    () => visible.filter((row) => row.is_active === false),
    [visible],
  );
  // Tabs exist only on dish/raw pages; semi/sales keep the legacy unfiltered
  // list exactly (no archive UI there, no behavior change).
  const hasArchiveTabs = isMenuCategories || isRawCategories;
  const displayed = !hasArchiveTabs
    ? visible
    : showArchived ? visibleArchived : visibleActive;

  const categoryListRef = useRef(null);
  useCategoryListHeight(categoryListRef, hasArchiveTabs,
    `${type}:${showArchived}:${loading}:${error}:${displayed.length}`);

  return (
    <section className={`nomenclature-page menu-categories-page${isMenuCategories ? " is-dish-categories" : ""}${isRawCategories ? " is-raw-categories" : ""}`}>
      <div className="menu-categories-card">
        {isMenuCategories ? (
          <header className="settings-header dishcat-header">
            <div className="settings-title-group">
              <span className="settings-accent-bar" />
              <div>
                <p>{t("pages.categoriespage.menyu")}</p>
                <h1>{isSalesCategories ? t("nav.sale_categories") : t("nav.dish_categories")}</h1>
              </div>
            </div>
            <div className="settings-actions">
              <div className={`dish-status-tabs${pillSettled ? " is-settled" : ""}`} role="tablist" aria-label={t("pages.categoriespage.status_kategoriy")} ref={tabsRef}>
                <span
                  className="dish-status-tabs__indicator"
                  aria-hidden="true"
                  style={{
                    transform: `translateX(${pill.left}px)`,
                    width: pill.width,
                  }}
                />
                <button
                  type="button"
                  role="tab"
                  data-tab="active"
                  aria-selected={!showArchived}
                  className={showArchived ? "" : "is-active"}
                  onClick={() => setShowArchived(false)}
                >
                 {t("pages.categoriespage.aktivnye")}
                </button>
                <button
                  type="button"
                  role="tab"
                  data-tab="archived"
                  aria-selected={showArchived}
                  className={showArchived ? "is-active" : ""}
                  onClick={() => setShowArchived(true)}
                >
                 {t("pages.categoriespage.arhivirovannye")}
                </button>
              </div>
              <button type="button" disabled={saving || savingOrder} onClick={openCreate}>
               {t("pages.categoriespage.dobavit_kategoriyu")}
              </button>
            </div>
          </header>
        ) : isRawCategories ? (
          <header className="settings-header dishcat-header rawcat-header">
            <div className="settings-title-group">
              <span className="settings-accent-bar" aria-hidden="true" />
              <div>
                <p>{t("pages.categoriespage.sklad")}</p>
                <h1>{t("pages.categoriespage.kategoriya_produktov")}</h1>
              </div>
            </div>
            <div className="settings-actions">
              <div className={`dish-status-tabs${pillSettled ? " is-settled" : ""}`} role="tablist" aria-label={t("pages.categoriespage.status_kategoriy")} ref={tabsRef}>
                <span
                  className="dish-status-tabs__indicator"
                  aria-hidden="true"
                  style={{
                    transform: `translateX(${pill.left}px)`,
                    width: pill.width,
                  }}
                />
                <button
                  type="button"
                  role="tab"
                  data-tab="active"
                  aria-selected={!showArchived}
                  className={showArchived ? "" : "is-active"}
                  onClick={() => setShowArchived(false)}
                >
                 {t("pages.categoriespage.aktivnye")}
                </button>
                <button
                  type="button"
                  role="tab"
                  data-tab="archived"
                  aria-selected={showArchived}
                  className={showArchived ? "is-active" : ""}
                  onClick={() => setShowArchived(true)}
                >
                 {t("pages.categoriespage.arhivirovannye")}
                </button>
              </div>
              <button type="button" className="rawcat-add-button" disabled={saving} onClick={openCreate}>
                <Icon name="bi-plus" size={18} /> {t("pages.categoriespage.dobavit")}
              </button>
            </div>
          </header>
        ) : (
          <div className="menu-categories-header">
            <div className="menu-categories-title">
              <span className="menu-categories-accent" />
              <div>
                <h1>{t(config.title)}</h1>
                <p>{t(config.label)}</p>
              </div>
            </div>
            <button type="button" className="menu-category-add" disabled={saving} onClick={openCreate}>
              <span>{t("pages.categoriespage.dobavit")}</span>
              <Icon name="bi-plus" />
            </button>
          </div>
        )}

        {error ? <div className="login-error menu-category-error">{error}</div> : null}
        {/* REORDER V1: rollback-баннер отклонённого порядка (та же семья, что
            основная ошибка страницы; role=alert — как у баннеров Мест). */}
        {orderError ? (
          <div className="login-error menu-category-error" role="alert">{orderError}</div>
        ) : null}

        {showForm && isMenuCategories
          ? createPortal(
              <div className="settings-owner-view dishcat-modal-layer">
                <div className={`settings-drawer settings-modal-overlay${formClosing ? " is-closing" : ""}`} role="presentation">
                  <div className="settings-drawer__backdrop" onClick={saving ? undefined : requestCloseForm} />
                  <form
                    className={`settings-form settings-modal${editingId ? " dishcat-modal--edit" : ""}`}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="dishcat-modal-title"
                    onSubmit={handleSave}
                  >
                    <header className="settings-form__header">
                      <span className="settings-accent-bar" />
                      <div>
                        <p>{editingId ? t("staff.editing") : t("eyebrow.new_female")}</p>
                        <h2 id="dishcat-modal-title">
                          {editingId ? t("admin.admincatalog.redaktirovat_kategoriyu") : t("pages.categoriespage.dobavit_kategoriyu")}
                        </h2>
                      </div>
                      <button type="button" disabled={saving} onClick={requestCloseForm} aria-label={t("pages.categoriespage.zakryt")}>
                        <Icon name="bi-x-lg" size={20} />
                      </button>
                    </header>
                    <div className="settings-form__body">
                      <label className="settings-form__wide">
                        <span>{t("pages.categoriespage.nazvanie")}</span>
                        <input
                          autoFocus
                          value={form.name}
                          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                          placeholder={t("pages.categoriespage.nazvanie_kategorii")}
                        />
                      </label>
                      <div className="settings-toggle-field settings-form__wide">
                        <span>{t("pages.categoriespage.status")}</span>
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
                            {statusOn ? t("staff.active") : t("staff.inactive")}
                          </span>
                        </label>
                      </div>
                      <div className="settings-toggle-field settings-form__wide">
                        <span>{t("pages.categoriespage.rasschitat_obslugu")}</span>
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
                            {serviceOn ? t("common.enabled") : t("common.disabled")}
                          </span>
                        </label>
                      </div>
                      <div className="settings-toggle-field settings-form__wide">
                        <span>{t("pages.categoriespage.pokazat_v_menyu")}</span>
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
                            {showInMenu ? t("common.enabled") : t("common.disabled")}
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
                      <button type="button" disabled={saving} onClick={requestCloseForm}>
                       {t("pages.categoriespage.otmena")}
                      </button>
                      <button type="submit" disabled={saving || !form.name.trim()}>
                        {saving ? t("staff.saving") : editingId ? t("common.save") : t("common.add")}
                      </button>
                    </footer>
                  </form>
                </div>
              </div>,
              document.body,
            )
          : null}

        {showForm && isRawCategories
          ? createPortal(
              <div className="settings-owner-view dishcat-modal-layer rawcat-modal-layer">
                <div className={`settings-drawer settings-modal-overlay${formClosing ? " is-closing" : ""}`} role="presentation">
                  <div className="settings-drawer__backdrop" onClick={saving ? undefined : requestCloseForm} />
                  <form
                    className="settings-form settings-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="rawcat-modal-title"
                    onSubmit={handleSave}
                  >
                    <header className="settings-form__header">
                      <span className="settings-accent-bar" />
                      <div>
                        <p>{editingId ? t("staff.editing") : t("eyebrow.new_female")}</p>
                        <h2 id="rawcat-modal-title">
                          {editingId ? t("pages.categoriespage.redaktirovat_kategoriyu_produktov") : t("pages.categoriespage.dobavit_kategoriyu_produktov")}
                        </h2>
                      </div>
                      <button type="button" disabled={saving} onClick={requestCloseForm} aria-label={t("pages.categoriespage.zakryt")}>
                        <Icon name="bi-x-lg" size={20} />
                      </button>
                    </header>
                    <div className="settings-form__body">
                      <label className="settings-form__wide">
                        <span>{t("pages.categoriespage.nazvanie_kategorii")}</span>
                        <input
                          autoFocus
                          value={form.name}
                          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                          placeholder={t("pages.categoriespage.nazvanie_kategorii")}
                        />
                      </label>
                      <div className="settings-toggle-field settings-form__wide">
                        <span>{t("pages.categoriespage.status")}</span>
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
                            {statusOn ? t("common.active") : t("common.inactive")}
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
                      <button type="button" disabled={saving} onClick={requestCloseForm}>
                       {t("pages.categoriespage.otmenit")}
                      </button>
                      <button type="submit" disabled={saving || !form.name.trim()}>
                        {saving ? t("staff.saving") : t("common.save")}
                      </button>
                    </footer>
                  </form>
                </div>
              </div>,
              document.body,
            )
          : null}

        {showForm && !isMenuCategories && !isRawCategories ? (
          <form className="menu-category-form" onSubmit={handleSave}>
            <div className="menu-category-form-title">
              <strong>{editingId ? t("admin.adminfinancereferences.izmenit_kategoriyu") : t("pages.nomenclature.dishsingleselect.novaya_kategoriya")}</strong>
              <button type="button" disabled={saving} onClick={closeForm} aria-label={t("pages.categoriespage.zakryt")}>
                <Icon name="bi-x-lg" />
              </button>
            </div>
            <div className="menu-category-form-grid">
              <label>
                <span>{t("pages.categoriespage.nazvanie_2")}</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={t("pages.categoriespage.nazvanie_kategorii")}
                />
              </label>
              <label>
                <span>Slug</span>
                <input
                  value={form.slug}
                  onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                  placeholder={t("pages.categoriespage.avtomaticheski")}
                />
              </label>
            </div>
            <div className="menu-category-form-actions">
              <button className="menu-category-save" type="submit" disabled={saving || !form.name.trim()}>
                {saving ? t("staff.saving") : t("common.save")}
              </button>
              <button className="menu-category-cancel" type="button" disabled={saving} onClick={closeForm}>
               {t("pages.categoriespage.otmena")}
              </button>
            </div>
          </form>
        ) : null}

        {isRawCategories ? (
          <div className={`rawcat-list-wrap${!loading && !error && !displayed.length ? " is-empty" : ""}`}>
            <div className="rawcat-list" ref={categoryListRef} tabIndex={0} aria-label={t("pages.categoriespage.kategorii_produktov")} aria-busy={loading}>
              {loading && rows.length === 0 ? (
                <div className="rawcat-row is-loading" role="status" aria-busy="true">{t("pages.categoriespage.zagruzka")}</div>
              ) : (
                displayed.map((row) => (
                  <article className="rawcat-row" key={row.id}>
                    <div className="rawcat-name">
                      <span className="rawcat-name-text" title={row.name}>{row.name}</span>
                    </div>
                    <div className="rawcat-status">
                      <DishCategoryStatusBadge active={row.is_active !== false} />
                    </div>
                    {showArchived ? (
                    <div className="rawcat-actions">
                      <button
                        type="button"
                        className="settings-action-restore"
                        onClick={() => restoreCategory(row)}
                        disabled={restoringId === row.id}
                        aria-label={t("pages.categoriespage.vosstanovit_kategoriyu")}
                        title={t("pages.categoriespage.vosstanovit_kategoriyu")}
                      >
                        <Icon name="bi-arrow-counterclockwise" size={15} />
                      </button>
                      <button
                        type="button"
                        className="settings-action-delete"
                        onClick={() => openDeleteConfirm(row)}
                        aria-label={t("pages.categoriespage.udalit_okonchatelno")}
                        title={t("pages.categoriespage.udalit_okonchatelno")}
                      >
                        <Icon name="bi-trash3" size={15} />
                      </button>
                    </div>
                    ) : (
                    <div className="rawcat-actions">
                      <button type="button" className="settings-place__edit" onClick={() => openEdit(row)} disabled={saving}>
                       {t("pages.categoriespage.redaktirovat")}
                      </button>
                      <button
                        type="button"
                        className="settings-action-delete"
                        onClick={() => openArchiveConfirm(row)}
                        aria-label={t("pages.categoriespage.arhivirovat_kategoriyu")}
                        title={t("pages.categoriespage.arhivirovat_kategoriyu")}
                      >
                        <Icon name="bi-trash3" size={15} />
                      </button>
                    </div>
                    )}
                  </article>
                ))
              )}
            </div>
            {!loading && !error && !displayed.length ? (
              <div className="menu-category-empty rawcat-empty" role="status">
                <Icon name="bi-inbox" />
                <span>{t(showArchived ? "pages.nomenclature.raw_categories_archive_empty" : "pages.nomenclature.raw_categories_empty")}</span>
              </div>
            ) : null}
          </div>
        ) : (
        <div className={`menu-category-list${isMenuCategories ? " dishcat-list" : ""}`} ref={categoryListRef} tabIndex={isMenuCategories ? 0 : undefined} aria-busy={loading}>
          {loading && rows.length === 0
            ? Array.from({ length: 6 }, (_, index) => <div className="menu-category-row is-loading" key={index} />)
            : isMenuCategories && !showArchived ? (
              // REORDER V1: sortable только таб Активные (dish+sales ветка 1:1).
              // DndContext/SortableContext не добавляют DOM-обёрток — строки
              // остаются прямыми детьми grid-контейнера .dishcat-list; их
              // a11y-live-region визуально скрыта (display:none/fixed) и
              // грид-треков не создаёт.
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={({ active }) => setDraggedCategory(displayed.find((row) => String(row.id) === String(active.id)) || null)}
                onDragCancel={() => setDraggedCategory(null)}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={displayed.map((row) => String(row.id))}
                  strategy={verticalListSortingStrategy}
                >
                  {displayed.map((row) => (
                    <SortableDishCategoryRow
                      key={row.id}
                      row={row}
                      reducedMotion={reducedMotion}
                      disabled={savingOrder}
                      onEdit={openEdit}
                      onArchive={openArchiveConfirm}
                    />
                  ))}
                </SortableContext>
                {createPortal(
                  <DragOverlay zIndex={100010} dropAnimation={reducedMotion ? null : undefined}>
                    {draggedCategory ? (
                      <div className="menu-categories-page is-dish-categories dishcat-drag-overlay">
                        <DishCategoryRow row={draggedCategory} reducedMotion={reducedMotion} overlay />
                      </div>
                    ) : null}
                  </DragOverlay>,
                  document.body,
                )}
              </DndContext>
            ) : displayed.map((row) =>
                isMenuCategories ? (
                  // Архивный таб меню-категорий: прежняя разметка 1:1, без grip —
                  // архивный порядок не редактируется drag-and-drop.
                  <article className="menu-category-row dishcat-row" key={row.id}>
                    <div className="dishcat-main">
                      <div className="dishcat-info">
                        <strong>{row.name}</strong>
                      </div>
                    </div>
                    <div className="dishcat-meta">
                      <span
                        className={`dishcat-service-badge ${row.calculate_service === true ? "is-on" : "is-off"}`}
                      >
                        <span className="dishcat-service-badge__dot" aria-hidden="true" />
                       {t("pages.categoriespage.rasschitat_obslugu")}
                      </span>
                      <DishCategoryStatusBadge active={row.is_active !== false} />
                      <button
                        type="button"
                        className="settings-action-restore"
                        onClick={() => restoreCategory(row)}
                        disabled={restoringId === row.id}
                        aria-label={t("pages.categoriespage.vosstanovit_kategoriyu")}
                        title={t("pages.categoriespage.vosstanovit_kategoriyu")}
                      >
                        <Icon name="bi-arrow-counterclockwise" size={15} />
                      </button>
                      <button
                        type="button"
                        className="settings-action-delete"
                        onClick={() => openDeleteConfirm(row)}
                        aria-label={t("pages.categoriespage.udalit_okonchatelno")}
                        title={t("pages.categoriespage.udalit_okonchatelno")}
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
                    <button type="button" className="menu-category-image" aria-label={t("pages.categoriespage.izobrazhenie_kategorii")}>
                      <Icon name="bi-image" />
                    </button>
                    <button type="button" className="menu-category-service">
                     {t("pages.categoriespage.rasschitat_obslugu")}
                    </button>
                    <span className={`menu-category-status ${row.is_active === false ? "is-muted" : ""}`}>
                      {row.is_active === false ? "#архив" : "#активно"}
                    </span>
                    <button type="button" className="menu-category-icon edit" onClick={() => openEdit(row)} aria-label={t("pages.categoriespage.izmenit")}>
                      <Icon name="bi-pencil" />
                    </button>
                    <button type="button" className="menu-category-icon delete" onClick={() => openDeleteConfirm(row)} aria-label={t("pages.categoriespage.udalit")}>
                      <Icon name="bi-trash3" />
                    </button>
                  </article>
                ),
              )}

          {!loading && !error && !displayed.length ? (
            <div className="menu-category-empty">
              <Icon name="bi-inbox" />
              <span>{t(showArchived && isMenuCategories ? "pages.nomenclature.categories_archive_empty" : "pages.nomenclature.categories_empty")}</span>
            </div>
          ) : null}
        </div>
        )}
      </div>

      {deleteTarget && (isMenuCategories || isRawCategories)
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
                      <p>{t("pages.categoriespage.udalenie")}</p>
                      <h2 id="dishcat-delete-title">{t("pages.categoriespage.udalit_kategoriyu_navsegda")}</h2>
                    </div>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => setDeleteTarget(null)}
                      aria-label={t("pages.categoriespage.zakryt")}
                    >
                      <Icon name="bi-x-lg" size={20} />
                    </button>
                  </header>
                  <p className="settings-form__context">
                   {t("pages.categoriespage.kategoriya")} <strong>«{deleteTarget.name}»</strong> {t("pages.categoriespage.budet_udalena_bez_vozmozhnosti_vosstanovleniya")}
                  </p>
                  {deleteError ? (
                    <p className="settings-form__error" role="alert">
                      {deleteError}
                    </p>
                  ) : null}
                  <footer className="settings-form__footer">
                    <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>
                     {t("pages.categoriespage.otmena")}
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

      {archiveTarget && (isMenuCategories || isRawCategories)
        ? createPortal(
            <div className="settings-owner-view dishcat-modal-layer">
              <div className="settings-drawer settings-modal-overlay" role="presentation">
                <div
                  className="settings-drawer__backdrop"
                  onClick={archiving ? undefined : () => setArchiveTarget(null)}
                />
                <form
                  className="settings-form settings-modal dishcat-confirm"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="dishcat-archive-title"
                  onSubmit={(event) => {
                    event.preventDefault();
                    confirmArchive();
                  }}
                >
                  <header className="settings-form__header">
                    <span className="settings-accent-bar" />
                    <div>
                      <p>{t("pages.categoriespage.arhivatsiya")}</p>
                      <h2 id="dishcat-archive-title">{t("pages.categoriespage.arhivirovat_kategoriyu_2")}</h2>
                    </div>
                    <button
                      type="button"
                      disabled={archiving}
                      onClick={() => setArchiveTarget(null)}
                      aria-label={t("pages.categoriespage.zakryt")}
                    >
                      <Icon name="bi-x-lg" size={20} />
                    </button>
                  </header>
                  <p className="settings-form__context">
                   {t("pages.categoriespage.kategoriya")} <strong>«{archiveTarget.name}»</strong> {t("pages.categoriespage.budet_peremeschena_v_arhiv")}
                  </p>
                  {archiveError ? (
                    <p className="settings-form__error" role="alert">
                      {archiveError}
                    </p>
                  ) : null}
                  <footer className="settings-form__footer">
                    <button type="button" disabled={archiving} onClick={() => setArchiveTarget(null)}>
                     {t("pages.categoriespage.otmena")}
                    </button>
                    <button
                      type="submit"
                      className="dishcat-confirm__archive"
                      disabled={archiving}
                    >
                      {archiving ? "Архивация..." : "Архивировать"}
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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { nomenclatureService } from "../../api/nomenclature";
import { catalogService } from "../../api/catalog";
import { settingsService } from "../../api/settings";
import { unitDisplayLabel, unitOptionLabel } from "./nomenclatureData";
import Icon from "../../components/Icon";
import ReportEmptyState from "../../components/ReportEmptyState";
import DishSingleSelect from "./DishSingleSelect";
import RawIngredientDishesDialog, { IngredientDishesBadge } from "./RawIngredientDishesDialog";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import "../../styles/owner/raw-materials.css";

// Ед.изм — ТОЛЬКО живой справочник Настройки → Единицы (GET /units),
// тот же источник, что у дровера блюд. Хардкода нет: «упак» и прочий
// мусор из старого UNITS-списка сюда попасть не может. Ошибка →
// честный disabled «Единицы измерения недоступны» (паттерн блюд).
const EMPTY_FORM = { name: "", unit: "", category: "", avg_quantity: "", deficit_threshold: "", loss_type: "", loss_value: "" };
const LOSS_TYPE_OPTIONS = [
  { value: "percent", label: "Процент" },
  { value: "amount", label: "Количество" },
];

// Сервер хранит Numeric(15,4): «0.1» возвращается как «0.1000».
// Показываем как введено: 0.1000 → 0.1, 10.5000 → 10.5.
function formatLossValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (text === "") return "";
  const num = Number(text.replace(",", "."));
  if (!Number.isFinite(num)) return text;
  return String(num);
}

// Норма потерь в таблице: «10%» для процента, «0,1 кг» для количества.
// Нет пары (тип+значение) — пусто, колонка показывает честный прочерк.
function lossLabelOf(row) {
  const type = String(row?.loss_type || "").trim();
  const value = formatLossValue(row?.loss_value);
  if (!type || value === "") return "";
  const text = value.replace(".", ",");
  return type === "percent" ? `${text}%` : `${text}${row?.unit ? ` ${row.unit}` : ""}`;
}
const EMPTY_FILTERS = { search: "", category: "" };

// Продукты — это ШАБЛОНЫ продуктов (карточка: название, категория, ед. изм).
// CRUD против /inventory/ingredients; жёсткого DELETE нет — «удаление» =
// мягкий архив (is_active:false), поэтому есть вкладки активные/архив и
// действия архивировать/восстановить. Остатков и цен закупки здесь НЕТ:
// остаток и себестоимость живут только в складских движениях и появляются
// после прихода (раздел «Добавить продуктов»). Карточка движений не создаёт.
// V2: визуальная семья Dishes (header/controls/filter/table/scroll/empty) —
// те же классы dish-catalog-*, dish-status-tabs, dish-filter-*, dish-grid-*,
// поэтому геометрия/анимация/палитра берутся из живого эталона без копирования
// CSS. Бизнес-колонки и контракт сырья сохранены 1:1.
export default function RawMaterialsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Exit-анимация drawer (is-closing → unmount, 240мс как у блюда).
  const [drawerClosing, setDrawerClosing] = useState(false);
  const closeTimer = useRef(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);
  // Фильтры по паттерну Dishes/Reports: черновик правится в панели,
  // таблица зависит только от применённых filters. Закрытие панели
  // черновик не сбрасывает. Без localStorage.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [categoriesUnavailable, setCategoriesUnavailable] = useState(false);
  const [unitOptions, setUnitOptions] = useState([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsUnavailable, setUnitsUnavailable] = useState(false);
  const [statusOn, setStatusOn] = useState(true);
  const [products, setProducts] = useState([]);
  const [productsError, setProductsError] = useState("");
  const [usageIngredient, setUsageIngredient] = useState(null);
  const usageTriggerRef = useRef(null);
  // Зеркало текста поля потери: меряем ширину значения и ставим суффикс
  // (% / ед. изм) вплотную к нему («0.1 Лт», а не у правого края поля).
  const lossMirrorRef = useRef(null);
  const [lossSuffixX, setLossSuffixX] = useState(null);
  const beginRequest = useLatestRequest();
  const beginCategoryRequest = useLatestRequest();
  const beginProductsRequest = useLatestRequest();
  const { acquire, release } = useMutationLocks();

  // Скользящий индикатор таблов — тот же механизм, что у Блюд:
  // измеренный offsetLeft/offsetWidth активного сегмента → translateX/width,
  // transition 250ms MARJON ease из dishes.css.
  const tabsRef = useRef(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });
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
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    fonts?.ready.then(update).catch(() => {});
    fonts?.addEventListener?.("loadingdone", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      fonts?.removeEventListener?.("loadingdone", update);
    };
  }, [showArchived]);

  async function load() {
    const request = beginRequest();
    setLoading(true);
    setError("");
    try {
      const { data } = await nomenclatureService.listIngredients({ signal: request.signal });
      if (!request.isCurrent()) return;
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!request.isCurrent() || isAbortError(err)) return;
      setRows([]);
      setError(err.response?.data?.detail || "Не удалось загрузить продукты.");
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Реальные категории сырья из общей таблицы /inventory/categories
  // (slug startswith "raw", тот же источник, что у CategoriesPage type=raw).
  // Плюс честное объединение с distinct строк ingredient.category,
  // чтобы ранее введённый free-text не терялся. Без выдуманных имён:
  // ошибка → пусто + флаг.
  useEffect(() => {
    const request = beginCategoryRequest();
    setCategoriesUnavailable(false);
    catalogService.listCategories({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        const namespaced = items.filter((item) => String(item?.slug || "").startsWith("raw"));
        const names = namespaced
          .map((item) => String(item?.name || "").trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, "ru"));
        setCategoryOptions(names);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setCategoryOptions([]);
        setCategoriesUnavailable(true);
      });
  }, [beginCategoryRequest]);

  // Блюда для колонки «Блюда» и диалога использования: канонический
  // GET /inventory/products?include_all=true (тот же источник, что у
  // каталога блюд). Счётчики и строки диалога считаются клиентом из
  // product.ingredients — отдельного backend-эндпоинта нет. Ошибка →
  // пусто + текст (бейдж остаётся нейтральным «Блюда»).
  useEffect(() => {
    const request = beginProductsRequest();
    setProductsError("");
    catalogService.listProducts({ signal: request.signal, params: { include_all: true } })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        setProducts(items);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setProducts([]);
        setProductsError(err.response?.data?.detail || "Не удалось загрузить блюда.");
      });
  }, [beginProductsRequest]);

  const visibleCategoryOptions = useMemo(() => {
    const set = new Set(categoryOptions);
    rows.forEach((row) => {
      const value = String(row?.category || "").trim();
      if (value) set.add(value);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [categoryOptions, rows]);

  const visible = useMemo(() => {    const searchTerm = String(filters.search || "").trim().toLowerCase();
    const categoryTerm = String(filters.category || "").trim().toLowerCase();
    return rows
      .filter((row) => (showArchived ? row.is_active === false : row.is_active !== false))
      .filter((row) => {
        if (searchTerm) {
          const haystack = `${row.name || ""} ${row.category || ""}`.toLowerCase();
          if (!haystack.includes(searchTerm)) return false;
        }
        if (categoryTerm && String(row.category || "").toLowerCase() !== categoryTerm) return false;
        return true;
      });
  }, [rows, filters, showArchived]);

  // Использование сырья: ingredient_id → строки {product_id, quantity}
  // из product.ingredients всех блюд (включая архивные — диалог их
  // помечает, селект добавления даёт только активные).
  const usageByIngredient = useMemo(() => {
    const map = new Map();
    (Array.isArray(products) ? products : []).forEach((product) => {
      if (!product?.id) return;
      const list = Array.isArray(product.ingredients) ? product.ingredients : [];
      list.forEach((line) => {
        const key = String(line?.ingredient_id || "");
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ product_id: String(product.id), quantity: Number(line?.quantity) || 0 });
      });
    });
    return map;
  }, [products]);

  function openCreate() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setDrawerClosing(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setStatusOn(true);
    setActionError("");
    setDrawerOpen(true);
    loadDrawerRefs();
  }

  function loadDrawerRefs() {
    // Шаблону склады не нужны: остаток/порог задаются только приходом
    // («Добавить продуктов»), движений отсюда больше нет.
    setUnitsLoading(true);
    setUnitsUnavailable(false);
    settingsService.listResource("units")
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        const live = items
          .filter((item) => item?.id && typeof item.status === "boolean" && unitDisplayLabel(item))
          .sort((a, b) => (
            Number(a.sort ?? a.sort_order ?? 0) - Number(b.sort ?? b.sort_order ?? 0)
            || unitDisplayLabel(a).localeCompare(unitDisplayLabel(b), "ru")
          ))
          .map((item) => ({
            id: String(item.id),
            // value — короткое имя (канон хранения), label — «Килограмм (Кг)».
            value: unitDisplayLabel(item),
            label: unitOptionLabel(item),
            active: item.status !== false,
          }));
        setUnitOptions(live);
      })
      .catch(() => {
        setUnitOptions([]);
        setUnitsUnavailable(true);
      })
      .finally(() => setUnitsLoading(false));
  }

  function openEdit(row) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setDrawerClosing(false);
    setEditing(row);
    setForm({
      name: row.name || "",
      unit: row.unit || "",
      category: row.category || "",
      avg_quantity: formatLossValue(row.avg_quantity),
      deficit_threshold: formatLossValue(row.deficit_threshold),
      loss_type: row.loss_type || "",
      loss_value: formatLossValue(row.loss_value),
    });
    setStatusOn(row.is_active !== false);
    setActionError("");
    setDrawerOpen(true);
    loadDrawerRefs();
  }

  function requestCloseDrawer() {
    if (saving || !drawerOpen || drawerClosing) return;
    setDrawerClosing(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(finishCloseDrawer, 240);
  }

  function finishCloseDrawer() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setDrawerOpen(false);
    setDrawerClosing(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setActionError("Укажите название.");
      return;
    }
    if (!String(form.unit || "").trim()) {
      setActionError("Выберите единицу измерения.");
      return;
    }
    // Нормы остатка — справочные: пустое поле сохраняется как NULL, а не
    // блокирует карточку (порог дефицита есть не у каждого продукта).
    const parseNorm = (raw) => {
      const text = String(raw ?? "").trim().replace(",", ".");
      if (text === "") return { empty: true };
      const parsed = Number(text);
      if (!Number.isFinite(parsed) || parsed < 0) return { invalid: true };
      return { value: parsed };
    };
    const avgNorm = parseNorm(form.avg_quantity);
    if (avgNorm.invalid) {
      setActionError("Среднее количество — неотрицательное число.");
      return;
    }
    const deficitNorm = parseNorm(form.deficit_threshold);
    if (deficitNorm.invalid) {
      setActionError("Порог дефицита — неотрицательное число.");
      return;
    }
    if (!acquire("ingredient-save")) return;
    // Норма потерь для отчётного авто-отхода: тип + значение только парой.
    // Пустое значение при выбранном типе — это «нормы нет», а не ошибка:
    // иначе карточку нельзя сохранить, не выдумав число.
    const lossType = form.loss_type || null;
    let lossValue = null;
    const rawLoss = String(form.loss_value ?? "").trim().replace(",", ".");
    if (rawLoss !== "") {
      const parsed = Number(rawLoss);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setActionError("Значение потери — неотрицательное число.");
        release("ingredient-save");
        return;
      }
      if ((lossType || "") === "percent" && parsed > 100) {
        setActionError("Процент потери — от 0 до 100.");
        release("ingredient-save");
        return;
      }
      lossValue = parsed;
    }
    // Значение без типа — потерять его молча нельзя: норма хранится парой
    // (тип, значение), а «0.3» само по себе не говорит, проценты это или кг.
    // Пустое значение при выбранном типе — наоборот, законное «нормы нет».
    if (lossValue !== null && !lossType) {
      setActionError("Выберите тип потери.");
      release("ingredient-save");
      return;
    }
    const hasLossNorm = Boolean(lossType) && lossValue !== null;
    // Только карточка шаблона: название, категория, ед. изм. Остаток и цена
    // закупки здесь не задаются — они появляются из складских движений
    // после прихода («Добавить продуктов»).
    const payload = {
      name: form.name.trim(),
      unit: form.unit,
      category: form.category.trim() || null,
      avg_quantity: avgNorm.empty ? null : avgNorm.value,
      deficit_threshold: deficitNorm.empty ? null : deficitNorm.value,
      loss_type: hasLossNorm ? lossType : null,
      loss_value: hasLossNorm ? lossValue : null,
    };
    setSaving(true);
    setActionError("");
    let ok = false;
    try {
      if (editing) {
        const { data } = await nomenclatureService.updateIngredient(editing.id, {
          ...payload,
          is_active: statusOn,
        });
        setRows((cur) => cur.map((r) => (r.id === editing.id ? { ...r, ...(data || payload) } : r)));
        await load();
      } else {
        const { data } = await nomenclatureService.createIngredient(payload);
        const createdId = data?.id;
        if (!statusOn && createdId) {
          await nomenclatureService.updateIngredient(createdId, { is_active: false });
        }
        await load();
      }
      ok = true;
    } catch (err) {
      setActionError(err.response?.data?.detail || err.message || "Не удалось сохранить ингредиент.");
    } finally {
      setSaving(false);
      release("ingredient-save");
    }
    if (ok) requestCloseDrawer();
  }

  async function toggleArchive(row) {
    if (!acquire(`ingredient-${row.id}`)) return;
    setBusyId(row.id);
    setActionError("");
    const archiving = row.is_active !== false;
    try {
      const { data } = archiving
        ? await nomenclatureService.archiveIngredient(row.id)
        : await nomenclatureService.restoreIngredient(row.id);
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, ...(data || { is_active: !archiving }) } : r)));
    } catch (err) {
      setActionError(err.response?.data?.detail || "Не удалось изменить статус ингредиента.");
    } finally {
      setBusyId(null);
      release(`ingredient-${row.id}`);
    }
  }

  // Привязка/отвязка сырья к блюду из диалога «Блюда»: тот же канонический
  // PATCH /inventory/products/{id} {ingredients}, что saveRecipe у блюд
  // (None=leave, []=clear, list=replace). Кэш блюд обновляет onChanged.
  async function saveDishUsage(productId, lines) {
    const payload = (Array.isArray(lines) ? lines : [])
      .map((line) => ({
        ingredient_id: line.ingredient_id,
        quantity: Number(line.quantity),
        warehouse_id: line.warehouse_id || null,
      }))
      .filter((line) => line.ingredient_id && Number.isFinite(line.quantity) && line.quantity > 0);
    const { data } = await catalogService.updateProduct(productId, { ingredients: payload });
    if (!data?.id) throw new Error("Backend не вернул обновлённый продукт.");
    return data;
  }

  function mergeProduct(productId, fresh) {
    if (!fresh || !fresh.id) return;
    setProducts((current) => current.map((item) => (
      String(item.id) === String(productId)
        ? {
          ...item,
          ingredients: fresh.ingredients ?? item.ingredients,
          ingredients_count: fresh.ingredients_count ?? item.ingredients_count,
        }
        : item
    )));
  }

  function applyFilters() {
    setFilters({ ...draftFilters });
    setFiltersOpen(false);
  }
  function clearFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setFiltersOpen(false);
  }

  const isEmpty = !loading && !error && visible.length === 0;
  const emptyTitle = showArchived ? "Архив продуктов пуст." : "Продукты пока не добавлены.";

  // Живые единицы + неслетаемое текущее значение (legacy free-text из
  // старых строк дописывается как неактивное — паттерн архивных
  // категорий/единиц у блюд). Дедуп по value (короткому имени): value
  // селекта — короткое имя, подпись — «Килограмм (Кг)».
  const selectableUnits = useMemo(() => {
    const seen = new Set();
    const list = [];
    unitOptions.forEach((item) => {
      if (!item?.value || seen.has(item.value)) return;
      seen.add(item.value);
      if (item.active || item.value === form.unit) list.push(item);
    });
    if (form.unit && !seen.has(form.unit)) {
      list.push({ id: "legacy", value: form.unit, label: form.unit, active: false });
    }
    return list;
  }, [unitOptions, form.unit]);

  // Подпись и суффикс поля потери: «Количество» → «Потери» + ед. изм
  // («0.1 Лт»), «Процент» → суффикс «%» («10%»).
  // Без выбранного типа суффикса нет — появляется только после выбора типа.
  const lossLabel = form.loss_type === "amount" ? "Потери" : form.loss_type === "percent" ? "Процент потери" : "Значение потери";
  const lossSuffix = form.loss_type === "percent" ? "%" : form.loss_type === "amount" ? form.unit : "";
  const lossValueText = form.loss_value === null || form.loss_value === undefined ? "" : String(form.loss_value);

  useLayoutEffect(() => {
    if (!drawerOpen || !lossSuffix) return;
    const mirror = lossMirrorRef.current;
    if (mirror) setLossSuffixX(mirror.offsetWidth);
  }, [drawerOpen, lossSuffix, form.loss_value]);

  return (
    <section className="nomenclature-page dish-catalog-page owner-report-view raw-materials-page">
      <section className="dish-catalog-card owner-report-surface settings-card">
        <header className="settings-header dish-catalog-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" aria-hidden="true" />
            <div>
              <p>Склад</p>
              <h1>Продукты</h1>
            </div>
          </div>
          <div className="settings-actions dish-header-actions">
            <div className="dish-status-tabs" role="tablist" aria-label="Статус продуктов" ref={tabsRef}>
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
                Активные
              </button>
              <button
                type="button"
                role="tab"
                data-tab="archived"
                aria-selected={showArchived}
                className={showArchived ? "is-active" : ""}
                onClick={() => setShowArchived(true)}
              >
                Архивированные
              </button>
            </div>
            <button
              type="button"
              className="dishes-filter-toggle"
              aria-expanded={filtersOpen}
              aria-controls="raw-materials-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Icon name="bi-sliders" size={17} /> Фильтровать
            </button>
            <button type="button" className="dish-add-button" onClick={openCreate}>
              <Icon name="bi-plus" size={18} /> Добавить
            </button>
          </div>
        </header>

        {actionError ? <div className="login-error" role="alert">{actionError}</div> : null}

        <div className={`orders-filter-collapse dish-filter-collapse raw-filter-collapse${filtersOpen ? " is-open" : ""}`}>
          <div className="orders-filter-collapse__inner" inert={!filtersOpen ? true : undefined}>
            <div className="report-filters-grid dish-filter-panel raw-filter-panel" id="raw-materials-filters" aria-label="Фильтры продуктов">
              <label className="report-filter-input">
                <Icon name="bi-search" size={17} />
                <input
                  aria-label="Поиск продуктов"
                  value={draftFilters.search}
                  onChange={(event) => setDraftFilters((prev) => ({ ...prev, search: event.target.value }))}
                  placeholder="Поиск продуктов"
                />
              </label>
              <DishSingleSelect
                label="Категория продуктов"
                placeholder="Выберите категорию"
                options={visibleCategoryOptions.map((name) => ({ value: name, label: name }))}
                value={visibleCategoryOptions.includes(draftFilters.category) ? draftFilters.category : ""}
                onChange={(next) => setDraftFilters((prev) => ({ ...prev, category: next || "" }))}
                disabled={categoriesUnavailable && visibleCategoryOptions.length === 0}
                disabledLabel="Категории недоступны"
              />
              <div className="report-filter-buttons dish-filter-actions">
                <button type="button" className="report-filter-apply" onClick={applyFilters}>
                  <Icon name="bi-sliders" size={17} /> Фильтровать
                </button>
                <button type="button" className="report-filter-clear" onClick={clearFilters}>
                  <Icon name="bi-x-circle" size={17} /> Очистить
                </button>
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="login-error" role="alert">{error}</div>
        ) : (
          <div className={`settings-table-wrapper dish-grid-wrap raw-grid-wrap${isEmpty ? " is-empty" : ""}`}>
            <div className="dish-grid-scroll" role="region" aria-label="Таблица продуктов с прокруткой" tabIndex={0}>
              <table className="settings-table dish-grid-table raw-grid-table" aria-label="Продукты">
                <thead>
                  <tr>
                    <th className="raw-col-num">№</th>
                    <th className="raw-col-name">Название</th>
                    <th className="raw-col-category">Категория</th>
                    <th className="raw-col-unit">Ед. изм</th>
                    <th className="raw-col-dishes">Блюда</th>
                    <th className="raw-col-loss">Потери</th>
                    <th className="raw-col-status">Статус</th>
                    <th className="raw-col-actions">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td className="raw-empty-cell" colSpan={8} role="status" aria-busy="true">Загрузка…</td></tr>
                  ) : (
                    visible.map((row, index) => (
                      <tr key={row.id}>
                        <td className="raw-col-num">{index + 1}</td>
                        <td className="raw-col-name"><span className="raw-name-text" title={row.name}>{row.name}</span></td>
                        <td className="raw-col-category">{row.category ? <span className="raw-category-badge">{row.category}</span> : "—"}</td>
                        <td className="raw-col-unit">{row.unit || "—"}</td>
                        <td className="raw-col-dishes">
                          <IngredientDishesBadge
                            count={(usageByIngredient.get(String(row.id)) || []).length}
                            onClick={(event) => {
                              usageTriggerRef.current = event.currentTarget;
                              setUsageIngredient(row);
                            }}
                          />
                        </td>
                        <td className="raw-col-loss">{lossLabelOf(row) || <span className="raw-loss-empty">—</span>}</td>
                        <td className="raw-col-status"><span className={`raw-status-badge ${row.is_active === false ? "is-archived" : ""}`}>{row.is_active === false ? "Архив" : "Активно"}</span></td>
                        <td className="raw-col-actions">
                          <div className="dish-row-actions">
                            <button type="button" onClick={() => openEdit(row)} disabled={busyId === row.id} aria-label="Редактировать">
                              <Icon name="bi-pencil" size={15} />
                            </button>
                            {row.is_active === false ? (
                              <button type="button" className="dish-restore-action" onClick={() => toggleArchive(row)} disabled={busyId === row.id} aria-label="Восстановить" title="Восстановить">
                                <Icon name="bi-arrow-counterclockwise" size={15} />
                              </button>
                            ) : (
                              <button type="button" className="danger" onClick={() => toggleArchive(row)} disabled={busyId === row.id} aria-label="Архивировать" title="Архивировать">
                                <Icon name="bi-trash3" size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {isEmpty ? (
              <div className="dish-empty-overlay">
                <ReportEmptyState title={emptyTitle} />
              </div>
            ) : null}
          </div>
        )}
      </section>

      {drawerOpen ? createPortal(
        <div
          className={`staff-modal staff-modal--cashier-full dish-drawer${drawerClosing ? " is-closing" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={editing ? "Редактировать продукты" : "Добавить продукты"}
        >
          <div className="staff-modal__backdrop" onClick={requestCloseDrawer} />
          <form className="staff-form staff-form--cashier" onSubmit={save}>
            <div className="staff-form__header">
              <div>
                <p>{editing ? "Редактирование" : "Новые продукты"}</p>
                <h2>{editing ? "Редактировать продукты" : "Добавить продукты"}</h2>
              </div>
              <button type="button" disabled={saving} onClick={requestCloseDrawer} aria-label="Закрыть"><Icon name="bi-x-lg" size={20} /></button>
            </div>
            <div className="dish-drawer__body">
              <div className="staff-form__grid">
                <label className="staff-form__comment dish-name-field">
                  <span>Название</span>
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Напр. Помидор" />
                </label>
                <div className="dish-form-field">
                  <span className="dish-form-field__label" aria-hidden="true">Ед. изм</span>
                  <DishSingleSelect
                    label="Ед. изм"
                    placeholder="Выберите ед. изм"
                    options={selectableUnits.map((item) => ({
                      value: item.value,
                      label: item.active ? item.label : `${item.label} (не активна)`,
                    }))}
                    value={selectableUnits.some((item) => item.value === form.unit) ? form.unit : ""}
                    onChange={(next) => setForm((f) => ({ ...f, unit: next || "" }))}
                    disabled={unitsUnavailable || saving}
                    loading={unitsLoading}
                    disabledLabel="Единицы измерения недоступны"
                  />
                </div>
                <div className="dish-form-field">
                  <span className="dish-form-field__label" aria-hidden="true">Категория</span>
                  <DishSingleSelect
                    label="Категория"
                    placeholder="Категория"
                    options={visibleCategoryOptions.map((name) => ({ value: name, label: name }))}
                    value={visibleCategoryOptions.includes(form.category) ? form.category : ""}
                    onChange={(next) => setForm((f) => ({ ...f, category: next || "" }))}
                    disabled={(visibleCategoryOptions.length === 0 && !form.category) || saving}
                    disabledLabel="Категории недоступны"
                  />
                </div>
                <div className="dish-form-field">
                  <span className="dish-form-field__label" aria-hidden="true">Среднее количество</span>
                  <div className="dish-form-field__wrap">
                    <input
                      className="dish-form-field__input"
                      aria-label="Среднее количество"
                      value={form.avg_quantity}
                      onChange={(e) => setForm((f) => ({ ...f, avg_quantity: e.target.value }))}
                      placeholder="Среднее количество"
                      disabled={saving}
                      inputMode="decimal"
                    />
                  </div>
                </div>
                <div className="dish-form-field">
                  <span className="dish-form-field__label" aria-hidden="true">Порог дефицита</span>
                  <div className="dish-form-field__wrap">
                    <input
                      className="dish-form-field__input"
                      aria-label="Порог дефицита"
                      value={form.deficit_threshold}
                      onChange={(e) => setForm((f) => ({ ...f, deficit_threshold: e.target.value }))}
                      placeholder="Порог дефицита"
                      disabled={saving}
                      inputMode="decimal"
                    />
                  </div>
                </div>
                <div className="dish-form-field">
                  <span className="dish-form-field__label" aria-hidden="true">Тип потери</span>
                  <DishSingleSelect
                    label="Тип потери"
                    placeholder="Выберите тип"
                    options={LOSS_TYPE_OPTIONS}
                    value={form.loss_type}
                    onChange={(next) => setForm((f) => ({ ...f, loss_type: next || "" }))}
                    disabled={saving}
                  />
                </div>
                <div className="dish-form-field">
                  <span className="dish-form-field__label" aria-hidden="true">{lossLabel}</span>
                  <div className="dish-form-field__wrap">
                    <input
                      className="dish-form-field__input"
                      aria-label={lossLabel}
                      value={form.loss_value}
                      onChange={(e) => setForm((f) => ({ ...f, loss_value: e.target.value }))}
                      placeholder={form.loss_type === "amount" ? "Например: 0.2 (на 1 кг)" : form.loss_type === "percent" ? "Например: 10" : "Значение потери"}
                      disabled={!form.loss_type || saving}
                      inputMode="decimal"
                    />
                    {lossSuffix ? <span ref={lossMirrorRef} className="dish-form-field__mirror" aria-hidden="true">{lossValueText}</span> : null}
                    {lossSuffix ? (
                      <span
                        className="dish-form-field__suffix"
                        aria-hidden="true"
                        style={lossValueText !== "" && lossSuffixX ? { left: lossSuffixX + 6, right: "auto" } : undefined}
                      >
                        {lossSuffix}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="dish-form-switches">
                <div className="dish-form-switch-row">
                  <span className="dish-form-switch-label">Статус</span>
                  <div className="dish-form-switch-control">
                    <button
                      type="button"
                      role="switch"
                      aria-label="Статус"
                      aria-checked={statusOn}
                      className={`dish-form-switch${statusOn ? " is-on" : ""}`}
                      disabled={saving}
                      onClick={() => setStatusOn((v) => !v)}
                    >
                      <span aria-hidden="true" />
                    </button>
                    <span className={`dish-form-status${statusOn ? " is-active" : ""}`}>
                      {statusOn ? "Активен" : "Неактивен"}
                    </span>
                  </div>
                </div>
              </div>
              {actionError ? <div className="login-error" role="alert">{actionError}</div> : null}
            </div>
            <div className="staff-form__footer">
              <button type="button" onClick={requestCloseDrawer} disabled={saving}>Отменить</button>
              <button type="submit" disabled={saving || !form.name.trim()}>{saving ? "Сохранение…" : editing ? "Сохранить" : "Добавить"}</button>
            </div>
          </form>
        </div>,
        document.body,
      ) : null}

      {usageIngredient ? (
        <RawIngredientDishesDialog
          ingredient={usageIngredient}
          products={products}
          productsError={productsError}
          onClearProductsError={() => setProductsError("")}
          onClose={() => setUsageIngredient(null)}
          returnFocusRef={usageTriggerRef}
          onSave={saveDishUsage}
          onChanged={(productId, fresh) => mergeProduct(productId, fresh)}
        />
      ) : null}
    </section>
  );
}

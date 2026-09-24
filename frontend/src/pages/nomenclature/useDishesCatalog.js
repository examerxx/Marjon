// Вся кросс-секционная логика каталога блюд OWNER: загрузка, фильтры, форма,
// настройки колонок и мутации. Вынесено из NomenclaturePage.jsx (FE-07B)
// без ослабления FE-06 safety (AbortController/useLatestRequest, замки мутаций,
// stale-response ownership, unmount safety, числовой парсинг сохранены 1:1).
import { useEffect, useMemo, useState } from "react";
import { catalogService } from "../../api/catalog";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import { defaultDishColumnVisibility, dishColumnOptions, emptyDishForm } from "./nomenclatureConfig";
import {
  buildNomenclatureProductPayload,
  mapNomenclatureProduct,
  matchesDishStatFilter,
  parseNomenclatureMoney,
  parseNomenclatureSort,
} from "./nomenclatureData";

export function useDishesCatalog() {
  const [rows, setRows] = useState([]);
  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [draftFilters, setDraftFilters] = useState({ search: "", chef: "", category: "" });
  const [filters, setFilters] = useState(draftFilters);
  const [statFilter, setStatFilter] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [photoPicker, setPhotoPicker] = useState(null);
  const [photoSearch, setPhotoSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...emptyDishForm });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(defaultDishColumnVisibility);
  // Добавки (модификаторы) редактируемого блюда: список групп, загрузка/ошибка.
  const [modGroups, setModGroups] = useState([]);
  const [modLoading, setModLoading] = useState(false);
  const [modError, setModError] = useState("");
  const beginRequest = useLatestRequest();
  const { acquire, release } = useMutationLocks();

  const visibleColumnKeys = useMemo(
    () => dishColumnOptions.filter((column) => visibleColumns[column.key] !== false).map((column) => column.key),
    [visibleColumns],
  );
  const tableMinWidth = useMemo(() => {
    const width = dishColumnOptions.reduce((sum, column) => (
      visibleColumns[column.key] !== false ? sum + column.width : sum
    ), 0);
    return Math.max(760, width);
  }, [visibleColumns]);
  const visibleColumnCount = visibleColumnKeys.length;
  const isColumnVisible = (key) => visibleColumns[key] !== false;
  const toggleColumn = (key) => {
    setVisibleColumns((current) => {
      const checked = current[key] !== false;
      if (checked && visibleColumnCount <= 1) return current;
      return { ...current, [key]: !checked };
    });
  };

  useEffect(() => {
    const request = beginRequest();
    setApiLoading(true);
    setApiError("");
    catalogService.listProducts({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        const mapped = items.map(mapNomenclatureProduct);
        setRows(mapped);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setApiError(err.response?.data?.detail || "Не удалось загрузить каталог блюд.");
      })
      .finally(() => {
        if (request.isCurrent()) setApiLoading(false);
      });
  }, [beginRequest]);

  const computedStats = useMemo(() => {
    const total = rows.length;
    const dishes = rows.filter((r) => r.type === "Блюда").length;
    const realization = total - dishes;
    const withRecipe = rows.filter((r) => r.recipe && !r.recipe.includes("(0")).length;
    const withCost = rows.filter((r) => r.cost && r.cost !== "0 UZS" && r.cost !== "—").length;
    const withPrinter = rows.filter((r) => r.printer).length;
    return [
      { label: "Кол-во товаров", value: String(total), rows: [["Реализация", String(realization)], ["Блюда", String(dishes)]], icon: "bi-basket", tone: "blue" },
      { label: "Рецепт", value: String(total), rows: [["С рецептом", String(withRecipe)], ["Без рецепта", String(total - withRecipe)]], icon: "bi-journal-bookmark", tone: "green" },
      { label: "ИКПУ", value: "—", rows: [["Статус", "Данные недоступны"]], icon: "bi-card-heading", tone: "cyan" },
      { label: "Себестоимость", value: String(total), rows: [["Заполнен", String(withCost)], ["Не заполнен", String(total - withCost)]], icon: "bi-cash-coin", tone: "orange" },
      { label: "Принтер", value: String(total), rows: [["Подключен", String(withPrinter)], ["Не подключен", String(total - withPrinter)]], icon: "bi-printer", tone: "violet" },
    ];
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const searchMatch = !filters.search || row.name.toLowerCase().includes(filters.search.toLowerCase());
      const chefMatch = !filters.chef || row.chef === filters.chef;
      const categoryMatch = !filters.category || row.category === filters.category;
      const statMatch = !statFilter || matchesDishStatFilter(row, statFilter);
      return searchMatch && chefMatch && categoryMatch && statMatch;
    });
  }, [rows, filters, statFilter]);

  const updateRow = (id, key, value) => {
    void id;
    void key;
    void value;
    setActionError("Быстрое изменение недоступно: backend mutation contract не подключён.");
  };

  const openDrawer = (row = null) => {
    if (saving) return;
    setEditing(row);
    setForm(row || { ...emptyDishForm });
    setDrawerOpen(true);
    // Добавки существуют только у сохранённого блюда — подтягиваем их группы
    // при открытии редактирования; для нового блюда список пуст.
    setModGroups([]);
    setModError("");
    if (row?.id) loadModGroups(row.id);
  };

  const saveDish = async () => {
    if (!acquire("product-save")) return;
    const isUpdate = Boolean(editing);
    setActionError("");
    const name = String(form.name || "").trim();
    const sortOrder = parseNomenclatureSort(form.sort);
    const price = parseNomenclatureMoney(form.price);
    const costInput = String(form.cost ?? "").trim();
    const costPrice = parseNomenclatureMoney(form.cost);
    if (!name || !Number.isInteger(sortOrder) || sortOrder < 1 || price === null || price < 0 || (costInput && costPrice === null) || (costPrice !== null && costPrice < 0)) {
      setActionError("Заполните название и укажите корректные неотрицательные цену, себестоимость и порядок сортировки.");
      release("product-save");
      return;
    }
    const payload = buildNomenclatureProductPayload(form, { isUpdate });
    setSaving(true);
    try {
      const { data } = isUpdate
        ? await catalogService.updateProduct(editing.id, payload)
        : await catalogService.createProduct(payload);
      if (!data?.id) throw new Error("Backend не вернул сохранённый продукт.");
      const serverRow = mapNomenclatureProduct(data);
      setRows((current) => (
        isUpdate
          ? current.map((row) => (row.id === editing.id ? serverRow : row))
          : [serverRow, ...current]
      ));
    } catch (err) {
      const message = err.response?.data?.detail || err.message || "Ошибка сохранения";
      setActionError(message);
      window.alert(message);
      return;
    } finally {
      setSaving(false);
      release("product-save");
    }
    setDrawerOpen(false);
  };

  const archiveDish = async (id) => {
    const lockKey = `product-delete:${id}`;
    if (!acquire(lockKey)) return;
    setPendingDeleteId(id);
    try {
      await catalogService.deleteProduct(id);
    } catch (err) {
      window.alert(err.response?.data?.detail || "Ошибка удаления");
      return;
    } finally {
      setPendingDeleteId(null);
      release(lockKey);
    }
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  // --- Добавки (модификаторы) --------------------------------------------------
  async function loadModGroups(productId) {
    setModLoading(true);
    setModError("");
    try {
      const { data } = await catalogService.listModifierGroups(productId);
      setModGroups(Array.isArray(data) ? data : []);
    } catch (err) {
      setModError(err.response?.data?.detail || "Не удалось загрузить добавки.");
    } finally {
      setModLoading(false);
    }
  }

  // Сохранение группы: новая (без id) → create, существующая → update. После
  // ответа перезагружаем список, чтобы id новых опций пришли с сервера.
  async function saveModGroup(group) {
    if (!editing?.id) {
      setModError("Сначала сохраните блюдо, затем добавляйте добавки.");
      return;
    }
    const lockKey = `modgroup-save:${group.id || "new"}`;
    if (!acquire(lockKey)) return;
    setModError("");
    const modifiers = (group.modifiers || [])
      .map((m) => ({
        id: m.id || undefined,
        name: String(m.name || "").trim(),
        price_delta: Number(m.price_delta) || 0,
        is_default: Boolean(m.is_default),
        sort_order: Number(m.sort_order) || 0,
      }))
      .filter((m) => m.name);
    try {
      if (group.id) {
        await catalogService.updateModifierGroup(group.id, {
          name: String(group.name || "").trim(),
          min_select: Number(group.min_select) || 0,
          max_select: Math.max(1, Number(group.max_select) || 1),
          is_required: Boolean(group.is_required),
          show_in_pos: group.show_in_pos !== false,
          modifiers,
        });
      } else {
        await catalogService.createModifierGroup({
          product_id: editing.id,
          name: String(group.name || "").trim(),
          min_select: Number(group.min_select) || 0,
          max_select: Math.max(1, Number(group.max_select) || 1),
          is_required: Boolean(group.is_required),
          show_in_pos: group.show_in_pos !== false,
          modifiers,
        });
      }
      await loadModGroups(editing.id);
    } catch (err) {
      const message = err.response?.data?.detail || "Не удалось сохранить добавки.";
      setModError(message);
      window.alert(message);
    } finally {
      release(lockKey);
    }
  }

  async function removeModGroup(groupId) {
    if (!groupId) {
      // Несохранённая группа — просто убираем из локального списка.
      setModGroups((current) => current.filter((g) => g.id));
      return;
    }
    const lockKey = `modgroup-delete:${groupId}`;
    if (!acquire(lockKey)) return;
    try {
      await catalogService.deleteModifierGroup(groupId);
      setModGroups((current) => current.filter((g) => g.id !== groupId));
    } catch (err) {
      window.alert(err.response?.data?.detail || "Не удалось удалить добавки.");
    } finally {
      release(lockKey);
    }
  }

  const openPhotoPicker = (row) => {
    setPhotoPicker(row);
    setPhotoSearch(row.name);
  };

  const selectPhoto = (photo) => {
    if (!photoPicker) return;
    updateRow(photoPicker.id, "photo", photo);
    setPhotoPicker(null);
    setPhotoSearch("");
  };

  return {
    apiLoading,
    apiError,
    actionError,
    saving,
    pendingDeleteId,
    draftFilters,
    setDraftFilters,
    setFilters,
    statFilter,
    setStatFilter,
    drawerOpen,
    setDrawerOpen,
    photoPicker,
    setPhotoPicker,
    photoSearch,
    setPhotoSearch,
    editing,
    form,
    setForm,
    settingsOpen,
    setSettingsOpen,
    setVisibleColumns,
    tableMinWidth,
    visibleColumnCount,
    isColumnVisible,
    toggleColumn,
    computedStats,
    filteredRows,
    updateRow,
    openDrawer,
    saveDish,
    archiveDish,
    openPhotoPicker,
    selectPhoto,
    // Добавки (модификаторы)
    modGroups,
    setModGroups,
    modLoading,
    modError,
    saveModGroup,
    removeModGroup,
  };
}



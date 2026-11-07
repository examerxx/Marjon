// Вся кросс-секционная логика каталога блюд OWNER: загрузка, фильтры, форма,
// настройки колонок и мутации. Вынесено из NomenclaturePage.jsx (FE-07B)
// без ослабления FE-06 safety (AbortController/useLatestRequest, замки мутаций,
// stale-response ownership, unmount safety, числовой парсинг сохранены 1:1).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { catalogService } from "../../api/catalog";
import { getCategories } from "../../api/categories";
import { settingsService } from "../../api/settings";
import { categoryBelongsToKind } from "../../utils/catalogCategories";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import { defaultDishColumnVisibility, dishColumnOptions, emptyDishForm } from "./nomenclatureConfig";
import {
  buildNomenclatureProductPayload,
  mapNomenclatureProduct,
  parseNomenclatureMoney,
  parseNomenclatureSort,
  unitDisplayLabel,
  unitOptionLabel,
} from "./nomenclatureData";

// JPEG/PNG/WebP — как принимает POST /inventory/products/{id}/photo.
export const SUPPORTED_DISH_PHOTO_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
export function mapDishUnitOption(item) {
  return {
    id: String(item.id),
    name: String(item.name || ""),
    short_name: String(item.short_name || ""),
    // Подпись селекта — «Килограмм (Кг)», value остаётся id.
    label: unitOptionLabel(item),
    active: item.status !== false,
    isGlobal: item.is_global ?? item.company_id == null,
  };
}
// Опции фильтра «Категория»: ТОЛЬКО живой GET /inventory/categories
// (тот же источник, что у «Категория блюд»). Никаких демо/хардкод-фолбэков:
// пусто/ошибка → truthful disabled-состояние, без catch-all опции ([] = без
// ограничения). value = category.id, label = category.name; сопоставление со
// строками — по имени, т.к. продукты несут только category_name.
function makeDishCategorySlug(name) {
  const clean = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return clean ? `dish-${clean}` : `dish-${Date.now()}`;
}
export function useDishesCatalog() {
  const [rows, setRows] = useState([]);
  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  // V17 — категория: массив canonical IDs (мультиселект как в Reports).
  // [] = без ограничения (заменяет удалённую опцию «Все категории»).
  const [draftFilters, setDraftFilters] = useState({ search: "", category: [] });
  const [filters, setFilters] = useState(draftFilters);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const closeTimer = useRef(null);
  // Прямая загрузка фото из строки таблицы: один файл → один запрос.
  const [photoUploadingId, setPhotoUploadingId] = useState(null);
  // Фото для drawer: выбранный файл + временный ObjectURL-превью.
  // Превью — только UI, персистентность — только через uploadProductPhoto.
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const previewUrlRef = useRef("");

  const revokePhotoPreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
  };

  useEffect(() => () => {
    revokePhotoPreview();
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!SUPPORTED_DISH_PHOTO_TYPES.includes(file.type)) {
      setActionError("Поддерживаются только JPG, PNG и WebP.");
      return;
    }
    revokePhotoPreview();
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPhotoFile(file);
    setPhotoPreview(url);
    setActionError("");
  };
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...emptyDishForm });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(defaultDishColumnVisibility);
  // Добавки (модификаторы) редактируемого блюда: список групп, загрузка/ошибка.
  const [modGroups, setModGroups] = useState([]);
  const [modLoading, setModLoading] = useState(false);
  const [modError, setModError] = useState("");
  const clearModError = useCallback(() => setModError(""), []);
  // Опции фильтра «Категория»: живые данные GET /inventory/categories
  // (тот же источник, что у «Категория блюд» — готово к будущему merge).
  // Пусто/ошибка → опций нет (только «Все категории»), никакой выдумки имён.
  const [filterCategories, setFilterCategories] = useState([]);
  const [filterCategoriesError, setFilterCategoriesError] = useState(false);
  const [filterCategoriesLoading, setFilterCategoriesLoading] = useState(true);
  // V18 — справочник принтеров из Настройки → Принтеры (тот же settingsService,
  // что у SettingsPrintersPage: GET /printers). Один запрос при монтировании,
  // не при каждом открытии дровера. Без фейков: ошибка → пусто + флаг.
  // V24: тянем и ip_address — таблица резолвит IP по printerId
  // (product.printer_id → printers lookup → name/IP), без дублирования
  // IP на Product и без хардкода.
  const [printerOptions, setPrinterOptions] = useState([]);
  const [printerOptionsLoading, setPrinterOptionsLoading] = useState(true);
  const [printerOptionsError, setPrinterOptionsError] = useState(false);
  // V24: блокировка тумблера на время PATCH (один id за раз).
  const [togglingId, setTogglingId] = useState(null);
  // Восстановление из архива: тот же замок-мутация, отдельный флаг.
  const [restoringId, setRestoringId] = useState(null);
  // Статус-вкладка Активные/Архивированные (язык StaffTTM): дефолт — активные.
  // Данные — канонический GET /inventory/products?include_all=true (backend
  // отдаёт и архив), фильтр — реальное row.active (is_active), без фейков.
  const [showArchived, setShowArchived] = useState(false);
  // Canonical Units V2 directory. No cache and no fallback list: reopening a
  // dish drawer revalidates GET /units so newly-created company units appear.
  const [unitOptions, setUnitOptions] = useState([]);
  const [unitOptionsLoading, setUnitOptionsLoading] = useState(true);
  const [unitOptionsError, setUnitOptionsError] = useState(false);
  const unitOptionsRef = useRef([]);
  const beginRequest = useLatestRequest();
  const beginFilterRequest = useLatestRequest();
  const beginPrinterRequest = useLatestRequest();
  const beginUnitRequest = useLatestRequest();
  const { acquire, release } = useMutationLocks();

  const loadUnitOptions = useCallback(() => {
    const request = beginUnitRequest();
    setUnitOptionsLoading(true);
    setUnitOptionsError(false);
    return settingsService.listResource("units", { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        const live = items
          .filter((item) => item?.id && typeof item.status === "boolean" && unitDisplayLabel(item))
          .sort((a, b) => (
            Number(a.sort ?? a.sort_order ?? 0) - Number(b.sort ?? b.sort_order ?? 0)
            || unitDisplayLabel(a).localeCompare(unitDisplayLabel(b), "ru")
          ))
          .map(mapDishUnitOption);
        unitOptionsRef.current = live;
        setUnitOptions(live);
        setRows((current) => current.map((row) => {
          const unit = row.unitId ? live.find((item) => item.id === row.unitId) : null;
          // Таблица — короткое имя (канон), полная подпись только в селекте.
          return unit ? { ...row, unit: unit.short_name || unit.label } : row;
        }));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        unitOptionsRef.current = [];
        setUnitOptions([]);
        setUnitOptionsError(true);
      })
      .finally(() => {
        if (request.isCurrent()) setUnitOptionsLoading(false);
      });
  }, [beginUnitRequest]);

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
    catalogService.listProducts({ signal: request.signal, params: { include_all: true } })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        const mapped = items.map((item) => mapNomenclatureProduct(item, unitOptionsRef.current));
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

  useEffect(() => {
    void loadUnitOptions();
  }, [loadUnitOptions]);

  useEffect(() => {
    const request = beginFilterRequest();
    setFilterCategoriesError(false);
    setFilterCategoriesLoading(true);
    getCategories({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        const live = items
          .filter((item) => categoryBelongsToKind(item, "dish") && item.is_active !== false && String(item.name || "").trim())
          .sort((a, b) => (
            Number(a.sort_order || 0) - Number(b.sort_order || 0)
            || String(a.name).localeCompare(String(b.name), "ru")
          ))
          .map((item) => ({ id: String(item.id), name: String(item.name) }));
        setFilterCategories(live);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setFilterCategories([]);
        setFilterCategoriesError(true);
      })
      .finally(() => {
        if (request.isCurrent()) setFilterCategoriesLoading(false);
      });
  }, [beginFilterRequest]);

  useEffect(() => {
    const request = beginPrinterRequest();
    setPrinterOptionsError(false);
    setPrinterOptionsLoading(true);
    settingsService.listResource("printers", { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        const live = items
          .filter((item) => item && String(item.name || "").trim())
          .sort((a, b) => (
            Number(a.sort_order || 0) - Number(b.sort_order || 0)
            || String(a.name).localeCompare(String(b.name), "ru")
          ))
          .map((item) => ({
            id: String(item.id),
            name: String(item.name),
            ip: String(item.ip_address || "").trim(),
            active: item.is_active !== false,
          }));
        setPrinterOptions(live);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setPrinterOptions([]);
        setPrinterOptionsError(true);
      })
      .finally(() => {
        if (request.isCurrent()) setPrinterOptionsLoading(false);
      });
  }, [beginPrinterRequest]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      // Вкладка статуса: Активные — только row.active, Архивированные —
      // только архив (is_active === false). Реальный фильтр, не фейк.
      const statusMatch = showArchived ? row.active === false : row.active !== false;
      if (!statusMatch) return false;
      const searchMatch = !filters.search || row.name.toLowerCase().includes(filters.search.toLowerCase());
      // V17 — фильтр хранит массив category.id (OR-семантика); строки несут
      // только category_name — маппим через загруженный справочник. Пустой
      // массив = без ограничения. id без имени в справочнике игнорируем;
      // если не резолвится ни один — показываем всё (как раньше с протухшим
      // одиночным значением: пустой каталог хуже честного показа всех строк).
      const selectedIds = Array.isArray(filters.category) ? filters.category : [];
      const selectedNames = new Set(
        selectedIds
          .map((id) => filterCategories.find((item) => item.id === id)?.name)
          .filter(Boolean),
      );
      const categoryMatch = selectedIds.length === 0 || selectedNames.size === 0
        || selectedNames.has(row.category);
      return searchMatch && categoryMatch;
    });
  }, [rows, filters, filterCategories, showArchived]);

  // V24 — реальные тумблеры АВТО/СЕТ: PATCH /inventory/products/{id}
  // {is_auto} / {is_set}. Независимые поля, без оптимистичного fake: строку
  // обновляем ТОЛЬКО ответом сервера; ошибка → actionError, состояние не
  // меняется (revert). F5 держится сервером.
  // Ветка allow_in_sets ("inset") удалена вместе с колонкой СЕТ (ea3a4ce):
  // вызывать её было некому, а список компонентов сета на неё опирался —
  // из-за этого он был пуст всегда.
  const updateRow = async (id, key, value) => {
    if (key !== "auto" && key !== "set") {
      setActionError("Быстрое изменение недоступно: неизвестное поле.");
      return;
    }
    const lockKey = `product-toggle:${id}:${key}`;
    if (!acquire(lockKey)) return;
    const payload = key === "auto"
      ? { is_auto: Boolean(value) }
      : { is_set: Boolean(value) };
    setTogglingId(`${id}:${key}`);
    setActionError("");
    try {
      const { data } = await catalogService.updateProduct(id, payload);
      if (!data?.id) throw new Error("Backend не вернул обновлённый продукт.");
      const serverRow = mapNomenclatureProduct(data, unitOptionsRef.current);
      setRows((current) => current.map((row) => (String(row.id) === String(id) ? {
        ...serverRow,
        // IP принтера живёт в справочнике GET /printers — переносим
        // printerIp из прежней строки, если ответ его не несёт.
        printerIp: serverRow.printerIp || current.find((r) => String(r.id) === String(id))?.printerIp || "",
      } : row)));
    } catch (err) {
      const message = err.response?.data?.detail || err.message || "Не удалось обновить поле.";
      setActionError(String(message));
    } finally {
      setTogglingId(null);
      release(lockKey);
    }
  };

  const openDrawer = (row = null) => {
    if (saving) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setDrawerClosing(false);
    setEditing(row);
    setForm(row ? {
      ...row,
      cost: parseNomenclatureMoney(row.cost, 0) === 0 ? "" : String(parseNomenclatureMoney(row.cost)),
      price: parseNomenclatureMoney(row.price, 0) === 0 ? "" : String(parseNomenclatureMoney(row.price)),
    } : { ...emptyDishForm });
    revokePhotoPreview();
    setPhotoFile(null);
    setPhotoPreview("");
    setDrawerOpen(true);
    void loadUnitOptions();
    // Add-ons are hidden in the web drawer; do not fetch or mutate saved groups.
  };

  // Закрытие через exit-анимацию staff-примитива (is-closing → unmount),
  // тот же presence-паттерн, что у кассира/аккаунт-меню.
  const requestCloseDrawer = () => {
    if (saving || !drawerOpen || drawerClosing) return;
    setDrawerClosing(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(finishCloseDrawer, 240);
  };

  const finishCloseDrawer = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setDrawerOpen(false);
    setDrawerClosing(false);
  };

  // Создание категории прямо из дровера блюда: POST /inventory/categories
  // (тот же контракт, что у «Категория блюд»), затем — в живой список
  // фильтра/формы и автовыбор. Без фейков: ошибка пробрасывается наружу.
  const createDishCategory = useCallback(async (name) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new Error("Введите название категории.");
    const { data } = await catalogService.createCategory({
      name: trimmed,
      slug: makeDishCategorySlug(trimmed),
      is_active: true,
    });
    if (!data?.id) throw new Error("Backend не вернул созданную категорию.");
    const item = { id: String(data.id), name: String(data.name || trimmed) };
    setFilterCategories((current) => {
      if (current.some((entry) => String(entry.id) === item.id)) return current;
      // The server assigns the canonical tail position. Do not alphabetically
      // move the new category (or existing manually ordered choices).
      return [...current, item];
    });
    return item;
  }, []);

  const saveDish = async () => {
    if (!acquire("product-save")) return;
    const isUpdate = Boolean(editing);
    setActionError("");
    const name = String(form.name || "").trim();
    const sortOrder = parseNomenclatureSort(form.sort);
    const price = String(form.price ?? "").trim() ? parseNomenclatureMoney(form.price) : 0;
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
      // V20: созданный продукт сразу становится editing — повторное сохранение
      // (например ретрай фото после частичного успеха) идёт PATCH тем же ID,
      // дубль блюда не создаётся.
      if (!isUpdate) setEditing({ id: data.id });
      // Position changes shift neighbours on the server. Only the full canonical
      // GET can update all positions; do not manufacture client-side shifts.
      if (!await reloadRows()) throw new Error("Блюдо сохранено, но каталог не обновлён. Повторите загрузку.");
      // Фото: продукт уже существует (свой id) — грузим через канонический
      // POST /inventory/products/{id}/photo. Превью до этого момента —
      // только временный ObjectURL, персистентностью не является.
      // V20: при ошибке загрузки файл НЕ сбрасываем — повторное сохранение
      // идёт тем же product ID через PATCH (без дубля), фото догружается.
      if (photoFile) {
        try {
          const { data: photoData } = await catalogService.uploadProductPhoto(data.id, photoFile);
          if (!photoData?.id) throw new Error("Backend не вернул продукт с фото.");
          const photoRow = mapNomenclatureProduct(photoData, unitOptionsRef.current);
          setRows((current) => current.map((row) => (row.id === data.id ? photoRow : row)));
          revokePhotoPreview();
          setPhotoFile(null);
          setPhotoPreview("");
        } catch (photoErr) {
          const message = `Блюдо сохранено, но фото не загружено: ${photoErr.response?.data?.detail || photoErr.message || "ошибка загрузки"}`;
          setActionError(message);
          window.alert(message);
          return;
        }
      }
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

  // Канонический реfetch каталога (тот же include_all-источник, что при
  // монтировании). Без AbortController: вызывается из обработчиков действий,
  // не из эффектов; ошибка — честное сообщение, данные не трогаем.
  const reloadRows = async () => {
    try {
      const { data } = await catalogService.listProducts({ params: { include_all: true } });
      const items = Array.isArray(data) ? data : data?.items || [];
      setRows(items.map((item) => mapNomenclatureProduct(item, unitOptionsRef.current)));
      return true;
    } catch (err) {
      if (!isAbortError(err)) {
        setActionError(err.response?.data?.detail || "Не удалось обновить каталог.");
      }
      return false;
    }
  };

  // Состав блюда (рецепт): канонический PATCH ingredients (None=leave,
  // []=clear, list=replace). Возвращает свежий mapped-ряд и обновляет его
  // в каталоге; себестоимость/остаток пересчитывает backend.
  // V36: строка несёт warehouse_id (NULL = главный склад) — списание
  // StockService.deduct_for_order идёт со склада строки.
  const saveRecipe = async (dishId, lines) => {
    const payload = (Array.isArray(lines) ? lines : [])
      .map((line) => ({
        ingredient_id: line.ingredient_id,
        quantity: Number(line.quantity),
        warehouse_id: line.warehouse_id || null,
      }))
      .filter((line) => line.ingredient_id && Number.isFinite(line.quantity) && line.quantity > 0);
    const { data } = await catalogService.updateProduct(dishId, { ingredients: payload });
    if (!data?.id) throw new Error("Backend не вернул обновлённый продукт.");
    const mapped = mapNomenclatureProduct(data, unitOptionsRef.current);
    setRows((current) => current.map((row) => (
      String(row.id) === String(dishId) ? { ...row, ...mapped } : row
    )));
    return mapped;
  };

  // Состав сета V38: канонический PUT set-items (replace). Возвращает
  // свежие строки и обновляет счётчик строки каталога; себестоимость
  // сета backend не пересчитывает (строки несут свою цену).
  const saveSetItems = async (dishId, lines) => {
    const payload = (Array.isArray(lines) ? lines : [])
      .map((line) => ({
        product_id: String(line?.product_id || ""),
        quantity: Number(line?.quantity),
        price: Number(line?.price ?? 0),
      }))
      .filter((line) => line.product_id && Number.isFinite(line.quantity) && line.quantity > 0);
    const { data } = await catalogService.replaceSetItems(dishId, payload);
    const list = Array.isArray(data) ? data : [];
    setRows((current) => current.map((row) => (
      String(row.id) === String(dishId) ? { ...row, setItemsCount: list.length } : row
    )));
    return list;
  };

  const archiveDish = async (id) => {
    const lockKey = `product-delete:${id}`;
    if (!acquire(lockKey)) return false;
    setPendingDeleteId(id);
    try {
      await catalogService.deleteProduct(id);
    } catch (err) {
      window.alert(err.response?.data?.detail || "Ошибка удаления");
      return false;
    } finally {
      setPendingDeleteId(null);
      release(lockKey);
    }
    // Перечитываем канонический список (include_all): заархивированная строка
    // возвращается с is_active=false и переезжает во вкладку Архивированные.
    // Локальный filter-out здесь был бы фейком перемещения.
    await reloadRows();
    return true;
  };

  // V2 статуса: возврат из архива — канонический PATCH is_active:true.
  // AUTO/SET не трогаем (независимые флаги). Перечитываем весь каталог:
  // восстановление также меняет позиции оставшихся архивных строк.
  const restoreDish = async (id) => {
    const lockKey = `product-restore:${id}`;
    if (!acquire(lockKey)) return false;
    setRestoringId(id);
    setActionError("");
    try {
      const { data } = await catalogService.updateProduct(id, { is_active: true });
      if (!data?.id) throw new Error("Backend не вернул обновлённый продукт.");
      if (!await reloadRows()) throw new Error("Блюдо восстановлено, но каталог не обновлён. Повторите загрузку.");
    } catch (err) {
      const message = err.response?.data?.detail || err.message || "Не удалось восстановить блюдо.";
      setActionError(String(message));
      window.alert(String(message));
      return false;
    } finally {
      setRestoringId(null);
      release(lockKey);
    }
    return true;
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

  // Прямая загрузка фото существующего блюда из строки таблицы:
  // файл → POST /inventory/products/{id}/photo → строка обновляется ответом
  // backend. Без оптимистичных URL и без смены id. Ошибка — честное сообщение,
  // превью в таблице нет (превью живёт только в дровере до upload).
  const uploadDishPhoto = async (id, file) => {
    if (!file || photoUploadingId) return;
    if (!SUPPORTED_DISH_PHOTO_TYPES.includes(file.type)) {
      setActionError("Поддерживаются только JPG, PNG и WebP.");
      return;
    }
    setPhotoUploadingId(id);
    setActionError("");
    try {
      const { data } = await catalogService.uploadProductPhoto(id, file);
      if (!data?.id) throw new Error("Backend не вернул продукт с фото.");
      const photoRow = mapNomenclatureProduct(data, unitOptionsRef.current);
      setRows((current) => current.map((row) => (row.id === id ? photoRow : row)));
      return true;
    } catch (err) {
      const message = `Фото не загружено: ${err.response?.data?.detail || err.message || "ошибка загрузки"}`;
      setActionError(message);
      window.alert(message);
    } finally {
      setPhotoUploadingId(null);
    }
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
    filters,
    filterCategories,
    filterCategoriesError,
    filterCategoriesLoading,
    printerOptions,
    printerOptionsLoading,
    printerOptionsError,
    unitOptions,
    unitOptionsLoading,
    unitOptionsError,
    drawerOpen,
    setDrawerOpen,
    drawerClosing,
    requestCloseDrawer,
    finishCloseDrawer,
    photoUploadingId,
    uploadDishPhoto,
    editing,
    form,
    setForm,
    photoFile,
    photoPreview,
    handlePhotoChange,
    settingsOpen,
    setSettingsOpen,
    setVisibleColumns,
    tableMinWidth,
    visibleColumnCount,
    isColumnVisible,
    toggleColumn,
    filteredRows,
    updateRow,
    togglingId,
    showArchived,
    setShowArchived,
    openDrawer,
    saveDish,
    createDishCategory,
    saveRecipe,
    saveSetItems,
    archiveDish,
    restoreDish,
    restoringId,
    // Добавки (модификаторы)
    modGroups,
    setModGroups,
    modLoading,
    modError,
    clearModError,
    saveModGroup,
    removeModGroup,
  };
}



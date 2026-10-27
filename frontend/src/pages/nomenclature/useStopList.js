// Стоп-лист V3: накопительные пополнения доступного остатка поверх ВСЕХ
// активных продуктов. Источник — канонический GET /inventory/products
// (?include_all=true, тот же порядок, что у Блюд) + inline recent_topups.
// Семантика: Остаток = allowance − sold (не склад!); Предыдущий лимит =
// последние 2 пополнения (fallback — текущее allowance мигрированных данных);
// Новый лимит = ДОБАВИТЬ amount (ADD, не замена). Никакого membership,
// localStorage, моков. Единица — read-only из Product (селектора нет).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { catalogService } from "../../api/catalog";
import { settingsService } from "../../api/settings";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import { mapNomenclatureProduct, unitDisplayLabel, unitOptionLabel } from "./nomenclatureData";
import { formatQuantity, parseQuantityInput } from "./stopListFormat";
import { roundScale3, visibleTopups } from "./stopListHistory";
import { t } from "../../i18n/t";

// Ре-экспорт для совместимости (тесты/импорты): только то, что реально
// используется вне хука. Без транзитивного ре-экспорта history-модуля:
// каждый потребитель импортирует historyView/visibleTopups напрямую из
// "./stopListHistory" (одна связь вместо цепочки — класс рассинхрона
// stale-модулей, ронявший весь OWNER, исключён).
export { formatQuantity, parseQuantityInput, parseStopListLimit } from "./stopListFormat";
export { roundScale3, visibleTopups } from "./stopListHistory";

export function mapStopListRow(item, units = []) {
  const base = mapNomenclatureProduct(item, units);
  // V3: allowance (канонический доступный объём) может быть Decimal-строкой
  // ("8.000") — Number() понимает точно. sold — аналогично.
  // V3.5: allowance 0 — валидный ноль остатка ("0 шт"), а НЕ null.
  // null (нет квоты) = unlimited = "—". Не путать!
  const allowanceNum = item.daily_limit == null ? null : Number(item.daily_limit);
  const allowance = allowanceNum != null && Number.isFinite(allowanceNum) && allowanceNum >= 0
    ? allowanceNum
    : null;
  const soldNum = Number(item.sold_count ?? 0);
  const sold = Number.isFinite(soldNum) && soldNum >= 0 ? soldNum : 0;
  // Доступно = allowance − sold (НЕ складской stock!). null allowance → "—".
  const available = allowance == null ? null : roundScale3(allowance - sold);
  const isAvailable = item.is_available !== false;
  const unitId = item.unit_id ? String(item.unit_id) : "";
  // V3.1: если unit_id есть — только canonical resolution по справочнику;
  // legacy-строка ("шт" по умолчанию у всех старых строк) НЕ используется,
  // иначе она маскирует неразрешённую единицу и Stop-list расходится
  // с Блюдами. Нет resolution → "" → серый placeholder.
  // Без unit_id legacy-строка — единственная правда (старые товары).
  const canonical = unitId
    ? (units || []).find((u) => u && String(u.id) === unitId)
    : null;
  const canonicalLabel = canonical
    // Строки таблицы — короткое имя (канон); полная подпись
    // «Штук (Шт)» только для опций селектов.
    ? String(unitDisplayLabel(canonical) || canonical.label || "").trim()
    : "";
  const legacyLabel = item.unit && item.unit !== "—" ? String(item.unit).trim() : "";
  const unitLabel = unitId ? canonicalLabel : (canonicalLabel || legacyLabel);
  const sortOrder = Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : Number.MAX_SAFE_INTEGER;
  const recent = Array.isArray(item.recent_topups) ? item.recent_topups : [];
  const withUnit = (text) => (unitLabel ? `${text} ${unitLabel}` : text);
  // V3.7.1 display-правило остатка:
  // - allowance null (квоты нет / unlimited) → "—";
  // - allowance === 0 (только explicit allowance-zero; absolute PATCH
  //   требует >0, топ-апы положительные — другого пути к 0 нет) → "—".
  //   Backend при этом хранит настоящий 0 и блокирует продажи;
  //   различие — в accessible title ниже, не в тексте;
  // - исчерпанная квота (allowance > 0, available = 0) → честные "0 <unit>".
  const remainderText = available == null || allowance === 0
    ? "—"
    : withUnit(formatQuantity(available));
  const remainderHint = available == null
    ? "Без ограничения"
    : (allowance === 0 ? "Остаток обнулён" : "");
  return {
    ...base,
    allowance,
    sold,
    available,
    isAvailable,
    unitId,
    unitLabel,
    sortOrder,
    historyResetSeq: item.history_reset_seq ?? null,
    recentTopups: recent,
    remainderText,
    remainderHint,
  };
}

function newOperationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useStopList() {
  const [rows, setRows] = useState([]);
  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [actionError, setActionError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [newLimits, setNewLimits] = useState({});
  const [unitOptions, setUnitOptions] = useState([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const beginRequest = useLatestRequest();
  const beginUnitRequest = useLatestRequest();
  const { acquire, release } = useMutationLocks();
  // Idempotency-ключи черновиков: один на попытку; сброс после успеха.
  const opIds = useRef({});
  // Последний загруженный справочник единиц — для мэппинга POST-ответов
  // без refetch (applyServerRow).
  const unitOptionsRef = useRef([]);

  useEffect(() => () => {
    opIds.current = {};
  }, []);

  const reloadRows = useCallback(async (signal) => {
    const { data } = await catalogService.listProducts(signal ? { signal, params: { include_all: true } } : { params: { include_all: true } });
    const items = Array.isArray(data) ? data : data?.items || [];
    return items;
  }, []);

  const applyItems = useCallback((items, units) => {
    // Порядок — как пришёл с backend (sort_order, created_at, id),
    // тот же источник и та же последовательность, что у Блюд.
    const mapped = items.map((item) => mapStopListRow(item, units));
    setRows(mapped);
    // Черновики по умолчанию ПУСТЫ (V3: поле очищается после Save);
    // существующие черновики переживают refetch (retry после ошибки).
    setNewLimits((current) => {
      const next = {};
      for (const row of mapped) {
        const key = String(row.id);
        next[key] = current[key] ?? "";
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const request = beginRequest();
    const unitRequest = beginUnitRequest();
    setApiLoading(true);
    setApiError("");
    setUnitsLoading(true);
    let units = [];
    settingsService.listResource("units", { signal: unitRequest.signal })
      .then(({ data }) => {
        if (!unitRequest.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        units = items
          .filter((item) => item?.id && typeof item.status === "boolean" && unitDisplayLabel(item))
          .sort((a, b) => (
            Number(a.sort ?? a.sort_order ?? 0) - Number(b.sort ?? b.sort_order ?? 0)
            || unitDisplayLabel(a).localeCompare(unitDisplayLabel(b), "ru")
          ))
          .map((item) => ({
            id: String(item.id),
            // Подпись селекта — «Килограмм (Кг)», сырые поля сохраняем
            // (mapNomenclatureProduct резолвит единицу через short_name||name).
            label: unitOptionLabel(item),
            // V3.1: mapNomenclatureProduct резолвит единицу через
            // unitDisplayLabel (short_name||name) — сырые поля обязаны
            // сохраняться, иначе всё молча падает на legacy-строку "шт"
            // (именно так Stop-list расходился с Блюдами).
            name: String(item.name || ""),
            short_name: String(item.short_name || ""),
            active: item.status !== false,
          }));
        setUnitOptions(units);
        unitOptionsRef.current = units;
      })
      .catch(() => {
        if (unitRequest.isCurrent()) {
          setUnitOptions([]);
          unitOptionsRef.current = [];
        }
      })
      .finally(() => {
        if (unitRequest.isCurrent()) setUnitsLoading(false);
        if (!request.isCurrent()) return;
        reloadRows(request.signal)
          .then((items) => {
            if (!request.isCurrent()) return;
            applyItems(items, units);
          })
          .catch((err) => {
            if (!request.isCurrent() || isAbortError(err)) return;
            setRows([]);
            setApiError(err.response?.data?.detail || "Не удалось загрузить стоп-лист.");
          })
          .finally(() => {
            if (request.isCurrent()) setApiLoading(false);
          });
      });
  }, [beginRequest, beginUnitRequest, reloadRows, applyItems]);

  const refresh = useCallback(async () => {
    try {
      const { data } = await catalogService.listProducts({ params: { include_all: true } });
      const items = Array.isArray(data) ? data : data?.items || [];
      applyItems(items, unitOptions);
      return true;
    } catch (err) {
      if (!isAbortError(err)) {
        setActionError(err.response?.data?.detail || "Не удалось обновить стоп-лист.");
      }
      return false;
    }
  }, [applyItems, unitOptions]);

  // Тихий refetch: продажи и правки с других устройств (касса/десктоп,
  // авто-стоп по квоте) иначе не видны до перезагрузки страницы.
  // Черновики ввода переживают refetch (applyItems их сохраняет).
  useEffect(() => {
    const id = setInterval(() => { void refresh(); }, 30000);
    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refresh();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // V3: никакой membership — все активные продукты каталога.
  const stopRows = useMemo(
    () => rows.filter((row) => row.active !== false),
    [rows],
  );

  // Черновик ввода: цифры + пробелы-разделители + один ./, (сырой текст).
  const setNewLimit = useCallback((id, value) => {
    const sanitized = String(value ?? "").replace(/[^\d\s   .,]/g, "").slice(0, 16);
    setNewLimits((current) => ({ ...current, [String(id)]: sanitized }));
  }, []);

  const rowById = useCallback((id) => rows.find((item) => String(item.id) === String(id)) || null, [rows]);

  // V3 dirty = валидный положительный черновик (пусто → чисто, кнопка disabled).
  const isDirty = useCallback((row) => {
    if (!row) return false;
    return parseQuantityInput(String(newLimits[String(row.id)] ?? "")).ok;
  }, [newLimits]);

  // Накопительное сохранение БЕЗ refetch: POST topup → {ok, product}.
  // Вызыватель (таблица) обновляет строку из ответа (backend truth),
  // чистит черновик и крутит скоординированную анимацию; тихий reconcile
  // идёт фоном и визуально ничего не меняет.
  const commitTopup = useCallback(async (id) => {
    const row = rowById(id);
    if (!row) return { ok: false };
    const parsed = parseQuantityInput(String(newLimits[String(id)] ?? ""));
    if (!parsed.ok) {
      setActionError("Укажите положительное количество (максимум 3 знака после запятой).");
      return { ok: false };
    }
    if (!opIds.current[String(id)]) opIds.current[String(id)] = newOperationId();
    const lockKey = `stoplist-save:${id}`;
    if (!acquire(lockKey)) return { ok: false };
    setSavingId(String(id));
    setActionError("");
    try {
      const { data } = await catalogService.topupProductLimit(id, {
        amount: parsed.normalized,
        idempotencyKey: opIds.current[String(id)],
      });
      if (!data?.product?.id) throw new Error("Backend не вернул обновлённый продукт.");
      return { ok: true, product: data.product };
    } catch (err) {
      setActionError(String(err.response?.data?.detail || err.message || "Не удалось добавить лимит."));
      return { ok: false };
    } finally {
      setSavingId(null);
      release(lockKey);
    }
  }, [rowById, newLimits, acquire, release]);

  // Применить канонический продукт из POST-ответа в строки (без refetch):
  // остаток/история обновляются ровно в момент анимации, а не когда
  // придёт фоновый refetch. Черновик и idempotency-ключ сбрасываем сразу —
  // число уже "покинуло" поле.
  const applyServerRow = useCallback((product) => {
    if (!product?.id) return null;
    const mapped = mapStopListRow(product, unitOptionsRef.current);
    setRows((current) => current.map(
      (row) => (String(row.id) === String(product.id) ? mapped : row),
    ));
    setNewLimits((current) => ({ ...current, [String(product.id)]: "" }));
    delete opIds.current[String(product.id)];
    return mapped;
  }, []);

  const clearDraft = useCallback((id) => {
    setNewLimits((current) => ({ ...current, [String(id)]: "" }));
    delete opIds.current[String(id)];
  }, []);

  // Тихий reconcile с backend после анимации: расхождений быть не должно;
  // если backend вернул новее — честно покажем его (без анимаций).
  const reconcile = useCallback(async () => {
    await refresh();
  }, [refresh]);

  // V3.5: остаток ровно в 0 через canonical endpoint (НЕ unlimited-NULL).
  // Строка остаётся, история и склад не трогаются, ручной стоп переживает.
  // Ошибка возвращается вызывателю (модалка показывает локально);
  // глобальный баннер не ставим, чтобы он не просвечивал за модалкой.
  const zeroAllowance = useCallback(async (id) => {
    const row = rowById(id);
    if (!row) return { ok: false, error: t("pages.nomenclature.usestoplist.blyudo_ne_naydeno"), status: null };
    const lockKey = `stoplist-zero:${id}`;
    if (!acquire(lockKey)) return { ok: false, error: null, status: null };
    setSavingId(String(id));
    try {
      await catalogService.zeroProductAllowance(id);
      await refresh();
      return { ok: true, error: null, status: null };
    } catch (err) {
      return {
        ok: false,
        error: String(err.response?.data?.detail || err.message || "Не удалось обнулить остаток."),
        status: err.response?.status ?? null,
      };
    } finally {
      setSavingId(null);
      release(lockKey);
    }
  }, [rowById, acquire, release, refresh]);

  // V3.5: сброс ВИДИМОЙ истории (checkpoint), остаток не трогаем.
  // Append-only строки в БД живы; следующий топ-ап виден как [40].
  // Ошибка — локально вызывателю, как выше.
  const resetHistory = useCallback(async (id) => {
    const row = rowById(id);
    if (!row) return { ok: false, error: t("pages.nomenclature.usestoplist.blyudo_ne_naydeno"), status: null };
    const lockKey = `stoplist-histreset:${id}`;
    if (!acquire(lockKey)) return { ok: false, error: null, status: null };
    setSavingId(String(id));
    try {
      await catalogService.resetProductHistory(id);
      await refresh();
      return { ok: true, error: null, status: null };
    } catch (err) {
      return {
        ok: false,
        error: String(err.response?.data?.detail || err.message || "Не удалось обнулить историю."),
        status: err.response?.status ?? null,
      };
    } finally {
      setSavingId(null);
      release(lockKey);
    }
  }, [rowById, acquire, release, refresh]);

  return {
    apiLoading,
    apiError,
    actionError,
    savingId,
    stopRows,
    newLimits,
    unitOptions,
    unitsLoading,
    setNewLimit,
    isDirty,
    commitTopup,
    applyServerRow,
    clearDraft,
    reconcile,
    zeroAllowance,
    resetHistory,
    refresh,
  };
}

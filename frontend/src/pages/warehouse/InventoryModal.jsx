import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { warehouseService } from "../../api/warehouse";
import { nomenclatureService } from "../../api/nomenclature";
import { catalogService } from "../../api/catalog";
import Icon from "../../components/Icon";
import DishSingleSelect from "../nomenclature/DishSingleSelect";
import Toast from "../../components/Toast";

// Инвентаризация — модалка «Создать» (V42): структура как на референсе
// (склад + комментарий, фильтры тип/категория/поиск, слева таблица,
// справа Корректировка, Сохранить), дизайн таблицы — как создание
// в «Добавить продуктов» (wh-create: Категория/Названия/Тип + боксы
// кол-ва с суффиксом ед.изм). Факт − остаток: > 0 → излишек в приход,
// < 0 → недостача в расход (бэкенд проводит атомарно, apply_to_stock
// всегда включён — переключателя нет).
const INV_MODAL_EXIT_MS = 160;

// Факт может быть отрицательным: минус на складе — легальное состояние
// (продали/списали больше, чем числилось, долг поставщику). Раньше здесь
// стояло `value >= 0`, поэтому введённое «-3» молча превращалось в null,
// позиция выпадала из отправки, и сохранение падало с «Введите фактическое
// количество хотя бы для одной позиции» — хотя число было введено.
// Юникодные минусы (−, –, —) с клавиатур iOS/macOS и копипаста тоже
// приводим к ASCII, иначе Number() даёт NaN.
function parseQty(raw) {
  const text = String(raw ?? "")
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(",", ".");
  if (text === "" || text === "-" || text === "." || text === "-.") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function formatNum(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value) || 0);
}

function formatAmount(value) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value) || 0)} UZS`;
}

// Реальная причина ошибки сохранения: строка бэкенда, либо сводка
// 422-валидации (там detail — список, а не строка), либо код статуса.
// Общий «Не удалось сохранить» прятал причину, и на сервере её было
// не видно вообще — поэтому показываем как есть.
function formatSaveError(err) {
  const status = err?.response?.status;
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    const parts = detail.slice(0, 3).map((item) => {
      if (typeof item === "string") return item;
      const where = Array.isArray(item?.loc)
        ? item.loc.filter((part) => part !== "body").join(".")
        : "";
      const text = item?.msg || item?.message || JSON.stringify(item);
      return where ? `${where}: ${text}` : String(text);
    });
    return parts.join("; ");
  }
  if (err?.request && !err?.response) return "Нет связи с сервером. Проверьте подключение.";
  if (status) return `Не удалось сохранить инвентаризацию (код ${status}).`;
  return "Не удалось сохранить инвентаризацию.";
}

export default function InventoryModal({ onClose, onSaved }) {
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [comment, setComment] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [factMap, setFactMap] = useState({});
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null);
  // Таблицы уходят с анимацией: держим последний склад до конца выхода.
  const [shownWhId, setShownWhId] = useState(null);
  const [panelsClosing, setPanelsClosing] = useState(false);
  const panelsTimer = useRef(null);

  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => () => clearTimeout(panelsTimer.current), []);

  useEffect(() => {
    if (warehouseId) {
      clearTimeout(panelsTimer.current);
      setPanelsClosing(false);
      setShownWhId(warehouseId);
      return undefined;
    }
    if (shownWhId && !panelsClosing) {
      setPanelsClosing(true);
      clearTimeout(panelsTimer.current);
      panelsTimer.current = setTimeout(() => {
        setShownWhId(null);
        setPanelsClosing(false);
      }, 200);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  function requestClose() {
    if (saving || closing) return;
    const reduced = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      onClose();
      return;
    }
    setClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onClose, INV_MODAL_EXIT_MS);
  }

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  // Справочники + остатки: шаблоны (Продукт) + Товары-реализация (Товар),
  // остаток строки — из /inventory/stock (по складу выбирается ниже).
  // История приходов (шапки + строки одним батчем listPurchaseDetails):
  // в таблице показываем только позиции выбранного склада, по которым уже
  // был приход, плюс позиции с ненулевым остатком. Никогда не приходившее
  // с нулевым остатком скрываем, чтобы не шуметь.
  const [purchaseHist, setPurchaseHist] = useState(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      warehouseService.listWarehouses().catch(() => ({ data: [] })),
      warehouseService.listStock().catch(() => ({ data: [] })),
      nomenclatureService.listIngredients().catch(() => ({ data: [] })),
      catalogService.listProducts({ params: { include_all: true } }).catch(() => ({ data: [] })),
      warehouseService.list("incoming").catch(() => null),
    ]).then(async ([whRes, stockRes, ingRes, prodRes, purchRes]) => {
      if (cancelled) return;
      const whData = whRes?.data;
      setWarehouses(Array.isArray(whData) ? whData : whData?.items || []);
      const stockData = stockRes?.data;
      const stockRows = Array.isArray(stockData) ? stockData : stockData?.items || [];
      const stockByWhIng = new Map();
      stockRows.forEach((s) => {
        if (!s?.warehouse_id || !s?.ingredient_id) return;
        stockByWhIng.set(
          `${String(s.warehouse_id)}||${String(s.ingredient_id)}`,
          { qty: Number(s.quantity) || 0, cost: Number(s.cost_price) || 0, unit: s.unit || "" },
        );
      });
      const ingData = ingRes?.data;
      const ings = (Array.isArray(ingData) ? ingData : ingData?.items || [])
        .filter((r) => r?.is_active !== false && r?.id);
      const prodData = prodRes?.data;
      const prods = (Array.isArray(prodData) ? prodData : prodData?.items || [])
        .filter((p) => String(p?.product_type || "dish") === "sale" && p?.is_active !== false && p?.id);
      const ingByNameUnit = new Map();
      ings.forEach((ing) => {
        ingByNameUnit.set(
          `${String(ing.name || "").trim().toLowerCase()}||${String(ing.unit || "").trim().toLowerCase()}`,
          ing,
        );
      });
      const mapped = [
        ...ings.map((ing) => ({
          key: `ing-${ing.id}`,
          ingredientId: String(ing.id),
          productId: null,
          name: ing.name || "—",
          category: ing.category || "Без категории",
          type: "Продукт",
          unit: ing.unit || "кг",
        })),
        ...prods.map((p) => {
          const linked = ingByNameUnit.get(
            `${String(p.name || "").trim().toLowerCase()}||${String(p.unit || "").trim().toLowerCase()}`,
          );
          return {
            key: `sale-${p.id}`,
            ingredientId: linked ? String(linked.id) : null,
            productId: String(p.id),
            name: p.name || "—",
            category: p.category_name || linked?.category || "Без категории",
            type: "Товар",
            unit: p.unit || "шт",
          };
        }),
      ];
      // Одна строка на складской учёт: Товар с привязкой к шаблону и сам
      // шаблон — один и тот же ингредиент. Оставляем Товар (несёт product_id
      // для отчётности), дубль-Продукт прячем, иначе факт посчитается дважды.
      const seenIng = new Set();
      const deduped = [];
      [...mapped.filter((r) => r.productId), ...mapped.filter((r) => !r.productId)].forEach((r) => {
        if (r.ingredientId) {
          if (seenIng.has(r.ingredientId)) return;
          seenIng.add(r.ingredientId);
        }
        deduped.push(r);
      });
      // Остаток подтягивается под выбранный склад при рендере (stockByWhIng
      // держим в ref-подобном состоянии через rowsMeta).
      setRows(deduped);
      setRowsMeta({ stockByWhIng });
      // История приходов по складам: склад → {ings, prods} из строк документов.
      // null (ошибка загрузки) = история неизвестна, фильтр не применяем.
      let hist = null;
      const purchData = purchRes?.data;
      if (purchData) {
        const headers = Array.isArray(purchData) ? purchData : purchData?.items || [];
        const ids = headers.map((h) => h?.id).filter(Boolean);
        // Пакетный состав: один запрос вместо N поштучных. Ключ — id документа,
        // а не позиция в массиве: раньше детали сопоставлялись по индексу, и при
        // документе без id вся история склада съезжала на соседний документ.
        const detailsRes = await warehouseService
          .listPurchaseDetails(ids)
          .catch(() => ({ data: [] }));
        if (cancelled) return;
        const itemsByDoc = new Map();
        (Array.isArray(detailsRes?.data) ? detailsRes.data : []).forEach((doc) => {
          if (doc?.id) itemsByDoc.set(String(doc.id), Array.isArray(doc.items) ? doc.items : []);
        });
        hist = new Map();
        headers.forEach((h) => {
          const whId = h?.warehouse_id ? String(h.warehouse_id) : "";
          if (!whId) return;
          let acc = hist.get(whId);
          if (!acc) {
            acc = { ings: new Set(), prods: new Set() };
            hist.set(whId, acc);
          }
          const items = itemsByDoc.get(String(h?.id)) || [];
          items.forEach((it) => {
            if (it?.ingredient_id) acc.ings.add(String(it.ingredient_id));
            if (it?.product_id) acc.prods.add(String(it.product_id));
          });
        });
      }
      if (cancelled) return;
      setPurchaseHist(hist);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoadError("Не удалось загрузить остатки.");
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [rowsMeta, setRowsMeta] = useState({ stockByWhIng: new Map() });

  const warehouseOptions = useMemo(() => (
    warehouses.map((wh) => ({ value: String(wh.id), label: wh.name || "—" }))
  ), [warehouses]);

  const categoryOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const value = String(r?.category || "").trim();
      if (value) set.add(value);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [rows]);

  const stockWhId = shownWhId || warehouseId;
  const stockOf = (row) => {
    if (!stockWhId) return 0;
    if (row.ingredientId) {
      return rowsMeta.stockByWhIng.get(`${stockWhId}||${row.ingredientId}`)?.qty || 0;
    }
    return 0;
  };

  const visibleRows = useMemo(() => {
    const term = String(search || "").trim().toLowerCase();
    const histSets = warehouseId && purchaseHist ? purchaseHist.get(String(warehouseId)) : null;
    return rows.filter((r) => {
      if (typeFilter && r.type !== typeFilter) return false;
      if (categoryFilter && String(r.category || "") !== categoryFilter) return false;
      if (term && !`${r.name || ""} ${r.category || ""}`.toLowerCase().includes(term)) return false;
      // Со складом и загруженной историей: только приходившее на этот склад
      // или с ненулевым остатком. История неизвестна — показываем всё.
      if (warehouseId && purchaseHist) {
        if (histSets) {
          if (r.ingredientId && histSets.ings.has(r.ingredientId)) return true;
          if (r.productId && histSets.prods.has(r.productId)) return true;
        }
        if (stockOf(r) !== 0) return true;
        return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, typeFilter, categoryFilter, warehouseId, purchaseHist, rowsMeta]);

  const clearInvFilters = () => {
    setTypeFilter("");
    setCategoryFilter("");
    setSearch("");
    setComment("");
  };

  // Введённые факты с расхождениями (правая панель «Корректировка»).
  const corrections = useMemo(() => {
    const out = [];
    rows.forEach((r) => {
      const qty = parseQty(factMap[r.key]);
      if (qty === null) return;
      const stock = stockOf(r);
      out.push({ key: r.key, name: r.name, unit: r.unit, stock, actual: qty, diff: qty - stock });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, factMap, warehouseId, shownWhId, rowsMeta]);

  const handleSave = async () => {
    if (saving) return;
    if (!warehouseId) {
      setSaveError("Выберите склад.");
      return;
    }
    const items = [];
    rows.forEach((r) => {
      const qty = parseQty(factMap[r.key]);
      if (qty === null) return;
      const item = { actual_qty: qty };
      if (r.ingredientId) item.ingredient_id = r.ingredientId;
      if (r.productId) item.product_id = r.productId;
      if (item.ingredient_id || item.product_id) items.push(item);
    });
    if (!items.length) {
      setSaveError("Введите фактическое количество хотя бы для одной позиции.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const { data } = await warehouseService.createInventory({
        warehouse_id: warehouseId,
        warehouse_name: warehouses.find((wh) => String(wh.id) === String(warehouseId))?.name || null,
        comment: comment.trim() || null,
        items,
        apply_to_stock: true,
      });
      onSaved(data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("createInventory failed:", err?.response?.status, err?.response?.data || err?.message);
      setSaveError(formatSaveError(err));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="settings-owner-view dishcat-modal-layer">
      <div className={`settings-drawer settings-modal-overlay${closing ? " is-closing" : ""}`} role="presentation">
        <div className="settings-drawer__backdrop" onClick={saving ? undefined : requestClose} />
        <div
          className="settings-form settings-modal warehouse-create-page wh-inv-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inventory-modal-title"
        >
          <header className="settings-form__header wh-inv-modal__header">
            <div>
              <p>Склад</p>
              <h2 id="inventory-modal-title">Создать инвентаризацию</h2>
            </div>
            <div className="wh-inv-top-actions">
              <button
                type="button"
                className="wh-inv-exit-top"
                onClick={requestClose}
                disabled={saving}
              >
                Выйти
              </button>
              <button
                type="button"
                className="wh-inv-save-top"
                onClick={handleSave}
                disabled={saving || loading}
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </header>
          <div className="settings-form__body">
            <div className="wh-inv-top">
              <div className="wh-inv-field">
                <span className="wh-create-field__label" aria-hidden="true">Склад *</span>
                <DishSingleSelect
                  label="Склад инвентаризации"
                  placeholder="Выберите склад *"
                  options={warehouseOptions}
                  value={warehouseOptions.some((o) => o.value === warehouseId) ? warehouseId : ""}
                  onChange={(next) => setWarehouseId(next || "")}
                  disabled={warehouseOptions.length === 0}
                  disabledLabel="Склады недоступны"
                />
              </div>
              <div className="wh-inv-field">
                <span className="wh-create-field__label" aria-hidden="true">Тип</span>
                <DishSingleSelect
                  label="Тип позиций"
                  placeholder="Выберите тип"
                  options={[
                    { value: "Продукт", label: "Продукт" },
                    { value: "Товар", label: "Товар" },
                  ]}
                  value={typeFilter}
                  onChange={(next) => setTypeFilter(next || "")}
                />
              </div>
              <div className="wh-inv-field">
                <span className="wh-create-field__label" aria-hidden="true">Категория</span>
                <DishSingleSelect
                  label="Категория позиций"
                  placeholder="Категория"
                  options={categoryOptions.map((name) => ({ value: name, label: name }))}
                  value={categoryOptions.includes(categoryFilter) ? categoryFilter : ""}
                  onChange={(next) => setCategoryFilter(next || "")}
                  disabled={categoryOptions.length === 0}
                  disabledLabel="Категории недоступны"
                />
              </div>
              <div className="wh-inv-field">
                <span className="wh-create-field__label" aria-hidden="true">Поиск</span>
                <label className="report-filter-input">
                  <Icon name="bi-search" size={17} />
                  <input
                    aria-label="Поиск позиций"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Поиск"
                  />
                </label>
              </div>
            </div>
            <div className="wh-inv-filters">
              <label className="wh-inv-field wh-inv-field--comment">
                <span className="wh-create-field__label" aria-hidden="true">Комментарий</span>
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Комментарий"
                  aria-label="Комментарий"
                />
              </label>
              <button type="button" className="report-filter-clear" onClick={clearInvFilters}>
                <Icon name="bi-x-circle" size={17} /> Очистить
              </button>
            </div>
            {/* Загрузочный текст не показываем: данные долетают за миг,
                а вспышка текста даёт ощущение дёргания. Пока грузится —
                пусто, таблицы плавно появляются сами. Ошибку показываем. */}
            {loading ? null : loadError ? (
              <div className="login-error" role="alert">{loadError}</div>
            ) : (warehouseId || shownWhId) ? (
              <div className={`wh-inv-panels${panelsClosing ? " is-closing" : ""}`} key={shownWhId || warehouseId}>
                <div className="wh-inv-stock">
                  <table className="settings-table dish-grid-table wh-create-table wh-inv-table" aria-label="Остатки для инвентаризации">
                    <thead>
                      <tr>
                        <th>Категория</th>
                        <th>Названия</th>
                        <th>Тип</th>
                        <th>Остаток</th>
                        <th>Текущее кол-во</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((r) => (
                        <tr key={r.key}>
                          <td className="wh-doc-col-category">{r.category}</td>
                          <td className="wh-doc-col-name">{r.name}</td>
                          <td className="wh-doc-col-type">{r.type}</td>
                          <td>{stockWhId ? `${formatNum(stockOf(r))} ${r.unit}` : "—"}</td>
                          <td className="wh-doc-col-qty">
                            <label className="wh-doc-qty-field">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={factMap[r.key] ?? ""}
                                placeholder="0"
                                onChange={(e) => setFactMap((cur) => ({ ...cur, [r.key]: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                                aria-label={`Факт ${r.name}`}
                              />
                              <span>{r.unit}</span>
                            </label>
                          </td>
                        </tr>
                      ))}
                      {!visibleRows.length ? (
                        <tr><td colSpan={5} className="warehouse-empty-cell">По фильтру ничего не найдено.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <div className="wh-inv-corr">
                  <table className="settings-table dish-grid-table wh-create-table" aria-label="Корректировка">
                    <thead>
                      <tr>
                        <th>Название</th>
                        <th>Корректировка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {corrections.map((c) => (
                        <tr key={c.key}>
                          <td className="wh-doc-col-name">{c.name}</td>
                          <td className={`wh-inv-diff${c.diff > 0 ? " is-plus" : c.diff < 0 ? " is-minus" : ""}`}>
                            {c.diff > 0 ? `+${formatNum(c.diff)} ${c.unit}` : c.diff < 0 ? `−${formatNum(-c.diff)} ${c.unit}` : "0"}
                          </td>
                        </tr>
                      ))}
                      {!corrections.length ? (
                        <tr className="wh-inv-corr-empty"><td colSpan={2} className="warehouse-empty-cell">Список пуст</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {saveError ? <Toast kind="error" message={saveError} onClose={() => setSaveError("")} /> : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

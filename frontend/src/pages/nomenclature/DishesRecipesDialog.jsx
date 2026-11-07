import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import ReportEmptyState from "../../components/ReportEmptyState";
import { useAnchoredDialogMotion } from "../../hooks/useAnchoredDialogMotion";
import { nomenclatureService } from "../../api/nomenclature";
import { catalogService } from "../../api/catalog";
import DishSingleSelect from "./DishSingleSelect";

const money = (value) => value ? String(value).replace(/\s*UZS$/i, " сум") : "—";

function parseQuantity(raw) {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatQuantity(value) {
  return String(value ?? "").replace(".", ",");
}

// Состав блюда: выбор товара из Склад → Сырьё + количество.
// Сохранение — канонический PATCH ingredients (replace), себестоимость и
// доступный остаток пересчитывает backend.
// V36: Склад строки — сохраняемое поле (не фильтр): выбранный склад пишется
// в line.warehouse_id, списание идёт с него; пусто = главный склад.
// Склад задаёт место будущего списания, но не ограничивает справочник сырья:
// рецепт можно настроить до первого прихода и при нулевом остатке.
export default function DishesRecipesDialog({ dish, onClose, returnFocusRef, onSave, onChanged }) {
  const [editingIndex, setEditingIndex] = useState(null);
  const [zoomPhoto, setZoomPhoto] = useState(false);
  const { dialogRef, motionClassName, motionStyle, requestClose, handleAnimationEnd } = useAnchoredDialogMotion({
    isOpen: true, onClose, returnFocusRef, motionMode: "center",
    escapeDisabled: zoomPhoto || editingIndex !== null,
  });
  const [lines, setLines] = useState(() => (
    Array.isArray(dish.recipeIngredients)
      ? dish.recipeIngredients
        .filter((line) => line && line.ingredient_id)
        .map((line) => ({
          ingredient_id: String(line.ingredient_id),
          quantity: Number(line.quantity) || 0,
          warehouse_id: line.warehouse_id ? String(line.warehouse_id) : null,
        }))
      : []
  ));
  const [options, setOptions] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [warehouses, setWarehouses] = useState([]);
  // Категории сырья деревом: родители + подкатегории (parent_id).
  // Опция подкатегории подписана «Дитя (Родитель)», value — имя для
  // точного матчинга item.category; выбор родителя включает и его детей.
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [childParent, setChildParent] = useState({});
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [qty, setQty] = useState("");
  // Выбрали продукт — курсор сразу в «Кол-во»: это неизбежный следующий шаг,
  // и лишний клик по полю больше не нужен (и мышью, и клавиатурой).
  const qtyRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [removingIndex, setRemovingIndex] = useState(null);
  const [error, setError] = useState("");
  // Центр-панель правки строки (карандаш таблицы): только количество.
  // Центр-панель правки строки (карандаш таблицы): только количество.
  const [editQty, setEditQty] = useState("");
  const [zoomClosing, setZoomClosing] = useState(false);
  const [editClosing, setEditClosing] = useState(false);

  // Фокус в диалог забираем ровно один раз — на первом рендере. Раньше эффект
  // перезапускался на каждом обновлении состояния и перекидывал фокус на
  // первую кнопку (фото) — из-за этого выбор продукта тут же терял фокус,
  // который мы переводим в «Кол-во», а body.style.overflow дёргался на каждом
  // ререндере.
  const focusGrabbed = useRef(false);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!focusGrabbed.current) {
      focusGrabbed.current = true;
      dialogRef.current?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    }
    return () => { document.body.style.overflow = previousOverflow; };
  }, [dialogRef]);

  function closeZoom() {
    if (zoomClosing) return;
    setZoomClosing(true);
    window.setTimeout(() => {
      setZoomPhoto(false);
      setZoomClosing(false);
    }, 160);
  }

  useEffect(() => {
    if (!zoomPhoto) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeZoom();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoomPhoto]);

  useEffect(() => {
    if (editingIndex === null) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        cancelEdit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editingIndex, saving, editClosing]);

  useEffect(() => {
    let alive = true;
    setOptionsLoading(true);
    setOptionsError("");
    Promise.all([
      nomenclatureService.listIngredients(),
      nomenclatureService.listWarehouses().catch(() => ({ data: [] })),
      catalogService.listCategories().catch(() => ({ data: [] })),
    ])
      .then(([{ data }, warehousesRes, categoriesRes]) => {
        if (!alive) return;
        const items = Array.isArray(data) ? data : [];
        setOptions(items);
        const wh = warehousesRes?.data;
        setWarehouses(Array.isArray(wh) ? wh : wh?.items || []);
        const cats = categoriesRes?.data;
        const list = Array.isArray(cats) ? cats : cats?.items || [];
        const rawCats = list.filter((item) => String(item?.slug || "").startsWith("raw"));
        const byId = new Map();
        rawCats.forEach((item) => {
          if (item?.id) byId.set(String(item.id), item);
        });
        const names = new Map();
        rawCats.forEach((item) => {
          const name = String(item?.name || "").trim();
          if (!name || names.has(name)) return;
          const parent = item?.parent_id ? byId.get(String(item.parent_id)) : null;
          const parentName = String(parent?.name || "").trim();
          names.set(name, parentName ? `${name} (${parentName})` : name);
        });
        items.forEach((item) => {
          const name = String(item?.category || "").trim();
          if (name && !names.has(name)) names.set(name, name);
        });
        const childOf = {};
        rawCats.forEach((item) => {
          const name = String(item?.name || "").trim();
          const parent = item?.parent_id ? byId.get(String(item.parent_id)) : null;
          const parentName = String(parent?.name || "").trim();
          if (name && parentName) childOf[name] = parentName;
        });
        setChildParent(childOf);
        setCategoryOptions(
          Array.from(names.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label, "ru")),
        );
      })
      .catch(() => {
        if (!alive) return;
        setOptions([]);
        setOptionsError("Не удалось загрузить продукты.");
      })
      .finally(() => {
        if (alive) setOptionsLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const trapFocus = (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const optionById = useMemo(() => {
    const map = new Map();
    options.forEach((item) => {
      if (item && item.id) map.set(String(item.id), item);
    });
    return map;
  }, [options]);

  const activeOptions = useMemo(
    () => options.filter((item) => {
      if (!item || !item.id || item.is_active === false) return false;
      if (selectedCategory) {
        const cat = String(item.category || "").trim();
        if (cat !== selectedCategory && childParent[cat] !== selectedCategory) return false;
      }
      return true;
    }),
    [options, selectedCategory, childParent],
  );

  const parsedQty = parseQuantity(qty);
  const canAdd = Boolean(selectedId) && parsedQty !== null && !saving;
  const selectedUnit = optionById.get(String(selectedId))?.unit || "";

  async function persist(nextLines) {
    setSaving(true);
    setError("");
    try {
      const fresh = await onSave(dish.id, nextLines);
      const returned = Array.isArray(fresh?.recipeIngredients) ? fresh.recipeIngredients : null;
      const mapped = (returned || nextLines).map((line) => ({
        ingredient_id: String(line.ingredient_id),
        quantity: Number(line.quantity) || 0,
        warehouse_id: line.warehouse_id ? String(line.warehouse_id) : null,
      }));
      setLines(mapped);
      if (onChanged && fresh) onChanged(fresh);
      return true;
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Не удалось сохранить состав.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(event) {
    event?.preventDefault();
    if (!canAdd) return;
    const lineWarehouse = selectedWarehouse || null;
    const existing = lines.findIndex((line) => line.ingredient_id === selectedId);
    const next = existing >= 0
      ? lines.map((line, index) => (index === existing
        ? { ...line, quantity: parsedQty, warehouse_id: lineWarehouse }
        : line))
      : [...lines, { ingredient_id: selectedId, quantity: parsedQty, warehouse_id: lineWarehouse }];
    const ok = await persist(next);
    if (ok) {
      setSelectedId("");
      setQty("");
    }
  }

  async function handleRemove(index) {
    if (saving) return;
    setRemovingIndex(index);
    try {
      await persist(lines.filter((_, i) => i !== index));
    } finally {
      setRemovingIndex(null);
    }
  }

  function openEdit(index) {
    if (saving) return;
    const line = lines[index];
    if (!line) return;
    setEditingIndex(index);
    setEditQty(formatQuantity(line.quantity));
    setError("");
  }

  function cancelEdit() {
    if (saving || editClosing) return;
    setEditClosing(true);
    window.setTimeout(() => {
      setEditingIndex(null);
      setEditQty("");
      setEditClosing(false);
    }, 160);
  }

  const parsedEditQty = parseQuantity(editQty);
  const canSaveEdit = editingIndex !== null && parsedEditQty !== null && !saving;

  async function saveEdit() {
    if (!canSaveEdit) return;
    const line = lines[editingIndex];
    if (!line) {
      cancelEdit();
      return;
    }
    const next = lines.map((item, i) => (i === editingIndex
      ? { ingredient_id: item.ingredient_id, quantity: parsedEditQty, warehouse_id: item.warehouse_id ?? null }
      : item));
    const ok = await persist(next);
    if (ok) cancelEdit();
  }

  const editLine = editingIndex !== null ? lines[editingIndex] : null;

  // Себестоимость в шапке — итог (ручная база + состав), как в таблице.
  // Разбивка уходит в title: подпись метрики остаётся прежней, но видно,
  // из чего сложилось число.
  const recipeCostSum = Number(dish.recipeCost) || 0;
  const costTotal = dish.costTotal ?? dish.cost;
  const costBreakdown = recipeCostSum > 0
    ? `Карточка ${money(dish.cost)} + состав ${recipeCostSum.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} сум`
    : undefined;

  const nameOf = (ingredientId) => optionById.get(String(ingredientId))?.name || "—";
  const unitOf = (ingredientId) => optionById.get(String(ingredientId))?.unit || "";
  // NULL-склад = списание с главного (та же логика, что у deduct_for_order).
  const warehouseNameOf = (warehouseId) => {
    if (!warehouseId) return "Основной";
    const found = warehouses.find((item) => String(item?.id) === String(warehouseId));
    return found?.name || "—";
  };
  // Итог «граммажности»: суммы по каждой единице отдельно (кг и л не
  // складываются в одно число — это была бы выдумка). Одна единица в составе —
  // один итог, разные — перечисление через « · ».
  const recipeTotals = (() => {
    const byUnit = new Map();
    lines.forEach((line) => {
      const unit = unitOf(line.ingredient_id) || "—";
      byUnit.set(unit, (byUnit.get(unit) || 0) + (Number(line.quantity) || 0));
    });
    return Array.from(byUnit.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([unit, total]) => {
        const rounded = Math.round(total * 1000) / 1000;
        const text = formatQuantity(rounded);
        return unit && unit !== "—" ? `${text} ${unit}` : text;
      })
      .join(" · ");
  })();

  return createPortal(
    <div className={`kpi-info-backdrop owner-modal-backdrop dish-recipes-backdrop ${motionClassName}`}
      style={motionStyle} onMouseDown={requestClose} onAnimationEnd={handleAnimationEnd}>
      <section ref={dialogRef} className="kpi-info-window dish-recipes-dialog" role="dialog"
        aria-modal="true" aria-labelledby="dish-recipes-title" aria-describedby="dish-recipes-dish"
        onMouseDown={(event) => event.stopPropagation()} onKeyDown={trapFocus}>
        <header className="kpi-info-window__head dish-recipes-head">
          <div><h2 id="dish-recipes-title">Рецепты</h2><p id="dish-recipes-dish">{dish.name || "—"}</p></div>
          <dl className="dish-recipes-metric dish-recipes-metric--cost">
            <dt>Себестоимость</dt><dd title={costBreakdown}>{money(costTotal)}</dd>
          </dl>
          <dl className="dish-recipes-metric dish-recipes-metric--price">
            <dt>Цена продажи</dt><dd>{money(dish.price)}</dd>
          </dl>
          <button
            type="button"
            className="dish-head-photo"
            onClick={() => dish.photo && setZoomPhoto(true)}
            aria-label={dish.photo ? `Открыть фото ${dish.name}` : "Фото блюда отсутствует"}
          >
            {dish.photo ? <img src={dish.photo} alt="" /> : <Icon name="bi-image" size={22} />}
          </button>
          <button type="button" className="kpi-info-window__close" aria-label="Закрыть рецепты" onClick={requestClose}>
            <Icon name="bi-x-lg" size={20} />
          </button>
        </header>
        <div className="dish-recipes-body" tabIndex={0} role="region" aria-label="Данные рецепта">
          <form className="dish-recipes-add-row dish-recipes-add-row--composition" onSubmit={handleAdd}>
            <div className="dish-recipes-field">
              <span className="dish-recipes-field-label">Склад</span>
              <DishSingleSelect
                label="Склад"
                placeholder="Выберите склад"
                options={warehouses.map((item) => ({ value: String(item.id), label: item.name }))}
                value={selectedWarehouse}
                onChange={(next) => { setSelectedWarehouse(next || ""); setSelectedId(""); }}
                disabled={saving}
              />
            </div>
            <div className="dish-recipes-field">
              <span className="dish-recipes-field-label">Категория</span>
              <DishSingleSelect
                label="Категория"
                placeholder="Выберите категорию"
                options={categoryOptions}
                value={selectedCategory}
                onChange={(next) => { setSelectedCategory(next || ""); setSelectedId(""); }}
                disabled={saving}
              />
            </div>
            <div className="dish-recipes-field dish-recipes-field--product">
              <span className="dish-recipes-field-label">Продукт</span>
              <DishSingleSelect
                label="Продукт"
                placeholder="Выберите продукт"
                options={activeOptions.map((item) => ({
                  value: String(item.id),
                  label: item.name,
                }))}
                value={selectedId}
                onChange={(next) => {
                  setSelectedId(next);
                  // Снятие выбора (повторный клик по галочке) не должно уводить
                  // курсор из поля — прыгаем в количество только за продуктом.
                  if (next) qtyRef.current?.focus();
                }}
                disabled={saving}
                disabledLabel={optionsError || "Продукт недоступен"}
              />
            </div>
            <label className="dish-recipes-field">
              <span className="dish-recipes-field-label">Кол-во</span>
              <span className="dish-recipes-qty-wrap">
                <input
                  ref={qtyRef}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Количество"
                  value={qty}
                  disabled={saving}
                  onChange={(event) => setQty(event.target.value)}
                />
                {selectedUnit ? <span className="dish-recipes-qty-unit">{selectedUnit}</span> : null}
              </span>
            </label>
            <button type="submit" className="dish-add-button dish-recipes-add" disabled={!canAdd}>
              {saving ? "Сохранение…" : "Добавить"}
            </button>
          </form>
          {optionsError ? <Toast kind="error" message={optionsError} onClose={() => setOptionsError("")} /> : null}
          {error ? <Toast kind="error" message={error} onClose={() => setError("")} /> : null}
          <div className="settings-table-wrapper dish-recipes-table-wrap">
            <div className="dish-recipes-table-scroll">
              <table className="settings-table dish-recipes-table" aria-label="Состав рецепта">
                <colgroup>{[8, 20, 36, 16, 20].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
                <thead><tr>{["№", "Склад", "Продукт", "Кол-во", "Действия"].map((title) => <th key={title}>{title}</th>)}</tr></thead>
                <tbody>
                  {lines.length > 0 ? lines.map((line, index) => (
                    <tr key={`${line.ingredient_id}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{warehouseNameOf(line.warehouse_id)}</td>
                      <td>{nameOf(line.ingredient_id)}</td>
                      <td>{formatQuantity(line.quantity)}{unitOf(line.ingredient_id) ? ` ${unitOf(line.ingredient_id)}` : ""}</td>
                      <td><div className="dish-row-actions">
                        <button type="button" disabled={saving} onClick={() => openEdit(index)} aria-label="Изменить ингредиент"><Icon name="bi-pencil" size={15} /></button>
                        <button type="button" className="danger" disabled={saving || removingIndex === index} onClick={() => handleRemove(index)} aria-label="Удалить ингредиент"><Icon name="bi-trash3" size={15} /></button>
                      </div></td>
                    </tr>
                  )) : <tr><td colSpan={5} className="dish-recipes-empty-cell">
                    <ReportEmptyState title="Состав рецепта пока пуст" />
                  </td></tr>}
                </tbody>
                {lines.length > 0 ? (
                  <tfoot>
                    <tr className="dish-recipes-total-row">
                      <td colSpan={3} className="dish-recipes-total-label">Итого</td>
                      <td className="dish-recipes-total-value" aria-label="Сумма по составу">{recipeTotals || "—"}</td>
                      <td aria-hidden="true" />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>
        </div>
          {editLine ? (
            <div className={`dish-edit-overlay dish-edit-overlay--boxed${editClosing ? " is-closing" : ""}`} onMouseDown={cancelEdit}>
              <section
                className="dish-edit-card"
                role="dialog"
                aria-modal="true"
                aria-label="Изменить ингредиент"
                onMouseDown={(event) => event.stopPropagation()}
                // Enter в поле количества = «Сохранить»: панель не форма,
                // поэтому без этого клавиша не делала ничего. Кнопки Enter
                // обрабатывают сами — перехватываем только ввод в input.
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.target.tagName !== "INPUT") return;
                  event.preventDefault();
                  saveEdit();
                }}
              >
                <h3>Изменить ингредиент</h3>
                <p>{nameOf(editLine.ingredient_id)}</p>
                <label className="dish-recipes-field">
                  <span className="dish-recipes-field-label">Кол-во</span>
                  <span className="dish-recipes-qty-wrap">
                    <input
                      inputMode="decimal"
                      placeholder="0"
                      aria-label="Количество ингредиента"
                      value={editQty}
                      disabled={saving}
                      onChange={(event) => setEditQty(event.target.value)}
                    />
                    {unitOf(editLine.ingredient_id) ? (
                      <span className="dish-recipes-qty-unit">{unitOf(editLine.ingredient_id)}</span>
                    ) : null}
                  </span>
                </label>
                <div className="dish-edit-actions">
                  <button type="button" className="dish-add-button" disabled={!canSaveEdit} onClick={saveEdit}>
                    {saving ? "Сохранение…" : "Сохранить"}
                  </button>
                  <button type="button" className="dish-recipes-clear" disabled={saving} onClick={cancelEdit}>
                    Отмена
                  </button>
                </div>
              </section>
            </div>
          ) : null}
          {zoomPhoto && dish.photo ? createPortal(
            <div className={`dish-photo-viewer-layer${zoomClosing ? " is-closing" : ""}`}>
              <div
                className="dish-photo-viewer-overlay"
                role="presentation"
                onClick={closeZoom}
              />
              <div
                className="dish-photo-viewer"
                role="dialog"
                aria-modal="true"
                aria-label={`Фото «${dish.name}»`}
              >
                <button
                  type="button"
                  className="dish-photo-viewer__close"
                  onClick={closeZoom}
                  aria-label="Закрыть фото"
                >
                  <Icon name="bi-x-lg" size={18} />
                </button>
                <img src={dish.photo} alt={`Фото «${dish.name}»`} />
              </div>
            </div>,
            document.body,
          ) : null}
      </section>
    </div>, document.body,
  );
}

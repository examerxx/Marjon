import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import ReportEmptyState from "../../components/ReportEmptyState";
import { useAnchoredDialogMotion } from "../../hooks/useAnchoredDialogMotion";
import { catalogService } from "../../api/catalog";
import DishSingleSelect from "./DishSingleSelect";

const money = (value) => value ? String(value).replace(/\s*UZS$/i, " сум") : "—";

function parseQuantity(raw) {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parsePrice(raw) {
  const text = String(raw ?? "").trim().replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// Количество/цена в таблице без висячих нулей: 2.0000 → 2, 2.5000 → 2,5,
// тысячи группируем: 23000 → 23 000.
function formatAmount(value) {
  const num = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(num)) return "";
  const [int, dec] = String(Math.round(num * 10000) / 10000).split(".");
  const grouped = Number(int).toLocaleString("ru-RU", { maximumFractionDigits: 0 })
    .replace(/[\u00a0\u202f]/g, " ");
  return dec ? `${grouped},${dec}` : grouped;
}

// Группировка ввода цены/суммы: 12000 → 12 000 (парсинг пробелы режет,
// нулевые копейки отбрасываем: 40000.00 → 40 000).
function groupPriceInput(raw) {
  const text = String(raw ?? "").replace(/[\s]/g, "");
  const match = text.match(/^(\d+)([.,](\d{0,2}))?$/);
  if (!match) return String(raw ?? "");
  const grouped = Number(match[1]).toLocaleString("ru-RU", { maximumFractionDigits: 0 })
    .replace(/[\u00a0\u202f]/g, " ");
  const dec = match[3] || "";
  if (!dec || /^0+$/.test(dec)) return grouped;
  return `${grouped},${dec}`;
}

const groupSum = (num) => (Number.isFinite(num)
  ? new Intl.NumberFormat("ru-RU").format(num).replace(/[\u00a0\u202f]/g, " ")
  : "—");

// Состав сета (комбо): блюда внутри блюда. Наш шелл диалога рецептов,
// структура формы/таблицы — по референсу ZimZim: Категория + Товар +
// Кол-во + Цена + Сумма + Добавить/Очистить. Сохранение — канонический
// PUT set-items (replace), счётчик строки обновляет saveSetItems.
export default function DishesSetDialog({ dish, rows = [], onClose, returnFocusRef, onSave }) {
  // Слои поверх диалога (просмотр фото, панель правки) — объявлены раньше
  // хука: моушн глушит свой Escape, пока открыт любой из них.
  const [editingIndex, setEditingIndex] = useState(null);
  const [zoomPhoto, setZoomPhoto] = useState(false);
  const { dialogRef, motionClassName, motionStyle, requestClose, handleAnimationEnd } = useAnchoredDialogMotion({
    isOpen: true, onClose, returnFocusRef, motionMode: "center",
    escapeDisabled: zoomPhoto || editingIndex !== null,
  });
  const setId = String(dish?.id || "");
  const [lines, setLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(true);
  const [linesError, setLinesError] = useState("");
  const [options, setOptions] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [allChildParent, setAllChildParent] = useState({});
  // Сырые категории справочника: по слагу видно чужое дерево
  // (sales-*/raw-*/semi-*), чтобы не тащить его в чужой Тип.
  const [allCats, setAllCats] = useState([]);
  // Тип компонента: Блюдо (product_type dish) или Товар (sale). Дефолт — Блюдо.
  const [selectedKind, setSelectedKind] = useState("dish");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  // Ручная сумма: пусто = авто (кол-во × цена); набрано = цена выводится из неё.
  const [sumText, setSumText] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingIndex, setRemovingIndex] = useState(null);
  const [error, setError] = useState("");
  // Центр-панель правки строки (карандаш таблицы): без удаления до сейва.
  const [editQty, setEditQty] = useState("");
  const [editSum, setEditSum] = useState("");
  const [editSumManual, setEditSumManual] = useState(false);
  const [zoomClosing, setZoomClosing] = useState(false);
  const [editClosing, setEditClosing] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = previousOverflow; };
  }, [dialogRef]);

  // Вложенные слои перехватывают Escape сами (хук диалога в это время молчит):
  // просмотр фото и панель правки закрываются, сет остаётся открыт.
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
    setLinesLoading(true);
    setLinesError("");
    catalogService.listSetItems(setId)
      .then(({ data }) => {
        if (!alive) return;
        setLines(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!alive) return;
        setLines([]);
        setLinesError(err.response?.data?.detail || err.message || "Не удалось загрузить состав сета.");
      })
      .finally(() => {
        if (alive) setLinesLoading(false);
      });
    return () => { alive = false; };
  }, [setId]);

  useEffect(() => {
    let alive = true;
    setOptionsLoading(true);
    setOptionsError("");
    Promise.all([
      catalogService.listProducts({ params: { include_all: true } }),
      catalogService.listCategories().catch(() => ({ data: [] })),
    ])
      .then(([productsRes, categoriesRes]) => {
        if (!alive) return;
        const items = Array.isArray(productsRes?.data) ? productsRes.data : productsRes?.data?.items || [];
        setOptions(items);
        const cats = categoriesRes?.data;
        const list = Array.isArray(cats) ? cats : cats?.items || [];
        // Только подписи «Дитя (Родитель)»: сами опции Категории берём из
        // загруженных товаров (их category_name — истина), иначе при слагах
        // без префикса список пуст и панель нечего показать.
        const byId = new Map();
        list.forEach((item) => {
          if (item?.id) byId.set(String(item.id), item);
        });
        const childOf = {};
        list.forEach((item) => {
          const name = String(item?.name || "").trim();
          const parent = item?.parent_id ? byId.get(String(item.parent_id)) : null;
          const parentName = String(parent?.name || "").trim();
          if (name && parentName) childOf[name] = parentName;
        });
        setAllChildParent(childOf);
        setAllCats(list);
      })
      .catch(() => {
        if (!alive) return;
        setOptions([]);
        setOptionsError("Не удалось загрузить блюда.");
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

  // Чужое дерево: имя → множество видов по слагам (dish/sales/raw/semi).
  // Без префикса (старые категории блюд) — своё для любого Типа.
  const nameKinds = useMemo(() => {
    const map = new Map();
    allCats.forEach((item) => {
      const name = String(item?.name || "").trim();
      if (!name) return;
      const slug = String(item?.slug || "");
      const kind = ["dish", "sales", "raw", "semi"].find((prefix) => slug.startsWith(prefix));
      if (!kind) return;
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(kind);
    });
    return map;
  }, [allCats]);
  const isCategoryAllowed = useCallback((kind, name) => {
    const kinds = nameKinds.get(name);
    if (!kinds || kinds.size === 0) return true;
    return kinds.has(kind === "sale" ? "sales" : "dish");
  }, [nameKinds]);

  // Подпись поля и колонки — по Типу: Блюдо | Товар.
  const kindWord = selectedKind === "sale" ? "Товар" : "Блюдо";
  const kindPlaceholder = selectedKind === "sale" ? "Выберите товар" : "Выберите блюдо";
  // Категории — из загруженных товаров выбранного Типа (их category_name),
  // подпись «Дитя (Родитель)» — из справочника. Пустых списков нет, чужие
  // подкатегории (товары в блюдах и наоборот) отрезаны.
  const productCategoryNames = useMemo(() => {
    const names = new Set();
    options.forEach((item) => {
      if (!item || !item.id || item.is_active === false) return;
      if (String(item.id) === setId) return;
      if (String(item.product_type || "dish") !== selectedKind) return;
      const name = String(item.category_name || "").trim();
      if (name && isCategoryAllowed(selectedKind, name)) names.add(name);
    });
    return [...names].sort((a, b) => a.localeCompare(b, "ru"));
  }, [options, selectedKind, setId, isCategoryAllowed]);
  const categoryOptions = useMemo(() => productCategoryNames.map((name) => ({
    value: name,
    label: allChildParent[name] ? `${name} (${allChildParent[name]})` : name,
  })), [productCategoryNames, allChildParent]);
  const childParent = allChildParent;

  // Компоненты — только активные позиции выбранного Типа, без самого сета,
  // других сетов, архива и чужих категорий.
  // Флаг allow_in_sets список НЕ фильтрует: колонку-тумблер «СЕТ», которая
  // единственная его включала, убрали из таблицы блюд (ea3a4ce), поэтому флаг
  // у всех остался false и список компонентов был пуст всегда (баг «в сете не
  // видно блюд»). Вложенные сеты запрещены — рекурсия в составе не поддержана.
  const activeOptions = useMemo(
    () => options.filter((item) => {
      if (!item || !item.id || item.is_active === false) return false;
      if (String(item.id) === setId) return false;
      if (item.is_set === true) return false;
      if (String(item.product_type || "dish") !== selectedKind) return false;
      const cat = String(item.category_name || "").trim();
      if (cat && !isCategoryAllowed(selectedKind, cat)) return false;
      if (selectedCategory) {
        if (cat !== selectedCategory && childParent[cat] !== selectedCategory) return false;
      }
      return true;
    }),
    [options, selectedKind, selectedCategory, childParent, setId, isCategoryAllowed],
  );

  // Ед.изм и имена — из строк каталога (канонический unit_id → подпись),
  // сырой product.unit врёт дефолтом «шт».
  const rowById = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      if (row && row.id) map.set(String(row.id), row);
    });
    return map;
  }, [rows]);

  const parsedQty = parseQuantity(qty);
  const parsedPrice = parsePrice(price);
  const canAdd = Boolean(selectedId) && parsedQty !== null && parsedPrice !== null && !saving;
  const autoSum = parsedQty !== null && parsedPrice !== null ? parsedQty * parsedPrice : null;
  const setTotal = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.price) || 0), 0);
  // Себестоимость шапки — живая: сумма (себестоимость компонента × кол-во).
  // Пустой сет — собственная себестоимость сета.
  const setCost = lines.reduce((sum, line) => {
    const item = optionById.get(String(line.product_id));
    const cost = Number(item?.cost_price ?? 0) || 0;
    return sum + cost * (Number(line.quantity) || 0);
  }, 0);
  const headerCost = lines.length > 0 ? `${groupSum(setCost)} сум` : money(dish.cost);
  const selectedUnit = rowById.get(String(selectedId))?.unit
    || optionById.get(String(selectedId))?.unit || "";

  function pickDish(id) {
    setSelectedId(id);
    const item = optionById.get(String(id));
    // Цена по умолчанию — цена блюда, правится вручную.
    if (item?.price != null) setPrice(groupPriceInput(String(item.price)));
    setSumText("");
  }

  function handleQtyChange(raw) {
    setQty(raw);
    setSumText("");
  }

  function handlePriceChange(raw) {
    setPrice(groupPriceInput(raw));
    setSumText("");
  }

  function handleSumChange(raw) {
    const grouped = groupPriceInput(raw);
    setSumText(grouped);
    const sum = parsePrice(grouped);
    const q = parseQuantity(qty);
    // Ручная сумма + кол-во → цена выводится сама (округление до копеек).
    if (sum !== null && q !== null) setPrice(groupPriceInput(String(Math.round((sum / q) * 100) / 100)));
  }

  function clearForm() {
    setSelectedCategory("");
    setSelectedId("");
    setQty("");
    setPrice("");
    setSumText("");
  }

  async function persist(nextLines) {
    setSaving(true);
    setError("");
    try {
      const fresh = await onSave(setId, nextLines);
      const mapped = (Array.isArray(fresh) ? fresh : []).map((line) => ({
        product_id: String(line.product_id),
        quantity: Number(line.quantity) || 0,
        price: Number(line.price) || 0,
      }));
      setLines(mapped);
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
    const existing = lines.findIndex((line) => String(line.product_id) === String(selectedId));
    const row = { product_id: String(selectedId), quantity: parsedQty, price: parsedPrice };
    const next = existing >= 0
      ? lines.map((line, index) => (index === existing ? row : line))
      : [...lines, row];
    const ok = await persist(next);
    if (ok) clearForm();
  }

  async function handleRemove(index) {
    if (saving) return;
    const line = lines[index];
    if (!line) return;
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
    setEditQty(formatAmount(line.quantity));
    const auto = (Number(line.quantity) || 0) * (Number(line.price) || 0);
    setEditSum(groupSum(Math.round(auto * 100) / 100));
    setEditSumManual(false);
    setError("");
  }

  function cancelEdit() {
    if (saving || editClosing) return;
    setEditClosing(true);
    window.setTimeout(() => {
      setEditingIndex(null);
      setEditQty("");
      setEditSum("");
      setEditSumManual(false);
      setEditClosing(false);
    }, 160);
  }

  function handleEditQty(raw) {
    setEditQty(raw);
    const line = lines[editingIndex];
    const q = parseQuantity(raw);
    const price = Number(line?.price) || 0;
    if (q !== null) {
      setEditSum(groupSum(Math.round(q * price * 100) / 100));
      setEditSumManual(false);
    }
  }

  function handleEditSum(raw) {
    setEditSum(groupPriceInput(raw));
    setEditSumManual(true);
  }

  const parsedEditQty = parseQuantity(editQty);
  const parsedEditSum = parsePrice(editSum);
  const canSaveEdit = editingIndex !== null && parsedEditQty !== null && parsedEditSum !== null && !saving;

  async function saveEdit() {
    if (!canSaveEdit) return;
    const line = lines[editingIndex];
    if (!line) {
      cancelEdit();
      return;
    }
    const price = editSumManual
      ? Math.round((parsedEditSum / parsedEditQty) * 100) / 100
      : Number(line.price) || 0;
    const next = lines.map((item, i) => (i === editingIndex
      ? { product_id: String(item.product_id), quantity: parsedEditQty, price }
      : item));
    const ok = await persist(next);
    if (ok) cancelEdit();
  }

  const nameOf = (productId) => rowById.get(String(productId))?.name
    || optionById.get(String(productId))?.name || "—";
  const unitOf = (productId) => rowById.get(String(productId))?.unit
    || optionById.get(String(productId))?.unit || "";

  const editLine = editingIndex !== null ? lines[editingIndex] : null;
  const editUnit = editLine ? unitOf(editLine.product_id) : "";

  return createPortal(
    <div className={`kpi-info-backdrop owner-modal-backdrop dish-recipes-backdrop ${motionClassName}`}
      style={motionStyle} onMouseDown={requestClose} onAnimationEnd={handleAnimationEnd}>
      <section ref={dialogRef} className="kpi-info-window dish-recipes-dialog dish-set-dialog" role="dialog"
        aria-modal="true" aria-labelledby="dish-set-title" aria-describedby="dish-set-dish"
        onMouseDown={(event) => event.stopPropagation()} onKeyDown={trapFocus}>
        <header className="kpi-info-window__head dish-recipes-head">
          <div><h2 id="dish-set-title">Сет</h2><p id="dish-set-dish">{dish.name || "—"}</p></div>
          <dl className="dish-recipes-metric dish-set-metric--sale">
            <dt>Цена продажи</dt><dd>{money(dish.price)}</dd>
          </dl>
          <dl className="dish-recipes-metric dish-set-metric--cost">
            <dt>Себестоимость</dt><dd>{headerCost}</dd>
          </dl>
          <dl className="dish-recipes-metric dish-set-metric--total">
            <dt>Сумма набора</dt><dd>{setTotal ? `${groupSum(setTotal)} сум` : "—"}</dd>
          </dl>
          <button
            type="button"
            className="dish-head-photo"
            onClick={() => dish.photo && setZoomPhoto(true)}
            aria-label={dish.photo ? `Открыть фото ${dish.name}` : "Фото блюда отсутствует"}
          >
            {dish.photo ? <img src={dish.photo} alt="" /> : <Icon name="bi-image" size={22} />}
          </button>
          <button type="button" className="kpi-info-window__close" aria-label="Закрыть сет" onClick={requestClose}>
            <Icon name="bi-x-lg" size={20} />
          </button>
        </header>
        <div className="dish-recipes-body" tabIndex={0} role="region" aria-label="Состав сета">
          <form className="dish-recipes-add-row dish-set-add-row" onSubmit={handleAdd}>
            <div className="dish-recipes-field">
              <span className="dish-recipes-field-label">Тип</span>
              <DishSingleSelect
                label="Тип"
                placeholder="Выберите тип"
                options={[
                  { value: "dish", label: "Блюдо" },
                  { value: "sale", label: "Товар" },
                ]}
                value={selectedKind}
                onChange={(next) => { setSelectedKind(next || "dish"); setSelectedCategory(""); setSelectedId(""); }}
                disabled={saving}
              />
            </div>
            <div className="dish-recipes-field">
              <span className="dish-recipes-field-label">Категория</span>
              <DishSingleSelect
                label="Категория"
                placeholder="Выберите категорию"
                emptyLabel="Нет категорий"
                options={categoryOptions}
                value={selectedCategory}
                onChange={(next) => { setSelectedCategory(next || ""); setSelectedId(""); }}
                disabled={saving}
              />
            </div>
            <div className="dish-recipes-field dish-recipes-field--product">
              <span className="dish-recipes-field-label">{kindWord}</span>
              <DishSingleSelect
                label={kindWord}
                placeholder={kindPlaceholder}
                emptyLabel={selectedKind === "sale" ? "Нет доступных товаров" : "Нет доступных блюд"}
                options={activeOptions.map((item) => ({
                  value: String(item.id),
                  label: item.name,
                }))}
                value={selectedId}
                onChange={pickDish}
                disabled={saving}
                disabledLabel={optionsError || "Товары недоступны"}
              />
            </div>
            <label className="dish-recipes-field">
              <span className="dish-recipes-field-label">Кол-во</span>
              <span className="dish-recipes-qty-wrap">
                <input
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Количество"
                  value={qty}
                  disabled={saving}
                  onChange={(event) => handleQtyChange(event.target.value)}
                />
                {selectedUnit ? <span className="dish-recipes-qty-unit">{selectedUnit}</span> : null}
              </span>
            </label>
            <label className="dish-recipes-field">
              <span className="dish-recipes-field-label">Цена</span>
              <span className="dish-recipes-qty-wrap">
                <input
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Цена в сете"
                  value={price}
                  disabled={saving}
                  onChange={(event) => handlePriceChange(event.target.value)}
                />
                <span className="dish-recipes-qty-unit">сум</span>
              </span>
            </label>
            <label className="dish-recipes-field">
              <span className="dish-recipes-field-label">Сумма</span>
              <span className="dish-recipes-qty-wrap">
                <input
                  className="dish-set-sum"
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Сумма в сете"
                  value={sumText !== "" ? sumText : (autoSum !== null ? groupSum(autoSum) : "")}
                  disabled={saving}
                  onChange={(event) => handleSumChange(event.target.value)}
                />
                <span className="dish-recipes-qty-unit">сум</span>
              </span>
            </label>
            <button type="submit" className="dish-add-button dish-recipes-add" disabled={!canAdd}>
              {saving ? "Сохранение…" : "Добавить"}
            </button>
            <button type="button" className="dish-recipes-clear" onClick={clearForm} disabled={saving}>
              Очистить
            </button>
          </form>
          {optionsError ? <Toast kind="error" message={optionsError} onClose={() => setOptionsError("")} /> : null}
          {linesError ? <Toast kind="error" message={linesError} onClose={() => setLinesError("")} /> : null}
          {error ? <Toast kind="error" message={error} onClose={() => setError("")} /> : null}
          <div className={`settings-table-wrapper dish-recipes-table-wrap${linesLoading ? " is-loading" : ""}`}>
            <div className="dish-recipes-table-scroll">
              <table className="settings-table dish-recipes-table" aria-label="Состав сета">
                <colgroup>{[8, 32, 14, 16, 16, 14].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
                <thead><tr>{["№", selectedKind === "sale" ? "ТОВАР" : "БЛЮДО", "Кол-во", "Цена", "Сумма", "Действия"].map((title) => <th key={title}>{title}</th>)}</tr></thead>
                <tbody aria-busy={linesLoading || undefined}>
                  {linesLoading ? (
                    // Скелетон в геометрии ожидаемого финала, чтобы подмена не
                    // двигала диалог посреди enter-анимации, как статичные
                    // Рецепты: ряды — в высоту строк данных, пустота — в высоту
                    // компактной иллюстрации «Состав сета пока пуст».
                    (Number(dish?.setItemsCount) || 0) > 0 ? (
                      Array.from({ length: Math.max(Number(dish.setItemsCount) || 0, 1) }).map((_, index) => (
                        <tr key={`set-skeleton-${index}`} aria-hidden="true">
                          <td colSpan={6} className="dish-set-skeleton-cell"><span className="dish-set-skeleton-bar" /></td>
                        </tr>
                      ))
                    ) : (
                      <tr key="set-skeleton-empty" aria-hidden="true">
                        <td colSpan={6} className="dish-set-skeleton-cell dish-set-skeleton-cell--empty">
                          <span className="dish-set-skeleton-empty">
                            <span className="dish-set-skeleton-empty__image" />
                            <span className="dish-set-skeleton-bar dish-set-skeleton-bar--title" />
                          </span>
                        </td>
                      </tr>
                    )
                  ) : lines.length > 0 ? lines.map((line, index) => (
                    <tr key={`${line.product_id}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{nameOf(line.product_id)}</td>
                      <td>{formatAmount(line.quantity)}{unitOf(line.product_id) ? ` ${unitOf(line.product_id)}` : ""}</td>
                      <td>{formatAmount(line.price)} сум</td>
                      <td>{groupSum((Number(line.quantity) || 0) * (Number(line.price) || 0))} сум</td>
                      <td><div className="dish-row-actions">
                        <button type="button" disabled={saving} onClick={() => openEdit(index)} aria-label="Изменить позицию"><Icon name="bi-pencil" size={15} /></button>
                        <button type="button" className="danger" disabled={saving || removingIndex === index} onClick={() => handleRemove(index)} aria-label="Удалить позицию"><Icon name="bi-trash3" size={15} /></button>
                      </div></td>
                    </tr>
                  )) : <tr><td colSpan={6} className="dish-recipes-empty-cell">
                    <ReportEmptyState title="Состав сета пока пуст" />
                  </td></tr>}
                </tbody>
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
                aria-label="Изменить позицию"
                onMouseDown={(event) => event.stopPropagation()}
                // Enter в полях количества/суммы = «Сохранить» (панель не форма).
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.target.tagName !== "INPUT") return;
                  event.preventDefault();
                  saveEdit();
                }}
              >
                <h3>Изменить позицию</h3>
                <p>{nameOf(editLine.product_id)}</p>
                <label className="dish-recipes-field">
                  <span className="dish-recipes-field-label">Кол-во</span>
                  <span className="dish-recipes-qty-wrap">
                    <input
                      inputMode="decimal"
                      placeholder="0"
                      aria-label="Количество позиции"
                      value={editQty}
                      disabled={saving}
                      onChange={(event) => handleEditQty(event.target.value)}
                    />
                    {editUnit ? <span className="dish-recipes-qty-unit">{editUnit}</span> : null}
                  </span>
                </label>
                <label className="dish-recipes-field">
                  <span className="dish-recipes-field-label">Сумма</span>
                  <span className="dish-recipes-qty-wrap">
                    <input
                      className="dish-set-sum"
                      inputMode="decimal"
                      placeholder="0"
                      aria-label="Сумма позиции"
                      value={editSum}
                      disabled={saving}
                      onChange={(event) => handleEditSum(event.target.value)}
                    />
                    <span className="dish-recipes-qty-unit">сум</span>
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

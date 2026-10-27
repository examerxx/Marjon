import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import ReportEmptyState from "../../components/ReportEmptyState";
import { useAnchoredDialogMotion } from "../../hooks/useAnchoredDialogMotion";
import { nomenclatureService } from "../../api/nomenclature";
import DishSingleSelect from "./DishSingleSelect";
import recipeBookPng from "../../assets/recipes-cook-book.png";
import { t } from "../../i18n/t";

function parseQuantity(raw) {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatQuantity(value) {
  return String(value ?? "").replace(".", ",");
}

function productLinesOf(product) {
  if (Array.isArray(product?.ingredients)) return product.ingredients;
  if (Array.isArray(product?.recipeIngredients)) return product.recipeIngredients;
  return [];
}

function linesFromProducts(list, ingredientId) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((product) => {
    if (!product?.id) return;
    const hit = productLinesOf(product).find(
      (line) => String(line?.ingredient_id) === String(ingredientId),
    );
    if (hit) out.push({
      product_id: String(product.id),
      quantity: Number(hit.quantity) || 0,
      warehouse_id: hit.warehouse_id ? String(hit.warehouse_id) : null,
    });
  });
  return out;
}

// Exact user-provided PNG alpha mask; the badge supplies its state color.
function UsagePngIcon() {
  return (
    <span
      className="dish-recipe-icon"
      aria-hidden="true"
      style={{ maskImage: `url(${recipeBookPng})`, WebkitMaskImage: `url(${recipeBookPng})` }}
    />
  );
}

// Кнопка колонки «Блюда»: тот же визуал, что «Рецепты» у блюд
// (icon + text-ссылка dish-recipe-link). Есть использования —
// синее «Блюда (N шт)», нет — нейтральное «Блюда».
export function IngredientDishesBadge({ count, onClick }) {
  const amount = Number(count) || 0;
  if (amount > 0) {
    return (
      <button type="button" className="dish-recipe-link is-filled" onClick={onClick} aria-haspopup="dialog">
        <UsagePngIcon />{t("pages.nomenclature.rawingredientdishesdialog.blyuda")}{amount} {t("pages.nomenclature.rawingredientdishesdialog.sht")}
      </button>
    );
  }
  return (
    <button type="button" className="dish-recipe-link is-empty" onClick={onClick} aria-haspopup="dialog">
      <UsagePngIcon />{t("pages.nomenclature.rawingredientdishesdialog.blyuda_2")}
    </button>
  );
}

// Использование сырья в блюдах — зеркало DishesRecipesDialog:
// сырьё фиксировано (текущая строка), управляем списком блюд.
// V36: склад строки — сохраняемое поле (пусто = главный склад,
// списание идёт со склада строки). Типа и колонки Сырьё нет —
// хранятся только Блюдо + Склад + Кол-во. Сохранение — тот же
// канонический PATCH /inventory/products/{id} {ingredients} через onSave.
export default function RawIngredientDishesDialog({ ingredient, products, productsError, onClearProductsError = null, onClose, returnFocusRef, onSave, onChanged }) {
  const { dialogRef, motionClassName, motionStyle, requestClose, handleAnimationEnd } = useAnchoredDialogMotion({
    isOpen: true, onClose, returnFocusRef, motionMode: "center",
  });
  const ingredientId = String(ingredient?.id || "");
  const [lines, setLines] = useState(() => linesFromProducts(products, ingredientId));
  const [warehouses, setWarehouses] = useState([]);
  const [selectedDish, setSelectedDish] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingIndex, setRemovingIndex] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    nomenclatureService.listWarehouses()
      .then(({ data }) => {
        if (!alive) return;
        setWarehouses(Array.isArray(data) ? data : data?.items || []);
      })
      .catch(() => {
        if (alive) setWarehouses([]);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = previousOverflow; };
  }, [dialogRef]);

  const trapFocus = (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const productById = useMemo(() => {
    const map = new Map();
    (Array.isArray(products) ? products : []).forEach((item) => {
      if (item && item.id) map.set(String(item.id), item);
    });
    return map;
  }, [products]);

  const dishOptions = useMemo(
    () => (Array.isArray(products) ? products : []).filter(
      (item) => item && item.id && item.is_active !== false,
    ),
    [products],
  );

  const parsedQty = parseQuantity(qty);
  const canAdd = Boolean(selectedDish) && parsedQty !== null && !saving;

  function fullLinesOf(productId) {
    return productLinesOf(productById.get(String(productId)))
      .map((line) => ({
        ingredient_id: String(line?.ingredient_id || ""),
        quantity: Number(line?.quantity) || 0,
        warehouse_id: line?.warehouse_id ? String(line.warehouse_id) : null,
      }))
      .filter((line) => line.ingredient_id);
  }

  async function persist(productId, nextFull) {
    setSaving(true);
    setError("");
    try {
      const fresh = await onSave(productId, nextFull);
      const freshLines = Array.isArray(fresh?.ingredients)
        ? fresh.ingredients
        : (Array.isArray(fresh?.recipeIngredients) ? fresh.recipeIngredients : nextFull);
      const hit = freshLines.find((line) => String(line?.ingredient_id) === ingredientId);
      setLines((current) => {
        const without = current.filter((line) => line.product_id !== String(productId));
        return hit
          ? [...without, {
            product_id: String(productId),
            quantity: Number(hit.quantity) || 0,
            warehouse_id: hit.warehouse_id ? String(hit.warehouse_id) : null,
          }]
          : without;
      });
      if (onChanged) onChanged(productId, fresh);
      return true;
    } catch (err) {
      setError(err.response?.data?.detail || err.message || t("pages.nomenclature.rawingredientdishesdialog.error.save"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(event) {
    event?.preventDefault();
    if (!canAdd) return;
    const current = fullLinesOf(selectedDish).filter((line) => line.ingredient_id !== ingredientId);
    const ok = await persist(selectedDish, [...current, {
      ingredient_id: ingredientId,
      quantity: parsedQty,
      warehouse_id: selectedWarehouse || null,
    }]);
    if (ok) {
      setSelectedDish("");
      setSelectedWarehouse("");
      setQty("");
    }
  }

  async function handleRemove(index) {
    if (saving) return;
    const line = lines[index];
    if (!line) return;
    setRemovingIndex(index);
    try {
      await persist(
        line.product_id,
        fullLinesOf(line.product_id).filter((item) => item.ingredient_id !== ingredientId),
      );
    } finally {
      setRemovingIndex(null);
    }
  }

  const nameOf = (productId) => {
    const product = productById.get(String(productId));
    if (!product) return "—";
    const name = String(product.name || "—");
    return product.is_active === false ? `${name} (${t("common.archived_suffix")})` : name;
  };
  // NULL-склад = списание с главного (та же логика, что у deduct_for_order).
  const warehouseNameOf = (warehouseId) => {
    if (!warehouseId) return t("pages.nomenclature.rawingredientdishesdialog.osnovnoy");
    const found = warehouses.find((item) => String(item?.id) === String(warehouseId));
    return found?.name || "—";
  };

  return createPortal(
    <div className={`kpi-info-backdrop owner-modal-backdrop dish-recipes-backdrop ${motionClassName}`}
      style={motionStyle} onMouseDown={requestClose} onAnimationEnd={handleAnimationEnd}>
      <section ref={dialogRef} className="kpi-info-window dish-recipes-dialog" role="dialog"
        aria-modal="true" aria-labelledby="raw-dishes-title" aria-describedby="raw-dishes-ingredient"
        onMouseDown={(event) => event.stopPropagation()} onKeyDown={trapFocus}>
        <header className="kpi-info-window__head dish-recipes-head">
          <div><h2 id="raw-dishes-title">{t("pages.nomenclature.rawingredientdishesdialog.blyuda_2")}</h2><p id="raw-dishes-ingredient">{ingredient?.name || "—"}</p></div>
          <button type="button" className="kpi-info-window__close" aria-label={t("pages.nomenclature.rawingredientdishesdialog.zakryt_blyuda")} onClick={requestClose}>
            <Icon name="bi-x-lg" size={20} />
          </button>
        </header>
        <div className="dish-recipes-body" tabIndex={0} role="region" aria-label={t("pages.nomenclature.rawingredientdishesdialog.ispolzovanie_syrya_v_blyudah")}>
          <form className="dish-recipes-add-row" onSubmit={handleAdd}>
            <div className="dish-recipes-field">
              <span className="dish-recipes-field-label">{t("pages.nomenclature.rawingredientdishesdialog.sklad")}</span>
              <DishSingleSelect
                label={t("pages.nomenclature.rawingredientdishesdialog.sklad")}
                placeholder={t("pages.nomenclature.rawingredientdishesdialog.osnovnoy")}
                options={warehouses.map((item) => ({ value: String(item.id), label: item.name }))}
                value={selectedWarehouse}
                onChange={setSelectedWarehouse}
                disabled={saving}
                disabledLabel={t("common.warehouses_unavailable")}
              />
            </div>
            <div className="dish-recipes-field dish-recipes-field--product">
              <span className="dish-recipes-field-label">{t("pages.nomenclature.rawingredientdishesdialog.blyudo")}</span>
              <DishSingleSelect
                label={t("pages.nomenclature.rawingredientdishesdialog.blyudo")}
                placeholder={t("pages.nomenclature.rawingredientdishesdialog.vyberite_blyudo")}
                options={dishOptions.map((item) => ({ value: String(item.id), label: item.name }))}
                value={selectedDish}
                onChange={setSelectedDish}
                disabled={saving}
                disabledLabel={t("common.dishes_unavailable")}
              />
            </div>
            <label className="dish-recipes-field">
              <span className="dish-recipes-field-label">{t("pages.nomenclature.rawingredientdishesdialog.kol_vo")}</span>
              <span className="dish-recipes-qty-wrap">
                <input
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={t("pages.nomenclature.rawingredientdishesdialog.kolichestvo")}
                  value={qty}
                  disabled={saving}
                  onChange={(event) => setQty(event.target.value)}
                />
                {ingredient?.unit ? (
                  <span className="dish-recipes-qty-unit" aria-hidden="true">{ingredient.unit}</span>
                ) : null}
              </span>
            </label>
            <button type="submit" className="dish-add-button dish-recipes-add" disabled={!canAdd}>
              {saving ? t("staff.saving") : t("common.add")}
            </button>
          </form>
          {productsError ? <Toast kind="error" message={productsError} onClose={onClearProductsError || undefined} /> : null}
          {error ? <Toast kind="error" message={error} onClose={() => setError("")} /> : null}
          <div className="settings-table-wrapper dish-recipes-table-wrap">
            <div className="dish-recipes-table-scroll">
              <table className="settings-table dish-recipes-table" aria-label={t("pages.nomenclature.rawingredientdishesdialog.blyuda_iz_produktov")}>
                <colgroup>{[8, 20, 32, 20, 20].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
                <thead><tr><th>{t("common.number_sign")}</th><th>{t("pages.nomenclature.rawingredientdishesdialog.sklad")}</th><th>{t("pages.nomenclature.rawingredientdishesdialog.blyudo")}</th><th>{t("pages.nomenclature.rawingredientdishesdialog.kol_vo")}</th><th>{t("common.actions")}</th></tr></thead>
                <tbody>
                  {lines.length > 0 ? lines.map((line, index) => (
                    <tr key={`${line.product_id}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{warehouseNameOf(line.warehouse_id)}</td>
                      <td>{nameOf(line.product_id)}</td>
                      <td>{formatQuantity(line.quantity)}{ingredient?.unit ? ` ${ingredient.unit}` : ""}</td>
                      <td><div className="dish-row-actions">
                        <button type="button" className="danger" disabled={saving || removingIndex === index} onClick={() => handleRemove(index)} aria-label={t("pages.nomenclature.rawingredientdishesdialog.udalit")}><Icon name="bi-trash3" size={15} /></button>
                      </div></td>
                    </tr>
                  )) : <tr><td colSpan={5} className="dish-recipes-empty-cell">
                    <ReportEmptyState title={t("pages.nomenclature.rawingredientdishesdialog.etot_produkt_poka_ne_ispolzuetsya_v_blyudah")} />
                  </td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>, document.body,
  );
}

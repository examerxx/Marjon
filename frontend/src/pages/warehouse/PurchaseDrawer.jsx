import { useMemo, useState } from "react";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import { webDayKey } from "../../utils/webTime";
import { t } from "../../i18n/t";

// Ключ строки — стабильный локальный id (индекс не годится: строки удаляются).
let rowSeq = 0;
const newRow = () => ({ key: `row-${rowSeq++}`, ingredientId: "", quantity: "", unit: "", costPrice: "" });

function today() {
  return webDayKey();
}

function lineTotal(row) {
  return (Number(row.quantity) || 0) * (Number(row.costPrice) || 0);
}

/**
 * Дравер создания прихода. Собирает документ (поставщик, склад, дата, строки)
 * и отдаёт наверх через onSubmit — сам API не дёргает (правило: в WarehousePage
 * и его компонентах нет прямых api.post/patch/delete; всё через warehouseService).
 * Позиция — это шаблон из «Продуктов»: обязаны ingredient_id, количество и цена
 * (бэкенд такие документы отклоняет 422, проведение считает остатки из движений).
 */
function PurchaseDrawer({ warehouses, ingredients, saving, error, onClose, onSubmit, onClearError = null }) {
  const [supplier, setSupplier] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [items, setItems] = useState(() => [newRow()]);

  const ingredientById = useMemo(() => {
    const map = new Map();
    (ingredients || []).forEach((ing) => map.set(ing.id, ing));
    return map;
  }, [ingredients]);

  const total = useMemo(() => items.reduce((sum, row) => sum + lineTotal(row), 0), [items]);
  const formatMoney = (value) => `${new Intl.NumberFormat("ru-RU").format(Number(value) || 0)} UZS`;

  const updateRow = (key, patch) => setItems((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const removeRow = (key) => setItems((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));

  const pickIngredient = (key, ingredientId) => {
    const ing = ingredientById.get(ingredientId);
    updateRow(key, { ingredientId, unit: ing?.unit || "" });
  };

  // Шаблон нельзя оприходовать без количества и цены — такие строки
  // в документ не попадают (backend дополнительно отклоняет их 422).
  const validItems = items.filter(
    (row) => row.ingredientId && Number(row.quantity) > 0 && Number(row.costPrice) > 0,
  );
  const canSubmit = Boolean(warehouseId) && validItems.length > 0 && !saving;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      supplier: supplier.trim() || null,
      warehouse_id: warehouseId,
      date: date || null,
      note: note.trim() || null,
      items: validItems.map((row) => ({
        name: ingredientById.get(row.ingredientId)?.name || "Позиция",
        ingredient_id: row.ingredientId,
        quantity: Number(row.quantity),
        unit: row.unit || ingredientById.get(row.ingredientId)?.unit || "кг",
        cost_price: Number(row.costPrice) || 0,
      })),
    });
  };

  return (
    <div className="warehouse-drawer" role="dialog" aria-modal="true" aria-label={t("pages.warehouse.purchasedrawer.novyy_prihod")}>
      <div className="warehouse-drawer__backdrop" onClick={saving ? undefined : onClose} />
      <div className="warehouse-form">
        <div className="warehouse-form__header">
          <div>
            <p>{t("pages.warehouse.purchasedrawer.sklad")}</p>
            <h2>{t("pages.warehouse.purchasedrawer.novyy_prihod")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("pages.warehouse.purchasedrawer.zakryt")}><Icon name="bi-x-lg" size={18} /></button>
        </div>

        {error ? <Toast kind="error" message={error} onClose={onClearError || undefined} /> : null}

        <div className="warehouse-form__grid">
          <label>
            <span>{t("pages.warehouse.purchasedrawer.postavschik")}</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={t("pages.warehouse.purchasedrawer.napr_ooo_postavka")} />
          </label>
          <label>
            <span>{t("pages.warehouse.purchasedrawer.sklad_2")}</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">{t("pages.warehouse.purchasedrawer.vyberite_sklad")}</option>
              {(warehouses || []).map((wh) => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t("pages.warehouse.purchasedrawer.data")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        <PurchaseItems
          items={items}
          ingredients={ingredients}
          formatMoney={formatMoney}
          onPick={pickIngredient}
          onChange={updateRow}
          onRemove={removeRow}
          onAdd={() => setItems((current) => [...current, newRow()])}
        />

        <label className="warehouse-form__comment">
          <span>{t("pages.warehouse.purchasedrawer.kommentariy")}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("pages.warehouse.purchasedrawer.neobyazatelno")} />
        </label>

        <div className="warehouse-form__footer">
          <strong>{t("pages.warehouse.purchasedrawer.itogo")} {formatMoney(total)}</strong>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} disabled={saving}>{t("pages.warehouse.purchasedrawer.otmena")}</button>
            <button type="button" className="warehouse-commit-action" onClick={submit} disabled={!canSubmit}>
              {saving ? "Сохранение..." : "Сохранить черновик"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PurchaseItems({ items, ingredients, formatMoney, onPick, onChange, onRemove, onAdd }) {
  return (
    <div className="warehouse-products-box">
      <div className="warehouse-products-box__head">
        <strong>{t("pages.warehouse.purchasedrawer.pozitsii_prihoda")}</strong>
        <span>{items.length}</span>
      </div>
      {items.map((row) => (
        <div className="warehouse-product-row" key={row.key}>
          <select value={row.ingredientId} onChange={(e) => onPick(row.key, e.target.value)} aria-label={t("pages.warehouse.purchasedrawer.ingredient")}>
            <option value="">{t("pages.warehouse.purchasedrawer.tovar")}</option>
            {(ingredients || []).map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
          </select>
          <input type="number" min="0" step="any" value={row.quantity} onChange={(e) => onChange(row.key, { quantity: e.target.value })} placeholder={t("pages.warehouse.purchasedrawer.kol_vo")} aria-label={t("pages.warehouse.purchasedrawer.kolichestvo")} />
          <strong>{row.unit || "—"}</strong>
          <input type="number" min="0" step="any" value={row.costPrice} onChange={(e) => onChange(row.key, { costPrice: e.target.value })} placeholder={t("pages.warehouse.purchasedrawer.tsena")} aria-label={t("pages.warehouse.purchasedrawer.tsena")} />
          <strong>{formatMoney((Number(row.quantity) || 0) * (Number(row.costPrice) || 0))}</strong>
          <button type="button" onClick={() => onRemove(row.key)} aria-label={t("pages.warehouse.purchasedrawer.udalit_pozitsiyu")}><Icon name="bi-x-lg" size={14} /></button>
        </div>
      ))}
      <button type="button" className="warehouse-add-product" onClick={onAdd}>{t("pages.warehouse.purchasedrawer.dobavit_pozitsiyu")}</button>
    </div>
  );
}

export default PurchaseDrawer;

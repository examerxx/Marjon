import { useMemo, useState } from "react";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import { webDayKey } from "../../utils/webTime";
import { t } from "../../i18n/t";

// Ключ строки — стабильный локальный id (индекс не годится: строки удаляются).
let rowSeq = 0;
const newRow = () => ({ key: `exp-${rowSeq++}`, ingredientId: "", quantity: "", unit: "" });

function today() {
  return webDayKey();
}

/**
 * Дравер создания расхода (WH-01). Зеркалит приход: собирает документ
 * (получатель, склад, дата, строки) и отдаёт наверх через onSubmit — сам API
 * не дёргает (правило: в WarehousePage и его компонентах нет прямых
 * api.post/patch/delete; всё через warehouseService).
 * Позиция обязана ссылаться на ингредиент (ingredient_id) — иначе при
 * проведении остаток по ней не сдвинется (бэкенд пропускает строки без
 * ингредиента). Проведение при нехватке остатка вернёт 422.
 * V46 FIFO: цена считается бэкендом по старым партиям первыми —
 * поле цены убрано, в payload всегда cost_price: 0.
 */
function ExpenseDrawer({ warehouses, ingredients, saving, error, onClose, onSubmit, onClearError = null }) {
  const [receiver, setReceiver] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [items, setItems] = useState(() => [newRow()]);

  const ingredientById = useMemo(() => {
    const map = new Map();
    (ingredients || []).forEach((ing) => map.set(ing.id, ing));
    return map;
  }, [ingredients]);

  const updateRow = (key, patch) => setItems((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const removeRow = (key) => setItems((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));

  const pickIngredient = (key, ingredientId) => {
    const ing = ingredientById.get(ingredientId);
    updateRow(key, { ingredientId, unit: ing?.unit || "" });
  };

  const validItems = items.filter((row) => row.ingredientId && Number(row.quantity) > 0);
  const canSubmit = Boolean(warehouseId) && validItems.length > 0 && !saving;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      receiver: receiver.trim() || null,
      warehouse_id: warehouseId,
      date: date || null,
      note: note.trim() || null,
      items: validItems.map((row) => ({
        name: ingredientById.get(row.ingredientId)?.name || "Позиция",
        ingredient_id: row.ingredientId,
        quantity: Number(row.quantity),
        unit: row.unit || ingredientById.get(row.ingredientId)?.unit || "кг",
        cost_price: 0,
      })),
    });
  };

  return (
    <div className="warehouse-drawer" role="dialog" aria-modal="true" aria-label={t("pages.warehouse.expensedrawer.novyy_rashod")}>
      <div className="warehouse-drawer__backdrop" onClick={saving ? undefined : onClose} />
      <div className="warehouse-form">
        <div className="warehouse-form__header">
          <div>
            <p>{t("pages.warehouse.expensedrawer.sklad")}</p>
            <h2>{t("pages.warehouse.expensedrawer.novyy_rashod")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("pages.warehouse.expensedrawer.zakryt")}><Icon name="bi-x-lg" size={18} /></button>
        </div>

        {error ? <Toast kind="error" message={error} onClose={onClearError || undefined} /> : null}

        <div className="warehouse-form__grid">
          <label>
            <span>{t("pages.warehouse.expensedrawer.poluchatel")}</span>
            <input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder={t("pages.warehouse.expensedrawer.napr_kuhnya")} />
          </label>
          <label>
            <span>{t("pages.warehouse.expensedrawer.sklad_2")}</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">{t("pages.warehouse.expensedrawer.vyberite_sklad")}</option>
              {(warehouses || []).map((wh) => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t("pages.warehouse.expensedrawer.data")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        <ExpenseItems
          items={items}
          ingredients={ingredients}
          onPick={pickIngredient}
          onChange={updateRow}
          onRemove={removeRow}
          onAdd={() => setItems((current) => [...current, newRow()])}
        />
        <p className="warehouse-form__hint">{t("pages.warehouse.expensedrawer.tsena_poschitaetsya_avtomaticheski_po_fifo_starye")}</p>

        <label className="warehouse-form__comment">
          <span>{t("pages.warehouse.expensedrawer.kommentariy")}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("pages.warehouse.expensedrawer.neobyazatelno")} />
        </label>

        <div className="warehouse-form__footer">
          <strong>{t("pages.warehouse.expensedrawer.pozitsiy")} {validItems.length}</strong>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} disabled={saving}>{t("pages.warehouse.expensedrawer.otmena")}</button>
            <button type="button" className="warehouse-commit-action" onClick={submit} disabled={!canSubmit}>
              {saving ? "Сохранение..." : "Сохранить черновик"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExpenseItems({ items, ingredients, onPick, onChange, onRemove, onAdd }) {
  return (
    <div className="warehouse-products-box">
      <div className="warehouse-products-box__head">
        <strong>{t("pages.warehouse.expensedrawer.pozitsii_rashoda")}</strong>
        <span>{items.length}</span>
      </div>
      {items.map((row) => (
        <div className="warehouse-product-row" key={row.key}>
          <select value={row.ingredientId} onChange={(e) => onPick(row.key, e.target.value)} aria-label={t("pages.warehouse.expensedrawer.ingredient")}>
            <option value="">{t("pages.warehouse.expensedrawer.tovar")}</option>
            {(ingredients || []).map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
          </select>
          <input type="number" min="0" step="any" value={row.quantity} onChange={(e) => onChange(row.key, { quantity: e.target.value })} placeholder={t("pages.warehouse.expensedrawer.kol_vo")} aria-label={t("pages.warehouse.expensedrawer.kolichestvo")} />
          <strong>{row.unit || "—"}</strong>
          <span className="warehouse-fifo-badge" title={t("pages.warehouse.expensedrawer.tsena_po_fifo_pri_provedenii")}>FIFO</span>
          <button type="button" onClick={() => onRemove(row.key)} aria-label={t("pages.warehouse.expensedrawer.udalit_pozitsiyu")}><Icon name="bi-x-lg" size={14} /></button>
        </div>
      ))}
      <button type="button" className="warehouse-add-product" onClick={onAdd}>{t("pages.warehouse.expensedrawer.dobavit_pozitsiyu")}</button>
    </div>
  );
}

export default ExpenseDrawer;

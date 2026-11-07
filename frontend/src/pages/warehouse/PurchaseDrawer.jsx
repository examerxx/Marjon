import { useMemo, useState } from "react";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import { webDayKey } from "../../utils/webTime";

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
    <div className="warehouse-drawer" role="dialog" aria-modal="true" aria-label="Новый приход">
      <div className="warehouse-drawer__backdrop" onClick={saving ? undefined : onClose} />
      <div className="warehouse-form">
        <div className="warehouse-form__header">
          <div>
            <p>Склад</p>
            <h2>Новый приход</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть"><Icon name="bi-x-lg" size={18} /></button>
        </div>

        {error ? <Toast kind="error" message={error} onClose={onClearError || undefined} /> : null}

        <div className="warehouse-form__grid">
          <label>
            <span>Поставщик</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Напр. ООО «Поставка»" />
          </label>
          <label>
            <span>Склад *</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Выберите склад</option>
              {(warehouses || []).map((wh) => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
            </select>
          </label>
          <label>
            <span>Дата</span>
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
          <span>Комментарий</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Необязательно" />
        </label>

        <div className="warehouse-form__footer">
          <strong>Итого: {formatMoney(total)}</strong>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} disabled={saving}>Отмена</button>
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
        <strong>Позиции прихода</strong>
        <span>{items.length}</span>
      </div>
      {items.map((row) => (
        <div className="warehouse-product-row" key={row.key}>
          <select value={row.ingredientId} onChange={(e) => onPick(row.key, e.target.value)} aria-label="Ингредиент">
            <option value="">Товар...</option>
            {(ingredients || []).map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
          </select>
          <input type="number" min="0" step="any" value={row.quantity} onChange={(e) => onChange(row.key, { quantity: e.target.value })} placeholder="Кол-во" aria-label="Количество" />
          <strong>{row.unit || "—"}</strong>
          <input type="number" min="0" step="any" value={row.costPrice} onChange={(e) => onChange(row.key, { costPrice: e.target.value })} placeholder="Цена" aria-label="Цена" />
          <strong>{formatMoney((Number(row.quantity) || 0) * (Number(row.costPrice) || 0))}</strong>
          <button type="button" onClick={() => onRemove(row.key)} aria-label="Удалить позицию"><Icon name="bi-x-lg" size={14} /></button>
        </div>
      ))}
      <button type="button" className="warehouse-add-product" onClick={onAdd}>Добавить позицию +</button>
    </div>
  );
}

export default PurchaseDrawer;

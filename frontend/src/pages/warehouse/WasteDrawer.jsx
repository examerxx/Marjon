import { useMemo, useState } from "react";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import { webDayKey } from "../../utils/webTime";
import { t } from "../../i18n/t";

function today() {
  return webDayKey();
}

/**
 * Дравер создания отхода (WH-01). Построчный документ — одна позиция на
 * документ (в отличие от прихода/расхода). Отдаёт payload наверх через
 * onSubmit; сам API не дёргает (все мутации — через warehouseService).
 * Для сдвига остатка при проведении нужны и склад, и ингредиент, и
 * количество > 0; проведение при нехватке остатка вернёт 422.
 */
function WasteDrawer({ warehouses, ingredients, saving, error, onClose, onSubmit, onClearError = null }) {
  const [category, setCategory] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today);

  const ingredientById = useMemo(() => {
    const map = new Map();
    (ingredients || []).forEach((ing) => map.set(ing.id, ing));
    return map;
  }, [ingredients]);

  const formatMoney = (value) => `${new Intl.NumberFormat("ru-RU").format(Number(value) || 0)} UZS`;
  void formatMoney;

  const pickIngredient = (id) => {
    setIngredientId(id);
    const ing = ingredientById.get(id);
    if (ing?.unit) setUnit(ing.unit);
  };

  const canSubmit = Boolean(warehouseId) && Boolean(ingredientId) && Number(quantity) > 0 && !saving;

  const submit = () => {
    if (!canSubmit) return;
    const ing = ingredientById.get(ingredientId);
    onSubmit({
      category: category.trim() || null,
      warehouse_id: warehouseId,
      ingredient_id: ingredientId,
      name: ing?.name || "Позиция",
      quantity: Number(quantity),
      unit: unit || ing?.unit || "кг",
      cost_price: 0,
      reason: reason.trim() || null,
      date: date || null,
    });
  };

  return (
    <div className="warehouse-drawer" role="dialog" aria-modal="true" aria-label={t("pages.warehouse.wastedrawer.dobavit_othod")}>
      <div className="warehouse-drawer__backdrop" onClick={saving ? undefined : onClose} />
      <div className="warehouse-form">
        <div className="warehouse-form__header">
          <div>
            <p>{t("pages.warehouse.wastedrawer.sklad")}</p>
            <h2>{t("pages.warehouse.wastedrawer.dobavit_othod")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("pages.warehouse.wastedrawer.zakryt")}><Icon name="bi-x-lg" size={18} /></button>
        </div>

        {error ? <Toast kind="error" message={error} onClose={onClearError || undefined} /> : null}

        <div className="warehouse-form__grid">
          <label>
            <span>{t("pages.warehouse.wastedrawer.kategoriya")}</span>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("pages.warehouse.wastedrawer.napr_porcha")} />
          </label>
          <label>
            <span>{t("pages.warehouse.wastedrawer.sklad_2")}</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">{t("pages.warehouse.wastedrawer.vyberite_sklad")}</option>
              {(warehouses || []).map((wh) => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t("pages.warehouse.wastedrawer.data")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            <span>{t("pages.warehouse.wastedrawer.tovar")}</span>
            <select value={ingredientId} onChange={(e) => pickIngredient(e.target.value)}>
              <option value="">{t("pages.warehouse.wastedrawer.vyberite_tovar")}</option>
              {(ingredients || []).map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t("pages.warehouse.wastedrawer.kolichestvo")}</span>
            <input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
          </label>
          <label>
            <span>{t("pages.warehouse.wastedrawer.ed_izm")}</span>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t("pages.warehouse.wastedrawer.kg")} />
          </label>
          <p className="warehouse-form__hint">{t("pages.warehouse.wastedrawer.tsena_poschitaetsya_avtomaticheski_po_fifo")}</p>
        </div>

        <label className="warehouse-form__comment">
          <span>{t("pages.warehouse.wastedrawer.prichina")}</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("pages.warehouse.wastedrawer.neobyazatelno")} />
        </label>

        <div className="warehouse-form__footer">
          <strong>{t("pages.warehouse.wastedrawer.tsena_fifo_avto")}</strong>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} disabled={saving}>{t("pages.warehouse.wastedrawer.otmena")}</button>
            <button type="button" className="warehouse-commit-action" onClick={submit} disabled={!canSubmit}>
              {saving ? "Сохранение..." : "Сохранить черновик"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WasteDrawer;

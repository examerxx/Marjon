import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "../../api/client";
import { getCategories } from "../../api/categories";
import { nomenclatureService } from "../../api/nomenclature";
import { settingsService } from "../../api/settings";
import Icon from "../../components/Icon";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import { unitDisplayLabel, unitOptionLabel } from "./nomenclatureData";
import { t } from "../../i18n/t";

const FALLBACK_UNITS = ["кг", "г", "л", "мл", "шт", "порция"];
const EMPTY_FORM = { name: "", unit: "кг", category_id: "" };

let rowSeq = 0;
const newItem = () => ({ key: `semi-item-${rowSeq++}`, ingredient_id: "", quantity: "" });

// Полуфабрикаты. Полный CRUD против /inventory/semi-products + производство
// (/produce списывает состав со склада и увеличивает остаток п/ф). Себестоимость
// (cost_price) считает бэк из состава — клиент её не редактирует. DELETE мягкий
// (is_active=false), восстановление — через PATCH is_active:true. Шаблон 1-в-1 со
// страницей «Сотрудники» (staff-*): та же шапка/вкладки/таблица/drawer, поэтому
// обе модалки сами уходят под топбар (правило body:has(.staff-modal) в overrides).
export default function SemiProductsPage() {
  const [rows, setRows] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [items, setItems] = useState([newItem()]);
  // Ед.изм — живой справочник Настройки → Единицы (value — короткое имя,
  // подпись — «Килограмм (Кг)»). Ошибка → честный хардкод-фолбэк.
  const [unitOptions, setUnitOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [produceRow, setProduceRow] = useState(null);
  const beginRequest = useLatestRequest();
  const { acquire, release } = useMutationLocks();

  async function load() {
    const request = beginRequest();
    setLoading(true);
    setError("");
    try {
      const [list, ings, cats, whs, unitsRes] = await Promise.all([
        nomenclatureService.listSemiProducts({ signal: request.signal }),
        nomenclatureService.listIngredients({ signal: request.signal }).catch(() => ({ data: [] })),
        getCategories({ signal: request.signal }).catch(() => ({ data: [] })),
        nomenclatureService.listWarehouses({ signal: request.signal }).catch(() => ({ data: [] })),
        settingsService.listResource("units", { signal: request.signal }).catch(() => ({ data: [] })),
      ]);
      if (!request.isCurrent()) return;
      setRows(Array.isArray(list.data) ? list.data : []);
      setIngredients(Array.isArray(ings.data) ? ings.data : []);
      setCategories(Array.isArray(cats.data) ? cats.data : []);
      setWarehouses(Array.isArray(whs.data) ? whs.data : []);
      const rawUnits = unitsRes?.data;
      const liveUnits = (Array.isArray(rawUnits) ? rawUnits : rawUnits?.items || [])
        .filter((item) => item?.id && typeof item.status === "boolean" && unitDisplayLabel(item) && item.status !== false)
        .sort((a, b) => (
          Number(a.sort ?? a.sort_order ?? 0) - Number(b.sort ?? b.sort_order ?? 0)
          || unitDisplayLabel(a).localeCompare(unitDisplayLabel(b), "ru")
        ));
      setUnitOptions(liveUnits);
    } catch (err) {
      if (!request.isCurrent() || isAbortError(err)) return;
      setRows([]);
      setError(err.response?.data?.detail || "Не удалось загрузить полуфабрикаты.");
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const ingredientById = useMemo(() => {
    const map = new Map();
    ingredients.forEach((ing) => map.set(ing.id, ing));
    return map;
  }, [ingredients]);

  const categoryById = useMemo(() => {
    const map = new Map();
    categories.forEach((cat) => map.set(cat.id, cat));
    return map;
  }, [categories]);

  // Опции ед.изм: value — короткое имя (канон хранения),
  // подпись — «Килограмм (Кг)». Пустой справочник → хардкод-фолбэк.
  const unitSelectOptions = useMemo(() => {
    if (!unitOptions.length) {
      return FALLBACK_UNITS.map((u) => ({ value: u, label: u }));
    }
    const seen = new Set();
    const list = [];
    unitOptions.forEach((item) => {
      const value = unitDisplayLabel(item);
      if (!value || seen.has(value)) return;
      seen.add(value);
      list.push({ value, label: unitOptionLabel(item) });
    });
    return list.length ? list : FALLBACK_UNITS.map((u) => ({ value: u, label: u }));
  }, [unitOptions]);

  // Категории полуфабрикатов живут в общей таблице categories под slug-префиксом
  // "semi" (тот же приём, что и на странице «Категории полуфабрикатов»).
  const semiCategories = useMemo(
    () => categories.filter((cat) => String(cat.slug || "").startsWith("semi")),
    [categories],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((row) => (showArchived ? row.is_active === false : row.is_active !== false))
      .filter((row) => !term || String(row.name || "").toLowerCase().includes(term));
  }, [rows, search, showArchived]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setItems([newItem()]);
    setActionError("");
    setDrawerOpen(true);
  }

  function openEdit(row) {
    setEditing(row);
    setForm({ name: row.name || "", unit: row.unit || "кг", category_id: row.category_id || "" });
    setItems(
      (row.ingredients || []).length
        ? row.ingredients.map((ing) => ({ key: `semi-item-${rowSeq++}`, ingredient_id: ing.ingredient_id, quantity: String(ing.quantity ?? "") }))
        : [newItem()],
    );
    setActionError("");
    setDrawerOpen(true);
  }

  function closeDrawer() {
    if (saving) return;
    setDrawerOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setItems([newItem()]);
  }

  const updateItem = (key, patch) => setItems((cur) => cur.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const removeItem = (key) => setItems((cur) => (cur.length > 1 ? cur.filter((it) => it.key !== key) : cur));
  const addItem = () => setItems((cur) => [...cur, newItem()]);

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setActionError("Укажите название.");
      return;
    }
    if (!acquire("semi-save")) return;
    const composition = items
      .filter((it) => it.ingredient_id && Number(it.quantity) > 0)
      .map((it) => ({ ingredient_id: it.ingredient_id, quantity: Number(it.quantity) }));
    const payload = {
      name: form.name.trim(),
      unit: form.unit || "кг",
      category_id: form.category_id || null,
      ingredients: composition,
    };
    setSaving(true);
    setActionError("");
    try {
      if (editing) {
        await nomenclatureService.updateSemiProduct(editing.id, payload);
      } else {
        await nomenclatureService.createSemiProduct({ ...payload, is_active: true });
      }
      closeDrawer();
      await load();
    } catch (err) {
      setActionError(err.response?.data?.detail || "Не удалось сохранить полуфабрикат.");
    } finally {
      setSaving(false);
      release("semi-save");
    }
  }

  async function removeRow(row) {
    if (!acquire(`semi-${row.id}`)) return;
    setBusyId(row.id);
    setActionError("");
    try {
      await nomenclatureService.deleteSemiProduct(row.id);
      await load();
    } catch (err) {
      setActionError(err.response?.data?.detail || "Не удалось удалить полуфабрикат.");
    } finally {
      setBusyId(null);
      release(`semi-${row.id}`);
    }
  }

  async function restoreRow(row) {
    if (!acquire(`semi-${row.id}`)) return;
    setBusyId(row.id);
    setActionError("");
    try {
      await nomenclatureService.updateSemiProduct(row.id, { is_active: true });
      await load();
    } catch (err) {
      setActionError(err.response?.data?.detail || "Не удалось восстановить полуфабрикат.");
    } finally {
      setBusyId(null);
      release(`semi-${row.id}`);
    }
  }

  return (
    <div className="staff-page">
      <section className="staff-card">
        <header className="staff-header">
          <div className="staff-header__title">
            <span className="staff-header__accent" />
            <div>
              <p className="staff-header__eyebrow">{t("pages.nomenclature.semiproductspage.nomenklatura")}</p>
              <h1>{t("pages.nomenclature.semiproductspage.polufabrikaty")}</h1>
            </div>
          </div>
          <button type="button" className="staff-add-button" onClick={openCreate}>
            <Icon name="bi-plus" size={18} /> {t("pages.nomenclature.semiproductspage.dobavit")}
          </button>
        </header>

        <div className="staff-tabs" role="tablist" aria-label={t("pages.nomenclature.semiproductspage.filtr_po_statusu")}>
          <button type="button" role="tab" aria-selected={!showArchived} className={!showArchived ? "is-active" : ""} onClick={() => setShowArchived(false)}>
           {t("pages.nomenclature.semiproductspage.aktivnye")}
          </button>
          <button type="button" role="tab" aria-selected={showArchived} className={showArchived ? "is-active" : ""} onClick={() => setShowArchived(true)}>
           {t("pages.nomenclature.semiproductspage.arhivirovannye")}
          </button>
        </div>

        <div className="staff-filters staff-filters--search">
          <label>
            <span>{t("pages.nomenclature.semiproductspage.poisk")}</span>
            <div className="staff-filter-control">
              <Icon name="bi-search" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("pages.nomenclature.semiproductspage.nazvanie_polufabrikata")} />
            </div>
          </label>
        </div>

        {actionError ? <div className="login-error" role="alert">{actionError}</div> : null}

        {error ? (
          <div className="login-error" role="alert">{error}</div>
        ) : (
          <div className="staff-table-wrapper">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>{t("pages.nomenclature.semiproductspage.nazvanie")}</th><th>{t("pages.nomenclature.semiproductspage.kategoriya")}</th><th>{t("pages.nomenclature.semiproductspage.ed_izm")}</th><th>{t("pages.nomenclature.semiproductspage.sebestoimost")}</th><th>{t("pages.nomenclature.semiproductspage.sostav")}</th><th>{t("pages.nomenclature.semiproductspage.status")}</th><th>{t("pages.nomenclature.semiproductspage.deystviya")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="staff-empty-cell" colSpan={7} role="status" aria-busy="true">{t("pages.nomenclature.semiproductspage.zagruzka")}</td></tr>
                ) : !visible.length ? (
                  <tr><td className="staff-empty-cell" colSpan={7}>{t(showArchived ? "pages.nomenclature.semi_archive_empty" : "pages.nomenclature.semi_empty")}</td></tr>
                ) : (
                  visible.map((row) => {
                    const cat = categoryById.get(row.category_id);
                    return (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>{cat?.name ? <span className="staff-role-badge">{cat.name}</span> : "—"}</td>
                        <td>{row.unit || "—"}</td>
                        <td>{formatMoney(row.cost_price || 0)}</td>
                        <td>{row.ingredients_count ?? (row.ingredients || []).length}</td>
                        <td><span className={`staff-status-badge ${row.is_active === false ? "is-archived" : ""}`}>{row.is_active === false ? "Архив" : "Активно"}</span></td>
                        <td>
                          <div className="staff-actions">
                            {row.is_active === false ? (
                              <button type="button" className="staff-restore-action" onClick={() => restoreRow(row)} disabled={busyId === row.id} aria-label={t("pages.nomenclature.semiproductspage.vosstanovit")}><Icon name="bi-arrow-counterclockwise" /></button>
                            ) : (
                              <>
                                <button type="button" onClick={() => setProduceRow(row)} disabled={busyId === row.id} aria-label={t("pages.nomenclature.semiproductspage.proizvesti")}><Icon name="bi-hammer" /></button>
                                <button type="button" className="edit-action-button" onClick={() => openEdit(row)} disabled={busyId === row.id} aria-label={t("pages.nomenclature.semiproductspage.izmenit")}><Icon name="bi-pencil" /></button>
                                <button type="button" className="staff-delete-action" onClick={() => removeRow(row)} disabled={busyId === row.id} aria-label={t("pages.nomenclature.semiproductspage.udalit")}><Icon name="bi-trash3" /></button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {drawerOpen ? (
        <div className="staff-modal">
          <div className="staff-modal__backdrop" onClick={closeDrawer} />
          <form className="staff-form" onSubmit={save}>
            <div className="staff-form__header">
              <div>
                <p>{t("pages.nomenclature.semiproductspage.polufabrikat")}</p>
                <h2>{editing ? "Изменить полуфабрикат" : "Новый полуфабрикат"}</h2>
              </div>
              <button type="button" onClick={closeDrawer} aria-label={t("pages.nomenclature.semiproductspage.zakryt")}><Icon name="bi-x-lg" /></button>
            </div>
            <div className="staff-form__grid">
              <label className="staff-form__comment">
                <span>{t("pages.nomenclature.semiproductspage.nazvanie_2")}</span>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("pages.nomenclature.semiproductspage.napr_testo_drozhzhevoe")} />
              </label>
              <label>
                <span>{t("pages.nomenclature.semiproductspage.ed_izm")}</span>
                <select value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}>
                  {unitSelectOptions.some((o) => o.value === form.unit) ? null : (
                    <option value={form.unit}>{form.unit}</option>
                  )}
                  {unitSelectOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label>
                <span>{t("pages.nomenclature.semiproductspage.kategoriya")}</span>
                <select value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                  <option value="">{t("pages.nomenclature.semiproductspage.bez_kategorii")}</option>
                  {semiCategories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
              </label>
            </div>

            <SemiCompose
              items={items}
              ingredients={ingredients}
              ingredientById={ingredientById}
              onPick={(key, id) => updateItem(key, { ingredient_id: id })}
              onQty={(key, q) => updateItem(key, { quantity: q })}
              onRemove={removeItem}
              onAdd={addItem}
            />

            <div className="staff-form__footer">
              <button type="button" onClick={closeDrawer} disabled={saving}>{t("pages.nomenclature.semiproductspage.otmena")}</button>
              <button type="submit" disabled={saving || !form.name.trim()}>{saving ? "Сохранение…" : "Сохранить"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {produceRow ? (
        <ProduceDialog
          row={produceRow}
          warehouses={warehouses}
          onClose={() => setProduceRow(null)}
          onProduced={async () => { setProduceRow(null); await load(); }}
        />
      ) : null}
    </div>
  );
}

// Конструктор состава: строки «ингредиент + количество». Единица берётся из
// справочника ингредиентов (read-only подсказка). Локальные ключи стабильны
// (newItem), поэтому React не путает строки при добавлении/удалении.
function SemiCompose({ items, ingredients, ingredientById, onPick, onQty, onRemove, onAdd }) {
  return (
    <div className="semi-compose">
      <div className="semi-compose__head">
        <strong>{t("pages.nomenclature.semiproductspage.sostav")}</strong>
        <span>{items.length}</span>
      </div>
      {items.map((it) => {
        const unit = ingredientById.get(it.ingredient_id)?.unit || "";
        return (
          <div className="semi-compose__row" key={it.key}>
            <select value={it.ingredient_id} onChange={(e) => onPick(it.key, e.target.value)} aria-label={t("pages.nomenclature.semiproductspage.ingredient")}>
              <option value="">{t("pages.nomenclature.semiproductspage.ingredient_2")}</option>
              {ingredients.map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
            </select>
            <input type="number" min="0" step="any" value={it.quantity} onChange={(e) => onQty(it.key, e.target.value)} placeholder={t("pages.nomenclature.semiproductspage.kol_vo")} aria-label={t("pages.nomenclature.semiproductspage.kolichestvo")} />
            <span className="semi-compose__unit">{unit || "—"}</span>
            <button type="button" className="semi-compose__remove" onClick={() => onRemove(it.key)} aria-label={t("pages.nomenclature.semiproductspage.udalit_pozitsiyu")}><Icon name="bi-x-lg" /></button>
          </div>
        );
      })}
      <button type="button" className="semi-compose__add" onClick={onAdd}>{t("pages.nomenclature.semiproductspage.dobavit_ingredient")}</button>
    </div>
  );
}

// Диалог производства: списывает состав со склада и увеличивает остаток п/ф.
// Своё локальное состояние (склад/количество/ошибка) — родитель только
// перезагружает список после успеха.
function ProduceDialog({ row, warehouses, onClose, onProduced }) {
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [producing, setProducing] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = Boolean(warehouseId) && Number(quantity) > 0 && !producing;

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setProducing(true);
    setError("");
    try {
      await nomenclatureService.produceSemiProduct(row.id, { warehouse_id: warehouseId, quantity: Number(quantity) });
      await onProduced();
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось выполнить производство.");
      setProducing(false);
    }
  }

  return (
    <div className="staff-modal">
      <div className="staff-modal__backdrop" onClick={producing ? undefined : onClose} />
      <form className="staff-form" onSubmit={submit}>
        <div className="staff-form__header">
          <div>
            <p>{t("pages.nomenclature.semiproductspage.proizvodstvo")}</p>
            <h2>{row.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("pages.nomenclature.semiproductspage.zakryt")}><Icon name="bi-x-lg" /></button>
        </div>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <div className="staff-form__grid">
          <label className="staff-form__comment">
            <span>{t("pages.nomenclature.semiproductspage.sklad_spisaniya")}</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">{t("pages.nomenclature.semiproductspage.vyberite_sklad")}</option>
              {warehouses.map((wh) => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
            </select>
          </label>
          <label className="staff-form__comment">
            <span>{t("pages.nomenclature.semiproductspage.kolichestvo_2")}</span>
            <input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={`Сколько произвести (${row.unit || "ед."})`} />
          </label>
        </div>
        <p className="semi-produce__hint">{t("pages.nomenclature.semiproductspage.sostav_budet_spisan_so_sklada_ostatok_polufabrikata")}</p>
        <div className="staff-form__footer">
          <button type="button" onClick={onClose} disabled={producing}>{t("pages.nomenclature.semiproductspage.otmena")}</button>
          <button type="submit" disabled={!canSubmit}>{producing ? "Производство…" : "Произвести"}</button>
        </div>
      </form>
    </div>
  );
}

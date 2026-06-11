import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { api, formatMoney, formatNumber } from "../api/client";
import MarjonLoader from "../components/MarjonLoader";
import {
  Search, Plus, Eye, Trash2, Pencil, X, Package, ArrowRightLeft,
  ClipboardCheck, FileX2, BarChart3, Warehouse as WarehouseIcon,
  AlertTriangle, Loader2, Check, Banknote, ClipboardList, FileWarning,
  SlidersHorizontal,
} from "lucide-react";


/* ─── useDebounce hook ──────────────────────────────────────── */
function useDebounce(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}


/* ─── helpers ───────────────────────────────────────────────── */
function today() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function statusLabel(s) {
  return s === "accepted" || s === "active" ? "Принято" : "Черновой";
}

function statusBadge(s) {
  const cls = s === "accepted" || s === "active" ? "badge badge-success" : "badge badge-warning";
  return <span className={cls}>{statusLabel(s)}</span>;
}

function MoneyCell({ value, muted = false }) {
  return <span className={muted ? "muted" : ""}>{formatMoney(value)}</span>;
}

function IconBtn({ Icon, tone = "brand", label, onClick }) {
  return (
    <button type="button" className={`wh-action-btn wh-action-btn--${tone}`} aria-label={label} onClick={onClick} title={label}>
      <Icon size={15} />
    </button>
  );
}

function Spinner() {
  return <Loader2 className="warehouse-spinner" size={20} />;
}


/* ─── skeleton components ───────────────────────────────────── */
function SkeletonPulse({ width = "100%", height = 16, rounded = false, style }) {
  return (
    <div
      className="wh-skeleton-pulse"
      style={{
        width, height, borderRadius: rounded ? "50%" : 8,
        ...style,
      }}
    />
  );
}

function TableSkeleton({ cols = 6, rows = 5 }) {
  return (
    <table className="data-table">
      <thead>
        <tr>{Array.from({ length: cols }, (_, i) => <th key={i}><SkeletonPulse width={`${60 + Math.random() * 30}%`} height={12} /></th>)}</tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, ri) => (
          <tr key={ri}>{Array.from({ length: cols }, (_, ci) => <td key={ci}><SkeletonPulse width={`${50 + Math.random() * 40}%`} height={14} /></td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}


/* ─── modal shell (portal → body, above sticky topbar) ────── */
function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return createPortal(
    <div className="warehouse-modal-backdrop" onClick={onClose}>
      <div className={`warehouse-modal ${wide ? "warehouse-modal--wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="warehouse-modal__head">
          <h3>{title}</h3>
          <button type="button" className="warehouse-modal__close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="warehouse-modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}


/* ─── validation helpers ─────────────────────────────────────── */
function validatePurchaseForm(form, items) {
  const errors = {};
  if (!form.supplier?.trim()) errors.supplier = "Укажите поставщика";
  if (!form.warehouse_name?.trim()) errors.warehouse_name = "Выберите склад";
  if (!form.date?.trim()) errors.date = "Укажите дату";

  const itemErrors = [];
  let hasValidItem = false;
  items.forEach((it) => {
    const ie = {};
    if (!it.name?.trim()) ie.name = "Название обязательно";
    if (!it.quantity || Number(it.quantity) <= 0) ie.quantity = "Кол-во > 0";
    if (!it.cost_price || Number(it.cost_price) <= 0) ie.cost_price = "Цена > 0";
    if (!it.unit?.trim()) ie.unit = "Ед.";
    itemErrors.push(ie);
    if (it.name?.trim()) hasValidItem = true;
  });
  if (!hasValidItem) errors._items = "Добавьте хотя бы одну позицию";

  return { errors, itemErrors, valid: Object.keys(errors).length === 0 && itemErrors.every((e) => Object.keys(e).length === 0) };
}

function FieldError({ msg }) {
  if (!msg) return null;
  return <span className="warehouse-form__error">{msg}</span>;
}


/* ─── Section components ────────────────────────────────────── */

/* Остаток по складам */
function SummaryTable({ title, rows, loading }) {
  const totals = rows.reduce(
    (a, r) => ({ raw: a.raw + Number(r.raw || 0), semi: a.semi + Number(r.semi || 0), sale: a.sale + Number(r.sale || 0) }),
    { raw: 0, semi: 0, sale: 0 },
  );
  const rowTotal = (r) => Number(r.raw || 0) + Number(r.semi || 0) + Number(r.sale || 0);

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div><span className="eyebrow">Stock</span><h2>{title}</h2></div>
      </div>
      {loading ? <TableSkeleton cols={6} rows={3} /> : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>№</th><th>Название</th><th>Сырьё</th><th>Полуфабрикат</th><th>Реализация</th><th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ fontWeight: 700, background: "rgba(255,107,53,0.04)" }}>
                <td /><td><strong>Итого</strong></td>
                <td><MoneyCell value={totals.raw} /></td><td><MoneyCell value={totals.semi} /></td><td><MoneyCell value={totals.sale} /></td>
                <td><MoneyCell value={totals.raw + totals.semi + totals.sale} /></td>
              </tr>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td><Link to="/warehouse/balance">{r.name}</Link></td>
                  <td><MoneyCell value={r.raw} muted={!r.raw} /></td><td><MoneyCell value={r.semi} muted={!r.semi} /></td>
                  <td><MoneyCell value={r.sale} muted={!r.sale} /></td><td><MoneyCell value={rowTotal(r)} muted={!rowTotal(r)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}


/* Приходы */
function IncomingSection({ warehouses, onRefreshStats, onPurchaseStats, globalSearch, filterStatus }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [viewDoc, setViewDoc] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/warehouse/purchases");
      setRows(data);
      onPurchaseStats?.(data);
    } catch {
      setRows([]);
      onPurchaseStats?.([]);
    } finally {
      setLoading(false);
    }
  }, [onPurchaseStats]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!confirm("Удалить документ?")) return;
    try {
      await api.delete(`/warehouse/purchases/${id}`);
      load();
      onRefreshStats?.();
    } catch { /* ignore */ }
  };

  const handleAccept = async (id) => {
    try {
      await api.patch(`/warehouse/purchases/${id}`, { status: "accepted" });
      load();
      onRefreshStats?.();
    } catch { /* ignore */ }
  };

  /* live filter from global search + status */
  const q = (globalSearch || "").toLowerCase();
  const filtered = rows.filter((r) => {
    if (filterStatus === "draft" && r.status !== "draft") return false;
    if (filterStatus === "accepted" && r.status !== "accepted" && r.status !== "active") return false;
    if (!q) return true;
    return (r.supplier || "").toLowerCase().includes(q)
      || (r.warehouse_name || "").toLowerCase().includes(q)
      || String(r.number || "").includes(q)
      || (r.date || "").includes(q);
  });

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div><span className="eyebrow">Incoming</span><h2>Поступление товаров</h2></div>
        <button type="button" className="wh-btn wh-btn--primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Создать
        </button>
      </div>

      {loading ? <TableSkeleton cols={8} rows={4} /> : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon"><Package size={32} strokeWidth={1.5} /></div>
          <h3>{q ? "Ничего не найдено" : "Документов пока нет"}</h3>
          <p>{q ? `Нет результатов по запросу «${q}»` : "Нажмите «Создать» чтобы добавить приход."}</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Номер</th><th>Поставщик</th><th>На склад</th><th>Дата</th>
                <th>Регистрация</th><th>Кол-во</th><th>Сумма</th><th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => setViewDoc(r)} style={{ cursor: "pointer" }}>
                  <td><strong>{r.number}</strong></td>
                  <td>{r.supplier || "—"}</td>
                  <td>{r.warehouse_name || "—"}</td>
                  <td>{r.date || "—"}</td>
                  <td>
                    {r.registered_at || "—"}
                    {r.created_by_name ? <><br /><small className="muted">{r.created_by_name}</small></> : null}
                  </td>
                  <td>{formatNumber(r.items_count)}</td>
                  <td><MoneyCell value={r.total_amount} muted={!Number(r.total_amount)} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="table-actions">
                      {statusBadge(r.status)}
                      {r.status === "draft" && (
                        <IconBtn Icon={Check} tone="green" label="Принять" onClick={() => handleAccept(r.id)} />
                      )}
                      <IconBtn Icon={Eye} tone="brand" label="Открыть" onClick={() => setViewDoc(r)} />
                      {r.status === "draft" && (
                        <IconBtn Icon={Trash2} tone="red" label="Удалить" onClick={() => handleDelete(r.id)} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreatePurchaseModal open={showCreate} onClose={() => setShowCreate(false)} warehouses={warehouses} onCreated={() => { load(); onRefreshStats?.(); }} />
      <Modal open={!!viewDoc} onClose={() => setViewDoc(null)} title={viewDoc ? `Приход #${viewDoc.number}` : ""} wide>
        {viewDoc && (
          <div className="warehouse-detail-grid">
            <div><span>Поставщик</span><strong>{viewDoc.supplier || "—"}</strong></div>
            <div><span>Склад</span><strong>{viewDoc.warehouse_name || "—"}</strong></div>
            <div><span>Дата</span><strong>{viewDoc.date || "—"}</strong></div>
            <div><span>Статус</span>{statusBadge(viewDoc.status)}</div>
            <div><span>Кол-во позиций</span><strong>{viewDoc.items_count}</strong></div>
            <div><span>Итого</span><strong>{formatMoney(viewDoc.total_amount)}</strong></div>
            <div><span>Регистрация</span><strong>{viewDoc.registered_at || "—"}</strong></div>
            <div><span>Приём</span><strong>{viewDoc.accepted_at || "—"}</strong></div>
            {viewDoc.note && <div style={{ gridColumn: "1 / -1" }}><span>Примечание</span><strong>{viewDoc.note}</strong></div>}
          </div>
        )}
      </Modal>
    </section>
  );
}

function CreatePurchaseModal({ open, onClose, warehouses, onCreated }) {
  const [form, setForm] = useState({ supplier: "", warehouse_name: "", date: today(), note: "" });
  const [items, setItems] = useState([{ name: "", quantity: "", unit: "кг", cost_price: "" }]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [itemErrors, setItemErrors] = useState([]);
  const [touched, setTouched] = useState(false);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (touched) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const setItem = (i, k, v) => {
    setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, [k]: v } : it));
    if (touched) setItemErrors((a) => a.map((ie, idx) => idx === i ? { ...ie, [k]: undefined } : ie));
  };
  const addItem = () => {
    setItems((a) => [...a, { name: "", quantity: "", unit: "кг", cost_price: "" }]);
    setItemErrors((a) => [...a, {}]);
  };
  const removeItem = (i) => {
    setItems((a) => a.filter((_, idx) => idx !== i));
    setItemErrors((a) => a.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);

    const validation = validatePurchaseForm(form, items);
    setErrors(validation.errors);
    setItemErrors(validation.itemErrors);
    if (!validation.valid) return;

    setSaving(true);
    try {
      await api.post("/warehouse/purchases", {
        ...form,
        items: items.filter((it) => it.name).map((it) => ({
          name: it.name,
          quantity: Number(it.quantity) || 0,
          unit: it.unit,
          cost_price: Number(it.cost_price) || 0,
        })),
      });
      onCreated();
      onClose();
      setForm({ supplier: "", warehouse_name: "", date: today(), note: "" });
      setItems([{ name: "", quantity: "", unit: "кг", cost_price: "" }]);
      setErrors({});
      setItemErrors([]);
      setTouched(false);
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const runTotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.cost_price) || 0), 0);

  return (
    <Modal open={open} onClose={onClose} title="Новый приход" wide>
      <form onSubmit={handleSubmit} className="warehouse-form" noValidate>
        <div className="warehouse-form__row">
          <label className={errors.supplier ? "is-invalid" : ""}>
            Поставщик
            <input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} placeholder="BOZOR" />
            <FieldError msg={errors.supplier} />
          </label>
          <label className={errors.warehouse_name ? "is-invalid" : ""}>
            Склад
            <select value={form.warehouse_name} onChange={(e) => set("warehouse_name", e.target.value)}>
              <option value="">— Выберите —</option>
              {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <FieldError msg={errors.warehouse_name} />
          </label>
          <label className={errors.date ? "is-invalid" : ""}>
            Дата
            <input value={form.date} onChange={(e) => set("date", e.target.value)} placeholder="11.06.2026" />
            <FieldError msg={errors.date} />
          </label>
        </div>

        <h4>Позиции {errors._items && <span className="warehouse-form__error" style={{ fontWeight: 400, fontSize: "0.8rem" }}>— {errors._items}</span>}</h4>
        {items.map((it, i) => (
          <div className="warehouse-form__row warehouse-form__item" key={i}>
            <label className={itemErrors[i]?.name ? "is-invalid" : ""}>
              Наименование
              <input value={it.name} onChange={(e) => setItem(i, "name", e.target.value)} placeholder="Говядина" />
              <FieldError msg={itemErrors[i]?.name} />
            </label>
            <label className={itemErrors[i]?.quantity ? "is-invalid" : ""}>
              Кол-во
              <input type="number" step="0.01" min="0.01" value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} placeholder="10" />
              <FieldError msg={itemErrors[i]?.quantity} />
            </label>
            <label className={itemErrors[i]?.unit ? "is-invalid" : ""}>
              Ед.
              <input value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} style={{ width: 60 }} />
              <FieldError msg={itemErrors[i]?.unit} />
            </label>
            <label className={itemErrors[i]?.cost_price ? "is-invalid" : ""}>
              Цена
              <input type="number" step="0.01" min="0.01" value={it.cost_price} onChange={(e) => setItem(i, "cost_price", e.target.value)} placeholder="45000" />
              <FieldError msg={itemErrors[i]?.cost_price} />
            </label>
            {items.length > 1 && (
              <button type="button" className="warehouse-form__remove" onClick={() => removeItem(i)}><X size={14} /></button>
            )}
          </div>
        ))}
        <button type="button" className="warehouse-form__add" onClick={addItem}><Plus size={14} /> Добавить позицию</button>

        <label>Примечание<textarea value={form.note} onChange={(e) => set("note", e.target.value)} rows={2} /></label>

        {runTotal > 0 && (
          <div className="warehouse-form__total">
            Итого: <strong>{formatMoney(runTotal)}</strong>
          </div>
        )}

        <div className="warehouse-form__actions">
          <button type="button" className="warehouse-form__cancel" onClick={onClose}>Отмена</button>
          <button type="submit" className="warehouse-form__submit" disabled={saving}>
            {saving ? <Spinner /> : "Создать приход"}
          </button>
        </div>
      </form>
    </Modal>
  );
}


/* Перемещения */
function TransferSection({ warehouses, onRefreshStats, globalSearch, filterStatus }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await api.get("/warehouse/transfers"); setRows(data); }
    catch { setRows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!confirm("Удалить перемещение?")) return;
    try { await api.delete(`/warehouse/transfers/${id}`); load(); } catch {}
  };

  const q = (globalSearch || "").toLowerCase();
  const filtered = rows.filter((r) => {
    if (filterStatus === "draft" && r.status !== "draft") return false;
    if (filterStatus === "accepted" && r.status !== "accepted" && r.status !== "active") return false;
    if (!q) return true;
    return (r.from_warehouse_name || "").toLowerCase().includes(q)
      || (r.to_warehouse_name || "").toLowerCase().includes(q);
  });

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div><span className="eyebrow">Transfers</span><h2>Перемещение товаров</h2></div>
        <button type="button" className="wh-btn wh-btn--primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Создать</button>
      </div>
      {loading ? <TableSkeleton cols={6} rows={3} /> : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon"><ArrowRightLeft size={32} strokeWidth={1.5} /></div>
          <h3>{q ? "Ничего не найдено" : "Перемещений пока нет"}</h3>
          <p>{q ? `Нет результатов по запросу «${q}»` : "Создайте первое перемещение между складами."}</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr><th>Дата</th><th>Со склада</th><th>На склад</th><th>Кол-во</th><th>Создано</th><th>Действия</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.date || "—"}</td>
                  <td>{r.from_warehouse_name || "—"}</td>
                  <td>{r.to_warehouse_name || "—"}</td>
                  <td><strong>{formatNumber(r.items_count)}</strong></td>
                  <td>{r.created_at ? new Date(r.created_at).toLocaleString("ru-RU") : "—"}</td>
                  <td>
                    <div className="table-actions">
                      {statusBadge(r.status)}
                      <IconBtn Icon={Trash2} tone="red" label="Удалить" onClick={() => handleDelete(r.id)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateTransferModal open={showCreate} onClose={() => setShowCreate(false)} warehouses={warehouses} onCreated={() => { load(); onRefreshStats?.(); }} />
    </section>
  );
}

function CreateTransferModal({ open, onClose, warehouses, onCreated }) {
  const [form, setForm] = useState({ from_warehouse_name: "", to_warehouse_name: "", date: today(), items_count: 0 });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.from_warehouse_name) errs.from_warehouse_name = "Выберите склад";
    if (!form.to_warehouse_name) errs.to_warehouse_name = "Выберите склад";
    if (form.from_warehouse_name && form.from_warehouse_name === form.to_warehouse_name) errs.to_warehouse_name = "Должен отличаться";
    if (!form.items_count || form.items_count <= 0) errs.items_count = "Кол-во > 0";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try { await api.post("/warehouse/transfers", form); onCreated(); onClose(); setForm({ from_warehouse_name: "", to_warehouse_name: "", date: today(), items_count: 0 }); setErrors({}); } catch {} finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Новое перемещение">
      <form onSubmit={handleSubmit} className="warehouse-form" noValidate>
        <div className="warehouse-form__row">
          <label className={errors.from_warehouse_name ? "is-invalid" : ""}>
            Со склада
            <select value={form.from_warehouse_name} onChange={(e) => set("from_warehouse_name", e.target.value)}>
              <option value="">—</option>{warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <FieldError msg={errors.from_warehouse_name} />
          </label>
          <label className={errors.to_warehouse_name ? "is-invalid" : ""}>
            На склад
            <select value={form.to_warehouse_name} onChange={(e) => set("to_warehouse_name", e.target.value)}>
              <option value="">—</option>{warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <FieldError msg={errors.to_warehouse_name} />
          </label>
        </div>
        <div className="warehouse-form__row">
          <label className={errors.date ? "is-invalid" : ""}>
            Дата<input value={form.date} onChange={(e) => set("date", e.target.value)} />
          </label>
          <label className={errors.items_count ? "is-invalid" : ""}>
            Кол-во позиций<input type="number" min="1" value={form.items_count} onChange={(e) => set("items_count", +e.target.value)} />
            <FieldError msg={errors.items_count} />
          </label>
        </div>
        <div className="warehouse-form__actions">
          <button type="button" className="warehouse-form__cancel" onClick={onClose}>Отмена</button>
          <button type="submit" className="warehouse-form__submit" disabled={saving}>{saving ? <Spinner /> : "Создать"}</button>
        </div>
      </form>
    </Modal>
  );
}


/* Инвентаризация */
function InventorySection({ warehouses, onRefreshStats, globalSearch, filterStatus }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await api.get("/warehouse/inventory-checks"); setRows(data); }
    catch { setRows([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = (globalSearch || "").toLowerCase();
  const filtered = rows.filter((r) => {
    if (filterStatus === "draft" && r.status !== "draft") return false;
    if (filterStatus === "accepted" && r.status !== "accepted" && r.status !== "active") return false;
    if (!q) return true;
    return (r.warehouse_name || "").toLowerCase().includes(q) || (r.comment || "").toLowerCase().includes(q);
  });

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div><span className="eyebrow">Inventory</span><h2>Инвентаризация</h2></div>
        <button type="button" className="wh-btn wh-btn--primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Создать</button>
      </div>
      {loading ? <TableSkeleton cols={6} rows={3} /> : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon"><ClipboardCheck size={32} strokeWidth={1.5} /></div>
          <h3>{q ? "Ничего не найдено" : "Инвентаризаций пока нет"}</h3>
          <p>{q ? `Нет результатов по запросу «${q}»` : "Создайте первую инвентаризацию."}</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr><th>ID</th><th>Дата</th><th>Склад</th><th>Комментарий</th><th>Тип</th><th>Действия</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><strong>{String(r.id).slice(-4)}</strong></td>
                  <td>
                    {r.created_at ? new Date(r.created_at).toLocaleString("ru-RU") : "—"}
                    {r.created_by_name ? <><br /><small className="muted">{r.created_by_name}</small></> : null}
                  </td>
                  <td>{r.warehouse_name || "—"}</td>
                  <td>{r.comment || "—"}</td>
                  <td><span className={r.check_type?.includes("не учтены") ? "badge badge-warning" : "badge badge-info"}>{r.check_type}</span></td>
                  <td>
                    <div className="table-actions">
                      {statusBadge(r.status)}
                      <IconBtn Icon={Pencil} tone="brand" label="Редактировать" onClick={() => {}} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateInventoryModal open={showCreate} onClose={() => setShowCreate(false)} warehouses={warehouses} onCreated={load} />
    </section>
  );
}

function CreateInventoryModal({ open, onClose, warehouses, onCreated }) {
  const [form, setForm] = useState({ warehouse_name: "", comment: "", check_type: "Приход и расход учтены" });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.warehouse_name) errs.warehouse_name = "Выберите склад";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try { await api.post("/warehouse/inventory-checks", form); onCreated(); onClose(); setForm({ warehouse_name: "", comment: "", check_type: "Приход и расход учтены" }); } catch {} finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Новая инвентаризация">
      <form onSubmit={handleSubmit} className="warehouse-form" noValidate>
        <label className={errors.warehouse_name ? "is-invalid" : ""}>
          Склад
          <select value={form.warehouse_name} onChange={(e) => set("warehouse_name", e.target.value)}>
            <option value="">—</option>{warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          <FieldError msg={errors.warehouse_name} />
        </label>
        <label>Тип<select value={form.check_type} onChange={(e) => set("check_type", e.target.value)}><option>Приход и расход учтены</option><option>Приход и расход не учтены</option></select></label>
        <label>Комментарий<textarea value={form.comment} onChange={(e) => set("comment", e.target.value)} rows={2} /></label>
        <div className="warehouse-form__actions">
          <button type="button" className="warehouse-form__cancel" onClick={onClose}>Отмена</button>
          <button type="submit" className="warehouse-form__submit" disabled={saving}>{saving ? <Spinner /> : "Создать"}</button>
        </div>
      </form>
    </Modal>
  );
}


/* Списание */
function WriteOffSection({ onRefreshStats, globalSearch, filterStatus }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await api.get("/warehouse/write-offs"); setRows(data); }
    catch { setRows([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!confirm("Удалить списание?")) return;
    try { await api.delete(`/warehouse/write-offs/${id}`); load(); } catch {}
  };

  const q = (globalSearch || "").toLowerCase();
  const filtered = rows.filter((r) => {
    if (filterStatus === "draft" && r.status !== "draft") return false;
    if (filterStatus === "accepted" && r.status !== "accepted" && r.status !== "active") return false;
    if (!q) return true;
    return (r.category || "").toLowerCase().includes(q) || (r.note || "").toLowerCase().includes(q);
  });

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div><span className="eyebrow">Write-offs</span><h2>Списание</h2></div>
        <button type="button" className="wh-btn wh-btn--primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Создать</button>
      </div>
      {loading ? <TableSkeleton cols={5} rows={3} /> : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon"><FileX2 size={32} strokeWidth={1.5} /></div>
          <h3>{q ? "Ничего не найдено" : "Списаний пока нет"}</h3>
          <p>{q ? `Нет результатов по запросу «${q}»` : "Создайте первое списание."}</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr><th>ID</th><th>Дата</th><th>Категория</th><th>Кол-во</th><th>Действия</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><strong>{String(r.id).slice(-4)}</strong></td>
                  <td>
                    {r.created_at ? new Date(r.created_at).toLocaleString("ru-RU") : "—"}
                    {r.created_by_name ? <><br /><small className="muted">{r.created_by_name}</small></> : null}
                  </td>
                  <td>{r.category || "—"}</td>
                  <td><strong>{formatNumber(r.items_count)}</strong></td>
                  <td>
                    <div className="table-actions">
                      {statusBadge(r.status)}
                      <IconBtn Icon={Pencil} tone="brand" label="Редактировать" onClick={() => {}} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateWriteOffModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
    </section>
  );
}

function CreateWriteOffModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ category: "", items_count: 0, note: "" });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.category?.trim()) errs.category = "Укажите категорию";
    if (!form.items_count || form.items_count <= 0) errs.items_count = "Кол-во > 0";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try { await api.post("/warehouse/write-offs", form); onCreated(); onClose(); setForm({ category: "", items_count: 0, note: "" }); } catch {} finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Новое списание">
      <form onSubmit={handleSubmit} className="warehouse-form" noValidate>
        <label className={errors.category ? "is-invalid" : ""}>
          Категория<input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Просрочка" />
          <FieldError msg={errors.category} />
        </label>
        <label className={errors.items_count ? "is-invalid" : ""}>
          Кол-во позиций<input type="number" min="1" value={form.items_count} onChange={(e) => set("items_count", +e.target.value)} />
          <FieldError msg={errors.items_count} />
        </label>
        <label>Примечание<textarea value={form.note} onChange={(e) => set("note", e.target.value)} rows={2} /></label>
        <div className="warehouse-form__actions">
          <button type="button" className="warehouse-form__cancel" onClick={onClose}>Отмена</button>
          <button type="submit" className="warehouse-form__submit" disabled={saving}>{saving ? <Spinner /> : "Создать"}</button>
        </div>
      </form>
    </Modal>
  );
}


/* ─── navigation sections ───────────────────────────────────── */
const sections = [
  { key: "summary", label: "Обзор", icon: BarChart3, path: "/warehouse" },
  { key: "incoming", label: "Приход", icon: Package, path: "/warehouse/stock-in" },
  { key: "balance", label: "Остаток", icon: WarehouseIcon, path: "/warehouse/balance" },
  { key: "transfer", label: "Перемещение", icon: ArrowRightLeft, path: "/warehouse/transfer" },
  { key: "inventory", label: "Инвентаризация", icon: ClipboardCheck, path: "/warehouse/inventory" },
  { key: "write-off", label: "Списание", icon: FileX2, path: "/warehouse/write-off" },
];

const sectionByPath = {
  "/warehouse": "summary",
  "/warehouse/stock-in": "incoming",
  "/warehouse/stock-out": "incoming",
  "/warehouse/balance": "balance",
  "/warehouse/income-log": "incoming",
  "/warehouse/transfer": "transfer",
  "/warehouse/inventory": "inventory",
  "/warehouse/waste": "write-off",
  "/warehouse/write-off": "write-off",
  "/warehouse/write-off-categories": "write-off",
};


/* ─── main page ─────────────────────────────────────────────── */
export default function WarehousePage({ initialSection }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedDate } = useOutletContext() || {};
  const [activeSection, setActiveSection] = useState(initialSection || sectionByPath[location.pathname] || "summary");
  const [warehouseNames, setWarehouseNames] = useState(["Главный склад", "BAR", "KUXNYA"]);
  const [stockRows, setStockRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statsKey, setStatsKey] = useState(0);
  const [purchaseCount, setPurchaseCount] = useState(0);
  const [draftCount, setDraftCount] = useState(0);
  const [globalSearch, setGlobalSearch] = useState("");
  const debouncedSearch = useDebounce(globalSearch, 200);
  const [showFilter, setShowFilter] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all"); // all | draft | accepted

  useEffect(() => {
    setActiveSection(initialSection || sectionByPath[location.pathname] || "summary");
  }, [initialSection, location.pathname]);

  /* load warehouses + stock */
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [whRes, stockRes, ingredRes, purchRes] = await Promise.all([
        api.get("/warehouse/list").catch(() => ({ data: [] })),
        api.get("/inventory/stock").catch(() => ({ data: [] })),
        api.get("/inventory/ingredients").catch(() => ({ data: [] })),
        api.get("/warehouse/purchases").catch(() => ({ data: [] })),
      ]);
      if (whRes.data?.length) {
        setWarehouseNames(whRes.data.map((w) => w.name));
      }
      const ingredMap = new Map((ingredRes.data || []).map((i) => [i.id, i]));
      const stockData = (stockRes.data || []).map((s) => {
        const ing = ingredMap.get(s.ingredient_id);
        return { id: s.id || s.ingredient_id, name: ing?.name || "Позиция", raw: Number(s.quantity || 0) * Number(s.cost_price || 0), semi: 0, sale: 0, status: "active" };
      });
      setStockRows(stockData.length ? stockData : [
        { id: "demo-1", name: "Главный склад", raw: 7313452, semi: 25100, sale: 0, status: "active" },
        { id: "demo-2", name: "BAR", raw: 59000, semi: 251000, sale: 0, status: "active" },
        { id: "demo-3", name: "KUXNYA", raw: 0, semi: 0, sale: 0, status: "active" },
      ]);
      const purchases = purchRes.data || [];
      setPurchaseCount(purchases.length);
      setDraftCount(purchases.filter((p) => p.status === "draft").length);
    } catch {
      setError("API склада временно недоступен.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData, statsKey]);

  const refreshStats = () => setStatsKey((k) => k + 1);

  const handlePurchaseStats = useCallback((purchases) => {
    setPurchaseCount(purchases.length);
    setDraftCount(purchases.filter((p) => p.status === "draft").length);
  }, []);

  const stats = useMemo(() => {
    const total = stockRows.reduce((s, r) => s + Number(r.raw || 0) + Number(r.semi || 0) + Number(r.sale || 0), 0);
    return { total, warehouses: warehouseNames.length };
  }, [stockRows, warehouseNames]);

  const hasActiveFilters = filterStatus !== "all" || debouncedSearch;

  /* full-page loader on first load */
  if (loading) return <MarjonLoader text="Загрузка склада…" />;

  return (
    <>
      {/* ─── toolbar ─── */}
      <div className="table-toolbar wh-toolbar">
        <div className="wh-toolbar__search">
          <Search size={16} className="wh-toolbar__search-icon" />
          <input
            placeholder="Поиск по складу…"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="wh-toolbar__search-input"
          />
          {globalSearch && (
            <button type="button" className="wh-toolbar__search-clear" onClick={() => setGlobalSearch("")}>
              <X size={14} />
            </button>
          )}
        </div>
        <div className="wh-toolbar__actions">
          <button
            type="button"
            className={`wh-btn wh-btn--outline ${showFilter ? "is-active" : ""}`}
            onClick={() => setShowFilter((p) => !p)}
          >
            <SlidersHorizontal size={16} /> Фильтр
          </button>
        </div>
      </div>

      {/* ─── filter chips ─── */}
      {showFilter && (
        <div className="wh-filter-row">
          <span className="wh-filter-row__label">Статус:</span>
          {[
            { key: "all", label: "Все" },
            { key: "draft", label: "Черновик" },
            { key: "accepted", label: "Принято" },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              className={`wh-filter-chip ${filterStatus === f.key ? "is-active" : ""}`}
              onClick={() => setFilterStatus(f.key)}
            >
              {f.label}
            </button>
          ))}
          {hasActiveFilters && (
            <button
              type="button"
              className="wh-filter-chip wh-filter-chip--reset"
              onClick={() => { setFilterStatus("all"); setGlobalSearch(""); }}
            >
              <X size={12} /> Сбросить
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="wh-alert">
          <AlertTriangle size={18} /> {error}
        </div>
      )}

      {/* ─── KPI metrics ─── */}
      <section className="kpi-grid">
        <article className="kpi-card compact">
          <div className="kpi-icon orange"><Banknote size={22} /></div>
          <div><div className="kpi-label">Стоимость остатков</div><div className="kpi-value">{formatMoney(stats.total)}</div></div>
        </article>
        <article className="kpi-card compact">
          <div className="kpi-icon blue"><WarehouseIcon size={22} /></div>
          <div><div className="kpi-label">Складов</div><div className="kpi-value">{formatNumber(stats.warehouses)}</div></div>
        </article>
        <article className="kpi-card compact">
          <div className="kpi-icon green"><ClipboardList size={22} /></div>
          <div><div className="kpi-label">Приходов</div><div className="kpi-value">{purchaseCount || "—"}</div></div>
        </article>
        <article className="kpi-card compact">
          <div className="kpi-icon purple"><FileWarning size={22} /></div>
          <div><div className="kpi-label">Черновиков</div><div className="kpi-value">{draftCount || "—"}</div></div>
        </article>
      </section>

      {/* ─── section tabs ─── */}
      <div className="wh-tabs">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              type="button"
              className={`wh-tab ${activeSection === s.key ? "is-active" : ""}`}
              onClick={() => { setActiveSection(s.key); navigate(s.path); }}
            >
              <Icon size={16} /> {s.label}
            </button>
          );
        })}
      </div>

      {/* ─── active section content ─── */}
      {activeSection === "summary" && (
        <SummaryTable title="Остатки по складам" rows={stockRows} loading={false} />
      )}

      {(activeSection === "incoming" || activeSection === "incoming-log") && (
        <IncomingSection warehouses={warehouseNames} onRefreshStats={refreshStats} onPurchaseStats={handlePurchaseStats} globalSearch={debouncedSearch} filterStatus={filterStatus} />
      )}

      {activeSection === "balance" && (
        <SummaryTable title="Остаток" rows={stockRows} loading={false} />
      )}

      {activeSection === "transfer" && (
        <TransferSection warehouses={warehouseNames} onRefreshStats={refreshStats} globalSearch={debouncedSearch} filterStatus={filterStatus} />
      )}

      {activeSection === "inventory" && (
        <InventorySection warehouses={warehouseNames} onRefreshStats={refreshStats} globalSearch={debouncedSearch} filterStatus={filterStatus} />
      )}

      {(activeSection === "write-off" || activeSection === "expense") && (
        <WriteOffSection onRefreshStats={refreshStats} globalSearch={debouncedSearch} filterStatus={filterStatus} />
      )}
    </>
  );
}

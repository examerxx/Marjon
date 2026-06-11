import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, formatMoney, formatNumber } from "../api/client";
import {
  ChevronLeft, ChevronRight, Search, SlidersHorizontal,
  Plus, Eye, Trash2, Pencil, X, Package, ArrowRightLeft,
  ClipboardCheck, FileX2, BarChart3, Warehouse as WarehouseIcon,
  AlertTriangle, Loader2, Check,
} from "lucide-react";


/* ─── helpers ───────────────────────────────────────────────── */
function today() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function statusLabel(s) {
  return s === "accepted" || s === "active" ? "Принято" : "Черновой";
}

function MoneyCell({ value, muted = false }) {
  return <span className={muted ? "is-muted" : ""}>{formatMoney(value)}</span>;
}

function WarehouseStatus({ status }) {
  return (
    <span className={`warehouse-status ${status === "draft" ? "is-draft" : "is-accepted"}`}>
      {statusLabel(status)}
    </span>
  );
}

function IconBtn({ Icon, tone = "blue", label, onClick }) {
  return (
    <button type="button" className={`warehouse-icon-button warehouse-icon-button--${tone}`} aria-label={label} onClick={onClick}>
      <Icon size={16} />
    </button>
  );
}

function Spinner() {
  return <Loader2 className="warehouse-spinner" size={20} />;
}


/* ─── modal shell ───────────────────────────────────────────── */
function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="warehouse-modal-backdrop" onClick={onClose}>
      <div className={`warehouse-modal ${wide ? "warehouse-modal--wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="warehouse-modal__head">
          <h3>{title}</h3>
          <button type="button" className="warehouse-modal__close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="warehouse-modal__body">{children}</div>
      </div>
    </div>
  );
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
    <article className="warehouse-board">
      <div className="warehouse-title-mark" />
      <h3>{title}</h3>
      {loading ? <Spinner /> : (
        <div className="warehouse-money-table">
          <div className="warehouse-money-table__head">
            <span>№</span><span>Название</span><span>Сырьё</span><span>Полуфабрикат</span><span>Реализация</span><span>Сумма</span>
          </div>
          <div className="warehouse-money-table__row is-total">
            <span /><strong>Итого</strong>
            <MoneyCell value={totals.raw} /><MoneyCell value={totals.semi} /><MoneyCell value={totals.sale} />
            <MoneyCell value={totals.raw + totals.semi + totals.sale} />
          </div>
          {rows.map((r, i) => (
            <div className="warehouse-money-table__row" key={r.id}>
              <span>{i + 1}</span>
              <Link to="/warehouse/balance">{r.name}</Link>
              <MoneyCell value={r.raw} muted={!r.raw} /><MoneyCell value={r.semi} muted={!r.semi} />
              <MoneyCell value={r.sale} muted={!r.sale} /><MoneyCell value={rowTotal(r)} muted={!rowTotal(r)} />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}


/* Приходы */
function IncomingSection({ warehouses, onRefreshStats }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [viewDoc, setViewDoc] = useState(null);

  const load = useCallback(async (q = "") => {
    try {
      setLoading(true);
      const { data } = await api.get("/warehouse/purchases", { params: q ? { q } : {} });
      setRows(data);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e) => {
    e.preventDefault();
    load(search);
  };

  const handleDelete = async (id) => {
    if (!confirm("Удалить документ?")) return;
    try {
      await api.delete(`/warehouse/purchases/${id}`);
      load(search);
      onRefreshStats?.();
    } catch { /* ignore */ }
  };

  const handleAccept = async (id) => {
    try {
      await api.patch(`/warehouse/purchases/${id}`, { status: "accepted" });
      load(search);
      onRefreshStats?.();
    } catch { /* ignore */ }
  };

  return (
    <article className="warehouse-board">
      <div className="warehouse-board__head">
        <div>
          <div className="warehouse-title-mark" />
          <h3>Поступление товаров</h3>
        </div>
        <button type="button" className="warehouse-create" onClick={() => setShowCreate(true)}>
          Создать <Plus size={16} />
        </button>
      </div>
      <form className="warehouse-search-line" onSubmit={handleSearch}>
        <label>
          <input placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" style={{ all: "unset", cursor: "pointer", display: "grid", placeItems: "center", width: 48, height: "100%", position: "absolute", right: 0, top: 0, background: "#dbe5f5" }}>
            <Search size={16} />
          </button>
        </label>
      </form>

      {loading ? <Spinner /> : rows.length === 0 ? (
        <p className="warehouse-empty">Документов пока нет. Нажмите «Создать» чтобы добавить приход.</p>
      ) : (
        <div className="warehouse-document-table warehouse-document-table--incoming">
          <div className="warehouse-document-table__head">
            <span>Номер</span><span>Поставщик</span><span>На склад</span><span>Дата</span>
            <span>Регистрация</span><span>Приём</span><span>Кол-во</span><span>Сумма</span><span>Действия</span>
          </div>
          {rows.map((r) => (
            <div className="warehouse-document-table__row" key={r.id} onClick={() => setViewDoc(r)} style={{ cursor: "pointer" }}>
              <strong>{r.number}</strong>
              <span>{r.supplier || "—"}</span>
              <span>{r.warehouse_name || "—"}</span>
              <span>{r.date || "—"}</span>
              <span>{r.registered_at || "—"}{r.created_by_name ? <small>{r.created_by_name}</small> : null}</span>
              <span>{r.accepted_at || "—"}</span>
              <span>{formatNumber(r.items_count)}</span>
              <MoneyCell value={r.total_amount} muted={!Number(r.total_amount)} />
              <div className="warehouse-row-actions" onClick={(e) => e.stopPropagation()}>
                <WarehouseStatus status={r.status} />
                {r.status === "draft" && (
                  <IconBtn Icon={Check} tone="green" label="Принять" onClick={() => handleAccept(r.id)} />
                )}
                <IconBtn Icon={Eye} label="Открыть" onClick={() => setViewDoc(r)} />
                {r.status === "draft" && (
                  <IconBtn Icon={Trash2} tone="red" label="Удалить" onClick={() => handleDelete(r.id)} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreatePurchaseModal open={showCreate} onClose={() => setShowCreate(false)} warehouses={warehouses} onCreated={() => { load(search); onRefreshStats?.(); }} />
      <Modal open={!!viewDoc} onClose={() => setViewDoc(null)} title={viewDoc ? `Приход #${viewDoc.number}` : ""} wide>
        {viewDoc && (
          <div className="warehouse-detail-grid">
            <div><span>Поставщик</span><strong>{viewDoc.supplier || "—"}</strong></div>
            <div><span>Склад</span><strong>{viewDoc.warehouse_name || "—"}</strong></div>
            <div><span>Дата</span><strong>{viewDoc.date || "—"}</strong></div>
            <div><span>Статус</span><WarehouseStatus status={viewDoc.status} /></div>
            <div><span>Кол-во позиций</span><strong>{viewDoc.items_count}</strong></div>
            <div><span>Итого</span><strong>{formatMoney(viewDoc.total_amount)}</strong></div>
            <div><span>Регистрация</span><strong>{viewDoc.registered_at || "—"}</strong></div>
            <div><span>Приём</span><strong>{viewDoc.accepted_at || "—"}</strong></div>
            {viewDoc.note && <div style={{ gridColumn: "1 / -1" }}><span>Примечание</span><strong>{viewDoc.note}</strong></div>}
          </div>
        )}
      </Modal>
    </article>
  );
}

function CreatePurchaseModal({ open, onClose, warehouses, onCreated }) {
  const [form, setForm] = useState({ supplier: "", warehouse_name: "", date: today(), note: "" });
  const [items, setItems] = useState([{ name: "", quantity: "", unit: "кг", cost_price: "" }]);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i, k, v) => setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, [k]: v } : it));
  const addItem = () => setItems((a) => [...a, { name: "", quantity: "", unit: "кг", cost_price: "" }]);
  const removeItem = (i) => setItems((a) => a.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
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
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Новый приход" wide>
      <form onSubmit={handleSubmit} className="warehouse-form">
        <div className="warehouse-form__row">
          <label>Поставщик<input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} placeholder="BOZOR" /></label>
          <label>Склад
            <select value={form.warehouse_name} onChange={(e) => set("warehouse_name", e.target.value)}>
              <option value="">— Выберите —</option>
              {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
          <label>Дата<input value={form.date} onChange={(e) => set("date", e.target.value)} placeholder="11.06.2026" /></label>
        </div>

        <h4>Позиции</h4>
        {items.map((it, i) => (
          <div className="warehouse-form__row warehouse-form__item" key={i}>
            <label>Наименование<input value={it.name} onChange={(e) => setItem(i, "name", e.target.value)} placeholder="Говядина" required /></label>
            <label>Кол-во<input type="number" step="0.01" value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} placeholder="10" /></label>
            <label>Ед.<input value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} style={{ width: 60 }} /></label>
            <label>Цена<input type="number" step="0.01" value={it.cost_price} onChange={(e) => setItem(i, "cost_price", e.target.value)} placeholder="45000" /></label>
            {items.length > 1 && (
              <button type="button" className="warehouse-form__remove" onClick={() => removeItem(i)}><X size={14} /></button>
            )}
          </div>
        ))}
        <button type="button" className="warehouse-form__add" onClick={addItem}><Plus size={14} /> Добавить позицию</button>

        <label>Примечание<textarea value={form.note} onChange={(e) => set("note", e.target.value)} rows={2} /></label>

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
function TransferSection({ warehouses, onRefreshStats }) {
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

  return (
    <article className="warehouse-board">
      <div className="warehouse-board__head">
        <div><div className="warehouse-title-mark" /><h3>Перемещение товаров</h3></div>
        <button type="button" className="warehouse-create" onClick={() => setShowCreate(true)}>Создать <Plus size={16} /></button>
      </div>
      {loading ? <Spinner /> : rows.length === 0 ? (
        <p className="warehouse-empty">Перемещений пока нет.</p>
      ) : (
        <div className="warehouse-document-table warehouse-document-table--transfer">
          <div className="warehouse-document-table__head">
            <span>Дата</span><span>Со склада</span><span>На склад</span><span>Кол-во</span><span>Дата создания</span><span>Действия</span>
          </div>
          {rows.map((r) => (
            <div className="warehouse-document-table__row" key={r.id}>
              <span>{r.date || "—"}</span>
              <span>{r.from_warehouse_name || "—"}</span>
              <span>{r.to_warehouse_name || "—"}</span>
              <strong>{formatNumber(r.items_count)}</strong>
              <span>{r.created_at ? new Date(r.created_at).toLocaleString("ru-RU") : "—"}</span>
              <div className="warehouse-row-actions">
                <WarehouseStatus status={r.status} />
                <IconBtn Icon={Trash2} tone="red" label="Удалить" onClick={() => handleDelete(r.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
      <CreateTransferModal open={showCreate} onClose={() => setShowCreate(false)} warehouses={warehouses} onCreated={() => { load(); onRefreshStats?.(); }} />
    </article>
  );
}

function CreateTransferModal({ open, onClose, warehouses, onCreated }) {
  const [form, setForm] = useState({ from_warehouse_name: "", to_warehouse_name: "", date: today(), items_count: 0 });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    try { await api.post("/warehouse/transfers", form); onCreated(); onClose(); } catch {} finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Новое перемещение">
      <form onSubmit={handleSubmit} className="warehouse-form">
        <div className="warehouse-form__row">
          <label>Со склада<select value={form.from_warehouse_name} onChange={(e) => set("from_warehouse_name", e.target.value)}><option value="">—</option>{warehouses.map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
          <label>На склад<select value={form.to_warehouse_name} onChange={(e) => set("to_warehouse_name", e.target.value)}><option value="">—</option>{warehouses.map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
        </div>
        <div className="warehouse-form__row">
          <label>Дата<input value={form.date} onChange={(e) => set("date", e.target.value)} /></label>
          <label>Кол-во позиций<input type="number" value={form.items_count} onChange={(e) => set("items_count", +e.target.value)} /></label>
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
function InventorySection({ warehouses, onRefreshStats }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try { const { data } = await api.get("/warehouse/inventory-checks"); setRows(data); }
    catch { setRows([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!confirm("Удалить инвентаризацию?")) return;
    try { await api.delete(`/warehouse/inventory-checks/${id}`); load(); } catch {}
  };

  const filtered = search
    ? rows.filter((r) => (r.warehouse_name || "").toLowerCase().includes(search.toLowerCase()) || (r.comment || "").toLowerCase().includes(search.toLowerCase()))
    : rows;

  return (
    <article className="warehouse-board">
      <div className="warehouse-board__head">
        <div><div className="warehouse-title-mark" /><h3>Инвентаризация</h3></div>
        <button type="button" className="warehouse-create" onClick={() => setShowCreate(true)}>Создать <Plus size={16} /></button>
      </div>
      <div className="warehouse-search-line">
        <label>
          <input placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span style={{ position: "absolute", right: 0, top: 0, width: 48, height: "100%", display: "grid", placeItems: "center", background: "#dbe5f5" }}><Search size={16} /></span>
        </label>
      </div>
      {loading ? <Spinner /> : filtered.length === 0 ? (
        <p className="warehouse-empty">Инвентаризаций пока нет.</p>
      ) : (
        <div className="warehouse-document-table warehouse-document-table--inventory">
          <div className="warehouse-document-table__head">
            <span>ID</span><span>Дата</span><span>Склад</span><span>Комментарий</span><span>Тип</span><span>Действия</span>
          </div>
          {filtered.map((r) => (
            <div className="warehouse-document-table__row" key={r.id}>
              <strong>{String(r.id).slice(-4)}</strong>
              <span>{r.created_at ? new Date(r.created_at).toLocaleString("ru-RU") : "—"}{r.created_by_name ? <small>{r.created_by_name}</small> : null}</span>
              <span>{r.warehouse_name || "—"}</span>
              <span>{r.comment || "—"}</span>
              <span className={r.check_type?.includes("не учтены") ? "is-warning-text" : ""}>{r.check_type}</span>
              <div className="warehouse-row-actions">
                <WarehouseStatus status={r.status} />
                <IconBtn Icon={Pencil} tone="yellow" label="Редактировать" onClick={() => {}} />
              </div>
            </div>
          ))}
        </div>
      )}
      <CreateInventoryModal open={showCreate} onClose={() => setShowCreate(false)} warehouses={warehouses} onCreated={load} />
    </article>
  );
}

function CreateInventoryModal({ open, onClose, warehouses, onCreated }) {
  const [form, setForm] = useState({ warehouse_name: "", comment: "", check_type: "Приход и расход учтены" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    try { await api.post("/warehouse/inventory-checks", form); onCreated(); onClose(); } catch {} finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Новая инвентаризация">
      <form onSubmit={handleSubmit} className="warehouse-form">
        <label>Склад<select value={form.warehouse_name} onChange={(e) => set("warehouse_name", e.target.value)}><option value="">—</option>{warehouses.map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
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
function WriteOffSection({ onRefreshStats }) {
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

  return (
    <article className="warehouse-board">
      <div className="warehouse-board__head">
        <div><div className="warehouse-title-mark" /><h3>Списание</h3></div>
        <button type="button" className="warehouse-create" onClick={() => setShowCreate(true)}>Создать <Plus size={16} /></button>
      </div>
      {loading ? <Spinner /> : rows.length === 0 ? (
        <p className="warehouse-empty">Списаний пока нет.</p>
      ) : (
        <div className="warehouse-document-table warehouse-document-table--writeoff">
          <div className="warehouse-document-table__head">
            <span>ID</span><span>Дата</span><span>Категория</span><span>Кол-во</span><span>Действия</span>
          </div>
          {rows.map((r) => (
            <div className="warehouse-document-table__row" key={r.id}>
              <strong>{String(r.id).slice(-4)}</strong>
              <span>{r.created_at ? new Date(r.created_at).toLocaleString("ru-RU") : "—"}{r.created_by_name ? <small>{r.created_by_name}</small> : null}</span>
              <span>{r.category || "—"}</span>
              <strong>{formatNumber(r.items_count)}</strong>
              <div className="warehouse-row-actions">
                <WarehouseStatus status={r.status} />
                <IconBtn Icon={Pencil} tone="yellow" label="Редактировать" onClick={() => {}} />
              </div>
            </div>
          ))}
        </div>
      )}
      <CreateWriteOffModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
    </article>
  );
}

function CreateWriteOffModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ category: "", items_count: 0, note: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    try { await api.post("/warehouse/write-offs", form); onCreated(); onClose(); } catch {} finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Новое списание">
      <form onSubmit={handleSubmit} className="warehouse-form">
        <label>Категория<input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Просрочка" /></label>
        <label>Кол-во позиций<input type="number" value={form.items_count} onChange={(e) => set("items_count", +e.target.value)} /></label>
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
  const [activeSection, setActiveSection] = useState(initialSection || sectionByPath[location.pathname] || "summary");
  const [warehouseNames, setWarehouseNames] = useState(["Главный склад", "BAR", "KUXNYA"]);
  const [stockRows, setStockRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statsKey, setStatsKey] = useState(0);

  useEffect(() => {
    setActiveSection(initialSection || sectionByPath[location.pathname] || "summary");
  }, [initialSection, location.pathname]);

  /* load warehouses + stock */
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [whRes, stockRes, ingredRes] = await Promise.all([
        api.get("/warehouse/list").catch(() => ({ data: [] })),
        api.get("/inventory/stock").catch(() => ({ data: [] })),
        api.get("/inventory/ingredients").catch(() => ({ data: [] })),
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
    } catch {
      setError("API склада временно недоступен.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData, statsKey]);

  const refreshStats = () => setStatsKey((k) => k + 1);

  const stats = useMemo(() => {
    const total = stockRows.reduce((s, r) => s + Number(r.raw || 0) + Number(r.semi || 0) + Number(r.sale || 0), 0);
    return { total, warehouses: warehouseNames.length };
  }, [stockRows, warehouseNames]);

  return (
    <section className="warehouse-workspace">
      {/* toolbar */}
      <div className="warehouse-workspace__toolbar">
        <button type="button" className="warehouse-date-button">
          <ChevronLeft size={14} /> Выберите дату <ChevronRight size={14} />
        </button>
        <div className="warehouse-toolbar__right">
          <label className="warehouse-global-search">
            <input placeholder="Поиск по складу" />
            <span style={{ position: "absolute", right: 0, top: 0, width: 48, height: "100%", display: "grid", placeItems: "center", background: "#dbe5f5" }}><Search size={16} /></span>
          </label>
          <button type="button" className="warehouse-filter">
            <SlidersHorizontal size={16} /> Фильтровать
          </button>
        </div>
      </div>

      {error && (
        <div className="warehouse-alert">
          <AlertTriangle size={18} /> {error}
        </div>
      )}

      <div className="warehouse-workspace__layout">
        {/* sidebar */}
        <nav className="warehouse-sections">
          <div className="warehouse-sections__head">
            <span>Склад</span>
            <strong>Управление</strong>
          </div>
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                type="button"
                className={`warehouse-section-link ${activeSection === s.key ? "is-active" : ""}`}
                onClick={() => { setActiveSection(s.key); navigate(s.path); }}
              >
                <Icon size={16} /> {s.label}
              </button>
            );
          })}
        </nav>

        {/* content */}
        <div className="warehouse-workspace__content">
          {/* metrics */}
          <div className="warehouse-metrics">
            <article>
              <span>Стоимость остатков</span>
              <strong>{loading ? "..." : formatMoney(stats.total)}</strong>
            </article>
            <article>
              <span>Складов</span>
              <strong>{formatNumber(stats.warehouses)}</strong>
            </article>
            <article>
              <span>Приходов</span>
              <strong>—</strong>
            </article>
            <article>
              <span>Черновиков</span>
              <strong>—</strong>
            </article>
          </div>

          {activeSection === "summary" && (
            <>
              <SummaryTable title="Остатки по складам" rows={stockRows} loading={loading} />
            </>
          )}

          {(activeSection === "incoming" || activeSection === "incoming-log") && (
            <IncomingSection warehouses={warehouseNames} onRefreshStats={refreshStats} />
          )}

          {activeSection === "balance" && (
            <SummaryTable title="Остаток" rows={stockRows} loading={loading} />
          )}

          {activeSection === "transfer" && (
            <TransferSection warehouses={warehouseNames} onRefreshStats={refreshStats} />
          )}

          {activeSection === "inventory" && (
            <InventorySection warehouses={warehouseNames} onRefreshStats={refreshStats} />
          )}

          {(activeSection === "write-off" || activeSection === "expense") && (
            <WriteOffSection onRefreshStats={refreshStats} />
          )}
        </div>
      </div>
    </section>
  );
}

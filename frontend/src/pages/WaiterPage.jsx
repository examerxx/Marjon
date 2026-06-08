import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import logo from "../assets/marjon-logo.png";
import { api, formatMoney, logout } from "../api/client";

const tableStatuses = ["free", "occupied", "reserved"];
const TABLE_COUNT = 50;
const statusLabels = { free: "Bo'sh", occupied: "Band", reserved: "Bron" };
const activeOrderStatuses = ["new", "accepted", "cooking", "ready"];
const orderStatusLabels = {
  new: "Yangi",
  accepted: "Qabul qilingan",
  cooking: "Tayyorlanmoqda",
  ready: "Tayyor",
  completed: "Yakunlangan",
  cancelled: "Bekor qilingan",
};
const tableAreas = [
  { key: "hall", label: "Зал", from: 1, to: 9 },
  { key: "terrace", label: "Терраса", from: 10, to: 14 },
  { key: "vip", label: "VIP", from: 15, to: 18 },
  { key: "cabins", label: "Кабинки", from: 19, to: 30 },
  { key: "second_hall", label: "Зал 2", from: 31, to: 40 },
  { key: "banquet", label: "Банкет", from: 41, to: 50 },
];

function getTableArea(number) {
  return tableAreas.find((area) => number >= area.from && number <= area.to) || tableAreas[0];
}

function buildTables(orders) {
  const activeByTable = new Map();
  orders
    .filter((order) => activeOrderStatuses.includes(order.status) && order.table_number)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .forEach((order) => {
      const tableNumber = String(order.table_number);
      if (!activeByTable.has(tableNumber)) activeByTable.set(tableNumber, order);
    });

  return Array.from({ length: TABLE_COUNT }, (_, index) => {
    const number = String(index + 1);
    const area = getTableArea(index + 1);
    const order = activeByTable.get(number);
    const status = order ? "occupied" : number === "8" ? "reserved" : "free";
    return { id: number, number, zone: area.label, areaKey: area.key, status, order };
  });
}

function formatOrderTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function ensureBranch() {
  const { data } = await api.get("/companies/me/branches");
  if (data.length) return data[0];
  const created = await api.post("/companies/me/branches", { name: "MARJON Main", address: "Tashkent", city: "Tashkent" });
  return created.data;
}

function WaiterShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const items = [
    { to: "/waiter", icon: "bi-grid-3x3-gap", label: "Stollar", exact: true },
    { to: "/waiter/new", icon: "bi-plus-circle", label: "Yangi buyurtma" },
    { to: "/waiter/orders", icon: "bi-receipt", label: "Buyurtmalarim" },
  ];

  return (
    <div className="pos-body">
      <aside className="pos-sidebar pos-sidebar--sleek pos-sidebar--ownerlike">
        <div className="pos-brand">
          <div className="pos-brand__mark"><img src={logo} alt="MARJON" className="marjon-logo" /></div>
          <div><strong>MARJON</strong><span>Ofitsiant POS</span></div>
        </div>
        <nav className="pos-nav">
          {items.map((item) => {
            const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
            return <Link key={item.to} to={item.to} className={active ? "is-active" : ""}><span className="pos-nav__icon"><i className={`bi ${item.icon}`} /></span><span>{item.label}</span></Link>;
          })}
          <button type="button" onClick={handleLogout} className="pos-nav-button"><span className="pos-nav__icon"><i className="bi bi-box-arrow-right" /></span><span>Chiqish</span></button>
        </nav>
        <button type="button" onClick={handleLogout} className="pos-sidebar-user">
          <span className="pos-sidebar-user__avatar"><img src={logo} alt="MARJON" className="sidebar-user-logo" decoding="async" /></span>
          <span className="pos-sidebar-user__meta"><strong>ofitsiant</strong><small>waiter</small><em>MARJON</em></span>
          <i className="bi bi-chevron-right" aria-hidden="true" />
        </button>
      </aside>
      <main className="pos-main pos-main--warm">{children}</main>
    </div>
  );
}

function TablesView({ orders }) {
  const [status, setStatus] = useState("all");
  const [area, setArea] = useState("all");
  const tables = useMemo(() => buildTables(orders), [orders]);
  const areaTables = area === "all" ? tables : tables.filter((table) => table.areaKey === area);
  const visible = status === "all" ? areaTables : areaTables.filter((table) => table.status === status);
  const stats = tableStatuses.reduce((acc, value) => ({ ...acc, [value]: areaTables.filter((table) => table.status === value).length }), { total: areaTables.length });
  const selectedArea = area === "all" ? null : tableAreas.find((item) => item.key === area);

  return (
    <>
      <div className="pos-top pos-top--desktop pos-hero-card">
        <div><span className="pos-kicker">Ofitsiant ish joyi</span><h1>Stollar</h1><p>MARJON</p></div>
        <div className="pos-top__actions"><Link className="pos-btn pos-btn--ghost" to="/waiter/orders">Buyurtmalar</Link><Link className="pos-btn" to="/waiter/new">+ Yangi buyurtma</Link></div>
      </div>
      <section className="pos-overview" aria-label="Table summary">
        <div className="pos-stat"><span>Jami</span><strong>{stats.total}</strong></div>
        <div className="pos-stat pos-stat--free"><span>Bo'sh</span><strong>{stats.free}</strong></div>
        <div className="pos-stat pos-stat--occupied"><span>Band</span><strong>{stats.occupied}</strong></div>
        <div className="pos-stat pos-stat--reserved"><span>Bron</span><strong>{stats.reserved}</strong></div>
      </section>
      <section className="pos-workspace pos-workspace--tables">
        <section className="pos-table-board pos-card-soft">
          <div className="pos-table-toolbar">
            <div className="pos-combo-field">
              <label htmlFor="waiter-area-filter">Местоположение</label>
              <select id="waiter-area-filter" value={area} onChange={(event) => setArea(event.target.value)} className="pos-select">
                <option value="all">Все зоны</option>
                {tableAreas.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </div>
            <div className="pos-combo-field">
              <label htmlFor="waiter-status-filter">Holat</label>
              <select id="waiter-status-filter" value={status} onChange={(event) => setStatus(event.target.value)} className="pos-select">
                <option value="all">Barchasi</option>
                {tableStatuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
              </select>
            </div>
          </div>
          <div className="pos-board-head"><div><h2>Joylar xaritasi</h2><p>{selectedArea ? `${selectedArea.label}: stol ${selectedArea.from}-${selectedArea.to}` : "Barcha zonalar"} · Bo'sh stol yangi buyurtma ochadi, band stol buyurtma sahifasiga olib o'tadi.</p></div></div>
          <div className="pos-table-grid">
            {visible.map((table) => {
              const content = <><span className="pos-table__status">{statusLabels[table.status]}</span><span className="pos-table__num">{table.number}</span><span className="pos-table__meta">{table.zone}</span><small>{table.status === "occupied" ? `Buyurtma #${table.order?.order_number}` : "Yangi buyurtma"}</small></>;
              if (table.status === "occupied") {
                return <Link key={table.id} className={`pos-table pos-table--${table.status}`} to={`/waiter/order/${table.order?.id}`}>{content}</Link>;
              }
              return <Link key={table.id} className={`pos-table pos-table--${table.status}`} to={`/waiter/new?table=${table.number}`}>{content}</Link>;
            })}
          </div>
          {!visible.length ? <div className="pos-empty-inline">Bu filtr bo'yicha stol topilmadi.</div> : null}
        </section>
      </section>
    </>
  );
}

function NewOrderView({ branch, categories, products, onCreated }) {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedTable = new URLSearchParams(location.search).get("table") || "1";
  const [table, setTable] = useState(selectedTable);
  const [cart, setCart] = useState([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const total = cart.reduce((sum, row) => sum + Number(row.price || 0) * row.qty, 0);
  const totalItems = cart.reduce((sum, row) => sum + row.qty, 0);

  const grouped = useMemo(() => {
    const byCategory = new Map(categories.map((category) => [category.id, { ...category, items: [] }]));
    products.forEach((product) => {
      const target = byCategory.get(product.category_id) || byCategory.get("other");
      if (target) target.items.push(product);
    });
    const groups = [...byCategory.values()].filter((group) => group.items.length);
    const uncategorized = products.filter((product) => !product.category_id || !byCategory.has(product.category_id));
    if (uncategorized.length) groups.push({ id: "other", name: "Boshqa", items: uncategorized });
    return groups;
  }, [categories, products]);
  const visibleGroups = selectedCategory === "all" ? grouped : grouped.filter((group) => String(group.id) === selectedCategory);

  function addProduct(product) {
    setCart((current) => {
      const existing = current.find((row) => row.id === product.id);
      if (existing) return current.map((row) => row.id === product.id ? { ...row, qty: row.qty + 1 } : row);
      return [...current, { id: product.id, name: product.name, price: product.price, qty: 1 }];
    });
  }

  function changeQty(id, diff) {
    setCart((current) => current
      .map((row) => row.id === id ? { ...row, qty: row.qty + diff } : row)
      .filter((row) => row.qty > 0));
  }

  async function submitOrder() {
    if (!cart.length || !branch?.id) return;
    setSubmitting(true);
    setMessage("");
    try {
      const { data: order } = await api.post("/pos/orders", {
        branch_id: branch.id,
        order_type: "dine_in",
        table_number: String(table),
        persons_count: 1,
        note,
        items: cart.map((row) => ({ product_id: row.id, quantity: row.qty })),
      });
      await api.patch(`/pos/orders/${order.id}/status`, { status: "accepted" });
      setCart([]);
      setNote("");
      setMessage(`Buyurtma #${order.order_number} oshxonaga yuborildi`);
      onCreated?.();
      window.setTimeout(() => navigate("/waiter/orders"), 600);
    } catch (err) {
      setMessage(err.response?.data?.detail || "Buyurtmani yaratib bo'lmadi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="pos-top pos-hero-card pos-order-hero">
        <div>
          <span className="pos-kicker">Yangi buyurtma</span>
          <h1>Stol #{table}</h1>
          <p>{"Stol -> menyu -> savat -> oshxona"}</p>
        </div>
        <div className="pos-order-hero__meta">
          <span>{grouped.length} bo'lim</span>
          <strong>{totalItems} ta mahsulot</strong>
        </div>
      </div>
      {message ? <div className="pos-msg">{message}</div> : null}
      <div className="pos-layout pos-order-layout">
        <section className="pos-menu-terminal">
          <div className="pos-card pos-card-soft pos-table-picker">
            <label><strong>Stol</strong></label>
            <select value={table} onChange={(event) => setTable(event.target.value)} className="pos-select">
              {Array.from({ length: TABLE_COUNT }, (_, index) => {
                const number = index + 1;
                const area = getTableArea(number);
                return <option key={number} value={number}>№{number} - {area.label}</option>;
              })}
            </select>
          </div>
          <div className="pos-order-screen">
            <div className="pos-menu-category-combo">
              <label htmlFor="waiter-menu-category">Kategoriya</label>
              <select id="waiter-menu-category" value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} className="pos-select">
                <option value="all">Barcha kategoriyalar</option>
                {grouped.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.items.length})</option>)}
              </select>
            </div>
            <div className="pos-menu-content">
              {visibleGroups.map((group, groupIndex) => (
                <div key={group.id} className="pos-menu-section">
                  <div className="pos-section-head">
                    <div>
                      <span className="pos-section-kicker">Menu bo'limi</span>
                      <h2 id={`cat-${group.id}`}>{group.name}</h2>
                    </div>
                    <strong>{group.items.length} ta</strong>
                  </div>
                  <div className="pos-menu-grid pos-menu-grid--rich">
                    {group.items.map((product, productIndex) => (
                      <article className="pos-dish pos-dish--rich" key={product.id}>
                        <button className="pos-dish__quick" type="button" onClick={() => addProduct(product)}>+</button>
                        <div className={`pos-dish__ph pos-dish__ph--${(groupIndex + productIndex) % 5}`}>
                          <span>{product.name?.slice(0, 2).toUpperCase() || "MJ"}</span>
                        </div>
                        <div className="pos-dish__body">
                          <strong>{product.name}</strong>
                          <p>{product.description || "Tayyor taom"}</p>
                          <div className="pos-dish__footer">
                            <div className="pos-dish__price">{formatMoney(product.price)}</div>
                            <button className="pos-btn" type="button" onClick={() => addProduct(product)}>Qo'shish</button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {!products.length ? <div className="pos-card">Menyu hali bo'sh.</div> : null}
        </section>
        <aside className="pos-card pos-cart-card">
          <div className="pos-cart-head">
            <div>
              <span>Stol #{table}</span>
              <h2>Savat</h2>
            </div>
            <strong>{totalItems}</strong>
          </div>
          <div className="pos-cart-lines">{cart.length ? cart.map((row) => <div className="pos-cart-line" key={row.id}><div><strong>{row.name}</strong><span>{formatMoney(row.price)}</span></div><div className="pos-qty"><button type="button" onClick={() => changeQty(row.id, -1)}>-</button><b>{row.qty}</b><button type="button" onClick={() => changeQty(row.id, 1)}>+</button></div></div>) : <div className="pos-cart-empty">Savat bo'sh. Menyudan taom qo'shing.</div>}</div>
          <div className="pos-cart-total"><span>Jami</span><strong>{formatMoney(total)}</strong></div>
          <label>Izoh</label>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows="3" className="pos-textarea" />
          <div className="pos-cart-actions"><button className="pos-btn pos-btn--ghost" type="button" onClick={() => setCart([])}>Tozalash</button><button className="pos-btn" type="button" disabled={!cart.length || submitting} onClick={submitOrder}>{submitting ? "Yuborilmoqda..." : "Oshxonaga"}</button></div>
        </aside>
      </div>
    </>
  );
}

function OrdersView({ orders }) {
  return (
    <>
      <div className="pos-top pos-hero-card"><h1>Bugungi buyurtmalar</h1><Link className="pos-btn" to="/waiter/new">+ Yangi</Link></div>
      {orders.map((order) => <article className="pos-card pos-order-row" key={order.id}><div><strong>Buyurtma #{order.order_number}</strong><div>Stol {order.table_number ? `№${order.table_number}` : "-"}</div><div>{order.items?.map((item) => `${item.name} x${Number(item.quantity)}`).join(", ") || "Mahsulotlar yo'q"}</div></div><div><strong>{formatMoney(order.total_amount)}</strong><span>{order.status}</span></div></article>)}
      {!orders.length ? <div className="pos-card">Bugun buyurtmalar yo'q.</div> : null}
    </>
  );
}

function OrderDetailView({ orders }) {
  const { orderId } = useParams();
  const order = orders.find((item) => String(item.id) === String(orderId));
  const items = order?.items || [];

  if (!order) {
    return (
      <>
        <div className="pos-top pos-hero-card"><h1>Buyurtma</h1><Link className="pos-btn pos-btn--ghost" to="/waiter">Stollarga qaytish</Link></div>
        <div className="pos-card">Buyurtma yuklanmoqda yoki topilmadi.</div>
      </>
    );
  }

  return (
    <>
      <div className="pos-top pos-hero-card pos-order-detail-hero">
        <div>
          <span className="pos-kicker">Band stol #{order.table_number}</span>
          <h1>Buyurtma #{order.order_number}</h1>
          <p>Qabul qilingan: {formatOrderTime(order.created_at)}</p>
        </div>
        <div className="pos-top__actions">
          <Link className="pos-btn pos-btn--ghost" to="/waiter">Stollarga qaytish</Link>
          <Link className="pos-btn" to={`/waiter/new?table=${order.table_number}`}>+ Qo'shimcha buyurtma</Link>
        </div>
      </div>
      <section className="pos-active-order pos-active-order--page">
        <div className="pos-active-order__meta">
          <div><span>Status</span><strong>{orderStatusLabels[order.status] || order.status}</strong></div>
          <div><span>Mahsulotlar</span><strong>{items.length} nom</strong></div>
          <div><span>Jami</span><strong>{formatMoney(order.total_amount)}</strong></div>
        </div>
        <div className="pos-active-order__items">
          {items.length ? items.map((item) => (
            <div className="pos-active-order__item" key={item.id}>
              <div><strong>{item.name}</strong><span>{formatMoney(item.price)} x {Number(item.quantity)}</span></div>
              <b>{formatMoney(item.total)}</b>
            </div>
          )) : <div className="pos-cart-empty">Mahsulotlar yo'q.</div>}
        </div>
        {order.note ? <p className="pos-active-order__note">Izoh: {order.note}</p> : null}
      </section>
    </>
  );
}

export default function WaiterPage({ mode = "tables" }) {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [branch, setBranch] = useState(null);
  const [error, setError] = useState("");

  async function loadData() {
    const activeBranch = await ensureBranch();
    const [ordersRes, productsRes, categoriesRes] = await Promise.all([
      api.get("/pos/orders"),
      api.get("/inventory/products"),
      api.get("/inventory/categories"),
    ]);
    const toArray = (d) => (Array.isArray(d) ? d : d.items || []);
    setBranch(activeBranch);
    setOrders(toArray(ordersRes.data));
    setProducts(toArray(productsRes.data).filter((product) => product.is_active !== false && product.is_available !== false));
    setCategories(toArray(categoriesRes.data).filter((category) => category.is_active !== false));
  }

  useEffect(() => {
    loadData().catch((err) => setError(err.response?.data?.detail || "POS ma'lumotlarini yuklab bo'lmadi."));
  }, []);

  return (
    <WaiterShell>
      {error ? <div className="pos-msg">{error}</div> : null}
      {mode === "new" ? <NewOrderView branch={branch} categories={categories} products={products} onCreated={loadData} /> : mode === "orders" ? <OrdersView orders={orders} /> : mode === "order" ? <OrderDetailView orders={orders} /> : <TablesView orders={orders} />}
    </WaiterShell>
  );
}

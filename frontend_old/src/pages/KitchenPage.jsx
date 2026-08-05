import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/marjon-logo.svg";
import { api, logout } from "../api/client";
import { getKitchenTemplate, printKitchenReceipt } from "../api/receipt";
import { getWsConnection } from "../api/ws";

async function ensureBranch() {
  const { data } = await api.get("/companies/me/branches");
  if (data.length) return data[0];
  const created = await api.post("/companies/me/branches", { name: "MARJON Main", address: "Tashkent", city: "Tashkent" });
  return created.data;
}

function parseBackendDate(dateValue) {
  if (!dateValue) return new Date();
  const value = String(dateValue);
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(value);
  return new Date(hasTimezone ? value : `${value}Z`);
}

function minutesSince(dateValue) {
  const diff = Date.now() - parseBackendDate(dateValue).getTime();
  return Math.max(0, Math.floor(diff / 60000));
}

function formatElapsed(dateValue, now) {
  const diff = Math.max(0, now - parseBackendDate(dateValue).getTime());
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatOrderTime(dateValue) {
  return parseBackendDate(dateValue).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function KitchenOrderCard({ order, onRefresh, now, onPrint }) {
  const waiting = minutesSince(order.created_at);
  const tone = waiting > 20 ? "urgent" : waiting > 10 ? "waiting" : "";
  const [printing, setPrinting] = useState(false);
  const [printMessage, setPrintMessage] = useState("");
  const printTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(printTimerRef.current), []);

  async function setItemStatus(item, status) {
    await api.patch("/kitchen/orders/items/status", { order_item_id: item.id, status });
    onRefresh();
  }

  async function setOrderStatus(status) {
    await api.patch(`/pos/orders/${order.id}/status`, { status });
    onRefresh();
  }

  async function handlePrint() {
    setPrinting(true);
    setPrintMessage("");
    const result = await onPrint(order.id);
    setPrinting(false);
    setPrintMessage(result.ok ? "Chop etildi" : result.detail);
    clearTimeout(printTimerRef.current);
    printTimerRef.current = window.setTimeout(() => setPrintMessage(""), 2500);
  }

  const allReady = order.items?.length && order.items.every((item) => item.status === "ready");

  return (
    <article className={`order-card ${tone}`}>
      <div className="order-card__head">
        <div>
          <div className="kitchen-card-kicker">Yangi buyurtma</div>
          <h2>#{order.order_number}</h2>
          <div className="muted">Stol #{order.table_number || "-"} · {formatOrderTime(order.created_at)}</div>
          {tone ? <span className={`badge ${tone}`}>{tone === "urgent" ? "TEZ!" : "Kutilmoqda"}</span> : <span className="badge fresh">Yangi</span>}
        </div>
        <div className="kitchen-timer-block">
          <span>Vaqt</span>
          <strong>{formatElapsed(order.created_at, now)}</strong>
        </div>
      </div>
      <div className="dish-list">
        {order.items?.map((item) => (
          <div className={`dish-row ${item.status === "ready" ? "ready" : ""}`} key={item.id}>
            <div>
              <strong>{Number(item.quantity)} x {item.name}</strong>
              {item.note ? <div className="muted">{item.note}</div> : null}
            </div>
            <button className="ready-btn" type="button" disabled={item.status === "ready"} onClick={() => setItemStatus(item, "ready")}>
              {item.status === "ready" ? "Tayyor" : "Tayyor"}
            </button>
          </div>
        ))}
      </div>
      {printMessage ? <div className="receipt-print-status">{printMessage}</div> : null}
      <button className="ready-btn" type="button" disabled={printing} onClick={handlePrint}>{printing ? "Chop..." : "Печать"}</button>
      <button className="order-ready-btn" type="button" disabled={!allReady} onClick={() => setOrderStatus("ready")}>{allReady ? "BUYURTMA TAYYOR" : "BARCHASI TAYYOR EMAS"}</button>
    </article>
  );
}

export default function KitchenPage() {
  const navigate = useNavigate();
  const [branch, setBranch] = useState(null);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  const [lastCount, setLastCount] = useState(0);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(Date.now());
  const [kitchenTemplate, setKitchenTemplate] = useState(null);
  const seenOrderIdsRef = useRef(new Set());
  const autoPrintedIdsRef = useRef(new Set());
  const initialOrdersSeenRef = useRef(false);
  const toastTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  async function loadKitchen() {
    const activeBranch = branch || await ensureBranch();
    if (!branch) setBranch(activeBranch);
    const { data } = await api.get("/kitchen/orders", { params: { branch_id: activeBranch.id } });
    setOrders((prev) => {
      if (prev.length && data.length > prev.length) {
        setToast("Yangi buyurtma oshxonaga keldi");
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setToast(""), 3000);
      }
      return data;
    });
    setLastCount(data.length);
  }

  useEffect(() => {
    loadKitchen().catch((err) => setError(err.response?.data?.detail || "Oshxona ma'lumotlarini yuklab bo'lmadi."));

    const ws = getWsConnection("/ws/kitchen");
    let fallbackTimer = null;

    const refresh = () => loadKitchen().catch(() => {});
    ws.on("new_order", refresh);
    ws.on("order_updated", refresh);
    ws.on("order_cancelled", refresh);
    ws.on("item_status_changed", refresh);

    ws.onOpen(() => {
      if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
    });

    ws.onClose(() => {
      if (!fallbackTimer) {
        fallbackTimer = window.setInterval(refresh, 5000);
      }
    });

    ws.connect();
    fallbackTimer = window.setInterval(refresh, 5000);

    return () => {
      ws.disconnect();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, [branch?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    getKitchenTemplate().then(({ template }) => setKitchenTemplate(template)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!orders.length) return;
    const currentIds = new Set(orders.map((order) => String(order.id)));
    if (!initialOrdersSeenRef.current) {
      seenOrderIdsRef.current = currentIds;
      initialOrdersSeenRef.current = true;
      return;
    }

    const newOrders = orders.filter((order) => !seenOrderIdsRef.current.has(String(order.id)));
    seenOrderIdsRef.current = currentIds;
    if (!kitchenTemplate?.autoPrint) return;

    newOrders.forEach((order) => {
      const id = String(order.id);
      if (autoPrintedIdsRef.current.has(id)) return;
      autoPrintedIdsRef.current.add(id);
      printKitchenReceipt(order.id).then((result) => {
        if (result.ok) {
          setToast(`Чек кухни #${order.order_number} отправлен`);
          clearTimeout(toastTimerRef.current);
          toastTimerRef.current = window.setTimeout(() => setToast(""), 3000);
        }
      });
    });
  }, [orders, kitchenTemplate?.autoPrint]);

  const summary = useMemo(() => ({
    total: orders.length,
    items: orders.reduce((sum, order) => sum + (order.items?.length || 0), 0),
  }), [orders]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="kitchen-body-react">
      <header className="kitchen-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={logo} alt="MARJON" className="kitchen-brand-logo" />
          <div>
            <h1 style={{ margin: 0 }}>Oshxona</h1>
            <div className="muted">MARJON · {summary.total} buyurtma · {summary.items} taom</div>
          </div>
        </div>
        <div className="controls">
          <button className="fullscreen-btn" type="button" onClick={() => document.documentElement.requestFullscreen?.()}>To'liq ekran</button>
          <button className="logout-btn" type="button" onClick={handleLogout}>Chiqish</button>
        </div>
      </header>
      {error ? <div className="empty">{error}</div> : null}
      <main className="kitchen-board">
        {orders.map((order) => (
          <KitchenOrderCard key={order.id} order={order} onRefresh={loadKitchen} now={now} onPrint={printKitchenReceipt} />
        ))}
        {!orders.length ? <div className="empty">Aktiv buyurtmalar yo'q.</div> : null}
      </main>
      {toast ? <div className="toast show">{toast}</div> : null}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { webTime } from "../../utils/webTime";
import Icon from "../Icon";
import { InlineLoader } from "../Loader";
import { reportsService } from "../../api/reports";
import { warehouseService } from "../../api/warehouse";
import { formatMoney } from "../../api/client";
import { todayInputValue } from "../../utils/date";
import { isAbortError, useLatestRequest } from "../../hooks/useAsyncSafety";
import { isCancellationAcknowledged, useCancellationAcknowledgements } from "../../hooks/useCancellationAcknowledgements";
import { t } from "../../i18n/t";

// OWNER notification center. Whole-order cancellations come from today's
// GET /reports/orders with an explicit order_status=cancelled filter (the
// report excludes cancelled by default); dish-level cancellations come from
// today's GET /reports/cancelled (item scope only — whole-order items arrive
// as order cards, no doubles); low-stock alerts come from live
// GET /inventory/stock?low_stock=true (no unread state is inferred).
const LOW_STOCK_POLL_MS = 60000;
function apiList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return webTime(value);
}

function formatEventCount(count) {
  const lastTwo = count % 100;
  const lastDigit = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} событий`;
  if (lastDigit === 1) return `${count} событие`;
  if (lastDigit >= 2 && lastDigit <= 4) return `${count} события`;
  return `${count} событий`;
}

export default function TopbarNotifications() {
  const ref = useRef(null);
  const navigate = useNavigate();
  const { receipts } = useCancellationAcknowledgements();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Отмены блюд (item scope): позиции, отменённые в живых заказах.
  const [cancelledDishes, setCancelledDishes] = useState([]);
  // Дефицит сырья: stock-строки ниже порога + имена из справочника.
  const [lowRows, setLowRows] = useState([]);
  const [lowNames, setLowNames] = useState(new Map());
  const [lowLoaded, setLowLoaded] = useState(false);
  const [lowLoading, setLowLoading] = useState(false);
  const beginRequest = useLatestRequest();
  const beginLowRequest = useLatestRequest();
  const beginDishesRequest = useLatestRequest();
  const [today] = useState(() => todayInputValue());

  const cancelled = useMemo(
    () => orders
      .filter((order) => String(order.status || "").toLowerCase() === "cancelled")
      .filter((order) => {
        const id = order.order_id || order.id;
        const stamps = cancelledDishes.filter(row => String(row.order_id) === String(id))
          .map(row => row.report_event_at || row.cancelled_at).filter(Boolean);
        const latest = stamps.sort((a, b) => new Date(b) - new Date(a))[0] || order.created_at;
        return !isCancellationAcknowledged(receipts, id, latest);
      })
      .map((order) => ({
        id: order.order_id || order.id || order.order_number,
        orderId: order.order_id || order.id || null,
        number: order.order_number ?? order.order_id ?? "",
        table: order.table_number,
        time: formatTime(order.created_at),
        amount: order.total_amount,
      })),
    [orders, receipts, cancelledDishes],
  );
  const itemCancels = useMemo(
    () => cancelledDishes
      .filter((row) => String(row?.cancellation_scope || "item").toLowerCase() === "item")
      .filter(row => !isCancellationAcknowledged(receipts, row.order_id, row.report_event_at || row.cancelled_at))
      .map((row) => ({
        id: row.order_item_id || `${row.order_id || "order"}:${row.name || "dish"}`,
        name: row.name || "Блюдо",
        quantity: Number(row.quantity) || 0,
        unit: row.unit || "шт",
        table: row.table_number,
        time: formatTime(row.report_event_at || row.cancelled_at),
        author: row.cancelled_by_name,
      })),
    [cancelledDishes, receipts],
  );
  const lowStock = useMemo(() => {
    const nameOf = (row) => lowNames.get(String(row?.ingredient_id)) || null;
    // V47: порог из карточки продукта (deficit_threshold) действует, когда
    // у складской строки свой порог не задан (min_quantity = 0).
    const minOf = (row) => {
      const rowMin = Number(row?.min_quantity) || 0;
      if (rowMin > 0) return rowMin;
      const cardThreshold = Number(nameOf(row)?.deficit_threshold);
      return Number.isFinite(cardThreshold) ? cardThreshold : 0;
    };
    return lowRows
      .filter((row) => Number(row?.quantity) < minOf(row))
      .map((row) => ({
        id: `${row?.warehouse_id || "wh"}:${row?.ingredient_id}`,
        ingredientId: row?.ingredient_id,
        // Склад строки остатка: дефицит всегда привязан к конкретному
        // складу (строка = пара склад+сырьё), поэтому клик ведёт именно
        // в остатки этого склада, а не в общий справочник сырья.
        warehouseId: row?.warehouse_id || "",
        name: nameOf(row)?.name || "Сырьё",
        unit: nameOf(row)?.unit || row?.unit || "кг",
        quantity: Number(row?.quantity) || 0,
        min: minOf(row),
      }));
  }, [lowRows, lowNames]);
  const count = cancelled.length + itemCancels.length + lowStock.length;

  function load() {
    loadOrders();
    loadCancelledDishes();
    loadLowStock();
  }

  // Отмены целых заказов live: явный фильтр (без него отчёт отмены
  // не отдаёт вовсе). Бейдж обновляется сам, без открытия.
  function loadOrders() {
    const request = beginRequest();
    setLoading(true);
    setError("");
    // Явный фильтр: без него отчёт отмены не отдаёт вовсе.
    reportsService.listOrders(today, today, { filters: { orderStatus: ["cancelled"] }, signal: request.signal })
      .then(({ data }) => {
        if (request.isCurrent()) {
          setOrders(apiList(data));
          setLoaded(true);
        }
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setError("Не удалось загрузить уведомления");
      })
      .finally(() => {
        if (request.isCurrent()) setLoading(false);
      });
  }

  // Отмены блюд live: бейдж обновляется сам (mount + минута), без открытия.
  function loadCancelledDishes() {
    const request = beginDishesRequest();
    reportsService.listCancelledDishes(today, today, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        setCancelledDishes(apiList(data));
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        // Честно прячем секцию отмен блюд, заказы и дефицит не трогаем.
        setCancelledDishes([]);
      });
  }

  // Дефицит live: бейдж обновляется сам (mount + минута), без открытия.
  function loadLowStock() {
    const request = beginLowRequest();
    setLowLoading(true);
    Promise.all([
      warehouseService.listStock({ params: { low_stock: true }, signal: request.signal }),
      warehouseService.listIngredients({ signal: request.signal }).catch(() => ({ data: [] })),
    ])
      .then(([stockRes, ingRes]) => {
        if (!request.isCurrent()) return;
        const items = stockRes?.data;
        setLowRows(Array.isArray(items) ? items : items?.items || []);
        const ings = ingRes?.data;
        const list = Array.isArray(ings) ? ings : ings?.items || [];
        const map = new Map();
        list.forEach((item) => {
          if (item?.id) map.set(String(item.id), {
            name: item.name,
            unit: item.unit,
            deficit_threshold: item.deficit_threshold,
          });
        });
        setLowNames(map);
        setLowLoaded(true);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        // Честно прячем секцию дефицита, заказы не трогаем.
        setLowRows([]);
        setLowLoaded(true);
      })
      .finally(() => {
        if (request.isCurrent()) setLowLoading(false);
      });
  }

  useEffect(() => {
    loadOrders();
    loadLowStock();
    loadCancelledDishes();
    const timer = setInterval(() => {
      loadOrders();
      loadLowStock();
      loadCancelledDishes();
    }, LOW_STOCK_POLL_MS);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle() {
    setOpen((current) => {
      const next = !current;
      if (next && !loaded && !loading) load();
      return next;
    });
  }

  useEffect(() => {
    function onDocDown(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const label = count ? `${t("topbar.notifications")}: ${count}` : t("topbar.notifications_none");

  return (
    <div className="topbar-notification-wrap" ref={ref}>
      <button
        className={`topbar-icon topbar-notification ${open ? "is-open" : ""}`}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="bi-bell" size={18} />
        {count ? (
          <span className="topbar-notification__badge" aria-hidden="true">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
      <div
        className={`stock-alert-popover owner-notif ${open ? "is-open" : ""}`}
        role="dialog"
        aria-label={t("components.topbar.topbarnotifications.uvedomleniya")}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="stock-alert-popover__head">
          <div>
            <span>{t("components.topbar.topbarnotifications.uvedomleniya")}</span>
            <strong>{count ? formatEventCount(count) : t("topbar.events_none")}</strong>
          </div>
          <button className={loading ? "is-loading" : ""} type="button" onClick={load} disabled={loading} aria-label={t("components.topbar.topbarnotifications.obnovit")}>
            <Icon name="bi-arrow-clockwise" size={16} />
          </button>
        </div>
        <div className="stock-alert-popover__body">
          {loading ? <div className="stock-alert-popover__empty"><InlineLoader text="Загрузка..." /></div> : null}
          {!loading && error ? (
            <div className="owner-notif__error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={load}>{t("components.topbar.topbarnotifications.povtorit")}</button>
            </div>
          ) : null}
          {!loading && !error ? cancelled.map((item) => (
            <button type="button" className="stock-alert-item owner-notif__item owner-notif__item--cancel" key={item.id}
              onClick={() => {
                setOpen(false);
                const query = new URLSearchParams({ eventDate: today });
                if (item.orderId) query.set("cancelledOrder", `order:${item.orderId}`);
                navigate(`/reports/cancelled-dishes?${query}`);
              }}
              aria-label={`Заказ №${item.number} отменён`}>
              <div className="stock-alert-item__icon owner-notif__icon--cancel" aria-hidden="true">
                <Icon name="bi-x-octagon" size={18} />
              </div>
              <div>
                <strong>{t("components.topbar.topbarnotifications.zakaz")}{item.number} {t("components.topbar.topbarnotifications.otmenen")}</strong>
                <span>
                  {[item.table ? `Стол ${item.table}` : null, item.time || null]
                    .filter(Boolean).join(" · ")}
                  {item.amount != null ? ` · ${formatMoney(item.amount)}` : ""}
                </span>
              </div>
            </button>
          )) : null}
          {!loading && !error ? itemCancels.map((item) => (
            <button
              type="button"
              className="stock-alert-item owner-notif__item owner-notif__item--cancel"
              key={item.id}
              onClick={() => {
                setOpen(false);
                navigate("/reports/cancelled-dishes");
              }}
              aria-label={`${item.name}: отмена блюда`}
            >
              <div className="stock-alert-item__icon owner-notif__icon--cancel" aria-hidden="true">
                <Icon name="bi-x-octagon" size={18} />
              </div>
              <div>
                <strong>{item.name} ×{item.quantity} {t("components.topbar.topbarnotifications.otmena")}</strong>
                <span>
                  {[item.table ? `Стол ${item.table}` : null, item.time || null, item.author || null]
                    .filter(Boolean).join(" · ")}
                </span>
              </div>
            </button>
          )) : null}
          {lowLoaded && !lowLoading && !error ? lowStock.map((item) => (
            <button
              type="button"
              className="stock-alert-item owner-notif__item owner-notif__item--low"
              key={item.id}
              onClick={() => {
                setOpen(false);
                // Ведём в Остатки того склада, где лежит дефицитная строка,
                // и просим раскрыть только категорию этого сырья
                // (?ingredient=<id>). Без склада в строке — честный откат
                // в справочник сырья, а не битая ссылка.
                if (item.warehouseId) {
                  const query = item.ingredientId
                    ? `?ingredient=${encodeURIComponent(String(item.ingredientId))}`
                    : "";
                  navigate(`/stock-report/stock/${encodeURIComponent(String(item.warehouseId))}${query}`);
                  return;
                }
                navigate("/nomenclature/raw-materials");
              }}
              aria-label={`${item.name}: остаток ниже порога`}
            >
              <div className="stock-alert-item__icon owner-notif__icon--low" aria-hidden="true">
                <Icon name="bi-exclamation-triangle" size={18} />
              </div>
              <div>
                <strong>{item.name}{t("components.topbar.topbarnotifications.defitsit")}</strong>
                <span>{t("components.topbar.topbarnotifications.ostatok")} {item.quantity} {item.unit} {t("components.topbar.topbarnotifications.iz_min")} {item.min}</span>
              </div>
            </button>
          )) : null}
          {!loading && !error && !count ? (
            <div className="owner-notif__empty">
              <span className="owner-notif__empty-icon" aria-hidden="true">
                <Icon name="bi-bell" size={19} />
              </span>
              <p className="owner-notif__empty-text">{t("components.topbar.topbarnotifications.zdes_poyavyatsya_vazhnye_sobytiya_po_zakazam")}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

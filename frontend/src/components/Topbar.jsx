import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { clampToToday, todayInputValue } from "../utils/date";
import DatePicker from "./DatePicker";
import GlobalSearch from "./GlobalSearch";

export default function Topbar({ title = "Dashboard", subtitle, selectedDate, onSelectedDateChange }) {
  const notificationsRef = useRef(null);
  const [today] = useState(() => todayInputValue());
  const [stockOpen, setStockOpen] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState("");
  const [lowStock, setLowStock] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const ingredientById = useMemo(() => new Map(ingredients.map((item) => [item.id, item])), [ingredients]);
  const visibleLowStock = useMemo(
    () => lowStock.filter((item) => Number(item.quantity || 0) <= Number(item.min_quantity || 0)).slice(0, 8),
    [lowStock],
  );
  const stockNotifications = useMemo(() => {
    if (visibleLowStock.length) {
      return visibleLowStock.map((item) => {
        const ingredient = ingredientById.get(item.ingredient_id);
        const quantity = Number(item.quantity || 0);
        const minQuantity = Number(item.min_quantity || 0);
        return {
          id: item.id,
          title: ingredient?.name || `${"\u0418\u043d\u0433\u0440\u0435\u0434\u0438\u0435\u043d\u0442"} ${String(item.ingredient_id).slice(0, 8)}`,
          text: `${quantity.toLocaleString("ru-RU")} ${item.unit} / min ${minQuantity.toLocaleString("ru-RU")} ${item.unit}`,
        };
      });
    }

    return [{
      id: "demo-chicken-low-stock",
      title: "\u041a\u0443\u0440\u0438\u043d\u043e\u0435 \u0444\u0438\u043b\u0435",
      text: "\u0417\u0430\u043a\u0430\u043d\u0447\u0438\u0432\u0430\u0435\u0442\u0441\u044f - \u043e\u0441\u0442\u0430\u043b\u043e\u0441\u044c 2 \u043a\u0433",
    }];
  }, [ingredientById, visibleLowStock]);
  const notificationCount = stockError ? 0 : stockNotifications.length;
  const notificationLabel = notificationCount
    ? `\u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f: ${notificationCount}`
    : "\u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0439 \u043d\u0435\u0442";

  function toggleSidebar() {
    document.getElementById("dashboardSidebar")?.classList.toggle("is-open");
  }

  function loadLowStock() {
    setStockLoading(true);
    setStockError("");
    api.get("/inventory/stock", { params: { low_stock: true } })
      .then((stockRes) => {
        setLowStock(stockRes.data);
        return api.get("/inventory/ingredients")
          .then((ingredientsRes) => setIngredients(ingredientsRes.data))
          .catch(() => setIngredients([]));
      })
      .catch((err) => {
        setLowStock([]);
        setStockError(err.response?.data?.detail || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043e\u0441\u0442\u0430\u0442\u043a\u0438.");
      })
      .finally(() => setStockLoading(false));
  }

  function toggleStockNotifications() {
    setStockOpen((current) => {
      const next = !current;
      if (next && !lowStock.length && !stockLoading) {
        loadLowStock();
      }
      return next;
    });
  }

  useEffect(() => {
    function handleClickOutside(event) {
      if (!notificationsRef.current?.contains(event.target)) {
        setStockOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    loadLowStock();
  }, []);

  return (
    <header className="dashboard-topbar">
      <button className="sidebar-toggle" type="button" data-sidebar-toggle aria-label={"\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043c\u0435\u043d\u044e"} onClick={toggleSidebar}>{"\u2630"}</button>
      <div className="topbar-heading">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="topbar-actions">
        <DatePicker
          value={selectedDate}
          max={today}
          onChange={(value) => onSelectedDateChange(clampToToday(value))}
        />
        <GlobalSearch />
        <div className="topbar-notification-wrap" ref={notificationsRef}>
          <button
            className={`topbar-icon topbar-notification ${stockOpen ? "is-open" : ""}`}
            type="button"
            aria-label={notificationLabel}
            aria-haspopup="dialog"
            aria-expanded={stockOpen}
            onClick={toggleStockNotifications}
          >
            <i className="bi bi-bell" />
            {notificationCount ? (
              <span className="topbar-notification__badge" aria-hidden="true">
                {notificationCount > 99 ? "99+" : notificationCount}
              </span>
            ) : null}
          </button>
          {stockOpen ? (
            <div className="stock-alert-popover" role="dialog" aria-label={"\u0421\u043a\u043b\u0430\u0434\u0441\u043a\u0438\u0435 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f"}>
              <div className="stock-alert-popover__head">
                <div>
                  <span>{"\u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f"}</span>
                  <strong>{notificationCount ? `${notificationCount} ${notificationCount === 1 ? "\u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435" : "\u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439"}` : "\u041d\u0435\u0442 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439"}</strong>
                </div>
                <button className={stockLoading ? "is-loading" : ""} type="button" onClick={loadLowStock} disabled={stockLoading} aria-label={"\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c"}>
                  <i className="bi bi-arrow-clockwise" aria-hidden="true" />
                </button>
              </div>
              <div className="stock-alert-popover__body">
                {stockLoading ? <p className="stock-alert-popover__empty">{"\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430..."}</p> : null}
                {stockError ? <p className="stock-alert-popover__error">{stockError}</p> : null}
                {!stockLoading && !stockError ? stockNotifications.map((item) => {
                  return (
                    <div className="stock-alert-item" key={item.id}>
                      <div className="stock-alert-item__icon"><i className="bi bi-exclamation-triangle" /></div>
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.text}</span>
                      </div>
                    </div>
                  );
                }) : null}
                {!stockLoading && !stockError && !stockNotifications.length ? (
                  <p className="stock-alert-popover__empty">{"\u041d\u043e\u0432\u044b\u0445 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439 \u043d\u0435\u0442"}</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}


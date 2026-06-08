import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, logout } from "../api/client";
import { clampToToday, formatDateLabel, shiftDate, todayInputValue } from "../utils/date";

export default function Topbar({ title = "Dashboard", subtitle, selectedDate, onSelectedDateChange }) {
  const navigate = useNavigate();
  const dateInputRef = useRef(null);
  const notificationsRef = useRef(null);
  const [today] = useState(() => todayInputValue());
  const [stockOpen, setStockOpen] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState("");
  const [lowStock, setLowStock] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const isToday = selectedDate >= today;
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

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function toggleSidebar() {
    document.getElementById("dashboardSidebar")?.classList.toggle("is-open");
  }

  function openDatePicker() {
    const input = dateInputRef.current;
    if (!input) return;

    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }

    input.focus();
    input.click();
  }

  function handleDateKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDatePicker();
    }
  }

  function handleDateStep(event, days) {
    event.stopPropagation();
    onSelectedDateChange(clampToToday(shiftDate(selectedDate, days)));
  }

  function handleDateChange(event) {
    if (!event.target.value) return;
    onSelectedDateChange(clampToToday(event.target.value));
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
        <div
          className="period-chip period-chip--date"
          role="button"
          tabIndex={0}
          onClick={openDatePicker}
          onKeyDown={handleDateKeyDown}
        >
          <i className="bi bi-calendar3" />
          <span>{formatDateLabel(selectedDate)}</span>
          <div className="period-chip__arrows" aria-label={"\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u0434\u0430\u0442\u0443"}>
            <button type="button" aria-label={"\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0434\u0435\u043d\u044c"} disabled={isToday} onClick={(event) => handleDateStep(event, 1)}>
              <i className="bi bi-chevron-up" />
            </button>
            <button type="button" aria-label={"\u041f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u0439 \u0434\u0435\u043d\u044c"} onClick={(event) => handleDateStep(event, -1)}>
              <i className="bi bi-chevron-down" />
            </button>
          </div>
          <input
            ref={dateInputRef}
            aria-label={"\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0434\u0430\u0442\u0443"}
            className="period-chip__input"
            type="date"
            max={today}
            value={selectedDate}
            onChange={handleDateChange}
          />
        </div>
        <div className="restaurant-pill">MARJON</div>
        <div className="lang-switch">
          <button className="is-active" type="button" data-lang="ru">RU</button>
          <button type="button" data-lang="uz">UZ</button>
        </div>
        <div className="topbar-notification-wrap" ref={notificationsRef}>
          <button className="topbar-icon topbar-notification" type="button" aria-label={"\u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f"} onClick={toggleStockNotifications}>
            <i className="bi bi-bell" />
          </button>
          {stockOpen ? (
            <div className="stock-alert-popover">
              <div className="stock-alert-popover__head">
                <button type="button" onClick={loadLowStock} disabled={stockLoading} aria-label={"\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c"}>
                  <i className="bi bi-arrow-clockwise" />
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
              </div>
            </div>
          ) : null}
        </div>
        <button className="btn btn-ghost logout-btn" type="button" onClick={handleLogout}>{"\u0412\u044b\u0439\u0442\u0438"} <i className="bi bi-box-arrow-right" /></button>
      </div>
    </header>
  );
}


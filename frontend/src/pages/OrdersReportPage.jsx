import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";

function toApiDate(ddmmyyyy) {
  if (!ddmmyyyy) return undefined;
  const [d, m, y] = ddmmyyyy.split(".");
  return `${y}-${m}-${d}`;
}

const initialFilters = {
  orderType: "all",
  status: "all",
  waiter: "all",
  place: "",
  client: "",
  courier: "",
  minAmount: "",
  maxAmount: "",
};

const orderColumnOptions = [
  { key: "id", label: "ID заказа" },
  { key: "orderNumber", label: "Номер заказа" },
  { key: "date", label: "Дата" },
  { key: "type", label: "Тип" },
  { key: "place", label: "Место" },
  { key: "waiter", label: "Официант" },
  { key: "client", label: "Клиент" },
  { key: "courier", label: "Курьер" },
  { key: "goodsPrice", label: "Цена товаров" },
  { key: "placePrice", label: "Цена места" },
  { key: "discount", label: "Скидка" },
  { key: "deliveryPrice", label: "Цена доставки" },
  { key: "servicePrice", label: "Цена обслуживания" },
  { key: "totalPrice", label: "Цена всего" },
];

const defaultOrderColumnVisibility = orderColumnOptions.reduce((acc, column) => ({
  ...acc,
  [column.key]: true,
}), {});
const orderColumnsStorageKey = "marjon.orders-report.visible-columns";

function getStoredOrderColumnVisibility() {
  if (typeof window === "undefined") {
    return defaultOrderColumnVisibility;
  }

  try {
    const stored = window.localStorage.getItem(orderColumnsStorageKey);
    if (!stored) {
      return defaultOrderColumnVisibility;
    }

    const parsed = JSON.parse(stored);
    const next = { ...defaultOrderColumnVisibility };
    orderColumnOptions.forEach((column) => {
      if (typeof parsed?.[column.key] === "boolean") {
        next[column.key] = parsed[column.key];
      }
    });

    return orderColumnOptions.some((column) => next[column.key] !== false)
      ? next
      : defaultOrderColumnVisibility;
  } catch {
    return defaultOrderColumnVisibility;
  }
}

export default function OrdersReportPage() {
  const tableSettingsRef = useRef(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tableSettingsOpen, setTableSettingsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => getStoredOrderColumnVisibility());
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    const start = `01.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
    const end = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
    return { preset: "", start, end };
  });
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get("/reports/orders", { params: { date_from: toApiDate(dateRange.start), date_to: toApiDate(dateRange.end) } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.orders || [];
        setRows(items.map((item) => {
          const totalValue = Number(item.total_amount || item.total_price || 0);
          const fmt = (v) => v ? `${Number(v).toLocaleString("ru-RU")} UZS` : "0 UZS";
          return {
            id: String(item.order_id || item.id || ""),
            orderNumber: String(item.order_number || item.orderNumber || ""),
            date: item.created_at || item.date || "",
            type: item.order_type || item.type || "На стол",
            place: item.table_number ? `Стол ${item.table_number}` : (item.place || item.table_name || "-"),
            waiter: item.waiter_name || item.waiter || "-",
            client: item.client_name || item.client || "-",
            courier: item.courier_name || item.courier || "не указан",
            goodsPrice: fmt(item.goods_price || item.total_amount),
            goodsValue: Number(item.goods_price || item.total_amount || 0),
            placePrice: fmt(item.place_price),
            discount: fmt(item.discount),
            deliveryPrice: fmt(item.delivery_price),
            servicePrice: fmt(item.service_price),
            serviceValue: Number(item.service_price || 0),
            totalPrice: fmt(item.total_amount || item.total_price),
            totalValue,
            status: item.status_label || item.status || "Завершено",
            dishes: item.dishes || item.order_items?.map((d) => `${d.name} x${d.quantity}`) || [],
          };
        }));
      })
      .catch(() => setRows([]));
  }, [dateRange.start, dateRange.end]);

  useEffect(() => {
    try {
      window.localStorage.setItem(orderColumnsStorageKey, JSON.stringify(visibleColumns));
    } catch {
      // localStorage can be unavailable in restricted browser modes.
    }
  }, [visibleColumns]);

  useEffect(() => {
    if (!tableSettingsOpen) {
      return undefined;
    }

    function closeOnOutsideClick(event) {
      if (!tableSettingsRef.current?.contains(event.target)) {
        setTableSettingsOpen(false);
      }
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setTableSettingsOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [tableSettingsOpen]);

  const orderTypes = useMemo(() => Array.from(new Set(rows.map((row) => row.type).filter(Boolean))), [rows]);
  const waiters = useMemo(() => Array.from(new Set(rows.map((row) => row.waiter).filter((w) => w && w !== "-"))), [rows]);
  const visibleOrderColumns = useMemo(
    () => orderColumnOptions.filter((column) => visibleColumns[column.key] !== false),
    [visibleColumns],
  );

  const filteredRows = useMemo(() => rows.filter((row) => {
    const min = appliedFilters.minAmount ? Number(appliedFilters.minAmount) : null;
    const max = appliedFilters.maxAmount ? Number(appliedFilters.maxAmount) : null;
    return (
      (appliedFilters.orderType === "all" || row.type === appliedFilters.orderType) &&
      (appliedFilters.status === "all" || row.status === appliedFilters.status) &&
      (appliedFilters.waiter === "all" || row.waiter === appliedFilters.waiter) &&
      (!appliedFilters.place || row.place.toLowerCase().includes(appliedFilters.place.toLowerCase())) &&
      (!appliedFilters.client || row.client.toLowerCase().includes(appliedFilters.client.toLowerCase())) &&
      (!appliedFilters.courier || row.courier.toLowerCase().includes(appliedFilters.courier.toLowerCase())) &&
      (min === null || row.totalValue >= min) &&
      (max === null || row.totalValue <= max)
    );
  }), [rows, appliedFilters]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    setAppliedFilters(filters);
  }

  function toggleColumn(key) {
    setVisibleColumns((current) => {
      const isVisible = current[key] !== false;
      const visibleCount = orderColumnOptions.filter((column) => current[column.key] !== false).length;
      if (isVisible && visibleCount <= 1) {
        return current;
      }
      return { ...current, [key]: !isVisible };
    });
  }

  function renderOrderCell(row, key) {
    switch (key) {
      case "id":
        return <strong>{row.id}</strong>;
      case "type":
        return <span className="orders-type-pill">{row.type}</span>;
      case "client":
        return <><Icon name="bi-person" size={15} />{row.client}</>;
      case "courier":
        return <><Icon name="bi-truck" size={15} />{row.courier}</>;
      default:
        return row[key];
    }
  }

  function orderCellClassName(row, key) {
    if (key === "client" || key === "courier") return "report-muted-cell";
    if (["placePrice", "discount", "deliveryPrice", "servicePrice"].includes(key) && row[key] === "0 UZS") return "report-muted-cell";
    if (key === "totalPrice") return "report-total-price";
    return undefined;
  }

  function downloadExcel() {
    const cols = [
      { key: "order_number", label: "Номер заказа" },
      { key: "date", label: "Дата" },
      { key: "type", label: "Тип" },
      { key: "place", label: "Место" },
      { key: "waiter", label: "Официант" },
      { key: "total", label: "Цена всего" },
    ];
    exportToExcel(filteredRows, cols, "orders-report");
  }

  return (
    <section className="orders-report-page">
      <article className="report-page-card">
        <div className="report-page-header">
          <div className="report-title-group">
            <span className="report-accent-bar" aria-hidden="true" />
            <div>
              <h2>Заказы</h2>
            </div>
          </div>
          <div className="report-actions">
            <div className="orders-table-settings" ref={tableSettingsRef}>
            <button className="orders-table-settings-button" type="button" onClick={() => setTableSettingsOpen((value) => !value)} aria-expanded={tableSettingsOpen}>
              <Icon name="bi-gear-wide-connected" size={18} />
              Настроить таблицу
            </button>
              {tableSettingsOpen ? (
                <div className="orders-table-settings-popover">
                  <div className="orders-table-settings-head">
                    <strong>Столбцы таблицы</strong>
                    <button type="button" onClick={() => setVisibleColumns(defaultOrderColumnVisibility)}>Сбросить</button>
                  </div>
                  <div className="orders-table-settings-list">
                    {orderColumnOptions.map((column) => {
                      const checked = visibleColumns[column.key] !== false;
                      const disabled = checked && visibleOrderColumns.length <= 1;
                      return (
                        <label key={column.key}>
                          <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleColumn(column.key)} />
                          <span>{column.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
            <ReportDateRangePicker value={dateRange} onChange={setDateRange} showDropdownIcon />
            <button className="orders-filter-toggle" type="button" onClick={() => setFiltersOpen((value) => !value)}>
              <Icon name="bi-sliders" size={18} />
              Фильтровать
            </button>
            <button className="report-excel-button" type="button" onClick={downloadExcel}>
              <Icon name="bi-file-earmark-excel" size={18} />
              Скачать Excel
            </button>
          </div>
        </div>

        {filtersOpen ? (
          <div className="report-filter-panel">
            <label>
              <span>Тип заказа</span>
              <select value={filters.orderType} onChange={(event) => updateFilter("orderType", event.target.value)}>
                <option value="all">Все типы</option>
                {orderTypes.map((type) => <option value={type} key={type}>{type}</option>)}
              </select>
            </label>
            <label>
              <span>Статус заказа</span>
              <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
                <option value="all">Все статусы</option>
                <option value="Завершено">Завершено</option>
              </select>
            </label>
            <label>
              <span>Официант</span>
              <select value={filters.waiter} onChange={(event) => updateFilter("waiter", event.target.value)}>
                <option value="all">Все официанты</option>
                {waiters.map((waiter) => <option value={waiter} key={waiter}>{waiter}</option>)}
              </select>
            </label>
            <label>
              <span>Место / стол</span>
              <input value={filters.place} onChange={(event) => updateFilter("place", event.target.value)} placeholder="ЗАЛЛ, 6" />
            </label>
            <label>
              <span>Клиент</span>
              <input value={filters.client} onChange={(event) => updateFilter("client", event.target.value)} placeholder="Имя клиента" />
            </label>
            <label>
              <span>Курьер</span>
              <input value={filters.courier} onChange={(event) => updateFilter("courier", event.target.value)} placeholder="Курьер" />
            </label>
            <label>
              <span>Мин. сумма</span>
              <input value={filters.minAmount} onChange={(event) => updateFilter("minAmount", event.target.value)} inputMode="numeric" placeholder="0" />
            </label>
            <label>
              <span>Макс. сумма</span>
              <input value={filters.maxAmount} onChange={(event) => updateFilter("maxAmount", event.target.value)} inputMode="numeric" placeholder="100000" />
            </label>
            <button type="button" onClick={applyFilters}>
              <Icon name="bi-check2" size={18} />
              Применить
            </button>
          </div>
        ) : null}

        <style>
          {orderColumnOptions.map((column, index) => (
            visibleColumns[column.key] === false
              ? `.orders-report-page .report-table thead th:nth-child(${index + 1}), .orders-report-page .report-table tbody tr:not(.report-empty-row) td:nth-child(${index + 1}) { display: none; }`
              : ""
          )).join("\n")}
        </style>

        <div className="report-table-wrapper">
          <table className="report-table">
            <thead>
              <tr>
                <th>ID заказа</th>
                <th>№</th>
                <th>Дата</th>
                <th>Тип</th>
                <th>Место</th>
                <th>Официант</th>
                <th>Клиент</th>
                <th>Курьер</th>
                <th>Цена товаров</th>
                <th>Цена места</th>
                <th>Скидка</th>
                <th>Цена доставки</th>
                <th>Цена обслуживания</th>
                <th>Цена всего</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} onClick={() => setSelectedOrder(row)}>
                  <td><strong>{row.id}</strong></td>
                  <td>{row.orderNumber}</td>
                  <td>{row.date}</td>
                  <td><span className="orders-type-pill">{row.type}</span></td>
                  <td>{row.place}</td>
                  <td>{row.waiter}</td>
                  <td className="report-muted-cell"><Icon name="bi-person" size={15} />{row.client}</td>
                  <td className="report-muted-cell"><Icon name="bi-truck" size={15} />{row.courier}</td>
                  <td>{row.goodsPrice}</td>
                  <td className={row.placePrice === "0 UZS" ? "report-muted-cell" : ""}>{row.placePrice}</td>
                  <td className={row.discount === "0 UZS" ? "report-muted-cell" : ""}>{row.discount}</td>
                  <td className={row.deliveryPrice === "0 UZS" ? "report-muted-cell" : ""}>{row.deliveryPrice}</td>
                  <td className={row.servicePrice === "0 UZS" ? "report-muted-cell" : ""}>{row.servicePrice}</td>
                  <td className="report-total-price">{row.totalPrice}</td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr className="report-empty-row">
                  <td colSpan="14">По выбранным фильтрам заказов не найдено</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      {selectedOrder ? (
        <div className="order-details-drawer" role="dialog" aria-label="Детали заказа">
          <div className="order-details-drawer__backdrop" onClick={() => setSelectedOrder(null)} />
          <aside className="order-details-drawer__panel">
            <div className="order-details-drawer__head">
              <div>
                <span>Заказ</span>
                <h3>{selectedOrder.id}</h3>
              </div>
              <button type="button" onClick={() => setSelectedOrder(null)} aria-label="Закрыть">
                <Icon name="bi-x-lg" size={18} />
              </button>
            </div>
            <div className="order-details-drawer__grid">
              <div><span>Дата</span><strong>{selectedOrder.date}</strong></div>
              <div><span>Тип заказа</span><strong>{selectedOrder.type}</strong></div>
              <div><span>Стол / место</span><strong>{selectedOrder.place}</strong></div>
              <div><span>Официант</span><strong>{selectedOrder.waiter}</strong></div>
            </div>
            <div className="order-details-drawer__dishes">
              <span>Блюда</span>
              {selectedOrder.dishes.map((dish) => <strong key={dish}>{dish}</strong>)}
            </div>
            <div className="order-details-drawer__totals">
              <div><span>Сумма товаров</span><strong>{selectedOrder.goodsPrice}</strong></div>
              <div><span>Обслуживание</span><strong>{selectedOrder.servicePrice}</strong></div>
              <div><span>Итоговая сумма</span><strong>{selectedOrder.totalPrice}</strong></div>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

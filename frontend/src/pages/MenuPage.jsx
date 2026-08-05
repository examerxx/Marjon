import { useEffect, useMemo, useState } from "react";
import { api, formatMoney } from "../api/client";
import Icon from "../components/Icon";

const salesColumnOptions = [
  { key: "index", label: "№", width: 56 },
  { key: "dish", label: "Блюдо / товар", width: 230 },
  { key: "category", label: "Категория", width: 178 },
  { key: "sold", label: "Продано", width: 116 },
  { key: "price", label: "Цена", width: 132 },
  { key: "revenue", label: "Выручка", width: 150 },
  { key: "share", label: "Доля", width: 158 },
];

const defaultSalesColumnVisibility = Object.fromEntries(
  salesColumnOptions.map((column) => [column.key, true]),
);

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function enrichRows(rows) {
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  return rows
    .map((row) => ({
      ...row,
      avgPrice: row.sold ? row.revenue / row.sold : 0,
      share: totalRevenue ? Math.round((row.revenue / totalRevenue) * 100) : 0,
    }))
    .sort((first, second) => second.revenue - first.revenue);
}

function buildDemoSalesRows() {
  return enrichRows([
    { id: "demo-sale-1", dish: "Плов", category: "Горячие блюда", sold: 42, revenue: 1_890_000, orders: 34 },
    { id: "demo-sale-2", dish: "Шашлык", category: "Гриль", sold: 36, revenue: 1_620_000, orders: 29 },
    { id: "demo-sale-3", dish: "Лагман", category: "Горячие блюда", sold: 31, revenue: 1_085_000, orders: 24 },
    { id: "demo-sale-4", dish: "Салат микс", category: "Салаты", sold: 24, revenue: 720_000, orders: 19 },
    { id: "demo-sale-5", dish: "Айран", category: "Напитки", sold: 54, revenue: 540_000, orders: 38 },
  ]);
}

function buildSalesRows(orders, products, categories) {
  const productMap = new Map((products || []).map((product) => [String(product.id), product]));
  const categoryMap = new Map((categories || []).map((category) => [String(category.id), category.name]));
  const completedOrders = (orders || []).filter((order) => order.status === "completed");
  const sourceOrders = completedOrders.length ? completedOrders : (orders || []).filter((order) => order.status !== "cancelled");
  const totals = new Map();

  sourceOrders.forEach((order) => {
    (order.items || []).forEach((item) => {
      if (item.status === "cancelled") return;

      const product = productMap.get(String(item.product_id)) || {};
      const key = String(item.product_id || item.name);
      const quantity = toNumber(item.quantity);
      const total = toNumber(item.total) || toNumber(item.price) * quantity;
      const category = categoryMap.get(String(product.category_id)) || product.category_name || product.category?.name || "Без категории";
      const current = totals.get(key) || {
        id: key,
        dish: item.name || product.name || "Позиция",
        category,
        sold: 0,
        revenue: 0,
        orders: new Set(),
      };

      current.sold += quantity;
      current.revenue += total;
      current.orders.add(order.id);
      totals.set(key, current);
    });
  });

  return enrichRows(Array.from(totals.values()).map((row) => ({ ...row, orders: row.orders.size })));
}

export default function MenuPage() {
  const [rows, setRows] = useState([]);
  const [ordersCount, setOrdersCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(defaultSalesColumnVisibility);

  useEffect(() => {
    let mounted = true;

    async function loadSales() {
      setLoading(true);
      try {
        const [ordersRes, productsRes, categoriesRes] = await Promise.all([
          api.get("/pos/orders").catch(() => ({ data: [] })),
          api.get("/inventory/products").catch(() => ({ data: [] })),
          api.get("/inventory/categories").catch(() => ({ data: [] })),
        ]);
        if (!mounted) return;

        const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
        const products = Array.isArray(productsRes.data) ? productsRes.data : [];
        const categories = Array.isArray(categoriesRes.data) ? categoriesRes.data : [];
        const builtRows = buildSalesRows(orders, products, categories);

        setRows(builtRows.length ? builtRows : buildDemoSalesRows());
        setOrdersCount(orders.length || 38);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadSales();
    return () => {
      mounted = false;
    };
  }, []);

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) => `${row.dish} ${row.category}`.toLowerCase().includes(normalized));
  }, [query, rows]);

  const totals = useMemo(() => {
    const revenue = visibleRows.reduce((sum, row) => sum + row.revenue, 0);
    const sold = visibleRows.reduce((sum, row) => sum + row.sold, 0);
    return {
      revenue,
      sold,
      positions: visibleRows.length,
      avgPrice: sold ? revenue / sold : 0,
    };
  }, [visibleRows]);

  const categoryRows = useMemo(() => {
    const grouped = new Map();
    visibleRows.forEach((row) => {
      const current = grouped.get(row.category) || { category: row.category, sold: 0, revenue: 0 };
      current.sold += row.sold;
      current.revenue += row.revenue;
      grouped.set(row.category, current);
    });
    return Array.from(grouped.values()).sort((first, second) => second.revenue - first.revenue).slice(0, 4);
  }, [visibleRows]);

  const visibleColumnKeys = useMemo(
    () => salesColumnOptions.filter((column) => visibleColumns[column.key] !== false).map((column) => column.key),
    [visibleColumns],
  );

  const visibleColumnCount = visibleColumnKeys.length;
  const tableMinWidth = useMemo(() => {
    const width = salesColumnOptions.reduce((sum, column) => (
      visibleColumns[column.key] !== false ? sum + column.width : sum
    ), 0);
    return Math.max(680, width);
  }, [visibleColumns]);

  const isColumnVisible = (key) => visibleColumns[key] !== false;
  const toggleColumn = (key) => {
    setVisibleColumns((current) => {
      const checked = current[key] !== false;
      if (checked && visibleColumnCount <= 1) return current;
      return { ...current, [key]: !checked };
    });
  };

  const renderSalesCell = (row, index, key) => {
    const className = `sales-col-${key}`;
    switch (key) {
      case "index":
        return <td key={key} className={className}>{index + 1}</td>;
      case "dish":
        return <td key={key} className={className}><strong>{row.dish}</strong></td>;
      case "category":
        return <td key={key} className={className}><span className="sales-category-pill">{row.category}</span></td>;
      case "sold":
        return <td key={key} className={className}>{Number(row.sold).toLocaleString("ru-RU")}</td>;
      case "price":
        return <td key={key} className={className}>{formatMoney(row.avgPrice)}</td>;
      case "revenue":
        return <td key={key} className={className}><strong>{formatMoney(row.revenue)}</strong></td>;
      case "share":
        return (
          <td key={key} className={className}>
            <div className="sales-share">
              <span style={{ width: `${Math.min(row.share, 100)}%` }} />
              <b>{row.share}%</b>
            </div>
          </td>
        );
      default:
        return null;
    }
  };

  return (
    <section className="sales-page">
      <div className="sales-card">
        <header className="sales-header">
          <div className="sales-title-group">
            <span className="sales-accent" />
            <div>
              <h1>Продажа</h1>
              <p>Сколько чего продалось по блюдам и товарам.</p>
            </div>
          </div>
          <div className="sales-actions">
            <span className="sales-date-chip"><Icon name="bi-calendar3" /> Сегодня</span>
            <button type="button"><Icon name="bi-download" /> Экспорт</button>
          </div>
        </header>

        <div className="sales-summary-grid">
          <article><span>Выручка</span><strong>{formatMoney(totals.revenue)}</strong></article>
          <article><span>Продано</span><strong>{Number(totals.sold).toLocaleString("ru-RU")}</strong></article>
          <article><span>Позиций</span><strong>{totals.positions}</strong></article>
          <article><span>Заказов</span><strong>{ordersCount}</strong></article>
        </div>

        <div className="sales-toolbar">
          <label>
            <Icon name="bi-search" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск блюда или категории" />
          </label>
          <div className="sales-toolbar-meta">
            <span>Цена: <b>{formatMoney(totals.avgPrice)}</b></span>
            <div className="sales-table-settings">
              <button
                type="button"
                className="sales-table-settings-btn"
                onClick={() => setSettingsOpen((open) => !open)}
                aria-expanded={settingsOpen}
              >
                <Icon name="bi-sliders" /> Настроить таблицу
              </button>
              {settingsOpen ? (
                <div className="sales-table-settings-popover">
                  <div className="sales-table-settings-head">
                    <strong>Столбцы</strong>
                    <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Закрыть">
                      <Icon name="bi-x-lg" size={14} />
                    </button>
                  </div>
                  <div className="sales-column-toggle-list">
                    {salesColumnOptions.map((column) => {
                      const checked = isColumnVisible(column.key);
                      const disabled = checked && visibleColumnCount <= 1;
                      return (
                        <label className="sales-column-toggle" key={column.key}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleColumn(column.key)}
                          />
                          <span className="sales-column-toggle-box">
                            {checked ? <Icon name="bi-check" size={13} /> : null}
                          </span>
                          <span>{column.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="sales-column-reset"
                    onClick={() => setVisibleColumns(defaultSalesColumnVisibility)}
                  >
                    Показать все
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="sales-layout">
          <div className="sales-table-wrap">
            <table className="sales-table" style={{ "--sales-grid-min-width": `${tableMinWidth}px` }}>
              <thead>
                <tr>
                  {salesColumnOptions
                    .filter((column) => isColumnVisible(column.key))
                    .map((column) => (
                      <th key={column.key} className={`sales-col-${column.key}`}>{column.label}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={visibleColumnCount} className="sales-empty">Загрузка продаж...</td></tr>
                ) : visibleRows.map((row, index) => (
                  <tr key={row.id}>{visibleColumnKeys.map((key) => renderSalesCell(row, index, key))}</tr>
                ))}
                {!loading && !visibleRows.length ? (
                  <tr><td colSpan={visibleColumnCount} className="sales-empty">Продажи не найдены.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <aside className="sales-category-card">
            <h2>Категории</h2>
            {categoryRows.map((row) => (
              <div className="sales-category-row" key={row.category}>
                <div>
                  <strong>{row.category}</strong>
                  <span>{Number(row.sold).toLocaleString("ru-RU")} продано</span>
                </div>
                <b>{formatMoney(row.revenue)}</b>
              </div>
            ))}
          </aside>
        </div>
      </div>
    </section>
  );
}

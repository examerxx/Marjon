import { useEffect, useMemo, useRef, useState } from "react";
import { Chart, Filler, LineController, LineElement, LinearScale, PointElement, CategoryScale, Tooltip } from "chart.js";
import { Link, useOutletContext } from "react-router-dom";
import { api, formatMoney, formatNumber } from "../api/client";
import { dateRangeEndingAt, formatDateLabel, todayInputValue, toDateInputValue } from "../utils/date";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

function dateSeed(value) {
  return value.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function seededFactor(seed, index, min = 0.82, max = 1.18) {
  const wave = Math.sin((seed + 17) * (index + 3)) * 10000;
  const normalized = wave - Math.floor(wave);
  return min + normalized * (max - min);
}

function demoSales(days, endValue) {
  const seed = dateSeed(endValue);
  const values = days === 30
    ? [1180000, 1460000, 1320000, 1750000, 1680000, 2120000, 1980000, 2240000, 2410000, 2190000, 2650000, 2880000, 2740000, 3160000, 3420000, 3290000, 3680000, 3510000, 3940000, 4280000, 4120000, 4570000, 4860000, 4620000, 4980000, 5320000, 5180000, 5740000, 6020000, 6350000]
    : [1850000, 2420000, 2180000, 3360000, 3820000, 3540000, 4680000];
  const endDate = new Date(`${endValue}T00:00:00`);
  return values.slice(-days).map((baseRevenue, index, list) => {
    const date = new Date(endDate);
    date.setDate(endDate.getDate() - list.length + index + 1);
    const revenue = Math.round((baseRevenue * seededFactor(seed, index)) / 10000) * 10000;
    const ordersCount = Math.max(1, Math.round(revenue / (65000 + seededFactor(seed, index + 8, -9000, 11000))));
    return {
      date: toDateInputValue(date),
      orders_count: ordersCount,
      revenue,
      avg_check: Math.round(revenue / ordersCount),
      is_demo: true,
    };
  });
}

function demoTopProductsForDate(selectedDate) {
  const seed = dateSeed(selectedDate);
  const products = [
    { product_id: "demo-lagmon", name: "Лагман", baseQuantity: 42, price: 40000 },
    { product_id: "demo-palov", name: "Плов", baseQuantity: 37, price: 50000 },
    { product_id: "demo-shashlik", name: "Шашлык", baseQuantity: 29, price: 60000 },
    { product_id: "demo-salat", name: "Салат микс", baseQuantity: 24, price: 30000 },
    { product_id: "demo-manti", name: "Манты", baseQuantity: 18, price: 45000 },
  ];

  return products
    .map((item, index) => {
      const quantity = Math.max(3, Math.round(item.baseQuantity * seededFactor(seed, index, 0.62, 1.34)));
      return {
        product_id: item.product_id,
        name: item.name,
        quantity_sold: quantity,
        revenue: quantity * item.price,
        is_demo: true,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

function demoDashboardFromSales(sales, selectedDate) {
  const seed = dateSeed(selectedDate);
  const selectedDay = sales.at(-1) || { revenue: 0, orders_count: 0, avg_check: 0 };
  return {
    today_revenue: selectedDay.revenue,
    today_orders: selectedDay.orders_count,
    avg_check: selectedDay.avg_check,
    active_orders: Math.max(0, Math.round(6 * seededFactor(seed, 11, 0.3, 1.8))),
  };
}

function dishDisplayName(name = "") {
  const normalized = name.toLowerCase().replaceAll("'", "").replaceAll("‘", "").replaceAll("’", "");
  const translations = {
    lagmon: "Лагман",
    lagman: "Лагман",
    palov: "Плов",
    pilaf: "Плов",
    shashlik: "Шашлык",
    "salat mix": "Салат микс",
    "salad mix": "Салат микс",
    manti: "Манты",
  };
  return translations[normalized] || name;
}

function dishPhotoClass(name = "", index = 0) {
  const normalized = name.toLowerCase();
  if (normalized.includes("лаг") || normalized.includes("lag")) return "dish-photo--lagman";
  if (normalized.includes("плов") || normalized.includes("palov") || normalized.includes("pilaf")) return "dish-photo--palov";
  if (normalized.includes("шаш") || normalized.includes("shash")) return "dish-photo--shashlik";
  if (normalized.includes("сал") || normalized.includes("sal")) return "dish-photo--salad";
  if (normalized.includes("мант") || normalized.includes("mant")) return "dish-photo--manti";
  return `dish-photo--${(index % 5) + 1}`;
}

function RevenueChart({ sales }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const ctx = canvasRef.current.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 360);
    gradient.addColorStop(0, "rgba(255, 107, 61, 0.28)");
    gradient.addColorStop(0.55, "rgba(255, 138, 92, 0.10)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

    const chart = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: sales.map((item) => new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(item.date))),
        datasets: [{
          data: sales.map((item) => Number(item.revenue || 0)),
          borderColor: "#FF6B3D",
          backgroundColor: gradient,
          borderWidth: 4,
          pointBackgroundColor: "#FFFFFF",
          pointBorderColor: "#FF6B3D",
          pointBorderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 7,
          fill: true,
          tension: 0.42,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0B1F3A",
            titleColor: "#FFFFFF",
            bodyColor: "#E4E7EC",
            borderColor: "rgba(255,255,255,0.12)",
            borderWidth: 1,
            padding: 14,
            cornerRadius: 14,
            displayColors: false,
            callbacks: { label: (context) => formatMoney(context.parsed.y) },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#667085", font: { size: 12, weight: "600" } }, border: { display: false } },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(16, 24, 40, 0.08)", drawTicks: false },
            ticks: {
              color: "#667085",
              font: { size: 12, weight: "600" },
              callback: (value) => `${Number(value) / 1000000}M`,
            },
            border: { display: false },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [sales]);

  return <canvas ref={canvasRef} id="ownerRevenueChart" />;
}

function EmptyState({ title, text }) {
  return (
    <div className="card dashboard-empty">
      <div>
        <div className="dashboard-empty__mark"><i className="bi bi-shop" /></div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}

function PeriodDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef(null);
  const options = [
    { value: 7, label: "7 дней" },
    { value: 30, label: "30 дней" },
  ];
  const selected = options.find((option) => option.value === value) || options[0];
  const openMenu = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    setOpen(true);
  };
  const closeMenu = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 140);
  };

  return (
    <div
      className={`period-dropdown ${open ? "is-open" : ""}`}
      onMouseEnter={openMenu}
      onMouseLeave={closeMenu}
      onFocus={openMenu}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
      }}
    >
      <button className="period-dropdown__button" type="button" onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open}>
        <span>Период</span>
        <strong>{selected.label}</strong>
        <i className="bi bi-chevron-down" aria-hidden="true" />
      </button>
      {open ? (
        <div className="period-dropdown__menu" role="listbox">
          {options.map((option) => (
            <button
              className={option.value === value ? "is-selected" : ""}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
              {option.value === value ? <i className="bi bi-check2" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ShiftSummaryCard() {
  const roomLoad = 68;

  return (
    <aside className="card card-pad shift-summary-card">
      <div className="shift-summary-card__header">
        <div>
          <span className="eyebrow">Live operations</span>
          <h2>Сводка смены</h2>
          <p>Операционная картина ресторана в реальном времени</p>
        </div>
        <div className="shift-summary-card__status" aria-label="Смена открыта">
          <span />
          Смена открыта
        </div>
      </div>

      <div className="shift-summary-card__open-time">
        <i className="bi bi-clock-history" />
        <span>Время открытия</span>
        <strong>09:00</strong>
      </div>

      <div className="shift-summary-card__stats">
        <div>
          <span>Касса</span>
          <strong>3 540 000 UZS</strong>
        </div>
        <div>
          <span>Заказы</span>
          <strong>128</strong>
        </div>
        <div>
          <span>Зал</span>
          <strong>{roomLoad}%</strong>
        </div>
        <div>
          <span>Среднее время</span>
          <strong>23 мин</strong>
        </div>
      </div>

      <div className="shift-summary-card__load">
        <div>
          <span>Загруженность зала</span>
          <strong>{roomLoad}%</strong>
        </div>
        <div className="shift-summary-card__progress" aria-hidden="true">
          <i style={{ width: `${roomLoad}%` }} />
        </div>
      </div>

      <div className="shift-summary-card__alert">
        <div className="shift-summary-card__alert-icon"><i className="bi bi-exclamation-triangle" /></div>
        <p>Куриное филе заканчивается — осталось 2 кг</p>
        <span>Важно</span>
      </div>

      <div className="shift-summary-card__actions">
        <button className="shift-summary-card__primary" type="button">Управление сменой</button>
        <button className="shift-summary-card__link" type="button">Посмотреть отчёт</button>
      </div>
    </aside>
  );
}

function QuickActionsCard({ productsCount, employeesCount, activeOrders }) {
  return (
    <section className="card card-pad quick-actions quick-actions--command">
      <div className="section-header">
        <div>
          <span className="eyebrow">Command center</span>
          <h2>Быстрые действия</h2>
          <p className="quick-actions__subtitle">Самые частые операции владельца в одном месте</p>
        </div>
        <span className="quick-actions__live"><i className="bi bi-lightning-charge-fill" /> Live</span>
      </div>

      <div className="quick-actions__grid">
        <Link to="/orders"><i className="bi bi-plus-circle" /><span>Новый заказ</span><small>Создать продажу</small></Link>
        <Link to="/menu"><i className="bi bi-journal-plus" /><span>Добавить блюдо</span><small>{productsCount} блюд в меню</small></Link>
        <Link to="/staff"><i className="bi bi-person-plus" /><span>Сотрудник</span><small>{employeesCount} в команде</small></Link>
        <Link to="/finance"><i className="bi bi-file-earmark-spreadsheet" /><span>Финансы</span><small>Отчеты и касса</small></Link>
      </div>

      <div className="quick-actions__insights">
        <div className="quick-actions__metric">
          <span>Активные заказы</span>
          <strong>{formatNumber(activeOrders)}</strong>
          <em>Сейчас в работе</em>
        </div>
        <div className="quick-actions__metric">
          <span>Меню</span>
          <strong>{formatNumber(productsCount)}</strong>
          <em>Доступных позиций</em>
        </div>
        <div className="quick-actions__metric">
          <span>Команда</span>
          <strong>{formatNumber(employeesCount)}</strong>
          <em>Сотрудников</em>
        </div>
      </div>

      <div className="quick-actions__notice">
        <div><i className="bi bi-stars" /></div>
        <p><strong>Совет смены:</strong> проверьте стоп-лист и остатки перед вечерней загрузкой.</p>
        <Link to="/warehouse">Склад</Link>
      </div>
    </section>
  );
}

export default function OwnerDashboard() {
  const { selectedDate = todayInputValue() } = useOutletContext();
  const [period, setPeriod] = useState(7);
  const hasLoadedRef = useRef(false);
  const [dashboard, setDashboard] = useState(null);
  const [sales, setSales] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [products, setProducts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(!hasLoadedRef.current);
    setError("");
    const params = dateRangeEndingAt(period, selectedDate);
    const dayParams = { date_from: selectedDate, date_to: selectedDate };

    Promise.all([
      api.get("/analytics/dashboard", { params: { date: selectedDate } }),
      api.get("/analytics/sales", { params }),
      api.get("/analytics/products/top", { params: { limit: 5, ...dayParams } }),
      api.get("/inventory/products"),
      api.get("/hr/employees"),
    ]).then(([dashboardRes, salesRes, topRes, productsRes, employeesRes]) => {
      if (!mounted) return;
      const toArray = (d) => (Array.isArray(d) ? d : d.items || []);
      setDashboard(dashboardRes.data);
      setSales(toArray(salesRes.data));
      setTopProducts(toArray(topRes.data));
      setProducts(toArray(productsRes.data));
      setEmployees(toArray(employeesRes.data));
      hasLoadedRef.current = true;
    }).catch((err) => {
      if (mounted) setError(err.response?.data?.detail || "Не удалось загрузить dashboard данные.");
    }).finally(() => mounted && setLoading(false));

    return () => { mounted = false; };
  }, [period, selectedDate]);

  const displaySales = useMemo(() => sales.length ? sales : demoSales(period, selectedDate), [period, sales, selectedDate]);
  const displayTopProducts = useMemo(() => topProducts.length ? topProducts : demoTopProductsForDate(selectedDate), [selectedDate, topProducts]);
  const isDemoDashboard = !sales.length || !topProducts.length;
  const displayDashboard = useMemo(
    () => (isDemoDashboard ? demoDashboardFromSales(displaySales, selectedDate) : dashboard),
    [dashboard, displaySales, isDemoDashboard, selectedDate],
  );
  const maxTopQuantity = useMemo(() => Math.max(...displayTopProducts.map((item) => Number(item.quantity_sold || 0)), 1), [displayTopProducts]);

  if (loading) return <div className="loading-note">Загрузка dashboard...</div>;
  if (error) return <EmptyState title="Dashboard недоступен" text={error} />;

  return (
    <>
      <section className="kpi-grid kpi-grid--premium">
        <article className="kpi-card premium-kpi premium-kpi--revenue">
          <div className="premium-kpi__top"><div className="premium-kpi__icon"><i className="bi bi-currency-exchange" /></div><span className="trend trend--up">{formatDateLabel(selectedDate)}</span></div>
          <div className="kpi-label">Выручка за день</div>
          <div className="kpi-value">{formatMoney(displayDashboard?.today_revenue).replace(" UZS", "")} <small>UZS</small></div>
          <div className="kpi-note">Без отмененных заказов</div>
        </article>
        <article className="kpi-card premium-kpi premium-kpi--orders">
          <div className="premium-kpi__top"><div className="premium-kpi__icon"><i className="bi bi-receipt" /></div><span className="trend">Live</span></div>
          <div className="kpi-label">Заказов</div>
          <div className="kpi-value">{formatNumber(displayDashboard?.today_orders)}</div>
          <div className="kpi-note">Все каналы продаж</div>
        </article>
        <article className="kpi-card premium-kpi premium-kpi--avg">
          <div className="premium-kpi__top"><div className="premium-kpi__icon"><i className="bi bi-graph-up-arrow" /></div><span className="trend">Среднее</span></div>
          <div className="kpi-label">Средний чек</div>
          <div className="kpi-value">{formatMoney(displayDashboard?.avg_check).replace(" UZS", "")} <small>UZS</small></div>
          <div className="kpi-note">За выбранный день</div>
        </article>
        <article className="kpi-card premium-kpi premium-kpi--tables">
          <div className="premium-kpi__top"><div className="premium-kpi__icon"><i className="bi bi-grid-3x3-gap" /></div><span className="trend">Зал</span></div>
          <div className="kpi-label">Активных заказов</div>
          <div className="kpi-value">{formatNumber(displayDashboard?.active_orders)}</div>
          <div className="kpi-note">{employees.length} сотрудников · {products.length} блюд</div>
        </article>
      </section>

      <section className="owner-main-grid">
        <div className="card card-pad chart-card premium-chart">
          <div className="section-header section-header--stack">
            <div><span className="eyebrow">Revenue analytics</span><h2>Выручка за {period} дней</h2><p>Период заканчивается {formatDateLabel(selectedDate)}</p></div>
            <div className="period-switcher" aria-label="Период выручки">
              <PeriodDropdown value={period} onChange={setPeriod} />
              <Link className="period-switcher__details" to="/analytics">Подробнее</Link>
            </div>
          </div>
          <div className="chart-wrap"><RevenueChart sales={displaySales} /></div>
          <div className="revenue-insight"><div className="revenue-insight__icon"><i className="bi bi-graph-up-arrow" /></div><p><strong>Стабильная динамика.</strong> {isDemoDashboard ? "Показаны предварительные демо-данные до запуска продаж." : "Отслеживайте выручку за 7 или 30 дней без отмененных заказов."}</p><span className="revenue-insight__badge">{sales.length ? "Live" : "Demo"}</span></div>
        </div>

        <aside className="card card-pad top-dishes-card">
          <div className="section-header"><div><span className="eyebrow">Menu performance</span><h2>Топ-5 блюд за день</h2></div><Link className="btn btn-ghost" to="/menu">Все блюда</Link></div>
          {displayTopProducts.length ? <div className="top-dishes-list">
            {displayTopProducts.map((item, index) => {
              const quantity = Number(item.quantity_sold || 0);
              return <div className="top-dish" key={item.product_id || item.name}>
                <div className="top-dish__rank">{index + 1}</div>
                <div className="top-dish__body"><div className="top-dish__line"><strong>{dishDisplayName(item.name)}</strong></div><div className="top-dish__meta"><span className="badge badge-info">{formatNumber(quantity)} продаж</span><div className="top-dish__bar"><i style={{ width: `${Math.round((quantity / maxTopQuantity) * 100)}%` }} /></div></div></div>
                <div className="top-dish__price">{formatMoney(item.revenue)}</div>
              </div>;
            })}
          </div> : <EmptyState title="Продаж пока нет" text="Создайте первые заказы, и MARJON покажет лидеров меню." />}
        </aside>
      </section>

      <section className="owner-widgets">
        <QuickActionsCard productsCount={products.length} employeesCount={employees.length} activeOrders={displayDashboard?.active_orders} />
        <ShiftSummaryCard />
      </section>
    </>
  );
}

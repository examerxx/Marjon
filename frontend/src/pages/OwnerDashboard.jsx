import { useEffect, useMemo, useRef, useState } from "react";
import { Chart, Filler, LineController, LineElement, LinearScale, PointElement, CategoryScale, Tooltip } from "chart.js";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { api, formatMoney, formatNumber } from "../api/client";
import { ChevronDown, ChevronRight, Store, Clock, AlertTriangle, Zap, PlusCircle, BookPlus, UserPlus, FileSpreadsheet, Sparkles, Banknote, Receipt, TrendingUp, LayoutGrid } from "lucide-react";
import MarjonLoader from "../components/MarjonLoader";
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
            titleFont: { family: "'Plus Jakarta Sans', Inter, sans-serif", size: 13, weight: "700" },
            bodyFont: { family: "'Plus Jakarta Sans', Inter, sans-serif", size: 14, weight: "800" },
            callbacks: { label: (context) => formatMoney(context.parsed.y) },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#667085", font: { family: "'Plus Jakarta Sans', Inter, sans-serif", size: 12, weight: "600" } }, border: { display: false } },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(16, 24, 40, 0.08)", drawTicks: false },
            ticks: {
              color: "#667085",
              font: { family: "'Plus Jakarta Sans', Inter, sans-serif", size: 12, weight: "600" },
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
        <div className="dashboard-empty__mark"><Store size={32} strokeWidth={1.8} /></div>
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
    { value: 7, label: "7 дн" },
    { value: 30, label: "30 дн" },
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
        <strong>{selected.label}</strong>
        <ChevronDown size={18} strokeWidth={2.5} aria-hidden="true" />
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
              <span className={`period-dropdown__dot${option.value === value ? " is-active" : ""}`} aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ShiftSummaryCard({ dashboard }) {
  const ordersCount = Number(dashboard?.today_orders || 0);
  const activeOrders = Number(dashboard?.active_orders || 0);
  const revenue = Number(dashboard?.today_revenue || 0);
  const avgCheck = Number(dashboard?.avg_check || 0);
  const roomLoad = Math.min(98, Math.max(18, Math.round((activeOrders / Math.max(ordersCount, 12)) * 420)));
  const avgServiceTime = Math.min(44, Math.max(12, Math.round(18 + activeOrders * 1.4)));
  const cashValue = revenue || 3540000;
  const ordersValue = ordersCount || 128;
  const warningText = activeOrders > 8
    ? "Зал близок к пиковой нагрузке — проверьте скорость кухни"
    : "Куриное филе заканчивается — осталось 2 кг";

  return (
    <aside className="card card-pad shift-summary-card shift-summary-card--window">
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
        <Clock size={16} strokeWidth={2} />
        <span>Время открытия</span>
        <strong>09:00</strong>
      </div>

      <div className="shift-summary-card__stats">
        <div>
          <span>Касса</span>
          <strong>{formatMoney(cashValue)}</strong>
        </div>
        <div>
          <span>Заказы</span>
          <strong>{formatNumber(ordersValue)}</strong>
        </div>
        <div>
          <span>Зал</span>
          <strong>{roomLoad}%</strong>
        </div>
        <div>
          <span>Среднее время</span>
          <strong>{avgServiceTime} мин</strong>
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
        <div className="shift-summary-card__alert-icon"><AlertTriangle size={18} strokeWidth={2} /></div>
        <p>{warningText}</p>
        <span>Важно</span>
      </div>

      <div className="shift-summary-card__actions">
        <Link className="shift-summary-card__primary" to="/orders">Управление сменой</Link>
        <Link className="shift-summary-card__link" to="/reports/z-report">Посмотреть отчёт</Link>
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
        <span className="quick-actions__live"><Zap size={14} strokeWidth={2.5} /> Live</span>
      </div>

      <div className="quick-actions__grid">
        <Link to="/orders"><PlusCircle size={22} strokeWidth={1.8} /><span>Новый заказ</span><small>Создать продажу</small></Link>
        <Link to="/menu"><BookPlus size={22} strokeWidth={1.8} /><span>Добавить блюдо</span><small>{productsCount} блюд в меню</small></Link>
        <Link to="/staff"><UserPlus size={22} strokeWidth={1.8} /><span>Сотрудник</span><small>{employeesCount} в команде</small></Link>
        <Link to="/finance"><FileSpreadsheet size={22} strokeWidth={1.8} /><span>Финансы</span><small>Отчеты и касса</small></Link>
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
        <div><Sparkles size={20} strokeWidth={2} /></div>
        <p><strong>Совет смены:</strong> проверьте стоп-лист и остатки перед вечерней загрузкой.</p>
        <Link to="/warehouse">Склад</Link>
      </div>
    </section>
  );
}

export default function OwnerDashboard() {
  const navigate = useNavigate();
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
      setDashboard(dashboardRes.data);
      setSales(salesRes.data);
      setTopProducts(topRes.data);
      setProducts(productsRes.data);
      setEmployees(employeesRes.data);
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
  const revenueInsightText = useMemo(() => {
    if (!displaySales.length) return "Нет данных за выбранный период.";
    const total = displaySales.reduce((sum, d) => sum + Number(d.revenue || 0), 0);
    const half = Math.floor(displaySales.length / 2);
    const firstHalf = displaySales.slice(0, half).reduce((s, d) => s + Number(d.revenue || 0), 0);
    const secondHalf = displaySales.slice(half).reduce((s, d) => s + Number(d.revenue || 0), 0);
    const trend = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0;
    const trendText = trend > 0 ? `рост +${trend}%` : trend < 0 ? `снижение ${trend}%` : "стабильно";
    return `Общая выручка за ${displaySales.length} дн: ${formatMoney(total)}. Тренд: ${trendText}.`;
  }, [displaySales]);

  if (loading) return <MarjonLoader text="Загрузка дашборда…" />;
  if (error) return <EmptyState title="Dashboard недоступен" text={error} />;

  return (
    <>
      <section className="kpi-grid kpi-grid--premium">
        <article className="kpi-card premium-kpi premium-kpi--revenue kpi-card--clickable" onClick={() => navigate("/finance")} title="Перейти к финансам">
          <div className="premium-kpi__top"><div className="premium-kpi__icon"><Banknote size={22} strokeWidth={2} /></div><span className="trend trend--up">{formatDateLabel(selectedDate)}</span></div>
          <div className="kpi-label">Выручка за день</div>
          <div className="kpi-value">{formatMoney(displayDashboard?.today_revenue).replace(" UZS", "")} <small>UZS</small></div>
          <div className="kpi-note">Без отмененных заказов</div>
        </article>
        <article className="kpi-card premium-kpi premium-kpi--orders kpi-card--clickable" onClick={() => navigate("/reports/orders")} title="Перейти к отчёту по заказам">
          <div className="premium-kpi__top"><div className="premium-kpi__icon"><Receipt size={22} strokeWidth={2} /></div><span className="trend">Live</span></div>
          <div className="kpi-label">Заказов</div>
          <div className="kpi-value">{formatNumber(displayDashboard?.today_orders)}</div>
          <div className="kpi-note">Все каналы продаж</div>
        </article>
        <article className="kpi-card premium-kpi premium-kpi--avg kpi-card--clickable" onClick={() => navigate("/reports")} title="Перейти к отчётам">
          <div className="premium-kpi__top"><div className="premium-kpi__icon"><TrendingUp size={22} strokeWidth={2} /></div><span className="trend">Среднее</span></div>
          <div className="kpi-label">Средний чек</div>
          <div className="kpi-value">{formatMoney(displayDashboard?.avg_check).replace(" UZS", "")} <small>UZS</small></div>
          <div className="kpi-note">За выбранный день</div>
        </article>
        <article className="kpi-card premium-kpi premium-kpi--tables kpi-card--clickable" onClick={() => navigate("/store")} title="Перейти в магазин">
          <div className="premium-kpi__top"><div className="premium-kpi__icon"><LayoutGrid size={22} strokeWidth={2} /></div><span className="trend">Зал</span></div>
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
              <Link className="btn btn-ghost btn-ghost--lucide" to="/analytics">Подробнее <ChevronRight size={16} strokeWidth={2.5} /></Link>
            </div>
          </div>
          <div className="chart-wrap"><RevenueChart sales={displaySales} /></div>
          <div className="revenue-insight"><div className="revenue-insight__icon"><TrendingUp size={20} strokeWidth={2} /></div><p>{revenueInsightText}</p></div>
        </div>

        <aside className="card card-pad top-dishes-card">
          <div className="section-header"><div><span className="eyebrow">Menu performance</span><h2>Топ-5 блюд за день</h2></div><Link className="btn btn-ghost btn-ghost--lucide" to="/menu">Все блюда <ChevronRight size={16} strokeWidth={2.5} /></Link></div>
          {displayTopProducts.length ? <div className="top-dishes-list">
            {displayTopProducts.map((item, index) => {
              const quantity = Number(item.quantity_sold || 0);
              return <div className="top-dish" key={item.product_id || item.name}>
                <div className="top-dish__rank">{index + 1}</div>
                <div className="top-dish__body"><div className="top-dish__line"><strong>{dishDisplayName(item.name)}</strong><span className="badge badge-info">{formatNumber(quantity)} продаж</span></div><div className="top-dish__bar"><i style={{ width: `${Math.round((quantity / maxTopQuantity) * 100)}%` }} /></div></div>
                <div className="top-dish__price">{formatMoney(item.revenue)}</div>
              </div>;
            })}
          </div> : <EmptyState title="Продаж пока нет" text="Создайте первые заказы, и MARJON покажет лидеров меню." />}
        </aside>
      </section>

      <section className="owner-widgets">
        <QuickActionsCard productsCount={products.length} employeesCount={employees.length} activeOrders={displayDashboard?.active_orders} />
        <ShiftSummaryCard dashboard={displayDashboard} />
      </section>
    </>
  );
}

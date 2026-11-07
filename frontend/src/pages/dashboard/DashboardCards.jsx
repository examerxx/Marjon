import { Link } from "react-router-dom";
import { useCallback, useState } from "react";
import DishPhotoViewer from "../../components/DishPhotoViewer";
import "./topSalesPhotos.css";
import "./recentOrders.css";
import { formatMoney, formatNumber } from "../../api/client";
import Icon from "../../components/Icon";
import OrderStatus from "../reports/OrderStatus";
import CountUpValue from "../../components/CountUpValue";

const formatDishQuantity = value => `${formatNumber(value)} шт`;

// Презентационные секции OWNER-дашборда: пустое состояние, сводка смены,
// быстрые действия, последние заказы, топ продаж. Вынесено из OwnerDashboard.jsx
// (FE-07B). Разметка/классы/тексты сохранены 1:1; данные приходят пропсами.

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

export function EmptyState({ title, text }) {
  return (
    <div className="card dashboard-empty">
      <div>
        <div className="dashboard-empty__mark"><Icon name="bi-shop" size={20} /></div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}

// Intentional empty state for a healthy company with no business activity yet
// (success + empty — NOT loading, NOT error). No fake rows, no fabricated
// figures. Shared across the revenue chart and the lower dashboard sections so
// every empty region reads as the same designed state.
export function SectionEmpty({ icon = "bi-inbox", title, text, className = "" }) {
  return (
    <div className={`owner-empty ${className}`.trim()}>
      <div className="owner-empty__mark"><Icon name={icon} size={22} /></div>
      <p className="owner-empty__title">{title}</p>
      <p className="owner-empty__text">{text}</p>
    </div>
  );
}

export function ShiftSummaryCard({ summary }) {
  return (
    <aside className="card card-pad shift-summary-card shift-summary-card--window">
      <div className="shift-summary-card__header">
        <div>
          <span className="eyebrow">Live operations</span>
          <h2>Сводка смены</h2>
        </div>
        <div className="shift-summary-card__status" aria-label="Смена открыта">
          <span />
          Смена открыта
        </div>
      </div>

      <div className="shift-summary-card__open-time">
        <Icon name="bi-clock-history" size={20} />
        <span>Время открытия</span>
        <strong>09:00</strong>
      </div>

      <div className="shift-summary-card__stats">
        <div>
          <span>Касса</span>
          <strong>{formatMoney(summary.revenue)}</strong>
        </div>
        <div>
          <span>Заказы</span>
          <strong>{summary.orders}</strong>
        </div>
        <div>
          <span>Зал</span>
          <strong>{summary.occupancy}%</strong>
        </div>
        <div>
          <span>Среднее время</span>
          <strong>{summary.avgTime} мин</strong>
        </div>
      </div>

      <div className="shift-summary-card__load">
        <div>
          <span>Загруженность зала</span>
          <strong>{summary.occupancy}%</strong>
        </div>
        <div className="shift-summary-card__progress" aria-hidden="true">
          <i style={{ width: `${summary.occupancy}%` }} />
        </div>
      </div>

      <div className="shift-summary-card__alert">
        <div className="shift-summary-card__alert-icon"><Icon name="bi-exclamation-triangle" size={20} /></div>
        <p>Куриное филе заканчивается — осталось 2 кг</p>
        <span>Важно</span>
      </div>

      <div className="shift-summary-card__actions">
        <Link className="shift-summary-card__primary" to="/orders">Управление сменой</Link>
        <Link className="shift-summary-card__link" to="/reports/z-report">Посмотреть отчёт</Link>
      </div>
    </aside>
  );
}

export function QuickActionsCard({ activeOrders, occupancy, avgTime }) {
  return (
    <section className="card card-pad quick-actions quick-actions--command">
      <div className="section-header">
        <div>
          <span className="eyebrow">Command center</span>
          <h2>Быстрые действия</h2>
          <p className="quick-actions__subtitle">Самые частые операции владельца в одном месте</p>
        </div>
        <span className="quick-actions__live"><Icon name="bi-lightning-charge-fill" size={20} /> Live</span>
      </div>

      <div className="quick-actions__grid">
        <Link to="/orders"><Icon name="bi-plus-circle" size={20} /><span>Новый заказ</span><small>Создать продажу</small></Link>
        <Link to="/menu"><Icon name="bi-journal-plus" size={20} /><span>Добавить блюдо</span><small>{products.length} блюд в меню</small></Link>
        <Link to="/staff"><Icon name="bi-person-plus" size={20} /><span>Сотрудник</span><small>{employees.length} в команде</small></Link>
        <Link to="/finance"><Icon name="bi-file-earmark-spreadsheet" size={20} /><span>Финансы</span><small>Отчеты и касса</small></Link>
      </div>

      <div className="quick-actions__insights">
        <div className="quick-actions__metric">
          <span>Активные заказы</span>
          <strong>{activeOrders}</strong>
        </div>
        <div className="quick-actions__metric">
          <span>Меню</span>
          <strong>{products.length}</strong>
        </div>
        <div className="quick-actions__metric">
          <span>Команда</span>
          <strong>{employees.length}</strong>
        </div>
        <div className="quick-actions__metric">
          <span>Столы заняты</span>
          <strong>{occupancy}%</strong>
        </div>
        <div className="quick-actions__metric">
          <span>Среднее время</span>
          <strong>{avgTime} мин</strong>
        </div>
      </div>
    </section>
  );
}

export function RecentOrdersCard({ orders, status = "ready" }) {
  const hasOrders = orders.length > 0;

  return (
    <section className="card card-pad recent-orders-card">
      <div className="section-header">
        <div>
          <span className="eyebrow">Последние заказы</span>
          <h2>Последние заказы</h2>
        </div>
        <Link className="btn btn-ghost" to="/reports/orders">Все заказы</Link>
      </div>
      <div className="recent-orders-list">
        {status === "loading" ? null : status === "error" ? (
          <SectionEmpty icon="bi-exclamation-circle" title="Не удалось загрузить заказы" />
        ) : hasOrders ? orders.map((order) => (
          <div className="recent-order" key={order.key || order.id}>
            <strong>{order.id}</strong>
            <span>{order.date}</span>
            <span>{order.place}</span>
            {order.totalAmount == null ? <em>{order.amount}</em> : <CountUpValue as="em" value={order.totalAmount} format={formatMoney} />}
            {/* Статус — тот же компонент, что в «Отчёте по заказам»: цветная
                точка + подпись, без плашки. Один источник правды для статусов. */}
            <OrderStatus value={order.statusCode} />
          </div>
        )) : (
          <SectionEmpty
            icon="bi-receipt"
            title="За выбранный период заказов нет"
          />
        )}
      </div>
    </section>
  );
}

export function TopSalesCard({ dishes, error = "" }) {
  const hasDishes = dishes.length > 0;
  const [preview, setPreview] = useState(null);
  const [failedPhotos, setFailedPhotos] = useState(() => new Set());
  const closePreview = useCallback(() => setPreview(null), []);

  return (
    <section className="card card-pad top-dishes-card owner-top-sales-card">
      <div className="section-header">
        <div>
          <span className="eyebrow">Лучшие продажи</span>
          <h2>Топ-5 продаж</h2>
        </div>
        <Link className="btn btn-ghost" to="/menu">Все блюда</Link>
      </div>
      <div className="top-dishes-list">
        {error ? <div role="status"><SectionEmpty icon="bi-exclamation-circle" title="Топ-5 временно недоступен" text={error} /></div> : hasDishes ? dishes.map((item, index) => (
          <div className="top-dish top-dish--compact" key={item.product_id || item.name}>
            <div className="top-dish__rank">{index + 1}</div>
            {item.photo && !failedPhotos.has(item.photo) ? (
              <button type="button" className="dashboard-top-sales__photo" aria-label={`Открыть фото ${item.name}`} aria-haspopup="dialog" onClick={() => setPreview(item)}>
                <img
                  src={item.photo}
                  alt={item.name}
                  onError={() => setFailedPhotos((photos) => new Set(photos).add(item.photo))}
                />
              </button>
            ) : <span className="dashboard-top-sales__photo" aria-label="Нет фото"><Icon name="bi-image" /></span>}
            <div className="top-dish__body">
              <div className="top-dish__line">
                <strong>{dishDisplayName(item.name)}</strong>
              </div>
            </div>
            <CountUpValue as="div" className="top-dish__qty" value={item.quantity} format={formatDishQuantity} />
            <CountUpValue as="div" className="top-dish__price" value={item.revenue} format={formatMoney} />
          </div>
        )) : (
          <SectionEmpty
            icon="bi-basket"
            title="Продаж пока нет"
            text="После первых заказов здесь появятся самые продаваемые позиции."
          />
        )}
      </div>
      {preview ? <DishPhotoViewer photo={preview.photo} name={preview.name} onClose={closePreview} /> : null}
    </section>
  );
}




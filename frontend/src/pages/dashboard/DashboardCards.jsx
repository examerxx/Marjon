import { Link } from "react-router-dom";
import { useCallback, useState } from "react";
import DishPhotoViewer from "../../components/DishPhotoViewer";
import "./topSalesPhotos.css";
import "./recentOrders.css";
import { formatMoney, formatNumber } from "../../api/client";
import Icon from "../../components/Icon";
import OrderStatus from "../reports/OrderStatus";
import { t } from "../../i18n/t";

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
          <span className="eyebrow">{t("eyebrow.live_operations")}</span>
          <h2>{t("pages.dashboard.dashboardcards.svodka_smeny")}</h2>
        </div>
        <div className="shift-summary-card__status" aria-label={t("pages.dashboard.dashboardcards.smena_otkryta")}>
          <span />
         {t("pages.dashboard.dashboardcards.smena_otkryta")}
        </div>
      </div>

      <div className="shift-summary-card__open-time">
        <Icon name="bi-clock-history" size={20} />
        <span>{t("pages.dashboard.dashboardcards.vremya_otkrytiya")}</span>
        <strong>09:00</strong>
      </div>

      <div className="shift-summary-card__stats">
        <div>
          <span>{t("pages.dashboard.dashboardcards.kassa")}</span>
          <strong>{formatMoney(summary.revenue)}</strong>
        </div>
        <div>
          <span>{t("pages.dashboard.dashboardcards.zakazy")}</span>
          <strong>{summary.orders}</strong>
        </div>
        <div>
          <span>{t("pages.dashboard.dashboardcards.zal")}</span>
          <strong>{summary.occupancy}%</strong>
        </div>
        <div>
          <span>{t("pages.dashboard.dashboardcards.srednee_vremya")}</span>
          <strong>{summary.avgTime} {t("pages.dashboard.dashboardcards.min")}</strong>
        </div>
      </div>

      <div className="shift-summary-card__load">
        <div>
          <span>{t("pages.dashboard.dashboardcards.zagruzhennost_zala")}</span>
          <strong>{summary.occupancy}%</strong>
        </div>
        <div className="shift-summary-card__progress" aria-hidden="true">
          <i style={{ width: `${summary.occupancy}%` }} />
        </div>
      </div>

      <div className="shift-summary-card__alert">
        <div className="shift-summary-card__alert-icon"><Icon name="bi-exclamation-triangle" size={20} /></div>
        <p>{t("pages.dashboard.dashboardcards.kurinoe_file_zakanchivaetsya_ostalos_2_kg")}</p>
        <span>{t("pages.dashboard.dashboardcards.vazhno")}</span>
      </div>

      <div className="shift-summary-card__actions">
        <Link className="shift-summary-card__primary" to="/orders">{t("pages.dashboard.dashboardcards.upravlenie_smenoy")}</Link>
        <Link className="shift-summary-card__link" to="/reports/z-report">{t("pages.dashboard.dashboardcards.posmotret_otchet")}</Link>
      </div>
    </aside>
  );
}

export function QuickActionsCard({ activeOrders, occupancy, avgTime }) {
  return (
    <section className="card card-pad quick-actions quick-actions--command">
      <div className="section-header">
        <div>
          <span className="eyebrow">{t("eyebrow.command_center")}</span>
          <h2>{t("pages.dashboard.dashboardcards.bystrye_deystviya")}</h2>
          <p className="quick-actions__subtitle">{t("pages.dashboard.dashboardcards.samye_chastye_operatsii_vladeltsa_v_odnom_meste")}</p>
        </div>
        <span className="quick-actions__live"><Icon name="bi-lightning-charge-fill" size={20} /> Live</span>
      </div>

      <div className="quick-actions__grid">
        <Link to="/orders"><Icon name="bi-plus-circle" size={20} /><span>{t("pages.dashboard.dashboardcards.novyy_zakaz")}</span><small>{t("pages.dashboard.dashboardcards.sozdat_prodazhu")}</small></Link>
        <Link to="/menu"><Icon name="bi-journal-plus" size={20} /><span>{t("pages.dashboard.dashboardcards.dobavit_blyudo")}</span><small>{products.length} {t("pages.dashboard.dashboardcards.blyud_v_menyu")}</small></Link>
        <Link to="/staff"><Icon name="bi-person-plus" size={20} /><span>{t("pages.dashboard.dashboardcards.sotrudnik")}</span><small>{employees.length} {t("pages.dashboard.dashboardcards.v_komande")}</small></Link>
        <Link to="/finance"><Icon name="bi-file-earmark-spreadsheet" size={20} /><span>{t("pages.dashboard.dashboardcards.finansy")}</span><small>{t("pages.dashboard.dashboardcards.otchety_i_kassa")}</small></Link>
      </div>

      <div className="quick-actions__insights">
        <div className="quick-actions__metric">
          <span>{t("pages.dashboard.dashboardcards.aktivnye_zakazy")}</span>
          <strong>{activeOrders}</strong>
        </div>
        <div className="quick-actions__metric">
          <span>{t("pages.dashboard.dashboardcards.menyu")}</span>
          <strong>{products.length}</strong>
        </div>
        <div className="quick-actions__metric">
          <span>{t("pages.dashboard.dashboardcards.komanda")}</span>
          <strong>{employees.length}</strong>
        </div>
        <div className="quick-actions__metric">
          <span>{t("pages.dashboard.dashboardcards.stoly_zanyaty")}</span>
          <strong>{occupancy}%</strong>
        </div>
        <div className="quick-actions__metric">
          <span>{t("pages.dashboard.dashboardcards.srednee_vremya")}</span>
          <strong>{avgTime} {t("pages.dashboard.dashboardcards.min")}</strong>
        </div>
      </div>
    </section>
  );
}

export function RecentOrdersCard({ orders }) {
  const hasOrders = orders.length > 0;

  return (
    <section className="card card-pad recent-orders-card">
      <div className="section-header">
        <div>
          <span className="eyebrow">{t("pages.dashboard.dashboardcards.poslednie_zakazy")}</span>
          <h2>{t("pages.dashboard.dashboardcards.poslednie_zakazy")}</h2>
        </div>
        <Link className="btn btn-ghost" to="/reports/orders">{t("pages.dashboard.dashboardcards.vse_zakazy")}</Link>
      </div>
      <div className="recent-orders-list">
        {hasOrders ? orders.map((order) => (
          <div className="recent-order" key={order.id}>
            <strong>{order.id}</strong>
            <span>{order.date}</span>
            <span>{order.place}</span>
            <em>{order.amount}</em>
            {/* Статус — тот же компонент, что в «Отчёте по заказам»: цветная
                точка + подпись, без плашки. Один источник правды для статусов. */}
            <OrderStatus value={order.statusCode} />
          </div>
        )) : (
          <SectionEmpty
            icon="bi-receipt"
            title={t("pages.dashboard.dashboardcards.zakazov_poka_net")}
            text={t("pages.dashboard.dashboardcards.novye_zakazy_budut_otobrazhatsya_zdes")}
          />
        )}
      </div>
    </section>
  );
}

export function TopSalesCard({ dishes, error = "" }) {
  const hasDishes = dishes.length > 0;
  const [preview, setPreview] = useState(null);
  const closePreview = useCallback(() => setPreview(null), []);

  return (
    <section className="card card-pad top-dishes-card owner-top-sales-card">
      <div className="section-header">
        <div>
          <span className="eyebrow">{t("pages.dashboard.dashboardcards.luchshie_prodazhi")}</span>
          <h2>{t("pages.dashboard.dashboardcards.top_5_prodazh")}</h2>
        </div>
        <Link className="btn btn-ghost" to="/menu">{t("pages.dashboard.dashboardcards.vse_blyuda")}</Link>
      </div>
      <div className="top-dishes-list">
        {error ? <div role="status"><SectionEmpty icon="bi-exclamation-circle" title={t("pages.dashboard.dashboardcards.top_5_vremenno_nedostupen")} text={error} /></div> : hasDishes ? dishes.map((item, index) => (
          <div className="top-dish top-dish--compact" key={item.product_id || item.name}>
            <div className="top-dish__rank">{index + 1}</div>
            {item.photo ? (
              <button type="button" className="dashboard-top-sales__photo" aria-label={`Открыть фото ${item.name}`} aria-haspopup="dialog" onClick={() => setPreview(item)}>
                <img src={item.photo} alt={item.name} />
              </button>
            ) : <span className="dashboard-top-sales__photo" aria-label={t("pages.dashboard.dashboardcards.net_foto")}><Icon name="bi-image" /></span>}
            <div className="top-dish__body">
              <div className="top-dish__line">
                <strong>{dishDisplayName(item.name)}</strong>
              </div>
            </div>
            <div className="top-dish__qty">{formatNumber(item.quantity)} {t("pages.dashboard.dashboardcards.sht")}</div>
            <div className="top-dish__price">{formatMoney(item.revenue)}</div>
          </div>
        )) : (
          <SectionEmpty
            icon="bi-basket"
            title={t("pages.dashboard.dashboardcards.prodazh_poka_net")}
            text={t("pages.dashboard.dashboardcards.posle_pervyh_zakazov_zdes_poyavyatsya_samye_prodavaemye_pozitsii")}
          />
        )}
      </div>
      {preview ? <DishPhotoViewer photo={preview.photo} name={preview.name} onClose={closePreview} /> : null}
    </section>
  );
}




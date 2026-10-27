import { useEffect, useState } from "react";

import Icon from "../../../components/Icon";
import { isAbortError, useLatestRequest } from "../../../hooks/useAsyncSafety";
import { TransactionsTable } from "../../AdminDashboardTransactions";
import { dashboardApi } from "./dashboardApi";
import { t } from "../../../i18n/t";
import "./dashboard.css";

const METRIC_CARDS = Object.freeze([
  { key: "turnover", label: "Оборот за месяц", icon: "bi-graph-up-arrow", tone: "turnover" },
  { key: "organizations", label: "Всего организаций", icon: "bi-buildings", tone: "organizations" },
  { key: "completed", label: "Выполненная работа", icon: "bi-clipboard-check", tone: "completed" },
  { key: "paid", label: "Оплаченная сумма", icon: "bi-cash-coin", tone: "paid" },
  { key: "unpaid", label: "Не оплачено", icon: "bi-receipt", tone: "unpaid" },
]);

const SUMMARY_CARDS = Object.freeze([
  { label: "Приход товаров", icon: "bi-box-seam", tone: "income" },
  { label: "Расход товаров", icon: "bi-box-arrow-up", tone: "expense" },
  { label: "Остаток склада", icon: "bi-boxes", tone: "stock" },
  { label: "Общие затраты", icon: "bi-receipt", tone: "costs" },
  { label: "Кредиторка", icon: "bi-credit-card", tone: "creditor" },
  { label: "Дебиторка", icon: "bi-wallet2", tone: "debtor" },
]);

function MetricValue({ card, organizationTotal }) {
  if (card.key !== "organizations") {
    return <><strong>—</strong><span>{t("admin.features.dashboard.dashboardpage.kontrakt_ne_podklyuchen")}</span></>;
  }
  if (organizationTotal.state === "loading") {
    return <><span className="hq-dashboard-metric__skeleton" aria-hidden="true" /><span>{t("admin.features.dashboard.dashboardpage.poluchaem_dannye")}</span></>;
  }
  if (organizationTotal.state === "error") {
    return <><strong>—</strong><span>{t("admin.features.dashboard.dashboardpage.ne_udalos_zagruzit")}</span></>;
  }
  return <><strong>{organizationTotal.value.toLocaleString("ru-RU")}</strong><span>{t("admin.features.dashboard.dashboardpage.kanonicheskiy_total")}</span></>;
}

export function AdminDashboardContainer({ isActive, onInnerBackChange, onNotify }) {
  useEffect(() => {
    if (!isActive) return undefined;
    onInnerBackChange(null);
    return () => onInnerBackChange(null);
  }, [isActive, onInnerBackChange]);

  if (!isActive) return null;
  return <DashboardPage onNotify={onNotify} />;
}

export function DashboardPage({ onNotify }) {
  const [organizationTotal, setOrganizationTotal] = useState({ state: "loading", value: null });
  const beginOrganizationRequest = useLatestRequest();

  useEffect(() => {
    const request = beginOrganizationRequest();
    setOrganizationTotal({ state: "loading", value: null });
    dashboardApi.getOrganizationTotal()
      .then((value) => {
        if (request.isCurrent()) setOrganizationTotal({ state: "success", value });
      })
      .catch((error) => {
        if (request.isCurrent() && !isAbortError(error)) {
          setOrganizationTotal({ state: "error", value: null });
        }
      });
  }, [beginOrganizationRequest]);

  return (
    <div className="hq-dashboard">
      <h1 className="sr-only">{t("admin.features.dashboard.dashboardpage.dashbord")}</h1>
      <section className="hq-dashboard-metrics" aria-label={t("admin.features.dashboard.dashboardpage.svodnye_pokazateli_platformy")}>
        {METRIC_CARDS.map((card) => (
          <article className={`hq-dashboard-metric is-${card.tone}`} key={card.key}>
            <div className="hq-dashboard-metric__head">
              <span className="hq-dashboard-metric__icon" aria-hidden="true"><Icon name={card.icon} size={21} /></span>
              <span className="hq-dashboard-metric__source">{t("admin.features.dashboard.dashboardpage.tekuschiy_snimok")}</span>
            </div>
            <h2>{card.label}</h2>
            <div className="hq-dashboard-metric__value">
              <MetricValue card={card} organizationTotal={organizationTotal} />
            </div>
          </article>
        ))}
        {organizationTotal.state === "loading" ? <span className="sr-only" role="status">{t("admin.features.dashboard.dashboardpage.zagruzka_kolichestva_organizatsiy")}</span> : null}
        {organizationTotal.state === "error" ? <span className="sr-only" role="alert">{t("admin.features.dashboard.dashboardpage.ne_udalos_zagruzit_kolichestvo_organizatsiy")}</span> : null}
      </section>

      <section className="hq-dashboard-analytics" aria-labelledby="hq-dashboard-analytics-title">
        <div className="hq-dashboard-analytics__main">
          <div className="hq-dashboard-filter-strip" aria-label={t("admin.features.dashboard.dashboardpage.nedostupnye_analiticheskie_srezy")}>
            {["Период недоступен", "Продажи", "Транзакции", "Дата установки", "Аналитика"].map((label, index) => (
              <span className="hq-dashboard-filter" aria-disabled="true" key={label}>
                <Icon name={index === 0 ? "bi-calendar3" : index === 1 ? "bi-tags" : index === 2 ? "bi-cash-coin" : index === 3 ? "bi-display" : "bi-bar-chart"} size={17} />
                {label}
              </span>
            ))}
          </div>
          <div className="hq-dashboard-chart-card">
            <div className="hq-dashboard-chart-card__head">
              <div>
                <h2 id="hq-dashboard-analytics-title">{t("admin.features.dashboard.dashboardpage.dinamika_oborota_platformy")}</h2>
                <strong>—</strong>
                <span>{t("admin.features.dashboard.dashboardpage.net_podtverzhdennogo_analiticheskogo_kontrakta")}</span>
              </div>
              <span className="hq-dashboard-chart-card__truth"><Icon name="bi-shield-check" size={16} /> {t("admin.features.dashboard.dashboardpage.tolko_podtverzhdennye_dannye")}</span>
            </div>
            <div className="hq-dashboard-chart-empty">
              <span className="hq-dashboard-chart-empty__lines" aria-hidden="true"><i /><i /><i /><i /></span>
              <span className="hq-dashboard-chart-empty__message"><Icon name="bi-graph-up" size={25} />{t("admin.features.dashboard.dashboardpage.grafik_poyavitsya_posle_podklyucheniya_servernogo")}</span>
            </div>
          </div>
        </div>

        <aside className="hq-dashboard-summary" aria-label={t("admin.features.dashboard.dashboardpage.svodka_sklada_i_zatrat")}>
          {SUMMARY_CARDS.map((card) => (
            <article className={`hq-dashboard-summary-card is-${card.tone}`} key={card.label}>
              <span className="hq-dashboard-summary-card__icon" aria-hidden="true"><Icon name={card.icon} size={24} /></span>
              <span><strong>{card.label}</strong><small>{t("admin.features.dashboard.dashboardpage.kontrakt_ne_podklyuchen")}</small></span>
              <b>—</b>
            </article>
          ))}
        </aside>
      </section>

      <TransactionsTable onNotify={onNotify} />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { formatMoney, formatNumber } from "../api/client";
import { analyticsService } from "../api/reports";
import { formatDateLabel, todayInputValue } from "../utils/date";
import Icon from "../components/Icon";
import { isAbortError, useLatestRequest } from "../hooks/useAsyncSafety";
import { t } from "../i18n/t";

function getDayRange(date) {
  return { date_from: date, date_to: date };
}

export default function FinancePage() {
  const { selectedDate = todayInputValue() } = useOutletContext();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beginRequest = useLatestRequest();

  useEffect(() => {
    const request = beginRequest();
    setRows([]);
    setLoading(true);
    setError("");
    analyticsService.listSales(getDayRange(selectedDate).date_from, getDayRange(selectedDate).date_to, { signal: request.signal })
      .then(({ data }) => { if (request.isCurrent()) setRows(Array.isArray(data) ? data : []); })
      .catch((err) => { if (request.isCurrent() && !isAbortError(err)) { setRows([]); setError(err.response?.data?.detail || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0444\u0438\u043d\u0430\u043d\u0441\u044b."); } })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [beginRequest, selectedDate]);

  const totals = useMemo(() => rows.reduce((acc, row) => {
    acc.revenue += Number(row.revenue || 0);
    acc.orders += Number(row.orders_count || 0);
    return acc;
  }, { revenue: 0, orders: 0 }), [rows]);

  return (
    <>
      {!loading && !error ? <section className="kpi-grid">
        <article className="kpi-card compact"><div className="kpi-icon orange"><Icon name="bi-cash-stack" size={20} /></div><div><div className="kpi-label">{t("pages.financepage.vyruchka_za_den")}</div><div className="kpi-value">{formatMoney(totals.revenue)}</div></div></article>
        <article className="kpi-card compact"><div className="kpi-icon blue"><Icon name="bi-receipt" size={20} /></div><div><div className="kpi-label">{t("pages.financepage.zakazov")}</div><div className="kpi-value">{formatNumber(totals.orders)}</div></div></article>
        <article className="kpi-card compact"><div className="kpi-icon green"><Icon name="bi-graph-up" size={20} /></div><div><div className="kpi-label">{t("pages.financepage.sredniy_chek")}</div><div className="kpi-value">{formatMoney(totals.orders ? totals.revenue / totals.orders : 0)}</div></div></article>
      </section> : null}
      <section className="card card-pad">
        <div className="section-header"><div><span className="eyebrow">{t("eyebrow.finance")}</span><h2>{t("pages.financepage.finansovaya_svodka_za")} {formatDateLabel(selectedDate)}</h2></div></div>
        {loading ? <div role="status">{t("pages.financepage.zagruzka_finansov")}</div> : null}
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <p>{t("pages.financepage.stranitsa_ispolzuet_dannye_prodazh_za_vybrannyy_den")}</p>
      </section>
    </>
  );
}

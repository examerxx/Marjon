import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { formatMoney, formatNumber } from "../api/client";
import { analyticsService } from "../api/reports";
import { formatDateLabel, todayInputValue } from "../utils/date";
import { isAbortError, useLatestRequest } from "../hooks/useAsyncSafety";
import { t } from "../i18n/t";

function getDayRange(date) {
  return { date_from: date, date_to: date };
}

export default function AnalyticsPage() {
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
      .catch((err) => { if (request.isCurrent() && !isAbortError(err)) { setRows([]); setError(err.response?.data?.detail || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0430\u043d\u0430\u043b\u0438\u0442\u0438\u043a\u0443."); } })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [beginRequest, selectedDate]);

  return (
    <section className="card card-pad">
      <div className="section-header"><div><span className="eyebrow">{t("eyebrow.analytics")}</span><h2>{t("pages.analyticspage.prodazhi_za")} {formatDateLabel(selectedDate)}</h2></div></div>
      {error ? <div className="login-error" role="alert">{error}</div> : null}
      <div className="table-responsive"><table className="data-table"><thead><tr><th>{t("pages.analyticspage.data")}</th><th>{t("pages.analyticspage.zakazy")}</th><th>{t("pages.analyticspage.vyruchka")}</th><th>{t("pages.analyticspage.sredniy_chek")}</th></tr></thead><tbody>
        {loading ? <tr><td colSpan="4" role="status">{t("pages.analyticspage.zagruzka")}</td></tr> : rows.map((row) => <tr key={row.date}><td>{row.date}</td><td>{formatNumber(row.orders_count)}</td><td>{formatMoney(row.revenue)}</td><td>{formatMoney(row.avg_check)}</td></tr>)}
        {!loading && !error && !rows.length ? <tr><td colSpan="4">{t("pages.analyticspage.dannyh_po_prodazham_za_etot_den_net")}</td></tr> : null}
      </tbody></table></div>
    </section>
  );
}

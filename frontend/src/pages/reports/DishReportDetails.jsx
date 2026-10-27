import { useEffect, useState } from "react";
import { reportsService } from "../../api/reports";
import ReportDateRangePicker from "../../components/ReportDateRangePicker";
import { webDateTime } from "../../utils/webTime";
import { formatDateLabel } from "../../utils/date";
import { isOrderedDateRange } from "../../hooks/useAsyncSafety";
import { toApiDate } from "./reportPeriod";
import OrderStatus from "./OrderStatus";
import { t } from "../../i18n/t";

const number = value => Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const money = value => value == null ? "—" : Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " UZS";
function periodMetrics(data, dish) {
  const rows = Array.isArray(data) ? data : data?.rows;
  if (!Array.isArray(rows)) throw new Error("Invalid dishes response");
  const match = rows.find(row => String(row.product_id) === String(dish.productId) && row.name === dish.name);
  if (!match) return { ...dish, quantity: "0", price: "—", amount: money(0), costNum: 0, profitNum: 0 };
  const covered = match.cost_coverage_complete === true;
  return { ...dish, quantity: number(match.quantity), price: money(match.price), amount: money(match.amount),
    costNum: covered ? match.cost_total : null, profitNum: covered ? match.profit : null };
}

export default function DishReportDetails({ dish, dateFrom, dateTo, filters }) {
  const [period, setPeriod] = useState(() => ({ start: formatDateLabel(dateFrom), end: formatDateLabel(dateTo), preset: "" }));
  const selectedFrom = toApiDate(period.start);
  const selectedTo = toApiDate(period.end);
  const [orders, setOrders] = useState(null);
  const [metrics, setMetrics] = useState(dish);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setOrders(null); setError(""); setMetrics(null);
    if (!dish.productId || !selectedFrom || !selectedTo || !isOrderedDateRange(selectedFrom, selectedTo)) {
      setError(!dish.productId ? "Идентификатор блюда недоступен." : "Дата начала периода не может быть позже даты окончания.");
      return () => { active = false; controller.abort(); };
    }
    // The detail picker owns its period; returning to the report preserves
    // the original report period and filters. Both detail sections use it.
    const unchangedPeriod = selectedFrom === dateFrom && selectedTo === dateTo;
    const summary = unchangedPeriod ? Promise.resolve(dish) :
      reportsService.listDishes(selectedFrom, selectedTo, { signal: controller.signal, filters: { ...filters, query: "", productId: [dish.productId] } })
        .then(({ data }) => periodMetrics(data, dish));
    Promise.all([
      reportsService.listOrders(selectedFrom, selectedTo, { signal: controller.signal, filters: {
        productId: [dish.productId], waiterId: filters.authorId, orderType: filters.orderType,
        orderStatus: filters.orderStatus, paymentMethod: filters.paymentMethod,
      } }), summary,
    ]).then(([{ data }, updatedMetrics]) => {
      if (!active) return;
      if (!Array.isArray(data)) throw new Error("Invalid orders response");
      setOrders(data); setMetrics(updatedMetrics);
    }).catch(() => { if (active) setError("Не удалось загрузить данные по блюду за выбранный период."); });
    return () => { active = false; controller.abort(); };
  }, [dish, selectedFrom, selectedTo, dateFrom, dateTo, filters]);
  return <section className="dishes-report-page dish-report-detail-page owner-report-view">
    <article className="report-page-card owner-report-surface">
      <div className="owner-report-header dish-report-header"><div className="owner-report-heading"><span className="report-accent-bar" aria-hidden="true" /><div><span className="owner-report-kicker">{t("pages.reports.dishreportdetails.otchet_po_blyudam")}</span><h1>{dish.name}</h1></div></div>
      <div className="dish-report-metrics">
        <div><span>{t("pages.reports.dishreportdetails.tsena_pozitsii")}</span><strong>{metrics?.price || "—"}</strong></div>
        <div><span>{t("pages.reports.dishreportdetails.prodano")}</span><strong>{metrics ? metrics.quantity + " " + dish.unit : "—"}</strong></div>
        <div><span>{t("pages.reports.dishreportdetails.summa_prodazh")}</span><strong>{metrics?.amount || "—"}</strong></div>
        <div><span>{t("pages.reports.dishreportdetails.sebestoimost_prodazh")}</span><strong>{money(metrics?.costNum)}</strong></div>
        <div><span>{t("pages.reports.dishreportdetails.pribyl")}</span><strong>{money(metrics?.profitNum)}</strong></div>
      </div>
        <div className="report-actions owner-report-actions"><ReportDateRangePicker variant="canonical" value={period} onChange={setPeriod} buttonAriaLabel="Период продаж позиции" /></div>
      </div>
      {error ? <div role="alert" className="login-error">{error}</div> : null}
      <div className="owner-report-table-scroll"><table className="report-table owner-report-table dish-order-table" aria-label={t("pages.reports.dishreportdetails.zakazy_s_etoy_pozitsiey")}>
        <colgroup><col style={{ width: "6%" }} /><col style={{ width: "17%" }} /><col style={{ width: "16%" }} /><col style={{ width: "12%" }} /><col style={{ width: "20%" }} /><col style={{ width: "17%" }} /><col style={{ width: "12%" }} /></colgroup>
        <thead><tr><th>{t("pages.reports.dishreportdetails.zakaza")}</th><th>{t("pages.reports.dishreportdetails.data_i_vremya")}</th><th>{t("pages.reports.dishreportdetails.mesto")}</th><th>{t("pages.reports.dishreportdetails.ofitsiant")}</th><th title={t("pages.reports.dishreportdetails.kolichestvo_pozitsii_summa_ee_prodazh_v_etom_zakaze")}>{t("pages.reports.dishreportdetails.tsena_pozitsii_v_zakaze")}</th><th>{t("pages.reports.dishreportdetails.summa_zakaza")}</th><th>{t("pages.reports.dishreportdetails.status")}</th></tr></thead>
        <tbody>{orders?.map(order => <tr key={order.order_id}><td>{order.order_number}</td><td>{webDateTime(order.created_at) || "—"}</td><td>{[order.hall_name, order.table_number ? "стол " + order.table_number : null].filter(Boolean).join(", ") || "—"}</td><td>{order.waiter_name || "—"}</td><td>{order.position_quantity != null && order.position_amount != null ? number(order.position_quantity) + " / " + money(order.position_amount) : "—"}</td><td>{money(order.total_amount)}</td><td><OrderStatus value={order.status} /></td></tr>)}
          {!orders?.length ? <tr><td colSpan={7}>{error ? "Заказы недоступны" : orders ? "Заказов не найдено" : "Загрузка заказов…"}</td></tr> : null}</tbody>
      </table></div>
    </article>
  </section>;
}

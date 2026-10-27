import { useEffect, useRef, useState } from "react";
import { webFormat } from "../../utils/webTime";
import { formatMoney } from "./reportMoney";
import OrderStatus from "./OrderStatus";
import { loadOrder } from "./orderDetailData";
import { t } from "../../i18n/t";
import "./orderReportDetails.css";

const types = { dine_in: "На стол", takeaway: "На вынос", delivery: "Доставка", qr: "QR" };
const webDateTime = value => webFormat(value, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const number = value => Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const money = value => value == null || !Number.isFinite(Number(value)) ? "—" : formatMoney(value);

function groupOrderItems(items) {
  const grouped = new Map();
  for (const item of items) {
    if (item.status === "cancelled") continue;
    const key = JSON.stringify([item.product_id || item.name, item.name, Number(item.price), Number(item.discount || 0), item.unit || "", item.modifiers || [], item.note || "", item.course || 0, Boolean(item.takeaway)]);
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += Number(item.quantity);
      existing.total += Number(item.total);
    } else {
      grouped.set(key, { ...item, quantity: Number(item.quantity), total: Number(item.total) });
    }
  }
  return [...grouped.values()];
}

export default function OrderReportDetails({ row }) {
  const heading = useRef(null);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    heading.current?.focus();
    const controller = new AbortController();
    let active = true;
    setOrder(null); setError("");
    loadOrder(row.id, controller.signal).then(({ data }) => {
      if (!active) return;
      if (!Array.isArray(data?.items)) throw new Error("Invalid order detail");
      setOrder(data);
    }).catch(() => {
      if (active) setError("Не удалось загрузить состав заказа.");
    });
    return () => { active = false; controller.abort(); };
  }, [row.id, retry]);
  const items = groupOrderItems(order?.items || []);
  return <section className="order-report-detail">
    <article className="order-report-detail__card">
      <div className="order-report-detail__metadata">
        <div className="order-report-detail__identity"><h1 ref={heading} tabIndex={-1}>{t("pages.reports.orderreportdetails.zakaz")}{row.orderNumber}</h1></div>
        <div><span>{t("pages.reports.orderreportdetails.data_sozdaniya")}</span><strong>{webDateTime(order?.created_at || row.createdAt) || "—"}</strong></div>
        <div><span>{t("pages.reports.orderreportdetails.mesto")}</span><strong>{[row.hallName, row.tableNumber ? `стол ${row.tableNumber}` : null].filter(Boolean).join(", ") || "—"}</strong></div>
        <div><span>{t("pages.reports.orderreportdetails.tip")}</span><strong>{types[row.orderType] || "—"}</strong></div>
        <div><span>{t("pages.reports.orderreportdetails.ofitsiant")}</span><strong>{row.waiterName || "—"}</strong></div>
        <div><span>{t("pages.reports.orderreportdetails.kassir")}</span><strong>{row.cashierNames?.join(", ") || "—"}</strong></div>
        <div className="order-report-detail__status"><OrderStatus value={order?.status || row.status} /></div>
      </div>
      {error ? <div className="order-report-detail__error" role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>{t("pages.reports.orderreportdetails.povtorit")}</button></div> : null}
      <div className="order-report-detail__columns">
        <section className="order-report-detail__items" aria-label={t("pages.reports.orderreportdetails.sostav_zakaza")}>
          <div className="order-report-detail__scroll"><table aria-label={t("pages.reports.orderreportdetails.sostav_zakaza")}>
            <thead><tr><th>№</th><th>{t("pages.reports.orderreportdetails.blyudo_tovar")}</th><th>{t("pages.reports.orderreportdetails.kol_vo")}</th><th>{t("pages.reports.orderreportdetails.tsena_uzs")}</th><th>{t("pages.reports.orderreportdetails.summa_uzs")}</th></tr></thead>
            <tbody>{items.map((item, index) => <tr key={item.id || index}><td>{index + 1}</td><td>{item.name}</td><td>{number(item.quantity)}{item.unit ? ` ${item.unit}` : ""}</td><td>{money(item.price).replace(/ UZS$/, "")}</td><td>{money(item.total).replace(/ UZS$/, "")}</td></tr>)}
              {!items.length ? <tr><td colSpan={5}>{error ? "Состав заказа недоступен" : !order ? "Загрузка состава заказа…" : "Нет позиций"}</td></tr> : null}</tbody>
            <tfoot><tr><td colSpan={4}>{t("pages.reports.orderreportdetails.itogo")}</td><td>{order ? money(order.total_amount) : "—"}</td></tr></tfoot>
          </table></div>
        </section>
      </div>
    </article>
  </section>;
}

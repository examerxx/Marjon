import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { api, formatMoney, formatNumber } from "../api/client";
import { formatDateLabel, todayInputValue } from "../utils/date";

const methodLabels = {
  cash: "Наличные",
  card: "Карта",
  payme: "Payme",
  click: "Click",
  uzum: "Uzum",
  loyalty: "Лояльность",
  mixed: "Смешанная",
};

const printReports = [
  {
    key: "cashiers",
    title: "Отчет по кассирам",
    icon: "bi-person-badge",
    fields: [{ type: "select", label: "Кассир", options: ["Все кассиры", "Administrator", "Кассир 1"] }],
  },
  {
    key: "waiters",
    title: "Отчет по официантам",
    icon: "bi-person-lines-fill",
    fields: [
      { type: "select", label: "Официант", options: ["Все официанты", "Официант 1", "Официант 2"] },
      { type: "input", label: "Процент" },
    ],
  },
  {
    key: "cooks",
    title: "Отчет по поварам",
    icon: "bi-egg-fried",
    fields: [{ type: "select", label: "Повар", options: ["Все повара", "Повар 1", "Повар 2"] }],
  },
  {
    key: "places",
    title: "Отчет по местам",
    icon: "bi-grid-3x3-gap",
    fields: [{ type: "select", label: "Место", options: ["Все места", "Основной зал", "Летняя зона"] }],
  },
  {
    key: "menu",
    title: "Отчет по меню",
    icon: "bi-journal-text",
    fields: [{ type: "select", label: "Категория", options: ["Все категории", "Горячее", "Напитки", "Салаты"] }],
  },
];

function demoZReport(date) {
  return {
    date,
    shift_opened_at: "09:00",
    shift_closed_at: null,
    is_closed: false,
    orders_count: 128,
    cancelled_orders_count: 6,
    payments_count: 128,
    fiscal_receipts_count: 121,
    gross_sales: 3740000,
    discounts_total: 120000,
    service_fee_total: 86000,
    tax_total: 0,
    refunds_total: 80000,
    net_sales: 3540000,
    cash_total: 1450000,
    cash_received_total: 1635000,
    change_given_total: 185000,
    non_cash_total: 2090000,
    avg_check: 27656,
    payment_methods: [
      { method: "cash", amount: 1450000, count: 48 },
      { method: "card", amount: 1120000, count: 39 },
      { method: "payme", amount: 620000, count: 23 },
      { method: "click", amount: 350000, count: 18 },
    ],
  };
}

function moneyValue(value) {
  return Number(value || 0);
}

function methodShare(amount, total) {
  if (!total) return 0;
  return Math.round((moneyValue(amount) / total) * 100);
}

export default function ZReportPage() {
  const { selectedDate = todayInputValue() } = useOutletContext();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    setClosed(false);

    api.get("/analytics/z-report", { params: { date: selectedDate } })
      .then(({ data }) => {
        if (!mounted) return;
        setReport(data);
        setClosed(Boolean(data.is_closed));
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.response?.data?.detail || "Z-отчёт пока недоступен. Показаны демо-данные.");
        setReport(demoZReport(selectedDate));
      })
      .finally(() => mounted && setLoading(false));

    return () => { mounted = false; };
  }, [selectedDate]);

  const displayReport = report || demoZReport(selectedDate);
  const paymentMethods = displayReport.payment_methods || [];
  const paymentTotal = useMemo(
    () => paymentMethods.reduce((sum, item) => sum + moneyValue(item.amount), 0),
    [paymentMethods],
  );
  const fiscalGap = Math.max(0, Number(displayReport.payments_count || 0) - Number(displayReport.fiscal_receipts_count || 0));
  const closeTime = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date());

  if (loading) return <div className="loading-note">Загрузка Z-отчёта...</div>;

  return (
    <section className="z-report-page">
      <div className="z-report-hero card card-pad">
        <div>
          <span className="eyebrow">Fiscal close</span>
          <h2>Z-отчёт за {formatDateLabel(selectedDate)}</h2>
          <p>Итог смены по продажам, оплатам, возвратам и фискальным чекам.</p>
        </div>
        <div className={`z-report-status ${closed ? "is-closed" : "is-open"}`}>
          <span />
          {closed ? `Смена закрыта ${displayReport.shift_closed_at || closeTime}` : "Смена открыта"}
        </div>
      </div>

      {error ? <div className="z-report-warning"><i className="bi bi-info-circle" /> {error}</div> : null}

      <section className="z-report-kpis">
        <article className="z-report-kpi z-report-kpi--orange">
          <i className="bi bi-cash-stack" />
          <span>Выручка нетто</span>
          <strong>{formatMoney(displayReport.net_sales)}</strong>
          <small>После возвратов</small>
        </article>
        <article className="z-report-kpi z-report-kpi--blue">
          <i className="bi bi-receipt" />
          <span>Заказы</span>
          <strong>{formatNumber(displayReport.orders_count)}</strong>
          <small>{formatNumber(displayReport.cancelled_orders_count)} отмен</small>
        </article>
        <article className="z-report-kpi z-report-kpi--green">
          <i className="bi bi-credit-card" />
          <span>Оплаты</span>
          <strong>{formatNumber(displayReport.payments_count)}</strong>
          <small>{formatMoney(paymentTotal)}</small>
        </article>
        <article className="z-report-kpi z-report-kpi--dark">
          <i className="bi bi-file-earmark-check" />
          <span>Фискальные чеки</span>
          <strong>{formatNumber(displayReport.fiscal_receipts_count)}</strong>
          <small>{fiscalGap ? `${fiscalGap} требуют проверки` : "Расхождений нет"}</small>
        </article>
      </section>

      <section className="z-report-grid">
        <article className="z-report-card z-report-receipt">
          <div className="z-report-card__head">
            <div>
              <span className="eyebrow">Z receipt</span>
              <h3>Кассовый итог</h3>
            </div>
            <strong>#{selectedDate.replaceAll("-", "")}</strong>
          </div>
          <div className="z-report-receipt__body">
            <div><span>Открытие смены</span><strong>{displayReport.shift_opened_at}</strong></div>
            <div><span>Закрытие смены</span><strong>{closed ? displayReport.shift_closed_at || closeTime : "Не закрыта"}</strong></div>
            <div><span>Валовые продажи</span><strong>{formatMoney(displayReport.gross_sales)}</strong></div>
            <div><span>Скидки</span><strong>-{formatMoney(displayReport.discounts_total)}</strong></div>
            <div><span>Сервисный сбор</span><strong>{formatMoney(displayReport.service_fee_total)}</strong></div>
            <div><span>Налоги</span><strong>{formatMoney(displayReport.tax_total)}</strong></div>
            <div><span>Возвраты</span><strong>-{formatMoney(displayReport.refunds_total)}</strong></div>
            <div className="is-total"><span>Итого к закрытию</span><strong>{formatMoney(displayReport.net_sales)}</strong></div>
          </div>
        </article>

        <article className="z-report-card">
          <div className="z-report-card__head">
            <div>
              <span className="eyebrow">Payments</span>
              <h3>Оплаты по методам</h3>
            </div>
          </div>
          <div className="z-report-methods">
            {paymentMethods.map((item) => {
              const share = methodShare(item.amount, paymentTotal);
              return (
                <div className="z-report-method" key={item.method}>
                  <div>
                    <strong>{methodLabels[item.method] || item.method}</strong>
                    <span>{formatNumber(item.count)} оплат · {share}%</span>
                  </div>
                  <em>{formatMoney(item.amount)}</em>
                  <i style={{ width: `${share}%` }} />
                </div>
              );
            })}
            {!paymentMethods.length ? <p className="z-report-empty">Оплат за выбранный день нет.</p> : null}
          </div>
        </article>

        <article className="z-report-card">
          <div className="z-report-card__head">
            <div>
              <span className="eyebrow">Cash drawer</span>
              <h3>Касса и размен</h3>
            </div>
          </div>
          <div className="z-report-cash">
            <div><span>Наличные продажи</span><strong>{formatMoney(displayReport.cash_total)}</strong></div>
            <div><span>Принято наличными</span><strong>{formatMoney(displayReport.cash_received_total)}</strong></div>
            <div><span>Выдано сдачи</span><strong>{formatMoney(displayReport.change_given_total)}</strong></div>
            <div><span>Безналичные оплаты</span><strong>{formatMoney(displayReport.non_cash_total)}</strong></div>
            <div><span>Средний чек</span><strong>{formatMoney(displayReport.avg_check)}</strong></div>
          </div>
        </article>

        <article className="z-report-card z-report-print-panel">
          <div className="z-report-card__head">
            <div>
              <span className="eyebrow">Print center</span>
              <h3>Печатные отчёты</h3>
            </div>
            <button className="z-report-print-panel__main" type="button" onClick={() => window.print()}>
              <i className="bi bi-printer" />
              Печать Z-отчёта
            </button>
          </div>
          <div className="z-report-print-list">
            {printReports.map((reportItem) => (
              <div className="z-report-print-row" key={reportItem.key}>
                <div className="z-report-print-row__title">
                  <i className={`bi ${reportItem.icon}`} />
                  <strong>{reportItem.title}</strong>
                </div>
                <div className="z-report-print-row__filters">
                  {reportItem.fields.map((field) => (
                    field.type === "select" ? (
                      <label className="z-report-filter" key={field.label}>
                        <select defaultValue="">
                          <option value="" disabled>{field.label}</option>
                          {field.options.map((option) => <option value={option} key={option}>{option}</option>)}
                        </select>
                        <i className="bi bi-chevron-down" />
                      </label>
                    ) : (
                      <label className="z-report-filter" key={field.label}>
                        <input placeholder={field.label} inputMode="decimal" />
                      </label>
                    )
                  ))}
                </div>
                <button className="z-report-print-row__action" type="button" onClick={() => window.print()}>
                  Печатать отчет
                </button>
              </div>
            ))}
          </div>
          <div className="z-report-shift-close">
            <div>
              <strong>{closed ? "Смена закрыта" : "Смена ещё открыта"}</strong>
              <span>Закрытие смены фиксируется в интерфейсе. Фискальное закрытие требует backend OFD/кассы.</span>
            </div>
            <button type="button" disabled={closed} onClick={() => setClosed(true)}>
              <i className="bi bi-lock" />
              {closed ? "Закрыта" : "Закрыть смену"}
            </button>
          </div>
        </article>
      </section>
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import { api, formatMoney } from "../api/client";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";

function toApiDate(ddmmyyyy) {
  if (!ddmmyyyy) return undefined;
  const [d, m, y] = ddmmyyyy.split(".");
  return `${y}-${m}-${d}`;
}

const waiterColumns = [
  { key: "orders", label: "Сумма заказов", checkable: true, checked: true },
  { key: "takeaway", label: "Сумма заказов на вынос", checkable: true },
  { key: "service", label: "Сумма услуги", checkable: true },
  { key: "waiterService", label: "Обслуга официанта" },
  { key: "dishes", label: "Блюда" },
];

function cellValue(waiter, key) {
  if (key === "dishes") return `${waiter.dishes} шт`;
  return formatMoney(waiter[key], "UZS");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function WaitersReportPage() {
  const [selectedWaiter, setSelectedWaiter] = useState("all");
  const [percent, setPercent] = useState("1");
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    const start = `01.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
    const end = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
    return { preset: "", start, end };
  });
  const [waiters, setWaiters] = useState([]);

  useEffect(() => {
    const params = {};
    if (dateRange.start) params.date_from = toApiDate(dateRange.start);
    if (dateRange.end) params.date_to = toApiDate(dateRange.end);
    api.get("/reports/waiters", { params })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.waiters || [];
        setWaiters(items.map((item) => ({
            id: String(item.id || item.waiter_id || ""),
            name: item.name || item.waiter_name || "",
            orders: Number(item.orders_total || item.orders || 0),
            takeaway: Number(item.takeaway_total || item.takeaway || 0),
            service: Number(item.service_total || item.service || 0),
            waiterService: Number(item.waiter_service || item.waiterService || 0),
            dishes: Number(item.dishes_count || item.dishes || 0),
          })));
      })
      .catch(() => setWaiters([]));
  }, [dateRange.start, dateRange.end]);

  const visibleRows = useMemo(() => {
    if (!selectedWaiter) return [];
    if (selectedWaiter === "all") return waiters;
    return waiters.filter((waiter) => waiter.id === selectedWaiter);
  }, [selectedWaiter, waiters]);

  const totals = useMemo(() => visibleRows.reduce((acc, waiter) => {
    acc.orders += waiter.orders;
    acc.takeaway += waiter.takeaway;
    acc.service += waiter.service;
    acc.waiterService += waiter.waiterService;
    acc.dishes += waiter.dishes;
    return acc;
  }, { orders: 0, takeaway: 0, service: 0, waiterService: 0, dishes: 0 }), [visibleRows]);

  function handleExport() {
    const headers = ["Имя", ...waiterColumns.map((column) => column.label)];
    const rows = [
      headers,
      ...visibleRows.map((waiter) => [waiter.name, ...waiterColumns.map((column) => cellValue(waiter, column.key))]),
      ["Всего", ...waiterColumns.map((column) => (column.key === "dishes" ? `${totals.dishes} шт` : formatMoney(totals[column.key], "UZS")))],
    ];

    const htmlRows = rows.map((row, rowIndex) => {
      const tag = rowIndex === 0 ? "th" : "td";
      return `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`;
    }).join("");

    const html = `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { margin: 0 0 14px; }
    table { border-collapse: collapse; width: 100%; }
    th { background: #d8e1f1; font-weight: 700; }
    th, td { border: 1px solid #b7c4d8; padding: 10px; text-align: left; }
  </style>
</head>
<body>
  <h1>Отчет по официантам</h1>
  <p>Процент: ${escapeHtml(percent || "0")}%</p>
  <table>${htmlRows}</table>
</body>
</html>`;

    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `otchet-po-ofitsiantam-${date}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="waiters-report-page">
      <article className="waiters-report-card z-waiters-report">
        <div className="z-waiters-report__head">
          <div className="z-waiters-report__title">
            <span aria-hidden="true" />
            <strong>Отчет по официантам</strong>
          </div>
          <div className="z-waiters-report__controls">
            <div className="z-waiters-report__date-picker report-actions">
              <ReportDateRangePicker
                value={dateRange}
                onChange={setDateRange}
                buttonClassName="z-waiters-report__date"
                showDropdownIcon
              />
            </div>
            <label className="z-waiters-report__percent">
              <input value={percent} onChange={(event) => setPercent(event.target.value)} inputMode="decimal" aria-label="Процент" />
              <span>%</span>
            </label>
            <label className="z-waiters-report__select">
              <select value={selectedWaiter} onChange={(event) => setSelectedWaiter(event.target.value)}>
                <option value="" disabled>Выберите официанта</option>
                <option value="all">Все официанты</option>
                {waiters.map((waiter) => <option value={waiter.id} key={waiter.id}>{waiter.name}</option>)}
              </select>
              <Icon name="bi-chevron-down" size={18} />
            </label>
            <button className="z-waiters-report__excel" type="button" onClick={handleExport}>
              <Icon name="bi-file-earmark-excel" size={18} />
              Скачать на EXCEL
            </button>
          </div>
        </div>

        <div className="z-waiters-report__table" role="table" aria-label="Отчет по официантам">
          <div className="z-waiters-report__row z-waiters-report__row--head z-waiters-report__row--static-head" role="row">
            <div role="columnheader">Имя</div>
            {waiterColumns.map((column) => (
              <label key={column.key} role="columnheader">
                {column.checkable ? <input type="checkbox" defaultChecked={Boolean(column.checked)} /> : null}
                <span>{column.label}</span>
              </label>
            ))}
          </div>
          <div className="z-waiters-report__row z-waiters-report__row--total" role="row">
            <strong role="cell">Всего</strong>
            <strong role="cell">{formatMoney(totals.orders, "UZS")}</strong>
            <span role="cell">{formatMoney(totals.takeaway, "UZS")}</span>
            <strong role="cell">{formatMoney(totals.service, "UZS")}</strong>
            <strong role="cell">{formatMoney(totals.waiterService, "UZS")}</strong>
            <span role="cell">{totals.dishes} шт</span>
          </div>
          {visibleRows.map((waiter) => (
            <div className="z-waiters-report__row z-waiters-report__row--body" role="row" key={waiter.id}>
              <strong role="cell">{waiter.name}</strong>
              {waiterColumns.map((column) => (
                <span role="cell" key={column.key}>{cellValue(waiter, column.key)}</span>
              ))}
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

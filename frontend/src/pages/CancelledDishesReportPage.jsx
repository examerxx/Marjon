import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import Icon from "../components/Icon";
import { formatMoney } from "../api/client";

const rowsPerPage = 5;

function toInputDate(value) {
  return value;
}

function formatDateTime(date, time) {
  if (!date) return "";
  if (time) return `${date} / ${time}`;
  return date;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function currentMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` };
}

export default function CancelledDishesReportPage() {
  const [filters, setFilters] = useState(() => ({
    ...currentMonthRange(),
    waiter: "all",
    type: "all",
    query: "",
  }));
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get("/reports/cancelled", { params: { date_from: appliedFilters.from, date_to: appliedFilters.to } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        setRows(items.map((item) => ({
            id: item.id,
            date: item.date || "",
            time: item.time || "",
            orderNumber: item.order_number || item.orderNumber || 0,
            tableNumber: item.table_number || item.tableNumber || 0,
            name: item.name || item.dish_name || "",
            comment: item.comment || "-",
            waiter: item.waiter_name || item.waiter || "",
            type: item.order_type || item.type || "На стол",
            unit: item.unit || "шт",
            quantity: Number(item.quantity || 0),
            price: Number(item.price || 0),
            chef: item.station || item.chef || "",
            author: item.author_name || item.author || "",
          })));
      })
      .catch(() => setRows([]));
  }, [appliedFilters.from, appliedFilters.to]);

  const waiters = useMemo(() => Array.from(new Set(rows.map((row) => row.waiter))), [rows]);
  const types = useMemo(() => Array.from(new Set(rows.map((row) => row.type))), [rows]);

  const filteredRows = useMemo(() => {
    const query = appliedFilters.query.trim().toLowerCase();
    return rows.filter((row) => {
      const waiterMatch = appliedFilters.waiter === "all" || row.waiter === appliedFilters.waiter;
      const typeMatch = appliedFilters.type === "all" || row.type === appliedFilters.type;
      const queryMatch = !query || [row.name, row.comment, row.author, row.chef, row.waiter]
        .some((value) => String(value).toLowerCase().includes(query));
      return waiterMatch && typeMatch && queryMatch;
    });
  }, [rows, appliedFilters]);

  const totalAmount = useMemo(() => filteredRows.reduce((sum, row) => sum + row.price * row.quantity, 0), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
  const visibleRows = filteredRows.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    setAppliedFilters(filters);
    setPage(1);
  }

  function downloadExcel() {
    const headers = ["Дата", "Номер заказа", "Номер стола", "Название", "Комментария", "Официант", "Тип", "Ед.изм", "Кол-во", "Цена", "Сумма", "Повар", "Автор"];
    const rows = filteredRows.map((row) => [
      formatDateTime(row.date, row.time),
      row.orderNumber,
      row.tableNumber,
      row.name,
      row.comment,
      row.waiter,
      row.type,
      row.unit,
      row.quantity,
      formatMoney(row.price, "UZS"),
      formatMoney(row.price * row.quantity, "UZS"),
      row.chef,
      row.author,
    ]);
    const htmlRows = [headers, ...rows].map((row, rowIndex) => {
      const tag = rowIndex === 0 ? "th" : "td";
      return `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="UTF-8" /></head><body><table>${htmlRows}</table></body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `otchet-po-otmenennym-blyudam-${appliedFilters.from}-${appliedFilters.to}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="cancelled-report-page">
      <article className="cancelled-report-card">
        <div className="cancelled-report-head">
          <div className="cancelled-report-title">
            <span className="cancelled-report-title__mark" aria-hidden="true" />
            <div>
              <span className="cancelled-report-eyebrow">Marjon reports</span>
              <h2>Отчёт по отменённым блюдам ({formatMoney(totalAmount, "UZS")})</h2>
            </div>
          </div>
          <button className="cancelled-report-excel" type="button" onClick={downloadExcel}>
            <Icon name="bi-file-earmark-excel" size={18} />
            Скачать Excel
          </button>
        </div>

        <div className="cancelled-filter-panel">
          <label>
            <span>Дата с</span>
            <input type="date" value={toInputDate(filters.from)} onChange={(event) => updateFilter("from", event.target.value)} />
          </label>
          <label>
            <span>Дата по</span>
            <input type="date" value={toInputDate(filters.to)} onChange={(event) => updateFilter("to", event.target.value)} />
          </label>
          <label>
            <span>Официант</span>
            <select value={filters.waiter} onChange={(event) => updateFilter("waiter", event.target.value)}>
              <option value="all">Все официанты</option>
              {waiters.map((waiter) => <option value={waiter} key={waiter}>{waiter}</option>)}
            </select>
          </label>
          <label>
            <span>Тип</span>
            <select value={filters.type} onChange={(event) => updateFilter("type", event.target.value)}>
              <option value="all">Все типы</option>
              {types.map((type) => <option value={type} key={type}>{type}</option>)}
            </select>
          </label>
          <label className="cancelled-filter-panel__search">
            <span>Поиск</span>
            <input value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="Блюдо, повар, автор" />
          </label>
          <button className="cancelled-filter-button" type="button" onClick={applyFilters}>
            <Icon name="bi-sliders" size={18} />
            Фильтровать
          </button>
        </div>

        <div className="cancelled-table-wrap">
          <table className="cancelled-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Номер заказа</th>
                <th>Номер стола</th>
                <th>Название</th>
                <th>Комментария</th>
                <th>Официант</th>
                <th>Тип</th>
                <th>Ед.изм</th>
                <th>Кол-во</th>
                <th>Цена</th>
                <th>Сумма</th>
                <th>Повар</th>
                <th>Автор</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.date, row.time)}</td>
                  <td>{row.orderNumber}</td>
                  <td>{row.tableNumber}</td>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.comment}</td>
                  <td>{row.waiter}</td>
                  <td><span className="cancelled-type-pill">{row.type}</span></td>
                  <td>{row.unit}</td>
                  <td>{row.quantity}</td>
                  <td>{formatMoney(row.price, "UZS")}</td>
                  <td>{formatMoney(row.price * row.quantity, "UZS")}</td>
                  <td>{row.chef}</td>
                  <td>{row.author}</td>
                </tr>
              ))}
              {!visibleRows.length ? (
                <tr className="cancelled-empty-row">
                  <td colSpan="13">По выбранным фильтрам отменённых блюд нет</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="cancelled-pagination">
          <span>Показано {visibleRows.length} из {filteredRows.length}</span>
          <div>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} aria-label="Предыдущая страница">
              <Icon name="bi-chevron-left" size={18} />
            </button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((item) => (
              <button
                type="button"
                key={item}
                className={page === item ? "is-active" : ""}
                onClick={() => setPage(item)}
              >
                {item}
              </button>
            ))}
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} aria-label="Следующая страница">
              <Icon name="bi-chevron-right" size={18} />
            </button>
          </div>
        </div>
      </article>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";

const printReports = [
  { key: "cashiers", title: "Отчет по кассирам", icon: "bi-person-badge", fields: [{ type: "select", label: "Кассир", options: ["Все кассиры", "Administrator", "Кассир 1"] }] },
  { key: "waiters", title: "Отчет по официантам", icon: "bi-person-lines-fill", fields: [{ type: "select", label: "Официант", options: ["Все официанты", "Азизбек", "Алишер"] }, { type: "input", label: "Процент", suffix: "%" }] },
  { key: "cooks", title: "Отчет по поварам", icon: "bi-egg-fried", fields: [{ type: "select", label: "Повар", options: ["Все повара", "Повар 1", "Повар 2"] }] },
  { key: "places", title: "Отчет по местам", icon: "bi-grid-3x3-gap", fields: [{ type: "select", label: "Место", options: ["Все места", "Основной зал", "Летняя зона"] }] },
  { key: "menu", title: "Отчет по меню", icon: "bi-journal-text", fields: [{ type: "select", label: "Категория", options: ["Все категории", "Горячее", "Напитки", "Салаты"] }] },
];

function ReportSelect({ field }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const ref = useRef(null);
  const value = selected || field.label;

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(e) { if (!ref.current?.contains(e.target)) setOpen(false); }
    function handleKeyDown(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("mousedown", handlePointerDown); document.removeEventListener("keydown", handleKeyDown); };
  }, [open]);

  return (
    <div className={`z-report-select ${open ? "is-open" : ""}`} ref={ref}>
      <button className="z-report-select__trigger z-report-filter z-report-print-table__field" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((c) => !c)}>
        <span>{value}</span>
        <Icon name="bi-chevron-down" size={18} />
      </button>
      {open ? (
        <div className="z-report-select__menu" role="listbox">
          {field.options.map((opt) => {
            const active = opt === selected || (!selected && opt === field.options[0]);
            return <button className={active ? "is-active" : ""} type="button" role="option" aria-selected={active} key={opt} onClick={() => { setSelected(opt); setOpen(false); }}>{opt}</button>;
          })}
        </div>
      ) : null}
    </div>
  );
}

function ReportField({ field }) {
  if (!field) return <span className="z-report-print-table__empty">—</span>;
  if (field.type === "select") return <ReportSelect field={field} />;
  return (
    <label className="z-report-filter z-report-print-table__field z-report-print-table__field--input">
      <input placeholder={field.label} inputMode="decimal" />
      {field.suffix ? <span>{field.suffix}</span> : null}
    </label>
  );
}

function padDate(value) {
  return String(value).padStart(2, "0");
}

function formatRangeDate(date) {
  return `${padDate(date.getDate())}.${padDate(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function defaultReportRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);

  return {
    preset: "Этот месяц",
    start: formatRangeDate(start),
    end: formatRangeDate(now),
    startTime: "00:00",
    endTime: "00:00",
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPrintMoment(date = new Date()) {
  return `${formatRangeDate(date)}, ${padDate(date.getHours())}:${padDate(date.getMinutes())}`;
}

function buildPaymentRows() {
  return [
    ["Terminal", "0"],
    ["NAXT", "0"],
    ["CLICK", "0"],
    ["Humo", "0"],
    ["Payme", "0"],
    ["Vip", "0"],
    ["UzumBank", "0"],
    ["Долг", "0"],
  ];
}

function buildReportSection(title, rows = buildPaymentRows()) {
  return `
    <section class="print-section">
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ""}
      <div class="dash-line"></div>
      <table>
        <tbody>
          ${rows.map(([label, value]) => `
            <tr>
              <td>${escapeHtml(label)}:</td>
              <td>${escapeHtml(value)}</td>
            </tr>
          `).join("")}
          <tr class="total">
            <td>Итого:</td>
            <td>0</td>
          </tr>
        </tbody>
      </table>
    </section>
  `;
}

function buildPrintDocument(report, range) {
  const title = report?.title || "Отчет";
  const period = `${range.start || ""} ${range.startTime || "00:00"} - ${range.end || ""} ${range.endTime || "00:00"}`;

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>MARJON - ${escapeHtml(title)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #ffffff;
      color: #111827;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.35;
    }
    .sheet {
      width: 100%;
      max-width: 520px;
      margin: 0 auto;
      padding: 6px 0 0;
    }
    .topline {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: start;
      color: #111827;
      font-size: 10px;
    }
    .topline strong {
      justify-self: center;
      font-size: 10px;
      font-weight: 700;
    }
    .brand {
      margin-top: 20px;
      text-align: center;
    }
    .brand b {
      display: block;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.06em;
    }
    .brand span {
      display: block;
      margin-top: 2px;
      font-size: 10px;
      color: #4b5563;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    h1 {
      margin: 18px 0 8px;
      text-align: center;
      font-size: 15px;
      font-weight: 800;
      font-style: italic;
    }
    .period {
      margin: 0 0 14px;
      text-align: center;
      font-size: 12px;
      font-weight: 700;
    }
    .cashbox {
      margin: 0 0 2px;
      text-align: center;
      font-size: 12px;
      font-weight: 800;
    }
    .dash-line {
      height: 1px;
      margin: 4px 0 6px;
      border-top: 1px dashed #111827;
    }
    .print-section {
      margin: 0 0 7px;
    }
    .print-section h3 {
      margin: 0;
      text-align: center;
      font-size: 12px;
      font-weight: 800;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    td {
      padding: 2px 0;
      vertical-align: top;
      font-size: 12px;
      font-weight: 700;
    }
    td:first-child {
      width: 68%;
    }
    td:last-child {
      width: 32%;
      text-align: right;
    }
    tr.total td {
      padding-top: 4px;
      font-weight: 800;
    }
    .footer {
      margin-top: 16px;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
    }
    .page-foot {
      position: fixed;
      left: 14mm;
      right: 14mm;
      bottom: 7mm;
      display: flex;
      justify-content: space-between;
      color: #111827;
      font-size: 10px;
    }
  </style>
</head>
<body>
  <main class="sheet">
    <div class="topline">
      <span>${escapeHtml(formatPrintMoment())}</span>
      <strong>MARJON</strong>
      <span></span>
    </div>
    <div class="brand">
      <b>MARJON</b>
      <span>Restaurant OS</span>
    </div>
    <h1>${escapeHtml(title)}</h1>
    <p class="period">Дата: ${escapeHtml(period)}</p>
    <p class="cashbox">КАССА 2</p>
    ${buildReportSection("Итого приходов")}
    ${buildReportSection("Итого расходов")}
    ${buildReportSection("Кассир: Khusniddin Khusanboyev")}
    <div class="footer">Итого по отчету: 0</div>
  </main>
  <div class="page-foot">
    <span>MARJON</span>
    <span>1/1</span>
  </div>
</body>
</html>`;
}

export default function ZReportPage() {
  const [dateRange, setDateRange] = useState(() => defaultReportRange());

  function handlePrintReport(report) {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const printWindow = iframe.contentWindow;
    const printDocument = printWindow?.document;
    if (!printWindow || !printDocument) {
      iframe.remove();
      window.print();
      return;
    }

    printDocument.open();
    printDocument.write(buildPrintDocument(report, dateRange));
    printDocument.close();

    printWindow.onafterprint = () => iframe.remove();
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      window.setTimeout(() => iframe.remove(), 60000);
    }, 120);
  }

  return (
    <section className="z-report-page z-report-page--print-only">
      {/* Печатные отчёты */}
      <div className="z-report-period-toolbar report-actions" aria-label="Период отчетов">
        <h1 className="z-report-page-title">Z-отчёт</h1>
        <ReportDateRangePicker
          value={dateRange}
          onChange={setDateRange}
          buttonClassName="z-report-period-button"
          showDropdownIcon
        />
      </div>
      <article className="z-report-card z-report-print-panel">
        <div className="z-report-print-table-wrap">
          <table className="z-report-print-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Отчет</th>
                <th>Параметр 1</th>
                <th>Параметр 2 (опционально)</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {printReports.map((item, i) => (
                <tr key={item.key}>
                  <td className="z-report-print-table__number">{i + 1}</td>
                  <td>
                    <div className="z-report-print-table__report">
                      <span className="z-report-print-table__icon"><Icon name={item.icon} size={18} /></span>
                      <strong>{item.title}</strong>
                    </div>
                  </td>
                  <td><ReportField field={item.fields[0]} /></td>
                  <td><ReportField field={item.fields[1]} /></td>
                  <td>
                    <button className="z-report-print-row__action" type="button" onClick={() => handlePrintReport(item)}>
                      <Icon name="bi-printer" size={18} /> Печатать отчет
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

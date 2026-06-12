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

function ReportField({ field }) {
  if (!field) {
    return <span className="z-report-print-table__empty">—</span>;
  }

  if (field.type === "select") {
    return (
      <label className="z-report-filter z-report-print-table__field">
        <select defaultValue="">
          <option value="" disabled>{field.label}</option>
          {field.options.map((option) => <option value={option} key={option}>{option}</option>)}
        </select>
        <i className="bi bi-chevron-down" />
      </label>
    );
  }

  return (
    <label className="z-report-filter z-report-print-table__field">
      <input placeholder={field.label} inputMode="decimal" />
    </label>
  );
}

export default function ZReportPage() {
  return (
    <section className="z-report-page z-report-page--print-only">
      <article className="z-report-card z-report-print-panel">
        <div className="z-report-card__head">
          <div>
            <span className="eyebrow">Print center</span>
            <h3>Печатные отчеты</h3>
          </div>
          <button className="z-report-print-panel__main" type="button" onClick={() => window.print()}>
            <i className="bi bi-printer" />
            Печать отчета
          </button>
        </div>

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
              {printReports.map((reportItem, index) => (
                <tr key={reportItem.key}>
                  <td className="z-report-print-table__number">{index + 1}</td>
                  <td>
                    <div className="z-report-print-table__report">
                      <span className="z-report-print-table__icon">
                        <i className={`bi ${reportItem.icon}`} />
                      </span>
                      <strong>{reportItem.title}</strong>
                    </div>
                  </td>
                  <td>
                    <ReportField field={reportItem.fields[0]} />
                  </td>
                  <td>
                    <ReportField field={reportItem.fields[1]} />
                  </td>
                  <td>
                    <button className="z-report-print-row__action" type="button" onClick={() => window.print()}>
                      <i className="bi bi-printer" />
                      Печатать отчет
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

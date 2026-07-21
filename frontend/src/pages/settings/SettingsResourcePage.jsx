import { useEffect, useMemo, useState } from "react";
import { api, formatMoney } from "../../api/client";
import Icon from "../../components/Icon";

const STATUS_ACTIVE = "#активно";
const STATUS_INACTIVE = "#не активно";
const STATUS_PENDING = "#не подтверждено";
const STATUS_ARCHIVE = "#архив";

function SettingsResourcePage({
  title,
  addLabel = "Добавить +",
  tabs,
  columns,
  initialRows,
  formFields,
  searchable = true,
  filterOptions,
  transactionHistory = false,
  pageClassName = "",
  compactHeader = false,
  actionsLabel = "Действия",
  statementHistory = false,
  apiEndpoint,
  apiMapRow,
  apiMapFormToPayload,
}) {
  const [rows, setRows] = useState(apiEndpoint ? [] : initialRows);
  const [apiLoading, setApiLoading] = useState(!!apiEndpoint);
  const [activeTab, setActiveTab] = useState(tabs?.[0]?.key || "");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [drawerMode, setDrawerMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [historyRow, setHistoryRow] = useState(null);
  const [historyMode, setHistoryMode] = useState("detailed");

  useEffect(() => {
    if (!apiEndpoint) return;
    setApiLoading(true);
    api.get(apiEndpoint)
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        setRows(apiMapRow ? items.map(apiMapRow) : []);
      })
      .catch(() => setRows([]))
      .finally(() => setApiLoading(false));
  }, [apiEndpoint]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesTab = !tabs || row.type === activeTab;
      const matchesArchive = row.status !== STATUS_ARCHIVE;
      const matchesSearch = !query || `${row.name || ""} ${row.phone || ""}`.toLowerCase().includes(query);
      const matchesFilter = !filter || row.kind === filter || row.status === filter || row.typeLabel === filter;
      return matchesTab && matchesArchive && matchesSearch && matchesFilter;
    });
  }, [activeTab, filter, rows, search, tabs]);

  const openAdd = () => {
    const defaults = formFields.reduce((acc, field) => ({ ...acc, [field.key]: field.defaultValue || "" }), {});
    setEditingId(null);
    setForm({ ...defaults, type: activeTab || tabs?.[0]?.key || "", status: STATUS_ACTIVE });
    setDrawerMode("edit");
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({ ...row });
    setDrawerMode("edit");
  };

  const save = (event) => {
    event.preventDefault();
    const payload = apiEndpoint && apiMapFormToPayload ? apiMapFormToPayload(form) : null;

    if (apiEndpoint && payload) {
      const request = editingId
        ? api.patch(`${apiEndpoint}/${editingId}`, payload)
        : api.post(apiEndpoint, payload);

      request
        .then(({ data }) => {
          const mapped = apiMapRow ? apiMapRow(data) : data;
          setRows((current) => editingId
            ? current.map((row) => row.id === editingId ? mapped : row)
            : [mapped, ...current]);
          setDrawerMode(null);
        })
        .catch(() => {
          window.alert("Не удалось сохранить. Попробуйте позже.");
        });
      return;
    }

    const next = { ...form, id: editingId || Date.now(), type: form.type || activeTab };
    setRows((current) => editingId ? current.map((row) => row.id === editingId ? next : row) : [next, ...current]);
    setDrawerMode(null);
  };

  const archive = (row) => {
    if (apiEndpoint) {
      api.delete(`${apiEndpoint}/${row.id}`)
        .then(() => setRows((current) => current.filter((item) => item.id !== row.id)))
        .catch(() => window.alert("Не удалось удалить. Попробуйте позже."));
      return;
    }
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, status: STATUS_ARCHIVE } : item));
  };

  const renderActions = () => (
    <div className="settings-actions">
      {searchable ? <input className="settings-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" /> : null}
      {filterOptions ? (
        <select className="settings-search" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="">Все</option>
          {filterOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : null}
      <button type="button" onClick={openAdd}>{addLabel}</button>
    </div>
  );

  const renderTabs = () => (
    tabs ? (
      <div className="settings-tabs">
        {tabs.map((tab) => (
          <button key={tab.key} type="button" className={activeTab === tab.key ? "is-active" : ""} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
        ))}
      </div>
    ) : null
  );

  if (historyRow && statementHistory) {
    const statementRows = buildStatementRows(historyRow);
    const totalDebit = statementRows.reduce((sum, item) => sum + item.debit, 0);
    const totalCredit = statementRows.reduce((sum, item) => sum + item.credit, 0);

    return (
      <div className={`settings-page ${pageClassName} client-statement-page`.trim()}>
        <section className="client-statement-card">
          <header className="client-statement-toolbar">
            <div className="client-statement-left">
              <button type="button" className="client-statement-back" onClick={() => setHistoryRow(null)} aria-label="Назад">
                <Icon name="bi-chevron-left" size={18} />
              </button>
              <button type="button" className="client-statement-date">
                <Icon name="bi-calendar3" size={15} />
                Выберите дату
              </button>
              <div className="client-statement-mode" role="group" aria-label="Вид истории">
                <button
                  type="button"
                  className={historyMode === "simple" ? "is-active" : ""}
                  onClick={() => setHistoryMode("simple")}
                >
                  Простой
                </button>
                <button
                  type="button"
                  className={historyMode === "detailed" ? "is-active" : ""}
                  onClick={() => setHistoryMode("detailed")}
                >
                  Подробный
                </button>
              </div>
            </div>
            <button type="button" className="client-statement-filter">
              <span>Фильтр по контрагентам</span>
              <Icon name="bi-chevron-down" size={15} />
            </button>
          </header>

          <div className="client-statement-panel">
            <div className="client-statement-heading">
              <span>История транзакций</span>
              <h1>Акт сверки</h1>
              <p>Взаимные расчеты за период: 01.01.2026 - 31.12.2026</p>
              <strong>{historyRow.name}</strong>
            </div>

            <div className="client-statement-summary">
              <article>
                <span>Дебет</span>
                <strong>{formatMoney(totalDebit)}</strong>
              </article>
              <article>
                <span>Кредит</span>
                <strong>{formatMoney(totalCredit)}</strong>
              </article>
              <article>
                <span>Баланс</span>
                <strong>{formatMoney(totalDebit - totalCredit)}</strong>
              </article>
            </div>

            <div className="client-statement-table-wrap">
              <table className="client-statement-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Документ</th>
                    <th>Дебет</th>
                    <th>Кредит</th>
                  </tr>
                </thead>
                <tbody>
                  {statementRows.map((item) => (
                    <tr key={item.label} className={item.strong ? "is-total" : ""}>
                      <td>{item.date}</td>
                      <td>{item.label}</td>
                      <td>{item.debit ? formatMoney(item.debit) : "0"}</td>
                      <td>{item.credit ? formatMoney(item.credit) : "0"}</td>
                    </tr>
                  ))}
                  {historyMode === "detailed" ? (
                    <>
                      <tr>
                        <td>20.06.2026</td>
                        <td>Оплата по заказу</td>
                        <td>{formatMoney(80000)}</td>
                        <td>0</td>
                      </tr>
                      <tr>
                        <td>21.06.2026</td>
                        <td>Корректировка</td>
                        <td>0</td>
                        <td>{formatMoney(35000)}</td>
                      </tr>
                    </>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`settings-page ${pageClassName}`.trim()}>
      <section className="settings-card">
        {compactHeader ? (
          <header className="settings-directory-toolbar">
            {renderTabs()}
            {renderActions()}
          </header>
        ) : (
          <>
            <header className="settings-header">
              <div className="settings-title-group">
                <span className="settings-accent-bar" />
                <div>
                  <p>Настройки</p>
                  <h1>{title}</h1>
                </div>
              </div>
              {renderActions()}
            </header>

            {renderTabs()}
          </>
        )}

        <div className="settings-table-wrapper">
          <table className="settings-table">
            <thead>
              <tr>
                {columns.map((column) => <th key={column.key}>{column.label}</th>)}
                <th>{actionsLabel}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.key === "status" ? (
                        <StatusBadge status={row.status} />
                      ) : column.key === "history" && transactionHistory ? (
                        <button className="settings-history-button" type="button" onClick={() => setHistoryRow(row)}>
                          История транзакций <Icon name="bi-arrow-right" size={15} />
                        </button>
                      ) : renderCell(column, row, setForm)}
                    </td>
                  ))}
                  <td>
                    <div className="settings-row-actions">
                      {row.testPrint ? <button type="button" onClick={() => window.alert("Тест печати будет доступен в следующей версии")}>Тест печати</button> : null}
                      <button type="button" className="settings-action-edit" onClick={() => openEdit(row)}><Icon name="bi-pencil" size={15} /></button>
                      <button type="button" className="settings-action-delete" onClick={() => archive(row)}><Icon name="bi-trash3" size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {apiLoading ? <tr><td colSpan={columns.length + 1}><div className="settings-empty-state">Загрузка...</div></td></tr> : null}
              {!apiLoading && !visibleRows.length ? <tr><td colSpan={columns.length + 1}><div className="settings-empty-state">Нет данных</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {drawerMode === "edit" ? (
        <div className="settings-drawer" role="dialog" aria-modal="true">
          <div className="settings-drawer__backdrop" onClick={() => setDrawerMode(null)} />
          <form className="settings-form" onSubmit={save}>
            <header className="settings-form__header">
              <span className="settings-accent-bar" />
              <div>
                <p>{editingId ? "Редактирование" : "Новая запись"}</p>
                <h2>{title}</h2>
              </div>
              <button type="button" onClick={() => setDrawerMode(null)}><Icon name="bi-x-lg" size={20} /></button>
            </header>
            <div className="settings-form__grid">
              {formFields.map((field) => (
                <label key={field.key} className={field.type === "textarea" ? "settings-form__wide" : ""}>
                  <span>{field.label}</span>
                  {field.type === "select" ? (
                    <select value={form[field.key] || ""} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}>
                      {(field.options || []).map((option) => {
                        const value = typeof option === "object" ? option.value : option;
                        const label = typeof option === "object" ? option.label : option;
                        return <option key={value} value={value}>{label}</option>;
                      })}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea value={form[field.key] || ""} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
                  ) : (
                    <input value={form[field.key] || ""} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
                  )}
                </label>
              ))}
            </div>
            <footer className="settings-form__footer">
              <button type="button" onClick={() => setDrawerMode(null)}>Отмена</button>
              <button type="submit">Сохранить</button>
            </footer>
          </form>
        </div>
      ) : null}

      {historyRow ? (
        <div className="settings-drawer" role="dialog" aria-modal="true">
          <div className="settings-drawer__backdrop" onClick={() => setHistoryRow(null)} />
          <aside className="settings-form">
            <header className="settings-form__header">
              <span className="settings-accent-bar" />
              <div>
                <p>История</p>
                <h2>{historyRow.name}</h2>
              </div>
              <button type="button" onClick={() => setHistoryRow(null)}><Icon name="bi-x-lg" size={20} /></button>
            </header>
            <div className="settings-history-list">
              {[
                ["22.06.2026", "Приход", "120 000 UZS", "Заказ №39957057"],
                ["21.06.2026", "Расход", "35 000 UZS", "Корректировка"],
                ["20.06.2026", "Приход", "80 000 UZS", "Оплата"],
              ].map(([date, type, amount, comment]) => (
                <div key={`${date}-${comment}`}>
                  <span>{date}</span>
                  <strong>{type}</strong>
                  <b>{amount}</b>
                  <p>{comment}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function buildStatementRows(row) {
  const openingDebit = row?.openingDebit ?? (row?.id === 1 ? 56000 : 42000 + (row?.id || 1) * 7000);
  const turnoverDebit = row?.turnoverDebit ?? 0;
  const turnoverCredit = row?.turnoverCredit ?? 0;
  const closingDebit = Math.max(openingDebit + turnoverDebit - turnoverCredit, 0);
  const closingCredit = Math.max(turnoverCredit - openingDebit - turnoverDebit, 0);

  return [
    { date: "01.01.2026", label: "Сальдо начальное", debit: openingDebit, credit: 0, strong: true },
    { date: "05.07.2026", label: "Обороты за период", debit: turnoverDebit, credit: turnoverCredit },
    { date: "31.12.2026", label: "Сальдо конечное", debit: closingDebit, credit: closingCredit, strong: true },
  ];
}

function renderCell(column, row, setForm) {
  if (column.inlineSort) {
    return <input className="settings-inline-input" value={row[column.key]} onChange={(event) => setForm((current) => ({ ...current, [column.key]: event.target.value }))} readOnly />;
  }
  if (column.link) return <span className="settings-link-cell">{row[column.key]}</span>;
  return row[column.key] || "-";
}

function StatusBadge({ status }) {
  const tone = status === STATUS_ACTIVE || status === "Активно" ? "is-active" : status === STATUS_PENDING ? "is-pending" : "is-inactive";
  return <span className={`settings-status-badge ${tone}`}>{status}</span>;
}

export { STATUS_ACTIVE, STATUS_INACTIVE, STATUS_PENDING };
export default SettingsResourcePage;

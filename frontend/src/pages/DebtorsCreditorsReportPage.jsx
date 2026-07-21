import { Fragment, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import DatePicker from "../components/DatePicker";
import Icon from "../components/Icon";
import { formatMoney } from "../api/client";
import { todayInputValue } from "../utils/date";

const exchangeRate = 12650;

const tabLabels = {
  debtors: "Дебиторы",
  creditors: "Кредиторы",
};

const statusLabels = {
  active: "В работе",
  watch: "Контроль",
  overdue: "Просрочено",
};

function displayAmount(value, currency) {
  if (currency === "USD") {
    return `$${(Number(value || 0) / exchangeRate).toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return formatMoney(value, "UZS");
}

function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export default function DebtorsCreditorsReportPage() {
  const { selectedDate = todayInputValue(), setSelectedDate } = useOutletContext();
  const [activeTab, setActiveTab] = useState("debtors");
  const [currency, setCurrency] = useState("UZS");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get("/reports/debt-credit", { params: { date: selectedDate } })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || data?.parties || [];
        setRows(items.map((item) => {
          const balance = Number(item.closing_balance ?? item.closingBalance ?? item.balance ?? item.amount ?? 0);
          const amount = Math.abs(Number(item.amount ?? balance) || 0);

          return {
            id: String(item.id || ""),
            type: item.type || (balance < 0 ? "creditors" : "debtors"),
            name: item.name || item.counterparty_name || item.counterparty || "",
            category: item.category || item.kind || "",
            phone: item.phone || "",
            owner: item.owner || "",
            amount,
            dueDate: item.due_date || item.dueDate || "",
            status: item.status || "active",
            note: item.note || "",
            operations: item.operations || [],
          };
        }));
      })
      .catch(() => setRows([]));
  }, [selectedDate]);

  const totals = useMemo(() => {
    const debtors = rows.filter((party) => party.type === "debtors");
    const creditors = rows.filter((party) => party.type === "creditors");
    const debt = debtors.reduce((sum, party) => sum + party.amount, 0);
    const credit = creditors.reduce((sum, party) => sum + party.amount, 0);
    return {
      debt,
      credit,
      balance: debt - credit,
      debtorsCount: debtors.length,
      creditorsCount: creditors.length,
    };
  }, [rows]);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter((party) => party.type === activeTab)
      .filter((party) => {
        if (!needle) return true;
        return [party.name, party.category, party.phone, party.owner]
          .some((value) => value.toLowerCase().includes(needle));
      });
  }, [rows, activeTab, search]);

  const activeTotal = activeTab === "debtors" ? totals.debt : totals.credit;

  return (
    <section className="dc-report-page">
      <article className="dc-report-card">
        <div className="dc-report-head">
          <div>
            <span className="dc-report-eyebrow">Marjon finance</span>
            <h2>Дебиторы и кредиторы</h2>
            <p>Сводка задолженностей по гостям, партнерам и поставщикам на выбранную дату.</p>
          </div>
          <DatePicker
            value={selectedDate}
            max={todayInputValue()}
            onChange={setSelectedDate}
          />
        </div>

        <div className="dc-summary-grid">
          <article className="dc-summary-card dc-summary-card--debt">
            <div className="dc-summary-card__top">
              <span>Дебиторская задолженность</span>
              <Icon name="bi-arrow-down-left-circle" size={22} />
            </div>
            <strong>{displayAmount(totals.debt, currency)}</strong>
            <small>Количество контрагентов: {totals.debtorsCount}</small>
          </article>
          <article className="dc-summary-card dc-summary-card--credit">
            <div className="dc-summary-card__top">
              <span>Кредиторская задолженность</span>
              <Icon name="bi-arrow-up-right-circle" size={22} />
            </div>
            <strong>{displayAmount(totals.credit, currency)}</strong>
            <small>Количество контрагентов: {totals.creditorsCount}</small>
          </article>
          <article className="dc-summary-card dc-summary-card--balance">
            <div className="dc-summary-card__top">
              <span>Сальдо</span>
              <Icon name="bi-bank" size={22} />
            </div>
            <strong>{displayAmount(totals.balance, currency)}</strong>
            <small>Разница между дебиторской и кредиторской задолженностью</small>
          </article>
        </div>

        <div className="dc-toolbar">
          <div className="dc-tabs" role="tablist" aria-label="Тип задолженности">
            {Object.entries(tabLabels).map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={activeTab === key ? "is-active" : ""}
                onClick={() => {
                  setActiveTab(key);
                  setExpandedId("");
                }}
                role="tab"
                aria-selected={activeTab === key}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="dc-toolbar__right">
            <div className="dc-currency" role="group" aria-label="Валюта">
              {["UZS", "USD"].map((item) => (
                <button
                  type="button"
                  key={item}
                  className={currency === item ? "is-active" : ""}
                  onClick={() => setCurrency(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <label className="dc-search">
              <Icon name="bi-search" size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по контрагенту"
              />
            </label>
          </div>
        </div>

        <div className="dc-table-wrap">
          <table className="dc-table">
            <thead>
              <tr>
                <th>Контрагент</th>
                <th>Категория</th>
                <th>Ответственный</th>
                <th>Срок оплаты</th>
                <th className="dc-table__amount">{activeTab === "debtors" ? "Дебет" : "Кредит"}</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              <tr className="dc-total-row">
                <td colSpan="4">Итого {activeTab === "debtors" ? "дебиторка" : "кредиторка"}</td>
                <td className="dc-table__amount">{displayAmount(activeTotal, currency)}</td>
                <td>{visibleRows.length} строк</td>
              </tr>
              {visibleRows.map((party) => {
                const expanded = expandedId === party.id;
                return (
                  <Fragment key={party.id}>
                    <tr
                      className={`dc-party-row ${expanded ? "is-expanded" : ""}`}
                      onClick={() => setExpandedId(expanded ? "" : party.id)}
                    >
                      <td>
                        <div className="dc-party">
                          <button type="button" aria-label={expanded ? "Свернуть строку" : "Раскрыть строку"}>
                            <Icon name={expanded ? "bi-dash" : "bi-plus"} size={16} />
                          </button>
                          <div>
                            <strong>{party.name}</strong>
                            <span>{party.phone}</span>
                          </div>
                        </div>
                      </td>
                      <td>{party.category}</td>
                      <td>{party.owner}</td>
                      <td>{formatDate(party.dueDate)}</td>
                      <td className="dc-table__amount">{displayAmount(party.amount, currency)}</td>
                      <td><span className={`dc-status dc-status--${party.status}`}>{statusLabels[party.status]}</span></td>
                    </tr>
                    {expanded ? (
                      <tr className="dc-detail-row">
                        <td colSpan="6">
                          <div className="dc-detail">
                            <p>{party.note}</p>
                            <div className="dc-detail__operations">
                              {party.operations.map((operation) => (
                                <div key={`${party.id}-${operation.document}`}>
                                  <span>{formatDate(operation.date)}</span>
                                  <strong>{operation.document}</strong>
                                  <em>{displayAmount(operation.amount, currency)}</em>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!visibleRows.length ? (
                <tr className="dc-empty-row">
                  <td colSpan="6">По запросу ничего не найдено</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

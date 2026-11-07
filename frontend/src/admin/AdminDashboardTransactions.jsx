import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { webDateTime, webDateTimeInput, parseWebDateTimeInput } from "../utils/webTime";

import { adminFinanceApi } from "./financeApi";

import Icon from '../components/Icon';

import { isAbortError, useLatestRequest } from "../hooks/useAsyncSafety";

import { AdminPageSizeDropdown, formatAdminMoney, getAdminFinanceLoadMessage, getPageList, keepWheelInsideScroller } from "./AdminShared";

const transactionColumnKeys = [
  "id", "uuid", "date", "orgId", "organization", "counterparty",
  "payType", "amount", "kind", "paymentFor", "comment", "actions",
];

const TRANSACTION_COLUMN_SETTINGS_STORAGE_KEY = "marjon.admin.transactions.columns.v1";

const TRANSACTION_COLUMN_SETTINGS_LAYOUT_VERSION = 5;

const defaultTransactionColumnOrder = [
  "id", "uuid", "organization", "counterparty", "date", "orgId",
  "payType", "amount", "kind", "paymentFor", "comment", "actions",
];

function normalizeTransactionColumnKeys(keys) {
  const seen = new Set();
  return (Array.isArray(keys) ? keys : []).filter((key) => {
    if (!transactionColumnKeys.includes(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeTransactionColumnSettings(settings) {
  const savedOrder = settings?.layoutVersion === TRANSACTION_COLUMN_SETTINGS_LAYOUT_VERSION
    ? normalizeTransactionColumnKeys(settings?.order)
    : [];
  const order = [
    ...savedOrder,
    ...defaultTransactionColumnOrder.filter((key) => !savedOrder.includes(key)),
    ...transactionColumnKeys.filter((key) => !savedOrder.includes(key) && !defaultTransactionColumnOrder.includes(key)),
  ];
  const visibleSource = settings?.layoutVersion === TRANSACTION_COLUMN_SETTINGS_LAYOUT_VERSION
    ? settings.visible
    : null;
  const visible = normalizeTransactionColumnKeys(visibleSource || transactionColumnKeys)
    .filter((key) => order.includes(key));

  return {
    layoutVersion: TRANSACTION_COLUMN_SETTINGS_LAYOUT_VERSION,
    order,
    visible: visible.length ? visible : [order[0]],
  };
}

function loadTransactionColumnSettings() {
  if (typeof window === "undefined") {
    return normalizeTransactionColumnSettings();
  }

  try {
    return normalizeTransactionColumnSettings(JSON.parse(window.localStorage.getItem(TRANSACTION_COLUMN_SETTINGS_STORAGE_KEY)));
  } catch {
    return normalizeTransactionColumnSettings();
  }
}

function saveTransactionColumnSettings(settings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      TRANSACTION_COLUMN_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeTransactionColumnSettings(settings)),
    );
  } catch {
    // localStorage can be unavailable in private mode; the current session still keeps the setting.
  }
}

function formatTransactionAmountParts(value) {
  const source = String(value ?? "").replace(/\u00a0/g, " ").trim();
  const currencyMatch = source.match(/\s+([A-Za-zА-Яа-я]{3,})$/);
  const currency = currencyMatch?.[1] || "UZS";
  const numberSource = currencyMatch ? source.slice(0, currencyMatch.index).trim() : source;
  const numericValue = Number(numberSource.replace(/[^\d-]/g, ""));

  if (!Number.isFinite(numericValue)) {
    return { value: numberSource || "—", currency: numberSource ? currency : "" };
  }

  return {
    value: formatAdminMoney(numericValue),
    currency,
  };
}

function transactionDateToInputValue(value) {
  return webDateTimeInput(value);
}

function transactionAmountToInputValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Math.abs(numeric)) : "";
}

function transactionMutationMessage(error) {
  const detail = error?.response?.data?.detail ?? error?.detail ?? error?.message;
  return typeof detail === "string" && detail.trim() ? detail : "Не удалось обновить транзакцию.";
}

export function normalizeHqDashboardTransaction(row, index = 0) {
  const amount = Number(row.amount);
  const direction = {
    income: "Приход",
    expense: "Расход",
  }[row.direction] || "—";

  return {
    id: row.id_num ?? index + 1,
    uuid: row.id || "",
    date: webDateTime(row.date || row.created_at) || "—",
    orgId: row.organization_id || "",
    organization: row.organization_name || "",
    counterparty: row.counterparty_name || "",
    payType: row.payment_type_name || row.payment_type || "",
    amount: row.amount != null && Number.isFinite(amount) ? `${amount.toLocaleString("ru-RU")} UZS` : "—",
    kind: direction,
    paymentFor: row.payment_for || row.category_name || "",
    comment: row.comment || "",
    editable: {
      amount: row.amount,
      date: row.date || row.created_at || "",
      comment: row.comment || "",
    },
  };
}

export function TransactionsTable({ onNotify }) {
  const [rows, setRows] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSizeOptions = [10, 20, 50];
  const [pageSize, setPageSize] = useState(20);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [columnSettings, setColumnSettings] = useState(loadTransactionColumnSettings);
  const [dragColumnKey, setDragColumnKey] = useState("");
  const [dragColumnTarget, setDragColumnTarget] = useState(null);
  const [transactionEditor, setTransactionEditor] = useState(null);
  const [transactionSaving, setTransactionSaving] = useState(false);
  const [transactionError, setTransactionError] = useState("");
  const visibleColumns = columnSettings.visible;
  const beginRequest = useLatestRequest();

  useEffect(() => {
    const request = beginRequest();
    setLoadState("loading");
    adminFinanceApi.listTransactions({ size: 50 }, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        setRows(items.map(normalizeHqDashboardTransaction));
        setLoadState(items.length ? "success" : "empty");
      })
      .catch((error) => {
        if (!request.isCurrent() || isAbortError(error)) return;
        setRows([]);
        setLoadState("error");
        onNotify?.(getAdminFinanceLoadMessage(error));
      });
  }, [beginRequest, onNotify]);

  useEffect(() => { setPage(1); }, [query, pageSize]);

  useEffect(() => {
    saveTransactionColumnSettings(columnSettings);
  }, [columnSettings]);

  useEffect(() => {
    if (!transactionEditor || transactionSaving) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") setTransactionEditor(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [transactionEditor, transactionSaving]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(q));
  }, [query, rows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(startIndex, startIndex + pageSize);
  const pageList = getPageList(currentPage, totalPages);

  function goToPage(nextPage) {
    setPage(Math.min(totalPages, Math.max(1, nextPage)));
  }

  function toggleColumn(key) {
    setColumnSettings((current) => {
      const normalized = normalizeTransactionColumnSettings(current);

      if (normalized.visible.includes(key)) {
        return {
          ...normalized,
          visible: normalized.visible.length > 1
            ? normalized.visible.filter((item) => item !== key)
            : normalized.visible,
        };
      }

      return {
        ...normalized,
        visible: normalized.order.filter((item) => item === key || normalized.visible.includes(item)),
      };
    });
  }

  function moveColumn(key, direction) {
    setColumnSettings((current) => {
      const normalized = normalizeTransactionColumnSettings(current);
      const currentIndex = normalized.order.indexOf(key);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= normalized.order.length) {
        return normalized;
      }

      const nextOrder = [...normalized.order];
      [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];

      return {
        ...normalized,
        order: nextOrder,
      };
    });
  }

  function moveColumnToDrop(sourceKey, targetKey, placement = "before") {
    if (!sourceKey || !targetKey || sourceKey === targetKey) {
      return;
    }

    setColumnSettings((current) => {
      const normalized = normalizeTransactionColumnSettings(current);
      const nextOrder = normalized.order.filter((key) => key !== sourceKey);
      const targetIndex = nextOrder.indexOf(targetKey);

      if (targetIndex < 0 || !normalized.order.includes(sourceKey)) {
        return normalized;
      }

      nextOrder.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, sourceKey);

      return {
        ...normalized,
        order: nextOrder,
      };
    });
  }

  function resetColumnSettings() {
    setColumnSettings(normalizeTransactionColumnSettings());
  }

  function openTransactionEditor(row) {
    setTransactionError("");
    setTransactionEditor({
      uuid: row.uuid,
      number: row.id,
      organization: row.organization,
      amount: transactionAmountToInputValue(row.editable?.amount),
      date: transactionDateToInputValue(row.editable?.date),
      kind: row.kind,
      payType: row.payType,
      paymentFor: row.paymentFor,
      comment: row.comment,
    });
  }

  function updateTransactionEditor(key, value) {
    setTransactionEditor((current) => ({ ...current, [key]: value }));
    setTransactionError("");
  }

  async function saveTransactionEditor(event) {
    event.preventDefault();
    if (!transactionEditor || transactionSaving) return;

    const amount = Number(String(transactionEditor.amount).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTransactionError("Сумма должна быть больше нуля.");
      return;
    }
    const date = parseWebDateTimeInput(transactionEditor.date);
    if (!date) {
      setTransactionError("Укажите корректные дату и время.");
      return;
    }

    setTransactionSaving(true);
    setTransactionError("");
    try {
      const payload = {
        amount,
        date: date.toISOString(),
        comment: transactionEditor.comment.trim() || null,
      };
      const { data } = await adminFinanceApi.updateTransaction(transactionEditor.uuid, payload);
      if (!data?.id) throw new Error("Backend не вернул обновлённую транзакцию.");
      setRows((current) => current.map((row, index) => {
        if (row.uuid !== transactionEditor.uuid) return row;
        return normalizeHqDashboardTransaction({
          ...data,
          id_num: data.id_num ?? row.id,
          organization_id: data.organization_id ?? row.orgId,
          organization_name: data.organization_name ?? row.organization,
          counterparty_name: data.counterparty_name ?? row.counterparty,
          payment_type_name: data.payment_type_name ?? row.payType,
          category_name: data.category_name ?? row.paymentFor,
          direction: data.direction ?? (row.kind === "Расход" ? "expense" : row.kind === "Приход" ? "income" : null),
        }, index);
      }));
      setTransactionEditor(null);
      onNotify?.("Транзакция обновлена.");
    } catch (error) {
      const message = transactionMutationMessage(error);
      setTransactionError(message);
      onNotify?.(message);
    } finally {
      setTransactionSaving(false);
    }
  }

  const allColumns = [
    { key: "id", label: "№", width: 66 },
    { key: "uuid", label: "UUID", width: 214 },
    { key: "date", label: "Дата", width: 150 },
    { key: "orgId", label: "ID Организация", width: 120 },
    { key: "organization", label: "Организация", width: 200 },
    { key: "counterparty", label: "Контрагент", width: 200 },
    { key: "payType", label: "Тип оплаты", width: 120 },
    { key: "amount", label: "Сумма", width: 156 },
    { key: "kind", label: "Тип", width: 92 },
    { key: "paymentFor", label: "Оплата за", width: 180 },
    { key: "comment", label: "Комментария", width: 220 },
    { key: "actions", label: "", width: 58 },
  ];

  const orderedColumns = columnSettings.order
    .map((key) => allColumns.find((column) => column.key === key))
    .filter(Boolean);
  const columns = orderedColumns.filter((column) => visibleColumns.includes(column.key));
  const actionsColumnIsLast = columns.at(-1)?.key === "actions";

  function renderCell(column, row) {
    switch (column.key) {
      case "id": return <span className="admin-tx-id">{row.id}</span>;
      case "uuid": return <span className="admin-tx-uuid">{row.uuid}</span>;
      case "organization": return row.organization ? <strong className="admin-data-name">{row.organization}</strong> : "—";
      case "counterparty": return row.counterparty || "—";
      case "amount": {
        const amount = formatTransactionAmountParts(row.amount);
        return (
          <span className="admin-tx-amount">
            <span className="admin-tx-amount__value">{amount.value}</span>
            <span className="admin-tx-amount__currency">{amount.currency}</span>
          </span>
        );
      }
      case "kind": return row.kind === "—" ? "—" : <span className={`admin-data-flag ${row.kind === "Расход" ? "admin-data-flag--warning" : "admin-data-flag--success"}`}>{row.kind}</span>;
      case "comment": return row.comment ? row.comment : "—";
      case "actions": return <button type="button" className="admin-tx-edit" onClick={() => openTransactionEditor(row)} aria-label={`Редактировать транзакцию ${row.uuid}`}><Icon name="bi-pencil" size={14} /></button>;
      default: return row[column.key] || "—";
    }
  }

  const transactionEditorModal = transactionEditor && typeof document !== "undefined" ? createPortal(
    <div className="admin-income-modal admin-transaction-modal" role="dialog" aria-modal="true" aria-label={`Редактировать транзакцию ${transactionEditor.uuid}`} onClick={() => { if (!transactionSaving) setTransactionEditor(null); }}>
      <form className="admin-income-dialog admin-transaction-dialog" onSubmit={saveTransactionEditor} onClick={(event) => event.stopPropagation()}>
        <div className="admin-income-dialog__head admin-transaction-dialog__head">
          <div><h3>Редактировать транзакцию</h3><p>ID {transactionEditor.uuid}. Сохраняются только поля канонического контракта.</p></div>
          <button type="button" className="admin-income-dialog__close" onClick={() => setTransactionEditor(null)} disabled={transactionSaving} aria-label="Закрыть"><Icon name="bi-x-lg" size={16} /></button>
        </div>

        <div className="admin-transaction-dialog__grid">
          <label className="admin-income-field admin-transaction-field admin-transaction-field--wide">
            <span>Организация</span>
            <input value={transactionEditor.organization || "Не указана"} disabled aria-label="Организация" />
          </label>
          <label className="admin-income-field admin-transaction-field">
            <span>Сумма</span>
            <div className="admin-transaction-amount-input"><input value={transactionEditor.amount} inputMode="decimal" onChange={(event) => updateTransactionEditor("amount", event.target.value)} autoFocus aria-label="Сумма" /><strong>UZS</strong></div>
          </label>
          <label className="admin-income-field admin-transaction-field">
            <span>Дата и время</span>
            <input type="datetime-local" value={transactionEditor.date} onChange={(event) => updateTransactionEditor("date", event.target.value)} aria-label="Дата и время" />
          </label>
          <label className="admin-income-field admin-transaction-field">
            <span>Тип</span>
            <input value={transactionEditor.kind || "Не указан"} disabled aria-label="Тип" />
          </label>
          <label className="admin-income-field admin-transaction-field">
            <span>Тип оплаты</span>
            <input value={transactionEditor.payType || "Не указан"} disabled aria-label="Тип оплаты" />
          </label>
          <label className="admin-income-field admin-transaction-field admin-transaction-field--wide">
            <span>Оплата за</span>
            <input value={transactionEditor.paymentFor || "Не указано"} disabled aria-label="Оплата за" />
          </label>
          <label className="admin-income-field admin-transaction-field admin-transaction-field--wide">
            <span>Комментарий</span>
            <textarea value={transactionEditor.comment} onChange={(event) => updateTransactionEditor("comment", event.target.value)} rows={3} aria-label="Комментарий" />
          </label>
        </div>

        {transactionError ? <div className="admin-transaction-dialog__error" role="alert">{transactionError}</div> : null}
        <div className="admin-income-dialog__actions admin-transaction-dialog__actions">
          <button type="button" className="is-ghost" onClick={() => setTransactionEditor(null)} disabled={transactionSaving}>Отмена</button>
          <button type="submit" className="is-primary" disabled={transactionSaving}>{transactionSaving ? "Сохранение..." : "Сохранить"}</button>
        </div>
      </form>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <section className="admin-table-card admin-transactions">
        <div className="admin-panel-head admin-transactions__head">
          <div>
            <h2>Последние транзакции</h2>
          </div>
          <button
            className={`admin-transactions__settings ${settingsOpen ? "is-open" : ""}`}
            type="button"
            onClick={() => setSettingsOpen((value) => !value)}
            aria-expanded={settingsOpen}
          >
            <Icon name="bi-sliders" size={15} />
            <span>Настроить таблицу</span>
          </button>
          <label className="admin-data-search admin-transactions__search">
            <Icon name="bi-search" size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" />
          </label>
        </div>

      {settingsOpen ? (
        <div className="admin-data-column-panel admin-transactions__column-panel">
          <div className="admin-transactions__column-panel-head">
            <span>Столбцы</span>
            <button type="button" onClick={resetColumnSettings}>Сброс</button>
          </div>
          <div className="admin-transactions__column-list">
            {orderedColumns.map((column, index) => {
              const checked = visibleColumns.includes(column.key);
              const disabled = checked && visibleColumns.length === 1;
              const label = column.label || "Действия";
              const dropPosition = dragColumnTarget?.key === column.key ? dragColumnTarget.position : "";

              return (
                <div
                  className={`admin-transactions__column-item ${disabled ? "is-disabled" : ""} ${dragColumnKey === column.key ? "is-dragging" : ""} ${dropPosition ? `is-drop-${dropPosition}` : ""}`}
                  key={column.key}
                  draggable
                  onDragStart={(event) => {
                    setDragColumnKey(column.key);
                    setDragColumnTarget(null);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", column.key);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const sourceKey = event.dataTransfer.getData("text/plain") || dragColumnKey;

                    if (!sourceKey || sourceKey === column.key) {
                      setDragColumnTarget(null);
                      return;
                    }

                    const rect = event.currentTarget.getBoundingClientRect();
                    const position = event.clientX - rect.left > rect.width / 2 ? "after" : "before";
                    setDragColumnTarget((current) => (
                      current?.key === column.key && current?.position === position
                        ? current
                        : { key: column.key, position }
                    ));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    moveColumnToDrop(
                      event.dataTransfer.getData("text/plain") || dragColumnKey,
                      column.key,
                      dragColumnTarget?.key === column.key ? dragColumnTarget.position : "before",
                    );
                    setDragColumnKey("");
                    setDragColumnTarget(null);
                  }}
                  onDragEnd={() => {
                    setDragColumnKey("");
                    setDragColumnTarget(null);
                  }}
                >
                  <label className="admin-transactions__column-toggle">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleColumn(column.key)}
                    />
                    <span>{label}</span>
                  </label>
                  <div className="admin-transactions__column-move" aria-label={`Порядок столбца ${label}`}>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveColumn(column.key, -1)}
                      aria-label={`Переместить ${label} левее`}
                    >
                      <Icon name="bi-chevron-left" size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={index === orderedColumns.length - 1}
                      onClick={() => moveColumn(column.key, 1)}
                      aria-label={`Переместить ${label} правее`}
                    >
                      <Icon name="bi-chevron-right" size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="admin-data-table-shell admin-transactions__table-shell" onWheelCapture={keepWheelInsideScroller}>
        <table className={`admin-data-table admin-transactions__table ${actionsColumnIsLast ? "is-actions-sticky" : ""}`}>
          <colgroup>
            {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
          </colgroup>
          <thead>
            <tr>{columns.map((column) => (
              <th className={`admin-transactions__cell admin-transactions__cell--${column.key}`} key={column.key}>
                {column.key === "actions" ? (
                  <span className="admin-transactions__actions-head" aria-hidden="true">
                    <Icon name="bi-sliders" size={15} />
                  </span>
                ) : column.label}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.uuid || row.id}>
                {columns.map((column) => (
                  <td className={`admin-transactions__cell admin-transactions__cell--${column.key}`} key={column.key}>{renderCell(column, row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" ? <div className="admin-data-state" role="status">Загрузка транзакций...</div> : null}
        {loadState === "error" ? <div className="admin-data-state" role="alert">Не удалось загрузить транзакции.</div> : null}
        {loadState === "empty" || (loadState === "success" && !pageRows.length) ? <div className="admin-data-state">Транзакции не найдены.</div> : null}
      </div>

      <div className="admin-data-footer admin-transactions__footer">
        <span className="admin-data-footer__summary">
          {filteredRows.length ? `${startIndex + 1}-${Math.min(startIndex + pageSize, filteredRows.length)} из ${filteredRows.length}` : "0 из 0"}
          <small>Страница {currentPage} из {totalPages}</small>
        </span>
        <div className="admin-data-pager admin-transactions__pager">
          <AdminPageSizeDropdown value={pageSize} options={pageSizeOptions} onChange={setPageSize} />
          <button type="button" disabled={currentPage === 1} onClick={() => goToPage(1)} aria-label="Первая страница">
            <span className="admin-data-double-icon" aria-hidden="true">
              <Icon name="bi-chevron-left" size={13} />
              <Icon name="bi-chevron-left" size={13} />
            </span>
          </button>
          <button type="button" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)} aria-label="Предыдущая страница">
            <Icon name="bi-chevron-left" size={15} />
          </button>
          {pageList.map((item, index) => (
            item === "…" ? (
              <span className="admin-data-ellipsis" key={`gap-${index}`}>…</span>
            ) : (
              <button
                type="button"
                key={item}
                className={`admin-data-page-btn ${item === currentPage ? "is-active" : ""}`}
                onClick={() => goToPage(item)}
                aria-current={item === currentPage ? "page" : undefined}
              >
                {item}
              </button>
            )
          ))}
          <button type="button" disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)} aria-label="Следующая страница">
            <Icon name="bi-chevron-right" size={15} />
          </button>
          <button type="button" disabled={currentPage === totalPages} onClick={() => goToPage(totalPages)} aria-label="Последняя страница">
            <span className="admin-data-double-icon" aria-hidden="true">
              <Icon name="bi-chevron-right" size={13} />
              <Icon name="bi-chevron-right" size={13} />
            </span>
          </button>
        </div>
      </div>
      </section>
      {transactionEditorModal}
    </>
  );
}

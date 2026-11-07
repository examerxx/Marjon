import { useEffect, useMemo, useState } from "react";

import Icon from '../components/Icon';

import { createPortal } from "react-dom";

import { formatCurrency } from "./AdminShared";

export function StorageIncomePage() {
  return (
    <section className="admin-storage-income-page">
      <div className="admin-data-state" role="status">
        Данные прихода недоступны до завершения Inventory Core. Backend contract не подключён.
      </div>
    </section>
  );
}

export function StorageIncomeJournalPage() {
  return (
    <section className="admin-storage-income-page admin-storage-income-journal-page">
      <div className="admin-data-state" role="status">
        Журнал прихода недоступен до завершения Inventory Core. Backend contract не подключён.
      </div>
    </section>
  );
}

export function StorageWriteoffPage({ search, onNotify }) {
  const [rows] = useState([]);
  const [loadState] = useState("unsupported");
  const [sortState, setSortState] = useState({ key: "number", direction: "desc" });
  const query = search.trim().toLowerCase();
  const columns = [
    { key: "number", label: "Номер", sortable: true },
    { key: "supplier", label: "Поставщик", sortable: false },
    { key: "warehouse", label: "На склад", sortable: false },
    { key: "incomingDate", label: "Дата поступление", sortable: true },
    { key: "registeredAt", label: "Дата регистрации", sortable: false },
    { key: "acceptedAt", label: "Дата приема", sortable: false },
    { key: "itemCount", label: "Кол-во наименование", sortable: true },
    { key: "total", label: "Итоговая сумма", sortable: true },
    { key: "status", label: "Статус", sortable: true },
  ];

  const filteredRows = useMemo(() => {
    const nextRows = rows.filter((row) => {
      if (!query) return true;
      return [
        row.number,
        row.supplier,
        row.warehouse,
        row.incomingDate,
        row.registeredAt,
        row.acceptedAt,
        row.itemCount,
        row.total,
        row.status,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });

    const direction = sortState.direction === "asc" ? 1 : -1;
    return [...nextRows].sort((a, b) => {
      const first = getStorageWriteoffSortValue(a, sortState.key);
      const second = getStorageWriteoffSortValue(b, sortState.key);
      if (first > second) return direction;
      if (first < second) return -direction;
      return 0;
    });
  }, [query, rows, sortState]);

  function getStorageWriteoffSortValue(row, key) {
    if (key === "total" || key === "itemCount") return Number(row[key] || 0);
    return String(row[key] || "").toLowerCase();
  }

  function changeSort(column) {
    if (!column.sortable) return;
    setSortState((current) => (
      current.key === column.key
        ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key: column.key, direction: "asc" }
    ));
  }

  function openRow(row) {
    onNotify?.(`Отход товаров №${row.number}: подробная карточка будет подключена к API.`);
  }

  return (
    <section className="admin-storage-income-page admin-storage-writeoff-page">
      {loadState === "loading" ? <div className="admin-data-state" role="status">Загрузка списаний...</div> : null}
      {loadState === "error" ? <div className="admin-data-state" role="alert">Не удалось загрузить списания.</div> : null}
      {loadState === "unsupported" ? <div className="admin-data-state" role="status">Документы списания недоступны до подключения подтверждённого HQ backend contract.</div> : null}
      <div className="admin-storage-writeoff-card">
        <div className="admin-storage-writeoff-head">
          <div className="admin-storage-writeoff-title">
            <span aria-hidden="true" />
            <h2>Отход товаров</h2>
          </div>
        </div>

        <div className="admin-storage-writeoff-table-wrap">
          <table className="admin-storage-writeoff-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key}>
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => changeSort(column)}
                        className={sortState.key === column.key ? "is-active" : ""}
                      >
                        <span>{column.label}</span>
                        <span className={`admin-storage-income-journal-sort ${sortState.key === column.key ? `is-${sortState.direction}` : ""}`} aria-hidden="true" />
                      </button>
                    ) : column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} onClick={() => openRow(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openRow(row); }}>
                  <td>{row.number}</td>
                  <td>{row.supplier}</td>
                  <td>{row.warehouse}</td>
                  <td>{row.incomingDate}</td>
                  <td>{row.registeredAt}</td>
                  <td>{row.acceptedAt}</td>
                  <td>{row.itemCount}</td>
                  <td>{formatCurrency(row.total)}</td>
                  <td><span className="admin-storage-income-journal-status">{row.status}</span></td>
                </tr>
              ))}
              {(loadState === "empty" || loadState === "success") && !filteredRows.length ? (
                <tr className="admin-storage-writeoff-empty-row">
                  <td colSpan={columns.length}>
                    <div className="admin-storage-writeoff-empty">
                      <div className="admin-storage-writeoff-empty-illustration" aria-hidden="true">
                        <svg viewBox="0 0 80 86" focusable="false">
                          <rect x="8" y="22" width="44" height="56" rx="7" />
                          <rect x="16" y="14" width="44" height="56" rx="7" />
                          <path d="M28 6h31l13 13v39a7 7 0 0 1-7 7H28a7 7 0 0 1-7-7V13a7 7 0 0 1 7-7Z" />
                          <path className="admin-storage-writeoff-empty-fold" d="M59 6v13h13" />
                        </svg>
                      </div>
                      <strong>Список пуст</strong>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function StorageInventoryPage({ search, onNotify, onInnerBackChange }) {
  const [rows] = useState([]);
  const [loadState] = useState("unsupported");
  const [selectedRow, setSelectedRow] = useState(null);
  const [sortState, setSortState] = useState({ key: "id", direction: "desc" });
  const query = search.trim().toLowerCase();
  const columns = [
    { key: "id", label: "ID", sortable: true },
    { key: "registeredAt", label: "Дата регистрации", sortable: true },
    { key: "warehouse", label: "Склад", sortable: false },
    { key: "comment", label: "Комментарие", sortable: false },
    { key: "type", label: "Тип", sortable: false },
    { key: "status", label: "Статус", sortable: true },
    { key: "actions", label: "", sortable: false },
  ];

  useEffect(() => {
    if (!onInnerBackChange) return undefined;

    if (!selectedRow) {
      onInnerBackChange(null);
      return undefined;
    }

    onInnerBackChange(() => setSelectedRow(null));
    return () => onInnerBackChange(null);
  }, [onInnerBackChange, selectedRow]);

  useEffect(() => {
    if (!selectedRow) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") setSelectedRow(null);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedRow]);

  const filteredRows = useMemo(() => {
    const nextRows = rows.filter((row) => {
      if (!query) return true;
      return [
        row.id,
        row.registeredAt,
        row.registeredBy,
        row.warehouse,
        row.comment,
        row.type,
        row.status,
        ...row.items.map((item) => item.name),
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });

    const direction = sortState.direction === "asc" ? 1 : -1;
    return [...nextRows].sort((a, b) => {
      const first = getStorageInventorySortValue(a, sortState.key);
      const second = getStorageInventorySortValue(b, sortState.key);
      if (first > second) return direction;
      if (first < second) return -direction;
      return 0;
    });
  }, [query, rows, sortState]);

  function getStorageInventorySortValue(row, key) {
    if (key === "id") return Number(row.id) || row.id;
    return String(row[key] || "").toLowerCase();
  }

  function changeSort(column) {
    if (!column.sortable) return;
    setSortState((current) => (
      current.key === column.key
        ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key: column.key, direction: "asc" }
    ));
  }

  function openInventory(row) {
    setSelectedRow(row);
    onNotify?.(`Инвентаризация ${row.id}: открыт список товаров.`);
  }

  function downloadInventory(row) {
    const csv = [
      ["Название", "Кол-во", "Ед. изм"],
      ...row.items.map((item) => [item.name, item.quantity, item.unit]),
    ].map((csvRow) => csvRow.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `marjon-inventory-${row.id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    onNotify?.(`Инвентаризация ${row.id}: список скачан.`);
  }

  return (
    <section className="admin-storage-income-page admin-storage-inventory-page">
      {loadState === "loading" ? <div className="admin-data-state" role="status">Загрузка складов...</div> : null}
      {loadState === "error" ? <div className="admin-data-state" role="alert">Не удалось загрузить склады.</div> : null}
      {loadState === "unsupported" ? <div className="admin-data-state" role="status">Инвентаризация недоступна до подключения подтверждённого HQ backend contract.</div> : null}
      <div className="admin-storage-inventory-card">
        <div className="admin-storage-inventory-head">
          <div className="admin-storage-inventory-title">
            <span aria-hidden="true" />
            <h2>Инвентаризация</h2>
          </div>
          <button
            type="button"
            className="admin-storage-inventory-create"
            disabled
            title="Создание недоступно: HQ backend contract не подключён."
          >
            <span>Создать</span>
            <Icon name="bi-plus" size={15} />
          </button>
        </div>

        <div className="admin-storage-inventory-table-wrap">
          <table className="admin-storage-inventory-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key}>
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => changeSort(column)}
                        className={sortState.key === column.key ? "is-active" : ""}
                      >
                        <span>{column.label}</span>
                        <span className={`admin-storage-income-journal-sort ${sortState.key === column.key ? `is-${sortState.direction}` : ""}`} aria-hidden="true" />
                      </button>
                    ) : column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} onClick={() => openInventory(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openInventory(row); }}>
                  <td>{row.id}</td>
                  <td>
                    <span className="admin-storage-inventory-date-cell">
                      <span>{row.registeredAt}</span>
                      {row.registeredBy ? <small>{row.registeredBy}</small> : null}
                    </span>
                  </td>
                  <td>{row.warehouse}</td>
                  <td>{row.comment}</td>
                  <td>{row.type}</td>
                  <td><span className="admin-storage-income-journal-status">{row.status}</span></td>
                  <td>
                    <button
                      type="button"
                      className="admin-storage-inventory-edit"
                      onClick={(event) => { event.stopPropagation(); openInventory(row); }}
                      aria-label={`Открыть инвентаризацию ${row.id}`}
                    >
                      <Icon name="bi-pencil" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {(loadState === "empty" || loadState === "success") && !filteredRows.length ? (
                <tr className="admin-storage-inventory-empty-row">
                  <td colSpan={columns.length}>Инвентаризации не найдены.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRow ? createPortal((
        <div className="admin-storage-inventory-modal" role="presentation" onMouseDown={() => setSelectedRow(null)}>
          <div
            className="admin-storage-inventory-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Список инвентаризации ${selectedRow.id}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="admin-storage-inventory-dialog-head">
              <h3>Список</h3>
              <button type="button" onClick={() => setSelectedRow(null)} aria-label="Закрыть список">
                <Icon name="bi-x-lg" size={17} />
              </button>
            </div>

            <div className="admin-storage-inventory-dialog-body">
              <div className="admin-storage-inventory-dialog-actions">
                <button type="button" onClick={() => downloadInventory(selectedRow)}>
                  <Icon name="bi-file-earmark-spreadsheet" size={18} />
                  <span>Скачать</span>
                </button>
              </div>

              <table className="admin-storage-inventory-list-table">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Кол-во</th>
                    <th>Ед. изм</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRow.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td className="is-positive">{item.quantity}</td>
                      <td>{item.unit}</td>
                    </tr>
                  ))}
                  {!selectedRow.items.length ? (
                    <tr>
                      <td colSpan="3" className="admin-storage-inventory-list-empty">Список пуст</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </section>
  );
}

export function StorageExpensePage() {
  return (
    <section className="admin-storage-income-page admin-storage-expense-page">
      <div className="admin-data-state" role="status">
        Данные расхода недоступны до завершения Inventory Core. Backend contract не подключён.
      </div>
    </section>
  );
}

export function StorageBalancePage() {
  return (
    <section className="admin-storage-income-page admin-storage-balance-page">
      <div className="admin-data-state" role="status">
        Остатки недоступны до завершения Inventory Core. Backend contract не подключён.
      </div>
    </section>
  );
}

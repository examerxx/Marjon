import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, formatMoney, formatNumber } from "../api/client";

const warehouses = ["Главный склад", "BAR", "KUXNYA"];

const demoStock = [
  { id: "stock-main", name: "Главный склад", raw: 7313452.36, semi: 25100, sale: 0, status: "active" },
  { id: "stock-bar", name: "BAR", raw: 59000, semi: 251000, sale: 0, status: "active" },
  { id: "stock-kitchen", name: "KUXNYA", raw: 0, semi: 0, sale: 0, status: "active" },
];

const demoIncoming = [
  { id: 66996, supplier: "-", warehouse: "-", date: "30.04.2026", registered: "30.04.2026 / 16:35", accepted: "-", count: 0, total: 0, status: "draft" },
  { id: 65159, supplier: "BOZOR", warehouse: "Главный склад", date: "23.04.2026", registered: "23.04.2026 / 15:32", accepted: "23.04.2026 / 15:34", count: 2, total: 6150000, status: "accepted" },
  { id: 64358, supplier: "BOZOR", warehouse: "Главный склад", date: "20.04.2026", registered: "20.04.2026 / 11:43", accepted: "20.04.2026 / 11:44", count: 3, total: 1275000, status: "accepted" },
  { id: 58794, supplier: "-", warehouse: "-", date: "28.03.2026", registered: "28.03.2026 / 17:49", accepted: "-", count: 3, total: 672500, status: "draft" },
  { id: 51023, supplier: "BOZOR", warehouse: "Главный склад", date: "02.03.2026", registered: "02.03.2026 / 10:59", accepted: "02.03.2026 / 11:00", count: 1, total: 175000, status: "accepted" },
];

const demoTransfers = [
  { date: "20.04.2026", from: "Главный склад", to: "BAR", quantity: 30, created: "20.04.2026 / 11:46", status: "accepted" },
  { date: "10.09.2025", from: "Главный склад", to: "Главный склад", quantity: 0, created: "10.09.2025 / 14:03", status: "draft" },
];

const demoInventory = [
  { id: 4282, date: "23.12.2025 / 15:09", warehouse: "Главный склад", comment: "-", type: "Приход и расход учтены", status: "accepted" },
  { id: 4281, date: "23.12.2025 / 15:07", warehouse: "Главный склад", comment: "-", type: "Приход и расход учтены", status: "accepted" },
  { id: 2330, date: "21.08.2025 / 16:42", warehouse: "Главный склад", comment: "-", type: "Приход и расход не учтены", status: "accepted", warning: true },
  { id: 2329, date: "21.08.2025 / 16:35", warehouse: "Главный склад", comment: "-", type: "Приход и расход не учтены", status: "accepted", warning: true },
];

const demoWriteOffs = [
  { id: 14, date: "10.06.2026 / 18:01", category: "Fcvbb", count: 1, status: "accepted" },
];

function rowTotal(row) {
  return Number(row.raw || 0) + Number(row.semi || 0) + Number(row.sale || 0);
}

function statusLabel(status) {
  return status === "accepted" || status === "active" ? "Принято" : "Черновой";
}

function normalizeStockItem(item, ingredientById) {
  const ingredient = ingredientById.get(item.ingredient_id);
  const name = item.name || ingredient?.name || "Складская позиция";
  const quantity = Number(item.quantity || 0);
  const cost = Number(item.cost_price || 0);
  return {
    id: item.id || item.ingredient_id || name,
    name,
    raw: quantity * cost,
    semi: 0,
    sale: 0,
    status: quantity <= Number(item.min_quantity || 0) ? "draft" : "active",
  };
}

function WarehouseStatus({ status, warning = false }) {
  return (
    <span className={`warehouse-status ${status === "draft" ? "is-draft" : "is-accepted"} ${warning ? "is-warning" : ""}`}>
      {statusLabel(status)}
    </span>
  );
}

function IconButton({ icon, tone = "blue", label }) {
  return (
    <button type="button" className={`warehouse-icon-button warehouse-icon-button--${tone}`} aria-label={label}>
      <i className={`bi ${icon}`} />
    </button>
  );
}

function MoneyCell({ value, muted = false }) {
  return <span className={muted ? "is-muted" : ""}>{formatMoney(value)}</span>;
}

function SummaryTable({ title, rows }) {
  const totals = rows.reduce(
    (acc, row) => ({
      raw: acc.raw + Number(row.raw || 0),
      semi: acc.semi + Number(row.semi || 0),
      sale: acc.sale + Number(row.sale || 0),
    }),
    { raw: 0, semi: 0, sale: 0 },
  );

  return (
    <article className="warehouse-board">
      <div className="warehouse-title-mark" />
      <h3>{title}</h3>
      <div className="warehouse-money-table">
        <div className="warehouse-money-table__head">
          <span>№</span>
          <span>Название</span>
          <span>Сырьё</span>
          <span>Полуфабрикат</span>
          <span>Реализация</span>
          <span>Сумма</span>
        </div>
        <div className="warehouse-money-table__row is-total">
          <span />
          <strong>Итого</strong>
          <MoneyCell value={totals.raw} />
          <MoneyCell value={totals.semi} />
          <MoneyCell value={totals.sale} />
          <MoneyCell value={totals.raw + totals.semi + totals.sale} />
        </div>
        {rows.map((row, index) => (
          <div className="warehouse-money-table__row" key={row.id}>
            <span>{index + 1}</span>
            <Link to="/warehouse/balance">{row.name}</Link>
            <MoneyCell value={row.raw} muted={!row.raw} />
            <MoneyCell value={row.semi} muted={!row.semi} />
            <MoneyCell value={row.sale} muted={!row.sale} />
            <MoneyCell value={rowTotal(row)} muted={!rowTotal(row)} />
          </div>
        ))}
      </div>
    </article>
  );
}

function IncomingTable({ rows }) {
  return (
    <article className="warehouse-board">
      <div className="warehouse-board__head">
        <div>
          <div className="warehouse-title-mark" />
          <h3>Поступление товаров</h3>
        </div>
        <button type="button" className="warehouse-create">Создать <i className="bi bi-plus" /></button>
      </div>
      <div className="warehouse-search-line">
        <label>
          <input placeholder="Поиск" />
          <i className="bi bi-search" />
        </label>
      </div>
      <div className="warehouse-document-table warehouse-document-table--incoming">
        <div className="warehouse-document-table__head">
          <span>Номер</span>
          <span>Поставщик</span>
          <span>На склад</span>
          <span>Дата поступление</span>
          <span>Дата регистрации</span>
          <span>Дата приема</span>
          <span>Кол-во наименование</span>
          <span>Итоговая сумма</span>
          <span>Действия</span>
        </div>
        {rows.map((row) => (
          <div className="warehouse-document-table__row" key={row.id}>
            <strong>{row.id}</strong>
            <span>{row.supplier}</span>
            <span>{row.warehouse}</span>
            <span>{row.date}</span>
            <span>{row.registered}<small>SARDOR AVTO T</small></span>
            <span>{row.accepted}</span>
            <span>{formatNumber(row.count)}</span>
            <MoneyCell value={row.total} muted={!row.total} />
            <div className="warehouse-row-actions">
              <WarehouseStatus status={row.status} />
              <IconButton icon="bi-eye-fill" label="Открыть" />
              {row.status === "draft" ? <IconButton icon="bi-trash3" tone="red" label="Удалить" /> : null}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function TransferTable({ rows }) {
  return (
    <article className="warehouse-board">
      <div className="warehouse-board__head">
        <div>
          <div className="warehouse-title-mark" />
          <h3>Перемещение товаров</h3>
        </div>
        <button type="button" className="warehouse-create">Создать <i className="bi bi-plus" /></button>
      </div>
      <div className="warehouse-document-table warehouse-document-table--transfer">
        <div className="warehouse-document-table__head">
          <span>Дата перемещения</span>
          <span>Со склада</span>
          <span>На склад</span>
          <span>Количество</span>
          <span>Дата создания</span>
          <span>Действия</span>
        </div>
        {rows.map((row) => (
          <div className="warehouse-document-table__row" key={`${row.date}-${row.to}`}>
            <span>{row.date}</span>
            <span>{row.from}</span>
            <span>{row.to}</span>
            <strong>{formatNumber(row.quantity)}</strong>
            <span>{row.created}</span>
            <div className="warehouse-row-actions">
              <WarehouseStatus status={row.status} />
              <IconButton icon="bi-trash3" tone="red" label="Удалить" />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function InventoryTable({ rows }) {
  return (
    <article className="warehouse-board">
      <div className="warehouse-board__head">
        <div>
          <div className="warehouse-title-mark" />
          <h3>Инвентаризация</h3>
        </div>
        <button type="button" className="warehouse-create">Создать <i className="bi bi-plus" /></button>
      </div>
      <div className="warehouse-search-line">
        <label>
          <input placeholder="Поиск" />
          <i className="bi bi-search" />
        </label>
      </div>
      <div className="warehouse-document-table warehouse-document-table--inventory">
        <div className="warehouse-document-table__head">
          <span>ID</span>
          <span>Дата регистрации</span>
          <span>Склад</span>
          <span>Комментарие</span>
          <span>Тип</span>
          <span>Действия</span>
        </div>
        {rows.map((row) => (
          <div className="warehouse-document-table__row" key={row.id}>
            <strong>{row.id}</strong>
            <span>{row.date}<small>SARDOR AVTO T</small></span>
            <span>{row.warehouse}</span>
            <span>{row.comment}</span>
            <span className={row.warning ? "is-warning-text" : ""}>{row.type}</span>
            <div className="warehouse-row-actions">
              <WarehouseStatus status={row.status} />
              <IconButton icon="bi-pencil" tone="yellow" label="Редактировать" />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function WriteOffTable({ rows }) {
  return (
    <article className="warehouse-board">
      <div className="warehouse-board__head">
        <div>
          <div className="warehouse-title-mark" />
          <h3>Списание</h3>
        </div>
        <button type="button" className="warehouse-create">Создать <i className="bi bi-plus" /></button>
      </div>
      <div className="warehouse-document-table warehouse-document-table--writeoff">
        <div className="warehouse-document-table__head">
          <span>ID</span>
          <span>Дата регистрации</span>
          <span>Категория</span>
          <span>Кол-во позиций</span>
          <span>Действия</span>
        </div>
        {rows.map((row) => (
          <div className="warehouse-document-table__row" key={row.id}>
            <strong>{row.id}</strong>
            <span>{row.date}<small>SARDOR AVTO T</small></span>
            <span>{row.category}</span>
            <strong>{formatNumber(row.count)}</strong>
            <div className="warehouse-row-actions">
              <WarehouseStatus status={row.status} />
              <IconButton icon="bi-pencil" tone="yellow" label="Редактировать" />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

const sectionByPath = {
  "/warehouse": "summary",
  "/warehouse/stock-in": "incoming",
  "/warehouse/stock-out": "expense",
  "/warehouse/balance": "balance",
  "/warehouse/income-log": "incoming-log",
  "/warehouse/transfer": "transfer",
  "/warehouse/inventory": "inventory",
  "/warehouse/waste": "waste",
  "/warehouse/write-off": "write-off",
  "/warehouse/write-off-categories": "write-off",
};

export default function WarehousePage({ initialSection }) {
  const location = useLocation();
  const [activeSection, setActiveSection] = useState(initialSection || sectionByPath[location.pathname] || "summary");
  const [stockRows, setStockRows] = useState(demoStock);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setActiveSection(initialSection || sectionByPath[location.pathname] || "summary");
  }, [initialSection, location.pathname]);

  useEffect(() => {
    let mounted = true;

    async function loadWarehouse() {
      try {
        setLoading(true);
        setError("");
        const [stockResponse, ingredientsResponse] = await Promise.all([
          api.get("/inventory/stock"),
          api.get("/inventory/ingredients").catch(() => ({ data: [] })),
        ]);
        if (!mounted) return;

        const ingredientById = new Map((ingredientsResponse.data || []).map((item) => [item.id, item]));
        const normalized = (stockResponse.data || []).map((item) => normalizeStockItem(item, ingredientById));
        setStockRows(normalized.length ? normalized : demoStock);
      } catch (err) {
        if (!mounted) return;
        setError("API склада временно недоступен. Показан рабочий демо-вид.");
        setStockRows(demoStock);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadWarehouse();
    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(() => {
    const total = stockRows.reduce((sum, row) => sum + rowTotal(row), 0);
    const acceptedIncoming = demoIncoming.filter((row) => row.status === "accepted").length;
    return {
      total,
      warehouses: warehouses.length,
      incoming: acceptedIncoming,
      draft: demoIncoming.length - acceptedIncoming,
    };
  }, [stockRows]);

  return (
    <section className="warehouse-workspace">
      <div className="warehouse-workspace__toolbar">
        <button type="button" className="warehouse-date-button">
          <i className="bi bi-chevron-left" />
          Выберите дату
          <i className="bi bi-chevron-right" />
        </button>
        <div className="warehouse-toolbar__right">
          <label className="warehouse-global-search">
            <input placeholder="Поиск по складу" />
            <i className="bi bi-search" />
          </label>
          <button type="button" className="warehouse-filter">
            <i className="bi bi-sliders" />
            Фильтровать
          </button>
        </div>
      </div>

      {error ? (
        <div className="warehouse-alert">
          <i className="bi bi-exclamation-triangle" />
          {error}
        </div>
      ) : null}

      <div className="warehouse-workspace__layout">
        <div className="warehouse-workspace__content">
          <div className="warehouse-metrics">
            <article>
              <span>Стоимость остатков</span>
              <strong>{formatMoney(stats.total)}</strong>
            </article>
            <article>
              <span>Складов</span>
              <strong>{formatNumber(stats.warehouses)}</strong>
            </article>
            <article>
              <span>Принятых приходов</span>
              <strong>{formatNumber(stats.incoming)}</strong>
            </article>
            <article>
              <span>Черновиков</span>
              <strong>{formatNumber(stats.draft)}</strong>
            </article>
          </div>

          {activeSection === "summary" ? (
            <>
              <SummaryTable title="Приход" rows={stockRows} />
              <SummaryTable title="Инвентаризация" rows={stockRows} />
            </>
          ) : null}

          {activeSection === "incoming" || activeSection === "incoming-log" ? <IncomingTable rows={demoIncoming} /> : null}
          {activeSection === "expense" ? <SummaryTable title="Расходы" rows={stockRows.map((row) => ({ ...row, raw: 0, semi: row.semi * 0.4, sale: 0 }))} /> : null}
          {activeSection === "balance" ? <SummaryTable title="Остаток" rows={stockRows} /> : null}
          {activeSection === "transfer" ? <TransferTable rows={demoTransfers} /> : null}
          {activeSection === "inventory" ? <InventoryTable rows={demoInventory} /> : null}
          {activeSection === "write-off" ? <WriteOffTable rows={demoWriteOffs} /> : null}
          {activeSection === "waste" ? <IncomingTable rows={demoIncoming.slice(1, 2).map((row) => ({ ...row, id: 64358, supplier: "BOZOR", count: 3 }))} /> : null}
        </div>
      </div>
    </section>
  );
}

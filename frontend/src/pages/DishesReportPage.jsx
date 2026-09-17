import { useEffect, useMemo, useState } from "react";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { toApiDate } from "./reports/reportPeriod";

const initialFilters = {
  query: "",
  authorId: "all",
  productId: "all",
  orderType: "all",
  orderStatus: "all",
  categoryId: "all",
  paymentMethod: "all",
};

const filterNames = {
  query: "Поиск",
  authorId: "Официант",
  productId: "Продукт",
  orderType: "Тип заказа",
  orderStatus: "Статус заказа",
  categoryId: "Категория",
  paymentMethod: "Тип оплаты",
};

const emptyFilterOptions = {
  authors: [],
  cooks: [],
  products: [],
  categories: [],
  order_types: [],
  order_statuses: [],
  payment_methods: [],
  cook_filter_supported: false,
};

const filterOptionGroups = {
  authorId: "authors",
  productId: "products",
  orderType: "order_types",
  orderStatus: "order_statuses",
  categoryId: "categories",
  paymentMethod: "payment_methods",
};

function optionLabel(key, value, options) {
  if (key === "query") return value;
  const group = options[filterOptionGroups[key]] || [];
  return group.find((option) => option.value === value)?.label || value;
}

function FilterSelect({ label, placeholder, value, options, onChange, disabled = false }) {
  return (
    <label className="report-filter-select">
      <select aria-label={label} value={value} onChange={onChange} disabled={disabled}>
        <option value="all">{placeholder}</option>
        {options.map((option) => (
          <option value={option.value} key={option.value}>{option.label}</option>
        ))}
      </select>
      <Icon name="bi-chevron-down" size={16} />
    </label>
  );
}

function formatReportMoney(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} UZS`;
}

function toDishesDisplayRow(item, index) {
  const quantityValue = Number(item.quantity || 0);
  const priceValue = Number(item.price || 0);
  const amountValue = Number(item.amount || 0);

  return {
    // product_id is canonical; item.id covers the pre-Phase-1 frontend
    // fallback (old backend always sent product_id).
    id: String(item.product_id || item.id || item.name || index),
    name: `${index + 1}. ${item.name || ""}`,
    // Real master unit only — never a hardcoded fallback. Cost/profit/status
    // are intentionally absent (no truthful source) and ignored when present.
    unit: item.unit || "",
    quantity: String(quantityValue),
    price: formatReportMoney(priceValue),
    amount: formatReportMoney(amountValue),
  };
}

function normalizeDishesReportResponse(data) {
  // ZERO-DOWNTIME BRIDGE (temporary, removable after the old contract retires):
  // NEW canonical { rows, totals } => backend totals authoritative, never recomputed.
  // OLD legacy [...] => transitional client totals from the returned rows only.
  // Anything else => throw contract error (never fake zero-data).
  if (Array.isArray(data)) {
    let quantity = 0;
    let amount = 0;
    for (const item of data) {
      const quantityValue = Number(item?.quantity || 0);
      const amountValue = Number(item?.amount || 0);
      if (Number.isFinite(quantityValue)) quantity += quantityValue;
      if (Number.isFinite(amountValue)) amount += amountValue;
    }
    return { rows: data.map(toDishesDisplayRow), totals: { quantity, amount } };
  }
  if (
    data &&
    typeof data === "object" &&
    Array.isArray(data.rows) &&
    data.totals &&
    typeof data.totals === "object" &&
    data.totals.quantity != null &&
    data.totals.amount != null
  ) {
    const quantity = Number(data.totals.quantity);
    const amount = Number(data.totals.amount);
    if (!Number.isFinite(quantity) || !Number.isFinite(amount)) {
      throw new Error("Invalid dishes report response");
    }
    return { rows: data.rows.map(toDishesDisplayRow), totals: { quantity, amount } };
  }
  throw new Error("Invalid dishes report response");
}

export default function DishesReportPage() {
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    const start = `01.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
    const end = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
    return { preset: "", start, end };
  });
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [filterOptions, setFilterOptions] = useState(emptyFilterOptions);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rows, setRows] = useState([]);
  // Canonical totals are backend-authoritative. The legacy bare-array branch
  // below uses a transitional local sum ONLY for rollout compatibility.
  const [totals, setTotals] = useState({ quantity: 0, amount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beginRequest = useLatestRequest();
  const beginOptionsRequest = useLatestRequest();

  useEffect(() => {
    const request = beginOptionsRequest();
    setFilterOptionsLoading(true);
    reportsService.getDishesFilters({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        setFilterOptions({ ...emptyFilterOptions, ...(data || {}) });
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setFilterOptions(emptyFilterOptions);
      })
      .finally(() => { if (request.isCurrent()) setFilterOptionsLoading(false); });
  }, [beginOptionsRequest]);

  useEffect(() => {
    const request = beginRequest();
    const dateFrom = toApiDate(dateRange.start);
    const dateTo = toApiDate(dateRange.end);
    setLoading(true);
    setError("");
    if (!isOrderedDateRange(dateFrom, dateTo)) {
      setRows([]);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false);
      return;
    }
    reportsService.listDishes(dateFrom, dateTo, { filters: appliedFilters, signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        // Phase 1 truth: cost/profit/status intentionally absent.
        // Dual-shape bridge: canonical object keeps backend totals verbatim;
        // legacy array falls back to transitional client totals.
        const normalized = normalizeDishesReportResponse(data);
        setRows(normalized.rows);
        setTotals(normalized.totals);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setError(err.response?.data?.detail || "Не удалось загрузить отчёт по блюдам.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [
    beginRequest,
    dateRange.start,
    dateRange.end,
    appliedFilters.query,
    appliedFilters.authorId,
    appliedFilters.productId,
    appliedFilters.orderType,
    appliedFilters.orderStatus,
    appliedFilters.categoryId,
    appliedFilters.paymentMethod,
  ]);

  const filteredRows = rows;
  // The "Итого" row renders totals verbatim from normalization:
  // backend-authoritative for canonical, transitional client sum for legacy.
  const totalRow = useMemo(() => ({
    name: "Итого",
    unit: "",
    quantity: String(Number(totals.quantity || 0).toLocaleString("ru-RU")),
    price: "",
    amount: formatReportMoney(totals.amount),
  }), [totals]);
  const activeFilterEntries = Object.entries(appliedFilters).filter(([, value]) => value && value !== "all");

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    setAppliedFilters(filters);
  }

  function clearFilters() {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
  }

  function downloadExcel() {
    const cols = [
      { key: "name", label: "Название" },
      { key: "unit", label: "Ед изм" },
      { key: "quantity", label: "Кол-во" },
      { key: "price", label: "Цена" },
      { key: "amount", label: "Сумма" },
    ];
    const totalExcelRow = {
      name: "Итого",
      unit: "",
      quantity: String(Number(totals.quantity || 0)),
      price: "",
      amount: formatReportMoney(totals.amount),
    };
    exportToExcel([...filteredRows, totalExcelRow], cols, "dishes-report", {
      metadata: [
        {
          label: "Период",
          value: dateRange.start === dateRange.end ? dateRange.start : `${dateRange.start} – ${dateRange.end}`,
        },
        ...activeFilterEntries.map(([key, value]) => ({
          label: filterNames[key],
          value: optionLabel(key, value, filterOptions),
        })),
      ],
    });
  }

  // No full-page loader: the shell (title/controls/table header/totals row)
  // renders immediately, even while the first request pends (see tbody).
  if (error) return <section className="dishes-report-page"><div className="login-error" role="alert">{error}</div></section>;

  return (
    <section className="dishes-report-page owner-report-view">
      <article className="report-page-card owner-report-surface">
        <div className="report-page-header owner-report-header">
          <div className="report-title-group owner-report-heading">
            <span className="report-accent-bar" aria-hidden="true" />
            <div>
              <span className="report-eyebrow owner-report-kicker">Отчёты</span>
              <h1>Отчёт по блюдам</h1>
            </div>
          </div>
          <div className="report-actions owner-report-actions">
            <ReportDateRangePicker variant="canonical" value={dateRange} onChange={setDateRange} buttonAriaLabel="Период отчёта по блюдам" />
            <button
              className="dishes-filter-toggle"
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="dishes-report-filters"
              onClick={() => setFiltersOpen((current) => !current)}
            >
              <Icon name="bi-sliders" size={17} />
              Фильтровать
            </button>
            <button className="report-excel-button owner-report-excel" type="button" onClick={downloadExcel}>
              <Icon name="bi-filetype-xlsx" size={19} strokeWidth={1.9} className="owner-report-xlsx-icon" />
              Скачать Excel
            </button>
          </div>
        </div>

        <div
          className="report-filters-grid dishes-filter-panel"
          id="dishes-report-filters"
          aria-label="Фильтры отчёта по блюдам"
          hidden={!filtersOpen}
        >
          <label className="report-filter-input">
            <Icon name="bi-search" size={17} />
            <input aria-label="Поиск по названию блюда" value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="Поиск" />
          </label>
          <FilterSelect label="Официант" placeholder="Выберите официанта" value={filters.authorId} options={filterOptions.authors} onChange={(event) => updateFilter("authorId", event.target.value)} disabled={filterOptionsLoading || !filterOptions.authors.length} />
          <FilterSelect label="Категория" placeholder="Выберите категорию" value={filters.categoryId} options={filterOptions.categories} onChange={(event) => updateFilter("categoryId", event.target.value)} disabled={filterOptionsLoading || !filterOptions.categories.length} />
          <FilterSelect label="Продукт" placeholder="Выберите продукт" value={filters.productId} options={filterOptions.products} onChange={(event) => updateFilter("productId", event.target.value)} disabled={filterOptionsLoading || !filterOptions.products.length} />
          <FilterSelect label="Тип заказа" placeholder="Выберите тип заказа" value={filters.orderType} options={filterOptions.order_types} onChange={(event) => updateFilter("orderType", event.target.value)} disabled={filterOptionsLoading || !filterOptions.order_types.length} />
          <FilterSelect label="Статус заказа" placeholder="Выберите статус заказа" value={filters.orderStatus} options={filterOptions.order_statuses} onChange={(event) => updateFilter("orderStatus", event.target.value)} disabled={filterOptionsLoading || !filterOptions.order_statuses.length} />
          <FilterSelect label="Тип оплаты" placeholder="Выберите тип оплаты" value={filters.paymentMethod} options={filterOptions.payment_methods} onChange={(event) => updateFilter("paymentMethod", event.target.value)} disabled={filterOptionsLoading || !filterOptions.payment_methods.length} />
          <div className="report-filter-buttons">
            <button type="button" className="report-filter-apply" onClick={applyFilters}>
              <Icon name="bi-sliders" size={17} />
              Фильтровать
            </button>
            <button type="button" className="report-filter-clear" onClick={clearFilters}>
              <Icon name="bi-x-circle" size={17} />
              Очистить
            </button>
          </div>
        </div>

        {activeFilterEntries.length ? (
          <div className="report-active-filters" aria-label="Активные фильтры">
            {activeFilterEntries.map(([key, value]) => (
              <span key={key}>{filterNames[key]}: {optionLabel(key, value, filterOptions)}</span>
            ))}
          </div>
        ) : null}

        <div className="report-table-wrapper owner-report-table-scroll" aria-busy={loading ? "true" : "false"}>
          <table className="report-table owner-report-table" aria-label="Отчёт по блюдам">
            <thead>
              <tr>
                <th>Название</th>
                <th>Ед изм</th>
                <th>Кол-во</th>
                <th>Цена</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              <tr className="report-total-row">
                <td>{totalRow.name}</td>
                <td>{totalRow.unit}</td>
                <td>{totalRow.quantity}</td>
                <td>{totalRow.price}</td>
                <td>{totalRow.amount}</td>
              </tr>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="report-dish-name">
                      <span className="report-dish-name__spacer" />
                      <a href="#dish" onClick={(event) => event.preventDefault()}>{row.name}</a>
                    </div>
                  </td>
                  <td>{row.unit}</td>
                  <td>{row.quantity}</td>
                  <td>{row.price}</td>
                  <td>{row.amount}</td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr className="report-empty-row" aria-hidden={loading || undefined}>
                  <td colSpan="5"><div className="owner-report-empty" role="status" style={loading ? { visibility: "hidden" } : undefined}><span className="owner-report-empty__icon"><Icon name="bi-cup-hot" size={18} /></span><div><strong>Блюд не найдено</strong><span>Измените период, поиск или статус.</span></div></div></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

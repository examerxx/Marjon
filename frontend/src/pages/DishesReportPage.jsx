import { Fragment, useEffect, useMemo, useState } from "react";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { toApiDate } from "./reports/reportPeriod";

const initialFilters = {
  query: "",
  authorId: "all",
  cookId: "all",
  productId: "all",
  orderType: "all",
  orderStatus: "all",
  categoryId: "all",
  paymentMethod: "all",
};

const filterNames = {
  query: "Поиск",
  authorId: "Официант",
  cookId: "Повар",
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
  cookId: "cooks",
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
  const [expandedRow, setExpandedRow] = useState("");
  const [rows, setRows] = useState([]);
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
        const items = Array.isArray(data) ? data : data?.items || data?.dishes || [];
        setRows(items.map((item, index) => {
          const quantityValue = Number(item.quantity || 0);
          const priceValue = Number(item.price || 0);
          const amountValue = Number(item.amount || 0);
          const costValue = Number(item.cost_price || item.cost || 0);
          const profitValue = Number(item.profit || 0);

          return {
            id: String(item.id || item.name || index),
            name: `${index + 1}. ${item.name || ""}`,
            unit: item.unit || "Порция (пр)",
            quantity: String(quantityValue),
            quantityValue,
            price: formatReportMoney(priceValue),
            priceValue,
            amount: formatReportMoney(amountValue),
            amountValue,
            cost: formatReportMoney(costValue),
            costValue,
            profit: formatReportMoney(profitValue),
            profitValue,
            status: item.status || "Завершено",
            details: item.details || undefined,
          };
        }));
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
  const totalRow = useMemo(() => {
    const sum = (key) => filteredRows.reduce((total, row) => total + Number(row[key] || 0), 0);

    return {
      name: "Итого",
      unit: "",
      quantity: String(sum("quantityValue").toLocaleString("ru-RU")),
      price: "",
      amount: formatReportMoney(sum("amountValue")),
      cost: formatReportMoney(sum("costValue")),
      profit: formatReportMoney(sum("profitValue")),
      status: "",
    };
  }, [filteredRows]);
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
    setExpandedRow("");
  }

  function downloadExcel() {
    const cols = [
      { key: "name", label: "Название" },
      { key: "unit", label: "Ед изм" },
      { key: "quantity", label: "Кол-во" },
      { key: "price", label: "Цена" },
      { key: "total", label: "Сумма" },
      { key: "cost", label: "Себестоимость" },
      { key: "profit", label: "Прибыль" },
    ];
    exportToExcel(filteredRows, cols, "dishes-report");
  }

  if (loading) return <section className="dishes-report-page"><div className="dashboard-empty" role="status">Загрузка отчёта...</div></section>;
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

        <div className="report-table-wrapper owner-report-table-scroll">
          <table className="report-table owner-report-table" aria-label="Отчёт по блюдам">
            <thead>
              <tr>
                <th>Название</th>
                <th>Ед изм</th>
                <th>Кол-во</th>
                <th>Цена</th>
                <th>Сумма</th>
                <th>Себестоимость</th>
                <th>Прибыль</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              <tr className="report-total-row">
                <td>{totalRow.name}</td>
                <td>{totalRow.unit}</td>
                <td>{totalRow.quantity}</td>
                <td>{totalRow.price}</td>
                <td>{totalRow.amount}</td>
                <td>{totalRow.cost}</td>
                <td className="report-profit-positive">{totalRow.profit}</td>
                <td>{totalRow.status}</td>
              </tr>
              {filteredRows.map((row) => {
                const expanded = expandedRow === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr>
                      <td>
                        <div className="report-dish-name">
                          {row.details ? (
                            <button type="button" onClick={() => setExpandedRow(expanded ? "" : row.id)} aria-label={expanded ? "Скрыть детали" : "Показать детали"}>
                              <Icon name={expanded ? "bi-dash" : "bi-plus"} size={15} />
                            </button>
                          ) : <span className="report-dish-name__spacer" />}
                          <a href="#dish" onClick={(event) => event.preventDefault()}>{row.name}</a>
                        </div>
                      </td>
                      <td>{row.unit}</td>
                      <td>{row.quantity}</td>
                      <td>{row.price}</td>
                      <td>{row.amount}</td>
                      <td>{row.cost}</td>
                      <td className={row.profitValue < 0 ? "report-profit-negative" : "report-profit-positive"}>{row.profit}</td>
                      <td><span className="report-status-badge">{row.status}</span></td>
                    </tr>
                    {expanded && row.details ? (
                      <tr className="report-detail-row">
                        <td colSpan="8">
                          <div className="report-detail-grid">
                            <div><span>Заказы</span><strong>{row.details.orders}</strong></div>
                            <div><span>Повар</span><strong>{row.details.chef}</strong></div>
                            <div><span>Категория</span><strong>{row.details.category}</strong></div>
                            <div><span>Тип оплаты</span><strong>{row.details.paymentType}</strong></div>
                            <div><span>Комментарий</span><strong>{row.details.comment}</strong></div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!filteredRows.length ? (
                <tr className="report-empty-row">
                  <td colSpan="8"><div className="owner-report-empty" role="status"><span className="owner-report-empty__icon"><Icon name="bi-cup-hot" size={18} /></span><div><strong>Блюд не найдено</strong><span>Измените период, поиск или статус.</span></div></div></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

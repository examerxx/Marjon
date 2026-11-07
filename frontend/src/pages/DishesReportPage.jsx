import { useEffect, useMemo, useState } from "react";
import { reportsService } from "../api/reports";
import Icon from "../components/Icon";
import { useSearchParams } from "react-router-dom";
import DishPhotoViewer from "../components/DishPhotoViewer";
import DishReportDetails from "./reports/DishReportDetails";
import "./reports/dishesReportTable.css";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import ReportEmptyState from "../components/ReportEmptyState";
import { reportCacheKey, readReportCache, writeReportCache } from "./reports/reportResultCache";
import ReportMultiSelect from "../components/ReportMultiSelect";
import { exportToExcel } from "../utils/excel";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { formatDateLabel, todayInputValue } from "../utils/date";
import { toApiDate } from "./reports/reportPeriod";

const initialFilters = {
  query: "",
  authorId: [],
  productId: [],
  orderType: [],
  orderStatus: [],
  categoryId: [],
  paymentMethod: [],
};

const filterNames = {
  query: "Поиск",
  authorId: "Автор",
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
  const values = Array.isArray(value) ? value : [value];
  return values.map((single) => group.find((option) => option.value === single)?.label || single).join(", ");
}

function isFilterActive(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(String(value ?? "").trim());
}

// DISHES-01: the Dishes UI exposes only the user-requested subsets below.
// Values stay canonical (backend enum untouched); labels are the requested
// user wording. Subsets are intersected with backend-provided options so the
// UI can never offer a value the server would reject.
const DISHES_ORDER_TYPE_OPTIONS = [
  { value: "dine_in", label: "На стол" },
  { value: "delivery", label: "Доставка" },
  { value: "takeaway", label: "С собой" },
];

const DISHES_ORDER_STATUS_OPTIONS = [
  { value: "new", label: "Новый" },
  { value: "completed", label: "Завершенный" },
];

function intersectOptions(allowed, provided) {
  const available = new Set((provided || []).map((option) => option.value));
  return allowed.filter((row) => available.has(row.value));
}

function formatReportMoney(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} UZS`;
}

function toDishesDisplayRow(item, index) {
  const quantityValue = Number(item.quantity || 0);
  const priceValue = Number(item.price || 0);
  const amountValue = Number(item.amount || 0);
  // DISHES-EXCEL cost truth: cost_total/profit are numeric ONLY when the
  // backend proved full snapshot coverage (cost_coverage_complete). When
  // coverage is incomplete the backend sends null — keep it null (never 0),
  // so the export writes a blank cell rather than a fabricated financial value.
  const covered = item.cost_coverage_complete === true;
  const costValue = covered && item.cost_total != null ? Number(item.cost_total) : null;
  const profitValue = covered && item.profit != null ? Number(item.profit) : null;

  return {
    // product_id is canonical; item.id covers the pre-Phase-1 frontend
    // fallback (old backend always sent product_id).
    id: JSON.stringify([item.product_id || item.id || "", item.name || "", item.unit || ""]),
    productId: item.product_id || item.id || null,
    photo: item.image_url || "",
    name: item.name || "",
    // Real master unit only — never a hardcoded fallback.
    unit: item.unit || "",
    quantity: String(quantityValue),
    price: formatReportMoney(priceValue),
    amount: formatReportMoney(amountValue),
    // Raw numeric snapshots for the Excel export (blank when unknown).
    quantityNum: quantityValue,
    priceNum: priceValue,
    amountNum: amountValue,
    costNum: costValue,
    profitNum: profitValue,
    // Canonical category dimension (live) for Excel grouping; null → frontend
    // presentation label "Без категории".
    categoryId: item.category_id ?? null,
    categoryName: item.category_name ?? null,
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
    // DISHES-EXCEL grand cost/profit: numeric only under full coverage (backend
    // sends null otherwise) — kept null here, never coerced to 0.
    const grandCovered = data.totals.cost_coverage_complete === true;
    const costTotal = grandCovered && data.totals.cost_total != null ? Number(data.totals.cost_total) : null;
    const profitTotal = grandCovered && data.totals.profit != null ? Number(data.totals.profit) : null;
    return {
      rows: data.rows.map(toDishesDisplayRow),
      totals: { quantity, amount, costTotal, profitTotal, coverageComplete: grandCovered },
    };
  }
  throw new Error("Invalid dishes report response");
}

function ReportDishPhoto({ row, onOpen }) {
  const [failed, setFailed] = useState(false);
  if (!row.photo || failed) return <span className="dish-report-photo" aria-label="Нет фото"><Icon name="bi-image" size={16} /></span>;
  return <button type="button" className="dish-report-photo" aria-label={`Открыть фото ${row.name}`} onClick={event => { event.stopPropagation(); onOpen(); }}><img src={row.photo} alt="" loading="lazy" onError={() => setFailed(true)} /></button>;
}

export default function DishesReportPage() {
  // DISHES-01: Dishes opens on today only, same semantics as Orders
  // (local calendar day, single-date label, preset "Сегодня").
  const [dateRange, setDateRange] = useState(() => {
    const today = formatDateLabel(todayInputValue());
    return { preset: "Сегодня", start: today, end: today };
  });
  const [filters, setFilters] = useState(initialFilters);
  // Живой фильтр: черновика больше нет — запрос уходит сразу от `filters`.
  // Поиск по названию дебаунсится, чтобы не слать запрос на каждую букву.
  const [debouncedQuery, setDebouncedQuery] = useState(initialFilters.query);
  const [filterOptions, setFilterOptions] = useState(emptyFilterOptions);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Shared open-panel orchestration (Orders parity): at most one floating
  // panel (period popover or filter dropdown) is open at a time; `pending`
  // hands off when another panel is requested mid-exit, and an outside click
  // during exit cancels the handoff so no invisible overlay can stick around.
  const [panelState, setPanelState] = useState({ active: "", closing: "", pending: "" });
  const [rows, setRows] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [photo, setPhoto] = useState(null);
  const [quantitySort, setQuantitySort] = useState("");
  // Canonical totals are backend-authoritative. The legacy bare-array branch
  // below uses a transitional local sum ONLY for rollout compatibility.
  const [totals, setTotals] = useState({ quantity: 0, amount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beginRequest = useLatestRequest();
  const beginOptionsRequest = useLatestRequest();

  useEffect(() => {
    if (!panelState.closing) return undefined;
    function cancelPendingOnOutsideClick(event) {
      if (!event.target.closest?.(".orders-filter-select, .report-period-picker")) {
        setPanelState((current) => ({ ...current, pending: "" }));
      }
    }
    document.addEventListener("mousedown", cancelPendingOnOutsideClick);
    return () => document.removeEventListener("mousedown", cancelPendingOnOutsideClick);
  }, [panelState.closing]);

  useEffect(() => {
    const request = beginOptionsRequest();
    setFilterOptionsLoading(true);
    reportsService.getDishesFilters({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        // DISHES-01: order type/status expose only the requested user subsets
        // (intersected with backend options so no unserviceable value appears).
        setFilterOptions({
          ...emptyFilterOptions,
          ...(data || {}),
          order_types: intersectOptions(DISHES_ORDER_TYPE_OPTIONS, data?.order_types),
          order_statuses: intersectOptions(DISHES_ORDER_STATUS_OPTIONS, data?.order_statuses),
        });
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setFilterOptions(emptyFilterOptions);
      })
      .finally(() => { if (request.isCurrent()) setFilterOptionsLoading(false); });
  }, [beginOptionsRequest]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(filters.query), 400);
    return () => clearTimeout(id);
  }, [filters.query]);

  useEffect(() => {
    const request = beginRequest();
    const dateFrom = toApiDate(dateRange.start);
    const dateTo = toApiDate(dateRange.end);
    setError("");
    if (!isOrderedDateRange(dateFrom, dateTo)) {
      setRows([]);
      setError("Дата начала периода не может быть позже даты окончания.");
      setLoading(false);
      return;
    }
    const liveFilters = { ...filters, query: debouncedQuery };
    const cacheKey = reportCacheKey("dishes", { dateFrom, dateTo, filters: liveFilters });
    const cached = readReportCache(cacheKey);
    if (cached) {
      setRows(cached.rows);
      setTotals(cached.totals);
      setLoading(false);
    } else {
      setLoading(true);
    }
    reportsService.listDishes(dateFrom, dateTo, { filters: liveFilters, signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        // Phase 1 truth: cost/profit/status intentionally absent.
        // Dual-shape bridge: canonical object keeps backend totals verbatim;
        // legacy array falls back to transitional client totals.
        const normalized = normalizeDishesReportResponse(data);
        writeReportCache(cacheKey, { rows: normalized.rows, totals: normalized.totals });
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
    debouncedQuery,
    filters.authorId,
    filters.productId,
    filters.orderType,
    filters.orderStatus,
    filters.paymentMethod,
    filters.categoryId,
  ]);

  const filteredRows = rows;
  const selectedDish = rows.find(row => row.id === searchParams.get("dish"));
  const displayRows = useMemo(() => quantitySort ? [...rows].sort((a, b) => (quantitySort === "asc" ? 1 : -1) * (a.quantityNum - b.quantityNum)) : rows, [rows, quantitySort]);
  function openDish(row) {
    setSearchParams(current => { const next = new URLSearchParams(current); next.set("dish", row.id); return next; });
  }
  // The "Итого" row renders totals verbatim from normalization:
  // backend-authoritative for canonical, transitional client sum for legacy.
  const totalRow = useMemo(() => ({
    name: "Итого",
    unit: "",
    quantity: (() => {
      const units = [...new Set(rows.map(row => row.unit))];
      if (units.length <= 1) return String(Number(totals.quantity || 0).toLocaleString("ru-RU")) + (units[0] ? ` ${units[0]}` : "");
      return units.map(unit => {
        const sum = rows.filter(row => row.unit === unit).reduce((value, row) => value + Math.round(row.quantityNum * 1000), 0) / 1000;
        return `${sum.toLocaleString("ru-RU")} ${unit || "без ед. изм."}`;
      }).join(" · ");
    })(),
    price: "",
    amount: formatReportMoney(totals.amount),
  }), [totals, rows]);
  const activeFilterEntries = Object.entries({ ...filters, query: debouncedQuery }).filter(([, value]) => isFilterActive(value));

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  // Multi-select toggle: checking adds, unchecking removes; the trigger
  // re-renders at once and the live request fires immediately.
  function toggleFilterValue(key, value) {
    setFilters((current) => {
      const list = Array.isArray(current[key]) ? current[key] : [];
      const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
      return { ...current, [key]: next };
    });
  }

  function requestPanel(panelId) {
    setPanelState((current) => {
      if (current.closing) {
        const nextPending = current.pending === panelId ? "" : panelId;
        return { ...current, pending: nextPending };
      }
      if (!current.active) return panelId ? { active: panelId, closing: "", pending: "" } : current;
      return {
        active: "",
        closing: current.active,
        pending: current.active === panelId ? "" : panelId,
      };
    });
  }

  function completePanelExit(panelId) {
    setPanelState((current) => {
      if (current.closing !== panelId) return current;
      return { active: current.pending, closing: "", pending: "" };
    });
  }

  function closeFilterPanel() {
    requestPanel("");
  }

  function dishFilterPanelProps(key) {
    return {
      open: panelState.active === key,
      closing: panelState.closing === key,
      onOpen: () => requestPanel(key),
      onClose: closeFilterPanel,
      onExitComplete: () => completePanelExit(key),
    };
  }

  function clearFilters() {
    setFilters(initialFilters);
    setDebouncedQuery(initialFilters.query);
    requestPanel("");
  }

  function downloadExcel() {
    // DISHES-EXCEL-7COL: 7 business columns, no metadata block, no Статус.
    // Money/cost/profit are numeric cells (#,##0); cost/profit are BLANK (never
    // 0) wherever coverage is incomplete. Rows are grouped by canonical category
    // (live), with a per-category subtotal and a grand total. Category order is
    // the backend's row order (already category-sorted); uncategorized → the
    // presentation label "Без категории".
    const cols = [
      { key: "name", label: "Название", width: 30 },
      { key: "unit", label: "Ед изм", width: 10 },
      { key: "quantityNum", label: "Кол-во", type: "number", format: "#,##0", width: 12 },
      { key: "priceNum", label: "Цена", type: "number", format: "#,##0", width: 14 },
      { key: "amountNum", label: "Сумма", type: "number", format: "#,##0", width: 16 },
      { key: "costNum", label: "Себестоимость", type: "number", format: "#,##0", width: 18 },
      { key: "profitNum", label: "Прибыль", type: "number", format: "#,##0", width: 16 },
    ];
    const UNCATEGORIZED = "Без категории";
    // Group in the canonical row order the backend returned (category-sorted).
    const groupsMap = new Map();
    for (const row of filteredRows) {
      const key = row.categoryId ?? "__null__";
      if (!groupsMap.has(key)) {
        groupsMap.set(key, { title: row.categoryName || UNCATEGORIZED, rows: [] });
      }
      groupsMap.get(key).rows.push(row);
    }
    // Per-category subtotals: quantity/amount always; cost/profit only when
    // EVERY row in the category is covered (else blank/unknown).
    const groups = [...groupsMap.values()].map((g) => {
      const q = g.rows.reduce((s, r) => s + (Number(r.quantityNum) || 0), 0);
      const a = g.rows.reduce((s, r) => s + (Number(r.amountNum) || 0), 0);
      const allCovered = g.rows.every((r) => r.costNum != null);
      const c = allCovered ? g.rows.reduce((s, r) => s + Number(r.costNum), 0) : null;
      const p = allCovered ? g.rows.reduce((s, r) => s + Number(r.profitNum), 0) : null;
      return {
        title: g.title,
        rows: g.rows,
        totalsLabel: "Итого по категории",
        totals: { quantityNum: q, amountNum: a, costNum: c, profitNum: p },
      };
    });
    exportToExcel([], cols, "dishes-report", {
      sheetName: "Отчёт по блюдам",
      groups,
      grandTotal: {
        label: "Общий итог",
        values: {
          quantityNum: Number(totals.quantity || 0),
          amountNum: Number(totals.amount || 0),
          // Grand cost/profit stay blank unless the whole report is covered.
          costNum: totals.coverageComplete ? Number(totals.costTotal) : null,
          profitNum: totals.coverageComplete ? Number(totals.profitTotal) : null,
        },
      },
    });
  }

  if (selectedDish) return <DishReportDetails key={selectedDish.id} dish={selectedDish} dateFrom={toApiDate(dateRange.start)} dateTo={toApiDate(dateRange.end)} filters={filters} />;

  // No full-page loader: the shell (title/controls/table header)
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
            <ReportDateRangePicker variant="canonical" animateExit value={dateRange} onChange={setDateRange} open={panelState.active === "period"} onOpenChange={(nextOpen) => requestPanel(nextOpen ? "period" : "")} onExitComplete={() => completePanelExit("period")} buttonAriaLabel="Период отчёта по блюдам" />
            <button
              className="dishes-filter-toggle"
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="dishes-report-filters"
              onClick={() => {
                if (filtersOpen) requestPanel("");
                setFiltersOpen((current) => !current);
              }}
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

        <div className={`orders-filter-collapse${filtersOpen ? " is-open" : ""}`}>
          <div className="orders-filter-collapse__inner" inert={!filtersOpen ? true : undefined}>
        <div
          className="report-filters-grid dishes-filter-panel"
          id="dishes-report-filters"
          aria-label="Фильтры отчёта по блюдам"
        >
          <label className="report-filter-input">
            <Icon name="bi-search" size={17} />
            <input aria-label="Поиск по названию блюда" value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="Поиск" />
          </label>
          <ReportMultiSelect filterKey="authorId" label="Автор" placeholder="Выберите автора" options={filterOptions.authors} selected={filters.authorId} onToggle={(value) => toggleFilterValue("authorId", value)} disabled={filterOptionsLoading || !filterOptions.authors.length} {...dishFilterPanelProps("authorId")} />
          <div className="dishes-filter-wide">
          <ReportMultiSelect filterKey="categoryId" label="Категория" placeholder="Выберите категорию" options={filterOptions.categories} selected={filters.categoryId} onToggle={(value) => toggleFilterValue("categoryId", value)} disabled={filterOptionsLoading || !filterOptions.categories.length} {...dishFilterPanelProps("categoryId")} />
          </div>
          <ReportMultiSelect filterKey="productId" label="Продукт" placeholder="Выберите продукт" options={filterOptions.products} selected={filters.productId} onToggle={(value) => toggleFilterValue("productId", value)} disabled={filterOptionsLoading || !filterOptions.products.length} {...dishFilterPanelProps("productId")} />
          <ReportMultiSelect filterKey="orderType" label="Тип заказа" placeholder="Выберите тип заказа" options={filterOptions.order_types} selected={filters.orderType} onToggle={(value) => toggleFilterValue("orderType", value)} disabled={filterOptionsLoading || !filterOptions.order_types.length} {...dishFilterPanelProps("orderType")} />
          <ReportMultiSelect filterKey="orderStatus" label="Статус заказа" placeholder="Выберите статус заказа" options={filterOptions.order_statuses} selected={filters.orderStatus} onToggle={(value) => toggleFilterValue("orderStatus", value)} disabled={filterOptionsLoading || !filterOptions.order_statuses.length} {...dishFilterPanelProps("orderStatus")} />
          <ReportMultiSelect filterKey="paymentMethod" label="Тип оплаты" placeholder="Выберите тип оплаты" options={filterOptions.payment_methods} selected={filters.paymentMethod} onToggle={(value) => toggleFilterValue("paymentMethod", value)} disabled={filterOptionsLoading || !filterOptions.payment_methods.length} {...dishFilterPanelProps("paymentMethod")} />
          <div className="report-filter-buttons">
            <button type="button" className="report-filter-clear" onClick={clearFilters}>
              <Icon name="bi-x-circle" size={17} />
              Очистить
            </button>
          </div>
        </div>
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
          <table className="report-table owner-report-table dishes-sales-table" aria-label="Отчёт по блюдам">
            <thead><tr><th>№</th><th>Фото</th><th>Блюдо / товар</th><th>Ед. изм.</th>
              <th aria-sort={quantitySort === "asc" ? "ascending" : quantitySort === "desc" ? "descending" : "none"}><button type="button" className="dish-report-quantity-sort" aria-label="Сортировать по количеству" onClick={() => setQuantitySort(current => current === "desc" ? "asc" : "desc")}>Кол-во<Icon name="bi-chevron-expand" size={12} /></button></th>
              <th title="Сумма продаж, делённая на количество в выбранном периоде.">Цена позиции</th><th>Сумма продаж</th></tr></thead>
            <tbody>{displayRows.map((row, index) => <tr key={row.id} tabIndex={0} aria-label={`Детали блюда ${row.name}`} onClick={() => openDish(row)} onKeyDown={event => {
              if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); openDish(row); }
            }}>
              <td>{index + 1}</td>
              <td><ReportDishPhoto row={row} onOpen={() => setPhoto(row)} /></td>
              <td className="dish-report-name">{row.name}</td><td>{row.unit}</td><td>{row.quantity}</td><td>{row.price}</td><td>{row.amount}</td>
            </tr>)}
            {!filteredRows.length ? <tr className="report-empty-row"><td colSpan={7}><ReportEmptyState title="Блюд не найдено" loading={loading} /></td></tr> : null}</tbody>
            {filteredRows.length ? <tfoot><tr className="report-total-row"><td colSpan={4}>Итого</td><td>{totalRow.quantity}</td><td>—</td><td>{totalRow.amount}</td></tr></tfoot> : null}
          </table>
        </div>
      </article>
      {photo ? <DishPhotoViewer photo={photo.photo} name={photo.name} onClose={() => setPhoto(null)} /> : null}
    </section>
  );
}

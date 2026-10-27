import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { reportsService, analyticsService } from "../api/reports";
import Icon from "../components/Icon";
import Toast from "../components/Toast";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import ReportMultiSelect from "../components/ReportMultiSelect";
import ReportEmptyState from "../components/ReportEmptyState";
import DishPhotoViewer from "../components/DishPhotoViewer";
import { isAbortError, isOrderedDateRange, useLatestRequest } from "../hooks/useAsyncSafety";
import { formatDateLabel, todayInputValue } from "../utils/date";
import { toApiDate } from "./reports/reportPeriod";
import { t } from "../i18n/t";

const columns = [
  { key: "index", label: "№", width: 56 },
  { key: "photo", label: "Фото", width: 72 },
  { key: "dish", label: "Блюдо / товар", width: 230 },
  { key: "category", label: "Категория", width: 178 },
  { key: "sold", label: "Продано", width: 116 },
  { key: "price", label: "Средняя цена", width: 160 },
  { key: "revenue", label: "Выручка", width: 150 },
  { key: "share", label: "Доля", width: 158 },
];
const allColumns = Object.fromEntries(columns.map(({ key }) => [key, true]));
const emptyFilters = { query: "", categoryId: [] };
const reportNumber = (value) => {
  if (value == null || (typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" || !Number.isFinite(Number(value))) {
    throw new Error("Некорректный ответ отчёта о продажах.");
  }
  return Number(value);
};
const numberLabel = (value) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const moneyLabel = (value) => `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} UZS`;

function SalePhoto({ photo, name, onOpen }) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) return <span className="sales-photo" aria-label={t("pages.menupage.net_foto")}><Icon name="bi-image" /></span>;
  return <button type="button" className="sales-photo" aria-label={t("pages.menupage.open_photo", { name })} aria-haspopup="dialog" onClick={onOpen}>
    <img src={photo} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  </button>;
}

// Same authoritative paid-order snapshot as OwnerDashboard, never table totals
// or Finance operations. Missing historical costs remain unavailable, not zero.
export function mapDashboardSalesKpis(data) {
  if (data?.metric_basis !== "completed_income_minus_snapshot_cogs") throw new Error("Некорректный ответ отчёта о продажах.");
  const orders = reportNumber(data.today_orders);
  if (!Number.isInteger(orders) || orders < 0) throw new Error("Некорректный ответ отчёта о продажах.");
  return { income: reportNumber(data.income_total), paidRevenue: data.today_revenue == null ? null : reportNumber(data.today_revenue),
    paidOrders: orders, profitUnavailableReason: data.profit_unavailable_reason || "Не сохранена историческая себестоимость блюд." };
}

// Strict canonical {rows, totals}: no orders/master-price/legacy-array fallback.
// Only numbering/formatting and amount/totals.amount share are computed here.
export function mapSalesReport(data) {
  if (!data || !Array.isArray(data.rows) || !data.totals) throw new Error("Некорректный ответ отчёта о продажах.");
  const amount = reportNumber(data.totals.amount);
  const quantity = reportNumber(data.totals.quantity);
  const ordersCount = reportNumber(data.totals.orders_count);
  if (!Number.isInteger(ordersCount) || ordersCount < 0) throw new Error("Некорректный ответ отчёта о продажах.");
  const rows = data.rows.map((item, index) => {
    if (!item || !item.product_id || typeof item.name !== "string") throw new Error("Некорректный ответ отчёта о продажах.");
    const revenue = reportNumber(item.amount);
    return {
      key: `${item.product_id}:${item.name}:${index}`,
      productId: String(item.product_id),
      dish: item.name,
      photo: typeof item.image_url === "string" ? item.image_url : "",
      categoryId: item.category_id ?? null,
      category: item.category_name ?? t("pages.menupage.no_category"),
      sold: reportNumber(item.quantity),
      avgPrice: reportNumber(item.price),
      revenue,
      share: amount === 0 ? 0 : Math.round((revenue / amount) * 100),
    };
  });
  return { rows, amount, quantity, ordersCount, positions: new Set(rows.map((row) => row.productId)).size };
}

export default function MenuPage() {
  // Same calendar default/API conversion as Reports → Dishes. Date bounds stay
  // backend-owned; no company-timezone or clock reinterpretation on this page.
  const [period, setPeriod] = useState(() => {
    const today = formatDateLabel(todayInputValue());
    return { preset: "Сегодня", start: today, end: today };
  });
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [categories, setCategories] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryClosing, setCategoryClosing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const closePhotoPreview = useCallback(() => setPhotoPreview(null), []);
  const [visibleColumns, setVisibleColumns] = useState(allColumns);
  const settingsRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const beginRequest = useLatestRequest();
  const beginOptionsRequest = useLatestRequest();

  function closeCategory() {
    setCategoryOpen(false);
    if (categoryOpen) setCategoryClosing(true);
  }

  // The shared Reports dropdown remains mounted for its exit animation.
  useEffect(() => {
    if (!categoryClosing) return undefined;
    const timeout = window.setTimeout(() => setCategoryClosing(false), 250);
    return () => window.clearTimeout(timeout);
  }, [categoryClosing]);

  useEffect(() => {
    const request = beginOptionsRequest();
    reportsService.getDishesFilters({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        if (!Array.isArray(data?.categories)) throw new Error("Некорректный список категорий отчёта.");
        setCategories(data.categories);
      })
      .catch((err) => {
        if (request.isCurrent() && !isAbortError(err)) setOptionsError(t("pages.menupage.error.load_categories"));
      })
      .finally(() => { if (request.isCurrent()) setOptionsLoading(false); });
  }, [beginOptionsRequest]);

  useEffect(() => {
    const request = beginRequest();
    const dateFrom = toApiDate(period.start);
    const dateTo = toApiDate(period.end);
    setReport(null);
    setError("");
    setLoading(true);
    if (!dateFrom || !dateTo || !isOrderedDateRange(dateFrom, dateTo)) {
      setError(t("pages.menupage.error.date_order"));
      setLoading(false);
      return;
    }
    // Publish one complete period snapshot. Table filters do not alter the
    // dashboard-equivalent cards; their scope is the whole selected period.
    Promise.all([
      reportsService.listDishes(dateFrom, dateTo, { filters, signal: request.signal }),
      analyticsService.getOwnerFinancials(dateFrom, dateTo, { signal: request.signal }),
      reportsService.getCancelledSummary(dateFrom, dateTo, { signal: request.signal }),
    ])
      .then(([sales, financials, cancelled]) => {
        if (!request.isCurrent()) return;
        setReport({ ...mapSalesReport(sales.data), ...mapDashboardSalesKpis(financials.data), cancelledOrders: reportNumber(cancelled.data?.orders_count) });
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setError(typeof err.response?.data?.detail === "string" ? err.response.data.detail : t(err.message === "Некорректный ответ отчёта о продажах." ? "pages.menupage.error.invalid_sales" : "pages.menupage.error.load_sales"));
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [period, filters, beginRequest]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    function outside(event) {
      if (!settingsRef.current?.contains(event.target)) setSettingsOpen(false);
    }
    function escape(event) {
      if (event.key === "Escape") { setSettingsOpen(false); settingsTriggerRef.current?.focus(); }
    }
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [settingsOpen]);

  const visible = useMemo(() => columns.filter(({ key }) => visibleColumns[key]), [visibleColumns]);
  const tableMinWidth = Math.max(680, visible.reduce((sum, column) => sum + column.width, 0));
  function toggleColumn(key) {
    setVisibleColumns((current) => {
      if (current[key] && Object.values(current).filter(Boolean).length === 1) return current;
      return { ...current, [key]: !current[key] };
    });
  }
  function cell(row, key, index) {
    switch (key) {
      case "index": return index + 1;
      case "photo": return <SalePhoto key={row.photo} photo={row.photo} name={row.dish} onOpen={() => setPhotoPreview(row)} />;
      case "dish": return <strong>{row.dish}</strong>;
      case "category": return <span className="sales-category-pill">{t(row.category)}</span>;
      case "sold": return numberLabel(row.sold);
      case "price": return moneyLabel(row.avgPrice);
      case "revenue": return <strong>{moneyLabel(row.revenue)}</strong>;
      case "share": return <div className="sales-share"><span style={{ width: `${Math.max(0, Math.min(row.share, 100))}%` }} /><b>{row.share}%</b></div>;
      default: return null;
    }
  }

  return (
    <section className="sales-page sales-page--v2">
      <div className="sales-card settings-card">
        <header className="sales-header settings-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" aria-hidden="true" />
            <div><p>{t("pages.menupage.menyu")}</p><h1>{t("pages.menupage.prodazha")}</h1></div>
          </div>
          <div className="sales-period owner-report-view orders-report-page">
            <div className="report-actions owner-report-actions">
              <ReportDateRangePicker variant="canonical" animateExit value={period} onChange={setPeriod} buttonAriaLabel={t("report_period.sales")} onOpenChange={(open) => { if (open) { closeCategory(); setSettingsOpen(false); } }} />
              <button className="orders-filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="sales-filters" onClick={() => { if (filtersOpen) closeCategory(); setFiltersOpen((open) => !open); }}><Icon name="bi-sliders" size={17} /> {t("pages.menupage.filtrovat")}</button>
            </div>
          </div>
        </header>

        <div className="sales-summary-grid" aria-label={t("pages.menupage.itogi_otcheta")} aria-busy={loading}>
          <article className="sales-kpi sales-kpi--income" aria-label={t("pages.menupage.denezhnyy_prihod")}><div className="sales-kpi-heading"><span>{t("pages.menupage.denezhnyy_prihod")}</span></div><strong>{report ? moneyLabel(report.income) : "—"}</strong><small>{t("pages.menupage.vse_kategorii_po_date_oplaty")}</small></article>
          <article className="sales-kpi sales-kpi--revenue" aria-label={t("pages.menupage.vyruchka")} title={report?.paidRevenue == null ? t(report?.profitUnavailableReason) : undefined}><div className="sales-kpi-heading"><span>{t("pages.menupage.vyruchka")}</span></div><strong>{report ? report.paidRevenue == null ? t("common.unavailable") : moneyLabel(report.paidRevenue) : "—"}</strong><small>{t("pages.menupage.denezhnyy_prihod_sebestoimost_blyud")}</small></article>
          <article className="sales-kpi sales-kpi--orders" aria-label={t("pages.menupage.zakazy")}><div className="sales-kpi-heading"><span>{t("pages.menupage.zakazy")}</span></div><strong>{report ? numberLabel(report.paidOrders) : "—"}</strong><small>{t("pages.menupage.oplachennye_zavershennye_po_date_oplaty")}</small></article>
          <article className="sales-kpi sales-kpi--cancelled" aria-label={t("pages.menupage.otmenennye_zakazy")}><Link className="sales-kpi-cancelled-link" to={`/reports/cancelled-dishes?${new URLSearchParams({ dateFrom: toApiDate(period.start) || "", dateTo: toApiDate(period.end) || "" })}`}><div className="sales-kpi-heading"><span>{t("pages.menupage.otmenennye_zakazy")}</span></div><strong>{report ? numberLabel(report.cancelledOrders) : "—"}</strong><small title={t("pages.menupage.zakazy_s_otmenami_vklyuchaya_otdelnye_pozitsii_dlya")}>{t("pages.menupage.vse_kategorii_po_date_otmeny")}</small></Link></article>
        </div>
        {/* Orders' actual collapse/field/button classes, scoped to a filter island.
            Drafts stay mounted when closed; only this form applies them. */}
        <div className="sales-filter-area owner-report-view orders-report-page">
          <div className={`orders-filter-collapse${filtersOpen ? " is-open" : ""}`}>
            <div className="orders-filter-collapse__inner" inert={!filtersOpen ? true : undefined} aria-hidden={!filtersOpen}>
              <form id="sales-filters" className="report-filters-grid sales-filters-grid" aria-label={t("pages.menupage.filtry_prodazh")} onSubmit={(event) => { event.preventDefault(); closeCategory(); setFilters({ query: draftFilters.query.trim(), categoryId: [...draftFilters.categoryId] }); }}>
                <label className="report-filter-input"><Icon name="bi-search" size={17} /><input aria-label={t("pages.menupage.poisk_blyuda")} value={draftFilters.query} onChange={(event) => setDraftFilters((current) => ({ ...current, query: event.target.value }))} placeholder={t("pages.menupage.poisk_blyuda_i_tovara")} /></label>
                <div className="sales-category-filter">
                  <ReportMultiSelect filterKey="saleCategoryId" label={t("pages.menupage.kategoriya_prodazh")} placeholder={t("pages.menupage.vyberite_kategoriyu")} options={categories} selected={draftFilters.categoryId} disabled={optionsLoading || !categories.length} open={categoryOpen} closing={categoryClosing} onExitComplete={() => setCategoryClosing(false)} onOpen={() => { setSettingsOpen(false); setCategoryClosing(false); setCategoryOpen(true); }} onClose={closeCategory} onToggle={(id) => setDraftFilters((current) => ({ ...current, categoryId: current.categoryId.includes(id) ? current.categoryId.filter((value) => value !== id) : [...current.categoryId, id] }))} />
                </div>
                <div className="report-filter-buttons"><button className="report-filter-apply" type="submit"><Icon name="bi-sliders" size={17} />{t("pages.menupage.filtrovat")}</button><button className="report-filter-clear" type="button" onClick={() => { closeCategory(); setDraftFilters(emptyFilters); setFilters({ query: "", categoryId: [] }); }}>{t("pages.menupage.ochistit")}</button></div>
              </form>
            </div>
          </div>
        </div>
        {optionsError ? <Toast kind="error" message={optionsError} onClose={() => setOptionsError("")} /> : null}

        <div hidden className="sales-toolbar-meta sales-table-controls">
          <div className="sales-table-settings" ref={settingsRef}>
            <button type="button" ref={settingsTriggerRef} className="sales-table-settings-btn" aria-expanded={settingsOpen} onClick={() => { setCategoryOpen(false); setSettingsOpen((open) => !open); }}><Icon name="bi-sliders" />{t("pages.menupage.nastroit_tablitsu")}</button>
            {settingsOpen ? <div className="sales-table-settings-popover">
              <div className="sales-table-settings-head"><strong>{t("pages.menupage.stolbtsy")}</strong><button type="button" aria-label={t("pages.menupage.zakryt")} onClick={() => setSettingsOpen(false)}><Icon name="bi-x-lg" size={14} /></button></div>
              <div className="sales-column-toggle-list">{columns.map((column) => <label className="sales-column-toggle" key={column.key}><input type="checkbox" checked={visibleColumns[column.key]} disabled={visibleColumns[column.key] && visible.length === 1} onChange={() => toggleColumn(column.key)} /><span className="sales-column-toggle-box">{visibleColumns[column.key] ? <Icon name="bi-check" size={13} /> : null}</span><span>{t(column.label)}</span></label>)}</div>
              <button type="button" className="sales-column-reset" onClick={() => setVisibleColumns(allColumns)}>{t("pages.menupage.pokazat_vse")}</button>
            </div> : null}
          </div>
        </div>

        {error ? <div className="login-error" role="alert">{error}</div> : <div className="sales-layout">
          <div className="sales-table-wrap"><div className="sales-table-scroll" tabIndex={0} role="region" aria-label={t("pages.menupage.tablitsa_prodazh_prokrutka")} aria-busy={loading}>
            <table className="sales-table" aria-label={t("pages.menupage.prodazhi")} style={{ "--sales-grid-min-width": `${tableMinWidth}px` }}>
              <thead><tr>{visible.map((column) => <th key={column.key} className={`sales-col-${column.key}`}>{t(column.label)}</th>)}</tr></thead>
              <tbody>{loading || !report?.rows.length ? <tr><td colSpan={visible.length} className="sales-empty"><ReportEmptyState loading={loading} title={t("pages.menupage.prodazh_za_vybrannyy_period_net")} /></td></tr> : report.rows.map((row, index) => <tr key={row.key}>{visible.map(({ key }) => <td key={key} className={`sales-col-${key}`}>{cell(row, key, index)}</td>)}</tr>)}</tbody>
            </table>
          </div></div>
        </div>}
      </div>
      {photoPreview ? <DishPhotoViewer photo={photoPreview.photo} name={photoPreview.dish} onClose={closePhotoPreview} /> : null}
    </section>
  );
}

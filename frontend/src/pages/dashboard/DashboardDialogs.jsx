import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatMoney, formatNumber } from "../../api/client";
import { formatDateLabel } from "../../utils/date";
import Icon from "../../components/Icon";
import { useAnchoredDialogMotion } from "../../hooks/useAnchoredDialogMotion";
import OrderStatus from "../reports/OrderStatus";
import OrderReceiptDialog from "./OrderReceiptDialog";
import { t } from "../../i18n/t";
import "./revenueProducts.css";

// Модальные окна OWNER-дашборда: детализация KPI (с таблицей оплат/мест) и
// складской отчёт. Вынесено из OwnerDashboard.jsx (FE-07B) без изменений разметки.

function formatOrderCount(value) {
  const count = Math.round(Number(value) || 0);
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? "заказ"
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? "заказа"
      : "заказов";

  return `${formatNumber(count)} ${word}`;
}

function KpiPaymentTable({
  rows = [],
  labelColumn = "Способ оплаты",
  valueColumn = "Выручка",
  shareColumn = "Доля",
  formatValue = formatMoney,
  emptyText = "Нет оплат за выбранный день",
  showShare = true,
}) {
  const hasRows = rows.length > 0;

  return (
    <div className="kpi-payment-report">
      <div className="kpi-payment-report__table-wrap">
        <table className="kpi-payment-report__table">
          <thead>
            <tr>
              {/* t() по русскому тексту: значения по умолчанию — литералы,
                  поэтому переводим на месте отрисовки. */}
              <th>{t(labelColumn)}</th>
              <th>{t(valueColumn)}</th>
              {showShare ? <th>{t(shareColumn)}</th> : null}
            </tr>
          </thead>
          <tbody>
            {hasRows ? rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{formatValue(row.amount)}</td>
                  {showShare ? <td>
                    <div className="kpi-payment-report__share">
                      <span aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, row.percent))}%` }} /></span>
                      <strong>{row.percent}%</strong>
                    </div>
                  </td> : null}
                </tr>
              )) : (
                <tr>
                  <td className="kpi-payment-report__empty" colSpan={showShare ? 3 : 2}>{t(emptyText)}</td>
                </tr>
              )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RevenueProductsTable({ report }) {
  // Подписи — ключи, а не текст: язык может смениться, пока диалог открыт.
  const amounts = report.incomeLast
    ? [["revenue", "pages.dashboard.dashboarddialogs.chistaya_pribyl"], ["income", "pages.dashboard.dashboarddialogs.denezhnyy_prihod"]]
    : [["income", "pages.dashboard.dashboarddialogs.denezhnyy_prihod"], ["revenue", "pages.dashboard.dashboarddialogs.chistaya_pribyl"]];
  const money = (value) => value == null ? t("common.unknown") : `${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(Number(value))} UZS`;
  const quantity = (value) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(Number(value));
  const totalRow = report.rows.length > 0 && !report.unavailable ? <tr className="revenue-products__total"><th scope="row" colSpan={4}>{t("pages.dashboard.dashboarddialogs.itogo")}</th>
    {amounts.map(([key]) => <td key={key}>{money(report[key])}</td>)}</tr> : null;
  return (
    <div className="revenue-products">
      <div className="revenue-products__scroll" tabIndex={0} role="region" aria-label={t("pages.dashboard.dashboarddialogs.prodazhi_oplachennyh_blyud")}>
        <table>
          <thead><tr>
            <th scope="col">№</th><th scope="col">{t("pages.dashboard.dashboarddialogs.blyudo_tovar")}</th><th scope="col">{t("pages.dashboard.dashboarddialogs.kategoriya")}</th>
            <th scope="col">{t("pages.dashboard.dashboarddialogs.prodano")}</th>{amounts.map(([key, labelKey]) => <th key={key} scope="col">{t(labelKey)}</th>)}
          </tr>{!report.incomeLast ? totalRow : null}</thead>
          <tbody>
          {report.incomeLast ? totalRow : null}
          {report.rows.length ? report.rows.map((row, index) => (
            <tr key={row.product_id}>
              <td>{index + 1}</td><td>{row.name}</td><td><span className="revenue-products__category">{row.category}</span></td>
              <td>{quantity(row.quantity)}</td>{amounts.map(([key]) => <td key={key}>{money(row[key])}</td>)}
            </tr>
          )) : <tr><td colSpan={6} className="revenue-products__empty">{report.unavailable
            ? t("pages.dashboard.dashboarddialogs.ne_udalos_zagruzit_prodazhi") : t("pages.dashboard.dashboarddialogs.net_dannyh")}</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}

function OrdersTable({ report, onOpenOrder }) {
  const money = value => value == null ? t("common.unknown") : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value))} UZS`;
  // Строка заказа открывает чек: клик мышью и Enter/Space с клавиатуры.
  const rowProps = (row) => (onOpenOrder ? {
    className: "owner-orders-report__row",
    tabIndex: 0,
    "aria-label": `${t("pages.dashboard.dashboarddialogs.otkryt_chek_zakaza")} №${row.number || String(row.id).slice(0, 6)}`,
    onClick: () => onOpenOrder(row),
    onKeyDown: (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onOpenOrder(row);
    },
  } : {});
  const columns = [
    "pages.dashboard.dashboarddialogs.zakaza",
    "pages.dashboard.dashboarddialogs.data_i_vremya_oplaty",
    "pages.dashboard.dashboarddialogs.mesto",
    "pages.dashboard.dashboarddialogs.summa",
    "pages.dashboard.dashboarddialogs.status",
  ];
  return <div className="revenue-products owner-orders-report">
    <div className="revenue-products__scroll" tabIndex={0} role="region" aria-label={t("pages.dashboard.dashboarddialogs.tablitsa_zakazov")}>
      <table><thead><tr>{columns.map(labelKey =>
        <th key={labelKey} scope="col">{t(labelKey)}</th>)}</tr></thead>
        <tbody>
        {report.rows.length > 0 && !report.unavailable ? <tr className="revenue-products__total"><th scope="row" colSpan={3}>{t("pages.dashboard.dashboarddialogs.itogo")}</th><td>{money(report.total)}</td><td /></tr> : null}
        {report.rows.length ? report.rows.map(row => <tr key={row.id} {...rowProps(row)}>
          <td>#{row.number || row.id.slice(0, 6)}</td><td>{row.date_label}</td><td>{row.place}</td>
          <td>{money(row.amount)}</td><td><OrderStatus value={row.status} /></td>
        </tr>) : <tr><td className="revenue-products__empty" colSpan={5}>
          {report.unavailable ? t("pages.dashboard.dashboarddialogs.ne_udalos_zagruzit_zakazy") : t("pages.dashboard.dashboarddialogs.net_dannyh")}</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}

function AverageCheckTable({ report }) {
  const money = value => value == null ? t("common.unknown") : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value))} UZS`;
  const count = value => `${formatNumber(value)} ${t("pages.dashboard.dashboardcards.sht")}`;
  const columns = [
    "pages.dashboard.dashboarddialogs.mesto",
    "pages.dashboard.dashboarddialogs.oplacheno_zakazov",
    "pages.dashboard.dashboarddialogs.denezhnyy_prihod",
    "pages.dashboard.dashboarddialogs.sredniy_chek",
  ];
  return <div className="revenue-products owner-average-report">
    <div className="revenue-products__scroll" tabIndex={0} role="region" aria-label={t("pages.dashboard.dashboarddialogs.sredniy_chek_po_mestam")}>
      <table><thead><tr>{columns.map(labelKey =>
        <th key={labelKey} scope="col">{t(labelKey)}</th>)}</tr></thead>
        <tbody>
        {report.rows.length > 0 && !report.unavailable ? <tr className="revenue-products__total"><th scope="row">{t("pages.dashboard.dashboarddialogs.itogo")}</th><td>{count(report.count)}</td>
          <td>{money(report.income)}</td><td>{money(report.average)}</td></tr> : null}
        {report.rows.length ? report.rows.map(row => <tr key={row.id}>
          <td>{row.place}</td><td>{count(row.orders_count)}</td><td>{money(row.income)}</td><td>{money(row.avg_check)}</td>
        </tr>) : <tr><td className="revenue-products__empty" colSpan={4}>
          {report.unavailable ? t("pages.dashboard.dashboarddialogs.ne_udalos_zagruzit_sredniy_chek") : t("pages.dashboard.dashboarddialogs.net_dannyh")}</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}

export function KpiInfoDialog({ kpi, onClose, sourceRect, returnFocusRef }) {
  const isComingSoon = Boolean(kpi?.comingSoon);
  const hasAverageTable = Boolean(kpi?.averageReport);
  const hasOrdersTable = Boolean(kpi?.orderReport);
  const hasProductTable = Boolean(kpi?.productReport);
  const isProfitDetail = hasProductTable && kpi?.className?.split(" ").includes("premium-kpi--revenue");
  const hasCustomTable = kpi?.table && Array.isArray(kpi.table.rows);
  const hasPlaceTable = !hasCustomTable && Array.isArray(kpi?.placeRows);
  const tableRows = hasPlaceTable ? kpi.placeRows : !hasCustomTable && Array.isArray(kpi?.paymentRows) ? kpi.paymentRows : null;
  const tableProps = hasCustomTable ? kpi.table : hasPlaceTable
    ? {
      rows: tableRows,
      labelColumn: "Место",
      valueColumn: "Заказы",
      formatValue: formatOrderCount,
      emptyText: t("pages.dashboard.dashboarddialogs.net_zakazov_za_vybrannyy_den"),
    }
    : {
      rows: tableRows || [],
    };
  const hasTable = isComingSoon || hasAverageTable || hasOrdersTable || hasProductTable || hasCustomTable || Array.isArray(tableRows);

  // Чек конкретного заказа поверх таблицы: { id, number } или null.
  const [receiptOrder, setReceiptOrder] = useState(null);
  // Окно KPI закрыли — чек следующего окна не должен открываться сам.
  useEffect(() => {
    if (!kpi) setReceiptOrder(null);
  }, [kpi]);

  const {
    dialogRef,
    motionClassName,
    motionStyle,
    requestClose,
    handleAnimationEnd,
  } = useAnchoredDialogMotion({
    isOpen: Boolean(kpi),
    onClose,
    motionMode: "anchored",
    sourceRect,
    returnFocusRef,
    // Пока открыт чек, Escape закрывает чек, а не таблицу под ним.
    escapeDisabled: Boolean(receiptOrder),
  });

  if (!kpi) return null;
  const valueSuffix = kpi.dialogSuffix ?? kpi.suffix;
  const valueNode = !isComingSoon ? <div className="kpi-info-window__value">
    <strong>{kpi.value}</strong>
    {valueSuffix ? <small>{valueSuffix}</small> : null}
  </div> : null;

  // Portal to <body> so the backdrop is a top-level fixed layer above the whole
  // shell (sidebar + topbar + main); inside .dashboard-main its stacking context
  // trapped the dim below the sidebar, leaving it undimmed.
  const container = document.body;

  return createPortal(
    <>
    <div
      className={`kpi-info-backdrop owner-modal-backdrop ${isProfitDetail ? "kpi-info-backdrop--profit-detail" : ""} ${motionClassName}`}
      style={motionStyle}
      role="presentation"
      onMouseDown={requestClose}
      onAnimationEnd={handleAnimationEnd}
    >
      <section
        ref={dialogRef}
        className={`kpi-info-window ${kpi.className} ${hasTable ? "kpi-info-window--payment-table" : ""} ${isComingSoon || hasProductTable || hasOrdersTable || hasAverageTable ? "kpi-info-window--revenue-products" : ""} ${isProfitDetail ? "kpi-info-window--profit-detail" : ""} ${isComingSoon ? "kpi-info-window--coming-soon" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-info-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={`kpi-info-window__head ${hasTable ? "kpi-info-window__head--payment-table" : ""}`}>
          {hasTable ? null : <div className="kpi-info-window__icon"><Icon name={kpi.icon} size={20} /></div>}
          <div className={isProfitDetail ? "kpi-info-window__profit-title" : undefined}>
            <span>{kpi.badge}</span>
            <h2 id="kpi-info-title">{kpi.label}</h2>
          </div>
          {isProfitDetail ? valueNode : null}
          <button type="button" className="kpi-info-window__close" aria-label={t("pages.dashboard.dashboarddialogs.zakryt")} onClick={requestClose}>
            <Icon name="bi-x-lg" size={20} />
          </button>
        </div>

        {!isProfitDetail ? valueNode : null}
        {!isComingSoon && ((!hasProductTable && !kpi.hideDescription) || (hasProductTable && (kpi.productReport.unavailable || kpi.productReport.revenue == null)))
          ? <p>{kpi.description}</p> : null}

        {isComingSoon ? <div className="kpi-coming-soon" role="status">{t("pages.dashboard.dashboarddialogs.skoro_eta_kategoriya_v_razrabotke")}</div> : hasAverageTable ? <AverageCheckTable report={kpi.averageReport} /> : hasOrdersTable ? <OrdersTable report={kpi.orderReport} onOpenOrder={(row) => setReceiptOrder({ id: row.id, number: row.number })} /> : hasProductTable ? <RevenueProductsTable report={kpi.productReport} /> : hasTable ? (
          <KpiPaymentTable {...tableProps} />
        ) : (
          <div className="kpi-info-window__details">
            {kpi.details.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        )}

        {hasTable ? null : (
          <div className="kpi-info-window__insight">
            <Icon name="bi-info-circle" size={20} />
            <span>{kpi.insight}</span>
          </div>
        )}
      </section>
    </div>
    {/* Монтируем только по клику: диалог читает профиль компании (useOrg),
        а таблица заказов должна работать и без него. Уход анимируется
        внутри самого диалога — он живёт до конца анимации. */}
    {receiptOrder ? (
      <OrderReceiptDialog
        orderId={receiptOrder.id}
        orderNumber={receiptOrder.number}
        onClose={() => setReceiptOrder(null)}
      />
    ) : null}
    </>,
    container
  );
}

export function WarehouseReportDialog({ report, selectedDate, onClose }) {
  useEffect(() => {
    if (!report) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [report, onClose]);

  const rows = useMemo(() => report?.rows || [], [report]);

  if (!report) return null;

  const container = document.querySelector(".dashboard-main") || document.body;

  return createPortal(
    <div className="kpi-info-backdrop warehouse-report-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`warehouse-report-window warehouse-report-window--${report.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="warehouse-report-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="warehouse-report-window__head">
          <div className="warehouse-report-window__icon"><Icon name={report.icon} size={20} /></div>
          <div>
            <span>{t("pages.dashboard.dashboarddialogs.skladskoy_otchet")}</span>
            <h2 id="warehouse-report-title">{report.label}</h2>
          </div>
          <button type="button" className="warehouse-report-window__close" aria-label={t("pages.dashboard.dashboarddialogs.zakryt")} onClick={onClose}>
            <Icon name="bi-x-lg" size={20} />
          </button>
        </div>

        <div className="warehouse-report-window__value">
          <strong>{formatNumber(report.value)}</strong>
          <small>UZS</small>
        </div>
        <p>{t("pages.dashboard.dashboarddialogs.tablichnyy_otchet_po_vybrannomu_pokazatelyu_sklada")} {formatDateLabel(selectedDate)}.</p>

        <div className="warehouse-report-table-wrap">
          <table className="data-table warehouse-report-table">
            <thead>
              <tr>
                <th>№</th>
                <th>{t("pages.dashboard.dashboarddialogs.dokument")}</th>
                <th>{t("pages.dashboard.dashboarddialogs.kategoriya_postavschik")}</th>
                <th>{t("pages.dashboard.dashboarddialogs.summa")}</th>
                <th>{t("pages.dashboard.dashboarddialogs.status")}</th>
                <th>{t("pages.dashboard.dashboarddialogs.data")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row) => (
                <tr key={`${row.number}-${row.document}`}>
                  <td>{row.number}</td>
                  <td>{row.document}</td>
                  <td>{row.category}</td>
                  <td>{formatMoney(row.amount)}</td>
                  <td><span className={`badge ${row.statusClass}`}>{row.status}</span></td>
                  <td>{row.date}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6}>{t("pages.dashboard.dashboarddialogs.net_dannyh_za_vybrannuyu_datu")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>,
    container
  );
}



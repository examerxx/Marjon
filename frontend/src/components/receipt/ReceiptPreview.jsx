import { useLayoutEffect, useRef, useState } from "react";
import { CUSTOMER_BLOCKS, KITCHEN_BLOCKS } from "../../api/receipt";
import { orderedBlocks } from "../../pages/settings/receiptBlockOrder";

export const customerSampleOrder = {
  order_number: "3",
  table_number: "1 (Divanli Kabina)",
  waiter: "Kassir",
  order_type: "На стол",
  payment_method: "Смешанная оплата",
  discount: 0,
  service_fee: 8000,
  vat: 0,
  total_amount: 108640,
  created_at: "2025-07-31T18:17:00",
  payments: [
    { label: "Наличные", amount: 108000 },
    { label: "Карта", amount: 600 },
  ],
  items: [
    { id: 1, name: "Somsa", quantity: 10, price: 8000, total: 80000 },
    { id: 2, name: "Shashlik tovuqli 200g", quantity: 2, price: 32000, total: 64000 },
  ],
};

export const kitchenSampleOrder = {
  order_number: "A-1042",
  table_number: "12",
  waiter: "Aziz",
  priority: "Срочно",
  note: "Без лука в салате",
  created_at: "2026-07-27T10:41:00",
  items: [
    {
      id: 1,
      name: "Плов чайханский",
      quantity: 2,
      modifiers: ["Без казы", "Острый соус отдельно"],
      note: "",
    },
    { id: 2, name: "Салат Ачичук", quantity: 1, modifiers: ["Меньше соли"], note: "" },
    { id: 3, name: "Плов чайханский", quantity: 1, modifiers: ["Один без моркови"], note: "" },
  ],
};

function normalizePaperSize(value) {
  return String(value || "80mm").includes("58") ? "58" : "80";
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return toNumber(value).toLocaleString("ru-RU", { maximumFractionDigits: 0 }).replace(/\s/g, " ");
}

function itemTotal(item) {
  return toNumber(item.total ?? item.amount ?? toNumber(item.price) * toNumber(item.quantity || 1));
}

function itemName(item) {
  return item.name || item.title || item.product_name || item.dish_name || "Позиция";
}

function itemQuantity(item) {
  return toNumber(item.quantity ?? item.qty ?? 1);
}

function formatCustomerDate(value) {
  const date = new Date(value || Date.now());
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date).replace(",", "");
}

function formatKitchenDate(value) {
  const date = new Date(value || Date.now());
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getCustomerReceiptTotals(order = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = items.reduce((sum, item) => sum + itemTotal(item), 0);
  const discount = toNumber(order.discount ?? order.discount_amount);
  const service = toNumber(order.service_fee ?? order.service_amount);
  const tax = toNumber(order.vat ?? order.tax ?? order.tax_amount);
  const total = hasValue(order.total_amount)
    ? toNumber(order.total_amount)
    : subtotal - discount + service + tax;
  return { subtotal, discount, service, tax, total };
}

function getPaymentRows(order = {}, total = 0) {
  const paymentRows = [];
  if (Array.isArray(order.payments)) {
    order.payments.forEach((payment) => {
      const amount = toNumber(payment.amount ?? payment.sum ?? payment.total);
      if (amount > 0) {
        paymentRows.push({
          label: payment.label || payment.name || payment.method || payment.payment_method || "Оплата",
          amount,
        });
      }
    });
  }

  [
    ["Наличные", order.cash_amount ?? order.cash],
    ["Карта", order.card_amount ?? order.card],
    ["Перечисление", order.transfer_amount ?? order.transfer],
  ].forEach(([label, value]) => {
    const amount = toNumber(value);
    if (amount > 0) paymentRows.push({ label, amount });
  });

  if (!paymentRows.length && hasValue(order.payment_method) && total > 0) {
    paymentRows.push({ label: order.payment_method, amount: total });
  }

  return paymentRows;
}

function getOrderNumber(order = {}) {
  return hasValue(order.order_number) ? String(order.order_number) : "-";
}

// Blocks whose per-block style (size/align/weight) is user-configurable — must
// stay in sync with CUSTOMER_STYLE_BLOCKS in api/receipt.js. A block is visible
// unless its template.enabled entry is explicitly false (default = shown).
const CUSTOMER_STYLE_SET = new Set([
  "restaurantName", "orderNumber", "table", "waiter", "dateTime",
  "items", "total", "paymentMethod", "thankYouText", "footerText",
]);

function isOn(enabled, block) {
  return enabled?.[block] !== false;
}

function blockClass(block, styles) {
  const classes = ["receipt-preview__block"];
  if (CUSTOMER_STYLE_SET.has(block)) {
    const style = styles?.[block] || {};
    classes.push(`receipt-preview__block--align-${style.align || "left"}`);
    if (style.size === "large" || style.size === "xlarge") {
      classes.push(`receipt-preview__block--size-${style.size}`);
    }
    if (style.weight === "bold") classes.push("receipt-preview__block--weight-bold");
  }
  return classes.join(" ");
}

function ReceiptRule({ solid = false }) {
  return <div className={`receipt-preview__rule ${solid ? "is-solid" : ""}`} aria-hidden="true" />;
}

function CustomerItems({ items = [] }) {
  return (
    <div className="receipt-preview__items" data-receipt-items>
      <div className="receipt-preview__items-head">
        <span>Блюдо</span>
        <span>Кол-во</span>
        <span>Сумма</span>
      </div>
      <ReceiptRule solid />
      {items.map((item, index) => (
        <div className="receipt-preview__item-row" key={item.id || `${itemName(item)}-${index}`}>
          <span className="receipt-preview__item-name">{itemName(item)}</span>
          <span>{money(itemQuantity(item))}</span>
          <span>{money(itemTotal(item))}</span>
        </div>
      ))}
    </div>
  );
}

function PaymentRows({ rows }) {
  if (!rows.length) return null;
  return (
    <div className="receipt-preview__payments">
      {rows.map((row) => (
        <div className="receipt-preview__payment-row" key={row.label}>
          <span>{row.label}:</span>
          <b>{money(row.amount)}</b>
        </div>
      ))}
    </div>
  );
}

// Contiguous same-section blocks share one container (info list, summary list,
// brand header, footer) and a solid rule separates sections. Order comes from
// the persisted template.blocks — the same source the ESC/POS formatter uses.
function CustomerReceipt({ template = {}, org, order }) {
  const enabled = template.enabled || {};
  const styles = template.blockStyles || {};
  const restaurantName = template.restaurantName || org?.name || "MARJON";
  const totals = getCustomerReceiptTotals(order);
  const payments = getPaymentRows(order, totals.total);

  // Contiguous same-section blocks share one container; rules separate sections.
  const runs = [];
  const push = (section, node) => {
    const last = runs[runs.length - 1];
    if (last && last.section === section) last.nodes.push(node);
    else runs.push({ section, nodes: [node] });
  };
  const infoRow = (block, label, value) => {
    if (!hasValue(value)) return;
    push("info", (
      <div className={`receipt-preview__info-row ${blockClass(block, styles)}`} key={`${block}-${label}`}>
        <b>{label}</b><span>{value}</span>
      </div>
    ));
  };
  const summaryRow = (label, value) => push("summary", (
    <div className="receipt-preview__summary-row" key={`sum-${label}`}><span>{label}</span><b>{money(value)}</b></div>
  ));

  const renderSummary = () => {
    if (totals.subtotal > 0) summaryRow("Сумма блюд", totals.subtotal);
    if (isOn(enabled, "discount") && totals.discount > 0) summaryRow("Скидка", totals.discount);
    if (isOn(enabled, "serviceFee") && totals.service > 0) summaryRow("Обслуживание", totals.service);
    if (isOn(enabled, "vat") && totals.tax > 0) summaryRow("Налог", totals.tax);
  };

  let summaryDone = false;
  for (const block of orderedBlocks(template.blocks, CUSTOMER_BLOCKS)) {
    // The subtotal/discount/service/vat unit renders once, anchored to `total`.
    if (block === "discount" || block === "serviceFee" || block === "vat") continue;
    if (block === "total") {
      renderSummary();
      summaryDone = true;
      if (isOn(enabled, "total")) {
        push("total", (
          <div className={`receipt-preview__total ${blockClass("total", styles)}`} key="total">
            <span>Итого к оплате:</span><b>{money(totals.total)}</b>
          </div>
        ));
      }
      continue;
    }
    if (!isOn(enabled, block)) continue;
    const cls = blockClass(block, styles);
    // Logo renders ONLY a real uploaded company logo (org.logo from
    // Company.logo_key). No generic fallback: the physical formatter prints
    // nothing when no logo is uploaded, and the preview must agree.
    if (block === "logo") { if (org?.logo) push("header", <img className="receipt-preview__logo" src={org.logo} alt={restaurantName} key="logo" />); }
    else if (block === "restaurantName") push("header", <div className={`receipt-preview__brand ${cls}`} key="rn">{restaurantName}</div>);
    else if (block === "orderNumber") { infoRow("orderNumber", "Номер заказа:", getOrderNumber(order)); infoRow("orderNumber", "Тип заказа:", order.order_type); }
    else if (block === "table") infoRow("table", "Номер стола:", order.table_number);
    else if (block === "waiter") infoRow("waiter", "Официант:", order.waiter);
    else if (block === "dateTime") infoRow("dateTime", "Дата:", formatCustomerDate(order.created_at));
    else if (block === "items") push("items", <div className={cls} key="items"><CustomerItems items={order.items || []} /></div>);
    else if (block === "paymentMethod") { if (payments.length) push("payment", <div className={cls} key="pay"><PaymentRows rows={payments} /></div>); }
    else if (block === "thankYouText") push("footer", <strong className={cls} key="ty">{template.thankYouText || "XARIDINGIZ UCHUN RAXMAT!"}</strong>);
    else if (block === "footerText") { const v = template.footerText || template.phone || org?.phone; if (hasValue(v)) push("footer", <b className={cls} key="ft">{v}</b>); }
    else if (block === "address") { const v = template.address || org?.address; if (hasValue(v)) push("footer", <b key="addr">{v}</b>); }
    else if (block === "phone") { const v = template.phone || org?.phone; if (hasValue(v)) push("footer", <b key="ph">{v}</b>); }
  }
  if (!summaryDone) renderSummary(); // total block missing from a legacy order

  const wrapRun = (run) => {
    if (run.section === "header") return <header className="receipt-preview__brand-block">{run.nodes}</header>;
    if (run.section === "info") return <div className="receipt-preview__info">{run.nodes}</div>;
    if (run.section === "summary") return <div className="receipt-preview__summary">{run.nodes}</div>;
    if (run.section === "footer") return <footer className="receipt-preview__customer-footer">{run.nodes}</footer>;
    return <>{run.nodes}</>;
  };

  // Fixed reference lines: solid after header/info, solid under the items
  // head, dashed after the dishes list and after the subtotal block, solid
  // after the grand total and after payment. No configurability, no gaps.
  const boundaryRule = (previous) => (previous === "items" || previous === "summary"
    ? <ReceiptRule key={`rule-${previous}`} />
    : <ReceiptRule solid key={`rule-${previous}`} />);

  return (
    <>
      {runs.map((run, index) => (
        <div key={`${run.section}-${index}`} data-receipt-section={run.section}>
          {wrapRun(run)}
          {index < runs.length - 1 ? boundaryRule(run.section) : null}
        </div>
      ))}
    </>
  );
}

function getModifierText(modifier) {
  if (typeof modifier === "string") return modifier;
  return modifier?.name || modifier?.title || modifier?.label || "";
}

function itemNotes(item, { modifiers = true, comments = true } = {}) {
  const notes = [];
  if (modifiers && Array.isArray(item.modifiers)) {
    const modifierText = item.modifiers.map(getModifierText).filter(hasValue).join(", ");
    if (modifierText) notes.push(modifierText);
  }
  if (comments && (hasValue(item.note) || hasValue(item.comment))) {
    notes.push(item.note || item.comment);
  }
  return notes;
}

function isUrgent(order = {}) {
  const value = String(order.priority || order.urgency || "").toLowerCase();
  return Boolean(order.is_urgent || order.urgent || value.includes("сроч") || value.includes("urgent"));
}

// Breathing room around the paper inside the fit frame so the drop-shadow
// renders instead of being clipped by the frame's hidden overflow. Kept
// compact on purpose: every vertical pad pixel directly shrinks the fitted
// scale (scale is height-bound), so the pads are the minimum that still
// holds the soft shadow edge. Must stay in sync with the
// `.receipt-fit-frame` padding in receiptSettings.css.
export const FIT_PAD_TOP = 26;
export const FIT_PAD_BOTTOM = 32;
export const FIT_PAD_SIDE = 12;

export const FIT_MIN_SCALE = 0.5;

// Pure fit-scale contract, extracted for unit testing: never upscale, take
// the tighter of the width/height constraints, never go below the readable
// floor. Height is the binding constraint for a real 80mm receipt; width
// only binds on narrow panes.
export function computeFitScale(natW, natH, availW, availH) {
  if (!natW || !natH || availW <= 0 || availH <= 0) return 1;
  const raw = Math.min(1, availH / natH, availW / natW);
  return raw < 1 ? Math.max(raw, FIT_MIN_SCALE) : 1;
}

function KitchenItems({ items = [], modifiers = true, comments = true }) {
  return (
    <div className="receipt-preview__kitchen-items">
      {items.map((item, index) => {
        const notes = itemNotes(item, { modifiers, comments });
        return (
          <div className="receipt-preview__kitchen-item" key={item.id || `${itemName(item)}-${index}`}>
            <strong>{money(itemQuantity(item))} x {itemName(item)}</strong>
            {notes.map((note) => <span key={note}>- {note}</span>)}
          </div>
        );
      })}
    </div>
  );
}

function KitchenReceipt({ template = {}, order }) {
  const enabled = template.enabled || {};
  const runs = [];
  const push = (section, node) => {
    const last = runs[runs.length - 1];
    if (last && last.section === section) last.nodes.push(node);
    else runs.push({ section, nodes: [node] });
  };
  const infoRow = (block, label, value) => {
    if (!hasValue(value)) return;
    push("info", (
      <div className="receipt-preview__info-row" key={`${block}-${label}`}><b>{label}</b><span>{value}</span></div>
    ));
  };

  for (const block of orderedBlocks(template.blocks, KITCHEN_BLOCKS)) {
    if (block === "modifiers" || block === "itemComments") continue; // sub-toggles of items
    if (!isOn(enabled, block)) continue;
    if (block === "orderNumber") push("number", <h3 className="receipt-preview__kitchen-number" key="num">#{getOrderNumber(order)}</h3>);
    else if (block === "table") infoRow("table", "Стол:", order.table_number);
    else if (block === "waiter") infoRow("waiter", "Официант:", order.waiter);
    else if (block === "createdAt") infoRow("createdAt", "Время:", formatKitchenDate(order.created_at));
    else if (block === "items") push("items", (
      <KitchenItems key="items" items={order.items || []} modifiers={isOn(enabled, "modifiers")} comments={isOn(enabled, "itemComments")} />
    ));
    else if (block === "orderNote" && hasValue(order.note)) push("note", (
      <div className="receipt-preview__kitchen-comment" key="note"><b>Комментарий:</b><span>- {order.note}</span></div>
    ));
    else if (block === "priority" && isUrgent(order)) push("priority", <div className="receipt-preview__kitchen-urgent" key="urg">! СРОЧНО !</div>);
  }

  const wrapRun = (run) => {
    if (run.section === "info") return <div className="receipt-preview__info">{run.nodes}</div>;
    return <>{run.nodes}</>;
  };

  return (
    <>
      {runs.map((run, index) => (
        <div key={`${run.section}-${index}`} data-receipt-section={run.section}>
          {index > 0 && run.section !== "info" ? <ReceiptRule /> : null}
          {wrapRun(run)}
        </div>
      ))}
    </>
  );
}

export default function ReceiptPreview({ type = "customer", template = {}, org, order, fitPane = false }) {
  const paperSize = normalizePaperSize(template.paperSize);
  const sample = order || (type === "kitchen" ? kitchenSampleOrder : customerSampleOrder);

  // Fit-to-pane (settings preview only): shrink the receipt JUST enough to
  // fit the visible right-pane height. Preview-only presentation — the logical
  // receipt (widths, wrapping, ESC/POS order) is untouched. `zoom` composes
  // naturally: offsetHeight already includes it, so scale is measured against
  // the true on-screen size. Floor 0.5 keeps text readable; anything smaller
  // is reported via data-fit-scale instead of silently shrinking further.
  // The fit frame reserves padding around the paper (FIT_PAD_*) so the
  // drop-shadow has room to render: frame overflow is hidden, so without
  // this breathing room the shadow would be clipped at the frame edge.
  const availRef = useRef(null);
  const contentRef = useRef(null);
  const [fit, setFit] = useState({ scale: 1, width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!fitPane) return undefined;
    const avail = availRef.current;
    const content = contentRef.current;
    if (!avail || !content || typeof ResizeObserver === "undefined") return undefined;
    const compute = () => {
      // Measure the receipt node itself: an ancestor transform never changes
      // layout metrics, so this is always the natural (zoom-included) size.
      const inner = content.querySelector("[data-receipt-print-root]");
      const availH = avail.clientHeight - (FIT_PAD_TOP + FIT_PAD_BOTTOM);
      const availW = avail.clientWidth - FIT_PAD_SIDE * 2;
      const natH = inner ? inner.offsetHeight : content.offsetHeight;
      const natW = inner ? inner.offsetWidth : content.offsetWidth;
      if (!natH || !natW || availH <= 0 || availW <= 0) return;
      const scale = computeFitScale(natW, natH, availW, availH);
      setFit((prev) => (Math.abs(prev.scale - scale) < 0.004 && prev.width === natW && prev.height === natH)
        ? prev
        : { scale, width: natW, height: natH });
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(avail);
    observer.observe(content);
    return () => observer.disconnect();
  }, [fitPane, template, type, order, org]);

  const receiptNode = (
    <div
      className={`receipt-preview receipt-preview--${type} receipt-preview--${paperSize}mm`}
      data-paper-size={paperSize}
      data-receipt-type={type}
      data-receipt-component="shared"
      data-receipt-print-root
    >
      {type === "kitchen"
        ? <KitchenReceipt template={template} order={sample} />
        : <CustomerReceipt template={template} org={org} order={sample} />}
    </div>
  );

  if (!fitPane) {
    return (
      <div className="receipt-preview-shell" data-receipt-preview-shell>
        {receiptNode}
      </div>
    );
  }

  return (
    <div className="receipt-preview-shell receipt-preview-shell--fit" data-receipt-preview-shell data-fit-scale={fit.scale.toFixed(3)}>
      <div className="receipt-fit-viewport" ref={availRef}>
        <div
          className="receipt-fit-frame"
          style={fit.height ? { width: Math.ceil(fit.width * fit.scale + FIT_PAD_SIDE * 2), height: Math.ceil(fit.height * fit.scale + FIT_PAD_TOP + FIT_PAD_BOTTOM) } : undefined}
        >
          <div ref={contentRef} style={{ transform: `scale(${fit.scale})`, transformOrigin: "top left" }}>
            {receiptNode}
          </div>
        </div>
      </div>
    </div>
  );
}
